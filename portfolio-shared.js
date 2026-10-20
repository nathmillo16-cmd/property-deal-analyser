// portfolio-shared.js: display helpers and form definitions shared by
// portfolio.html (the list) and property.html (one property's page).
//
// No figures are worked out here except the "next key date" pick and the
// rate check on the property page. Yield, cashflow, equity, available to
// release, LTV and every compliance status come from the server
// (GET /api/portfolio), so the two pages always agree.

var PF = (function () {

  // Rate check default on the property page ("At a new rate of 5.5%...").
  var RATE_CHECK_DEFAULT = 5.5;
  // Remaining term used for a repayment mortgage when none is entered.
  var DEFAULT_REMAINING_TERM = 25;

  var STRATEGIES = ['BTL', 'HMO', 'SA', 'Flip', 'BRRR'];

  var STATUS_LABEL = { ok: 'OK', due_soon: 'Due soon', overdue: 'Overdue', missing: 'Missing', na: 'Not applicable' };

  function esc(s) {
    var div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }
  function gbp(v) { return v != null && isFinite(v) ? '£' + Math.round(Number(v)).toLocaleString('en-GB') : 'Not set'; }
  function pct(v, dp) { return v != null && isFinite(v) ? Number(v).toFixed(dp == null ? 1 : dp) + '%' : 'Not set'; }
  function parseDate(d) { var a = String(d).split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); }
  function date(d) { return d ? parseDate(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not set'; }
  function monthYear(d) { return d ? parseDate(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : 'Not set'; }
  function todayStr() {
    var n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }
  function daysUntil(d) { return Math.round((parseDate(d) - parseDate(todayStr())) / 86400000); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  var HOUSE_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 22 24 9l16 13"/><path d="M12 19v19h24V19"/><path d="M20 38V28h8v10"/></svg>';

  // ---------- compliance ----------
  // Summary for a whole property: { level, text } where level drives the
  // colour (green ok, amber due soon, red overdue, grey nothing entered).
  function complianceSummary(cs) {
    if (!cs) return { level: 'none', text: 'Not set up' };
    var due = cs.overdue + cs.due_soon;
    if (cs.overdue) return { level: 'overdue', text: plural(cs.overdue, 'item') + ' overdue' + (cs.due_soon ? ', ' + cs.due_soon + ' due soon' : '') };
    if (cs.due_soon) {
      var soonest = cs.items.filter(function (i) { return i.status === 'due_soon'; })
        .sort(function (a, b) { return a.days - b.days; })[0];
      return { level: 'due_soon', text: due === 1 ? '1 item due in ' + plural(soonest.days, 'day') : due + ' items due soon' };
    }
    if (cs.level === 'none') return { level: 'none', text: 'Not set up' };
    if (cs.missing) return { level: 'incomplete', text: plural(cs.missing, 'item') + ' to add' };
    return { level: 'ok', text: 'All compliant' };
  }

  function statusDot(level, label) {
    return '<span class="pf-dot pf-dot-' + esc(level) + '" role="img" aria-label="' + esc(label) + '" title="' + esc(label) + '"></span>';
  }

  // ---------- next key date ----------
  // The soonest date still to come: fixed rate end, BRRR refinance,
  // tenancy end, or a compliance expiry.
  function keyDates(p) {
    var out = [];
    var today = todayStr();
    if (p.fixed_rate_end_date) out.push({ date: p.fixed_rate_end_date, text: 'Fix ends ' + monthYear(p.fixed_rate_end_date) });
    if (p.refinance_date) out.push({ date: p.refinance_date, text: 'Refinance ' + date(p.refinance_date) });
    if (p.tenancy_end) out.push({ date: p.tenancy_end, text: 'Tenancy ends ' + date(p.tenancy_end) });
    var cs = p.compliance_status;
    if (cs && cs.items) cs.items.forEach(function (i) {
      if (i.expiry && i.status !== 'na') out.push({ date: i.expiry, text: i.label + ' due ' + date(i.expiry) });
    });
    return out.filter(function (k) { return k.date >= today; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }
  function nextKeyDate(p) { var k = keyDates(p); return k.length ? k[0] : null; }

  // ---------- rate check ----------
  // Uses calc-engine.js's own mort() (interest-only) and mortRepay()
  // (repayment), the same functions the calculator uses, when loaded.
  function monthlyPayment(balance, rate, type, termYears) {
    if (!(balance > 0) || !(rate >= 0)) return null;
    if (type === 'repayment') {
      if (typeof mortRepay !== 'function') return null;
      return mortRepay(balance, rate, termYears > 0 ? termYears : DEFAULT_REMAINING_TERM);
    }
    if (typeof mort !== 'function') return null;
    return mort(balance, rate);
  }

  // ---------- forms ----------
  // Field definitions for the pop-ups. showIf receives the current values
  // (the property merged with what's typed so far).
  var F = {
    address: { label: 'Address', type: 'text', required: true },
    property_type: { label: 'Strategy', type: 'strategy' },
    price_paid: { label: 'Price paid (£)', type: 'money', required: true },
    current_value: { label: 'Current value (£)', type: 'money', placeholder: 'Optional' },
    cash_invested: { label: 'Cash invested (£)', type: 'money', placeholder: 'Optional' },
    monthly_rent: { label: 'Monthly rent (£)', type: 'money', required: true },
    monthly_running_costs: { label: 'Monthly running costs (£)', type: 'money', required: true, hint: 'Management, insurance, maintenance. Not the mortgage.' },
    lender: { label: 'Lender', type: 'text' },
    interest_rate: { label: 'Interest rate (%)', type: 'number', step: '0.01' },
    mortgage_type: { label: 'Mortgage type', type: 'select', options: [['', 'Not set'], ['interest_only', 'Interest-only'], ['repayment', 'Repayment']] },
    fixed_rate_end_date: { label: 'Fixed rate ends', type: 'date' },
    refinance_date: { label: 'Refinance date', type: 'date', hint: 'For a BRRR still to be refinanced. Home flags it 60 days ahead.', showIf: function (v) { return v.property_type === 'BRRR'; } },
    mortgage_balance: { label: 'Mortgage balance (£)', type: 'money', placeholder: 'Blank if no mortgage' },
    monthly_mortgage: { label: 'Monthly payment (£)', type: 'money', placeholder: 'Blank if no mortgage' },
    remaining_term_years: { label: 'Remaining term (years)', type: 'number', step: '1', placeholder: String(DEFAULT_REMAINING_TERM), showIf: function (v) { return v.mortgage_type === 'repayment'; } },
    tenant_names: { label: 'Tenant name(s)', type: 'text' },
    tenancy_start: { label: 'Tenancy start', type: 'date' },
    tenancy_end: { label: 'Tenancy end', type: 'date' },
    rent_due_day: { label: 'Rent due (day of month)', type: 'number', step: '1', placeholder: 'e.g. 1' },
    deposit_amount: { label: 'Deposit amount (£)', type: 'money' }
  };

  var SECTIONS = {
    add: { title: 'Add property', fields: ['address', 'property_type', 'price_paid', 'current_value', 'cash_invested', 'monthly_rent', 'monthly_running_costs', 'monthly_mortgage', 'mortgage_balance'],
      note: 'You can add lender, tenancy and compliance details on the property page.' },
    overview: { title: 'Edit property', fields: ['address', 'property_type', 'price_paid', 'current_value', 'cash_invested', 'monthly_rent', 'monthly_running_costs'] },
    mortgage: { title: 'Mortgage', fields: ['lender', 'interest_rate', 'mortgage_type', 'fixed_rate_end_date', 'refinance_date', 'mortgage_balance', 'monthly_mortgage', 'remaining_term_years'], newSchema: true },
    equity: { title: 'Equity', fields: ['current_value', 'mortgage_balance'] },
    tenancy: { title: 'Tenancy', fields: ['tenant_names', 'tenancy_start', 'tenancy_end', 'rent_due_day', 'deposit_amount'], newSchema: true }
  };

  function inputHtml(key, def, value, opts) {
    var id = 'pff-' + key;
    var v = value == null ? '' : value;
    var attrs = ' id="' + id + '" data-key="' + key + '"';
    if (def.type === 'strategy') {
      var list = STRATEGIES.filter(function (s) { return s !== 'BRRR' || opts.schemaReady || v === 'BRRR'; });
      return '<select' + attrs + '>' + list.map(function (s) { return '<option value="' + s + '"' + (s === v ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>';
    }
    if (def.type === 'select') {
      return '<select' + attrs + '>' + def.options.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
    }
    if (def.type === 'date') return '<input type="date"' + attrs + ' value="' + esc(v) + '"/>';
    if (def.type === 'money' || def.type === 'number') {
      return '<input type="number" inputmode="decimal" step="' + (def.step || 'any') + '" min="0"' + attrs + ' value="' + esc(v) + '"' + (def.placeholder ? ' placeholder="' + esc(def.placeholder) + '"' : '') + '/>';
    }
    return '<input type="text"' + attrs + ' value="' + esc(v) + '"' + (def.placeholder ? ' placeholder="' + esc(def.placeholder) + '"' : '') + '/>';
  }

  // HTML for one section's fields, pre-filled from the property (or blank).
  function renderFields(section, p, opts) {
    opts = opts || {};
    return SECTIONS[section].fields.map(function (key) {
      var def = F[key];
      var val = p ? p[key] : (key === 'property_type' ? 'BTL' : '');
      return '<div class="field" data-field="' + key + '">' +
        '<label for="pff-' + key + '">' + esc(def.label) + '</label>' +
        inputHtml(key, def, val, opts) +
        (def.hint ? '<p class="pf-field-hint">' + esc(def.hint) + '</p>' : '') +
        '</div>';
    }).join('');
  }

  function readFields(root) {
    var out = {};
    root.querySelectorAll('[data-key]').forEach(function (el) { out[el.dataset.key] = el.value.trim(); });
    return out;
  }

  // Hides fields that don't apply (refinance date unless BRRR, remaining
  // term unless repayment). Hidden fields aren't sent.
  function applyVisibility(root, base) {
    var vals = Object.assign({}, base || {}, readFields(root));
    root.querySelectorAll('[data-field]').forEach(function (wrap) {
      var def = F[wrap.dataset.field];
      wrap.hidden = !!(def.showIf && !def.showIf(vals));
    });
  }
  function readVisibleFields(root) {
    var out = {};
    root.querySelectorAll('[data-field]').forEach(function (wrap) {
      if (wrap.hidden) return;
      var el = wrap.querySelector('[data-key]');
      out[el.dataset.key] = el.value.trim();
    });
    return out;
  }

  // Everything the server's PUT expects, from the property as loaded, so a
  // one-section edit doesn't blank the others.
  var SAVE_KEYS = ['address', 'price_paid', 'property_type', 'monthly_rent', 'monthly_running_costs', 'monthly_mortgage', 'cash_invested', 'current_value', 'mortgage_balance', 'refinance_date',
    'lender', 'interest_rate', 'mortgage_type', 'fixed_rate_end_date', 'remaining_term_years', 'tenant_names', 'tenancy_start', 'tenancy_end', 'rent_due_day', 'deposit_amount', 'compliance'];
  function basePayload(p) {
    var out = {};
    SAVE_KEYS.forEach(function (k) { out[k] = p[k] == null ? (k === 'compliance' ? {} : '') : p[k]; });
    return out;
  }
  function finalisePayload(payload) {
    // "Refinance date" only applies to a BRRR still to be refinanced.
    if (payload.property_type !== 'BRRR') payload.refinance_date = '';
    return payload;
  }

  // ---------- compliance form ----------
  var COMPLIANCE_FORM = [
    { key: 'gas', label: 'Gas safety', sub: 'Lasts 12 months' },
    { key: 'eicr', label: 'EICR', sub: 'Lasts 5 years' },
    { key: 'epc', label: 'EPC', sub: 'Lasts 10 years' },
    { key: 'deposit', label: 'Deposit protected' },
    { key: 'licence', label: 'Licence', sub: 'If your council requires one' },
    { key: 'alarms', label: 'Smoke and CO alarms checked' },
    { key: 'right_to_rent', label: 'Right to rent checked' }
  ];
  function renderComplianceForm(c) {
    c = c || {};
    return COMPLIANCE_FORM.map(function (item) {
      var v = c[item.key] || {};
      var id = 'pfc-' + item.key;
      var naLabel = item.key === 'licence' ? 'Not required' : 'Not applicable';
      var naChecked = item.key === 'licence' ? !!v.not_required : !!v.na;
      var body = '';
      if (item.key === 'licence') {
        body = '<div class="field"><label for="' + id + '-expiry">Expiry date</label><input type="date" id="' + id + '-expiry" value="' + esc(v.expiry || '') + '"/></div>';
      } else if (item.key === 'deposit') {
        body = '<div class="field"><label for="' + id + '-protected">Protected?</label><select id="' + id + '-protected">' +
            [['', 'Not set'], ['yes', 'Yes'], ['no', 'No']].map(function (o) { return '<option value="' + o[0] + '"' + ((v.protected || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="' + id + '-scheme">Scheme</label><input type="text" id="' + id + '-scheme" maxlength="60" placeholder="e.g. DPS, TDS, mydeposits" value="' + esc(v.scheme || '') + '"/></div>' +
          '<div class="field"><label for="' + id + '-date">Date protected</label><input type="date" id="' + id + '-date" value="' + esc(v.date || '') + '"/></div>';
      } else {
        body = '<div class="field"><label for="' + id + '-date">Date done</label><input type="date" id="' + id + '-date" value="' + esc(v.date || '') + '"/></div>';
        if (item.key === 'epc') {
          body += '<div class="field"><label for="' + id + '-rating">Rating</label><select id="' + id + '-rating">' +
            ['', 'A', 'B', 'C', 'D', 'E', 'F', 'G'].map(function (r) { return '<option value="' + r + '"' + ((v.rating || '') === r ? ' selected' : '') + '>' + (r || 'Not set') + '</option>'; }).join('') + '</select></div>';
        }
      }
      return '<fieldset class="pfc-item" data-item="' + item.key + '"' + (naChecked ? ' data-na="1"' : '') + '>' +
        '<legend>' + esc(item.label) + (item.sub ? ' <span>' + esc(item.sub) + '</span>' : '') + '</legend>' +
        '<label class="pfc-na"><input type="checkbox" id="' + id + '-na"' + (naChecked ? ' checked' : '') + '/> ' + naLabel + '</label>' +
        '<div class="pfc-fields">' + body + '</div></fieldset>';
    }).join('');
  }
  function readComplianceForm(root) {
    var out = {};
    COMPLIANCE_FORM.forEach(function (item) {
      var id = 'pfc-' + item.key;
      var get = function (suffix) { var el = root.querySelector('#' + id + '-' + suffix); return el ? el.value.trim() : ''; };
      var na = root.querySelector('#' + id + '-na').checked;
      if (na) { out[item.key] = item.key === 'licence' ? { not_required: true } : { na: true }; return; }
      var v = {};
      if (item.key === 'licence') { if (get('expiry')) v.expiry = get('expiry'); }
      else {
        if (get('date')) v.date = get('date');
        if (item.key === 'epc' && get('rating')) v.rating = get('rating');
        if (item.key === 'deposit') { if (get('protected')) v.protected = get('protected'); if (get('scheme')) v.scheme = get('scheme'); }
      }
      if (Object.keys(v).length) out[item.key] = v;
    });
    return out;
  }

  // ---------- photos ----------
  // Same compression as deal photos: longest side 1600px, JPEG.
  function compressPhoto(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        var data = c.toDataURL('image/jpeg', 0.82);
        resolve(data.slice(data.indexOf(',') + 1));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file could not be read as a photo.')); };
      img.src = url;
    });
  }

  return {
    RATE_CHECK_DEFAULT: RATE_CHECK_DEFAULT, DEFAULT_REMAINING_TERM: DEFAULT_REMAINING_TERM, STATUS_LABEL: STATUS_LABEL, SECTIONS: SECTIONS, HOUSE_ICON: HOUSE_ICON,
    esc: esc, gbp: gbp, pct: pct, date: date, monthYear: monthYear, daysUntil: daysUntil, plural: plural,
    complianceSummary: complianceSummary, statusDot: statusDot, keyDates: keyDates, nextKeyDate: nextKeyDate, monthlyPayment: monthlyPayment,
    renderFields: renderFields, readFields: readFields, readVisibleFields: readVisibleFields, applyVisibility: applyVisibility,
    basePayload: basePayload, finalisePayload: finalisePayload,
    renderComplianceForm: renderComplianceForm, readComplianceForm: readComplianceForm, compressPhoto: compressPhoto
  };
})();
