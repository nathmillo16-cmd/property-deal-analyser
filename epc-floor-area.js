// Looks up EPC floor area (square metres) for comps' house numbers, via the
// gov.uk Energy Certificate Data API (get-energy-performance-data.communities.gov.uk),
// and caches every result (including "no match found") permanently in the
// epc_floor_area_cache table (see db/004_epc_floor_area_cache.sql), since
// floor areas don't change once an EPC is registered.
//
// API contract confirmed against the live docs (not assumed):
//   - Auth: "Authorization: Bearer <token>" (get-energy-performance-data.
//     communities.gov.uk/api-technical-documentation/making-a-request).
//     NOT Basic auth with an email:key pair — that was the old, now-retired
//     epc.opendatacommunities.org API. Needs a bearer token from the new
//     service's account page in .env under EPC_API_KEY (that variable name
//     is a holdover from the old API's email+key credential, but it's now
//     holding the new service's bearer token instead).
//   - GET /api/domestic/search?postcode=... returns certificateNumber,
//     addressLine1-4, postcode, uprn, etc. — no floor area.
//   - GET /api/certificate?certificate_number=... returns the full
//     certificate, including a top-level total_floor_area field (verified
//     against the RdSAP-Schema-20.0.0 sample fixture in
//     communitiesuk/epb-data-warehouse on GitHub, since the docs page's own
//     example response was truncated).
//   - Rate limit: 6000 requests / 5 minutes per IP; 429 on breach.
//
// One /api/domestic/search call per postcode (not per comp), cached results
// reused across comps in the same postcode within a call. Matching is exact
// house-number-only, no fuzzy matching: the leading number (+ optional
// letter, e.g. "12A") is extracted from both the comp's paon and the EPC
// record's address lines, and compared as an exact string. Lines starting
// "Flat"/"Apartment"/"Unit" are skipped when looking for the EPC house
// number, since that number belongs to the sub-unit, not the building.
//
// Creates its own service-role Supabase client (like scripts/ingest-*.js),
// separate from whatever client getComps() was called with, because caching
// requires writes and epc_floor_area_cache's RLS only allows public SELECT.
//
// Usage:
//   const { enrichCompsWithFloorArea } = require('./epc-floor-area');
//   await enrichCompsWithFloorArea([{ comp, postcode, paon }, ...]);
//   // mutates each `comp` in place, adding floorAreaSqM, pricePerSqM,
//   // floorAreaMatched

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const EPC_BASE_URL = 'https://api.get-energy-performance-data.communities.gov.uk';
const MIN_DELAY_MS = 150; // spread calls out well under the 6000/5min limit
const MAX_RETRIES = 5;

class EpcLookupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'EpcLookupError';
    this.code = code;
  }
}

function supabaseAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    throw new EpcLookupError('Missing SUPABASE_URL / SUPABASE_SECRET_KEY in .env', 'missing_config');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Leading whole-word number (+ optional single letter suffix), e.g.
// "12", "12A" out of "12 Example Street". Returns null if the string
// doesn't start with one (named properties, "Flat 2", etc.).
function extractHouseNumber(str) {
  if (!str) return null;
  const trimmed = String(str).trim();
  if (/^(flat|apartment|apt|unit)\b/i.test(trimmed)) return null;
  const m = /^(\d+[A-Za-z]?)\b/.exec(trimmed);
  return m ? m[1].toUpperCase() : null;
}

function extractEpcHouseNumber(record) {
  for (const line of [record.addressLine1, record.addressLine2, record.addressLine3, record.addressLine4]) {
    const n = extractHouseNumber(line);
    if (n) return n;
  }
  return null;
}

async function epcFetch(path, token) {
  let attempt = 0;
  for (;;) {
    await sleep(MIN_DELAY_MS);
    const res = await fetch(`${EPC_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    if (res.status === 429) {
      attempt++;
      if (attempt > MAX_RETRIES) {
        throw new EpcLookupError(`Rate limited after ${MAX_RETRIES} retries: ${path}`, 'rate_limited');
      }
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterMs = Number.isFinite(parseInt(retryAfterHeader, 10)) ? parseInt(retryAfterHeader, 10) * 1000 : null;
      await sleep(retryAfterMs ?? MIN_DELAY_MS * 2 ** attempt);
      continue;
    }
    return res;
  }
}

async function searchDomesticByPostcode(postcode, token) {
  const results = [];
  let currentPage = 1;
  for (;;) {
    const url = `/api/domestic/search?postcode=${encodeURIComponent(postcode)}&current_page=${currentPage}&page_size=5000`;
    const res = await epcFetch(url, token);
    if (res.status === 404) return results;
    if (!res.ok) {
      const body = await res.text();
      throw new EpcLookupError(`EPC search failed for ${postcode}: ${res.status} ${body}`, 'search_failed');
    }
    const body = await res.json();
    results.push(...((body.data) || []));
    const pagination = body.pagination;
    if (!pagination || !pagination.nextPage) break;
    currentPage = pagination.nextPage;
  }
  return results;
}

async function fetchCertificateFloorArea(certificateNumber, token) {
  const res = await epcFetch(`/api/certificate?certificate_number=${encodeURIComponent(certificateNumber)}`, token);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new EpcLookupError(`EPC certificate fetch failed for ${certificateNumber}: ${res.status} ${body}`, 'certificate_failed');
  }
  const body = await res.json();
  const floorArea = Number(body.data && body.data.total_floor_area);
  return Number.isFinite(floorArea) ? floorArea : null;
}

function roundPricePerSqM(price, floorAreaSqM) {
  if (!Number.isFinite(price) || !Number.isFinite(floorAreaSqM) || floorAreaSqM <= 0) return null;
  return Math.round(price / floorAreaSqM);
}

// items: [{ comp, postcode, paon }] — comp is mutated in place with
// floorAreaSqM, pricePerSqM, floorAreaMatched.
async function enrichCompsWithFloorArea(items) {
  if (!items || items.length === 0) return;

  const token = process.env.EPC_API_KEY;
  if (!token) {
    throw new EpcLookupError('Missing EPC_API_KEY in .env', 'missing_config');
  }

  const admin = supabaseAdmin();

  const byPostcode = new Map();
  for (const item of items) {
    const houseNumber = extractHouseNumber(item.paon);
    item.houseNumber = houseNumber;
    if (!houseNumber) {
      item.comp.floorAreaSqM = null;
      item.comp.pricePerSqM = null;
      item.comp.floorAreaMatched = false;
      continue;
    }
    if (!byPostcode.has(item.postcode)) byPostcode.set(item.postcode, []);
    byPostcode.get(item.postcode).push(item);
  }

  for (const [postcode, postcodeItems] of byPostcode) {
    const houseNumbers = [...new Set(postcodeItems.map((i) => i.houseNumber))];

    const { data: cachedRows, error: cacheError } = await admin
      .from('epc_floor_area_cache')
      .select('house_number, floor_area_sqm')
      .eq('postcode', postcode)
      .in('house_number', houseNumbers);

    if (cacheError) {
      throw new EpcLookupError(`Cache lookup failed for ${postcode}: ${cacheError.message}`, 'cache_lookup_failed');
    }

    const resolved = new Map(); // houseNumber -> floorAreaSqM | null
    for (const row of cachedRows || []) {
      resolved.set(row.house_number, row.floor_area_sqm === null ? null : Number(row.floor_area_sqm));
    }

    const missingHouseNumbers = houseNumbers.filter((hn) => !resolved.has(hn));

    if (missingHouseNumbers.length > 0) {
      const searchResults = await searchDomesticByPostcode(postcode, token);

      const byHouseNumber = new Map(); // houseNumber -> certificateNumber, uprn (first match wins)
      for (const record of searchResults) {
        const hn = extractEpcHouseNumber(record);
        if (hn && !byHouseNumber.has(hn)) {
          byHouseNumber.set(hn, { certificateNumber: record.certificateNumber, uprn: record.uprn ?? null });
        }
      }

      const newCacheRows = [];
      for (const houseNumber of missingHouseNumbers) {
        const match = byHouseNumber.get(houseNumber);
        if (!match) {
          resolved.set(houseNumber, null);
          newCacheRows.push({ postcode, house_number: houseNumber, uprn: null, floor_area_sqm: null, certificate_number: null });
          continue;
        }
        const floorAreaSqM = await fetchCertificateFloorArea(match.certificateNumber, token);
        resolved.set(houseNumber, floorAreaSqM);
        newCacheRows.push({
          postcode,
          house_number: houseNumber,
          uprn: match.uprn,
          floor_area_sqm: floorAreaSqM,
          certificate_number: match.certificateNumber,
        });
      }

      const { error: upsertError } = await admin
        .from('epc_floor_area_cache')
        .upsert(newCacheRows, { onConflict: 'postcode,house_number' });
      if (upsertError) {
        throw new EpcLookupError(`Cache write failed for ${postcode}: ${upsertError.message}`, 'cache_write_failed');
      }
    }

    for (const item of postcodeItems) {
      const floorAreaSqM = resolved.get(item.houseNumber) ?? null;
      item.comp.floorAreaSqM = floorAreaSqM;
      item.comp.pricePerSqM = roundPricePerSqM(item.comp.price, floorAreaSqM);
      item.comp.floorAreaMatched = floorAreaSqM !== null;
    }
  }
}

module.exports = { enrichCompsWithFloorArea, EpcLookupError, extractHouseNumber, extractEpcHouseNumber };
