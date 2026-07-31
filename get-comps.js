// Given a UK postcode and a Land Registry property type (D/S/T/F/O), returns
// an honest sold-price valuation: every sale in `sold_prices` within
// RADIUS_MILES of the subject postcode, of the matching property type, sold
// within the last COMPARABLE_MONTHS months, excluding sub-£20k sales
// (non-market: gifts, part-shares, repossessions at a discount, etc.).
//
// The subject postcode is resolved live via postcodes.io (postcodes-io.js)
// — no `postcodes` table (it's been dropped from the schema entirely).
// sold_prices carries its own lat/lng (backfilled via
// scripts/backfill-sold-prices-lat-lng.js), so the candidate set is a
// single bounding-box-pre-filtered, paginated query directly against
// sold_prices, with an exact haversine check applied to each page — same
// two-stage approach (cheap box filter, then precise distance check) the
// old postcode-table lookup used, just applied to sold_prices directly
// instead of joining through a list of nearby postcode strings.
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
// Does not create its own Supabase client for the sold_prices lookup —
// pass one in. The EPC floor-area cache write needs a service-role client,
// so epc-floor-area.js creates its own internally (see that file).
//
// Usage:
//   const { getComps } = require('./get-comps');
//   const result = await getComps(supabase, 'SW1A 1AA', 'T');
//   // -> { comps, count, medianPrice, low, high, dateRange,
//   //      medianPricePerSqM, floorAreaMatchedCount, pricePerSqMTiers,
//   //      confidence }

const { lookupPostcode } = require('./postcodes-io');
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
const EARTH_RADIUS_MILES = 3958.8;

class ComparablesLookupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ComparablesLookupError';
    this.code = code;
  }
}

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

function formatAddress(row) {
  return [row.saon, row.paon, row.street, row.town].filter(Boolean).join(', ');
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

  // Recency downgrade — DISABLED, same as get-comps.js. sold_prices is
  // currently only ever ingested with WINDOW_MONTHS = 12
  // (scripts/ingest-sold-prices.js), so every comp already falls within
  // RECENT_MONTHS and recentShare is always ~1 — this branch can never
  // fire as things stand. Re-enable once the ingest window is widened to
  // 24+ months, at which point "recent" vs. "rest of the window" becomes a
  // real distinction again.
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

  // Resolves the SUBJECT postcode's coordinates live — no `postcodes`
  // table lookup. Throws PostcodeLookupError (postcodes-io.js) on an
  // invalid/unrecognised postcode or an unreachable postcodes.io, same
  // error class server.js's /api/comps route already catches.
  const { lat: subjectLat, lng: subjectLng } = await lookupPostcode(postcode);

  // Bounding box in degrees, sized generously enough to fully contain the
  // radius circle, around the live-resolved subject point.
  const milesPerDegreeLat = (EARTH_RADIUS_MILES * Math.PI) / 180; // ~69.09
  const deltaLat = RADIUS_MILES / milesPerDegreeLat;
  const milesPerDegreeLng = milesPerDegreeLat * Math.max(Math.cos(toRadians(subjectLat)), 1e-6);
  const deltaLng = RADIUS_MILES / milesPerDegreeLng;

  const minLat = subjectLat - deltaLat;
  const maxLat = subjectLat + deltaLat;
  const minLng = subjectLng - deltaLng;
  const maxLng = subjectLng + deltaLng;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - COMPARABLE_MONTHS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  // One paginated query directly against sold_prices, combining the
  // bounding-box pre-filter with the same property_type/price/date filters
  // get-comps.js already applied in its .in('postcode', batch) step. No
  // postcode list, no batching — the whole two-step (nearby postcodes,
  // then IN-filter sold_prices) collapses into this single query shape.
  const comps = [];
  const epcItems = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('sold_prices')
      .select('price, date, postcode, paon, saon, street, town, lat, lng')
      .not('lat', 'is', null)
      .not('lng', 'is', null)
      .gte('lat', minLat)
      .lte('lat', maxLat)
      .gte('lng', minLng)
      .lte('lng', maxLng)
      .eq('property_type', propertyType)
      .gte('price', MIN_SALE_PRICE)
      .gte('date', cutoffDate)
      .order('date', { ascending: false }) // stable order required for .range() paging to not skip/repeat rows
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new ComparablesLookupError(`Comps query failed: ${error.message}`, 'query_failed');
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      // Bounding box over-approximates the circle (up to ~27% extra area
      // at the corners), so this exact check still has real work to do.
      const distanceMiles = haversineMiles(subjectLat, subjectLng, row.lat, row.lng);
      if (distanceMiles > RADIUS_MILES) continue;

      const comp = {
        address: formatAddress(row),
        price: row.price,
        date: row.date,
        distanceMiles,
      };
      comps.push(comp);
      epcItems.push({ comp, postcode: row.postcode, paon: row.paon });
    }

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
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
