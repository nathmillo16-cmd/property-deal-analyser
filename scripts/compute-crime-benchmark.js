// Stage 2 of the crime-rate feature: computes the national MSOA crime-rate
// benchmark from the Police UK bulk data archive, entirely locally, and
// writes only the small per-MSOA summary to Supabase. No individual crime
// record is stored anywhere — the raw archive is read, counted, and
// discarded in memory.
//
// PREREQUISITES:
//   - db/013_msoa_population.sql and db/014_msoa_crime_rate.sql both run.
//   - msoa_population already loaded (scripts/ingest-msoa-population.js).
//
// INPUT 1: a Police UK bulk data archive folder (data.police.uk/data,
// "Custom download") containing one subfolder per month (e.g. 2023-07,
// 2023-08, ..., 2026-06), each holding <month>-<force>-street.csv /
// -outcomes.csv / -stop-and-search.csv per force. This script uses ONLY
// the LATEST month subfolder (by YYYY-MM name, auto-detected — not
// hardcoded, so this stays correct on next month's re-run) and ONLY the
// *-street.csv files in it; -outcomes.csv and -stop-and-search.csv are
// ignored, as are every other month.
//
// LSOA codes in the street files are 2021 boundaries (confirmed directly
// against the archive: cross-referenced boundary-changed LSOAs, the only
// ones that can discriminate 2011 vs 2021, against ONSPD's lsoa11cd/
// lsoa21cd columns — 0 matched only the 2011 code, every discriminating
// match was 2021-only). msoa_population and postcodes.io both use 2021
// codes too, so no LSOA11->LSOA21 remapping step is needed.
//
// INPUT 2: the ONSPD CSV (same file used elsewhere in this project for
// postcode geocoding, e.g. scripts/ingest-postcodes.js) — used here only to
// derive the LSOA21 -> MSOA21 lookup (its lsoa21cd/msoa21cd columns),
// rather than fetching a separate ONS LSOA-to-MSOA lookup file. Verified
// clean before writing this script: every one of the ~44k distinct LSOA21
// codes in the file maps to exactly one MSOA21, no exceptions.
//
// PROCESSING (all in-memory, nothing intermediate written to disk or DB):
//   1. Count crimes per LSOA code across every *-street.csv in the latest
//      month. Blank "LSOA code" rows are skipped and counted (Police
//      Service of Northern Ireland's file is 100% blank LSOA — no
//      Scottish force is in the archive at all — both are simply excluded
//      by this same rule, nothing special-cased).
//   2. Roll LSOA counts up to MSOA via the ONSPD-derived lookup. An LSOA
//      count with no MSOA mapping is skipped and counted (shouldn't happen
//      for real England/Wales LSOA21 codes, but logged rather than
//      silently dropped in case a code is malformed).
//   3. Start from EVERY row in msoa_population (not just MSOAs that had a
//      recorded crime) and default missing crime counts to 0. This is
//      deliberate: an inner join (only MSOAs with >=1 crime) would exclude
//      genuinely low-crime MSOAs from the benchmark entirely, which would
//      bias the percentile thresholds by computing "low" only from areas
//      that had *some* crime rather than the true safest areas.
//   4. rate_per_1000 = crime_count / population * 1000, for every MSOA
//      with population > 0.
//   5. low_threshold/high_threshold = 40th/80th percentile of
//      rate_per_1000 across every computed MSOA (linear-interpolation
//      percentile, same method get-comps.js already uses for its own
//      percentile figures). band = 'low' at/below the 40th percentile
//      (the least-crime 40%), 'medium' between, 'high' above the 80th
//      percentile (the worst 20%).
//
// STORE: upserts msoa_crime_rate (keyed on msoa_code) and the single
// crime_benchmark_meta row (keyed on id=1) — see db/014_msoa_crime_rate.sql.
//
// Usage:
//   node scripts/compute-crime-benchmark.js <path-to-police-archive-root> <path-to-onspd-csv>
//   e.g. node scripts/compute-crime-benchmark.js ~/Downloads/2026-06 ~/Downloads/ONSPD_MAY_2026/Data/ONSPD_MAY_2026_UK.csv
//
// Requires SUPABASE_URL and SUPABASE_SECRET_KEY (service role) in .env —
// both tables' RLS policies only grant SELECT to normal roles.
//
// Safe to re-run: both tables are upserted by their primary key, so
// re-running (e.g. against next month's archive) just recomputes and
// overwrites the benchmark, never duplicates or accumulates.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse: parseSync } = require('csv-parse/sync');
const { parse: parseStream } = require('csv-parse');
const { createClient } = require('@supabase/supabase-js');

const MONTH_DIR_PATTERN = /^\d{4}-\d{2}$/;
const STREET_FILE_SUFFIX = '-street.csv';
const PAGE_SIZE = 1000; // PostgREST's per-request cap
const BATCH_SIZE = 1000;
const LOW_PERCENTILE = 0.4;
const HIGH_PERCENTILE = 0.8;

// Same linear-interpolation percentile (R type 7 / NumPy default) already
// used in get-comps.js, duplicated here rather than imported — this is a
// standalone one-off script, not part of the live app's require graph.
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

function findLatestMonthDir(archiveRoot) {
  const entries = fs.readdirSync(archiveRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && MONTH_DIR_PATTERN.test(e.name))
    .map((e) => e.name);
  if (entries.length === 0) {
    throw new Error(`No YYYY-MM month subfolders found in ${archiveRoot}`);
  }
  entries.sort(); // YYYY-MM strings sort correctly lexicographically
  return entries[entries.length - 1];
}

// Counts crimes per LSOA code across every *-street.csv in monthDir. Never
// stores an individual crime row — each parsed record contributes to a
// running count and is then discarded.
function countCrimesByLsoa(monthDir) {
  const counts = new Map();
  let skippedBlankLsoa = 0;
  let rowsSeen = 0;

  const streetFiles = fs.readdirSync(monthDir).filter((f) => f.endsWith(STREET_FILE_SUFFIX));
  if (streetFiles.length === 0) {
    throw new Error(`No ${STREET_FILE_SUFFIX} files found in ${monthDir}`);
  }

  // Street files are individually small (largest observed: 21MB, ~96k
  // rows) so reading each one fully into memory is fine — unlike ONSPD
  // below, which cannot be read this way.
  for (const file of streetFiles) {
    const content = fs.readFileSync(path.join(monthDir, file), 'utf8');
    const records = parseSync(content, { columns: true, skip_empty_lines: true, relax_column_count: true });
    for (const record of records) {
      rowsSeen++;
      const lsoa = (record['LSOA code'] || '').trim();
      if (!lsoa) {
        skippedBlankLsoa++;
        continue;
      }
      counts.set(lsoa, (counts.get(lsoa) || 0) + 1);
    }
  }

  return { counts, rowsSeen, skippedBlankLsoa, streetFileCount: streetFiles.length };
}

// Derives the lsoa21cd -> msoa21cd lookup from the ONSPD file already used
// elsewhere in this project for postcode geocoding. Verified clean before
// writing this script (every LSOA21 maps to exactly one MSOA21).
//
// ONSPD is ~1.4GB — far too large to read into a single JS string
// (Node's string length ceiling is ~536MB), so unlike the street files
// above this must be streamed, same pattern scripts/ingest-postcodes.js
// already uses for this exact file elsewhere in the project. The stream
// itself is discarded as it's consumed; only the small resulting Map
// (~44k entries) is kept.
function buildLsoaToMsoaLookup(onspdPath) {
  return new Promise((resolve, reject) => {
    const lookup = new Map();
    const parser = fs.createReadStream(onspdPath).pipe(
      parseStream({ columns: true, skip_empty_lines: true, relax_column_count: true })
    );
    parser.on('data', (record) => {
      const lsoa = record.lsoa21cd;
      const msoa = record.msoa21cd;
      if (lsoa && msoa) lookup.set(lsoa, msoa);
    });
    parser.on('end', () => resolve(lookup));
    parser.on('error', reject);
  });
}

function rollUpToMsoa(lsoaCounts, lsoaToMsoa) {
  const msoaCounts = new Map();
  let unmappedLsoaCount = 0;
  let unmappedCrimeCount = 0;

  for (const [lsoa, count] of lsoaCounts) {
    const msoa = lsoaToMsoa.get(lsoa);
    if (!msoa) {
      unmappedLsoaCount++;
      unmappedCrimeCount += count;
      continue;
    }
    msoaCounts.set(msoa, (msoaCounts.get(msoa) || 0) + count);
  }

  return { msoaCounts, unmappedLsoaCount, unmappedCrimeCount };
}

async function fetchAllPopulation(supabase) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('msoa_population')
      .select('msoa_code, population')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Fetching msoa_population failed at offset ${from}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function upsertBatches(supabase, table, rows, onConflict) {
  let loaded = 0;
  let batchErrors = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) {
      batchErrors++;
      console.error(`  ! ${table} batch upsert failed (${batch.length} rows): ${error.message}`);
    } else {
      loaded += batch.length;
    }
  }
  return { loaded, batchErrors };
}

async function main() {
  const archiveRoot = process.argv[2];
  const onspdPath = process.argv[3];
  if (!archiveRoot || !onspdPath) {
    console.error('Usage: node scripts/compute-crime-benchmark.js <path-to-police-archive-root> <path-to-onspd-csv>');
    process.exit(1);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY in .env');
    process.exit(1);
  }

  const resolvedArchiveRoot = path.resolve(archiveRoot);
  const resolvedOnspdPath = path.resolve(onspdPath);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  const latestMonth = findLatestMonthDir(resolvedArchiveRoot);
  const monthDir = path.join(resolvedArchiveRoot, latestMonth);
  console.log(`Latest month found: ${latestMonth} (${monthDir})`);

  console.log('Counting crimes per LSOA from *-street.csv files...');
  const { counts: lsoaCounts, rowsSeen, skippedBlankLsoa, streetFileCount } = countCrimesByLsoa(monthDir);
  console.log(`  ${streetFileCount} street file(s), ${rowsSeen.toLocaleString()} row(s) read, ${skippedBlankLsoa.toLocaleString()} skipped (blank LSOA), ${lsoaCounts.size.toLocaleString()} distinct LSOA(s) with crimes`);

  console.log('Building LSOA21 -> MSOA21 lookup from ONSPD...');
  const lsoaToMsoa = await buildLsoaToMsoaLookup(resolvedOnspdPath);
  console.log(`  ${lsoaToMsoa.size.toLocaleString()} LSOA21 codes mapped`);

  console.log('Rolling up LSOA crime counts to MSOA...');
  const { msoaCounts, unmappedLsoaCount, unmappedCrimeCount } = rollUpToMsoa(lsoaCounts, lsoaToMsoa);
  console.log(`  ${msoaCounts.size.toLocaleString()} distinct MSOA(s) with crimes, ${unmappedLsoaCount.toLocaleString()} LSOA(s) (${unmappedCrimeCount.toLocaleString()} crimes) had no MSOA mapping`);

  console.log('Fetching msoa_population...');
  const population = await fetchAllPopulation(supabase);
  console.log(`  ${population.length.toLocaleString()} MSOA(s) in msoa_population`);

  // Every populated MSOA is included, defaulting to 0 crimes if none were
  // recorded this month — see file header for why this isn't an inner join.
  const joined = [];
  for (const { msoa_code, population: pop } of population) {
    if (!pop || pop <= 0) continue;
    const crimeCount = msoaCounts.get(msoa_code) || 0;
    joined.push({ msoa_code, crime_count: crimeCount, population: pop, rate_per_1000: (crimeCount / pop) * 1000 });
  }
  console.log(`  ${joined.length.toLocaleString()} MSOA(s) joined (population > 0)`);

  const sortedRates = joined.map((r) => r.rate_per_1000).sort((a, b) => a - b);
  const lowThreshold = percentile(sortedRates, LOW_PERCENTILE);
  const highThreshold = percentile(sortedRates, HIGH_PERCENTILE);
  console.log(`  Thresholds: low<=${lowThreshold.toFixed(3)} (40th pct), high>${highThreshold.toFixed(3)} (80th pct)`);

  const bandCounts = { low: 0, medium: 0, high: 0 };
  const crimeRateRows = joined.map((r) => {
    const band = r.rate_per_1000 <= lowThreshold ? 'low' : r.rate_per_1000 <= highThreshold ? 'medium' : 'high';
    bandCounts[band]++;
    return { ...r, band };
  });
  console.log(`  Bands: low=${bandCounts.low.toLocaleString()}, medium=${bandCounts.medium.toLocaleString()}, high=${bandCounts.high.toLocaleString()}`);

  console.log('Upserting msoa_crime_rate...');
  const { loaded, batchErrors } = await upsertBatches(supabase, 'msoa_crime_rate', crimeRateRows, 'msoa_code');
  console.log(`  ${loaded.toLocaleString()} row(s) upserted, ${batchErrors} failed batch(es)`);

  console.log('Upserting crime_benchmark_meta...');
  const { error: metaError } = await supabase.from('crime_benchmark_meta').upsert(
    { id: 1, data_month: latestMonth, low_threshold: lowThreshold, high_threshold: highThreshold, computed_at: new Date().toISOString() },
    { onConflict: 'id' }
  );
  if (metaError) console.error(`  ! crime_benchmark_meta upsert failed: ${metaError.message}`);
  else console.log('  done');

  console.log('');
  console.log('Done.');
  console.log(`  Data month:          ${latestMonth}`);
  console.log(`  MSOAs in benchmark:  ${joined.length.toLocaleString()}`);
  console.log(`  Low/high thresholds: ${lowThreshold.toFixed(3)} / ${highThreshold.toFixed(3)} crimes per 1,000 residents`);
  if (batchErrors > 0 || metaError) {
    console.log('');
    console.log('Some writes failed — safe to just re-run this script (everything is upserted by primary key).');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
