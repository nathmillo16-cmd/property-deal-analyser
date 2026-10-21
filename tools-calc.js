// tools-calc.js: the maths behind the five standalone calculator pages
// (Tools menu > Calculators). Pure functions, no page access.
//
// Built on calc-engine.js and deal-assumptions.js, which every tool page
// loads first, so the numbers match the main calculator:
//   stamp(), STAMP_DUTY_CONFIG, mort()   from calc-engine.js (untouched)
//   DEAL_ASSUMPTIONS.lender / .bridge / .tax   from deal-assumptions.js
//
// The only figures here that the main calculator doesn't already have are:
//   - Standard (non-surcharge) stamp duty rates for a first property: the
//     engine's additional property bands minus the 5% surcharge.
//   - Bridging valuation and legal fees: flat £ amounts, simply added on.
// Everything else is the same formula the calculator's own sections use
// (see deal-planning.js lenderFigures(), deal-realistic.js bridgeFigures()
// and taxFigures()), rewritten here as inputs-in, figures-out functions
// because those versions read the calculator page directly.

var ToolsCalc = (function () {
  'use strict';

  // The additional property surcharge on top of standard SDLT rates, in
  // percentage points. Standard rate for a band = engine band rate - this.
  var SDLT_SURCHARGE = 5;

  function n(v) { var x = +v; return Number.isFinite(x) ? x : 0; }

  // ---------------------------------------------------------------------
  // Stamp duty (England and NI)
  // buyer: 'additional' (default), 'first' (standard rates) or 'company'
  // (companies pay the additional property rates on every purchase).
  // ---------------------------------------------------------------------
  function stampDuty(price, buyer) {
    var cfg = STAMP_DUTY_CONFIG;
    var p = n(price);
    var surcharge = buyer === 'first' ? 0 : SDLT_SURCHARGE;
    var out = { price: p, buyer: buyer || 'additional', total: 0, bands: [], belowThreshold: false };
    if (!(p > 0)) return out;
    if (buyer !== 'first' && p < cfg.surchargeThreshold) {
      out.belowThreshold = true;
      out.total = stamp(p).total;
      return out;
    }
    var from = 0, tax = 0;
    for (var i = 0; i < cfg.bands.length; i++) {
      var band = cfg.bands[i];
      var rate = band.rate - SDLT_SURCHARGE + surcharge;
      var to = Math.min(p, band.upTo);
      var inBand = Math.max(0, to - from);
      var part = inBand * rate / 100;
      out.bands.push({ from: from, to: band.upTo, rate: rate, taxed: inBand, tax: part });
      if (p > from) tax += part;
      from = band.upTo;
    }
    out.total = Math.round(tax);
    // Additional and company use the engine's own function for the total,
    // so it can never drift from the calculator.
    if (buyer !== 'first') out.total = stamp(p).total;
    out.effectiveRate = p > 0 ? out.total / p * 100 : 0;
    return out;
  }

  // ---------------------------------------------------------------------
  // Refinance (BRRR). Same as the calculator's BRRR tab, interest-only:
  //   cash in            = price + stamp duty (additional rates) + purchase costs + refurb
  //   new loan           = end value x refinance LTV
  //   cash pulled out    = new loan - arrangement fee
  //   money left in      = cash in - cash pulled out
  //   annual cashflow    = (rent - running costs - new loan x rate / 12) x 12
  //   ROI on money left  = annual cashflow / money left in
  // ---------------------------------------------------------------------
  function brrr(i) {
    var price = n(i.price), refurb = n(i.refurb), costs = n(i.costs), ev = n(i.endValue);
    var ltv = n(i.ltv), fee = n(i.fee), rent = n(i.rent), rate = n(i.rate), running = n(i.running);
    var sd = stamp(price).total;
    var cashIn = price + sd + costs + refurb;
    var loan = ev * ltv / 100;
    var cashOut = loan - fee;
    var left = cashIn - cashOut;
    var payment = mort(loan, rate);
    var monthly = rent - running - payment;
    var annual = monthly * 12;
    var roi = left > 0 ? annual / left * 100 : null;
    return { price: price, refurb: refurb, costs: costs, endValue: ev, ltv: ltv, fee: fee, rent: rent, rate: rate,
      running: running, stampDuty: sd, cashIn: cashIn, loan: loan, cashOut: cashOut, left: left,
      payment: payment, monthly: monthly, annual: annual, roi: roi, allOut: left <= 0 };
  }

  // ---------------------------------------------------------------------
  // Lender affordability. Same as the calculator's Lender check:
  //   max loan by rent = (annual rent / rent cover) / stress rate
  // ---------------------------------------------------------------------
  function lender(i) {
    var rent = n(i.rent), stress = n(i.stress), cover = n(i.cover), loan = n(i.loan);
    var annual = rent * 12;
    var max = stress > 0 && cover > 0 ? (annual / (cover / 100)) / (stress / 100) : 0;
    var hasLoan = loan > 0;
    // Rent a lender would want to see for the loan entered.
    var rentNeeded = hasLoan ? loan * (stress / 100) * (cover / 100) / 12 : 0;
    return { rent: rent, annual: annual, stress: stress, cover: cover, loan: loan, max: max, hasLoan: hasLoan,
      passes: hasLoan ? loan <= max + 0.5 : null, headroom: max - loan, rentNeeded: rentNeeded };
  }

  // ---------------------------------------------------------------------
  // Bridging cost. Interest, arrangement and exit fees are the same as the
  // calculator's "Bought with a bridge" toggle (simple monthly interest on
  // the full loan for every month held); valuation and legals are added.
  // ---------------------------------------------------------------------
  function bridging(i) {
    var loan = n(i.loan), rate = n(i.rate), months = n(i.months), arrPct = n(i.arrPct), exitPct = n(i.exitPct);
    var valuation = n(i.valuation), legals = n(i.legals);
    var interest = loan * rate / 100 * months;
    var arrangement = loan * arrPct / 100;
    var exit = loan * exitPct / 100;
    var total = interest + arrangement + exit + valuation + legals;
    return { loan: loan, rate: rate, months: months, arrPct: arrPct, exitPct: exitPct, valuation: valuation, legals: legals,
      interest: interest, arrangement: arrangement, exit: exit, bridgeOnly: interest + arrangement + exit,
      total: total, perMonth: months > 0 ? total / months : 0, pctOfLoan: loan > 0 ? total / loan * 100 : 0 };
  }

  // ---------------------------------------------------------------------
  // Personal vs limited company. Same as the calculator's "Show after-tax"
  // section, from monthly inputs:
  //   profit before interest = (rent - other costs) x 12
  //   Personal: tax = profit x band - 20% of the lower of interest and
  //             profit (Section 24 credit), never below 0
  //   Ltd:      tax = (profit - interest) x corporation tax rate, if positive
  //   after tax = profit - interest - tax
  //   Ltd, taken out as dividends (this calculator only, not in the main
  //   calculator): kept in company - dividend tax at the user's band on
  //   the amount above the dividend allowance
  // ---------------------------------------------------------------------
  function tax(i) {
    var T = window.DEAL_ASSUMPTIONS.tax;
    var band = T.personalBands[i.band] ? i.band : T.defaultBand;
    var rate = T.personalBands[band].rate;
    var profit = (n(i.rent) - n(i.costs)) * 12;
    var interest = n(i.interest) * 12;
    var pre = profit - interest;
    var gross = Math.max(0, profit) * rate / 100;
    var creditBase = Math.min(interest, Math.max(0, profit));
    var credit = T.mortgageInterestCredit / 100 * creditBase;
    var pTax = Math.max(0, gross - credit);
    var cTax = Math.max(0, pre) * T.corporationTax / 100;
    var pAfter = pre - pTax, cAfter = pre - cTax;
    // Taken out as dividends: what's kept in the company is paid out, and
    // dividend tax at the user's band applies above the allowance.
    var divRate = T.dividendRates[band];
    var divTaxable = Math.max(0, cAfter - T.dividendAllowance);
    var divTax = divTaxable * divRate / 100;
    var dAfter = cAfter - divTax;
    var diff = cAfter - pAfter;
    return { band: band, rate: rate, rentYear: n(i.rent) * 12, costsYear: n(i.costs) * 12, profit: profit, interest: interest,
      pre: pre, gross: gross, creditBase: creditBase, credit: credit, creditRate: T.mortgageInterestCredit, pTax: pTax, pAfter: pAfter,
      ctRate: T.corporationTax, cTax: cTax, cAfter: cAfter, diff: diff,
      divRate: divRate, divAllowance: T.dividendAllowance, divTaxable: divTaxable, divTax: divTax, dAfter: dAfter,
      divDiff: dAfter - pAfter,
      winner: Math.abs(diff) < 1 ? null : (diff > 0 ? 'ltd' : 'personal'),
      overSmallProfits: pre > T.smallProfitsLimit, lastVerified: T.lastVerified };
  }

  return { stampDuty: stampDuty, brrr: brrr, lender: lender, bridging: bridging, tax: tax, SDLT_SURCHARGE: SDLT_SURCHARGE };
})();
