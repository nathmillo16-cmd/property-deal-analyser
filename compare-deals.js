// Shared side-by-side deal comparison, used by pipeline.html (pipelined
// deals) and saved-deals.html (any 2+ saved deals). Reads only figures
// calc-engine.js already computed and stored in deal_data at save time —
// never recalculates anything. Loaded the same way as auth-guard.js, via a
// plain <script src>, so it has no build step and no load-order dependency
// on either page's own script.

const COMPARE_FIELDS = {
  btl: [
    { label: 'Purchase price', key: 'pp', type: 'c' },
    { label: 'EMV', key: 'emv', type: 'c' },
    { label: 'Gross yield', key: 'gy', type: 'p' },
    { label: 'ROI (mortgage)', key: 'mROI', type: 'p' },
    { label: 'ROI (cash)', key: 'cROI', type: 'p' },
    { label: 'Money left in (mortgage)', key: 'mMLI', type: 'c' },
    { label: 'Max bid (yield)', key: 'oY', type: 'c' },
    { label: 'Max bid (ROI)', key: 'oR', type: 'c' }
  ],
  hmo: [
    { label: 'Purchase price', key: 'pp', type: 'c' },
    { label: 'EMV', key: 'emv', type: 'c' },
    { label: 'Gross yield', key: 'gy', type: 'p' },
    { label: 'ROI (mortgage)', key: 'mROI', type: 'p' },
    { label: 'ROI (cash)', key: 'cROI', type: 'p' },
    { label: 'Total investment (mortgage)', key: 'mTI', type: 'c' },
    { label: 'Max bid (yield)', key: 'oY', type: 'c' },
    { label: 'Max bid (ROI)', key: 'oR', type: 'c' }
  ],
  sa: [
    { label: 'Purchase price', key: 'pp', type: 'c' },
    { label: 'EMV', key: 'emv', type: 'c' },
    { label: 'Annual revenue', key: 'annualRevenue', type: 'c' },
    { label: 'Gross yield', key: 'gy', type: 'p' },
    { label: 'ROI (mortgage)', key: 'mROI', type: 'p' },
    { label: 'ROI (cash)', key: 'cROI', type: 'p' },
    { label: 'Max bid (yield)', key: 'oY', type: 'c' },
    { label: 'Max bid (ROI)', key: 'oR', type: 'c' }
  ],
  flip: [
    { label: 'Purchase price', key: 'pp', type: 'c' },
    { label: 'Sale value', key: 'sv', type: 'c' },
    { label: 'Net profit', key: 'profit', type: 'c' },
    { label: 'ROI', key: 'roi', type: 'p' },
    { label: 'Profit margin', key: 'margin', type: 'p' },
    { label: 'Max bid (ROI)', key: 'oR', type: 'c' }
  ]
};

function fmtCompareC(n) { return '£' + Math.round(n).toLocaleString(); }
function fmtCompareP(n) { return n.toFixed(2) + '%'; }
function fmtCompareField(f, v) {
  if (v == null) return '—';
  return f.type === 'c' ? fmtCompareC(v) : fmtCompareP(v);
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
    (COMPARE_FIELDS[d.deal_type] || []).forEach(f => {
      if (!seen.has(f.label)) { seen.add(f.label); rows.push(f.label); }
    });
  });

  let html = '<table class="compare-table"><thead><tr><th>Figure</th>';
  deals.forEach(d => {
    html += `<th>${escapeHtmlForCompare(d.displayName)}<br><span style="font-family:var(--font-body);font-size:11px;color:var(--muted);font-weight:600">${d.deal_type.toUpperCase()}</span></th>`;
  });
  html += '</tr></thead><tbody>';
  rows.forEach(label => {
    html += `<tr><td>${label}</td>`;
    deals.forEach(d => {
      const fields = COMPARE_FIELDS[d.deal_type] || [];
      const f = fields.find(x => x.label === label);
      const val = f ? fmtCompareField(f, d.deal_data[f.key]) : '—';
      html += `<td>${val}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}
