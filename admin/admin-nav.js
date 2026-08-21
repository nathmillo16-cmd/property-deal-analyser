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
//   data-active — one of: tier1, tier2, tier3, partners.
//
// Auth/role gating is NOT this file's job — admin-guard.js's
// requireSuperuser() already redirected a non-superuser away before this
// ever runs, same division of responsibility as nav.js/auth-guard.js in
// the regular app.

var ADMIN_NAV_LINKS = [
  { key: 'tier1', href: '/admin/index.html', label: 'Tier 1 — Software' },
  { key: 'tier2', href: '/admin/tier2.html', label: 'Tier 2 — Acquisition Partners' },
  { key: 'tier3', href: '/admin/tier3.html', label: 'Tier 3 — Private Sourcing' },
  { key: 'partners', href: '/admin/partners.html', label: 'Partners' }
];

(function renderAdminNav(){
  var root = document.getElementById('admin-nav-root');
  if (!root) return;

  var active = root.dataset.active || '';

  var linksHtml = ADMIN_NAV_LINKS.map(function(l){
    var activeAttr = l.key === active ? ' class="admin-nav-link active"' : ' class="admin-nav-link"';
    return '<a href="' + l.href + '"' + activeAttr + '>' + l.label + '</a>';
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
