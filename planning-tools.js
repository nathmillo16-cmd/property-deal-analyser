// planning-tools.js: the maths behind the four Planning tools in the
// Tools menu, plus the buy box check used on deal cards, the deal page and
// the calculator. Pure functions, no page access, no network.
//
//   PlanningTools.stress()        Portfolio stress test
//   PlanningTools.refinance()     Refinance planner
//   PlanningTools.buyBox          Buy box: score a deal against the criteria
//   PlanningTools.loanLedger()    Private finance: balance owed on one loan
//   PlanningTools.loansSummary()  Private finance: the totals at the top
//   PlanningTools.loansDueSoon()  Private finance rows for Home's "Needs attention"
//
// Mortgage payments use calc-engine.js's own mort() (interest only) and
// mortRepay() (repayment), so every page that uses the stress test or the
// refinance planner loads calc-engine.js first. calc-engine.js itself is
// not changed.
//
// Portfolio figures start from the user's own saved property details
// (GET /api/portfolio): monthly rent, running costs, monthly mortgage
// payment, balance, rate, mortgage type, remaining term, fixed rate end
// date and current value. "Before" cashflow is exactly the Portfolio
// page's own figure (rent minus running costs minus the monthly payment).
//
// Buy box figures are the ones calc-engine.js already worked out and
// stored in deal_data when the deal was saved (the same figures the deal
// cards show). Nothing is recalculated.

var PlanningTools = (function () {
  'use strict';

  var DAY = 86400000;
  var DEFAULT_TERM_YEARS = 25; // a repayment mortgage with no remaining term entered

  // ---------------------------------------------------------------------
  // dates (plain 'YYYY-MM-DD' strings, worked out in UTC so day counts are exact)
  // ---------------------------------------------------------------------
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function ms(s) { var a = s.split('-').map(Number); return Date.UTC(a[0], a[1] - 1, a[2]); }
  function daysBetween(a, b) { return Math.round((ms(b) - ms(a)) / DAY); }
  function addDays(s, n) { var d = new Date(ms(s) + n * DAY); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  // Whole calendar months from a to b (b on or after a), e.g. 21 Oct 2026 to 21 Jun 2031 = 56.
  function wholeMonths(a, b) {
    var A = a.split('-').map(Number), B = b.split('-').map(Number);
    var m = (B[0] - A[0]) * 12 + (B[1] - A[1]);
    if (B[2] < A[2]) m -= 1;
    return Math.max(0, m);
  }
  // UK tax year start (6 April) for the tax year that contains `day`.
  function taxYearStart(day) {
    var y = Number(day.slice(0, 4));
    var start = y + '-04-06';
    return day >= start ? start : (y - 1) + '-04-06';
  }
  function monthYear(s) {
    if (!isDate(s)) return '';
    var a = s.split('-').map(Number);
    return new Date(Date.UTC(a[0], a[1] - 1, a[2])).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function longDate(s) {
    if (!isDate(s)) return '';
    var a = s.split('-').map(Number);
    return new Date(Date.UTC(a[0], a[1] - 1, a[2])).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function num(v) { var x = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(x) ? null : x; }
  function n0(v) { var x = num(v); return x == null ? 0 : x; }

  // ---------------------------------------------------------------------
  // Mortgage payment from the engine's own functions
  // ---------------------------------------------------------------------
  function payment(balance, rate, type, termYears) {
    if (!(balance > 0)) return 0;
    if (type === 'repayment') return mortRepay(balance, rate, termYears > 0 ? termYears : DEFAULT_TERM_YEARS);
    return mort(balance, rate);
  }
  // Repayment mortgage balance after `months` payments of the standard
  // amortised payment: B x (1+r)^n - P x ((1+r)^n - 1) / r. Never below 0.
  function repaymentBalanceAfter(balance, rate, termYears, months) {
    var term = termYears > 0 ? termYears : DEFAULT_TERM_YEARS;
    var n = Math.min(months, term * 12);
    var P = mortRepay(balance, rate, term);
    var r = rate / 100 / 12;
    var left = r === 0 ? balance - P * n : balance * Math.pow(1 + r, n) - P * (Math.pow(1 + r, n) - 1) / r;
    return Math.max(0, left);
  }

  // ---------------------------------------------------------------------
  // PORTFOLIO STRESS TEST
  //
  // settings: { rise (% points), rentFall (%), voidMonths, repair (£) }
  //
  // Per property, a normal month:
  //   stressed rent    = rent x (1 - rent fall)
  //   rate rise cost   = payment at (rate + rise) - payment at rate
  //                      (interest only: balance x rise / 12; repayment:
  //                      mortRepay over the remaining term)
  //   "Today"          the rise only applies to properties NOT on a fix
  //                    that is still running (a fixed rate never rises
  //                    before it ends)
  //   "When fixes end" the rise applies to every mortgaged property
  //   monthly cashflow = stressed rent - running costs - (monthly payment + rise cost)
  // A year:
  //   annual cashflow  = monthly x 12 - void months x stressed rent
  //   portfolio annual = sum of every property's annual - one-off repair (once)
  // ICR at the stressed rate = yearly stressed rent / (balance x (rate + rise)), against 125%.
  // ---------------------------------------------------------------------
  var ICR_TARGET = 125;

  function stressProperty(p, s, today) {
    var rent = n0(p.monthly_rent), costs = n0(p.monthly_running_costs), pay = n0(p.monthly_mortgage);
    var bal = n0(p.mortgage_balance), rate = num(p.interest_rate);
    var type = p.mortgage_type === 'repayment' ? 'repayment' : 'interest_only';
    var term = n0(p.remaining_term_years);
    var hasMortgage = pay > 0 || bal > 0;
    var canStress = hasMortgage && bal > 0 && rate != null;
    var fixEnd = isDate(p.fixed_rate_end_date) ? p.fixed_rate_end_date : null;
    var onFix = !!(fixEnd && fixEnd > today);
    // If no monthly payment was entered but a balance and rate were, use the engine's payment.
    var basePay = pay > 0 ? pay : (canStress ? payment(bal, rate, type, term) : 0);
    var riseCost = canStress ? payment(bal, rate + s.rise, type, term) - payment(bal, rate, type, term) : 0;
    var sRent = rent * (1 - s.rentFall / 100);
    var payToday = basePay + (onFix ? 0 : riseCost);
    var payFix = basePay + riseCost;
    var mToday = sRent - costs - payToday;
    var mFix = sRent - costs - payFix;
    var voidLoss = s.voidMonths * sRent;
    var stressedRate = rate != null ? rate + s.rise : null;
    var icr = canStress && stressedRate > 0 ? (sRent * 12) / (bal * stressedRate / 100) * 100 : null;
    return {
      id: p.id, address: p.address || 'Property', rent: rent, stressedRent: sRent, costs: costs,
      payment: basePay, riseCost: riseCost, payToday: payToday, payFix: payFix,
      before: rent - costs - pay, monthlyToday: mToday, monthlyFix: mFix,
      annualBefore: (rent - costs - pay) * 12,
      annualToday: mToday * 12 - voidLoss, annualFix: mFix * 12 - voidLoss, voidLoss: voidLoss,
      hasMortgage: hasMortgage, canStress: canStress, missingRate: hasMortgage && !canStress,
      onFix: onFix, fixEnd: fixEnd, rate: rate, stressedRate: stressedRate, balance: bal, type: type,
      icr: icr, icrPass: icr == null ? null : icr >= ICR_TARGET,
      negativeToday: mToday * 12 - voidLoss < 0, negativeFix: mFix * 12 - voidLoss < 0
    };
  }

  function stress(properties, settings, today) {
    today = today || todayStr();
    var s = {
      rise: n0(settings && settings.rise), rentFall: n0(settings && settings.rentFall),
      voidMonths: n0(settings && settings.voidMonths), repair: n0(settings && settings.repair)
    };
    var rows = (properties || []).map(function (p) { return stressProperty(p, s, today); });
    var sum = function (k) { return rows.reduce(function (t, r) { return t + r[k]; }, 0); };
    var out = {
      settings: s, rows: rows,
      monthlyBefore: sum('before'), annualBefore: sum('annualBefore'),
      monthlyToday: sum('monthlyToday'), monthlyFix: sum('monthlyFix'),
      annualToday: sum('annualToday') - s.repair, annualFix: sum('annualFix') - s.repair,
      negativeToday: rows.filter(function (r) { return r.negativeToday; }),
      negativeFix: rows.filter(function (r) { return r.negativeFix; }),
      missingRate: rows.filter(function (r) { return r.missingRate; }),
      onFixCount: rows.filter(function (r) { return r.onFix && r.canStress; }).length,
      icrTarget: ICR_TARGET
    };
    out.breakpoint = stressBreakpoint(properties, s, today);
    return out;
  }

  // The biggest rate rise (in steps of 0.05%) at which the portfolio's
  // yearly cashflow, once every fix has ended, is still £0 or more, with
  // the other sliders as set. Cashflow only falls as the rate rises, so a
  // halving search finds it. Returns { kind: 'never' | 'always' | 'at', rise }.
  var BREAKPOINT_MAX = 10;
  function annualFixAt(properties, s, rise, today) {
    var s2 = { rise: rise, rentFall: s.rentFall, voidMonths: s.voidMonths, repair: s.repair };
    return (properties || []).reduce(function (t, p) { return t + stressProperty(p, s2, today).annualFix; }, 0) - s.repair;
  }
  function stressBreakpoint(properties, s, today) {
    if (annualFixAt(properties, s, 0, today) < 0) return { kind: 'never', rise: 0 };
    if (annualFixAt(properties, s, BREAKPOINT_MAX, today) >= 0) return { kind: 'always', rise: BREAKPOINT_MAX };
    var lo = 0, hi = BREAKPOINT_MAX;
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      if (annualFixAt(properties, s, mid, today) >= 0) lo = mid; else hi = mid;
    }
    return { kind: 'at', rise: Math.floor(lo * 20 + 1e-9) / 20, exact: lo };
  }

  // ---------------------------------------------------------------------
  // REFINANCE PLANNER
  //
  // settings: { growth (% a year), ltv (%), icr (%), stressRate (%),
  //             feePct (% of the new loan), legals (£), newRate (%),
  //             newType ('interest_only' | 'repayment'), newTerm (years) }
  // overrides: { [propertyId]: { date: 'YYYY-MM-DD', ercPct } }
  //
  // At the refinance date (fix end, or the BRRR refinance date, or today if
  // that has passed, unless the user picks another date):
  //   value         = current value x (1 + growth) ^ (months / 12)
  //   balance       = interest only: today's balance; repayment: amortised
  //                   monthly at today's rate over the remaining term
  //   max by LTV    = value x LTV
  //   max by rent   = (yearly rent / ICR) / stress rate
  //   new loan      = the lower of the two
  //   costs         = new loan x arrangement fee + legals and valuation
  //   ERC           = balance x ERC % (only when refinancing before the fix ends)
  //   releasable    = new loan - balance - costs - ERC, never below £0
  //   new payment   = on the new loan at the new rate (or on today's balance
  //                   when nothing can be released, as a straight remortgage)
  //   cashflow after = rent - running costs - new payment
  // ---------------------------------------------------------------------
  function refinanceProperty(p, s, ov, today) {
    var fixEnd = isDate(p.fixed_rate_end_date) ? p.fixed_rate_end_date : null;
    var refiDate = isDate(p.refinance_date) ? p.refinance_date : null;
    var planned = refiDate || fixEnd;
    if (!planned && !(ov && isDate(ov.date))) return null;
    var natural = planned && planned > today ? planned : today;
    var date = ov && isDate(ov.date) ? (ov.date < today ? today : ov.date) : natural;
    var months = wholeMonths(today, date);
    var rent = n0(p.monthly_rent), costs = n0(p.monthly_running_costs);
    var bal = n0(p.mortgage_balance), rate = num(p.interest_rate);
    var type = p.mortgage_type === 'repayment' ? 'repayment' : 'interest_only';
    var term = n0(p.remaining_term_years);
    var valueToday = num(p.current_value);
    var valueFromPrice = valueToday == null;
    if (valueFromPrice) valueToday = n0(p.price_paid);
    var value = valueToday * Math.pow(1 + s.growth / 100, months / 12);
    var balanceAt = type === 'repayment' && bal > 0 && rate != null ? repaymentBalanceAfter(bal, rate, term, months) : bal;
    var maxLtv = value * s.ltv / 100;
    var maxRent = s.icr > 0 && s.stressRate > 0 ? (rent * 12 / (s.icr / 100)) / (s.stressRate / 100) : 0;
    var lower = Math.min(maxLtv, maxRent);
    var limitedBy = maxRent < maxLtv ? 'rent' : 'ltv';
    var costsAmt = lower * s.feePct / 100 + s.legals;
    var early = !!(fixEnd && date < fixEnd);
    var ercPct = early ? n0(ov && ov.ercPct != null ? ov.ercPct : 0) : 0;
    var erc = early ? balanceAt * ercPct / 100 : 0;
    var raw = lower - balanceAt - costsAmt - erc;
    var releasable = Math.max(0, raw);
    var newLoan = releasable > 0 ? lower : balanceAt;
    var newPay = payment(newLoan, s.newRate, s.newType, s.newTerm);
    var currentPay = n0(p.monthly_mortgage);
    return {
      id: p.id, address: p.address || 'Property', date: date, plannedDate: natural, fixEnd: fixEnd,
      isBrrr: !!refiDate, months: months, valueToday: valueToday, valueFromPrice: valueFromPrice, value: value,
      balanceToday: bal, balance: balanceAt, type: type, rate: rate,
      maxLtv: maxLtv, maxRent: maxRent, lower: lower, limitedBy: limitedBy,
      costs: costsAmt, early: early, ercPct: ercPct, erc: erc, raw: raw, releasable: releasable,
      shortfall: lower < balanceAt ? balanceAt - lower : 0,
      newLoan: newLoan, newPayment: newPay, currentPayment: currentPay,
      cashflowNow: rent - costs - currentPay, cashflowAfter: rent - costs - newPay,
      rent: rent, runningCosts: costs
    };
  }

  function refinance(properties, settings, overrides, today) {
    today = today || todayStr();
    var s = {
      growth: n0(settings.growth), ltv: n0(settings.ltv), icr: n0(settings.icr), stressRate: n0(settings.stressRate),
      feePct: n0(settings.feePct), legals: n0(settings.legals), newRate: n0(settings.newRate),
      newType: settings.newType === 'repayment' ? 'repayment' : 'interest_only', newTerm: n0(settings.newTerm) || DEFAULT_TERM_YEARS
    };
    overrides = overrides || {};
    var rows = [], undated = [];
    (properties || []).forEach(function (p) {
      var r = refinanceProperty(p, s, overrides[p.id], today);
      if (r) rows.push(r); else undated.push({ id: p.id, address: p.address || 'Property' });
    });
    rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var next = rows.filter(function (r) { return r.releasable > 0; })[0] || null;
    return { settings: s, rows: rows, undated: undated, next: next,
      totalReleasable: rows.reduce(function (t, r) { return t + r.releasable; }, 0) };
  }

  // ---------------------------------------------------------------------
  // BUY BOX
  //
  // The box is saved on the user's profile (profiles.buy_box):
  //   { strategies: ['btl','brrr','hmo','sa','flip'], max_price, min_yield,
  //     min_cashflow, min_coc, max_left_in, areas: ['NG9','Beeston'],
  //     property_types: ['terraced',...], bedrooms_min, bedrooms_max }
  // Every field is optional; only the ones filled in are checked.
  //
  // Each check is pass, fail or "not known" (the deal doesn't have that
  // detail yet, e.g. no bedrooms on the deal page). Not known is not a pass.
  // Yield, cashflow and cash-on-cash only apply to rental strategies, and
  // money left in only to BRRR, so "Fits 5 of 6" counts only the checks
  // that apply to that deal.
  // BTL, HMO and SA use the interest-only figures (the same ones as the
  // deal cards); BRRR uses the after-refinance figures.
  // ---------------------------------------------------------------------
  var STRATEGY_LABELS = { btl: 'BTL', brrr: 'BRRR', hmo: 'HMO', sa: 'SA', flip: 'Flip' };
  var PROPERTY_TYPES = [['detached', 'Detached'], ['semi-detached', 'Semi-detached'], ['terraced', 'Terraced'], ['end-terrace', 'End of terrace'], ['flat', 'Flat'], ['bungalow', 'Bungalow'], ['maisonette', 'Maisonette'], ['other', 'Other']];
  var TYPE_LABEL = {}; PROPERTY_TYPES.forEach(function (t) { TYPE_LABEL[t[0]] = t[1]; });
  var CF_KEY_MODE = { btl: { m: 'mNm', r: 'rNm', c: 'cNm', brrr: 'bbNm' }, hmo: { m: 'mNm', r: 'rNm', c: 'cNm', brrr: 'bbNm' }, sa: { m: 'mCFm', r: 'rCFm', c: 'cCFm', brrr: 'bbCFm' } };
  var ROI_KEY_MODE = { m: 'mROI', r: 'rROI', c: 'cROI', brrr: 'bbROI' };

  function gbp(v) { var r = Math.round(v); return (r < 0 ? '-£' : '£') + Math.abs(r).toLocaleString('en-GB'); }
  function pctText(v) { return (+(+v).toFixed(2)).toString() + '%'; }

  function cleanList(a) {
    return Array.isArray(a) ? a.map(function (x) { return String(x).trim(); }).filter(Boolean) : [];
  }
  function normaliseBox(b) {
    b = b && typeof b === 'object' ? b : {};
    return {
      strategies: cleanList(b.strategies).filter(function (s) { return STRATEGY_LABELS[s]; }),
      max_price: num(b.max_price), min_yield: num(b.min_yield), min_cashflow: num(b.min_cashflow),
      min_coc: num(b.min_coc), max_left_in: num(b.max_left_in),
      areas: cleanList(b.areas), property_types: cleanList(b.property_types).filter(function (t) { return TYPE_LABEL[t]; }),
      bedrooms_min: num(b.bedrooms_min), bedrooms_max: num(b.bedrooms_max)
    };
  }
  function criteriaCount(b) {
    b = normaliseBox(b);
    var n = 0;
    if (b.strategies.length) n++;
    if (b.max_price != null) n++;
    if (b.min_yield != null) n++;
    if (b.min_cashflow != null) n++;
    if (b.min_coc != null) n++;
    if (b.max_left_in != null) n++;
    if (b.areas.length) n++;
    if (b.property_types.length) n++;
    if (b.bedrooms_min != null || b.bedrooms_max != null) n++;
    return n;
  }
  function isSet(b) { return criteriaCount(b) > 0; }

  function strategyOf(deal) {
    if (deal && deal.deal_type === 'btl' && deal.deal_data && deal.deal_data.strategy === 'brrr') return 'brrr';
    return deal ? deal.deal_type : '';
  }

  // An area matches when the deal's postcode starts with it (so "NG9"
  // matches "NG9 2ES" but not "NG90"), or when the words appear in the
  // deal's address or name ("Beeston" in "12 High Rd, Beeston").
  function normPc(s) { return String(s || '').toUpperCase().replace(/\s+/g, ''); }
  function areaMatches(area, deal) {
    var a = String(area).trim();
    if (!a) return false;
    var pc = normPc(deal.postcode);
    var text = [deal.address, deal.postcode, deal.deal_data && deal.deal_data.name].filter(Boolean).join(' ').toLowerCase();
    var looksLikePostcode = /^[A-Za-z]{1,2}\d[A-Za-z\d]?(\s*\d[A-Za-z]{0,2})?$/.test(a);
    if (looksLikePostcode) {
      var want = normPc(a);
      var outward = want.length <= 4 && !/\d[A-Z]{2}$/.test(want);
      if (pc) {
        if (outward) {
          // NG9 must not match NG90: the outward part of the deal's postcode
          // is everything except the last 3 characters.
          var dealOutward = pc.length > 3 ? pc.slice(0, -3) : pc;
          if (dealOutward === want) return true;
        } else if (pc.indexOf(want) === 0) return true;
      }
      var pattern = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
      return new RegExp('(^|[^a-z0-9])' + pattern + '($|[^a-z0-9])', 'i').test(text);
    }
    return text.indexOf(a.toLowerCase()) !== -1;
  }

  // opts.mode: 'm' | 'r' | 'c' | 'brrr' to use a financing view other than
  // the default (the calculator passes the tab on screen).
  // opts.skip: criteria keys to leave out (the calculator skips area, type
  // and bedrooms, which are only on a saved deal's page).
  function score(deal, box, opts) {
    opts = opts || {};
    var b = normaliseBox(box);
    var d = (deal && deal.deal_data) || {};
    var st = strategyOf(deal);
    var rental = st !== 'flip';
    var base = st === 'brrr' ? 'btl' : st;
    var mode = opts.mode || (st === 'brrr' ? 'brrr' : 'm');
    var skip = opts.skip || [];
    var checks = [];
    function add(key, label, state, detail) { if (skip.indexOf(key) === -1) checks.push({ key: key, label: label, state: state, detail: detail }); }
    function cmp(v, ok) { return v == null || !Number.isFinite(Number(v)) ? 'unknown' : (ok(Number(v)) ? 'pass' : 'fail'); }

    if (b.strategies.length) {
      var okS = b.strategies.indexOf(st) !== -1;
      add('strategies', 'Strategy', okS ? 'pass' : 'fail', (STRATEGY_LABELS[st] || st) + (okS ? ' is' : ' is not') + ' one of ' + b.strategies.map(function (s) { return STRATEGY_LABELS[s]; }).join(', '));
    }
    if (b.max_price != null) {
      add('max_price', 'Purchase price', cmp(d.pp, function (v) { return v <= b.max_price; }),
        d.pp != null ? gbp(d.pp) + ' vs your max ' + gbp(b.max_price) : 'No purchase price saved');
    }
    if (rental && b.min_yield != null) {
      add('min_yield', 'Gross yield', cmp(d.gy, function (v) { return v >= b.min_yield; }),
        d.gy != null ? pctText(d.gy) + ' vs your min ' + pctText(b.min_yield) : 'No yield saved');
    }
    if (rental && b.min_cashflow != null) {
      var cfKey = (CF_KEY_MODE[base] || {})[mode];
      var cf = cfKey ? d[cfKey] : null;
      add('min_cashflow', 'Monthly cashflow', cmp(cf, function (v) { return v >= b.min_cashflow; }),
        cf != null ? gbp(cf) + ' a month vs your min ' + gbp(b.min_cashflow) : 'No cashflow saved');
    }
    if (rental && b.min_coc != null) {
      var allOut = mode === 'brrr' && d.bbMLI != null && Number(d.bbMLI) <= 0;
      var roi = d[ROI_KEY_MODE[mode]];
      if (allOut) add('min_coc', 'Cash-on-cash return', 'pass', 'All your money comes out');
      else add('min_coc', 'Cash-on-cash return', cmp(roi, function (v) { return v >= b.min_coc; }),
        roi != null ? pctText(roi) + ' vs your min ' + pctText(b.min_coc) : 'No return saved');
    }
    if (st === 'brrr' && b.max_left_in != null) {
      var left = d.bbMLI != null ? Math.max(0, Number(d.bbMLI)) : null;
      add('max_left_in', 'Money left in', cmp(left, function (v) { return v <= b.max_left_in; }),
        left != null ? gbp(left) + ' vs your max ' + gbp(b.max_left_in) : 'No money left in saved');
    }
    if (b.areas.length) {
      var hasText = !!(deal.postcode || deal.address || d.name);
      var hit = hasText ? b.areas.filter(function (a) { return areaMatches(a, deal); })[0] : null;
      add('areas', 'Area', !hasText ? 'unknown' : (hit ? 'pass' : 'fail'),
        !hasText ? 'Add the address or postcode on the deal page' : (hit ? 'In ' + hit : 'Not in ' + b.areas.join(', ')));
    }
    if (b.property_types.length) {
      var t = deal.property_type;
      add('property_types', 'Property type', !t ? 'unknown' : (b.property_types.indexOf(t) !== -1 ? 'pass' : 'fail'),
        !t ? 'Add the property type on the deal page' : (TYPE_LABEL[t] || t) + (b.property_types.indexOf(t) !== -1 ? ' is' : ' is not') + ' on your list');
    }
    if (b.bedrooms_min != null || b.bedrooms_max != null) {
      var beds = num(deal.bedrooms);
      var want = b.bedrooms_min != null && b.bedrooms_max != null ? (b.bedrooms_min === b.bedrooms_max ? b.bedrooms_min + ' bed' : b.bedrooms_min + ' to ' + b.bedrooms_max + ' beds')
        : b.bedrooms_min != null ? b.bedrooms_min + '+ beds' : 'up to ' + b.bedrooms_max + ' beds';
      add('bedrooms', 'Bedrooms', beds == null ? 'unknown' : ((b.bedrooms_min == null || beds >= b.bedrooms_min) && (b.bedrooms_max == null || beds <= b.bedrooms_max) ? 'pass' : 'fail'),
        beds == null ? 'Add bedrooms on the deal page' : beds + ' vs your ' + want);
    }
    var passed = checks.filter(function (c) { return c.state === 'pass'; }).length;
    var unknown = checks.filter(function (c) { return c.state === 'unknown'; }).length;
    return {
      checks: checks, passed: passed, total: checks.length, unknown: unknown,
      fits: checks.length > 0 && passed === checks.length,
      level: !checks.length ? 'none' : passed === checks.length ? 'fit' : (checks.some(function (c) { return c.state === 'fail'; }) ? 'miss' : 'unknown')
    };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function badgeText(r) { return 'Fits ' + r.passed + ' of ' + r.total; }
  function badgeTitle(r) {
    return r.checks.map(function (c) { return (c.state === 'pass' ? 'Pass' : c.state === 'fail' ? 'Fail' : 'Not known') + ': ' + c.label + '. ' + c.detail; }).join('\n');
  }
  function badgeHtml(r) {
    if (!r || !r.total) return '';
    return '<span class="bb-badge bb-' + r.level + '" title="' + esc(badgeTitle(r)) + '">' +
      '<span class="bb-badge-ico" aria-hidden="true">' + (r.fits ? '&#10003;' : '') + '</span>' + esc(badgeText(r)) + '<span class="bb-sr"> buy box criteria</span></span>';
  }
  function listHtml(r) {
    if (!r || !r.total) return '';
    return '<ul class="bb-list">' + r.checks.map(function (c) {
      var word = c.state === 'pass' ? 'Pass' : c.state === 'fail' ? 'Fail' : 'Not known';
      return '<li class="bb-li bb-li-' + c.state + '"><span class="bb-li-mark" aria-hidden="true">' + (c.state === 'pass' ? '&#10003;' : c.state === 'fail' ? '&#10005;' : '?') + '</span>' +
        '<span class="bb-li-text"><span class="bb-li-label">' + esc(c.label) + '<span class="bb-sr"> ' + word + '</span></span><span class="bb-li-detail">' + esc(c.detail) + '</span></span></li>';
    }).join('') + '</ul>';
  }

  // Shared badge and list styles (deal cards, deal page, calculator).
  var BB_CSS =
    '.bb-badge{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;border-radius:999px;padding:3px 9px;white-space:nowrap;font-family:var(--font-body);line-height:1.3}' +
    '.bb-badge.bb-fit{background:var(--success-bg);color:var(--success-ink)}' +
    '.bb-badge.bb-miss{background:var(--surface-2);color:var(--muted)}' +
    '.bb-badge.bb-unknown{background:var(--warn-bg);color:var(--warn-ink)}' +
    '.bb-badge-ico:empty{display:none}' +
    '.bb-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
    '.bb-list{list-style:none;margin:0;padding:0}' +
    '.bb-li{display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--hairline);font-size:13.5px}' +
    '.bb-li:last-child{border-bottom:none}' +
    '.bb-li-mark{width:20px;height:20px;border-radius:50%;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700}' +
    '.bb-li-pass .bb-li-mark{background:var(--success-bg);color:var(--success-ink)}' +
    '.bb-li-fail .bb-li-mark{background:var(--danger-bg);color:var(--danger-ink)}' +
    '.bb-li-unknown .bb-li-mark{background:var(--warn-bg);color:var(--warn-ink)}' +
    '.bb-li-text{display:flex;flex-direction:column;min-width:0}' +
    '.bb-li-label{font-weight:600;color:var(--ink)}' +
    '.bb-li-detail{color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}';
  function injectBuyBoxStyles() {
    if (typeof document === 'undefined' || document.getElementById('buy-box-styles')) return;
    var st = document.createElement('style');
    st.id = 'buy-box-styles';
    st.textContent = BB_CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  injectBuyBoxStyles();

  // ---------------------------------------------------------------------
  // PRIVATE FINANCE: balance owed on one loan
  //
  // Interest builds up day by day from the start date, always as simple
  // interest on the balance earning interest:
  //   balance x rate x days / 365
  //   simple     the balance earning interest is the principal still owed.
  //   compound   the same, plus on each anniversary of the start date any
  //              interest still unpaid is added to that balance, so the
  //              next year's interest is charged on it too. Within a year
  //              the interest is simple on the balance at the start of that
  //              year (less any repayments since), so in year one compound
  //              and simple come out exactly the same.
  // Each repayment in the log pays off interest built up so far first, then
  // the balance. Owed today = balance earning interest + unpaid interest.
  // "Interest this tax year" = interest built up since 6 April (or since
  // the start date, if later), whether or not it has been paid yet.
  // Payment type (monthly or rolled up) changes nothing in the sums: with
  // monthly payments the user logs each payment and the unpaid interest
  // stays small; rolled up, it builds until repaid.
  // ---------------------------------------------------------------------
  // The same day and month n years on; 29 Feb becomes 28 Feb in a non-leap year.
  function addYears(s, n) {
    var a = s.split('-').map(Number);
    var y = a[0] + n, m = a[1], d = a[2];
    if (m === 2 && d === 29 && !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) d = 28;
    return y + '-' + pad(m) + '-' + pad(d);
  }

  function loanLedger(loan, repayments, asOf) {
    asOf = asOf || todayStr();
    var principal = n0(loan.amount);
    var rate = n0(loan.interest_rate) / 100;
    var compound = loan.interest_type === 'compound';
    var start = isDate(loan.start_date) ? loan.start_date : asOf;
    var taxStart = taxYearStart(asOf);
    var unpaid = 0, interestTotal = 0, interestTaxYear = 0, paidTotal = 0, overpaid = 0, capitalised = 0;
    var steps = [];
    var last = start;
    var years = 1;
    var nextAnniversary = addYears(start, 1);

    // Simple interest on the balance earning interest, from one date to another.
    function accrue(from, to) {
      if (to <= from) return 0;
      var add = principal * rate * daysBetween(from, to) / 365;
      unpaid += add;
      interestTotal += add;
      if (from >= taxStart) interestTaxYear += add;
      return add;
    }
    // Moves the ledger on to `to`, stopping at 6 April (so the tax-year
    // figure is exact) and, for compound loans, at each anniversary to add
    // the unpaid interest to the balance.
    function accrueTo(to) {
      var total = 0;
      while (last < to) {
        var stop = to;
        if (last < taxStart && taxStart < stop) stop = taxStart;
        if (compound && nextAnniversary < stop) stop = nextAnniversary;
        total += accrue(last, stop);
        last = stop;
        if (compound && last === nextAnniversary) {
          if (unpaid > 0) {
            steps.push({ kind: 'capitalise', date: last, interestBuilt: total, amount: unpaid, principalAfter: principal + unpaid, unpaidAfter: 0, year: years });
            principal += unpaid;
            capitalised += unpaid;
            unpaid = 0;
            total = 0;
          }
          years += 1;
          nextAnniversary = addYears(start, years);
        }
      }
      return total;
    }

    var list = (repayments || []).filter(function (r) { return isDate(r.paid_on) && r.paid_on <= asOf && n0(r.amount) > 0; })
      .slice().sort(function (a, b) { return a.paid_on < b.paid_on ? -1 : a.paid_on > b.paid_on ? 1 : 0; });
    list.forEach(function (r) {
      var on = r.paid_on < start ? start : r.paid_on;
      var built = accrueTo(on);
      var amt = n0(r.amount);
      paidTotal += amt;
      var toInterest = Math.min(amt, unpaid);
      unpaid -= toInterest;
      var toPrincipal = amt - toInterest;
      if (toPrincipal > principal) { overpaid += toPrincipal - principal; toPrincipal = principal; }
      principal -= toPrincipal;
      steps.push({ kind: 'repayment', date: r.paid_on, interestBuilt: built, amount: amt, toInterest: toInterest, toPrincipal: toPrincipal, principalAfter: principal, unpaidAfter: unpaid });
    });
    var builtSinceLast = accrueTo(asOf > start ? asOf : start);
    var owed = principal + unpaid;
    return {
      principal: principal, unpaidInterest: unpaid, owed: owed, interestTotal: interestTotal, capitalised: capitalised,
      interestTaxYear: interestTaxYear, taxYearStart: taxStart, paidTotal: paidTotal, overpaid: overpaid,
      steps: steps, builtSinceLast: builtSinceLast, asOf: asOf, start: start,
      repaid: owed < 0.5 && paidTotal > 0,
      monthlyInterest: principal * rate / 12
    };
  }

  // loans: rows from GET /api/private-loans, each with a repayments array.
  function loansSummary(loans, asOf) {
    asOf = asOf || todayStr();
    var borrowed = 0, owed = 0, taxYear = 0, next = null;
    var withLedger = (loans || []).map(function (l) {
      var led = loanLedger(l, l.repayments || [], asOf);
      borrowed += n0(l.amount);
      owed += led.owed;
      taxYear += led.interestTaxYear;
      if (!led.repaid && isDate(l.repayment_date) && (!next || l.repayment_date < next.date)) {
        next = { date: l.repayment_date, loan: l, owed: led.owed, overdue: l.repayment_date < asOf };
      }
      return { loan: l, ledger: led };
    });
    return { borrowed: borrowed, owed: owed, interestTaxYear: taxYear, next: next, loans: withLedger, taxYearStart: taxYearStart(asOf) };
  }

  // Repayments due within `days` days (default 30), or already overdue,
  // for Home's "Needs attention". Worked out when the page loads.
  function loansDueSoon(loans, asOf, days) {
    asOf = asOf || todayStr();
    var limit = addDays(asOf, days == null ? 30 : days);
    var out = [];
    (loans || []).forEach(function (l) {
      if (!isDate(l.repayment_date) || l.repayment_date > limit) return;
      var led = loanLedger(l, l.repayments || [], asOf);
      if (led.repaid || led.owed < 0.5) return;
      var d = daysBetween(asOf, l.repayment_date);
      var when = d < 0 ? 'Overdue ' + (-d) + ' day' + (d === -1 ? '' : 's') : d === 0 ? 'Due today' : 'Due in ' + d + ' day' + (d === 1 ? '' : 's');
      out.push({
        loan_id: l.id, deal_name: l.lender_name ? 'Repay ' + l.lender_name : 'Private loan repayment', reason: 'loan',
        severity: d < 0 ? 'overdue' : 'due_soon', days: d,
        detail: when + ': about ' + gbp(led.owed) + ' owed'
      });
    });
    out.sort(function (a, b) { return a.days - b.days; });
    return out;
  }

  return {
    todayStr: todayStr, isDate: isDate, daysBetween: daysBetween, wholeMonths: wholeMonths, addDays: addDays,
    taxYearStart: taxYearStart, monthYear: monthYear, longDate: longDate,
    payment: payment, repaymentBalanceAfter: repaymentBalanceAfter,
    stress: stress, stressBreakpoint: stressBreakpoint, ICR_TARGET: ICR_TARGET,
    refinance: refinance,
    buyBox: {
      STRATEGY_LABELS: STRATEGY_LABELS, PROPERTY_TYPES: PROPERTY_TYPES, TYPE_LABEL: TYPE_LABEL,
      normalise: normaliseBox, isSet: isSet, criteriaCount: criteriaCount, score: score, areaMatches: areaMatches,
      badgeHtml: badgeHtml, badgeText: badgeText, listHtml: listHtml, strategyOf: strategyOf
    },
    loanLedger: loanLedger, loansSummary: loansSummary, loansDueSoon: loansDueSoon
  };
})();
