// Shared "require login" check for protected pages (index.html, pipeline.html,
// home.html). This is a UX/onboarding redirect only, NOT a security boundary —
// every real data endpoint on the server independently requires a valid bearer
// token (and, where relevant, a paid plan) regardless of this check. A page
// that briefly renders before this resolves exposes no data, since nothing on
// it fetches anything without that server-side auth already in place.
//
// Usage: const auth = await requireAuth(); if (!auth) return; // already redirecting
// auth.client is the Supabase client; auth.session is the current session.
async function requireAuth() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    const client = supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      window.location.href = '/';
      return null;
    }
    return { client, session };
  } catch (e) {
    // Fail open on visibility (never leave the page permanently blank), but
    // still redirect — a page that can't even confirm auth shouldn't render.
    window.location.href = '/';
    return null;
  }
}
