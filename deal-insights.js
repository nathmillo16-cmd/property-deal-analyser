// deal-insights.js: deal verdict, headline max bids, stress test and the
// phone sticky summary on the calculator (index.html).
//
// NO MATHS OF ITS OWN. Every figure here comes from calc-engine.js:
//  - the normal figures are the btlData/hmoData/saData/flipData objects the
//    real calculation just stored;
//  - the "what if" figures (stress test, BRRR money-out max bid) come from
//    running the SAME shipped engine functions again in a sandbox. The
//    sandbox is built from the functions' own source text (so it can never
//    drift from the real engine) and is given a stand-in `document` that
//    reads the page's real inputs, swaps in the few test values, and throws
//    away anything the engine writes. The page itself is never touched.
//
// Must load straight after calc-engine.js, before index.html wraps cBTL/etc.

(function () {
  // ---------- sandboxed engine ----------
  var ENGINE_FNS = [stamp, mort, mortRepay, fmt, fP, cl, s, numOr, moneyVal, cBTL, cHMO, cSA, cFlip];
  var factory = new Function('document', 'getDDValue',
    'let btlData={}, hmoData={}, saData={}, flipData={};\n' +
    ENGINE_FNS.map(function (f) { return f.toString(); }).join('\n') +
    '\nreturn function(t){' +
    'if(t==="btl"){cBTL();return btlData;}' +
    'if(t==="hmo"){cHMO();return hmoData;}' +
    'if(t==="sa"){cSA();return saData;}' +
    'cFlip();return flipData;};');

  function stub(v) { return { value: v == null ? '' : String(v), textContent: '', innerHTML: '', className: '' }; }

  // Runs the real engine for one strategy with some inputs replaced.
  // overrides: { inputId: value }. Returns that strategy's data object.
  // When a "Make it realistic" cost (bridge, holding costs) is switched on,
  // deal-realistic.js adds it here too, so every what-if figure matches the
  // main results. With every toggle off this changes nothing.
  function runEngine(strategy, overrides) {
    overrides = overrides || {};
    if (window.DealRealistic) overrides = window.DealRealistic.engineOverrides(strategy, overrides);
    var fakeDoc = {
      getElementById: function (id) {
        if (Object.prototype.hasOwnProperty.call(overrides, id)) return stub(overrides[id]);
        var real = document.getElementById(id);
        return real ? stub(real.value) : null;
      }
    };
    var dd = function (id) { return typeof window.getDDValue === 'function' ? window.getDDValue(id) : null; };
    return factory(fakeDoc, dd)(strategy);
  }

  // Same engine, but its output goes to the real page (only the inputs in
  // `overrides` are swapped). Used for the main results when a "Make it
  // realistic" cost is switched on.
  function runEngineOnPage(strategy, overrides) {
    var fakeDoc = {
      getElementById: function (id) {
        if (Object.prototype.hasOwnProperty.call(overrides, id)) return stub(overrides[id]);
        return document.getElementById(id);
      }
    };
    var dd = function (id) { return typeof window.getDDValue === 'function' ? window.getDDValue(id) : null; };
    return factory(fakeDoc, dd)(strategy);
  }

  // ---------- reading the figures ----------
  // Verdict rules, key maps and formatters live in deal-verdict.js (shared
  // with the Deals page cards). Same functions, just defined there.
  var V = window.DealVerdict;
  var MODE_LABEL = V.MODE_LABEL, CF_KEY = V.CF_KEY, ROI_KEY = V.ROI_KEY, CASH_IN_KEY = V.CASH_IN_KEY;
  var metrics = V.metrics, rentalVerdict = V.rentalVerdict, flipVerdict = V.flipVerdict;
  var money = V.money, pct = V.pct, num = V.num, esc = V.esc, roiText = V.roiText, vsAsking = V.vsAsking, modeText = V.modeText;

  var PREFIX = { btl: 'b', hmo: 'h', sa: 'sa', flip: 'fl' };
  var PP_ID = { btl: 'b-pp', hmo: 'h-pp', sa: 'sa-pp' };

  function dataOf(st) {
    return st === 'btl' ? btlData : st === 'hmo' ? hmoData : st === 'sa' ? saData : flipData;
  }

  // Which financing view is showing for a strategy's panel.
  function activeMode(st) {
    if (st === 'flip') return null;
    if (st === 'btl' && typeof currentTab !== 'undefined' && currentTab === 'brrr') return 'brrr';
    var p = document.querySelector('#panel-' + st + ' .fin-panel.active');
    var mode = p ? p.dataset.mode : 'm';
    if (st === 'btl' && mode === 'brrr') mode = 'm';
    return mode;
  }

  // ---------- BRRR: max bid to get all your money out ----------
  // Highest purchase price where the engine's "money left in deal" (bbMLI)
  // is £0 or less. Money left in only rises with price (price, fees and
  // stamp duty all go up, the refinance loan stays fixed on end value), so a
  // simple halving search finds it. Returns null if not achievable at any price.
  function brrrMoneyOutBid(st, d) {
    var loan = d.brrrLoan;
    if (!(loan > 0)) return null;
    var mliAt = function (p) { var o = {}; o[PP_ID[st]] = p; return runEngine(st, o).bbMLI; };
    if (mliAt(0) > 0) return null;
    var lo = 0, hi = loan;
    for (var i = 0; i < 50; i++) {
      var mid = (lo + hi) / 2;
      if (mliAt(mid) <= 0) lo = mid; else hi = mid;
    }
    return Math.floor(lo);
  }

  // ---------- stress test ----------
  // Interest rate +2 points, 2 months empty a year (10 months of rent, or
  // for SA occupancy x 10/12), refurb +20%. Fed into the real engine.
  var STRESS_NOTE = 'Rate +2%, 2 months empty each year, refurb +20%';
  function stressOverrides(st, d) {
    var o = {};
    if (st === 'btl') {
      o['b-mr'] = d.mr + 2; o['b-rent'] = d.rent * 10 / 12; o['b-ref'] = d.ref * 1.2;
    } else if (st === 'hmo') {
      o['h-mr'] = d.mr + 2; o['h-ref'] = d.ref * 1.2;
      for (var i = 1; i <= 4; i++) o['h-r' + i + 'p'] = moneyVal('h-r' + i + 'p') * 10 / 12;
    } else if (st === 'sa') {
      o['sa-mr'] = d.mr + 2; o['sa-occ'] = d.occ * 10 / 12; o['sa-ref'] = d.ref * 1.2;
    }
    return o;
  }

  var lastSummary = {};

  function verdictHtml(v, mode) {
    return '<div class="di-verdict di-' + v.level + '" role="status">' +
      '<span class="di-dot" aria-hidden="true"></span><div class="di-v-text">' +
      '<p class="di-v-title">' + esc(v.label) + (mode ? ' <span class="di-v-mode">on ' + MODE_LABEL[mode] + '</span>' : '') + '</p>' +
      '<p class="di-v-reason">' + esc(v.reason) + '</p></div></div>';
  }
  function bidHtml(label, value, note, isMsg) {
    return '<div class="di-bid"><p class="di-bid-l">' + esc(label) + '</p>' +
      '<p class="di-bid-v' + (isMsg ? ' di-bid-msg' : '') + '">' + esc(value) + '</p>' +
      (note ? '<p class="di-bid-n">' + esc(note) + '</p>' : '') + '</div>';
  }

  // ---------- buy box (Tools > Buy box) ----------
  // "Fits 3 of 4" next to the verdict, from the figures on screen and the
  // financing tab showing. Area, property type and bedrooms are only on a
  // saved deal's page, so they're left out here. Needs planning-tools.js.
  var buyBox = null;
  function buyBoxHtml(st, mode, d) {
    var B = window.PlanningTools && window.PlanningTools.buyBox;
    if (!B || !buyBox || !B.isSet(buyBox)) return '';
    var deal = { deal_type: st, deal_data: Object.assign({}, d, { strategy: mode === 'brrr' ? 'brrr' : undefined }) };
    var r = B.score(deal, buyBox, { mode: mode || undefined, skip: ['areas', 'property_types', 'bedrooms'] });
    if (!r.total) return '';
    return '<details class="di-bb"><summary><span class="di-bb-l">Buy box</span>' + B.badgeHtml(r) + '</summary>' + B.listHtml(r) +
      '<p class="di-bb-n">Area, property type and bedrooms are checked once you save the deal and add them on its page. <a href="/buy-box.html">Edit your buy box</a></p></details>';
  }
  document.addEventListener('DOMContentLoaded', function () {
    if (!window.NavAccount || !window.PlanningTools) return;
    window.NavAccount.ready.then(function (nav) {
      var b = nav && nav.profile ? nav.profile.buy_box : null;
      if (!b || !window.PlanningTools.buyBox.isSet(b)) return;
      buyBox = b;
      ['btl', 'hmo', 'sa', 'flip'].forEach(function (st) { var d = dataOf(st); if (d && d.pp > 0) render(st); });
    });
  });

  function render(st) {
    if (st === 'brrr') st = 'btl';
    var box = document.getElementById(PREFIX[st] + '-insights');
    if (!box) return;
    var d = dataOf(st) || {};
    if (!(d.pp > 0)) { box.innerHTML = ''; clearStress(st); lastSummary[st] = null; if (window.DealPlanning) DealPlanning.clear(st); if (window.DealRealistic) DealRealistic.clear(st); scheduleSticky(); return; }

    if (st === 'flip') {
      var fv = flipVerdict(d);
      box.innerHTML = verdictHtml(fv, null) + buyBoxHtml('flip', null, d);
      lastSummary.flip = { level: fv.level, label: fv.label, nums: [
        { l: 'Profit', v: money(d.profit) }, { l: 'ROI', v: pct(d.roi) }, { l: 'Margin', v: pct(d.margin) }] };
      if (window.DealRealistic) DealRealistic.render('flip');
      scheduleSticky();
      return;
    }

    var mode = activeMode(st);
    var m = metrics(st, mode, d);
    var v = rentalVerdict(m, mode);

    var bids = '';
    if (d.oY > 0) bids += bidHtml('Max bid for a ' + num(m.ty) + '% yield', money(d.oY), vsAsking(d.oY, d.pp));
    else bids += bidHtml('Max bid for a ' + num(m.ty) + '% yield', 'Add the rent to work this out', '', true);
    if (mode === 'brrr') {
      var mob = brrrMoneyOutBid(st, d);
      if (mob != null && mob > 0) bids += bidHtml('Max bid to get all your money out', money(mob), vsAsking(mob, d.pp));
      else bids += bidHtml('Max bid to get all your money out', 'Not achievable. The refinance loan does not cover the fees and refurb on their own.', '', true);
    }
    box.innerHTML = verdictHtml(v, mode) + buyBoxHtml(st, mode, d) + '<div class="di-bids">' + bids + '</div>';

    lastSummary[st] = { level: v.level, label: v.label, nums: mode === 'brrr'
      ? [{ l: 'Left in', v: m.allOut ? '£0' : money(m.cashIn) }, { l: 'Cashflow /mo', v: money(m.cf) }, { l: 'ROI', v: m.allOut ? 'All out' : pct(m.roi) }]
      : [{ l: 'Cashflow /mo', v: money(m.cf) }, { l: 'ROI', v: pct(m.roi) }, { l: 'Yield', v: pct(m.gy) }] };

    renderStress(st, mode, d, m);
    if (window.DealPlanning) DealPlanning.render(st);
    if (window.DealRealistic) DealRealistic.render(st);
    scheduleSticky();
  }

  function clearStress(st) {
    var el = document.getElementById(PREFIX[st] + '-stress');
    if (el) el.innerHTML = '';
    var sum = document.getElementById(PREFIX[st] + '-sec-stress-sum');
    if (sum) sum.textContent = '';
  }

  // Stress test lives in its own collapsed section below the Full breakdown
  // (#PREFIX-sec-stress in index.html). The figures are always worked out,
  // so the one-line summary shows even while the section is closed.
  function renderStress(st, mode, d, m) {
    var el = document.getElementById(PREFIX[st] + '-stress');
    if (!el) return;
    var sd = runEngine(st, stressOverrides(st, d));
    var sm = metrics(st, mode, sd);
    var pass = sm.cf > 0;
    var cashLabel = mode === 'brrr' ? 'Money left in' : 'Cash in';
    var rows = [
      ['Monthly cashflow', money(m.cf), money(sm.cf)],
      ['ROI', roiText(m), roiText(sm)],
      ['Gross yield', pct(m.gy), pct(sm.gy)],
      [cashLabel, mode === 'brrr' && m.cashIn <= 0 ? '£0' : money(m.cashIn), mode === 'brrr' && sm.cashIn <= 0 ? '£0' : money(sm.cashIn)]
    ];
    var sum = document.getElementById(PREFIX[st] + '-sec-stress-sum');
    if (sum) sum.textContent = pass
      ? 'still ' + money(sm.cf) + ' a month positive'
      : 'goes negative, ' + money(sm.cf) + ' a month';
    el.innerHTML = '<div class="di-stress">' +
      '<span class="di-stress-note">' + STRESS_NOTE + '</span>' +
      '<p class="di-stress-result ' + (pass ? 'di-pass' : 'di-fail') + '">' +
      (pass ? 'Still cashflow positive' : 'Goes negative under stress') +
      '<span>' + money(sm.cf) + ' a month when stressed, on ' + modeText(mode) + '</span></p>' +
      '<div class="di-table-wrap"><table class="di-table"><thead><tr><th scope="col"></th><th scope="col">Normal</th><th scope="col">Stressed</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><th scope="row">' + r[0] + '</th><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>'; }).join('') +
      '</tbody></table></div></div>';
  }

  // ---------- sticky summary (phones and the iOS app) ----------
  var bar = null, stickyQueued = false;
  function isPhoneView() {
    return document.documentElement.classList.contains('native-app') || window.matchMedia('(max-width:760px)').matches;
  }
  function panelStrategy() {
    if (typeof currentTab === 'undefined') return null;
    if (currentTab === 'comps') return null;
    return currentTab === 'brrr' ? 'btl' : currentTab;
  }
  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'di-sticky';
    bar.className = 'di-sticky';
    bar.hidden = true;
    bar.innerHTML = '<button type="button" class="di-sticky-btn" aria-label="Show full results"></button>';
    bar.firstChild.addEventListener('click', function () {
      var st = panelStrategy();
      var col = st && document.querySelector('#panel-' + st + ' .results-col');
      if (col) col.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.body.appendChild(bar);
    return bar;
  }
  function scheduleSticky() {
    if (stickyQueued) return;
    stickyQueued = true;
    setTimeout(function () { stickyQueued = false; updateSticky(); }, 0);
  }
  function updateSticky() {
    var b = ensureBar();
    var st = panelStrategy();
    var col = st && document.querySelector('#panel-' + st + ' .results-col');
    var sum = st && lastSummary[st];
    var show = !!(isPhoneView() && col && sum && !col.classList.contains('warning-hold') &&
      col.getBoundingClientRect().top > window.innerHeight - 150);
    if (show) {
      var html = '<span class="di-sticky-v di-' + sum.level + '"><span class="di-dot" aria-hidden="true"></span>' +
        esc(sum.label.replace(' deal', '')) + '</span>' +
        sum.nums.map(function (n) { return '<span class="di-sticky-n"><b>' + esc(n.v) + '</b><small>' + esc(n.l) + '</small></span>'; }).join('') +
        '<span class="di-sticky-go" aria-hidden="true">&#8250;</span>';
      if (b.firstChild.innerHTML !== html) b.firstChild.innerHTML = html;
      placeAboveKeyboard();
    }
    if (b.hidden === show) b.hidden = !show;
  }
  // While typing, the tab bar hides (nav.js adds body.tabbar-kb), so the bar
  // drops to the bottom edge, lifted above the on-screen keyboard if the
  // browser reports one.
  function placeAboveKeyboard() {
    if (!bar) return;
    var vv = window.visualViewport;
    var kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    bar.style.setProperty('--di-kb', kb + 'px');
  }
  window.addEventListener('scroll', scheduleSticky, { passive: true });
  window.addEventListener('resize', scheduleSticky);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleSticky);
    window.visualViewport.addEventListener('scroll', scheduleSticky);
  }
  document.addEventListener('focusin', scheduleSticky);
  document.addEventListener('focusout', scheduleSticky);

  // ---------- styles ----------
  var css =
    '.deal-insights:empty,.deal-stress:empty{display:none}' +
    '.deal-insights{margin:0 0 1.1rem}' +
    '.di-verdict{display:flex;gap:.7rem;align-items:flex-start;border-radius:12px;padding:.8rem .95rem;border:1px solid}' +
    '.di-verdict.di-good{background:var(--success-bg);border-color:var(--success);color:var(--success-ink)}' +
    '.di-verdict.di-warn{background:var(--warn-bg);border-color:var(--warn);color:var(--warn-ink)}' +
    '.di-verdict.di-bad{background:var(--danger-bg);border-color:var(--danger);color:var(--danger-ink)}' +
    '.di-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0;display:inline-block;background:currentColor}' +
    '.di-verdict .di-dot{margin-top:4px}' +
    '.di-good .di-dot{background:var(--success)}.di-warn .di-dot{background:var(--warn)}.di-bad .di-dot{background:var(--danger)}' +
    '.di-v-text{min-width:0}' +
    '.di-v-title{margin:0;font-weight:700;font-size:15.5px;line-height:1.3}' +
    '.di-v-mode{font-weight:500;font-size:12.5px;opacity:.8}' +
    '.di-v-reason{margin:.15rem 0 0;font-size:13px;line-height:1.45}' +
    '.di-bids{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:10px}' +
    '.di-bid{border:1.5px solid var(--accent);background:rgba(75,69,178,.05);border-radius:12px;padding:.75rem .9rem;min-width:0}' +
    '.di-bid-l{margin:0 0 4px;font-size:11.5px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--muted)}' +
    '.di-bid-v{margin:0;font-weight:700;font-size:24px;color:var(--accent);font-variant-numeric:tabular-nums;line-height:1.2}' +
    '.di-bid-v.di-bid-msg{font-size:13px;font-weight:600;line-height:1.4;color:var(--ink)}' +
    '.di-bid-n{margin:3px 0 0;font-size:11.5px;color:var(--muted)}' +
    
    '.di-stress{padding:0}' +
    '.di-stress-note{display:block;font-size:12.5px;color:var(--muted)}' +
    '.di-stress-result{margin:.7rem 0 .55rem;font-weight:700;font-size:14px;border-radius:8px;padding:.5rem .7rem}' +
    '.di-stress-result span{display:block;font-weight:500;font-size:12.5px;margin-top:2px}' +
    '.di-pass{background:var(--success-bg);color:var(--success-ink)}' +
    '.di-fail{background:var(--danger-bg);color:var(--danger-ink)}' +
    '.di-table-wrap{overflow-x:auto}' +
    '.di-table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}' +
    '.di-table th,.di-table td{padding:.4rem .3rem;border-bottom:1px solid var(--hairline);text-align:right;white-space:nowrap}' +
    '.di-table thead th{font-size:11.5px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em}' +
    '.di-table tbody th{text-align:left;font-weight:500;color:var(--muted)}' +
    '.di-table tbody td{font-weight:700;color:var(--ink)}' +
    '.di-table tbody tr:last-child th,.di-table tbody tr:last-child td{border-bottom:0}' +
    '.results-col{scroll-margin-top:calc(12px + env(safe-area-inset-top, 0px))}' +
    // Sticky summary: above the tab bar (64px + home indicator), or at the
    // bottom edge / above the keyboard while typing.
    '.di-sticky{position:fixed;left:0;right:0;z-index:345;bottom:calc(64px + env(safe-area-inset-bottom, 0px));' +
      'padding:0 calc(10px + env(safe-area-inset-right, 0px)) 8px calc(10px + env(safe-area-inset-left, 0px));pointer-events:none}' +
    'body.tabbar-kb .di-sticky{bottom:var(--di-kb,0px);padding-bottom:calc(8px + env(safe-area-inset-bottom, 0px))}' +
    'body:not(.has-tabbar) .di-sticky{bottom:0;padding-bottom:calc(8px + env(safe-area-inset-bottom, 0px))}' +
    '.di-sticky-btn{pointer-events:auto;width:100%;display:flex;align-items:center;gap:10px;min-height:52px;padding:6px 12px;' +
      'background:var(--surface,#fff);border:1px solid var(--hairline,#e5e5e5);border-radius:14px;box-shadow:0 6px 22px rgba(20,20,40,.14);' +
      'font-family:var(--font-body,inherit);color:var(--ink);cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent}' +
    '.di-sticky-v{display:flex;align-items:center;gap:6px;font-weight:700;font-size:12.5px;flex-shrink:0;max-width:86px;line-height:1.15}' +
    '.di-sticky-v.di-good{color:var(--success-ink)}.di-sticky-v.di-warn{color:var(--warn-ink)}.di-sticky-v.di-bad{color:var(--danger-ink)}' +
    '.di-sticky-n{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;line-height:1.15}' +
    '.di-sticky-n b{font-size:14px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}' +
    '.di-sticky-n small{font-size:10.5px;color:var(--muted);white-space:nowrap}' +
    '.di-sticky-go{font-size:22px;color:var(--muted);flex-shrink:0;line-height:1}' +
    '@media(max-width:360px){.di-sticky-btn{gap:7px;padding:6px 9px}.di-sticky-n b{font-size:13px}.di-sticky-v{font-size:11.5px}}';
  css += '.di-bb{margin:10px 0 0;border:1px solid var(--hairline);border-radius:12px;padding:0 12px;background:var(--surface)}' +
    '.di-bb>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;font-size:13px;font-weight:600;color:var(--ink)}' +
    '.di-bb>summary::-webkit-details-marker{display:none}' +
    '.di-bb>summary::after{content:"+";color:var(--accent);font-size:18px;margin-left:auto}' +
    '.di-bb[open]>summary::after{content:"\\2212"}' +
    '.di-bb-l{flex-shrink:0}' +
    '.di-bb .bb-list{padding-bottom:4px}' +
    '.di-bb-n{font-size:12px;color:var(--muted);margin:4px 0 10px;line-height:1.5}';
  var style = document.createElement('style');
  style.id = 'deal-insights-styles';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  window.DealInsights = {
    render: render,
    renderAll: function () { ['btl', 'hmo', 'sa', 'flip'].forEach(render); },
    // Shared with deal-planning.js so its verdicts and figures match these.
    metrics: metrics,
    rentalVerdict: rentalVerdict,
    activeMode: activeMode,
    dataOf: dataOf,
    money: money,
    pct: pct,
    esc: esc,
    MODE_LABEL: MODE_LABEL,
    updateSticky: scheduleSticky,
    runEngine: runEngine,
    runEngineOnPage: runEngineOnPage,
    brrrMoneyOutBid: function (st) { return brrrMoneyOutBid(st, dataOf(st)); },
    stressFigures: function (st) { return runEngine(st, stressOverrides(st, dataOf(st))); }
  };
})();
