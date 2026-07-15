// Given a UK postcode and a radius in miles, returns every row in the
// `postcodes` table within that radius, using a lat/lng bounding-box
// pre-filter so the exact (but pricier) haversine distance only has to run
// over a small candidate set rather than scanning all ~2.7M rows.
//
// Does not create its own Supabase client — pass one in (e.g. the request-
// scoped client server.js builds via supabaseForRequest, or an anon-key
// client), since `postcodes` is publicly readable under RLS either way.
//
// Usage:
//   const { nearbyPostcodes } = require('./nearby-postcodes');
//   const results = await nearbyPostcodes(supabase, 'SW1A 1AA', 2);
//   // -> [{ postcode, lat, lng, distanceMiles }, ...] sorted nearest-first

const EARTH_RADIUS_MILES = 3958.8;
const PAGE_SIZE = 1000; // PostgREST's default row cap per request; paginate past it

class PostcodeLookupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PostcodeLookupError';
    this.code = code;
  }
}

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

// Same normalisation as scripts/ingest-postcodes.js, so a lookup here
// matches whatever format the postcode was stored under.
function normalisePostcode(raw) {
  if (!raw) return null;
  const s = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  return s || null;
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

async function nearbyPostcodes(supabase, postcode, radiusMiles) {
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) {
    throw new PostcodeLookupError(`radiusMiles must be a positive number, got ${radiusMiles}`, 'invalid_radius');
  }

  const subject = normalisePostcode(postcode);
  if (!subject) {
    throw new PostcodeLookupError(`Invalid postcode: ${JSON.stringify(postcode)}`, 'invalid_postcode');
  }

  const { data: subjectRow, error: subjectError } = await supabase
    .from('postcodes')
    .select('postcode, lat, lng')
    .eq('postcode', subject)
    .maybeSingle();

  if (subjectError) {
    throw new PostcodeLookupError(`Lookup failed for ${subject}: ${subjectError.message}`, 'lookup_failed');
  }
  if (!subjectRow) {
    throw new PostcodeLookupError(`Postcode not found: ${subject}`, 'postcode_not_found');
  }
  if (subjectRow.lat === null || subjectRow.lng === null) {
    throw new PostcodeLookupError(`Postcode has no coordinates on file: ${subject}`, 'postcode_no_coordinates');
  }

  const { lat: subjectLat, lng: subjectLng } = subjectRow;

  // Bounding box in degrees, sized generously enough to fully contain the
  // radius circle. 1 degree of longitude covers fewer miles the further
  // from the equator you are, hence the cos(lat) term.
  const milesPerDegreeLat = (EARTH_RADIUS_MILES * Math.PI) / 180; // ~69.09
  const deltaLat = radiusMiles / milesPerDegreeLat;
  const milesPerDegreeLng = milesPerDegreeLat * Math.max(Math.cos(toRadians(subjectLat)), 1e-6);
  const deltaLng = radiusMiles / milesPerDegreeLng;

  const minLat = subjectLat - deltaLat;
  const maxLat = subjectLat + deltaLat;
  const minLng = subjectLng - deltaLng;
  const maxLng = subjectLng + deltaLng;

  const candidates = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('postcodes')
      .select('postcode, lat, lng')
      .not('lat', 'is', null)
      .not('lng', 'is', null)
      .gte('lat', minLat)
      .lte('lat', maxLat)
      .gte('lng', minLng)
      .lte('lng', maxLng)
      .order('postcode', { ascending: true }) // stable order required for .range() paging to not skip/repeat rows
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new PostcodeLookupError(`Bounding-box query failed: ${error.message}`, 'query_failed');
    }
    if (!data || data.length === 0) break;
    candidates.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const results = [];
  for (const row of candidates) {
    const distanceMiles = haversineMiles(subjectLat, subjectLng, row.lat, row.lng);
    if (distanceMiles <= radiusMiles) {
      results.push({ postcode: row.postcode, lat: row.lat, lng: row.lng, distanceMiles });
    }
  }

  results.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return results;
}

module.exports = { nearbyPostcodes, PostcodeLookupError, haversineMiles, normalisePostcode };
