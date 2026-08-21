// Shared "require superuser" check for the /admin/*.html pages. Layers
// on top of requireAuth() (auth-guard.js, must be included first) — once a
// session is confirmed, this also fetches /api/profile and confirms
// role === 'superuser', redirecting anyone else straight to /home.html.
//
// This is a UX/onboarding redirect only, NOT the real security boundary —
// same disclaimer as requireAuth() itself. Every /api/admin/crm/* route
// independently re-checks role server-side (requireSuperuser() in
// server.js), and Row Level Security on every crm_* table (db/021 onward)
// is what actually makes the data unreachable regardless of this check. A
// forced-open admin page exposes nothing, since nothing on it can fetch
// real CRM data without that server-side check already in place.
//
// Usage: const auth = await requireSuperuser(); if (!auth) return;
// Same return shape as requireAuth(): { client, session }.
async function requireSuperuser() {
  const auth = await requireAuth();
  if (!auth) return null; // requireAuth() already redirected

  try {
    const res = await fetch('/api/profile', {
      headers: { 'Authorization': 'Bearer ' + auth.session.access_token }
    });
    const prof = await res.json();
    if (prof.role !== 'superuser') {
      window.location.href = '/home.html';
      return null;
    }
  } catch (e) {
    // Fail closed, same as requireAuth() fails open toward "redirect" —
    // a page that can't even confirm role shouldn't render CRM data.
    window.location.href = '/home.html';
    return null;
  }

  return auth;
}
