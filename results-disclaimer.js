// results-disclaimer.js — the one place the "not financial advice" wording
// under calculation results lives.
//
// Usage: put an empty <p class="results-disclaimer"></p> wherever results are
// shown, and include <script src="/results-disclaimer.js"></script> in the
// page. Every such element is filled with RESULTS_DISCLAIMER_TEXT once the
// page has loaded. To change the wording everywhere, change it here only.
//
// Display only: reads and writes nothing calc-engine.js uses.

var RESULTS_DISCLAIMER_TEXT = 'Estimates based on your inputs and assumptions. Not financial advice. Check figures with a broker, surveyor or accountant before acting.';

function renderResultsDisclaimers(root){
  var els = (root || document).querySelectorAll('.results-disclaimer');
  for (var i = 0; i < els.length; i++) els[i].textContent = RESULTS_DISCLAIMER_TEXT;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function(){ renderResultsDisclaimers(); });
} else {
  renderResultsDisclaimers();
}
