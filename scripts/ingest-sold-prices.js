// Loads a year of HM Land Registry Price Paid Data (PPD) into the
// `sold_prices` table.
//
// Source: gov.uk "Price Paid Data" page (search "HM Land Registry Price
// Paid Data" on gov.uk) — download one of the yearly, complete-year CSV
// files. Those files have NO header row, so columns are mapped by
// position below. Field order confirmed against gov.uk's own column
// documentation (About the Price Paid Data guidance page) for the yearly/
// complete file, which does NOT include the "Record Status" field (that
// one's monthly-update-only):
//
//   0  Transaction unique identifier
//   1  Price
//   2  Date of Transfer      e.g. "2013-10-04 00:00"
//   3  Postcode
//   4  Property Type         D/S/T/F/O
//   5  Old/New                Y/N
//   6  Duration               F/L  (tenure)
//   7  PAON
//   8  SAON
//   9  Street
//   10 Locality               (not stored — no matching column)
//   11 Town/City
//   12 District               (not stored — no matching column)
//   13 County                 (not stored — no matching column)
//   14 PPD Category Type      (not stored — no matching column)
//
// PREREQUISITE: run db/003_sold_prices_transaction_id.sql in the Supabase
// SQL editor first. sold_prices has no column that naturally dedupes PPD
// rows, so that migration adds `transaction_id` (+ a unique index) and
// this script upserts on it (onConflict: 'transaction_id') — without that
// column this script's upserts will fail.
//
// Only rows dated within the last WINDOW_MONTHS are inserted (see the
// constant below — bump it to 24 to widen the window; already-loaded rows
// outside a widened window are left alone, this script never deletes).
//
// Usage:
//   node scripts/ingest-sold-prices.js <path-to-yearly-csv>
//
// Requires SUPABASE_URL and SUPABASE_SECRET_KEY (service role) in .env —
// same as scripts/backfill-sold-prices-lat-lng.js, since sold_prices' RLS
// policy only grants SELECT to normal roles.
//
// Safe to re-run: upserts are keyed on transaction_id, so re-running (e.g.
// after a failed batch, or over a freshly downloaded file covering the
// same period) just overwrites rows rather than duplicating them.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { createClient } = require('@supabase/supabase-js');

const BATCH_SIZE = 1000;
const LOG_EVERY = 50; // batches

// How far back to keep rows from, in months. Raise to 24 to widen the
// window on a future run — this only affects which rows get inserted going
// forward, it never removes rows a narrower window already loaded.
const WINDOW_MONTHS = 12;

function isoDateMonthsAgo(months) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

// PPD dates arrive as "YYYY-MM-DD HH:MM" (always midnight in practice) —
// take just the date part, which also lets the cutoff comparison below be a
// plain ISO-string comparison instead of Date-object arithmetic.
function dateOnly(raw) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw || '');
  return m ? m[1] : null;
}

function normalisePostcode(raw) {
  if (!raw) return null;
  const s = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  return s || null;
}

function emptyToNull(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

function parsePrice(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function parseNewBuild(raw) {
  if (raw === 'Y') return true;
  if (raw === 'N') return false;
  return null;
}

// Rough proxy for on-disk size only (JSON byte length of the mapped
// fields) — real Postgres storage differs (row/page overhead, indexes,
// TOAST), but it moves in the same direction and is enough to eyeball
// progress against the Supabase free-tier cap.
function estimateBytes(row) {
  return Buffer.byteLength(JSON.stringify(row));
}

async function upsertBatch(supabase, rows) {
  if (rows.length === 0) return { count: 0, error: null };
  const { error } = await supabase.from('sold_prices').upsert(rows, { onConflict: 'transaction_id' });
  return { count: rows.length, error };
}

function processFile(filePath, supabase, stats, cutoffDate) {
  return new Promise((resolve, reject) => {
    const parser = fs.createReadStream(filePath).pipe(
      parse({ columns: false, skip_empty_lines: true, relax_column_count: true })
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
            const mb = (stats.estimatedBytes / (1024 * 1024)).toFixed(1);
            console.log(
              `  ... ${stats.seen.toLocaleString()} rows read, ${stats.inserted.toLocaleString()} upserted, ~${mb} MB estimated`
            );
          }
        });
      return chain;
    };

    parser.on('data', (row) => {
      stats.seen++;

      const transactionId = emptyToNull(row[0]);
      const price = parsePrice(row[1]);
      const date = dateOnly(row[2]);
      const postcode = normalisePostcode(row[3]);

      if (!transactionId || price === null || !date || !postcode) {
        stats.skippedMalformed++;
        return;
      }

      if (date < cutoffDate) {
        stats.skippedOutOfWindow++;
        return;
      }

      const mapped = {
        transaction_id: transactionId,
        price,
        date,
        postcode,
        property_type: emptyToNull(row[4]),
        new_build: parseNewBuild(row[5]),
        tenure: emptyToNull(row[6]),
        paon: emptyToNull(row[7]),
        saon: emptyToNull(row[8]),
        street: emptyToNull(row[9]),
        town: emptyToNull(row[11])
      };

      stats.estimatedBytes += estimateBytes(mapped);
      batch.push(mapped);

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
    console.error('Usage: node scripts/ingest-sold-prices.js <path-to-yearly-csv>');
    process.exit(1);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY in .env');
    process.exit(1);
  }

  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    console.error(`Not a file: ${resolved}`);
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  const cutoffDate = isoDateMonthsAgo(WINDOW_MONTHS);

  const stats = {
    seen: 0,
    inserted: 0,
    skippedMalformed: 0,
    skippedOutOfWindow: 0,
    estimatedBytes: 0,
    batches: 0,
    batchErrors: 0
  };
  const startedAt = Date.now();

  console.log(`Processing ${path.basename(resolved)}...`);
  console.log(`Window: last ${WINDOW_MONTHS} month(s), i.e. transfers on/after ${cutoffDate}`);
  await processFile(resolved, supabase, stats, cutoffDate);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const mb = (stats.estimatedBytes / (1024 * 1024)).toFixed(1);
  console.log('');
  console.log('Done.');
  console.log(`  Rows read:            ${stats.seen.toLocaleString()}`);
  console.log(`  Rows upserted:        ${stats.inserted.toLocaleString()}`);
  console.log(`  Skipped (malformed):  ${stats.skippedMalformed.toLocaleString()}`);
  console.log(`  Skipped (out of ${WINDOW_MONTHS}mo window): ${stats.skippedOutOfWindow.toLocaleString()}`);
  console.log(`  Estimated size added: ~${mb} MB (rough proxy, not exact Postgres storage)`);
  console.log(`  Failed batches:       ${stats.batchErrors}`);
  console.log(`  Time:                 ${elapsed}s`);
  if (stats.batchErrors > 0) {
    console.log('');
    console.log('Some batches failed — safe to just re-run this script (upserts are keyed on transaction_id).');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('Ingest failed:', e);
  process.exit(1);
});
