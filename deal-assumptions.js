// =====================================================================
// DEAL ASSUMPTIONS CONFIG
// The one place to change the defaults used by the calculator's extra
// results sections: Lender check, Refinance timing, Compare strategies and
// the 10-year projection (all built in deal-planning.js).
//
// These are planning assumptions, not verified calculation rules. Changing
// them never changes the main results, which come from calc-engine.js.
// Users can override every one of these on the page.
// =====================================================================
window.DEAL_ASSUMPTIONS = {

  // ---- Lender affordability ("Will a lender lend this?") -------------
  // Max loan by rent  = (annual rent / rent cover) / stress rate
  // Max loan by LTV   = value x LTV
  // The lower of the two is what a lender is likely to offer.
  lender: {
    defaultOwnership: 'ltd',
    ownershipTypes: {
      ltd:    { label: 'Limited company',       rentCover: 125 },
      basic:  { label: 'Personal, basic rate',  rentCover: 125 },
      higher: { label: 'Personal, higher rate', rentCover: 145 }
    },
    stressRate: 5.5 // % a year, the rate lenders test the rent against
  },

  // ---- Refinance timing (BRRR) ----------------------------------------
  refinance: {
    defaultMonths: 6,  // months from purchase until the refinance
    minOwnershipMonths: 6 // below this, show the "many lenders require" note
  },

  // ---- 10-year projection ---------------------------------------------
  // Starts from the end market value. Mortgage payments stay fixed at
  // today's rate. Year 1 cashflow is exactly the main results' figure.
  projection: {
    years: 10,
    showYears: [1, 5, 10],
    capitalGrowth: 3,      // % a year, property value
    rentGrowth: 2.5,       // % a year, rent (or SA income)
    costsRiseWithRent: true // running costs grow at the rent growth rate
  },

  // =====================================================================
  // "MAKE IT REALISTIC" TOGGLES (deal-realistic.js). All OFF by default,
  // so the main results are exactly the calculator's own until switched on.
  // =====================================================================

  // ---- Bridging finance (BRRR) ----------------------------------------
  // Bridge loan    = purchase price x bridge LTV
  // Interest       = bridge loan x monthly interest x months held
  // Arrangement    = bridge loan x arrangement fee
  // Exit           = bridge loan x exit fee
  // Total bridge cost is added to total investment and money left in.
  // Months held defaults to "Months until refinance".
  // Last verified: October 2026 (typical UK bridging terms, not a quote).
  bridge: {
    ltv: 70,            // % of purchase price
    monthlyRate: 0.85,  // % a month
    arrangementFee: 2,  // % of the bridge loan
    exitFee: 0          // % of the bridge loan
  },

  // ---- Holding costs during refurb (BRRR, BTL, Flip) --------------------
  // Holding cost = months empty x monthly holding cost (council tax,
  // insurance, utilities). Added to total costs and money left in.
  // Last verified: October 2026 (a typical allowance, not a quote).
  holding: {
    monthsEmpty: 3,
    monthlyCost: 250    // £ a month
  },

  // ---- After-tax cashflow (BTL, BRRR, HMO, SA) -------------------------
  // Simplified. Personal: rental profit (before mortgage interest) taxed at
  // the chosen band, minus a tax credit of 20% of the mortgage interest.
  // Limited company: corporation tax on profit after mortgage interest.
  // Last verified: October 2026, for the 2026 to 2027 tax year, against
  // GOV.UK (income tax bands, finance cost relief, corporation tax rates).
  // Coming up: from April 2027, property income in England, Wales and NI
  // is taxed at 22% / 42% / 47%, with the interest credit at 22%. Update
  // the figures below when that starts.
  tax: {
    lastVerified: 'October 2026',
    defaultBand: 'basic',
    personalBands: {
      basic:      { label: 'Basic rate, 20%',      rate: 20 },
      higher:     { label: 'Higher rate, 40%',     rate: 40 },
      additional: { label: 'Additional rate, 45%', rate: 45 }
    },
    mortgageInterestCredit: 20, // % of mortgage interest, taken off the tax
    corporationTax: 19,         // % small profits rate
    smallProfitsLimit: 50000,   // £ a year; above this the rate rises
    mainRate: 25,               // % on profits over £250,000
    mainRateFrom: 250000
  }
};
