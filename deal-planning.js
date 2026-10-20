// deal-planning.js: the calculator's extra results sections, each in its
// own collapsed section below the Full breakdown (index.html):
//   Lender check (BTL panel, both the BTL and BRRR tabs)
//   Refinance timing note (BRRR tab)
//   Compare strategies (BTL/BRRR, HMO, SA)
//   10-year projection (BTL/BRRR, HMO, SA)
//
// It never changes a main result. Every figure is either read from the
// btlData/hmoData/saData objects calc-engine.js just stored, or comes from
// re-running the same engine in deal-insights.js's sandbox
// (DealInsights.runEngine), which never touches the page. The only new
// arithmetic is the lender formula and the projection, both spelled out
// below. Their defaults live in deal-assumptions.js.
//
// Loads after deal-insights.js and deal-assumptions.js.

(function () {
  var CFG = window.DEAL_ASSUMPTIONS;
  var DI = window.DealInsights;
  if (!CFG || !DI) return;

  var PREFIX = { btl: 'b', hmo: 'h', sa: 'sa' };
  var money = DI.money, pct = DI.pct, esc = DI.esc;
  var STRAT_NAME = { btl: 'BTL', brrr: 'BRRR', hmo: 'HMO', sa: 'SA' };

  function $(id) { return document.getElementById(id); }
  function round100(v) { return Math.floor(v / 100) * 100; }
  function round1000(v) { return Math.round(v / 1000) * 1000; }
  function setSum(id, text, flag) {
    var el = $(id);
    if (el) el.textContent = text || '';
    var sec = el && el.closest('details');
    if (sec) sec.classList.toggle('rsec-flag', !!flag);
  }
  // Reads a number input; blank means "use the default". Returns NaN if
  // the user typed something that isn't a number.
  function readNum(id, def) {
    var el = $(id);
    if (!el) return def;
    var raw = String(el.value).replace(/,/g, '').trim();
    if (raw === '') return def;
    var n = +raw;
    return Number.isFinite(n) ? n : NaN;
  }
  function inputsFor(st) {
    var p = PREFIX[st];
    return { pp: p + '-pp', emv: p + '-emv', ref: p + '-ref' };
  }
  function rawVal(id) { var el = $(id); return el ? String(el.value).replace(/,/g, '') : ''; }

  // =====================================================================
  // 1. LENDER CHECK ("Will a lender lend this?")
  //   Max loan by rent = (annual rent / rent cover) / stress rate
  //   Max loan by LTV  = value x LTV
  //     BRRR: end market value x refinance LTV (the engine's refinance loan)
  //     BTL:  purchase price x (100% - deposit %) (the engine's mortgage loan)
  // =====================================================================
  function ownership() {
    var v = typeof getDDValue === 'function' ? getDDValue('b-lc-own') : null;
    return CFG.lender.ownershipTypes[v] ? v : CFG.lender.defaultOwnership;
  }
  function defaultCover(own) { return CFG.lender.ownershipTypes[own || ownership()].rentCover; }

  function lenderFigures(isBrrr, d) {
    var own = ownership();
    var stress = readNum('b-lc-stress', CFG.lender.stressRate);
    var cover = readNum('b-lc-cover', defaultCover(own));
    if (!(stress > 0) || !(cover > 0)) return null;
    var annualRent = d.rent * 12;
    var byRent = (annualRent / (cover / 100)) / (stress / 100);
    var byLtv = isBrrr ? d.brrrLoan : d.loan;
    var limitedByRent = byRent < byLtv - 0.5;
    return { own: own, stress: stress, cover: cover, annualRent: annualRent,
      byRent: byRent, byLtv: byLtv, limitedByRent: limitedByRent,
      lenderLoan: Math.min(byRent, byLtv) };
  }

  var lastLimited = { btl: null, brrr: null };

  function renderLender(d) {
    var body = $('b-lender');
    if (!body) return;
    var isBrrr = typeof currentTab !== 'undefined' && currentTab === 'brrr';
    var key = isBrrr ? 'brrr' : 'btl';
    var f = lenderFigures(isBrrr, d);
    var alerts = $('b-alerts');
    if (!f) { body.innerHTML = ''; setSum('b-sec-lender-sum', ''); if (alerts) alerts.innerHTML = ''; return; }

    var what = isBrrr ? 'refinance' : 'mortgage';
    var msg = f.limitedByRent
      ? 'Rent limits your ' + what + ' to ' + money(f.byRent) + ', not ' + money(f.byLtv) + '.'
      : 'Rent supports this ' + what + '. The ' + (isBrrr ? 'refinance LTV' : 'deposit') + ' limits the loan, not the rent.';
    if (!(d.rent > 0)) msg = 'Add the monthly rent to check what a lender will offer.';

    var ltvNote = isBrrr
      ? pct(d.brrrLtv) + ' of ' + money(d.emv) + ' end value'
      : pct(100 - d.dp) + ' of ' + money(d.pp) + ' purchase price';
    var rentNote = money(f.annualRent) + ' rent a year ÷ ' + pct(f.cover) + ' cover ÷ ' + pct(f.stress) + ' stress rate';

    var box = function (label, value, note, limits) {
      return '<div class="lc-box' + (limits ? ' lc-limits' : '') + '"><p class="lc-l">' + esc(label) +
        (limits ? ' <span class="lc-tag">Limits your loan</span>' : '') + '</p>' +
        '<p class="lc-v">' + money(value) + '</p><p class="lc-n">' + esc(note) + '</p></div>';
    };

    var html = '<p class="lc-msg ' + (f.limitedByRent ? 'lc-bad' : 'lc-ok') + '">' + esc(msg) + '</p>' +
      '<div class="lc-grid">' +
      box('Max loan by rent', f.byRent, rentNote, f.limitedByRent) +
      box('Max loan by LTV', f.byLtv, ltvNote, !f.limitedByRent) + '</div>';

    if (f.limitedByRent && d.rent > 0) {
      // Lender-limited figures: the SAME engine re-run with the loan cut to
      // what the rent supports. BRRR: refinance LTV lowered. BTL: deposit
      // raised. Nothing else changes.
      var over = {};
      var mode;
      if (isBrrr) {
        over['bb-refi-ltv'] = d.emv > 0 ? (f.byRent / d.emv) * 100 : 0;
        mode = 'brrr';
      } else {
        over['b-dp'] = d.pp > 0 ? (1 - f.byRent / d.pp) * 100 : 0;
        mode = DI.activeMode('btl') === 'r' ? 'r' : 'm';
      }
      var ld = DI.runEngine('btl', over);
      var m0 = DI.metrics('btl', mode, d), m1 = DI.metrics('btl', mode, ld);
      var left = function (m) { return m.allOut ? '£0' : money(m.cashIn); };
      var roi = function (m) { return m.allOut ? 'All money out' : pct(m.roi); };
      var rows = isBrrr ? [
        ['Refinance loan', money(d.brrrLoan), money(ld.brrrLoan)],
        ['Money left in deal', left(m0), left(m1)],
        ['Monthly cashflow', money(m0.cf), money(m1.cf)],
        ['ROI', roi(m0), roi(m1)]
      ] : [
        ['Mortgage loan', money(d.loan), money(ld.loan)],
        ['Cash you put in', money(m0.cashIn), money(m1.cashIn)],
        ['Monthly cashflow', money(m0.cf), money(m1.cf)],
        ['ROI', roi(m0), roi(m1)]
      ];
      html += (isBrrr ? '' : '<p class="lc-sub">You would need about ' + money(f.byLtv - f.byRent) + ' more deposit.</p>') +
        '<div class="di-table-wrap"><table class="di-table"><thead><tr><th scope="col"></th><th scope="col">As entered</th><th scope="col">Lender-limited</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr><th scope="row">' + r[0] + '</th><td>' + r[1] + '</td><td class="lc-col">' + r[2] + '</td></tr>'; }).join('') +
        '</tbody></table></div>' +
        (isBrrr ? '' : '<p class="lc-sub">Figures on ' + DI.MODE_LABEL[mode].toLowerCase() + '.</p>');
    }

    if (isBrrr) html += refiTimingNote(true);
    html += '<p class="hint lc-foot">Based on ' + esc(CFG.lender.ownershipTypes[f.own].label.toLowerCase()) + ', ' + pct(f.cover) +
      ' rent cover at a ' + pct(f.stress) + ' stress rate. Change these under Advanced. Lenders vary, so check with your broker.</p>';
    body.innerHTML = html;

    var sum = !(d.rent > 0) ? '' : f.limitedByRent
      ? 'rent limits the loan to ' + money(round100(f.byRent))
      : 'rent supports ' + money(round100(f.byRent));
    setSum('b-sec-lender-sum', sum, f.limitedByRent && d.rent > 0);

    // Rent limiting the loan changes the deal, so flag it under the
    // headline numbers and open the section the first time it happens.
    var limited = f.limitedByRent && d.rent > 0;
    if (alerts) {
      alerts.innerHTML = limited
        ? '<div class="rs-alert" role="status"><span>' + esc(msg) + '</span>' +
          '<button type="button" class="rs-alert-link" onclick="DealPlanning.openSection(\'b-sec-lender\')">See lender check</button></div>'
        : '';
    }
    if (limited && lastLimited[key] !== true) {
      var sec = $('b-sec-lender');
      if (sec) sec.open = true;
    }
    lastLimited[key] = limited;
  }

  // =====================================================================
  // 2. REFINANCE TIMING (BRRR)
  // =====================================================================
  function refiMonths() { return readNum('bb-refi-months', CFG.refinance.defaultMonths); }
  function refiTimingNote(inSection) {
    var m = refiMonths();
    if (!(m >= 0) || m >= CFG.refinance.minOwnershipMonths) return '';
    var text = 'Many lenders require ' + CFG.refinance.minOwnershipMonths +
      ' months of ownership before refinancing at the new value. Check with your broker.';
    return inSection ? '<p class="lc-timing">' + esc(text) + '</p>' : text;
  }
  function renderRefiTimingField() {
    var note = $('bb-refi-months-note');
    if (!note) return;
    var text = refiTimingNote(false);
    note.textContent = text;
    note.hidden = !text;
  }

  // =====================================================================
  // 3. COMPARE STRATEGIES
  // Same purchase price, end value and refurb as the deal on screen, for
  // every strategy. Rents, costs and targets come from each strategy's own
  // tab. Mortgage columns use the financing tab on screen (BRRR tab: interest-only).
  // =====================================================================
  // "Filled in" means the user has entered their own rents on that tab.
  // The page starts with sample rents, which don't count.
  function changedFromSample(ids) {
    return ids.some(function (id) {
      var el = $(id);
      return el && String(el.value).replace(/,/g, '').trim() !== String(el.defaultValue).replace(/,/g, '').trim();
    });
  }
  function hmoRentsFilled() {
    var t = 0, ids = [];
    for (var i = 1; i <= 4; i++) {
      t += moneyVal('h-r' + i + 'p') * (+($('h-r' + i + 'n') || {}).value || 0);
      ids.push('h-r' + i + 'p', 'h-r' + i + 'n');
    }
    return t > 0 && changedFromSample(ids);
  }
  function saRentsFilled() {
    return moneyVal('sa-rate') > 0 && (+($('sa-occ') || {}).value || 0) > 0 && changedFromSample(['sa-rate', 'sa-occ']);
  }

  function isOnToggle(id) { var b = $(id); return !!b && b.getAttribute('aria-checked') === 'true'; }

  var LEVEL_RANK = { good: 3, warn: 2, bad: 1 };

  function renderCompare(st) {
    var body = $(PREFIX[st] + '-compare');
    if (!body) return;
    var base = inputsFor(st);
    var mode = DI.activeMode(st);
    if (mode === 'brrr') mode = 'm';
    var overridesFor = function (target) {
      if (target === st) return null;
      var ids = inputsFor(target), o = {};
      o[ids.pp] = rawVal(base.pp); o[ids.emv] = rawVal(base.emv); o[ids.ref] = rawVal(base.ref);
      return o;
    };
    var dataFor = function (target) {
      var o = overridesFor(target);
      return o ? DI.runEngine(target, o) : DI.dataOf(target);
    };

    // BTL and BRRR come from the same engine run, except that a switched-on
    // bridge only belongs in the BRRR column.
    var btlRun = function (bridge) { return DI.runEngine('btl', Object.assign({}, overridesFor('btl') || {}, { __bridge: bridge })); };
    var btl = btlRun(false), brrr = btlRun(true);
    var cols = [];
    var btlFilled = btl.rent > 0;
    cols.push({ key: 'btl', label: 'BTL', sub: DI.MODE_LABEL[mode], st: 'btl', mode: mode, d: btl, filled: btlFilled, missing: 'Add monthly rent to compare' });
    cols.push({ key: 'brrr', label: 'BRRR', sub: 'Refinanced', st: 'btl', mode: 'brrr', d: brrr, filled: btlFilled, missing: 'Add monthly rent to compare' });
    var hmoOk = st === 'hmo' || hmoRentsFilled();
    cols.push({ key: 'hmo', label: 'HMO', sub: DI.MODE_LABEL[mode], st: 'hmo', mode: mode, d: hmoOk ? dataFor('hmo') : null, filled: hmoOk, missing: 'Add room rents to compare' });
    var saOk = st === 'sa' || saRentsFilled();
    cols.push({ key: 'sa', label: 'SA', sub: DI.MODE_LABEL[mode], st: 'sa', mode: mode, d: saOk ? dataFor('sa') : null, filled: saOk, missing: 'Add nightly rate to compare' });

    cols.forEach(function (c) {
      if (!c.filled) return;
      c.m = DI.metrics(c.st, c.mode, c.d);
      c.v = DI.rentalVerdict(c.m, c.mode);
    });
    var live = cols.filter(function (c) { return c.filled; });

    // Each row: how to show it, and the number used to pick the winner
    // (higher is better).
    var ROWS = [
      { label: 'Monthly cashflow', show: function (c) { return money(c.m.cf); }, score: function (c) { return c.m.cf; } },
      { label: 'ROI', show: function (c) { return c.m.allOut ? 'All money out' : pct(c.m.roi); }, score: function (c) { return c.m.allOut ? Infinity : c.m.roi; } },
      { label: 'Gross yield', show: function (c) { return pct(c.m.gy); }, score: function (c) { return c.m.gy; } },
      { label: 'Money left in', show: function (c) { return money(Math.max(0, c.m.cashIn)); }, score: function (c) { return -Math.max(0, c.m.cashIn); } },
      { label: 'Verdict', show: function (c) { return '<span class="cmp-v di-' + c.v.level + '"><span class="di-dot" aria-hidden="true"></span>' + esc(c.v.label) + '</span>'; }, score: function (c) { return LEVEL_RANK[c.v.level]; }, html: true }
    ];

    var wins = {};
    var winnerOf = ROWS.map(function (r) {
      if (live.length < 2) return {};
      var scores = live.map(function (c) { return r.score(c); });
      var best = Math.max.apply(null, scores);
      var bestCols = live.filter(function (c) { return Math.abs(r.score(c) - best) < 0.005 || r.score(c) === best; });
      if (bestCols.length === live.length) return {};
      var set = {};
      bestCols.forEach(function (c) { set[c.key] = true; wins[c.key] = (wins[c.key] || 0) + 1; });
      return set;
    });

    var head = '<tr><th scope="col"></th>' + cols.map(function (c) {
      return '<th scope="col">' + c.label + (c.filled ? '<small>' + esc(c.sub) + '</small>' : '') + '</th>';
    }).join('') + '</tr>';
    var bodyRows = ROWS.map(function (r, i) {
      return '<tr><th scope="row">' + r.label + '</th>' + cols.map(function (c) {
        if (!c.filled) return i === 0 ? '<td class="cmp-missing" rowspan="' + ROWS.length + '">' + esc(c.missing) + '</td>' : '';
        var win = winnerOf[i][c.key];
        return '<td' + (win ? ' class="cmp-win"' : '') + '>' + (win ? '<span class="sr-only">Best: </span>' : '') + r.show(c) + '</td>';
      }).join('') + '</tr>';
    }).join('');

    body.innerHTML =
      '<div class="di-table-wrap"><table class="di-table cmp-table"><thead>' + head + '</thead><tbody>' + bodyRows + '</tbody></table></div>' +
      '<p class="hint">Every column uses this deal\'s purchase price, end value and refurb. Rents, running costs and targets come from each strategy\'s own tab, and each verdict uses that strategy\'s targets. The best figure on each row is highlighted.</p>' +
      (window.DealRealistic && (DealRealistic.bridgeOn() || isOnToggle('b-hc-on')) ? '<p class="hint">Bridge and holding costs, when switched on, are included in the BTL and BRRR columns only.</p>' : '');

    var sum = '';
    if (live.length >= 2) {
      var top = live.slice().sort(function (a, b) { return (wins[b.key] || 0) - (wins[a.key] || 0); });
      var n = wins[top[0].key] || 0;
      var tied = top.filter(function (c) { return (wins[c.key] || 0) === n; });
      sum = n === 0 ? 'level on every row'
        : tied.length > 1 ? tied.map(function (c) { return c.label; }).join(' and ') + ' level, best on ' + n + ' of 5'
        : top[0].label + ' best on ' + n + ' of 5';
    } else if (live.length === 1) {
      sum = 'add rents on another tab to compare';
    }
    setSum(PREFIX[st] + '-sec-compare-sum', sum);
  }

  // =====================================================================
  // 4. 10-YEAR PROJECTION
  //   Value (end of year n)   = end market value x (1 + capital growth)^n
  //   Mortgage balance         interest-only: the loan, unchanged
  //                            repayment: the loan after n x 12 monthly
  //                            payments (the engine's own payment)
  //   Equity                   = value - mortgage balance
  //   Annual cashflow, year 1  = the main results' annual figure, exactly
  //   Later years              rent grows at rent growth. With "costs rise
  //                            with rent" on, running costs grow at the same
  //                            rate; off, they stay at today's level.
  //                            Mortgage payments stay fixed (stop if the
  //                            repayment term ends).
  //   Cumulative cashflow      = running total of annual cashflow
  // =====================================================================
  var CF_ANNUAL = {
    btl: { m: 'mNy', r: 'rNy', c: 'cNy', brrr: 'bbNy' },
    hmo: { m: 'mNy', r: 'rNy', c: 'cNy', brrr: 'bbNy' },
    sa: { m: 'mCFy', r: 'rCFy', c: 'cCFy', brrr: 'bbCFy' }
  };

  function projAssumptions(st) {
    var p = PREFIX[st];
    var cg = readNum(p + '-pj-cg', CFG.projection.capitalGrowth);
    var rg = readNum(p + '-pj-rg', CFG.projection.rentGrowth);
    var costsBtn = $(p + '-pj-costs');
    var costs = costsBtn ? costsBtn.getAttribute('aria-checked') === 'true' : CFG.projection.costsRiseWithRent;
    var bad = function (v) { return !Number.isFinite(v) || v < -20 || v > 30; };
    return { cg: cg, rg: rg, costs: costs, error: bad(cg) || bad(rg) ? 'Enter growth rates between -20% and 30% a year.' : null };
  }

  function projectionRows(st, mode, d, a) {
    var years = CFG.projection.years;
    var gross1 = st === 'sa' ? d.annualRevenue : (st === 'hmo' ? d.totalRent : d.rent) * 12;
    var net1 = st === 'sa' ? d.cCFy : d.cNy; // before any mortgage
    var costs1 = gross1 - net1;
    var cf1 = d[CF_ANNUAL[st][mode]];

    var loan = 0, monthly = 0, repaying = false;
    if (mode === 'm' || mode === 'r') { loan = d.loan; repaying = mode === 'r'; }
    if (mode === 'brrr') { loan = d.brrrLoan; repaying = d.brrrType === 'repay'; }
    if (loan > 0) monthly = repaying ? mortRepay(loan, d.mr, d.term) : mort(loan, d.mr);
    var termMonths = repaying ? d.term * 12 : Infinity;
    var r = d.mr / 100 / 12;

    var rows = [{ year: 0, value: d.emv, balance: loan, equity: d.emv - loan, cf: 0, cum: 0 }];
    var bal = loan, cum = 0, paid1 = 0;
    for (var y = 1; y <= years; y++) {
      var paid = 0;
      for (var k = (y - 1) * 12 + 1; k <= y * 12; k++) {
        if (loan <= 0 || k > termMonths) continue;
        paid += monthly;
        if (repaying) bal = Math.max(0, bal * (1 + r) - monthly);
      }
      if (y === 1) paid1 = paid;
      var g = Math.pow(1 + a.rg / 100, y - 1);
      var net = a.costs ? net1 * g : gross1 * g - costs1;
      var cf = cf1 + (net - net1) - (paid - paid1);
      cum += cf;
      var value = d.emv * Math.pow(1 + a.cg / 100, y);
      rows.push({ year: y, value: value, balance: bal, equity: value - bal, cf: cf, cum: cum });
    }
    return rows;
  }

  function renderProjection(st) {
    var p = PREFIX[st];
    var out = $(p + '-proj');
    if (!out) return;
    var d = DI.dataOf(st) || {};
    var mode = DI.activeMode(st);
    var a = projAssumptions(st);
    if (a.error) { out.innerHTML = '<p class="field-err">' + esc(a.error) + '</p>'; setSum(p + '-sec-proj-sum', ''); return; }
    if (!(d.emv > 0)) { out.innerHTML = ''; setSum(p + '-sec-proj-sum', ''); return; }

    var rows = projectionRows(st, mode, d, a);
    var show = CFG.projection.showYears.map(function (y) { return rows[y]; });
    var last = rows[rows.length - 1];
    var metricsRows = [
      ['Property value', 'value'], ['Mortgage balance', 'balance'], ['Equity', 'equity'],
      ['Annual cashflow', 'cf'], ['Cumulative cashflow', 'cum']
    ];
    var table = '<div class="di-table-wrap"><table class="di-table pj-table"><thead><tr><th scope="col"></th>' +
      show.map(function (r) { return '<th scope="col">Year ' + r.year + '</th>'; }).join('') + '</tr></thead><tbody>' +
      metricsRows.map(function (mr) {
        return '<tr><th scope="row">' + mr[0] + '</th>' + show.map(function (r) { return '<td>' + money(r[mr[1]]) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';

    var label = mode === 'brrr' ? 'BRRR refinance (' + (d.brrrType === 'repay' ? 'repayment' : 'interest-only') + ')' : DI.MODE_LABEL[mode].toLowerCase();
    out.innerHTML =
      '<p class="pj-label">Projection, not a forecast. Based on your assumptions.</p>' +
      chartSvg(rows) + table +
      '<p class="hint">Starts from the ' + money(d.emv) + ' end market value, on ' + esc(label) +
      '. Year 1 cashflow matches the main results. Mortgage payments stay at today\'s rate. Tax is not included.</p>';
    bindChart(out, rows);
    setSum(p + '-sec-proj-sum', money(round1000(last.equity)) + ' equity by year ' + last.year);
  }

  // ---- projection chart: equity and cumulative cashflow, one £ axis ----
  var C_EQ = '#4b45b2', C_CUM = '#c2691b';
  var W = 600, H = 250, PL = 58, PR = 18, PT = 16, PB = 30;
  // Phones get a smaller drawing so the axis labels stay readable.
  function sizeChart() {
    var narrow = window.matchMedia && window.matchMedia('(max-width:520px)').matches;
    W = narrow ? 340 : 600; H = narrow ? 210 : 250; PL = narrow ? 46 : 58; PR = narrow ? 12 : 18;
  }
  function kLabel(v) {
    var a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e6) return s + '£' + (+(a / 1e6).toFixed(1)) + 'm';
    if (a >= 1000) return s + '£' + Math.round(a / 1000) + 'k';
    return s + '£' + Math.round(a);
  }
  function niceStep(range) {
    var raw = range / 4, mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }
  function chartSvg(rows) {
    sizeChart();
    var vals = [];
    rows.forEach(function (r) { vals.push(r.equity, r.cum); });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
    if (hi === lo) hi = lo + 1000;
    var step = niceStep(hi - lo);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    var n = rows.length - 1;
    var x = function (i) { return PL + (W - PL - PR) * i / n; };
    var y = function (v) { return PT + (H - PT - PB) * (hi - v) / (hi - lo); };
    var grid = '';
    for (var v = lo; v <= hi + step / 2; v += step) {
      grid += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="pj-grid' + (Math.abs(v) < 1e-6 ? ' pj-zero' : '') + '"/>' +
        '<text x="' + (PL - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end" class="pj-ax">' + kLabel(v) + '</text>';
    }
    var xt = '';
    for (var i = 0; i <= n; i += (W < 400 ? 5 : 2)) xt += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle" class="pj-ax">Yr ' + i + '</text>';
    var path = function (key) { return rows.map(function (r, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r[key]).toFixed(1); }).join(' '); };
    var dot = function (key, c) { var r = rows[n]; return '<circle cx="' + x(n) + '" cy="' + y(r[key]) + '" r="4" fill="' + c + '" stroke="var(--surface,#fff)" stroke-width="2"/>'; };
    return '<div class="pj-chart">' +
      '<div class="pj-legend"><span><i style="background:' + C_EQ + '"></i>Equity</span><span><i style="background:' + C_CUM + '"></i>Cumulative cashflow</span></div>' +
      '<div class="pj-plot"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Line chart of equity and cumulative cashflow over 10 years. The table below has the figures.">' +
      grid + xt +
      '<line class="pj-cross" x1="0" x2="0" y1="' + PT + '" y2="' + (H - PB) + '" visibility="hidden"/>' +
      '<path d="' + path('equity') + '" fill="none" stroke="' + C_EQ + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<path d="' + path('cum') + '" fill="none" stroke="' + C_CUM + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      dot('equity', C_EQ) + dot('cum', C_CUM) +
      '<rect class="pj-hit" x="' + PL + '" y="' + PT + '" width="' + (W - PL - PR) + '" height="' + (H - PT - PB) + '" fill="transparent"/>' +
      '</svg><div class="pj-tip" hidden></div></div></div>';
  }
  function bindChart(out, rows) {
    var svg = out.querySelector('.pj-plot svg'), tip = out.querySelector('.pj-tip'), cross = out.querySelector('.pj-cross');
    if (!svg || !tip) return;
    var n = rows.length - 1;
    var move = function (e) {
      var box = svg.getBoundingClientRect();
      var sx = (e.clientX - box.left) * W / box.width;
      var i = Math.max(0, Math.min(n, Math.round((sx - PL) / ((W - PL - PR) / n))));
      var r = rows[i], px = PL + (W - PL - PR) * i / n;
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      tip.innerHTML = '<b>Year ' + r.year + '</b><span><i style="background:' + C_EQ + '"></i>Equity ' + money(r.equity) + '</span>' +
        '<span><i style="background:' + C_CUM + '"></i>Cumulative cashflow ' + money(r.cum) + '</span>';
      tip.hidden = false;
      var left = px / W * box.width;
      tip.style.left = Math.max(0, Math.min(box.width - tip.offsetWidth, left - tip.offsetWidth / 2)) + 'px';
    };
    var leave = function () { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', leave);
  }

  // =====================================================================
  // Wiring
  // =====================================================================
  function render(st) {
    if (!PREFIX[st]) return;
    var d = DI.dataOf(st) || {};
    if (st === 'btl') { renderLender(d); renderRefiTimingField(); }
    renderCompare(st);
    renderProjection(st);
    // Compare reads every tab's rents, so refresh the one on screen too.
    var shown = typeof currentTab !== 'undefined' ? (currentTab === 'brrr' ? 'btl' : currentTab) : null;
    if (shown && shown !== st && PREFIX[shown]) renderCompare(shown);
  }

  function clear(st) {
    if (!PREFIX[st]) return;
    var p = PREFIX[st];
    ['-compare', '-proj'].forEach(function (s) { var el = $(p + s); if (el) el.innerHTML = ''; });
    setSum(p + '-sec-compare-sum', ''); setSum(p + '-sec-proj-sum', '');
    if (st === 'btl') {
      var el = $('b-lender'); if (el) el.innerHTML = '';
      var al = $('b-alerts'); if (al) al.innerHTML = '';
      setSum('b-sec-lender-sum', '');
      renderRefiTimingField();
    }
  }

  function openSection(id) {
    var sec = $(id);
    if (!sec) return;
    sec.open = true;
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var s = sec.querySelector('summary');
    if (s) s.focus({ preventScroll: true });
  }

  function save() { if (typeof saveIndexDraft === 'function') saveIndexDraft(); }

  // Ownership type changed: rent cover resets to that type's default.
  window.onLenderOwnershipChange = function (id, value) {
    var c = $('b-lc-cover');
    if (c) { c.value = ''; c.placeholder = String(defaultCover(value)); }
    if (typeof markStaleBTL === 'function') markStaleBTL();
  };

  function onProjInput(st) {
    renderProjection(st);
    // Keep the copy saved with the deal current.
    var d = DI.dataOf(st);
    if (d && window.DealRealistic) d.planning = window.DealRealistic.getDealState(st);
    save();
  }
  function toggleCosts(st) {
    var b = $(PREFIX[st] + '-pj-costs');
    if (!b) return;
    b.setAttribute('aria-checked', b.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    onProjInput(st);
  }

  function setOwnership(v) {
    if (!CFG.lender.ownershipTypes[v]) v = CFG.lender.defaultOwnership;
    if (typeof setDDValue === 'function') setDDValue('b-lc-own', v, CFG.lender.ownershipTypes[v].label);
    var c = $('b-lc-cover'); if (c) c.placeholder = String(defaultCover(v));
  }

  // Defaults from deal-assumptions.js, written into the page once so
  // "Reset to my defaults" (which uses each input's default value) and the
  // placeholders match the config.
  function init() {
    var setDef = function (id, v) { var el = $(id); if (el) { el.defaultValue = String(v); el.placeholder = String(v); } };
    setDef('b-lc-stress', CFG.lender.stressRate);
    setDef('b-lc-cover', defaultCover(CFG.lender.defaultOwnership));
    setDef('bb-refi-months', CFG.refinance.defaultMonths);
    Object.keys(PREFIX).forEach(function (st) {
      setDef(PREFIX[st] + '-pj-cg', CFG.projection.capitalGrowth);
      setDef(PREFIX[st] + '-pj-rg', CFG.projection.rentGrowth);
      var b = $(PREFIX[st] + '-pj-costs');
      if (b && !b.dataset.set) b.setAttribute('aria-checked', String(CFG.projection.costsRiseWithRent));
    });
    var own = $('b-lc-own');
    if (own && !own.dataset.set) setOwnership(CFG.lender.defaultOwnership);
    var cover = $('b-lc-cover');
    if (cover) cover.placeholder = String(defaultCover(ownership()));
  }

  // Saved with the page draft (index.html), alongside the input fields.
  function getState() {
    var proj = {};
    Object.keys(PREFIX).forEach(function (st) {
      var p = PREFIX[st];
      proj[st] = { cg: rawVal(p + '-pj-cg'), rg: rawVal(p + '-pj-rg'),
        costs: ($(p + '-pj-costs') || { getAttribute: function () { return null; } }).getAttribute('aria-checked') };
    });
    return { ownership: ownership(), projection: proj };
  }
  function setState(s) {
    if (!s || typeof s !== 'object') return;
    try {
      if (s.ownership) { setOwnership(s.ownership); var o = $('b-lc-own'); if (o) o.dataset.set = '1'; }
      var proj = s.projection || {};
      Object.keys(PREFIX).forEach(function (st) {
        var v = proj[st], p = PREFIX[st];
        if (!v) return;
        if (typeof v.cg === 'string' && $(p + '-pj-cg')) $(p + '-pj-cg').value = v.cg;
        if (typeof v.rg === 'string' && $(p + '-pj-rg')) $(p + '-pj-rg').value = v.rg;
        var b = $(p + '-pj-costs');
        if (b && (v.costs === 'true' || v.costs === 'false')) { b.setAttribute('aria-checked', v.costs); b.dataset.set = '1'; }
      });
    } catch (e) { /* a bad draft leaves the defaults in place */ }
  }
  // "Reset to my defaults" and "Clear all": back to the config defaults.
  function reset() {
    setOwnership(CFG.lender.defaultOwnership);
    Object.keys(PREFIX).forEach(function (st) {
      var p = PREFIX[st];
      ['-pj-cg', '-pj-rg'].forEach(function (s) { var el = $(p + s); if (el) el.value = el.defaultValue; });
      var b = $(p + '-pj-costs'); if (b) b.setAttribute('aria-checked', String(CFG.projection.costsRiseWithRent));
    });
    lastLimited = { btl: null, brrr: null };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // ---------- styles ----------
  var css =
    // Lets wide tables scroll inside their box instead of widening the page.
    '.split-panel>.results-col{min-width:0}' +
    '.rsecs{margin:0 0 1.1rem;min-width:0}' +
    '.rsecs .di-table-wrap{position:relative}' +
    'details.rsec{border:1px solid var(--hairline);border-radius:12px;background:var(--surface);margin:0 0 10px}' +
    'details.rsec>summary{list-style:none;cursor:pointer;display:flex;align-items:baseline;flex-wrap:wrap;gap:.15rem .45rem;padding:.8rem 2.4rem .8rem .95rem;position:relative;border-radius:12px;-webkit-tap-highlight-color:transparent}' +
    'details.rsec>summary::-webkit-details-marker{display:none}' +
    'details.rsec>summary::after{content:"";position:absolute;right:1rem;top:1.05rem;width:7px;height:7px;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:rotate(45deg);transition:transform .15s ease}' +
    'details.rsec[open]>summary::after{transform:rotate(-135deg);top:1.2rem}' +
    'details.rsec>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}' +
    '.rsec-t{font-weight:700;font-size:14px;color:var(--ink)}' +
    '.rsec-s{font-size:13px;color:var(--muted)}' +
    '.rsec-s:not(:empty)::before{content:"· ";}' +
    'details.rsec.rsec-flag{border-color:var(--warn)}' +
    'details.rsec.rsec-flag .rsec-s{color:var(--warn-ink);font-weight:600}' +
    '.rsec-body{padding:0 .95rem .95rem}' +
    '.rsec-body>.hint,.rsec-body .hint{font-size:12px;margin:.6rem 0 0;font-style:normal}' +
    '.rs-alerts:empty{display:none}' +
    '.rs-alert{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem .8rem;background:var(--warn-bg);border:1px solid var(--warn);color:var(--warn-ink);border-radius:12px;padding:.65rem .9rem;font-size:13px;font-weight:600;margin:0 0 1.1rem;line-height:1.4}' +
    '.rs-alert-link{background:none;border:0;padding:0;font:inherit;font-weight:700;color:var(--warn-ink);text-decoration:underline;cursor:pointer}' +
    '.lc-msg{margin:0 0 .7rem;font-weight:700;font-size:14px;border-radius:8px;padding:.5rem .7rem}' +
    '.lc-ok{background:var(--success-bg);color:var(--success-ink)}.lc-bad{background:var(--warn-bg);color:var(--warn-ink)}' +
    '.lc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:0 0 .7rem}' +
    '.lc-box{border:1px solid var(--hairline);border-radius:10px;padding:.65rem .8rem;min-width:0}' +
    '.lc-box.lc-limits{border:1.5px solid var(--accent);background:rgba(75,69,178,.05)}' +
    '.lc-l{margin:0 0 3px;font-size:11.5px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center}' +
    '.lc-tag{font-size:10.5px;text-transform:none;letter-spacing:0;background:var(--accent);color:#fff;border-radius:999px;padding:1px 7px}' +
    '.lc-v{margin:0;font-weight:700;font-size:20px;color:var(--ink);font-variant-numeric:tabular-nums}' +
    '.lc-n{margin:2px 0 0;font-size:11.5px;color:var(--muted);line-height:1.4}' +
    '.lc-sub{font-size:12.5px;color:var(--muted);margin:.2rem 0 .5rem}' +
    '.di-table td.lc-col{color:var(--accent)}' +
    '.lc-timing{margin:.7rem 0 0;font-size:12.5px;background:var(--warn-bg);color:var(--warn-ink);border-radius:8px;padding:.5rem .7rem;font-weight:600}' +
    '.field-note[hidden]{display:none}' +
    '.field-note{font-size:12px;color:var(--warn-ink);background:var(--warn-bg);border-radius:6px;padding:.35rem .55rem;margin:.35rem 0 0;line-height:1.4}' +
    '.cmp-table th small{display:block;font-size:10px;font-weight:500;text-transform:none;letter-spacing:0}' +
    '.cmp-table td.cmp-win{background:var(--success-bg);color:var(--success-ink)}' +
    '.cmp-table td.cmp-missing{white-space:normal;font-weight:500;color:var(--muted);font-size:12px;text-align:center;vertical-align:middle;min-width:90px;background:var(--surface-2)}' +
    '.cmp-v{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}' +
    '.cmp-v .di-dot{width:9px;height:9px}' +
    '.cmp-v.di-good{color:var(--success-ink)}.cmp-v.di-warn{color:var(--warn-ink)}.cmp-v.di-bad{color:var(--danger-ink)}' +
    '.pj-inputs{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end;margin:0 0 .8rem}' +
    '.pj-inputs .f{margin:0}' +
    '.pj-switch{display:inline-flex;align-items:center;gap:.55rem;background:none;border:0;padding:8px 0;cursor:pointer;font:600 13px var(--font-body);color:var(--ink);text-align:left}' +
    '.pj-switch .sw{position:relative;width:34px;height:20px;border-radius:999px;background:var(--hairline-strong,#c9c9d3);transition:background .15s ease;flex-shrink:0}' +
    '.pj-switch .sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s ease}' +
    '.pj-switch[aria-checked="true"] .sw{background:var(--accent)}' +
    '.pj-switch[aria-checked="true"] .sw::after{transform:translateX(14px)}' +
    '.pj-label{margin:0 0 .6rem;font-weight:700;font-size:13px;color:var(--ink);border-left:3px solid var(--accent);padding:.15rem 0 .15rem .6rem}' +
    '.pj-chart{margin:0 0 .6rem}' +
    '.pj-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--muted);margin:0 0 4px}' +
    '.pj-legend i,.pj-tip i{display:inline-block;width:10px;height:3px;border-radius:2px;vertical-align:middle;margin-right:5px}' +
    '.pj-plot{position:relative}' +
    '.pj-plot svg{display:block;width:100%;height:auto;touch-action:pan-y}' +
    '.pj-grid{stroke:var(--hairline);stroke-width:1}.pj-zero{stroke:var(--muted);stroke-opacity:.5}' +
    '.pj-ax{font-size:11px;fill:var(--muted);font-family:var(--font-body)}' +
    '.pj-cross{stroke:var(--muted);stroke-width:1;stroke-dasharray:3 3}' +
    '.pj-tip{position:absolute;top:0;pointer-events:none;background:var(--surface,#fff);border:1px solid var(--hairline);box-shadow:0 4px 14px rgba(20,20,40,.12);border-radius:8px;padding:.4rem .6rem;font-size:12px;color:var(--ink);display:flex;flex-direction:column;gap:2px;white-space:nowrap;font-variant-numeric:tabular-nums}' +
    '.pj-tip[hidden]{display:none}' +
    '.cmp-table tbody th,.cmp-table thead th:first-child{position:sticky;left:0;background:var(--surface);z-index:1}' +
    '@media(max-width:520px){' +
      '.rsecs .di-table{font-size:12px}' +
      '.rsecs .di-table th,.rsecs .di-table td{padding:.4rem .2rem}' +
      '.rsecs .di-table tbody th{white-space:normal;min-width:76px}' +
      '.pj-inputs{grid-template-columns:1fr 1fr}' +
      '.pj-switch{grid-column:1/-1;padding-top:0}' +
      '.rsec-body{padding:0 .75rem .85rem}' +
      'details.rsec>summary{padding-left:.75rem}' +
    '}';
  var style = document.createElement('style');
  style.id = 'deal-planning-styles';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  window.DealPlanning = {
    render: render, clear: clear, openSection: openSection,
    onProjInput: onProjInput, toggleCosts: toggleCosts,
    getState: getState, setState: setState, reset: reset,
    // For checking the maths by hand.
    lenderFigures: function (isBrrr) { return lenderFigures(isBrrr, DI.dataOf('btl')); },
    projectionRows: function (st) { return projectionRows(st, DI.activeMode(st), DI.dataOf(st), projAssumptions(st)); }
  };
})();
