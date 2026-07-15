// Given a UK postcode, returns HM Land Registry sold-price comparables:
// every sale in `sold_prices` at a postcode within RADIUS_MILES of the
// subject postcode, sold within the last COMPARABLE_MONTHS months.
//
// Uses nearbyPostcodes (nearby-postcodes.js) to get the candidate postcode
// list, then queries sold_prices for that list. No floor area or price-per-
// square-metre yet — Price Paid Data doesn't carry floor area (see CLAUDE.md
// "Planned — not yet built" for the valuation/comps engine this feeds).
//
// Does not create its own Supabase client — pass one in, same convention as
// nearby-postcodes.js.
//
// Usage:
//   const { getComps } = require('./get-comps');
//   const result = await getComps(supabase, 'SW1A 1AA');
//   // -> { comps: [{ address, price, date, distanceMiles }, ...], count, averagePrice, low, high }

const { nearbyPostcodes } = require('./nearby-postcodes');

const RADIUS_MILES = 0.5;
const COMPARABLE_MONTHS = 24;
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

async function getComps(supabase, postcode) {
  const nearby = await nearbyPostcodes(supabase, postcode, RADIUS_MILES);

  if (nearby.length === 0) {
    return { comps: [], count: 0, averagePrice: null, low: null, high: null };
  }

  const distanceByPostcode = new Map(nearby.map((p) => [p.postcode, p.distanceMiles]));

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - COMPARABLE_MONTHS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const comps = [];
  for (const postcodeBatch of chunk(nearby.map((p) => p.postcode), POSTCODE_BATCH_SIZE)) {
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('sold_prices')
        .select('price, date, postcode, paon, saon, street, town')
        .in('postcode', postcodeBatch)
        .gte('date', cutoffDate)
        .order('date', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        throw new ComparablesLookupError(`Comps query failed: ${error.message}`, 'query_failed');
      }
      if (!data || data.length === 0) break;

      for (const row of data) {
        comps.push({
          address: formatAddress(row),
          price: row.price,
          date: row.date,
          distanceMiles: distanceByPostcode.get(row.postcode),
        });
      }

      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  comps.sort((a, b) => a.distanceMiles - b.distanceMiles);

  const count = comps.length;
  const prices = comps.map((c) => c.price);
  const averagePrice = count > 0 ? prices.reduce((sum, p) => sum + p, 0) / count : null;
  const low = count > 0 ? Math.min(...prices) : null;
  const high = count > 0 ? Math.max(...prices) : null;

  return { comps, count, averagePrice, low, high };
}

module.exports = { getComps, ComparablesLookupError, RADIUS_MILES, COMPARABLE_MONTHS };
