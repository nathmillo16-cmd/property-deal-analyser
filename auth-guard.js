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
//
// Any other 401 from our own API (an expired session, or an account that has
// been deleted) sends the user to the login page with "Your session ended,
// please log in again." Someone with no session at all also goes to the login
// page (not the landing page). Clicking "Log out" still goes to the landing
// page: the click on #auth-link is noted below so the sign-out that follows
// isn't mistaken for a session ending.
var DNY_LOGIN_URL = '/login.html';
var DNY_SESSION_ENDED_URL = '/login.html?session=ended';

function dnyMarkLoggingOut() { window.__dnyLoggingOut = true; }

// Called when a session disappears while a page is open (onAuthStateChange
// with no session). Does nothing if the user just clicked Log out.
function dnySessionEnded() {
  if (window.__dnyLoggingOut || window.__dnyRedirecting) return;
  if (/^\/login/.test(location.pathname)) return;
  window.__dnyRedirecting = true;
  window.location.href = DNY_SESSION_ENDED_URL;
}

(function () {
  // Note a Log out click (also catches native-app.js clicking the hidden
  // #auth-link), in the capture phase so it's set before the page's handler.
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest('#auth-link')) dnyMarkLoggingOut();
  }, true);

  if (window.__mfaFetchWrapped || typeof window.fetch !== 'function') return;
  window.__mfaFetchWrapped = true;
  var originalFetch = window.fetch;

  // Only our own server's /api/* and /analyse calls count. A 401 from
  // Supabase itself (a wrong code or password) must not log anyone out.
  function isOwnApi(input) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var base = (typeof API_BASE === 'string' && API_BASE) ? API_BASE : location.origin;
    if (url.indexOf(base) === 0) url = url.slice(base.length);
    return /^\/(api\/|analyse)/.test(url);
  }

  window.fetch = function (input) {
    var ownApi = isOwnApi(input);
    return originalFetch.apply(this, arguments).then(function (res) {
      if (ownApi && res && res.status === 401 && !/^\/login/.test(location.pathname)) {
        res.clone().json().catch(function () { return {}; }).then(function (d) {
          if (d && d.code === 'mfa_required') {
            if (!window.__dnyRedirecting) { window.__dnyRedirecting = true; window.location.href = DNY_LOGIN_URL; }
          } else {
            dnySessionEnded();
          }
        });
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
      window.location.href = DNY_LOGIN_URL;
      return null;
    }
    // Two-step sign in (Settings > Security): a password-only session for
    // someone who has it turned on goes back to the login page for the code.
    try {
      const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        window.location.href = DNY_LOGIN_URL;
        return null;
      }
    } catch (e) { /* MFA check unavailable: carry on as before */ }
    return { client, session };
  } catch (e) {
    // Fail open on visibility (never leave the page permanently blank), but
    // still redirect — a page that can't even confirm auth shouldn't render.
    window.location.href = DNY_LOGIN_URL;
    return null;
  }
}
