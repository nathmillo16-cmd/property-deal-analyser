// Given a UK postcode and a Land Registry property type (D/S/T/F/O), returns
// an honest sold-price valuation: every sale in `sold_prices` at a postcode
// within RADIUS_MILES of the subject postcode, of the matching property
// type, sold within the last COMPARABLE_MONTHS months, excluding sub-£20k
// sales (non-market: gifts, part-shares, repossessions at a discount, etc.).
//
// Uses nearbyPostcodes (nearby-postcodes.js) to get the candidate postcode
// list, then queries sold_prices for that list (property type and minimum
// price filtered at the query itself, so `comps` only ever contains rows
// that count toward the valuation). Each comp is then enriched with
// floorAreaSqM and pricePerSqM via epc-floor-area.js — see that file for the
// EPC matching/caching approach. Matching is exact house-number only; where
// no EPC match is found, floorAreaSqM and pricePerSqM are null and
// floorAreaMatched is false.
//
// Headline figure is the median price (not mean) — resistant to a single
// unusually cheap/expensive sale skewing the estimate. low/high is the
// 20th/80th percentile of the filtered comps' own prices: this describes
// the actual spread of what comparable properties sold for, deliberately
// NOT a standard-error-style interval, which would shrink toward zero width
// as the comp count grows — that shrinkage reflects confidence in the
// *median statistic*, not the real uncertainty in what an individual
// property is worth, which doesn't shrink just because there happen to be
// more sales on record. Below MIN_COMPS_FOR_RANGE (5) comps there isn't
// enough evidence for any range at all, so low/high are both null rather
// than a range built from too few points to mean anything.
//
// `confidence` is a high/medium/low signal based on comp count — it does
// NOT change the width of low/high, it just tells the caller how much
// weight to put on the estimate. A recency-based downgrade (fewer than
// RECENT_SHARE_THRESHOLD of comps from the last RECENT_MONTHS) is written
// but currently disabled in computeConfidence(), since the sold_prices
// ingest (scripts/ingest-sold-prices.js, WINDOW_MONTHS) only loads the last
// 12 months — every comp is "recent" by that definition, so the downgrade
// could never fire. See the comment there for when to re-enable it.
//
// Does not create its own Supabase client for the sold_prices/postcodes
// lookups — pass one in, same convention as nearby-postcodes.js. The EPC
// floor-area cache write needs a service-role client, so epc-floor-area.js
// creates its own internally (see that file).
//
// Usage:
//   const { getComps } = require('./get-comps');
//   const result = await getComps(supabase, 'SW1A 1AA', 'T');
//   // -> {
//   //   comps: [{ address, price, date, distanceMiles, floorAreaSqM, pricePerSqM, floorAreaMatched }, ...],
//   //   count, medianPrice, low, high, dateRange: { start, end } | null,
//   //   medianPricePerSqM, floorAreaMatchedCount,
//   //   pricePerSqMTiers: { conservative, refurbished, bestInArea } | null
//   //     (50th/75th/90th percentile of the same floorAreaMatched £/sqm
//   //     comps — conservative equals medianPricePerSqM; null if
//   //     floorAreaMatchedCount is 0),
//   //   confidence: 'high'|'medium'|'low'
//   // }

const { nearbyPostcodes } = require('./nearby-postcodes');
const { enrichCompsWithFloorArea } = require('./epc-floor-area');

const RADIUS_MILES = 0.5;
const COMPARABLE_MONTHS = 24;
const MIN_SALE_PRICE = 20000; // below this, treat as non-market (gift, part-share, etc.)
const VALID_PROPERTY_TYPES = ['D', 'S', 'T', 'F', 'O']; // Land Registry: Detached/Semi/Terraced/Flat/Other
const RANGE_LOW_PERCENTILE = 0.2;
const RANGE_HIGH_PERCENTILE = 0.8;
const MIN_COMPS_FOR_RANGE = 5;
const RECENT_MONTHS = 12; // half of COMPARABLE_MONTHS — the "recent" half of the comp window
const RECENT_SHARE_THRESHOLD = 0.4; // below this share of recent comps, downgrade confidence a level
const HIGH_CONFIDENCE_COUNT = 15;
const MEDIUM_CONFIDENCE_COUNT = 5;
const PAGE_SIZE = 1000; // PostgREST's default row cap per request; paginate past it
const POSTCODE_BATCH_SIZE = 200; // keep the .in() filter list (and resulting query URL) a sane size

class ComparablesLookupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ComparablesLookupError';
    this.code = code;
  }
}

function formatAddress(row) {
  return [row.saon, row.paon, row.street, row.town].filter(Boolean).join(', ');
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Linear-interpolation percentile (R type 7 / NumPy default) over an
// ascending-sorted numeric array. p is 0-1.
function percentile(sortedValues, p) {
  const n = sortedValues.length;
  if (n === 0) return null;
  if (n === 1) return sortedValues[0];
  const idx = p * (n - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedValues[lower];
  const weight = idx - lower;
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * weight;
}

function median(sortedValues) {
  return percentile(sortedValues, 0.5);
}

function computeConfidence(comps) {
  const count = comps.length;
  if (count === 0) return 'low';

  let level;
  if (count >= HIGH_CONFIDENCE_COUNT) level = 'high';
  else if (count >= MEDIUM_CONFIDENCE_COUNT) level = 'medium';
  else level = 'low';

  // Recency downgrade — DISABLED. sold_prices is currently only ever
  // ingested with WINDOW_MONTHS = 12 (scripts/ingest-sold-prices.js), so
  // every comp already falls within RECENT_MONTHS and recentShare is
  // always ~1 — this branch can never fire as things stand, so it's dead
  // code dressed up as a real signal. Re-enable once the ingest window is
  // widened to 24+ months (bump WINDOW_MONTHS there and re-run ingestion),
  // at which point "recent" vs. "rest of the window" becomes a real
  // distinction again.
  //
  // const recentCutoff = new Date();
  // recentCutoff.setMonth(recentCutoff.getMonth() - RECENT_MONTHS);
  // const recentCutoffDate = recentCutoff.toISOString().slice(0, 10);
  // const recentShare = comps.filter((c) => c.date >= recentCutoffDate).length / count;
  //
  // if (recentShare < RECENT_SHARE_THRESHOLD) {
  //   if (level === 'high') level = 'medium';
  //   else if (level === 'medium') level = 'low';
  // }

  return level;
}

function validatePropertyType(propertyType) {
  if (!VALID_PROPERTY_TYPES.includes(propertyType)) {
    throw new ComparablesLookupError(
      `propertyType must be one of ${VALID_PROPERTY_TYPES.join('/')} (Land Registry codes), got ${JSON.stringify(propertyType)}`,
      'invalid_property_type'
    );
  }
}

function emptyResult() {
  return {
    comps: [],
    count: 0,
    medianPrice: null,
    low: null,
    high: null,
    dateRange: null,
    medianPricePerSqM: null,
    floorAreaMatchedCount: 0,
    pricePerSqMTiers: null,
    confidence: 'low',
  };
}

async function getComps(supabase, postcode, propertyType) {
  validatePropertyType(propertyType);

  const nearby = await nearbyPostcodes(supabase, postcode, RADIUS_MILES);
  if (nearby.length === 0) return emptyResult();

  const distanceByPostcode = new Map(nearby.map((p) => [p.postcode, p.distanceMiles]));

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - COMPARABLE_MONTHS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const comps = [];
  const epcItems = [];
  for (const postcodeBatch of chunk(nearby.map((p) => p.postcode), POSTCODE_BATCH_SIZE)) {
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('sold_prices')
        .select('price, date, postcode, paon, saon, street, town')
        .in('postcode', postcodeBatch)
        .eq('property_type', propertyType)
        .gte('price', MIN_SALE_PRICE)
        .gte('date', cutoffDate)
        .order('date', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        throw new ComparablesLookupError(`Comps query failed: ${error.message}`, 'query_failed');
      }
      if (!data || data.length === 0) break;

      for (const row of data) {
        const comp = {
          address: formatAddress(row),
          price: row.price,
          date: row.date,
          distanceMiles: distanceByPostcode.get(row.postcode),
        };
        comps.push(comp);
        epcItems.push({ comp, postcode: row.postcode, paon: row.paon });
      }

      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  if (comps.length === 0) return emptyResult();

  comps.sort((a, b) => a.distanceMiles - b.distanceMiles);

  await enrichCompsWithFloorArea(epcItems);

  const count = comps.length;
  const sortedPrices = comps.map((c) => c.price).sort((a, b) => a - b);
  const medianPrice = median(sortedPrices);
  const low = count >= MIN_COMPS_FOR_RANGE ? percentile(sortedPrices, RANGE_LOW_PERCENTILE) : null;
  const high = count >= MIN_COMPS_FOR_RANGE ? percentile(sortedPrices, RANGE_HIGH_PERCENTILE) : null;

  const dates = comps.map((c) => c.date).sort();
  const dateRange = { start: dates[0], end: dates[dates.length - 1] };

  const matchedPricesPerSqM = comps
    .filter((c) => c.floorAreaMatched)
    .map((c) => c.pricePerSqM)
    .sort((a, b) => a - b);
  const floorAreaMatchedCount = matchedPricesPerSqM.length;
  const medianPricePerSqM = floorAreaMatchedCount > 0 ? median(matchedPricesPerSqM) : null;

  // Three GDV tiers for a post-refurb floor area, all drawn from the same
  // floorAreaMatched £/sqm comps (floorAreaMatchedCount) — only the
  // percentile differs. conservative is the same figure as medianPricePerSqM
  // above, just also exposed in this structure for the tier picker.
  const pricePerSqMTiers = floorAreaMatchedCount > 0 ? {
    conservative: median(matchedPricesPerSqM),
    refurbished: percentile(matchedPricesPerSqM, 0.75),
    bestInArea: percentile(matchedPricesPerSqM, 0.9),
  } : null;

  const confidence = computeConfidence(comps);

  return { comps, count, medianPrice, low, high, dateRange, medianPricePerSqM, floorAreaMatchedCount, pricePerSqMTiers, confidence };
}

module.exports = {
  getComps,
  ComparablesLookupError,
  RADIUS_MILES,
  COMPARABLE_MONTHS,
  MIN_SALE_PRICE,
  VALID_PROPERTY_TYPES,
  MIN_COMPS_FOR_RANGE,
};
