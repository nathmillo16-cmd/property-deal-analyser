// Shared helpers for the /admin/*.html pages — label maps and activity-log
// formatting, used by index.html (Tier 1), tier2.html, tier3.html,
// partners.html, and contact.html. Kept as its own small file rather than
// duplicated per page, matching this app's existing convention for
// cross-page-but-not-app-wide helpers (compare-deals.js is shared the same
// way between saved-deals.html and pipeline.html).
//
// Relocated here (was admin/crm/crm-shared.js) as part of moving the whole
// admin area from /admin/crm/*.html to /admin/*.html. Worth noting: every
// page that used to load this file referenced it as `/crm-shared.js` (a
// root-level absolute path), while the file itself lived at
// `admin/crm/crm-shared.js` — a real, pre-existing 404 (confirmed live:
// curl /crm-shared.js -> 404, curl /admin/crm/crm-shared.js -> 200), so
// every function below was silently undefined on all four old CRM pages.
// Not something this rebuild was asked to fix, but fixed as a natural
// side effect of the relocation — every new page below references this
// file at its correct path, `/admin/crm-shared.js`.

function crmEscapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

// crmEscapeHtml is for text-node content — it doesn't escape a bare `"`,
// which is fine as element content but unsafe to drop straight into a
// double-quoted HTML attribute (e.g. a data-* attribute built from a
// free-text business name). Used the one place that happens (partners.html).
function crmEscapeAttr(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function crmFmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function crmFmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' at ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const CRM_STAGE_LABELS = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', active: 'Active', converted: 'Converted', lost: 'Lost', churned: 'Churned' };
const CRM_TIER_LABELS = { tier1_software: 'Tier 1 · Software', tier2_acquisition_partner: 'Tier 2 · Acquisition Partner', tier3_private_sourcing: 'Tier 3 · Private Sourcing' };
const CRM_CATEGORY_LABELS = { lead: 'Lead', client: 'Client', referral_partner: 'Referral Partner' };
const CRM_BUSINESS_CATEGORY_LABELS = { mortgage_broker: 'Mortgage Broker', accountant: 'Accountant', solicitor: 'Solicitor', surveyor: 'Surveyor', builder: 'Builder', letting_agent: 'Letting Agent' };

// event_detail's shape varies per event_type — see db/023-025's triggers
// and server.js's POST .../activity route for what each one actually
// writes. Values are escaped since they came from free-text input.
function crmFormatActivity(row) {
  const d = row.event_detail || {};
  switch (row.event_type) {
    case 'note': return 'Note: "' + crmEscapeHtml(d.text || '') + '"';
    case 'call_logged': return 'Call logged: "' + crmEscapeHtml(d.text || '') + '"';
    case 'email_sent': return 'Email logged: "' + crmEscapeHtml(d.text || '') + '"';
    case 'stage_changed':
      return 'Stage changed: ' + crmEscapeHtml(CRM_STAGE_LABELS[d.old_stage] || d.old_stage || '—') +
        ' → ' + crmEscapeHtml(CRM_STAGE_LABELS[d.new_stage] || d.new_stage || '—');
    case 'deal_reviewed':
      return 'Deal reviewed: ' + crmEscapeHtml(d.property_address || '') + ' (' + crmEscapeHtml(d.outcome || '') + ')';
    case 'task_completed': return 'Task completed: "' + crmEscapeHtml(d.title || '') + '"';
    case 'field_updated': return 'Contact details updated';
    default: return crmEscapeHtml(row.event_type);
  }
}
