// mfa-guard.js: server-side enforcement of two-step sign in (Settings >
// Security, Supabase MFA with an authenticator app).
//
// Someone who has a verified MFA factor must be fully signed in (aal2) to
// use any API route. A token from the password step alone (aal1) gets:
//   401 { error: 'Finish two-step sign in to continue.', code: 'mfa_required' }
// which auth-guard.js turns into a trip back to the login page for the code.
// Users without two-step sign in are unaffected.
//
// How it decides, per request with a bearer token:
//   1. Read the token's claims (sub = user id, aal). The claims are only
//      read here, not trusted on their own: every route still hands the
//      token to Supabase, which checks its signature, so a hand-edited
//      "aal2" token is rejected there. A forged token can only ever be
//      blocked by this guard, never let through by it.
//   2. aal2 -> allowed. Otherwise ask Supabase (service role) whether the
//      user has a verified factor, cached for 30 seconds per user so busy
//      pages don't repeat the lookup.
//   3. Before refusing, confirm with Supabase that the token is genuine
//      and belongs to that user (only in this rare case, so normal
//      requests cost nothing extra). A made-up token gets passed on to the
//      route, whose own auth check rejects it, so it can't be used to find
//      out whether someone has two-step sign in turned on.
//   4. If a lookup fails, refuse (503) rather than guess: a security check
//      that can't run shouldn't wave requests through.
//
// Requests without a token (public pages, the Stripe webhook) pass
// straight through; each route's own auth check still applies.

const CACHE_TTL_MS = 30 * 1000;

function decodeClaims(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const claims = JSON.parse(json);
    return claims && typeof claims === 'object' ? claims : null;
  } catch (e) {
    return null;
  }
}

// listVerified(userId) -> Promise<boolean>: true if the user has a
// verified MFA factor. verifyToken(token) -> Promise<userId|null>: the
// signed-in user the token really belongs to. Both injected so this can be
// tested without Supabase.
function createMfaGuard({ listVerified, verifyToken, isGuardedPath, now = () => Date.now() }) {
  const cache = new Map();

  async function hasVerifiedFactor(userId) {
    const hit = cache.get(userId);
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.value;
    const value = await listVerified(userId);
    cache.set(userId, { value, at: now() });
    if (cache.size > 5000) cache.delete(cache.keys().next().value);
    return value;
  }

  return async function mfaGuard(req, res, next) {
    if (!isGuardedPath(req.path)) return next();
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return next();
    const token = header.slice(7);
    const claims = decodeClaims(token);
    if (!claims || typeof claims.sub !== 'string' || !claims.sub) return next();
    if (claims.aal === 'aal2') return next();
    try {
      if (await hasVerifiedFactor(claims.sub)) {
        const realUser = await verifyToken(token);
        if (realUser !== claims.sub) return next(); // not a genuine token: the route rejects it
        return res.status(401).json({ error: 'Finish two-step sign in to continue.', code: 'mfa_required' });
      }
    } catch (e) {
      console.error('Two-step sign in check failed for', claims.sub, ':', e.message);
      return res.status(503).json({ error: "We couldn't check your sign in just now. Try again in a moment.", code: 'mfa_check_failed' });
    }
    return next();
  };
}

// The real lookup: the user's factors via the service-role admin API.
function supabaseVerifiedFactorLookup(supabaseAdmin) {
  return async function listVerified(userId) {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return false;
    const { data, error } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId });
    if (error) throw error;
    return ((data && data.factors) || []).some((f) => f.status === 'verified');
  };
}

// The real token check: Supabase validates the signature and expiry.
function supabaseTokenVerifier(supabaseAdmin) {
  return async function verifyToken(token) {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error) {
      // An invalid or expired token is a normal "no"; anything else (an
      // outage) is thrown so the guard refuses rather than guesses.
      if (error.status === 401 || error.status === 403 || /invalid|expired|jwt/i.test(error.message || '')) return null;
      throw error;
    }
    return data && data.user ? data.user.id : null;
  };
}

module.exports = { createMfaGuard, supabaseVerifiedFactorLookup, supabaseTokenVerifier, decodeClaims };
