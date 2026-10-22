// Shared side-by-side deal comparison, used by pipeline.html (pipelined
// deals) and saved-deals.html (any 2+ saved deals). Reads only figures
// calc-engine.js already computed and stored in deal_data at save time —
// never recalculates anything. Loaded the same way as auth-guard.js, via a
// plain <script src>, so it has no build step and no load-order dependency
// on either page's own script.

// BRRR deals are stored with deal_type 'btl' (same inputs, same cBTL()
// calculation) plus deal_data.strategy = 'brrr', set when saved from the
// calculator's BRRR tab. dealStrategy() is the one place that turns that
// into the strategy shown to the user: 'brrr', or the deal_type as-is.
function dealStrategy(d) {
  if (d && d.deal_type === 'btl' && d.deal_data && d.deal_data.strategy === 'brrr') return 'brrr';
  return d ? d.deal_type : '';
}

const COMPARE_FIELDS = {
  // Figures cBTL() already stores for its BRRR scenario (bb*/brrr* keys).
  brrr: [
    { label: 'Purchase price', key: 'pp', type: 'c' },
    { label: 'End value', key: 'emv', type: 'c' },
    { label: 'Money left in deal', key: 'bbMLI', type: 'c' },
    { label: 'Cash pulled out at refinance', key: 'brrrLoan', type: 'c' },
    { label: 'Monthly cashflow', key: 'bbNm', type: 'c' },
    { label: 'ROI (after refinance)', key: 'bbROI', type: 'p' },
    { label: 'Refinance LTV', key: 'brrrLtv', type: 'p' },
    { label: 'Gross yield (on price)', key: 'gy', type: 'p' },
    { label: 'Max bid (ROI)', key: 'oR', type: 'c', notAchievableAtOrBelow: 10000 }
  ],
  btl: [
    { label: 'Purchase price', key: 'pp', type: 'c' },
    { label: 'End value', key: 'emv', type: 'c' },
    { label: 'Gross yield (on price)', key: 'gy', type: 'p' },
    { label: 'ROI (mortgage)', key: 'mROI', type: 'p' },
    { label: 'ROI (cash)', key: 'cROI', type: 'p' },
    { label: 'Money left in (mortgage)', key: 'mMLI', type: 'c' },
    { label: 'Max bid (yield)', key: 'oY', type: 'c' },
    { label: 'Max bid (ROI)', key: 'oR', type: 'c', notAchievableAtOrBelow: 10000 }
  ],
  hmo: [
    { label: 'Purchase price', key: 'pp', type: 'c' },
    { label: 'End value', key: 'emv', type: 'c' },
    { label: 'Gross yield (on price)', key: 'gy', type: 'p' },
    { label: 'ROI (mortgage)', key: 'mROI', type: 'p' },
    { label: 'ROI (cash)', key: 'cROI', type: 'p' },
    { label: 'Total investment (mortgage)', key: 'mTI', type: 'c' },
    { label: 'Max bid (yield)', key: 'oY', type: 'c' },
    { label: 'Max bid (ROI)', key: 'oR', type: 'c', notAchievableAtOrBelow: 10000 }
  ],
  sa: [
    { label: 'Purchase price', key: 'pp', type: 'c' },
    { label: 'End value', key: 'emv', type: 'c' },
    { label: 'Annual revenue', key: 'annualRevenue', type: 'c' },
    { label: 'Gross yield (on price)', key: 'gy', type: 'p' },
    { label: 'ROI (mortgage)', key: 'mROI', type: 'p' },
    { label: 'ROI (cash)', key: 'cROI', type: 'p' },
    { label: 'Max bid (yield)', key: 'oY', type: 'c' },
    { label: 'Max bid (ROI)', key: 'oR', type: 'c', notAchievableAtOrBelow: 10000 }
  ],
  flip: [
    { label: 'Purchase price', key: 'pp', type: 'c' },
    { label: 'Sale value', key: 'sv', type: 'c' },
    { label: 'Net profit', key: 'profit', type: 'c' },
    { label: 'ROI', key: 'roi', type: 'p' },
    { label: 'Profit margin', key: 'margin', type: 'p' },
    { label: 'Max bid (ROI)', key: 'oR', type: 'c', notAchievableAtOrBelow: 1000 }
  ]
};

function fmtCompareC(n) { return '£' + Math.round(n).toLocaleString(); }
function fmtCompareP(n) { return n.toFixed(2) + '%'; }
// Max bid (ROI) is found by searching prices upwards from a floor (£10,000
// for BTL/BRRR/HMO/SA, £1,000 for Flip). When no price hits the target the
// search stops on that floor, and deals saved that way store the floor as
// if it were a real max bid. Shown as "Not achievable" instead.
function isMaxBidNotAchievable(f, v) {
  return !!f && f.notAchievableAtOrBelow != null && v != null && v <= f.notAchievableAtOrBelow;
}
function fmtCompareField(f, v) {
  if (v == null) return '—';
  if (isMaxBidNotAchievable(f, v)) return 'Not achievable';
  return f.type === 'c' ? fmtCompareC(v) : fmtCompareP(v);
}

// Gross yield moved from end value to purchase price on 21 Oct 2026, and
// gyEmv (the end-value version) started being saved at the same time. A
// rental deal with gy but no gyEmv was saved before that, so its gy is still
// the old end-value figure until it's re-run. Display only.
const GY_STALE_NOTE = 'Saved before 21 Oct, re-run to update';
function isGrossYieldPreOct21(d) {
  const st = dealStrategy(d);
  if (!['btl', 'brrr', 'hmo', 'sa'].includes(st)) return false;
  const dd = (d && d.deal_data) || {};
  return dd.gy != null && dd.gyEmv == null;
}
function gyStaleFlagHTML() {
  return '<span class="gy-stale" style="display:block;font-family:var(--font-body);font-size:10.5px;font-weight:500;line-height:1.3;color:var(--warn-ink,var(--muted));white-space:normal">' + GY_STALE_NOTE + '</span>';
}

function escapeHtmlForCompare(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// deals: [{ deal_type, deal_data, displayName }]. Any mix of strategies is
// fine — a field a given deal's strategy doesn't have just shows as '—'.
function buildCompareTableHTML(deals) {
  const rows = [];
  const seen = new Set();
  deals.forEach(d => {
    (COMPARE_FIELDS[dealStrategy(d)] || []).forEach(f => {
      if (!seen.has(f.label)) { seen.add(f.label); rows.push(f.label); }
    });
  });

  let html = '<table class="compare-table"><thead><tr><th>Figure</th>';
  deals.forEach(d => {
    html += `<th>${escapeHtmlForCompare(d.displayName)}<br><span style="font-family:var(--font-body);font-size:11px;color:var(--muted);font-weight:600">${dealStrategy(d).toUpperCase()}</span></th>`;
  });
  html += '</tr></thead><tbody>';
  rows.forEach(label => {
    html += `<tr><td>${label}</td>`;
    deals.forEach(d => {
      const fields = COMPARE_FIELDS[dealStrategy(d)] || [];
      const f = fields.find(x => x.label === label);
      const val = f ? fmtCompareField(f, d.deal_data[f.key]) : '—';
      const flag = f && f.key === 'gy' && isGrossYieldPreOct21(d) ? gyStaleFlagHTML() : '';
      html += `<td>${val}${flag}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  // Same "not financial advice" line as every other results panel
  // (results-disclaimer.js, loaded by both pages that use this table).
  if (typeof RESULTS_DISCLAIMER_TEXT !== 'undefined') {
    html += '<p class="results-disclaimer">' + RESULTS_DISCLAIMER_TEXT + '</p>';
  }
  return html;
}
