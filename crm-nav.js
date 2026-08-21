// Adds a small "Admin" badge/link near the account dropdown (nav.js's own
// #user-menu, inside .auth-bar), for superusers only. Included via one
// extra <script src="/crm-nav.js"></script> tag, placed immediately after
// nav.js's own script tag, on each of the 8 logged-in pages. Deliberately
// kept as its own file rather than folded into nav.js's NAV_LINKS array —
// that array is rendered unconditionally for every logged-in user, so
// wiring role-awareness into it directly would risk a regular user's nav
// being affected by a bug in this feature. This file only ever ADDS a
// badge, after nav.js has already finished rendering, and does nothing at
// all for a non-superuser or a logged-out visitor.
//
// Previously this appended a plain text link into the regular .nav-links
// row, reading as just another product tab. Moved deliberately: the admin
// area is a separate system (its own layout, its own data, no regular
// PROPulsion nav at all — see admin/index.html), not a feature of the main
// app, so it now renders as a visually distinct badge next to Account
// rather than another item in Home/Calculator/Saved Deals/etc.
//
// This is UX only, same disclaimer as everywhere else in this app — hiding
// or showing this badge changes nothing about who can actually reach admin
// data (see admin-guard.js and the RLS policies on every crm_* table, plus
// profiles' own "select all profiles" policy for GET /api/admin/users).
(function () {
  var STYLE_ID = 'crm-nav-admin-badge-style';

  function injectStyleOnce() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.admin-badge-link{display:inline-flex;align-items:center;gap:5px;' +
      'font-family:var(--font-body);font-size:11px;font-weight:700;' +
      'text-transform:uppercase;letter-spacing:.04em;text-decoration:none;' +
      'color:var(--warn-ink);background:var(--warn-bg);border:1.5px solid var(--warn);' +
      'border-radius:999px;padding:4px 11px 4px 9px;white-space:nowrap}' +
      '.admin-badge-link:hover{filter:brightness(0.95)}' +
      '.admin-badge-link.active{outline:2px solid var(--warn);outline-offset:1px}';
    document.head.appendChild(style);
  }

  async function maybeShowAdminBadge() {
    var authBar = document.querySelector('#nav-root .auth-bar');
    if (!authBar) return; // no placeholder on this page — nothing to do

    try {
      var cfgRes = await fetch('/api/config');
      var cfg = await cfgRes.json();
      var client = supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
      var { data: { session } } = await client.auth.getSession();
      if (!session) return;

      var profRes = await fetch('/api/profile', {
        headers: { 'Authorization': 'Bearer ' + session.access_token }
      });
      var prof = await profRes.json();
      if (prof.role !== 'superuser') return;

      injectStyleOnce();

      var link = document.createElement('a');
      link.href = '/admin/index.html';
      link.className = 'admin-badge-link';
      if (window.location.pathname.indexOf('/admin/') === 0) link.className += ' active';
      link.innerHTML = '<span aria-hidden="true">&#9881;</span> Admin';

      // Inserted before the user-menu, not appended at the end of
      // .auth-bar, so it always sits directly beside Account regardless of
      // whether #subscribe-link is also present ahead of it on this page.
      var userMenu = authBar.querySelector('.user-menu');
      if (userMenu) authBar.insertBefore(link, userMenu);
      else authBar.appendChild(link);
    } catch (e) {
      // Fail silent — worst case the badge just doesn't appear.
    }
  }

  maybeShowAdminBadge();
})();
