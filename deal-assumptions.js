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
  }
};
