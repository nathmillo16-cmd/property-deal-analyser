// nav.js — shared logged-in top nav, injected into <div id="nav-root">.
//
// Markup-only. Renders the topbar (wordmark, the 7 nav links, an optional
// Subscribe/Upgrade link, and the auth-link) and marks the active page from
// the placeholder's own data attributes. Attaches NO click handlers and no
// auth logic — every page's existing JS (init()/updateTopbar()/
// updateAuthUI()) keeps wiring #auth-link/#subscribe-link exactly as it
// does today, targeting the same element IDs this script produces.
//
// Usage: <div id="nav-root" data-active="portfolio" data-subscribe="true"></div>
//   data-active    — one of: home, index, saved-deals, pipeline, portfolio,
//                    refurb, letters (matches the page's own file basename).
//   data-subscribe — "true" on paid-gated pages (adds #subscribe-link,
//                    auth-link defaults to the logged-out "Log in" state
//                    since these pages resolve auth after load); "false"
//                    on free pages (no subscribe link, auth-link defaults
//                    straight to "Log out", since those pages only render
//                    once a session is already confirmed).
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

  var authBarHtml = showSubscribe
    ? '<a id="subscribe-link" href="#" style="display:none;margin-right:1rem">Subscribe / Upgrade · £29/mo</a><a id="auth-link" href="/login.html">Log in</a>'
    : '<a id="auth-link" href="#">Log out</a>';

  root.innerHTML =
    '<div class="topbar">' +
      '<a class="wordmark" href="/home.html">Deals N Yields</a>' +
      '<div class="nav-links">' + linksHtml + '</div>' +
      '<div class="auth-bar">' + authBarHtml + '</div>' +
    '</div>';
})();
