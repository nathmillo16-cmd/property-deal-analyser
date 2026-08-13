// nav.js — shared logged-in top nav, injected into <div id="nav-root">.
//
// Markup-only for anything account-specific. Renders the topbar (wordmark,
// the 7 nav links, an optional Subscribe/Upgrade link, and a user menu) and
// marks the active page from the placeholder's own data attributes.
// Attaches NO auth logic — every page's existing JS (init()/updateTopbar()/
// updateAuthUI()) keeps wiring #auth-link/#subscribe-link/#user-menu-email/
// #user-menu-item-email exactly as it does today, targeting the same
// element IDs this script produces. The one piece of behaviour nav.js DOES
// own itself is the user menu's own open/close toggle (toggleUserMenu()
// below, plus its outside-click/Escape listeners) — that's pure menu-
// visibility chrome intrinsic to the component, not page/account logic, so
// it lives here rather than being duplicated in every page that uses it.
//
// Usage: <div id="nav-root" data-active="portfolio" data-subscribe="true"></div>
//   data-active    — one of: home, index, saved-deals, pipeline, portfolio,
//                    refurb, letters, settings (matches the page's own file
//                    basename; "settings" matches no NAV_LINKS entry, which
//                    is intentional — Settings lives in the user menu, not
//                    the main link row, so nothing there is ever "active").
//   data-subscribe — "true" on paid-gated pages (adds #subscribe-link,
//                    auth-link defaults to the logged-out "Log in" state
//                    since these pages resolve auth after load); "false"
//                    on free pages (no subscribe link, auth-link defaults
//                    straight to "Log out", since those pages only render
//                    once a session is already confirmed).
//
// USER MENU — replaces the old bare "Log out" link. #auth-link is still the
// real logout trigger (same id, same default text/href per data-subscribe
// branch as before), just now nested inside a dropdown alongside a
// Settings link and an email display — so no page's existing #auth-link
// wiring needed to change. Two NEW ids each page's own JS should populate
// once auth resolves, alongside its existing #auth-link handling:
//   #user-menu-email      — short label on the closed trigger (the user's
//                            email; every page already has this for free
//                            via session.user.email, no extra fetch).
//   #user-menu-item-email — the same email, shown as a header line inside
//                            the open menu.
// Both default to a neutral placeholder until a page sets them, so nothing
// looks broken before auth resolves.
//
// ORDERING — this must finish writing into #nav-root before the page's own
// bottom-of-body <script> block queries #auth-link/#subscribe-link, or
// those lookups return null. A <script src="/nav.js"> placed in <head>
// cannot guarantee that: <head> scripts execute the instant the parser
// reaches them, which is before <body> — and #nav-root — exist at all, so
// document.getElementById('nav-root') would find nothing. The correct
// placement is a plain, non-deferred <script src="/nav.js"> tag in the
// BODY, immediately after the <div id="nav-root">...</div> element itself.
// HTML parsing is synchronous and a classic script tag executes the
// instant the parser reaches it, so #nav-root is guaranteed to already
// exist by then, and this script's write happens strictly before the
// page's own later inline <script> block (further down the page) is even
// reached, let alone run.

var NAV_LINKS = [
  { key: 'home', href: '/home.html', label: 'Home' },
  { key: 'index', href: '/index.html', label: 'Calculator' },
  { key: 'saved-deals', href: '/saved-deals.html', label: 'Saved Deals' },
  { key: 'pipeline', href: '/pipeline.html', label: 'Pipeline' },
  { key: 'portfolio', href: '/portfolio.html', label: 'Portfolio' },
  { key: 'refurb', href: '/refurb.html', label: 'Refurb Estimator' },
  { key: 'letters', href: '/letters.html', label: 'Letter Templates' }
];

(function renderNav(){
  var root = document.getElementById('nav-root');
  if (!root) return; // no placeholder on this page — nothing to do

  var active = root.dataset.active || '';
  var showSubscribe = root.dataset.subscribe === 'true';

  var linksHtml = NAV_LINKS.map(function(l){
    var activeAttr = l.key === active ? ' class="active"' : '';
    return '<a href="' + l.href + '"' + activeAttr + '>' + l.label + '</a>';
  }).join('');

  var authLinkHtml = showSubscribe
    ? '<a href="/login.html" id="auth-link" class="user-menu-item" role="menuitem">Log in</a>'
    : '<a href="#" id="auth-link" class="user-menu-item" role="menuitem">Log out</a>';

  var userMenuHtml =
    '<div class="user-menu" id="user-menu">' +
      '<button type="button" class="user-menu-trigger" id="user-menu-trigger" ' +
        'onclick="toggleUserMenu(event)" aria-haspopup="true" aria-expanded="false">' +
        '<span class="user-menu-email" id="user-menu-email">Account</span>' +
        '<span class="user-menu-caret" aria-hidden="true">&#9662;</span>' +
      '</button>' +
      '<div class="user-menu-list" id="user-menu-list" role="menu">' +
        '<div class="user-menu-item-email" id="user-menu-item-email">&mdash;</div>' +
        '<a href="/settings.html" class="user-menu-item" role="menuitem">Settings</a>' +
        authLinkHtml +
      '</div>' +
    '</div>';

  var authBarHtml = showSubscribe
    ? '<a id="subscribe-link" href="#" style="display:none;margin-right:1rem">Subscribe / Upgrade · £29/mo</a>' + userMenuHtml
    : userMenuHtml;

  root.innerHTML =
    '<div class="topbar">' +
      '<a class="wordmark" href="/home.html">Deals N Yields</a>' +
      '<div class="nav-links">' + linksHtml + '</div>' +
      '<div class="auth-bar">' + authBarHtml + '</div>' +
    '</div>';
})();

function toggleUserMenu(e){
  e.preventDefault();
  e.stopPropagation();
  var menu = document.getElementById('user-menu');
  if (!menu) return;
  var trigger = document.getElementById('user-menu-trigger');
  var open = menu.classList.toggle('open');
  if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function closeUserMenu(){
  var menu = document.getElementById('user-menu');
  if (!menu) return;
  menu.classList.remove('open');
  var trigger = document.getElementById('user-menu-trigger');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', function(e){
  var menu = document.getElementById('user-menu');
  if (!menu || !menu.classList.contains('open')) return;
  if (!menu.contains(e.target)) closeUserMenu();
});

document.addEventListener('keydown', function(e){
  if (e.key === 'Escape') closeUserMenu();
});
