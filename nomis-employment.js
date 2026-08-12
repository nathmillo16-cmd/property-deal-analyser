// Thin wrapper around the Nomis (ONS) RESTful API — free, public, no API key
// required for the queries used here. Two datasets, both real, live-verified
// against the actual API (not assumed) before this file was written:
//
//   NM_17_5 — "annual population survey (variables (percentages))". Used for
//   the headline employment rate. variable=45 is "Employment rate - aged
//   16-64" (confirmed against the dataset's own ~2000-entry variable
//   codelist). Quarterly. IMPORTANT: time=latest resolves to an unpublished,
//   empty period for this dataset — the two most recent quarters routinely
//   come back with obs_status "These figures are missing". Every query here
//   asks for a small window and picks the last entry with a real value,
//   never trusts "latest" directly.
//
//   NM_189_1 — "Business Register and Employment Survey : open access".
//   Used for the industry breakdown. The 18 broad SIC-2007 section codes
//   (163577857 through 163577874, below) do NOT appear in this dataset's
//   own enumerable industry codelist — they only exist as individually
//   queryable codes, found by direct probing against the live API. The
//   dataset's own built-in "Industry percentage" measure (measure=2)
//   returned empty in every live test; measure=1 (Count, value 20100) works
//   reliably, so percentages are computed here from raw counts instead of
//   trusted from Nomis. Annual, and lags further behind than the rate
//   dataset — 2 full years missing was observed in testing, not just one
//   quarter — so the same "walk back to the last real value" pattern
//   applies, just over years instead of quarters.
//
// Geography: Nomis uses its own internal numeric IDs, not ONS GSS codes
// directly. The mapping (GSS code -> Nomis id) is the same small, near-
// static ~317-row local-authority list for both datasets (confirmed
// identical live) — fetched once and cached in memory for the life of the
// process, not re-fetched per request.

const fetch = require('node-fetch');

const NOMIS_BASE = 'https://www.nomisweb.co.uk/api/v01';
const EMPLOYMENT_RATE_DATASET = 'NM_17_5';
const EMPLOYMENT_RATE_VARIABLE = 45; // "Employment rate - aged 16-64"
const INDUSTRY_DATASET = 'NM_189_1';
const INDUSTRY_EMPLOYMENT_STATUS = 4; // "Employment" (total, incl. self-employed)

// The 18 broad SIC 2007 sections, in Nomis's own order — codes confirmed by
// direct probing (see file header), labels copied verbatim from the live
// API response, not retyped from memory.
const INDUSTRY_SECTIONS = [
  { code: 163577857, label: 'Agriculture, forestry & fishing' },
  { code: 163577858, label: 'Mining, quarrying & utilities' },
  { code: 163577859, label: 'Manufacturing' },
  { code: 163577860, label: 'Construction' },
  { code: 163577861, label: 'Motor trades' },
  { code: 163577862, label: 'Wholesale' },
  { code: 163577863, label: 'Retail' },
  { code: 163577864, label: 'Transport & storage' },
  { code: 163577865, label: 'Accommodation & food services' },
  { code: 163577866, label: 'Information & communication' },
  { code: 163577867, label: 'Financial & insurance' },
  { code: 163577868, label: 'Property' },
  { code: 163577869, label: 'Professional, scientific & technical' },
  { code: 163577870, label: 'Business administration & support services' },
  { code: 163577871, label: 'Public administration & defence' },
  { code: 163577872, label: 'Education' },
  { code: 163577873, label: 'Health' },
  { code: 163577874, label: 'Arts, entertainment & recreation' },
];

// Cache of GSS code (e.g. "E07000172") -> Nomis internal geography id
// (e.g. 1820328044), populated on first use. The underlying list is local
// authority district/unitary boundaries as of April 2019 — it does not
// change during the life of a running process, so an in-memory cache with
// no expiry is deliberate, not an oversight. IMPORTANT: only a SUCCESSFUL
// load is kept cached — a rejected promise is still truthy, so without the
// .catch below, one failed fetch (an outage/timeout/blip) would look
// permanently "already tried" and silently disable employment data for
// every request thereafter, for the rest of the process's life, with no
// way to recover short of a server restart. The .catch clears the cache on
// failure so the next call retries fresh instead.
let ladGeographyCachePromise = null;

async function loadLadGeographyMap() {
  const res = await fetch(`${NOMIS_BASE}/dataset/${EMPLOYMENT_RATE_DATASET}/geography/2092957699TYPE434.def.sdmx.json`);
  if (!res.ok) throw new Error(`Nomis geography lookup returned HTTP ${res.status}`);
  const body = await res.json();
  const codes = body.structure.codelists.codelist[0].code;
  const map = new Map();
  codes.forEach((c) => {
    const gssAnnotation = c.annotations.annotation.find((a) => a.annotationtitle === 'GeogCode');
    if (gssAnnotation) map.set(gssAnnotation.annotationtext, c.value);
  });
  return map;
}

async function resolveLadGeographyId(gssCode) {
  if (!ladGeographyCachePromise) {
    ladGeographyCachePromise = loadLadGeographyMap().catch((e) => {
      ladGeographyCachePromise = null;
      throw e;
    });
  }
  const map = await ladGeographyCachePromise;
  return map.get(gssCode) || null;
}

// Returns the last (most recent) obs in a Nomis .data.json response that
// has a real, non-suppressed value — never trusts the newest entry blindly,
// per the file header note on time=latest.
function lastRealObs(obsArray) {
  for (let i = obsArray.length - 1; i >= 0; i--) {
    const o = obsArray[i];
    if (o.obs_value && o.obs_value.value !== '' && o.obs_value.value != null) return o;
  }
  return null;
}

async function getEmploymentRate(nomisGeographyId) {
  const url = `${NOMIS_BASE}/dataset/${EMPLOYMENT_RATE_DATASET}.data.json?geography=${nomisGeographyId}&variable=${EMPLOYMENT_RATE_VARIABLE}&measures=20599&time=latestMINUS8-latest`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nomis employment-rate query returned HTTP ${res.status}`);
  const body = await res.json();
  const obs = lastRealObs(body.obs || []);
  if (!obs) return null;
  return {
    rate: Number(obs.obs_value.value),
    periodLabel: obs.time.description,
  };
}

async function getIndustryBreakdown(nomisGeographyId) {
  const industryParam = INDUSTRY_SECTIONS.map((s) => s.code).join(',');
  const url = `${NOMIS_BASE}/dataset/${INDUSTRY_DATASET}.data.json?geography=${nomisGeographyId}&industry=${industryParam}&employment_status=${INDUSTRY_EMPLOYMENT_STATUS}&measure=1&measures=20100&time=latestMINUS6-latest`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nomis industry query returned HTTP ${res.status}`);
  const body = await res.json();
  const obsList = body.obs || [];

  // Group by year, pick the most recent year that has a real value for
  // every section (a year with even one suppressed section is skipped
  // rather than silently showing a partial, misleading total).
  const byYear = new Map();
  obsList.forEach((o) => {
    const year = o.time.value;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(o);
  });
  const years = [...byYear.keys()].sort((a, b) => a - b);
  for (let i = years.length - 1; i >= 0; i--) {
    const rows = byYear.get(years[i]);
    if (rows.length === INDUSTRY_SECTIONS.length && rows.every((o) => o.obs_value.value !== '' && o.obs_value.value != null)) {
      const counts = rows.map((o) => ({
        label: INDUSTRY_SECTIONS.find((s) => s.code === o.industry.value).label,
        count: Number(o.obs_value.value),
      }));
      const total = counts.reduce((sum, c) => sum + c.count, 0);
      if (total <= 0) continue;
      const industries = counts
        .map((c) => ({ label: c.label, pct: (c.count / total) * 100 }))
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 5);
      return { industries, year: years[i] };
    }
  }
  return null;
}

// Combined lookup for a single local authority — degrades to
// { available: false } on any failure (unresolvable geography, Nomis
// unreachable, or both underlying queries coming back empty) rather than
// throwing, so a Comps search never breaks because of this feature.
async function getEmploymentData(gssCode) {
  const nomisGeographyId = await resolveLadGeographyId(gssCode);
  if (!nomisGeographyId) return { available: false };

  const [rateResult, industryResult] = await Promise.allSettled([
    getEmploymentRate(nomisGeographyId),
    getIndustryBreakdown(nomisGeographyId),
  ]);

  const rate = rateResult.status === 'fulfilled' ? rateResult.value : null;
  const industry = industryResult.status === 'fulfilled' ? industryResult.value : null;
  if (!rate && !industry) return { available: false };

  return {
    available: true,
    rate: rate ? { value: rate.rate, periodLabel: rate.periodLabel } : null,
    industries: industry ? industry.industries : null,
    industryYear: industry ? industry.year : null,
  };
}

module.exports = { getEmploymentData };
