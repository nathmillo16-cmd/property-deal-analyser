// onboarding-tutorial.js — shared spotlight-style walkthrough, reusable
// across every logged-in page. All content lives in TUTORIAL_STEPS below;
// add a step there and it just works, no other file needs to change.
//
// Each step names the page it belongs to (matched against the current
// page's own filename) and a list of candidate CSS selectors for the real
// UI element to spotlight — the first visible match wins. A step with no
// selectors (the welcome step) renders as a centred card with a plain dim
// background instead of a spotlight, since there's nothing specific to
// point at yet.
//
// CROSS-PAGE: since several steps live on different pages, an in-progress
// tour has to survive real page navigations. A small state object
// (dny-tutorial-state, in localStorage) tracks "which step was I on" for
// that purpose only — it is NOT the permanent "don't auto-trigger again"
// record. That record is server-side, on the user's profile
// (has_completed_tutorial), set once the tour finishes or is skipped, via
// POST /api/profile/tutorial-complete. Keeping these separate is what
// makes "Replay Tutorial" work correctly: it can always restart the tour
// (by writing fresh local state) without needing to touch, or care about,
// the server-side flag at all.
//
// STALENESS: if the local state is older than TUTORIAL_STALE_MS, it's
// treated as abandoned (the user left mid-tour via a normal nav link
// rather than Skip/Next) and quietly ignored rather than resumed — so the
// overlay can't reappear unannounced on some unrelated page visit days
// later. The server-side flag is untouched in that case, so a genuinely
// fresh, non-stale attempt will still auto-trigger correctly next time the
// user lands on the dashboard.
//
// FAILS GRACEFULLY: a step whose target element doesn't exist on the
// current page (a locked paid feature, an empty list, a different active
// tab) is skipped automatically — the tour moves on to the next step
// rather than showing a spotlight over nothing or breaking the page.

var TUTORIAL_STORAGE_KEY = 'dny-tutorial-state';
var TUTORIAL_STALE_MS = 30 * 60 * 1000; // 30 minutes

var TUTORIAL_STEPS = [
  {
    id: 'welcome',
    page: 'home.html',
    selectors: [],
    title: 'Welcome to PROPulsion',
    body: "This tool analyses a property deal in seconds: enter a listing's headline numbers and get a full breakdown before you make an offer."
  },
  {
    id: 'start-deal',
    page: 'home.html',
    selectors: ['.header-row .btn-primary'],
    title: 'Start a new deal',
    // PLACEHOLDER — please review: the brief listed "BTL/BRRR/HMO/SA" as
    // the entry-point strategies, but this app's calculator only has BTL,
    // HMO, Serviced Accommodation and Flip (no BRRR strategy exists) — Flip
    // is named here instead. Flagging for your review per the brief.
    body: 'Click here to analyse a property. Choose Buy-to-Let, HMO, Serviced Accommodation or Flip, depending on your strategy.'
  },
  {
    id: 'results-panel',
    page: 'index.html',
    selectors: ['.panel.active .results-col'],
    title: 'Reading your results',
    body: "Gross yield is the rent as a percentage of the property's value; ROI is the return on the cash you've actually put in. Use the tabs above the numbers to compare Cash, Interest-only and Repayment."
  },
  {
    id: 'save-deal',
    page: 'index.html',
    selectors: ['.panel.active .results-col .save-btn'],
    title: 'Save the deal',
    // The "Get the Full Analysis" button just below Save is real and
    // always clickable (it's not disabled in the app) — it's the paid
    // AI verdict, gated server-side (POST /analyse returns 403 "Upgrade to
    // unlock" for a free plan). It only LOOKED greyed-out in an earlier
    // review screenshot because it sat outside this step's own spotlight
    // and got dimmed by the tutorial's overlay, not because it's actually
    // disabled — confirmed by reading index.html/server.js directly, not
    // guessed. Naming it here so a free user isn't left wondering what it
    // is when they notice it right next to what's being spotlighted.
    body: "Happy with the numbers? Save the deal here. Every deal you save is kept on your Saved Deals page so you can come back to it anytime. (The \"Get the Full Analysis\" button below runs an AI verdict on the deal, part of the paid plan.)"
  },
  {
    id: 'compare-deals',
    page: 'saved-deals.html',
    selectors: ['#compare-bar', '#saved-list'],
    title: 'Compare deals side by side',
    // Wording deliberately works whether this lands on the real compare bar
    // (deals already saved) or its empty-state fallback below (a brand new
    // account, which is the common case right after signup) — verified
    // against both during testing.
    body: "Once you've saved a couple of deals, tick their checkboxes here to line the numbers up side by side and see which one comes out on top."
  },
  {
    id: 'pipeline',
    page: 'pipeline.html',
    selectors: ['#kanban', '#state-locked .locked-panel'],
    title: 'Track deals through your pipeline',
    body: 'A deal you’re pursuing moves through five stages here: Analysing, Viewing, Offered, Agreed, and Completed.'
  },
  {
    id: 'portfolio',
    page: 'portfolio.html',
    selectors: ['#pf-summary-grid', '#pf-empty-state', '#state-locked .locked-panel'],
    title: 'Your portfolio',
    body: 'Once you actually complete on a property, add it here to track its rent, running costs and cashflow alongside everything else you own.'
  },
  {
    id: 'settings-help',
    page: 'settings.html',
    selectors: ['#btn-replay-tutorial'],
    title: 'Settings and help',
    // PLACEHOLDER — please review: there's no dedicated help/support page
    // in the app yet, so this only covers Settings/Replay as requested.
    // Swap in a real contact method once one exists.
    body: 'Your account, subscription and defaults all live in Settings. You can replay this tutorial from here anytime you want a refresher.'
  }
];

(function () {

  var state = { active: false, stepIndex: 0, startedAt: 0 };
  var authToken = null;
  var overlayEl = null, spotlightEl = null, cardEl = null;
  var reposition = null;

  function loadState() {
    try {
      var raw = localStorage.getItem(TUTORIAL_STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.active || typeof parsed.stepIndex !== 'number') return null;
      if (Date.now() - (parsed.startedAt || 0) > TUTORIAL_STALE_MS) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function saveState(s) {
    try { localStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function clearState() {
    try { localStorage.removeItem(TUTORIAL_STORAGE_KEY); } catch (e) {}
  }

  function currentPage() {
    var path = window.location.pathname;
    var seg = path.substring(path.lastIndexOf('/') + 1);
    return seg || 'home.html';
  }

  function ensureStyles() {
    if (document.getElementById('tutorial-styles')) return;
    var style = document.createElement('style');
    style.id = 'tutorial-styles';
    style.textContent =
      '.tut-overlay-flat{position:fixed;inset:0;background:rgba(15,15,35,.6);z-index:99998}' +
      '.tut-spotlight{position:fixed;z-index:99998;border-radius:10px;border:2px solid var(--accent,#4b45b2);' +
        'box-shadow:0 0 0 9999px rgba(15,15,35,.55);pointer-events:none;' +
        'transition:top .15s ease,left .15s ease,width .15s ease,height .15s ease}' +
      '.tut-card{position:fixed;z-index:99999;width:300px;max-width:calc(100vw - 24px);' +
        'background:var(--surface,#fff);color:var(--ink,#1a1a2e);border-radius:var(--radius,12px);' +
        'box-shadow:0 10px 40px rgba(0,0,0,.25);padding:1.1rem 1.25rem;' +
        'font-family:var(--font-body,-apple-system,sans-serif)}' +
      '.tut-card.tut-centered{top:50%;left:50%;transform:translate(-50%,-50%)}' +
      '.tut-count{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;' +
        'color:var(--muted,#767a92);margin:0 0 .5rem}' +
      '.tut-title{font-family:var(--font-head,inherit);font-size:16px;font-weight:600;margin:0 0 .4rem}' +
      '.tut-body{font-size:13.5px;line-height:1.5;margin:0 0 1rem}' +
      '.tut-actions{display:flex;align-items:center;justify-content:space-between;gap:1rem}' +
      '.tut-skip{background:none;border:none;color:var(--muted,#767a92);font-size:12.5px;' +
        'cursor:pointer;padding:0;text-decoration:underline}' +
      '.tut-nav{display:flex;gap:.5rem}' +
      '.tut-back{background:none;border:1px solid var(--hairline-strong,#ccc);color:var(--ink,#1a1a2e);' +
        'border-radius:8px;font-size:13px;padding:.4rem .75rem;cursor:pointer}' +
      '.tut-next{background:var(--accent,#4b45b2);border:none;color:#fff;border-radius:8px;' +
        'font-size:13px;font-weight:600;padding:.4rem .9rem;cursor:pointer}';
    document.head.appendChild(style);
  }

  function teardown() {
    if (reposition) {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      reposition = null;
    }
    [overlayEl, spotlightEl, cardEl].forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    overlayEl = spotlightEl = cardEl = null;
  }

  function finish() {
    teardown();
    clearState();
    state = { active: false, stepIndex: 0, startedAt: 0 };
    if (authToken) {
      fetch('/api/profile/tutorial-complete', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + authToken }
      }).catch(function () {});
    }
  }

  function findTarget(step) {
    if (!step.selectors || step.selectors.length === 0) return null;
    for (var i = 0; i < step.selectors.length; i++) {
      try {
        var el = document.querySelector(step.selectors[i]);
        if (el) {
          var r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return el;
        }
      } catch (e) {}
    }
    return null;
  }

  function positionSpotlight(target) {
    var r = target.getBoundingClientRect();
    var pad = 8;
    spotlightEl.style.top = Math.max(0, r.top - pad) + 'px';
    spotlightEl.style.left = Math.max(0, r.left - pad) + 'px';
    spotlightEl.style.width = (r.width + pad * 2) + 'px';
    spotlightEl.style.height = (r.height + pad * 2) + 'px';
  }

  function positionCard(target) {
    if (!target) {
      cardEl.classList.add('tut-centered');
      cardEl.style.top = ''; cardEl.style.left = '';
      return;
    }
    cardEl.classList.remove('tut-centered');
    var r = target.getBoundingClientRect();
    var cr = cardEl.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight, gap = 16;
    var top, left;
    if (r.bottom + gap + cr.height <= vh) { top = r.bottom + gap; left = r.left; }
    else if (r.top - gap - cr.height >= 0) { top = r.top - gap - cr.height; left = r.left; }
    else if (r.right + gap + cr.width <= vw) { top = r.top; left = r.right + gap; }
    else if (r.left - gap - cr.width >= 0) { top = r.top; left = r.left - gap - cr.width; }
    else { cardEl.classList.add('tut-centered'); cardEl.style.top = ''; cardEl.style.left = ''; return; }
    left = Math.max(12, Math.min(left, vw - cr.width - 12));
    top = Math.max(12, Math.min(top, vh - cr.height - 12));
    cardEl.style.top = top + 'px';
    cardEl.style.left = left + 'px';
  }

  function buildCard(step, index) {
    var el = document.createElement('div');
    el.className = 'tut-card';
    var total = TUTORIAL_STEPS.length;
    var isLast = index === total - 1;
    el.innerHTML =
      '<p class="tut-count">' + (index + 1) + ' of ' + total + '</p>' +
      '<h3 class="tut-title"></h3>' +
      '<p class="tut-body"></p>' +
      '<div class="tut-actions">' +
        '<button type="button" class="tut-skip">Skip</button>' +
        '<div class="tut-nav">' +
          (index > 0 ? '<button type="button" class="tut-back">Back</button>' : '') +
          '<button type="button" class="tut-next">' + (isLast ? 'Done' : 'Next') + '</button>' +
        '</div>' +
      '</div>';
    el.querySelector('.tut-title').textContent = step.title;
    el.querySelector('.tut-body').textContent = step.body;
    el.querySelector('.tut-skip').onclick = finish;
    el.querySelector('.tut-next').onclick = function () { activateStep(index + 1); };
    var backBtn = el.querySelector('.tut-back');
    if (backBtn) backBtn.onclick = function () { activateStep(index - 1); };
    return el;
  }

  // Forces an instant (non-smooth) scroll regardless of any page/global
  // CSS scroll-behavior, so the very next getBoundingClientRect() read is
  // guaranteed to reflect the final, settled position rather than a
  // mid-animation one.
  function scrollIntoViewInstant(el) {
    var root = document.documentElement;
    var prev = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    root.style.scrollBehavior = prev;
  }

  function showStep(step, index, target) {
    ensureStyles();
    teardown();

    if (target) {
      // A real target further down the page (e.g. a Save button below the
      // fold) is still a valid, visible element by our width/height check,
      // but the user can't see a spotlight drawn off-screen — bring it
      // into view first, before ever reading its position.
      scrollIntoViewInstant(target);
      spotlightEl = document.createElement('div');
      spotlightEl.className = 'tut-spotlight';
      document.body.appendChild(spotlightEl);
      positionSpotlight(target);
    } else {
      overlayEl = document.createElement('div');
      overlayEl.className = 'tut-overlay-flat';
      document.body.appendChild(overlayEl);
    }

    cardEl = buildCard(step, index);
    document.body.appendChild(cardEl);
    positionCard(target);

    if (target) {
      reposition = function () { positionSpotlight(target); positionCard(target); };
      window.addEventListener('resize', reposition);
      window.addEventListener('scroll', reposition, true);
    }
  }

  // The one place that both renders a step AND decides whether getting
  // there needs a real page navigation first — used identically by
  // Next/Back clicks, by starting fresh, by replaying, and by the
  // skip-a-missing-target chain below, so there's exactly one code path
  // that can ever move the tour from one step to another.
  function activateStep(index) {
    var step = TUTORIAL_STEPS[index];
    if (!step) { finish(); return; }

    state = { active: true, stepIndex: index, startedAt: state.startedAt || Date.now() };
    saveState(state);

    if (step.page !== currentPage()) {
      window.location.href = '/' + step.page;
      return;
    }

    var hasSelectors = step.selectors && step.selectors.length > 0;
    var target = hasSelectors ? findTarget(step) : null;

    if (hasSelectors && !target) {
      activateStep(index + 1); // not on this page right now — skip gracefully
      return;
    }

    showStep(step, index, target);
  }

  // Passive check on page load: renders the in-progress step ONLY if it
  // genuinely belongs on the page we're already on. Never navigates the
  // user anywhere on its own — that would mean a normal page visit could
  // suddenly redirect somewhere else just because a tour was left running
  // in the background.
  function resumeIfHere() {
    var s = loadState();
    if (!s) return;
    var step = TUTORIAL_STEPS[s.stepIndex];
    if (!step) { clearState(); return; }
    if (step.page !== currentPage()) return;
    state = s;
    activateStep(s.stepIndex);
  }

  window.Tutorial = {
    // Call on every participating page once auth resolves and that page's
    // own initial data has rendered. Resumes an in-progress tour if (and
    // only if) its current step belongs on this page; otherwise a no-op.
    resumeIfActive: function (token) {
      authToken = token || authToken;
      resumeIfHere();
    },

    // home.html only: everything resumeIfActive does, plus — if there's no
    // tour in flight anywhere and the account hasn't completed one yet —
    // starts a fresh one from step 1.
    enterDashboard: function (token, hasCompletedTutorial) {
      authToken = token || authToken;
      var existing = loadState();
      if (existing) { resumeIfHere(); return; }
      if (hasCompletedTutorial) return;
      activateStep(0);
    },

    // Settings' "Replay Tutorial" button. Always starts over from step 1,
    // regardless of has_completed_tutorial — this never reads that field.
    replay: function () {
      clearState();
      state = { active: true, stepIndex: 0, startedAt: Date.now() };
      activateStep(0);
    }
  };

})();
