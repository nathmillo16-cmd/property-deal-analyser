// Loads the ONS Postcode Directory (ONSPD) into the `postcodes` table
// (postcode -> lat/lng).
//
// Source: ONS Open Geography Portal (geoportal.statistics.gov.uk), free
// download — search "ONS Postcode Directory" there and download the latest
// ONSPD release ZIP. It ships as either a single composite CSV or a
// `Data/multi_csv` folder of per-postcode-area CSVs — this script accepts
// either a single file or a folder and handles both.
//
// Usage:
//   node scripts/ingest-postcodes.js <path-to-csv-or-folder>
//
// Requires SUPABASE_URL and SUPABASE_SECRET_KEY (service role) in .env —
// the postcodes table's RLS policy only grants SELECT to normal roles, so
// writing requires the service role, same as this project's other
// service-role-only operations (e.g. the Stripe webhook).
//
// Safe to re-run: upserts are keyed on postcode, so re-running (e.g. after
// a failed batch, or to load a newer ONSPD release) just overwrites rows
// rather than duplicating them.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { createClient } = require('@supabase/supabase-js');

const BATCH_SIZE = 1000;
const LOG_EVERY = 50; // batches

function normalisePostcode(raw) {
  if (!raw) return null;
  const s = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  return s || null;
}

function parseCoord(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ONSPD uses lat=99.999999 (and long=0) as a sentinel for postcodes with no
// real geographic centroid (a handful of special/administrative postcodes).
// Storing that literally would silently corrupt any distance/comps math
// later, so these are treated as "no coordinates" (null) instead.
function isValidLat(n) { return n !== null && n >= -90 && n <= 90 && n !== 99.999999; }
function isValidLng(n) { return n !== null && n >= -180 && n <= 180; }

async function upsertBatch(supabase, rows) {
  if (rows.length === 0) return { count: 0, error: null };
  const { error } = await supabase.from('postcodes').upsert(rows, { onConflict: 'postcode' });
  return { count: rows.length, error };
}

function processFile(filePath, supabase, stats) {
  return new Promise((resolve, reject) => {
    const parser = fs.createReadStream(filePath).pipe(
      parse({ columns: true, skip_empty_lines: true, relax_column_count: true })
    );
    let batch = [];
    let chain = Promise.resolve();

    const flush = (rows) => {
      chain = chain
        .then(() => upsertBatch(supabase, rows))
        .then(({ count, error }) => {
          if (error) {
            stats.batchErrors++;
            console.error(`  ! batch upsert failed (${count} rows): ${error.message}`);
          } else {
            stats.inserted += count;
          }
          stats.batches++;
          if (stats.batches % LOG_EVERY === 0) {
            console.log(`  ... ${stats.seen.toLocaleString()} rows read, ${stats.inserted.toLocaleString()} upserted so far`);
          }
        });
      return chain;
    };

    parser.on('data', (row) => {
      stats.seen++;
      // pcds = ONSPD's standardised, single-space postcode format
      // (e.g. "SW1A 1AA") — falls back to pcd2/pcd for older/odd releases.
      const postcode = normalisePostcode(row.pcds || row.pcd2 || row.pcd);
      if (!postcode) {
        stats.skippedNoPostcode++;
        return;
      }

      const lat = parseCoord(row.lat);
      const lng = parseCoord(row.long);
      const validCoords = isValidLat(lat) && isValidLng(lng);
      if (!validCoords) stats.missingCoords++;

      batch.push({ postcode, lat: validCoords ? lat : null, lng: validCoords ? lng : null });

      if (batch.length >= BATCH_SIZE) {
        const toFlush = batch;
        batch = [];
        parser.pause();
        flush(toFlush).then(() => parser.resume());
      }
    });

    parser.on('end', () => {
      flush(batch).then(resolve).catch(reject);
    });
    parser.on('error', reject);
  });
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node scripts/ingest-postcodes.js <path-to-csv-or-folder>');
    process.exit(1);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY in .env');
    process.exit(1);
  }

  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    console.error(`Not found: ${resolved}`);
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  let files;
  if (fs.statSync(resolved).isDirectory()) {
    files = fs.readdirSync(resolved)
      .filter((f) => f.toLowerCase().endsWith('.csv'))
      .map((f) => path.join(resolved, f))
      .sort();
    console.log(`Found ${files.length} CSV file(s) in ${resolved}`);
  } else {
    files = [resolved];
  }

  const stats = { seen: 0, inserted: 0, skippedNoPostcode: 0, missingCoords: 0, batches: 0, batchErrors: 0 };
  const startedAt = Date.now();

  for (const file of files) {
    console.log(`Processing ${path.basename(file)}...`);
    await processFile(file, supabase, stats);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('');
  console.log('Done.');
  console.log(`  Rows read:          ${stats.seen.toLocaleString()}`);
  console.log(`  Rows upserted:      ${stats.inserted.toLocaleString()}`);
  console.log(`  Skipped (no pcode): ${stats.skippedNoPostcode.toLocaleString()}`);
  console.log(`  Missing coords:     ${stats.missingCoords.toLocaleString()} (stored with lat/lng = null)`);
  console.log(`  Failed batches:     ${stats.batchErrors}`);
  console.log(`  Time:               ${elapsed}s`);
  if (stats.batchErrors > 0) {
    console.log('');
    console.log('Some batches failed — safe to just re-run this script (upserts are keyed on postcode).');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('Ingest failed:', e);
  process.exit(1);
});
