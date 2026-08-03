// Loads ONS mid-year MSOA (2021 boundaries) population estimates into the
// msoa_population table. Used by the crime-rate feature to turn Police UK's
// raw per-MSOA incident counts into a per-capita rate.
//
// Source: ONS mid-year population estimates, MSOA level (search "population
// estimates for lower and middle super output areas" on ons.gov.uk) — an
// .xlsx release covering England & Wales, ~7,000 MSOAs.
//
// Sheet/layout confirmed against the actual file this was written for:
// sheet name SHEET_NAME below, rows 1-3 are title/notes (not data), row 4
// is the header row, data starts row 5. Only CODE_COLUMN and
// POPULATION_COLUMN are read — every age/sex breakdown column in the sheet
// is ignored entirely.
//
// Uses the `xlsx` (SheetJS) package — already a project dependency. Note:
// npm's registry build of this package has a known high-severity CVE pair
// (prototype pollution, ReDoS) with no fix published to npm (SheetJS only
// ships patched builds via their own CDN now). Accepted deliberately for
// this project: this script only ever parses a trusted local file you
// download and run yourself, never untrusted/attacker-supplied input, so
// the realistic attack scenario those CVEs describe doesn't apply here.
//
// Usage:
//   node scripts/ingest-msoa-population.js <path-to-xlsx>
//
// Requires SUPABASE_URL and SUPABASE_SECRET_KEY (service role) in .env —
// msoa_population's RLS policy only grants SELECT to normal roles.
//
// Safe to re-run: upserts are keyed on msoa_code, so re-running (e.g. after
// a failed batch, or over a newer mid-year release) just overwrites rows.

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SHEET_NAME = 'Mid-2024 MSOA 2021';
const HEADER_ROW = 4; // 1-indexed, as given
const CODE_COLUMN = 'MSOA 2021 Code';
const POPULATION_COLUMN = 'Total';
const BATCH_SIZE = 1000;

// Empty ONS cells come through from SheetJS as '' (not null/undefined), and
// Number('') is 0 — which passes Number.isFinite — so '' must be rejected
// explicitly before the numeric conversion, or a genuinely blank population
// cell would silently become population: 0 instead of being skipped.
// Confirmed against a real parsed sheet before writing this, not assumed.
function parsePopulation(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

function readDataRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found. Sheets in this file: ${workbook.SheetNames.join(', ')}`);
  }
  // range as a 0-indexed row number tells SheetJS which row to treat as the
  // header — HEADER_ROW is 1-indexed, so HEADER_ROW - 1 here. Rows above
  // that (the title/notes rows) are never parsed at all, not just skipped
  // after the fact. Confirmed against a synthetic file with the same
  // layout (junk rows 1-3, header row 4, data row 5+) before writing this.
  return XLSX.utils.sheet_to_json(sheet, { range: HEADER_ROW - 1, defval: null });
}

async function upsertBatch(supabase, rows) {
  if (rows.length === 0) return { count: 0, error: null };
  const { error } = await supabase.from('msoa_population').upsert(rows, { onConflict: 'msoa_code' });
  return { count: rows.length, error };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node scripts/ingest-msoa-population.js <path-to-xlsx>');
    process.exit(1);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY in .env');
    process.exit(1);
  }

  const resolved = path.resolve(inputPath);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  console.log(`Reading ${path.basename(resolved)}, sheet "${SHEET_NAME}"...`);
  const dataRows = readDataRows(resolved);
  console.log(`Found ${dataRows.length.toLocaleString()} data row(s) below the header.`);

  const stats = { seen: dataRows.length, loaded: 0, skipped: 0, batches: 0, batchErrors: 0 };
  let batch = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const { count, error } = await upsertBatch(supabase, batch);
    if (error) {
      stats.batchErrors++;
      console.error(`  ! batch upsert failed (${count} rows): ${error.message}`);
    } else {
      stats.loaded += count;
    }
    stats.batches++;
    batch = [];
  };

  for (const row of dataRows) {
    const code = row[CODE_COLUMN];
    const population = parsePopulation(row[POPULATION_COLUMN]);

    if (typeof code !== 'string' || !code.trim() || population === null) {
      stats.skipped++;
      continue;
    }

    batch.push({ msoa_code: code.trim(), population });

    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log('');
  console.log('Done.');
  console.log(`  Rows read:      ${stats.seen.toLocaleString()}`);
  console.log(`  Rows loaded:    ${stats.loaded.toLocaleString()}`);
  console.log(`  Rows skipped:   ${stats.skipped.toLocaleString()} (missing/blank MSOA code or Total)`);
  console.log(`  Batches:        ${stats.batches}`);
  console.log(`  Failed batches: ${stats.batchErrors}`);
  if (stats.batchErrors > 0) {
    console.log('');
    console.log('Some batches failed — safe to just re-run this script (upserts are keyed on msoa_code).');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('Ingest failed:', e);
  process.exit(1);
});
