// One-off backfill: geocodes every distinct postcode already in
// `sold_prices` via postcodes.io, and writes lat/lng onto every row sharing
// that postcode. Part of the comps re-architecture (see get-comps.js,
// postcodes-io.js) that drops the `postcodes` table in favour of
// sold_prices having its own coordinates.
//
// PREREQUISITE: run db/012_sold_prices_lat_lng.sql first (adds the lat/lng
// columns this script writes to).
//
// Distinct-postcode count confirmed directly against the live table before
// writing this script: 407,989 distinct postcodes across 592,876 rows (NOT
// the ~66k originally estimated — see the plan this was written against).
// At 100 postcodes/bulk-lookup call plus a small per-update concurrency
// limit, expect on the order of 1-2 hours for a full run, not minutes.
//
// Usage:
//   node scripts/backfill-sold-prices-lat-lng.js
//
// Requires SUPABASE_URL and SUPABASE_SECRET_KEY (service role) in .env —
// same as scripts/ingest-sold-prices.js.
//
// Safe to re-run: only ever UPDATEs existing sold_prices rows by postcode,
// never inserts. A postcode that already has lat/lng just gets the same
// value written again. If a run is interrupted or a chunk's bulk lookup
// fails, just re-run the whole script — every postcode gets looked up
// again, so nothing is skipped or duplicated.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { bulkLookupPostcodes, BULK_MAX } = require('../postcodes-io');

const PAGE_SIZE = 1000; // PostgREST's per-request cap
const CHUNK_DELAY_MS = 150; // politeness gap between bulk postcodes.io calls — no published hard limit, but batching + a modest gap is the established convention for this API
const UPDATE_CONCURRENCY = 20; // parallel sold_prices UPDATEs per chunk (a chunk can update up to 100 distinct postcodes' worth of rows)
const LOG_EVERY = 20; // chunks

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

// Runs `fn` over `items` with at most `concurrency` in flight at once,
// collecting all results (including thrown errors, captured per-item so one
// failure doesn't abort the rest of the batch).
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await fn(items[i]) };
      } catch (e) {
        results[i] = { ok: false, error: e };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function fetchDistinctPostcodes(supabase) {
  const distinct = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('sold_prices')
      .select('postcode')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Fetching postcodes failed at offset ${from}: ${error.message}`);
    if (!data || data.length === 0) break;
    data.forEach((row) => {
      if (row.postcode) distinct.add(row.postcode);
    });
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return [...distinct];
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY in .env');
    process.exit(1);
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  console.log('Fetching distinct postcodes from sold_prices...');
  const postcodes = await fetchDistinctPostcodes(supabase);
  console.log(`Found ${postcodes.length.toLocaleString()} distinct postcodes.`);

  const chunks = chunkArray(postcodes, BULK_MAX);
  const stats = { geocoded: 0, notFound: 0, bulkLookupFailures: 0, updateFailures: 0 };
  const startedAt = Date.now();

  for (let i = 0; i < chunks.length; i++) {
    const batch = chunks[i];

    let results;
    try {
      results = await bulkLookupPostcodes(batch);
    } catch (e) {
      stats.bulkLookupFailures++;
      console.error(`  ! bulk lookup failed for chunk ${i + 1}/${chunks.length} (${batch.length} postcodes): ${e.message}`);
      if (i + 1 < chunks.length) await sleep(CHUNK_DELAY_MS);
      continue; // re-running the whole script later retries this chunk too — nothing is lost
    }

    const found = results.filter((r) => r.lat !== null && r.lng !== null);
    stats.notFound += results.length - found.length;

    const updateResults = await mapWithConcurrency(found, UPDATE_CONCURRENCY, async ({ query, lat, lng }) => {
      const { error } = await supabase.from('sold_prices').update({ lat, lng }).eq('postcode', query);
      if (error) throw new Error(`${query}: ${error.message}`);
    });

    updateResults.forEach((r) => {
      if (r.ok) {
        stats.geocoded++;
      } else {
        stats.updateFailures++;
        console.error(`  ! update failed: ${r.error.message}`);
      }
    });

    if ((i + 1) % LOG_EVERY === 0 || i + 1 === chunks.length) {
      console.log(
        `  ... ${(i + 1).toLocaleString()}/${chunks.length.toLocaleString()} chunks, ${stats.geocoded.toLocaleString()} geocoded, ${stats.notFound.toLocaleString()} not found so far`
      );
    }

    if (i + 1 < chunks.length) await sleep(CHUNK_DELAY_MS);
  }

  const elapsedMin = ((Date.now() - startedAt) / 1000 / 60).toFixed(1);
  console.log('');
  console.log('Done.');
  console.log(`  Distinct postcodes:      ${postcodes.length.toLocaleString()}`);
  console.log(`  Geocoded (lat/lng set):  ${stats.geocoded.toLocaleString()}`);
  console.log(`  Not found (left null):   ${stats.notFound.toLocaleString()}`);
  console.log(`  Bulk lookup failures:    ${stats.bulkLookupFailures} chunk(s)`);
  console.log(`  Row update failures:     ${stats.updateFailures}`);
  console.log(`  Time:                    ${elapsedMin} min`);
  if (stats.bulkLookupFailures > 0 || stats.updateFailures > 0) {
    console.log('');
    console.log('Some chunks/updates failed — safe to just re-run this script (idempotent, update-only).');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
