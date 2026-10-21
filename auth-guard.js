// Shared "require login" check for protected pages (index.html, pipeline.html,
// home.html). This is a UX/onboarding redirect only, NOT a security boundary —
// every real data endpoint on the server independently requires a valid bearer
// token (and, where relevant, a paid plan) regardless of this check. A page
// that briefly renders before this resolves exposes no data, since nothing on
// it fetches anything without that server-side auth already in place.
//
// Usage: const auth = await requireAuth(); if (!auth) return; // already redirecting
// auth.client is the Supabase client; auth.session is the current session.
// Two-step sign in is also enforced by the server (mfa-guard.js): a
// password-only token for someone with it turned on gets 401 with
// code 'mfa_required'. Any page that loads this file then goes to the
// login page, which asks for the code. Wraps fetch once, reading a copy of
// the response so the page's own code still gets the original.
(function () {
  if (window.__mfaFetchWrapped || typeof window.fetch !== 'function') return;
  window.__mfaFetchWrapped = true;
  var originalFetch = window.fetch;
  window.fetch = function () {
    return originalFetch.apply(this, arguments).then(function (res) {
      if (res && res.status === 401 && !/^\/login/.test(location.pathname)) {
        res.clone().json().then(function (d) {
          if (d && d.code === 'mfa_required') window.location.href = '/login.html';
        }).catch(function () {});
      }
      return res;
    });
  };
})();

async function requireAuth() {
  try {
    const res = await fetch(API_BASE+'/api/config');
    const cfg = await res.json();
    const client = supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      window.location.href = '/';
      return null;
    }
    // Two-step sign in (Settings > Security): a password-only session for
    // someone who has it turned on goes back to the login page for the code.
    try {
      const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        window.location.href = '/login.html';
        return null;
      }
    } catch (e) { /* MFA check unavailable: carry on as before */ }
    return { client, session };
  } catch (e) {
    // Fail open on visibility (never leave the page permanently blank), but
    // still redirect — a page that can't even confirm auth shouldn't render.
    window.location.href = '/';
    return null;
  }
}
