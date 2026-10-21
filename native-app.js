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
//   2. The bottom tab bar itself (Home, Analyse, Deals, Portfolio) comes
//      from nav.js, same as on phone-width websites. In the app the top
//      link row and account bar are hidden, and the same round initials
//      avatar the website uses sits in the header. Tapping it opens a sheet
//      with the user's name and email, the Tools groups (from nav.js),
//      Settings, Plan, Your goals, Help & tutorial, Contact us and Log out.
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
    window.location.replace('/welcome.html');
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
    // Compact header on logged-in pages: smaller logo, less padding above and below.
    'html.native-app #nav-root .topbar{margin-bottom:1rem;padding-bottom:.6rem}' +
    'html.native-app #nav-root .wordmark-logo{height:32px}' +
    'html.native-app body:has(#nav-root) .shell{padding-top:.75rem}' + // :has applies before the tab bar JS runs, so no jump
    // Solid cream band behind the iPhone status bar (time, battery), so page
    // content scrolling up never shows through it. Height is exactly the
    // status bar area. Sits under modals (z-index 400+) so they still dim it.
    'html.native-app body::before{content:"";position:fixed;top:0;left:0;right:0;' +
      'height:env(safe-area-inset-top, 0px);background:var(--bg,#F2EFE7);z-index:390;pointer-events:none}' +
    // Refurb's sticky summary must stick below that band, not under it.
    'html.native-app .rf-summary{top:calc(1.5rem + env(safe-area-inset-top, 0px))}' +
    // Header account button (opens the sheet below), right of the logo.
    'html.native-app #nav-root .topbar{flex-wrap:nowrap;justify-content:space-between}' +
    '.nt-menu-btn{display:flex;align-items:center;gap:4px;background:none;border:0;padding:4px;margin:0;cursor:pointer;' +
      'border-radius:999px;-webkit-tap-highlight-color:transparent}' +
    '.nt-menu-btn .user-avatar{width:36px;height:36px;font-size:13.5px}' +
    '.nt-head{display:flex;align-items:center;gap:12px;margin:0 4px 14px}' +
    '.nt-head .user-avatar{width:44px;height:44px;font-size:16px}' +
    '.nt-who{min-width:0}' +
    '.nt-name{font-size:16px;font-weight:700;color:var(--ink,#1a1a2e);margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.nt-item-label{display:flex;align-items:center;gap:12px}' +
    '.nt-item-label svg{width:19px;height:19px;flex-shrink:0;fill:none;stroke:var(--muted,#767a92);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}' +
    '.nt-item.active .nt-item-label svg{stroke:#4b45b2}' +
    '.nt-item.nt-danger .nt-item-label svg{stroke:var(--danger,#c0392b)}' +
    '.nt-label{font-size:11.5px;color:var(--muted,#767a92);margin:0 4px 6px;text-transform:uppercase;letter-spacing:.05em;font-weight:600}' +
    '.nt-backdrop{position:fixed;inset:0;z-index:360;background:rgba(15,15,35,.45);opacity:0;pointer-events:none;transition:opacity .2s ease}' +
    '.nt-backdrop.open{opacity:1;pointer-events:auto}' +
    '.nt-sheet{position:fixed;left:0;right:0;bottom:0;z-index:361;background:var(--surface,#fff);' +
      'border-radius:18px 18px 0 0;padding:8px 16px calc(16px + env(safe-area-inset-bottom,0px));' +
      'max-height:85vh;overflow-y:auto;transform:translateY(105%);transition:transform .25s ease;' +
      'box-shadow:0 -10px 40px rgba(0,0,0,.18);font-family:var(--font-body,inherit)}' +
    '.nt-sheet.open{transform:translateY(0)}' +
    '.nt-handle{width:36px;height:4px;border-radius:2px;background:var(--hairline-strong,#ccc);margin:4px auto 12px}' +
    '.nt-email{font-size:12.5px;color:var(--muted,#767a92);margin:1px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.nt-group{background:var(--surface-2,#f6f6f8);border-radius:12px;overflow:hidden;margin-bottom:12px}' +
    '.nt-item{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:50px;padding:0 16px;' +
      'background:none;border:0;border-bottom:1px solid var(--hairline,#e5e5e5);color:var(--ink,#1a1a2e);' +
      'font-family:inherit;font-size:16px;text-align:left;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
    '.nt-group .nt-item:last-child{border-bottom:0}' +
    '.nt-item.active{color:#4b45b2;font-weight:600}' +
    '.nt-item::after{content:"\\203A";color:var(--muted,#999);font-size:20px}' +
    '.nt-item.nt-danger{color:var(--danger,#c0392b)}' +
    '.nt-item.nt-danger::after{content:none}' +
    '.nt-item.nt-soon{opacity:.55}' +
    '.nt-item.nt-soon::after{content:none}';
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

  // ---------- header menu + sheet ----------
  // The bottom tab bar is rendered by nav.js. This adds the sheet for
  // everything that isn't one of its four tabs.
  // Tools come from nav.js's NAV_TOOL_GROUPS (same groups as the website's
  // Tools menu). Fallback only if that's missing for some reason.
  var TOOL_GROUPS = window.NAV_TOOL_GROUPS || [{ label: 'Tools', items: [
    { key: 'refurb', href: '/refurb.html', label: 'Refurb Estimator' },
    { key: 'letters', href: '/letters.html', label: 'Letter Templates' }
  ] }];
  var TOOL_ICONS = { refurb: 'refurb', letters: 'letters' };

  // Same line icons as the website's account menu (nav.js).
  function ic(name) {
    var icons = window.NAV_MENU_ICONS || {};
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (icons[name] || '') + '</svg>';
  }
  function label(icon, text) { return '<span class="nt-item-label">' + ic(icon) + text + '</span>'; }

  function buildTabBar() {
    var navRoot = document.getElementById('nav-root');
    if (!navRoot || document.getElementById('nt-sheet')) return;
    var active = navRoot.dataset.active || '';
    var topbar = navRoot.querySelector('.topbar');
    if (!topbar) return;

    var moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'nt-menu-btn';
    moreBtn.id = 'nt-more-btn';
    moreBtn.setAttribute('aria-haspopup', 'dialog');
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.setAttribute('aria-label', 'Account menu');
    moreBtn.innerHTML = '<span class="user-avatar" data-account-initials aria-hidden="true"></span>';
    topbar.appendChild(moreBtn);

    var backdrop = document.createElement('div');
    backdrop.className = 'nt-backdrop';
    backdrop.id = 'nt-backdrop';

    var sheet = document.createElement('div');
    sheet.className = 'nt-sheet';
    sheet.id = 'nt-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Account menu');
    sheet.innerHTML =
      '<div class="nt-handle"></div>' +
      '<div class="nt-head"><span class="user-avatar" data-account-initials aria-hidden="true"></span>' +
        '<div class="nt-who"><p class="nt-name" data-account-name>Your account</p><p class="nt-email" data-account-email></p></div></div>' +
      TOOL_GROUPS.map(function (g) {
        return '<p class="nt-label">' + g.label + '</p><div class="nt-group">' +
          g.items.map(function (p) {
            var icon = TOOL_ICONS[p.key] || 'calculator';
            if (p.soon) return '<span class="nt-item nt-soon" aria-disabled="true">' + label(icon, p.label + ' <span class="soon-pill">Coming soon</span>') + '</span>';
            return '<a class="nt-item' + (p.key === active ? ' active' : '') + '" href="' + p.href + '">' + label(icon, p.label) + '</a>';
          }).join('') + '</div>';
      }).join('') +
      '<div class="nt-group">' +
        '<a class="nt-item' + (active === 'settings' ? ' active' : '') + '" href="/settings.html">' + label('settings', 'Settings') + '</a>' +
        '<a class="nt-item' + (active === 'billing' ? ' active' : '') + '" href="/billing.html">' + label('billing', 'Plan') + '</a>' +
        '<a class="nt-item" href="/settings.html#goals" id="nt-goals">' + label('goals', 'Your goals') + '</a>' +
        '<a class="nt-item' + (active === 'help' ? ' active' : '') + '" href="/help.html">' + label('help', 'Help &amp; tutorial') + '</a>' +
        '<button type="button" class="nt-item" id="nt-contact">' + label('contact', 'Contact us') + '</button>' +
        '<a class="nt-item" href="/privacy.html">' + label('privacy', 'Privacy policy') + '</a>' +
      '</div>' +
      '<div class="nt-group">' +
        '<button type="button" class="nt-item nt-danger" id="nt-logout">' + label('logout', 'Log out') + '</button>' +
      '</div>';

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
    if (window.NavAccount) NavAccount.apply();
    function openSheet() {
      if (window.NavAccount) NavAccount.apply();
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


    // Already on Settings: the link only changes the #hash, so close the sheet.
    document.getElementById('nt-goals').addEventListener('click', closeSheet);

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

  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})();
