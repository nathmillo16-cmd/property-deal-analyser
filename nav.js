// nav.js — shared logged-in top nav, injected into <div id="nav-root">.
//
// Markup-only for anything account-specific. Renders the topbar (wordmark,
// the 7 nav links, an optional Subscribe/Upgrade link, and a user menu) and
// marks the active page from the placeholder's own data attributes.
// Layout: Home / Analyse / Deals / Portfolio, a Tools dropdown (Refurb,
// Letters), and the account menu (Settings, Deal Sourcing, Contact us, Log
// out). The same four items also render as a bottom tab bar on phones and
// in the iOS app.
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

// Main nav: four items. "Deals" covers both views of the one Deals page
// (List = saved-deals.html, Board = pipeline.html), so it is active on both.
var NAV_LINKS = [
  { key: 'home', href: '/home.html', label: 'Home', icon: 'home', match: ['home'] },
  { key: 'index', href: '/index.html', label: 'Analyse', icon: 'calc', match: ['index'] },
  { key: 'deals', href: '/saved-deals.html', label: 'Deals', icon: 'deals', match: ['saved-deals', 'pipeline'] },
  { key: 'portfolio', href: '/portfolio.html', label: 'Portfolio', icon: 'portfolio', match: ['portfolio'] }
];

// Secondary tools, in the "Tools" dropdown.
var NAV_TOOLS = [
  { key: 'refurb', href: '/refurb.html', label: 'Refurb Estimator' },
  { key: 'letters', href: '/letters.html', label: 'Letter Templates' }
];

var NAV_ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  calc: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M8.5 6.5h7"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/>',
  deals: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5" height="11" rx="1.5"/><rect x="16" y="4" width="5" height="7" rx="1.5"/>',
  portfolio: '<path d="M4 20V10l4-3 4 3v10"/><path d="M12 20V6l4-3 4 3v14"/><path d="M2 20h20"/>'
};

(function renderNav(){
  var root = document.getElementById('nav-root');
  if (!root) return; // no placeholder on this page — nothing to do

  var active = root.dataset.active || '';
  var showSubscribe = root.dataset.subscribe === 'true';

  var linksHtml = NAV_LINKS.map(function(l){
    var on = l.match.indexOf(active) !== -1;
    return '<a href="' + l.href + '"' + (on ? ' class="active" aria-current="page"' : '') + '>' + l.label + '</a>';
  }).join('');

  var toolsActive = NAV_TOOLS.some(function(t){ return t.key === active; });
  var toolsHtml =
    '<div class="nav-tools" id="nav-tools">' +
      '<button type="button" class="nav-tools-trigger' + (toolsActive ? ' active' : '') + '" id="nav-tools-trigger" ' +
        'onclick="toggleNavTools(event)" aria-haspopup="true" aria-expanded="false">Tools <span class="user-menu-caret" aria-hidden="true">&#9662;</span></button>' +
      '<div class="user-menu-list nav-tools-list" role="menu">' +
        NAV_TOOLS.map(function(t){
          return '<a href="' + t.href + '" class="user-menu-item' + (t.key === active ? ' active' : '') + '" role="menuitem">' + t.label + '</a>';
        }).join('') +
      '</div>' +
    '</div>';

  var authLinkHtml = showSubscribe
    ? '<a href="/login.html" id="auth-link" class="user-menu-item" role="menuitem">Log in</a>'
    : '<a href="#" id="auth-link" class="user-menu-item" role="menuitem">Log out</a>';

  // Deal Sourcing (an external, website-only waitlist page) and Contact us
  // live in the account menu now, not the main nav.
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
        '<a href="/deal-sourcing/apply" class="user-menu-item web-only" role="menuitem" target="_blank" rel="noopener">Deal Sourcing ↗</a>' +
        '<a href="#" id="contact-us-link" class="user-menu-item" role="menuitem" onclick="closeUserMenu();if(window.openSupportModal)openSupportModal(event);return false;">Contact us</a>' +
        authLinkHtml +
      '</div>' +
    '</div>';

  var authBarHtml = showSubscribe
    ? '<a id="subscribe-link" href="#" style="display:none;margin-right:1rem">Subscribe / Upgrade · £29/mo</a>' + userMenuHtml
    : userMenuHtml;

  root.innerHTML =
    '<div class="topbar">' +
      '<a class="wordmark" href="/home.html"><img src="/assets/propulsion-logo.png" alt="PROPulsion" class="wordmark-logo"></a>' +
      '<div class="nav-links">' + linksHtml + '</div>' +
      '<div class="auth-bar">' + toolsHtml + authBarHtml + '</div>' +
    '</div>';

  // Bottom tab bar: the same four items, shown on phone widths and always
  // in the iOS app (CSS in styles.css decides when). Respects the iPhone
  // home-indicator area via env(safe-area-inset-bottom).
  var bar = document.createElement('nav');
  bar.className = 'tabbar';
  bar.id = 'tabbar';
  bar.setAttribute('aria-label', 'Main');
  bar.innerHTML = NAV_LINKS.map(function(l){
    var on = l.match.indexOf(active) !== -1;
    return '<a class="tabbar-tab' + (on ? ' active' : '') + '" href="' + l.href + '"' + (on ? ' aria-current="page"' : '') + '>' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' + NAV_ICONS[l.icon] + '</svg><span>' + l.label + '</span></a>';
  }).join('');
  document.body.appendChild(bar);
  document.body.classList.add('has-tabbar');

  // Hide the tab bar while typing, so it doesn't sit on top of the keyboard.
  document.addEventListener('focusin', function(e){
    if (e.target && e.target.matches && e.target.matches('input, textarea, select, [contenteditable="true"]')) {
      document.body.classList.add('tabbar-kb');
    }
  });
  document.addEventListener('focusout', function(){ document.body.classList.remove('tabbar-kb'); });

  // Load the Contact us modal (support.js) from here rather than via a
  // <script> tag on every page, so it is guaranteed to exist wherever the
  // nav link that opens it does. It only defines functions and attaches
  // nothing until the link is clicked, so async loading is fine.
  if (!document.getElementById('support-js')) {
    var s = document.createElement('script');
    s.src = '/support.js';
    s.id = 'support-js';
    document.body.appendChild(s);
  }
})();

function toggleNavTools(e){
  e.preventDefault();
  e.stopPropagation();
  var menu = document.getElementById('nav-tools');
  if (!menu) return;
  closeUserMenu();
  var open = menu.classList.toggle('open');
  var trigger = document.getElementById('nav-tools-trigger');
  if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function closeNavTools(){
  var menu = document.getElementById('nav-tools');
  if (!menu) return;
  menu.classList.remove('open');
  var trigger = document.getElementById('nav-tools-trigger');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function toggleUserMenu(e){
  e.preventDefault();
  e.stopPropagation();
  var menu = document.getElementById('user-menu');
  if (!menu) return;
  var trigger = document.getElementById('user-menu-trigger');
  closeNavTools();
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
  if (menu && menu.classList.contains('open') && !menu.contains(e.target)) closeUserMenu();
  var tools = document.getElementById('nav-tools');
  if (tools && tools.classList.contains('open') && !tools.contains(e.target)) closeNavTools();
});

document.addEventListener('keydown', function(e){
  if (e.key === 'Escape') { closeUserMenu(); closeNavTools(); }
});
