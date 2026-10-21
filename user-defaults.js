// user-defaults.js: the user's investment defaults (Settings > Investment
// defaults) in one shape, for the calculator (index.html), the standalone
// calculators and the planning tools.
//
// UserDefaults.from(profile) takes the GET /api/profile response and
// returns plain numbers / words, or null for anything not set. Null always
// means "keep the page's built-in default". Nothing here calculates a
// result: it only says which figure goes into which input.
//
// Where each one comes from:
//   standard_fees.solicitor / .searches / .mortgage (arrangement fee),
//   default_* columns (db/030), target_ltv (refinance LTV, db/046) and
//   calc_defaults (everything else, db/057).
(function () {
  function n(v) {
    if (v === null || v === undefined || v === '') return null;
    var x = Number(v);
    return Number.isFinite(x) ? x : null;
  }
  function pick(v, allowed) { return allowed.indexOf(v) !== -1 ? v : null; }
  function sum() {
    var any = false, t = 0;
    for (var i = 0; i < arguments.length; i++) { if (arguments[i] != null) { any = true; t += arguments[i]; } }
    return any ? t : null;
  }

  function from(p) {
    p = p && typeof p === 'object' ? p : {};
    var fees = p.standard_fees && typeof p.standard_fees === 'object' ? p.standard_fees : {};
    var c = p.calc_defaults && typeof p.calc_defaults === 'object' ? p.calc_defaults : {};
    var d = {
      depositPct: n(p.default_deposit_pct),
      buyingAs: pick(c.buying_as, ['ltd', 'personal']),
      taxBand: pick(c.tax_band, ['basic', 'higher', 'additional']),
      solicitor: n(fees.solicitor),
      searches: n(fees.searches),
      survey: n(c.survey),
      brokerFee: n(c.broker_fee),
      arrangementFee: n(fees.mortgage),
      mortgageRate: n(p.default_mortgage_rate),
      termYears: n(p.default_mortgage_term_years),
      mortgageProduct: pick(c.mortgage_product, ['interest_only', 'repayment']),
      refiLtv: n(p.target_ltv),
      stressRate: n(c.stress_rate),
      icr: n(c.icr),
      bridgeRate: n(c.bridge_monthly_rate),
      bridgeArrangementPct: n(c.bridge_arrangement_pct),
      bridgeExitPct: n(c.bridge_exit_pct),
      managementPct: n(p.default_management_pct),
      maintenancePct: n(p.default_maintenance_pct),
      voidsPct: n(c.voids_pct),
      insurance: n(p.default_insurance),
      lettingFee: n(c.letting_fee),
      safetyCerts: n(c.safety_certs),
      refurbContingencyPct: n(p.default_refurb_contingency_pct),
      resultsTab: pick(p.default_mortgage_type, ['cash', 'interest_only', 'repayment'])
    };
    // The calculator's single "Mortgage fees" box covers both.
    d.mortgageFees = sum(d.arrangementFee, d.brokerFee);
    // Flip's single "Buying fees" box and the BRRR tool's "Purchase costs".
    d.buyingFees = sum(d.solicitor, d.searches, d.survey);
    // The lender check's ownership type: limited company, or personal at
    // the user's tax band (higher and additional rate share the 145% test).
    d.ownership = d.buyingAs === 'ltd' ? 'ltd'
      : d.buyingAs === 'personal' ? (d.taxBand === 'basic' || !d.taxBand ? 'basic' : 'higher')
      : null;
    return d;
  }

  // Sets an input to a default only while it still holds the page's own
  // built-in value (or is blank), so a restored draft, a reopened deal or
  // a figure the user has typed is never overwritten. Also makes the
  // default the field's reset value. Returns true if it changed.
  function fill(el, value, opts) {
    if (!el || value == null) return false;
    var o = opts || {};
    var cur = String(el.value).replace(/,/g, '').trim();
    var builtIn = String(el.getAttribute('value') != null ? el.getAttribute('value') : el.defaultValue || '').replace(/,/g, '').trim();
    var untouched = o.force || cur === '' || cur === builtIn || (el.placeholder && cur === String(el.placeholder).replace(/,/g, ''));
    el.defaultValue = String(value);
    if (!untouched) return false;
    el.value = String(value);
    return true;
  }

  window.UserDefaults = { from: from, fill: fill };
})();
