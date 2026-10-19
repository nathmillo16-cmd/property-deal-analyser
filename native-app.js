// native-app.js: iOS app (Capacitor) only. The website never loads this file:
// app-config.js writes the <script> tag for it only when IS_NATIVE_APP is true,
// so nothing here can change how the website looks or behaves.
//
// What it does inside the app:
//   1. Hides purchasing (App Store rule: no buying or pointing to buying
//      outside the app). Any element with class "web-only" is hidden; locked
//      paid-feature panels get one neutral line instead of an upgrade button;
//      the server's "Upgrade to unlock..." error messages are rewritten to the
//      same neutral line. Paid users are unaffected: the server still decides
//      access exactly as before.
//   2. Replaces the top nav links with a fixed bottom tab bar
//      (Home, Calculator, Saved, Pipeline, More) on every page that has the
//      shared nav (#nav-root). More opens a sheet with the remaining pages,
//      the tutorial, Contact us, Settings and Log out.
//
// Elements can also carry data-native-text="..." to show different wording
// in the app (e.g. "Subscription" becomes "Plan").

(function () {
  var LOCK_MSG = "This feature isn't available on your current plan.";
  var DEALS_LIMIT_MSG = "You've reached the saved deals limit on your current plan.";

  var root = document.documentElement;
  root.classList.add('native-app');
  window.NATIVE_LOCK_MSG = LOCK_MSG;

  // The pricing page has no place in the app.
  if (/\/pricing\.html$/.test(window.location.pathname)) {
    window.location.replace('/landing.html');
    return;
  }

  // ---------- styles ----------
  var css =
    'html.native-app .web-only,html.native-app #subscribe-link,html.native-app .admin-badge-link{display:none!important}' +
    // The AI "Full Analysis" button only shows once we know the user is paid.
    'html.native-app:not(.plan-paid) .analyse-btn{display:none!important}' +
    '.native-lock-msg{margin:0;color:var(--muted);font-size:14px;line-height:1.5}' +
    // Top bar: keep the logo, drop the link row and account bar (now in the tab bar / More).
    'html.native-app #nav-root .nav-links,html.native-app #nav-root .auth-bar{display:none!important}' +
    'html.native-app #nav-root .topbar{margin-bottom:1.25rem;padding-bottom:.75rem}' +
    'html.native-app body.nt-has-tabbar{padding-bottom:calc(64px + env(safe-area-inset-bottom, 0px))}' +
    // Solid cream band behind the iPhone status bar (time, battery), so page
    // content scrolling up never shows through it. Height is exactly the
    // status bar area. Sits under modals (z-index 400+) so they still dim it.
    'html.native-app body::before{content:"";position:fixed;top:0;left:0;right:0;' +
      'height:env(safe-area-inset-top, 0px);background:var(--bg,#F2EFE7);z-index:390;pointer-events:none}' +
    // Refurb's sticky summary must stick below that band, not under it.
    'html.native-app .rf-summary{top:calc(1.5rem + env(safe-area-inset-top, 0px))}' +
    '.nt-tabbar{position:fixed;left:0;right:0;bottom:0;z-index:350;display:flex;' +
      'background:var(--surface,#fff);border-top:1px solid var(--hairline,#e5e5e5);' +
      'padding:0 env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);' +
      'box-shadow:0 -4px 16px rgba(20,20,40,.05)}' +
    '.nt-tab{flex:1;min-height:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;' +
      'background:none;border:0;padding:6px 2px;margin:0;color:var(--muted,#767a92);text-decoration:none;' +
      'font-family:var(--font-body,inherit);font-size:10.5px;line-height:1.2;font-weight:600;letter-spacing:.01em;cursor:pointer;' +
      '-webkit-tap-highlight-color:transparent}' +
    '.nt-tab svg{display:block;width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}' +
    '.nt-tab.active{color:#4b45b2}' +
    'body.nt-kb .nt-tabbar{display:none}' +
    '.nt-backdrop{position:fixed;inset:0;z-index:360;background:rgba(15,15,35,.45);opacity:0;pointer-events:none;transition:opacity .2s ease}' +
    '.nt-backdrop.open{opacity:1;pointer-events:auto}' +
    '.nt-sheet{position:fixed;left:0;right:0;bottom:0;z-index:361;background:var(--surface,#fff);' +
      'border-radius:18px 18px 0 0;padding:8px 16px calc(16px + env(safe-area-inset-bottom,0px));' +
      'max-height:85vh;overflow-y:auto;transform:translateY(105%);transition:transform .25s ease;' +
      'box-shadow:0 -10px 40px rgba(0,0,0,.18);font-family:var(--font-body,inherit)}' +
    '.nt-sheet.open{transform:translateY(0)}' +
    '.nt-handle{width:36px;height:4px;border-radius:2px;background:var(--hairline-strong,#ccc);margin:4px auto 12px}' +
    '.nt-email{font-size:12.5px;color:var(--muted,#767a92);margin:0 4px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.nt-group{background:var(--surface-2,#f6f6f8);border-radius:12px;overflow:hidden;margin-bottom:12px}' +
    '.nt-item{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:50px;padding:0 16px;' +
      'background:none;border:0;border-bottom:1px solid var(--hairline,#e5e5e5);color:var(--ink,#1a1a2e);' +
      'font-family:inherit;font-size:16px;text-align:left;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
    '.nt-group .nt-item:last-child{border-bottom:0}' +
    '.nt-item.active{color:#4b45b2;font-weight:600}' +
    '.nt-item::after{content:"\\203A";color:var(--muted,#999);font-size:20px}' +
    '.nt-item.nt-danger{color:var(--danger,#c0392b)}' +
    '.nt-item.nt-danger::after{content:none}';
  var style = document.createElement('style');
  style.id = 'native-app-styles';
  style.textContent = css;
  (document.head || root).appendChild(style);

  // ---------- server messages + plan detection ----------
  // Every page calls the API with fetch(API_BASE + ...). Two jobs here:
  //  - a 403 whose message talks about upgrading is swapped for neutral text
  //    (the 403 itself, and so the lock, is untouched);
  //  - a successful GET /api/profile tells us the plan, so paid-only buttons
  //    (the AI Full Analysis) can show for paid users.
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      return origFetch.apply(this, arguments).then(function (res) {
        try {
          if (typeof BACKEND_URL === 'undefined' || url.indexOf(BACKEND_URL) !== 0) return res;
          if (res.status === 403) return neutralise(res);
          if (res.ok && method === 'GET' && /\/api\/profile(\?|$)/.test(url)) {
            res.clone().json().then(function (d) { if (d && d.plan) setPlan(d.plan); }).catch(function () {});
          }
        } catch (e) {}
        return res;
      });
    };
  }

  function neutralise(res) {
    return res.clone().json().then(function (body) {
      if (!body || typeof body.error !== 'string' || !/upgrade|subscri|pricing|£/i.test(body.error)) return res;
      body.error = /limit reached/i.test(body.error) ? DEALS_LIMIT_MSG : LOCK_MSG;
      return new Response(JSON.stringify(body), { status: res.status, statusText: res.statusText, headers: res.headers });
    }).catch(function () { return res; });
  }

  function setPlan(plan) {
    root.classList.toggle('plan-paid', plan === 'paid');
    root.classList.toggle('plan-free', plan !== 'paid');
  }

  // ---------- page tweaks once the markup exists ----------
  function onReady() {
    document.querySelectorAll('[data-native-text]').forEach(function (el) {
      el.textContent = el.getAttribute('data-native-text');
    });

    // Locked paid-feature panels (pipeline, portfolio, refurb, letters, and
    // the Deal Workspace's locked sections): one neutral line, no button.
    document.querySelectorAll('.locked-panel, .workspace-lock').forEach(function (el) {
      el.innerHTML = '<p class="native-lock-msg"></p>';
      el.firstChild.textContent = LOCK_MSG;
    });

    buildTabBar();
  }

  // ---------- bottom tab bar ----------
  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    calc: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M8.5 6.5h7"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/>',
    saved: '<path d="M6.5 3h11a1 1 0 0 1 1 1v17l-6.5-4.2L5.5 21V4a1 1 0 0 1 1-1z"/>',
    pipeline: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5" height="11" rx="1.5"/><rect x="16" y="4" width="5" height="7" rx="1.5"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'
  };

  var TABS = [
    { key: 'home', href: '/home.html', label: 'Home', icon: 'home' },
    { key: 'index', href: '/index.html', label: 'Calculator', icon: 'calc' },
    { key: 'saved-deals', href: '/saved-deals.html', label: 'Saved', icon: 'saved' },
    { key: 'pipeline', href: '/pipeline.html', label: 'Pipeline', icon: 'pipeline' }
  ];

  var MORE_PAGES = [
    { key: 'portfolio', href: '/portfolio.html', label: 'Portfolio' },
    { key: 'refurb', href: '/refurb.html', label: 'Refurb Estimator' },
    { key: 'letters', href: '/letters.html', label: 'Letter Templates' }
  ];

  function svg(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  function buildTabBar() {
    var navRoot = document.getElementById('nav-root');
    if (!navRoot || document.getElementById('nt-tabbar')) return;
    var active = navRoot.dataset.active || '';
    var inMore = !TABS.some(function (t) { return t.key === active; });

    var bar = document.createElement('nav');
    bar.className = 'nt-tabbar';
    bar.id = 'nt-tabbar';
    bar.setAttribute('aria-label', 'Main');
    bar.innerHTML = TABS.map(function (t) {
      var on = t.key === active;
      return '<a class="nt-tab' + (on ? ' active' : '') + '" href="' + t.href + '"' +
        (on ? ' aria-current="page"' : '') + '>' + svg(t.icon) + '<span>' + t.label + '</span></a>';
    }).join('') +
      '<button type="button" class="nt-tab' + (inMore ? ' active' : '') + '" id="nt-more-btn" aria-haspopup="dialog" aria-expanded="false">' +
      svg('more') + '<span>More</span></button>';

    var backdrop = document.createElement('div');
    backdrop.className = 'nt-backdrop';
    backdrop.id = 'nt-backdrop';

    var sheet = document.createElement('div');
    sheet.className = 'nt-sheet';
    sheet.id = 'nt-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'More');
    sheet.innerHTML =
      '<div class="nt-handle"></div>' +
      '<p class="nt-email" id="nt-email"></p>' +
      '<div class="nt-group">' +
        MORE_PAGES.map(function (p) {
          return '<a class="nt-item' + (p.key === active ? ' active' : '') + '" href="' + p.href + '">' + p.label + '</a>';
        }).join('') +
      '</div>' +
      '<div class="nt-group">' +
        '<a class="nt-item' + (active === 'settings' ? ' active' : '') + '" href="/settings.html">Account &amp; settings</a>' +
        '<button type="button" class="nt-item" id="nt-tutorial">Tutorial</button>' +
        '<button type="button" class="nt-item" id="nt-contact">Contact us</button>' +
        '<a class="nt-item" href="/support.html">Help &amp; support</a>' +
        '<a class="nt-item" href="/privacy.html">Privacy policy</a>' +
      '</div>' +
      '<div class="nt-group">' +
        '<button type="button" class="nt-item nt-danger" id="nt-logout">Log out</button>' +
      '</div>';

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
    document.body.appendChild(bar);
    document.body.classList.add('nt-has-tabbar');

    var moreBtn = document.getElementById('nt-more-btn');
    function openSheet() {
      // The page's own JS puts the signed-in email into the (now hidden) user menu.
      var emailEl = document.getElementById('user-menu-item-email');
      var email = emailEl ? emailEl.textContent.trim() : '';
      document.getElementById('nt-email').textContent = email && email !== '—' ? 'Signed in as ' + email : '';
      backdrop.classList.add('open');
      sheet.classList.add('open');
      moreBtn.setAttribute('aria-expanded', 'true');
    }
    function closeSheet() {
      backdrop.classList.remove('open');
      sheet.classList.remove('open');
      moreBtn.setAttribute('aria-expanded', 'false');
    }
    moreBtn.addEventListener('click', function () {
      if (sheet.classList.contains('open')) closeSheet(); else openSheet();
    });
    backdrop.addEventListener('click', closeSheet);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

    document.getElementById('nt-tutorial').addEventListener('click', function () {
      closeSheet();
      if (window.Tutorial && typeof window.Tutorial.replay === 'function') {
        window.Tutorial.replay();
      } else {
        // Pages without the tutorial script (refurb, letters): write the same
        // fresh-start state Tutorial.replay() writes, then go to Home, which
        // picks it up and starts the tour.
        try {
          localStorage.setItem('dny-tutorial-state', JSON.stringify({ active: true, stepIndex: 0, startedAt: Date.now() }));
        } catch (e) {}
        window.location.href = '/home.html';
      }
    });

    document.getElementById('nt-contact').addEventListener('click', function (e) {
      closeSheet();
      if (window.openSupportModal) window.openSupportModal(e);
    });

    // Reuse the page's own logout wiring on the (hidden) #auth-link.
    document.getElementById('nt-logout').addEventListener('click', function () {
      closeSheet();
      var authLink = document.getElementById('auth-link');
      if (authLink) authLink.click();
    });

    // Hide the tab bar while typing, so it doesn't sit on top of the keyboard.
    document.addEventListener('focusin', function (e) {
      if (e.target && e.target.matches && e.target.matches('input, textarea, select, [contenteditable="true"]')) {
        document.body.classList.add('nt-kb');
      }
    });
    document.addEventListener('focusout', function () {
      document.body.classList.remove('nt-kb');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})();
