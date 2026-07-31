// Thin wrapper around postcodes.io (api.postcodes.io) — free, public, no API
// key. Resolves postcodes live instead of via a `postcodes` table (dropped
// from the schema — sold_prices carries its own lat/lng instead). Used by
// get-comps.js (subject postcode resolution) and
// scripts/backfill-sold-prices-lat-lng.js (bulk lookup).
//
// API contract confirmed against the live API directly (not assumed):
//   - GET /postcodes/{postcode} — postcode can be passed with or without a
//     space, any case (postcodes.io normalises it). On a match: HTTP 200,
//     body `{ status: 200, result: { ..., latitude, longitude, ... } }`.
//     On no match: a REAL HTTP 404, body `{ status: 404, error: "Invalid
//     postcode" }` — the HTTP status and the body's own `status` field
//     agree, so either can be checked.
//   - POST /postcodes, body `{ "postcodes": [...] }`, up to 100 per call
//     (the caller is responsible for chunking a larger list — this
//     function makes exactly one HTTP call per invocation). Always HTTP
//     200, even when some/all entries don't match. Body:
//     `{ status: 200, result: [ { query: "<as sent>", result: {...}|null },
//     ... ] }` — order matches the input array, `result` is null for any
//     postcode postcodes.io doesn't recognise (terminated, malformed,
//     etc.), never an error for that entry.
//
// PostcodeLookupError is defined here — server.js imports it from this
// file for its /api/comps error handling (400 vs 502 based on .code).

const fetch = require('node-fetch');

const BASE_URL = 'https://api.postcodes.io';
const BULK_MAX = 100; // postcodes.io's documented cap per bulk request

class PostcodeLookupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PostcodeLookupError';
    this.code = code;
  }
}

// Single lookup — used to resolve the SUBJECT postcode in the live comps
// path. Returns { lat, lng }. Throws PostcodeLookupError:
//   'invalid_postcode'        — empty/non-string input, never even called out
//   'postcode_not_found'      — postcodes.io's real 404 for this postcode
//   'postcodes_io_unreachable' — network failure or an unexpected response,
//                                deliberately NOT in server.js's 400 code
//                                list, so it falls through to the existing
//                                502 catch-all with no server.js changes
async function lookupPostcode(postcode) {
  if (typeof postcode !== 'string' || !postcode.trim()) {
    throw new PostcodeLookupError(`Invalid postcode: ${JSON.stringify(postcode)}`, 'invalid_postcode');
  }
  const clean = postcode.trim();

  let res;
  try {
    res = await fetch(`${BASE_URL}/postcodes/${encodeURIComponent(clean)}`);
  } catch (e) {
    throw new PostcodeLookupError(`postcodes.io unreachable: ${e.message}`, 'postcodes_io_unreachable');
  }

  if (res.status === 404) {
    throw new PostcodeLookupError(`Postcode not found: ${clean}`, 'postcode_not_found');
  }
  if (!res.ok) {
    throw new PostcodeLookupError(`postcodes.io returned HTTP ${res.status} for ${clean}`, 'postcodes_io_unreachable');
  }

  let body;
  try {
    body = await res.json();
  } catch (e) {
    throw new PostcodeLookupError(`postcodes.io returned an unparseable response for ${clean}: ${e.message}`, 'postcodes_io_unreachable');
  }

  const lat = body && body.result ? body.result.latitude : null;
  const lng = body && body.result ? body.result.longitude : null;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new PostcodeLookupError(`postcodes.io returned no coordinates for ${clean}`, 'postcode_not_found');
  }

  return { lat, lng };
}

// Bulk lookup — used only by the backfill script. One HTTP call, up to
// BULK_MAX postcodes; the caller chunks a larger list and is responsible
// for pacing calls (this function has no delay/retry logic of its own).
// Returns [{ query, lat, lng }] in input order — lat/lng are null for any
// postcode postcodes.io didn't match, never throws for that case (only for
// a failure of the request itself).
async function bulkLookupPostcodes(postcodes) {
  if (!Array.isArray(postcodes) || postcodes.length === 0) return [];
  if (postcodes.length > BULK_MAX) {
    throw new PostcodeLookupError(
      `bulkLookupPostcodes accepts at most ${BULK_MAX} postcodes per call, got ${postcodes.length}`,
      'bulk_batch_too_large'
    );
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}/postcodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postcodes }),
    });
  } catch (e) {
    throw new PostcodeLookupError(`postcodes.io unreachable: ${e.message}`, 'postcodes_io_unreachable');
  }

  if (!res.ok) {
    throw new PostcodeLookupError(`postcodes.io bulk lookup returned HTTP ${res.status}`, 'postcodes_io_unreachable');
  }

  let body;
  try {
    body = await res.json();
  } catch (e) {
    throw new PostcodeLookupError(`postcodes.io bulk lookup returned an unparseable response: ${e.message}`, 'postcodes_io_unreachable');
  }

  if (!body || !Array.isArray(body.result)) {
    throw new PostcodeLookupError('postcodes.io bulk lookup returned an unexpected response shape', 'postcodes_io_unreachable');
  }

  return body.result.map((entry) => ({
    query: entry.query,
    lat: entry.result ? entry.result.latitude : null,
    lng: entry.result ? entry.result.longitude : null,
  }));
}

module.exports = { lookupPostcode, bulkLookupPostcodes, PostcodeLookupError, BULK_MAX };
