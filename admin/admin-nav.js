// admin-nav.js — top nav for the separate /admin/ area, injected into
// <div id="admin-nav-root">. Parallels nav.js's role for the regular app
// (a placeholder + a script tag that renders into it), but deliberately a
// separate, smaller file: the admin area has no wordmark link back into
// the regular product nav, no Subscribe/Upgrade link, no user-menu — just
// the four sections plus a "back to app" link. Mixing this into nav.js
// would risk admin-only markup leaking into the regular app's shared
// component; keeping it separate means a bug here can't touch the 8
// regular logged-in pages at all.
//
// Usage: <div id="admin-nav-root" data-active="tier1"></div>
//   data-active — one of: tier1, tier2, tier3, partners, support.
//
// Auth/role gating is NOT this file's job — admin-guard.js's
// requireSuperuser() already redirected a non-superuser away before this
// ever runs, same division of responsibility as nav.js/auth-guard.js in
// the regular app.

var ADMIN_NAV_LINKS = [
  { key: 'tier1', href: '/admin/index.html', label: 'Tier 1 — Software' },
  { key: 'tier2', href: '/admin/tier2.html', label: 'Tier 2 — Acquisition Partners' },
  { key: 'tier3', href: '/admin/tier3.html', label: 'Tier 3 — Private Sourcing' },
  { key: 'partners', href: '/admin/partners.html', label: 'Partners' },
  { key: 'support', href: '/admin/support.html', label: 'Support' }
];

(function renderAdminNav(){
  var root = document.getElementById('admin-nav-root');
  if (!root) return;

  var active = root.dataset.active || '';

  var linksHtml = ADMIN_NAV_LINKS.map(function(l){
    var activeAttr = l.key === active ? ' class="admin-nav-link active"' : ' class="admin-nav-link"';
    var idAttr = l.key === 'support' ? ' id="admin-nav-support"' : '';
    return '<a href="' + l.href + '"' + activeAttr + idAttr + '>' + l.label + '</a>';
  }).join('');

  root.innerHTML =
    '<div class="admin-topbar">' +
      '<div class="admin-topbar-title">' +
        '<span class="admin-topbar-badge" aria-hidden="true">&#9881;</span> PROPulsion Admin' +
      '</div>' +
      '<div class="admin-nav-links">' + linksHtml + '</div>' +
      '<a class="admin-back-link" href="/home.html">&larr; Back to app</a>' +
    '</div>';
})();

// "Support (N)" — N is the number of open (New + In progress) support
// requests, from the superuser-only GET /api/admin/support-requests/
// open-count. Fetched with this page's own session, the same way
// crm-nav.js gets one. Fails silent: the label just stays "Support".
// admin/support.html also calls setAdminSupportCount() directly after a
// status change, so the label updates without a reload.
function setAdminSupportCount(n){
  var link = document.getElementById('admin-nav-support');
  if (!link) return;
  link.textContent = (typeof n === 'number' && n > 0) ? 'Support (' + n + ')' : 'Support';
}

(async function loadAdminSupportCount(){
  if (!document.getElementById('admin-nav-support')) return;
  try {
    var cfg = await (await fetch('/api/config')).json();
    var client = supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
    var session = (await client.auth.getSession()).data.session;
    if (!session) return;
    var res = await fetch('/api/admin/support-requests/open-count', {
      headers: { 'Authorization': 'Bearer ' + session.access_token }
    });
    if (!res.ok) return;
    var body = await res.json();
    setAdminSupportCount(body.open_count);
  } catch (e) { /* label stays "Support" */ }
})();
