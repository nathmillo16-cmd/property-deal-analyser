// deal-realistic.js: the calculator's "Make it realistic" toggles, all OFF
// by default so the results are exactly the calculator's own until one is
// switched on:
//   Bought with a bridge (BRRR tab)
//   Include holding costs (BRRR, BTL, Flip)
//   Show after-tax (BTL, BRRR, HMO, SA)
//
// Bridge and holding costs are one-off costs. They go through the SAME
// calc-engine.js maths as any other upfront cost: they're added to the
// refurb figure the engine reads (BTL/BRRR) or the buying fees (Flip, where
// refurb would wrongly grow the contingency), so they land in total
// investment, money left in, ROI and max bid exactly like those costs do.
// The engine file itself is untouched; the saved deal keeps the user's own
// refurb / buying fees figure plus the extra costs listed separately.
//
// After-tax is display only (its own results section). Rates and defaults
// live in deal-assumptions.js. Also saves every planning input with a deal
// (deal_data.planning) and restores it when the deal is reopened.
//
// Loads after deal-insights.js, deal-assumptions.js and deal-planning.js.

(function () {
  var CFG = window.DEAL_ASSUMPTIONS;
  var DI = window.DealInsights;
  var DP = window.DealPlanning;
  if (!CFG || !DI || !DP) return;

  var PREFIX = { btl: 'b', hmo: 'h', sa: 'sa', flip: 'fl' };
  var money = DI.money, pct = DI.pct, esc = DI.esc;

  function $(id) { return document.getElementById(id); }
  function num(v) { var n = +String(v == null ? '' : v).replace(/,/g, '').trim(); return Number.isFinite(n) ? n : 0; }
  // Blank means "use the default"; anything not a number counts as 0 (the
  // page's own range check flags it and holds the results anyway).
  function readNum(id, def) {
    var el = $(id);
    if (!el) return def;
    var raw = String(el.value).replace(/,/g, '').trim();
    if (raw === '') return def;
    var n = +raw;
    return Number.isFinite(n) ? n : 0;
  }
  function rawVal(id) { var el = $(id); return el ? String(el.value).replace(/,/g, '') : ''; }
  function isOn(id) { var b = $(id); return !!b && b.getAttribute('aria-checked') === 'true'; }
  function onBrrrTab() { return typeof currentTab !== 'undefined' && currentTab === 'brrr'; }

  // ---------------------------------------------------------------------
  // Bridge (BRRR) and holding costs (BTL/BRRR, Flip)
  // ---------------------------------------------------------------------
  function refiMonths() { return readNum('bb-refi-months', CFG.refinance.defaultMonths); }

  function bridgeFigures(pp) {
    var ltv = readNum('b-br-ltv', CFG.bridge.ltv);
    var rate = readNum('b-br-rate', CFG.bridge.monthlyRate);
    var arrPct = readNum('b-br-arr', CFG.bridge.arrangementFee);
    var exitPct = readNum('b-br-exit', CFG.bridge.exitFee);
    var months = readNum('b-br-months', refiMonths());
    var loan = pp * ltv / 100;
    var interest = loan * rate / 100 * months;
    var arrangement = loan * arrPct / 100;
    var exit = loan * exitPct / 100;
    return { ltv: ltv, rate: rate, arrPct: arrPct, exitPct: exitPct, months: months, loan: loan,
      interest: interest, arrangement: arrangement, exit: exit, total: interest + arrangement + exit };
  }

  function holdingFigures(st) {
    var p = st === 'flip' ? 'fl' : 'b';
    var months = readNum(p + '-hc-months', CFG.holding.monthsEmpty);
    var monthly = readNum(p + '-hc-cost', CFG.holding.monthlyCost);
    return { months: months, monthly: monthly, total: months * monthly };
  }

  // What's switched on for a strategy, at a given purchase price.
  // bridgeFlag: true/false to force the bridge in or out (Compare uses it
  // for its BTL and BRRR columns); undefined = only on the BRRR tab.
  function extrasFor(st, pp, bridgeFlag) {
    var out = { bridge: null, holding: null, total: 0 };
    if (st === 'btl') {
      var useBridge = isOn('b-br-on') && (bridgeFlag !== undefined ? bridgeFlag : onBrrrTab());
      if (useBridge) out.bridge = bridgeFigures(pp);
      if (isOn('b-hc-on')) out.holding = holdingFigures('btl');
    } else if (st === 'flip') {
      if (isOn('fl-hc-on')) out.holding = holdingFigures('flip');
    }
    out.total = (out.bridge ? out.bridge.total : 0) + (out.holding ? out.holding.total : 0);
    return out;
  }

  // Called by DealInsights.runEngine for every what-if run, and by the
  // calculator for the main run. Returns the overrides with the extra cost
  // folded into refurb (BTL/BRRR) or buying fees (Flip). Unchanged when
  // nothing is switched on.
  function engineOverrides(st, overrides) {
    var o = {}, flag;
    Object.keys(overrides || {}).forEach(function (k) {
      if (k === '__bridge') flag = overrides[k]; else o[k] = overrides[k];
    });
    if (st !== 'btl' && st !== 'flip') return o;
    var ppId = st === 'btl' ? 'b-pp' : 'fl-pp';
    var pp = Object.prototype.hasOwnProperty.call(o, ppId) ? num(o[ppId]) : num(rawVal(ppId));
    var ex = extrasFor(st, pp, flag);
    if (!(ex.total > 0)) return o;
    var costId = st === 'btl' ? 'b-ref' : 'fl-bf';
    var base = Object.prototype.hasOwnProperty.call(o, costId) ? num(o[costId]) : num(rawVal(costId));
    o[costId] = base + ex.total;
    return o;
  }

  // Main calculation. Runs the engine normally when nothing's switched on,
  // or with the extra cost folded in, writing to the page either way.
  // Returns the data object to use as btlData/flipData etc.
  function runMain(st, engineFn, currentData) {
    var o = engineOverrides(st, {});
    var d;
    if (Object.keys(o).length) d = DI.runEngineOnPage(st, o);
    else { engineFn(); d = currentData(); }
    annotate(st, d);
    return d;
  }

  // Saved figures keep the user's own refurb / buying fees, with the extras
  // listed separately, so reopening the deal never counts them twice.
  function annotate(st, d) {
    if (!d) return;
    if (st === 'btl') d.ref = moneyVal('b-ref');
    if (st === 'flip') d.bf = moneyVal('fl-bf');
    var ex = extrasFor(st, d.pp || 0);
    if (ex.total > 0) {
      d.extraCosts = { total: Math.round(ex.total) };
      if (ex.bridge) d.extraCosts.bridge = { loan: Math.round(ex.bridge.loan), interest: Math.round(ex.bridge.interest),
        arrangement: Math.round(ex.bridge.arrangement), exit: Math.round(ex.bridge.exit), total: Math.round(ex.bridge.total), months: ex.bridge.months };
      if (ex.holding) d.extraCosts.holding = { months: ex.holding.months, monthly: Math.round(ex.holding.monthly), total: Math.round(ex.holding.total) };
    }
    d.planning = getDealState(st);
  }

  // ---------------------------------------------------------------------
  // Breakdown lines (Full breakdown) and the summaries under each toggle
  // ---------------------------------------------------------------------
  function renderExtras(st) {
    if (st !== 'btl' && st !== 'flip') return;
    var p = PREFIX[st];
    var d = DI.dataOf(st) || {};
    var ex = extrasFor(st, d.pp || 0);
    var lines = [];
    if (ex.bridge) {
      var b = ex.bridge;
      lines.push('<p><b>Bridge: ' + money(b.total) + '</b> on a ' + money(b.loan) + ' bridge (' + pct(b.ltv) + ' of purchase price). ' +
        'Interest ' + money(b.interest) + ' (' + pct(b.rate) + ' a month for ' + num(b.months) + ' months), arrangement fee ' + money(b.arrangement) +
        ', exit fee ' + money(b.exit) + '.</p>');
    }
    if (ex.holding) {
      lines.push('<p><b>Holding costs: ' + money(ex.holding.total) + '</b> (' + num(ex.holding.months) + ' months empty at ' + money(ex.holding.monthly) + ' a month).</p>');
    }
    var box = $(p + '-xc');
    if (box) box.innerHTML = lines.length
      ? lines.join('') + '<p class="xc-note">' + (st === 'flip' ? 'Added to total cash invested and taken off net profit.' : 'Added to total investment and money left in.') + '</p>'
      : '';

    if (st === 'btl') {
      var bo = $('b-br-out');
      if (bo) {
        var bf = bridgeFigures(d.pp || 0);
        bo.textContent = d.pp > 0 ? 'Bridge cost ' + money(bf.total) + ': interest ' + money(bf.interest) + ', arrangement ' + money(bf.arrangement) + ', exit ' + money(bf.exit) + '.' : '';
      }
      var bm = $('b-br-months');
      if (bm) bm.placeholder = String(refiMonths());
    }
    var ho = $(p + '-hc-out');
    if (ho) { var h = holdingFigures(st); ho.textContent = 'Holding costs ' + money(h.total) + ' (' + num(h.months) + ' x ' + money(h.monthly) + ').'; }
  }

  function renderSummary(st) {
    var p = PREFIX[st];
    var sum = $(p + '-real-sum');
    if (!sum) return;
    var on = [];
    if (st === 'btl') {
      if (isOn('b-br-on') && onBrrrTab()) on.push('bridge');
      if (isOn('b-hc-on')) on.push('holding costs');
      if (isOn('b-tax-on')) on.push('after-tax');
    } else if (st === 'flip') {
      if (isOn('fl-hc-on')) on.push('holding costs');
    } else if (isOn(p + '-tax-on')) on.push('after-tax');
    sum.textContent = on.length ? on.join(', ') + ' on' : 'all off';
    var det = sum.closest('details');
    if (det) det.classList.toggle('real-on', on.length > 0);
  }

  // ---------------------------------------------------------------------
  // After-tax cashflow
  //   Profit before mortgage interest = the cash-purchase annual net
  //   (rent minus running costs), straight from the engine.
  //   Mortgage interest = year 1 interest on the loan for the financing
  //   on screen (interest-only: loan x rate; repayment: the interest part
  //   of the first 12 payments; BRRR: the refinance loan; cash: none).
  //   Personal tax = profit x band, minus a credit of 20% of the interest
  //   (the credit can't exceed 20% of the profit), never below £0.
  //   Company tax = (profit - interest) x 19%, never below £0.
  //   After-tax cashflow = the main results' annual cashflow - tax.
  // ---------------------------------------------------------------------
  var CF_ANNUAL = {
    btl: { m: 'mNy', r: 'rNy', c: 'cNy', brrr: 'bbNy' },
    hmo: { m: 'mNy', r: 'rNy', c: 'cNy', brrr: 'bbNy' },
    sa: { m: 'mCFy', r: 'rCFy', c: 'cCFy', brrr: 'bbCFy' }
  };
  function yearOneInterest(loan, ratePct, termYears, repaying) {
    if (!(loan > 0)) return 0;
    if (!repaying) return loan * ratePct / 100;
    var r = ratePct / 100 / 12, pay = mortRepay(loan, ratePct, termYears), bal = loan, total = 0;
    for (var k = 0; k < Math.min(12, termYears * 12); k++) {
      var i = bal * r;
      total += i;
      bal = Math.max(0, bal - (pay - i));
    }
    return total;
  }
  function taxBand(st) {
    var v = typeof getDDValue === 'function' ? getDDValue(PREFIX[st] + '-tax-band') : null;
    return CFG.tax.personalBands[v] ? v : CFG.tax.defaultBand;
  }

  function taxFigures(st, mode, d) {
    var T = CFG.tax;
    var profit = st === 'sa' ? d.cCFy : d.cNy;
    var loan = 0, repaying = false;
    if (mode === 'm' || mode === 'r') { loan = d.loan; repaying = mode === 'r'; }
    if (mode === 'brrr') { loan = d.brrrLoan; repaying = d.brrrType === 'repay'; }
    var interest = yearOneInterest(loan, d.mr, d.term, repaying);
    var pre = d[CF_ANNUAL[st][mode]];
    var band = taxBand(st), rate = T.personalBands[band].rate;
    var pGross = Math.max(0, profit) * rate / 100;
    var credit = T.mortgageInterestCredit / 100 * Math.min(interest, Math.max(0, profit));
    var pTax = Math.max(0, pGross - credit);
    var taxable = profit - interest;
    var cTax = Math.max(0, taxable) * T.corporationTax / 100;
    return { profit: profit, interest: interest, pre: pre, band: band, rate: rate, pGross: pGross, credit: credit,
      pTax: pTax, pAfter: pre - pTax, taxable: taxable, cTax: cTax, cAfter: pre - cTax };
  }

  function renderTax(st) {
    if (st === 'flip') return;
    var p = PREFIX[st];
    var sec = $(p + '-sec-tax'), body = $(p + '-tax');
    if (!sec || !body) return;
    var on = isOn(p + '-tax-on');
    sec.hidden = !on;
    var d = DI.dataOf(st) || {};
    if (!on || !(d.pp > 0)) { body.innerHTML = ''; setTaxSum(p, ''); return; }
    var mode = DI.activeMode(st);
    var f = taxFigures(st, mode, d);
    var T = CFG.tax;
    var diff = f.cAfter - f.pAfter;
    var winner = Math.abs(diff) < 1 ? null : diff > 0 ? 'ltd' : 'personal';
    var msg = !winner ? 'Personal and limited company come out the same on this deal.'
      : (winner === 'ltd' ? 'Limited company' : 'Personal') + ' keeps ' + money(Math.abs(diff)) + ' a year more on this deal.';
    var cell = function (v, w) { return '<td' + (winner === w ? ' class="cmp-win"' : '') + '>' + v + '</td>'; };
    var rows = [
      ['Cashflow before tax, a year', money(f.pre), money(f.pre), null],
      ['Tax, a year', money(f.pTax), money(f.cTax), null],
      ['After-tax cashflow, a year', money(f.pAfter), money(f.cAfter), true],
      ['After-tax cashflow, a month', money(f.pAfter / 12), money(f.cAfter / 12), true]
    ];
    var modeText = mode === 'brrr' ? 'the BRRR refinance' : DI.MODE_LABEL[mode].toLowerCase();
    var bandLabel = T.personalBands[f.band].label;
    body.innerHTML =
      '<p class="lc-msg ' + (winner ? 'lc-ok' : 'lc-ok') + '">' + esc(msg) + '</p>' +
      '<div class="di-table-wrap"><table class="di-table tx-table"><thead><tr><th scope="col"></th><th scope="col">Personal<small class="tx-sub">' + esc(bandLabel) + '</small></th><th scope="col">Limited company<small class="tx-sub">' + pct(T.corporationTax) + ' corporation tax</small></th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><th scope="row">' + r[0] + '</th>' + (r[3] ? cell(r[1], 'personal') + cell(r[2], 'ltd') : '<td>' + r[1] + '</td><td>' + r[2] + '</td>') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="tx-work"><p><b>Personal:</b> ' + money(f.profit) + ' rental profit before mortgage interest x ' + pct(f.rate) + ' = ' + money(f.pGross) +
      ', minus a ' + pct(T.mortgageInterestCredit) + ' credit on ' + money(f.interest) + ' mortgage interest (' + money(f.credit) + ') = ' + money(f.pTax) + ' tax.</p>' +
      '<p><b>Limited company:</b> ' + money(f.profit) + ' minus ' + money(f.interest) + ' mortgage interest = ' + money(f.taxable) + ' profit x ' + pct(T.corporationTax) + ' = ' + money(f.cTax) + ' tax.</p></div>' +
      '<p class="hint">On ' + esc(modeText) + '. Limited company figures are what the company keeps; paying it out to you as salary or dividends is taxed again. ' +
      'Company profits over ' + money(T.smallProfitsLimit) + ' a year pay more corporation tax, up to ' + pct(T.mainRate) + ' over ' + money(T.mainRateFrom) + '. ' +
      'Personal figures assume your tax-free allowance is used by other income. Rates for the 2026 to 2027 tax year.</p>' +
      (f.taxable > T.smallProfitsLimit ? '<p class="lc-timing">This deal\'s company profit is over ' + money(T.smallProfitsLimit) + ', so the real corporation tax will be higher than shown.</p>' : '') +
      '<p class="tx-disc">Simplified estimate. Tax depends on your full situation. Speak to an accountant.</p>';
    setTaxSum(p, !winner ? 'same either way' : (winner === 'ltd' ? 'limited company' : 'personal') + ' keeps ' + money(Math.abs(diff)) + ' a year more');
  }
  function setTaxSum(p, text) { var el = $(p + '-sec-tax-sum'); if (el) el.textContent = text; }

  // ---------------------------------------------------------------------
  // Toggles and inputs
  // ---------------------------------------------------------------------
  var TOGGLE_STRATEGY = { 'b-br-on': 'btl', 'b-hc-on': 'btl', 'b-tax-on': 'btl', 'h-tax-on': 'hmo', 'sa-tax-on': 'sa', 'fl-hc-on': 'flip' };
  var MARK = { btl: 'markStaleBTL', hmo: 'markStaleHMO', sa: 'markStaleSA', flip: 'markStaleFlip' };
  function markStale(st) { var f = window[MARK[st]]; if (typeof f === 'function') f(); }

  function setToggle(id, on) {
    var b = $(id);
    if (!b) return;
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    var body = $(id + '-body');
    if (body) body.hidden = !on;
  }
  function toggle(id) {
    var on = !isOn(id);
    setToggle(id, on);
    var st = TOGGLE_STRATEGY[id];
    // Switching after-tax on is a request to see it, so open the section.
    if (on && /-tax-on$/.test(id)) { var sec = $(PREFIX[st] + '-sec-tax'); if (sec) { sec.hidden = false; sec.open = true; } }
    markStale(st);
  }
  window.onTaxBandChange = function (id) {
    var st = { 'b-tax-band': 'btl', 'h-tax-band': 'hmo', 'sa-tax-band': 'sa' }[id];
    if (st) markStale(st);
  };
  function setBand(st, v) {
    if (!CFG.tax.personalBands[v]) v = CFG.tax.defaultBand;
    if (typeof setDDValue === 'function') setDDValue(PREFIX[st] + '-tax-band', v, CFG.tax.personalBands[v].label);
  }

  function render(st) {
    if (st === 'brrr') st = 'btl';
    renderExtras(st);
    renderTax(st);
    renderSummary(st);
  }
  function clear(st) {
    var p = PREFIX[st];
    var box = $(p + '-xc'); if (box) box.innerHTML = '';
    var t = $(p + '-tax'); if (t) t.innerHTML = '';
    setTaxSum(p, '');
    renderSummary(st);
  }

  // ---------------------------------------------------------------------
  // State: the page draft, and the copy saved with a deal
  // ---------------------------------------------------------------------
  var NUM_INPUTS = {
    btl: ['b-br-ltv', 'b-br-rate', 'b-br-arr', 'b-br-exit', 'b-br-months', 'b-hc-months', 'b-hc-cost'],
    flip: ['fl-hc-months', 'fl-hc-cost']
  };
  var TOGGLES = { btl: ['b-br-on', 'b-hc-on', 'b-tax-on'], hmo: ['h-tax-on'], sa: ['sa-tax-on'], flip: ['fl-hc-on'] };

  function getState() {
    var s = { toggles: {}, bands: {} };
    Object.keys(TOGGLES).forEach(function (st) { TOGGLES[st].forEach(function (id) { s.toggles[id] = isOn(id); }); });
    ['btl', 'hmo', 'sa'].forEach(function (st) { s.bands[st] = taxBand(st); });
    return s;
  }
  function setState(s) {
    if (!s || typeof s !== 'object') return;
    try {
      Object.keys(s.toggles || {}).forEach(function (id) { if (TOGGLE_STRATEGY[id]) setToggle(id, !!s.toggles[id]); });
      Object.keys(s.bands || {}).forEach(function (st) { if (PREFIX[st]) setBand(st, s.bands[st]); });
    } catch (e) { /* a bad draft leaves everything off */ }
  }
  function reset() {
    Object.keys(TOGGLE_STRATEGY).forEach(function (id) { setToggle(id, false); });
    ['btl', 'hmo', 'sa'].forEach(function (st) { setBand(st, CFG.tax.defaultBand); });
  }

  // Every input from the planning sections and these toggles that applies
  // to one strategy. Raw text, so a blank field reopens blank (= default).
  function getDealState(st) {
    var p = PREFIX[st];
    var s = { v: 1 };
    var ds = DP.getState();
    if (st === 'btl') {
      s.ownership = ds.ownership;
      s.lenderStress = rawVal('b-lc-stress');
      s.rentCover = rawVal('b-lc-cover');
      s.refiMonths = rawVal('bb-refi-months');
      s.bridge = { on: isOn('b-br-on'), ltv: rawVal('b-br-ltv'), monthlyRate: rawVal('b-br-rate'),
        arrangementFee: rawVal('b-br-arr'), exitFee: rawVal('b-br-exit'), months: rawVal('b-br-months') };
    }
    if (st === 'btl' || st === 'flip') s.holding = { on: isOn(p + '-hc-on'), months: rawVal(p + '-hc-months'), monthlyCost: rawVal(p + '-hc-cost') };
    if (st !== 'flip') {
      s.projection = ds.projection[st];
      s.tax = { on: isOn(p + '-tax-on'), band: taxBand(st) };
    }
    return s;
  }

  // Reopening a saved deal: put back exactly what it was saved with. A deal
  // saved before these existed (no planning, or a field missing) gets the
  // defaults, with every toggle off.
  function applyDealState(strategy, ps) {
    var st = strategy === 'brrr' ? 'btl' : strategy;
    if (!PREFIX[st]) return;
    ps = ps && typeof ps === 'object' ? ps : {};
    var p = PREFIX[st];
    // Missing from the saved deal: the config default.
    var DEFAULTS = {
      'b-lc-stress': CFG.lender.stressRate, 'b-lc-cover': CFG.lender.ownershipTypes[ps.ownership || CFG.lender.defaultOwnership] ? CFG.lender.ownershipTypes[ps.ownership || CFG.lender.defaultOwnership].rentCover : '',
      'bb-refi-months': CFG.refinance.defaultMonths,
      'b-br-ltv': CFG.bridge.ltv, 'b-br-rate': CFG.bridge.monthlyRate, 'b-br-arr': CFG.bridge.arrangementFee, 'b-br-exit': CFG.bridge.exitFee, 'b-br-months': '',
      'b-hc-months': CFG.holding.monthsEmpty, 'b-hc-cost': CFG.holding.monthlyCost,
      'fl-hc-months': CFG.holding.monthsEmpty, 'fl-hc-cost': CFG.holding.monthlyCost
    };
    var setVal = function (id, v) {
      var el = $(id);
      if (!el) return;
      el.value = typeof v === 'string' ? v : String(DEFAULTS[id] != null ? DEFAULTS[id] : '');
      if (typeof formatMoneyField === 'function' && /-hc-cost$/.test(id)) { try { formatMoneyField(el); } catch (e) {} }
    };
    try {
      if (st === 'btl') {
        var projState = {};
        projState.btl = ps.projection || { cg: CFG.projection.capitalGrowth + '', rg: CFG.projection.rentGrowth + '', costs: String(CFG.projection.costsRiseWithRent) };
        DP.setState({ ownership: ps.ownership || CFG.lender.defaultOwnership, projection: projState });
        setVal('b-lc-stress', ps.lenderStress);
        setVal('b-lc-cover', ps.rentCover);
        setVal('bb-refi-months', ps.refiMonths);
        var b = ps.bridge || {};
        setToggle('b-br-on', !!b.on);
        setVal('b-br-ltv', b.ltv); setVal('b-br-rate', b.monthlyRate); setVal('b-br-arr', b.arrangementFee);
        setVal('b-br-exit', b.exitFee); setVal('b-br-months', b.months);
      }
      if (st === 'btl' || st === 'flip') {
        var h = ps.holding || {};
        setToggle(p + '-hc-on', !!h.on);
        setVal(p + '-hc-months', h.months); setVal(p + '-hc-cost', h.monthlyCost);
      }
      if (st === 'hmo' || st === 'sa') {
        var pr = {};
        pr[st] = ps.projection || { cg: CFG.projection.capitalGrowth + '', rg: CFG.projection.rentGrowth + '', costs: String(CFG.projection.costsRiseWithRent) };
        DP.setState({ projection: pr });
      }
      if (st !== 'flip') {
        var t = ps.tax || {};
        setToggle(p + '-tax-on', !!t.on);
        setBand(st, t.band || CFG.tax.defaultBand);
      }
    } catch (e) { /* a bad saved value leaves the defaults in place */ }
  }

  // Defaults from deal-assumptions.js written into the page once, so
  // "Reset to my defaults" and the placeholders match the config.
  function init() {
    var setDef = function (id, v) { var el = $(id); if (el) { el.defaultValue = String(v); el.placeholder = String(v); } };
    setDef('b-br-ltv', CFG.bridge.ltv);
    setDef('b-br-rate', CFG.bridge.monthlyRate);
    setDef('b-br-arr', CFG.bridge.arrangementFee);
    setDef('b-br-exit', CFG.bridge.exitFee);
    ['b', 'fl'].forEach(function (p) {
      setDef(p + '-hc-months', CFG.holding.monthsEmpty);
      setDef(p + '-hc-cost', CFG.holding.monthlyCost);
    });
    var bm = $('b-br-months'); if (bm) bm.placeholder = String(refiMonths());
    ['btl', 'hmo', 'sa'].forEach(function (st) {
      var dd = $(PREFIX[st] + '-tax-band');
      if (dd && !CFG.tax.personalBands[dd.dataset.value]) setBand(st, CFG.tax.defaultBand);
    });
    Object.keys(TOGGLE_STRATEGY).forEach(function (id) { var b = $(id), body = $(id + '-body'); if (b && body) body.hidden = !isOn(id); });
    ['btl', 'hmo', 'sa', 'flip'].forEach(renderSummary);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // ---------- styles ----------
  var css =
    'details.adv.real>summary span.real-sum{font-weight:500}' +
    'details.adv.real.real-on>summary span.real-sum{color:var(--accent);font-weight:700}' +
    '.rz{border-top:1px solid var(--hairline);padding:.55rem 0 .35rem}' +
    '.rz:first-of-type{border-top:0;padding-top:0}' +
    '#panel-btl:not(.brrr-mode) .rz.brrr-only{display:none}' +
    '#panel-btl.brrr-mode .rz.brrr-only{display:block}' +
    '.rz .pj-switch{font-size:13.5px}' +
    '.rz-body{padding:.35rem 0 .3rem}' +
    '.rz-body[hidden]{display:none}' +
    '.rz-body .g2{margin-bottom:.6rem}' +
    '.rz-out{font-size:12.5px;color:var(--muted);margin:0}' +
    '.xc-break:empty{display:none}' +
    '.xc-break{border:1px solid var(--hairline);border-radius:10px;padding:.6rem .8rem;margin:.6rem 0 .8rem;font-size:13px;line-height:1.5;color:var(--ink)}' +
    '.xc-break p{margin:0 0 .3rem}.xc-break p:last-child{margin:0}' +
    '.xc-note{color:var(--muted);font-size:12px}' +
    'details.rsec[hidden]{display:none}' +
    '.tx-table thead th{white-space:normal;vertical-align:bottom}' +
    '.tx-sub{display:block;font-size:10px;font-weight:500;text-transform:none;letter-spacing:0}' +
    '.tx-work{font-size:12.5px;color:var(--muted);margin:.6rem 0 0;line-height:1.5}' +
    '.tx-work p{margin:0 0 .3rem}' +
    '.tx-work b{color:var(--ink)}' +
    '.tx-disc{margin:.6rem 0 0;font-size:12.5px;font-weight:600;color:var(--ink)}';
  var style = document.createElement('style');
  style.id = 'deal-realistic-styles';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  window.DealRealistic = {
    engineOverrides: engineOverrides, runMain: runMain, annotate: annotate,
    render: render, clear: clear, toggle: toggle,
    bridgeOn: function () { return isOn('b-br-on'); },
    getState: getState, setState: setState, reset: reset,
    getDealState: getDealState, applyDealState: applyDealState,
    // For checking the maths by hand.
    bridgeFigures: function () { return bridgeFigures((DI.dataOf('btl') || {}).pp || 0); },
    holdingFigures: holdingFigures,
    taxFigures: function (st) { return taxFigures(st, DI.activeMode(st), DI.dataOf(st)); }
  };
})();
