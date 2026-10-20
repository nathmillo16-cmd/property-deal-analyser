// deal-verdict.js: the deal verdict rules ("Strong deal" / "Marginal" /
// "Doesn't stack") and the small formatters they use, shared by the
// calculator (deal-insights.js) and the Deals pages' deal cards
// (deal-cards.js), so a saved deal's card always shows the same verdict
// the calculator showed. Moved here unchanged from deal-insights.js.
//
// NO MATHS OF ITS OWN: it only compares figures calc-engine.js already
// worked out (cashflow, yield, ROI) with the user's own targets.
// Loads before deal-insights.js on the calculator. Has no dependencies.

(function () {
  var MODE_LABEL = { m: 'Interest-only', r: 'Repayment', c: 'Cash', brrr: 'BRRR' };
  var CF_KEY = {
    btl: { m: 'mNm', r: 'rNm', c: 'cNm', brrr: 'bbNm' },
    hmo: { m: 'mNm', r: 'rNm', c: 'cNm', brrr: 'bbNm' },
    sa: { m: 'mCFm', r: 'rCFm', c: 'cCFm', brrr: 'bbCFm' }
  };
  var ROI_KEY = { m: 'mROI', r: 'rROI', c: 'cROI', brrr: 'bbROI' };
  var CASH_IN_KEY = { m: 'mTI', r: 'mTI', c: 'cTI', brrr: 'bbMLI' };

  function metrics(st, mode, d) {
    var m = {
      cf: d[CF_KEY[st][mode]], roi: d[ROI_KEY[mode]], gy: d.gy,
      cashIn: d[CASH_IN_KEY[mode]], ty: d.ty, tr: st === 'btl' ? d.tr : d.troi
    };
    // BRRR with every penny back out: the engine's ROI divides by a zero or
    // negative "money left in", so treat the ROI target as met instead.
    m.allOut = mode === 'brrr' && m.cashIn <= 0;
    return m;
  }
  // ---------- formatting ----------
  function money(v) {
    if (v == null || !isFinite(v)) return '-';
    return (v < 0 ? '−' : '') + '£' + Math.abs(Math.round(v)).toLocaleString('en-GB');
  }
  function pct(v) {
    if (v == null || !isFinite(v)) return '-';
    var n = +(+v).toFixed(2);
    return (n < 0 ? '−' : '') + Math.abs(n).toString() + '%';
  }
  function num(v) { return (+(+v).toFixed(2)).toString(); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function roiText(m) { return m.allOut ? 'All money out' : pct(m.roi); }
  function vsAsking(bid, pp) {
    if (!(pp > 0)) return '';
    var diff = bid - pp;
    if (Math.abs(diff) < 1) return 'Same as asking';
    return money(Math.abs(diff)) + (diff < 0 ? ' below asking' : ' above asking');
  }

  // ---------- verdict ----------
  // Strong: cashflow positive and both targets met.
  // Marginal: cashflow positive and one of the two targets met.
  // Doesn't stack: cashflow zero or negative, or neither target met.
  function modeText(mode) { return mode === 'brrr' ? 'BRRR' : MODE_LABEL[mode].toLowerCase(); }
  function rentalVerdict(m, mode) {
    var yieldOk = m.gy >= m.ty;
    var roiOk = m.allOut || m.roi >= m.tr;
    var y = 'Yield ' + pct(m.gy), r = 'ROI ' + pct(m.roi), yLow = 'yield ' + pct(m.gy);
    if (!(m.cf > 0)) {
      return { level: 'bad', label: "Doesn't stack",
        reason: 'Cashflow is ' + money(m.cf) + ' a month on ' + modeText(mode) };
    }
    if (yieldOk && roiOk) {
      if (m.allOut) return { level: 'good', label: 'Strong deal',
        reason: y + ' beats your ' + num(m.ty) + '% target and all your money comes out' };
      return { level: 'good', label: 'Strong deal',
        reason: y + ' and ' + r + ' beat your ' + num(m.ty) + '% and ' + num(m.tr) + '% targets' };
    }
    if (yieldOk) return { level: 'warn', label: 'Marginal',
      reason: y + ' beats your ' + num(m.ty) + '% target, but ' + r + ' is under ' + num(m.tr) + '%' };
    if (roiOk) return { level: 'warn', label: 'Marginal',
      reason: (m.allOut ? 'All your money comes out' : r + ' beats your ' + num(m.tr) + '% target') +
        ', but ' + yLow + ' is under ' + num(m.ty) + '%' };
    return { level: 'bad', label: "Doesn't stack",
      reason: y + ' and ' + r + ' are under your ' + num(m.ty) + '% and ' + num(m.tr) + '% targets' };
  }

  function flipVerdict(d) {
    if (!(d.profit > 0)) return { level: 'bad', label: "Doesn't stack", reason: 'Loses ' + money(Math.abs(d.profit)) + ' after all costs' };
    if (d.roi >= d.troi) return { level: 'good', label: 'Strong deal', reason: 'ROI ' + pct(d.roi) + ' beats your ' + num(d.troi) + '% target' };
    return { level: 'warn', label: 'Marginal', reason: 'Makes ' + money(d.profit) + ', but ROI ' + pct(d.roi) + ' is under your ' + num(d.troi) + '% target' };
  }

  window.DealVerdict = {
    MODE_LABEL: MODE_LABEL, CF_KEY: CF_KEY, ROI_KEY: ROI_KEY, CASH_IN_KEY: CASH_IN_KEY,
    metrics: metrics, rentalVerdict: rentalVerdict, flipVerdict: flipVerdict,
    money: money, pct: pct, num: num, esc: esc, roiText: roiText, vsAsking: vsAsking, modeText: modeText
  };
})();
