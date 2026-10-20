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
    postcode: { label: 'Postcode', type: 'text', placeholder: 'Optional' },
    listing_url: { label: 'Listing link', type: 'text', placeholder: 'https://' },
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
    overview: { title: 'Edit property', fields: ['address', 'postcode', 'listing_url', 'property_type', 'price_paid', 'current_value', 'cash_invested', 'monthly_rent', 'monthly_running_costs'] },
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
    'lender', 'interest_rate', 'mortgage_type', 'fixed_rate_end_date', 'remaining_term_years', 'tenant_names', 'tenancy_start', 'tenancy_end', 'rent_due_day', 'deposit_amount', 'compliance', 'postcode', 'listing_url'];
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

  // ---------- records (db/047): money, files, expenses ----------
  // Money with pence, for logs and the tax summary (£1,234.50).
  function gbp2(v) {
    if (v == null || !isFinite(v)) return 'Not set';
    var n = Number(v);
    return (n < 0 ? '-£' : '£') + Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function monthLabel(m, long) { return parseDate(m).toLocaleDateString('en-GB', { month: long ? 'long' : 'short', year: 'numeric' }); }
  function fileSize(bytes) {
    if (!(bytes > 0)) return '';
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(bytes / 1024)) + 'KB';
  }

  // Same order as UK property income records. Mortgage interest is kept
  // separate as finance costs.
  var EXPENSE_CATEGORIES = [
    ['repairs', 'Repairs and maintenance'],
    ['insurance', 'Insurance'],
    ['letting_fees', 'Letting and management fees'],
    ['legal_professional', 'Legal and professional fees'],
    ['utilities', 'Utilities and services'],
    ['ground_rent', 'Ground rent and service charges'],
    ['council_tax', 'Council tax (while empty)'],
    ['mortgage_interest', 'Mortgage interest (finance costs)'],
    ['other', 'Other']
  ];
  var EXPENSE_LABEL = {};
  EXPENSE_CATEGORIES.forEach(function (c) { EXPENSE_LABEL[c[0]] = c[1]; });

  var DOC_TYPES = [
    ['tenancy', 'Tenancy agreement'],
    ['gas', 'Gas certificate'],
    ['eicr', 'EICR'],
    ['epc', 'EPC'],
    ['mortgage_offer', 'Mortgage offer'],
    ['insurance', 'Insurance'],
    ['other', 'Other']
  ];
  var DOC_LABEL = {};
  DOC_TYPES.forEach(function (d) { DOC_LABEL[d[0]] = d[1]; });
  // A gas certificate, EICR or EPC suggests its own compliance item.
  var DOC_SUGGESTS_COMPLIANCE = { gas: 'gas', eicr: 'eicr', epc: 'epc' };
  var COMPLIANCE_OPTIONS = COMPLIANCE_FORM.map(function (i) { return [i.key, i.label]; });

  var DOC_MAX_BYTES = 10 * 1024 * 1024;

  function readAsBase64(blobOrFile) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
      r.onerror = function () { reject(new Error('That file could not be read.')); };
      r.readAsDataURL(blobOrFile);
    });
  }
  function compressImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // PNG transparency to white, not black
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        var data = c.toDataURL('image/jpeg', quality);
        resolve(data.slice(data.indexOf(',') + 1));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image. Use a PDF, JPEG or PNG.')); };
      img.src = url;
    });
  }

  // Turns a picked file into { type, data (base64), file_name } for upload.
  //   'receipt'   photos are compressed (about 2000px JPEG); PDFs as they are.
  //   'document'  PDF, JPEG and PNG as they are when under 10MB; anything
  //               else that is an image (e.g. a phone's HEIC) is converted
  //               to JPEG, as is an image over 10MB.
  function prepareUpload(file, mode) {
    if (!file) return Promise.reject(new Error('Choose a file.'));
    var name = file.name || 'file';
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(name);
    if (isPdf) {
      if (file.size > DOC_MAX_BYTES) return Promise.reject(new Error('That PDF is over 10MB.'));
      return readAsBase64(file).then(function (data) { return { type: 'application/pdf', data: data, file_name: name }; });
    }
    var isImage = /^image\//.test(file.type) || /\.(jpe?g|png|heic|heif|webp)$/i.test(name);
    if (!isImage) return Promise.reject(new Error('Use a PDF, JPEG or PNG.'));
    var keep = mode === 'document' && (file.type === 'image/jpeg' || file.type === 'image/png') && file.size <= DOC_MAX_BYTES;
    if (keep) return readAsBase64(file).then(function (data) { return { type: file.type, data: data, file_name: name }; });
    return compressImage(file, mode === 'document' ? 2400 : 2000, 0.85).then(function (data) {
      return { type: 'image/jpeg', data: data, file_name: name.replace(/\.[a-z0-9]+$/i, '') + '.jpg' };
    });
  }

  // Expense form, used by the property page and the Portfolio page's
  // "+ Expense". opts.properties ([{id,address}]) adds a property picker.
  function expenseFormHtml(opts) {
    opts = opts || {};
    var e = opts.expense || {};
    var html = '';
    if (opts.properties) {
      html += '<div class="field pf-span"><label for="pfe-property">Property</label><select id="pfe-property">' +
        opts.properties.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === opts.propertyId ? ' selected' : '') + '>' + esc(p.address) + '</option>'; }).join('') + '</select></div>';
    }
    html += '<div class="field"><label for="pfe-date">Date</label><input type="date" id="pfe-date" value="' + esc(e.expense_date || todayStr()) + '" max="' + todayStr() + '"/></div>' +
      '<div class="field"><label for="pfe-amount">Amount (£)</label><input type="number" id="pfe-amount" inputmode="decimal" step="0.01" min="0" value="' + esc(e.amount != null ? e.amount : '') + '" placeholder="0.00"/></div>' +
      '<div class="field pf-span"><label for="pfe-category">Category</label><select id="pfe-category">' +
        '<option value="">Choose a category</option>' +
        EXPENSE_CATEGORIES.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === e.category ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('') +
      '</select><p class="pf-field-hint" id="pfe-cat-hint"></p></div>' +
      '<div class="field pf-span"><label for="pfe-desc">Description</label><input type="text" id="pfe-desc" maxlength="300" value="' + esc(e.description || '') + '" placeholder="e.g. Boiler service"/></div>';
    if (!opts.expense) {
      html += '<div class="field pf-span"><label for="pfe-receipt">Receipt <span class="pf-optional">optional</span></label>' +
        '<input type="file" id="pfe-receipt" accept="application/pdf,image/*"/>' +
        '<p class="pf-field-hint">A photo or PDF. Photos are made smaller before upload.</p></div>';
    } else if (e.has_receipt) {
      html += '<p class="pf-field-hint pf-span">The receipt stays attached. To change it, delete this expense and add it again.</p>';
    }
    return html;
  }
  function wireExpenseForm(root) {
    var sel = root.querySelector('#pfe-category');
    var hint = root.querySelector('#pfe-cat-hint');
    var update = function () {
      hint.textContent = sel.value === 'mortgage_interest' ? 'Interest only, not the capital. Kept separate from expenses as finance costs.'
        : (sel.value === 'council_tax' ? 'Only while the property is empty and you pay it.' : '');
    };
    sel.addEventListener('change', update); update();
  }
  function readExpenseForm(root) {
    var get = function (id) { var el = root.querySelector('#' + id); return el ? el.value.trim() : ''; };
    var out = { expense_date: get('pfe-date'), amount: get('pfe-amount'), category: get('pfe-category'), description: get('pfe-desc') };
    var prop = root.querySelector('#pfe-property'); if (prop) out.property_id = prop.value;
    var file = root.querySelector('#pfe-receipt');
    out.file = file && file.files && file.files[0] ? file.files[0] : null;
    if (!out.expense_date) return { error: 'Enter the date of the expense.' };
    if (!(Number(out.amount) > 0)) return { error: 'Enter an amount above £0.' };
    if (!out.category) return { error: 'Choose a category.' };
    return { value: out };
  }

  // Saves a new expense (with its receipt) or edits an existing one.
  // Returns the saved expense; throws with a plain message on failure.
  function saveExpense(apiBase, token, propertyId, form, expenseId) {
    var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
    var body = { expense_date: form.expense_date, amount: form.amount, category: form.category, description: form.description };
    var send = function () {
      var url = expenseId ? apiBase + '/api/property-expenses/' + encodeURIComponent(expenseId)
        : apiBase + '/api/portfolio/' + encodeURIComponent(propertyId) + '/expenses';
      return fetch(url, { method: expenseId ? 'PUT' : 'POST', headers: headers, body: JSON.stringify(body) })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (d) {
            if (res.status === 409 && d.needs_migration) throw new Error('Expenses can be added once a quick database update has been run.');
            if (!res.ok) throw new Error(d.error || 'That expense could not be saved.');
            return d;
          });
        });
    };
    if (!expenseId && form.file) {
      return prepareUpload(form.file, 'receipt').then(function (r) { body.receipt = r; return send(); });
    }
    return send();
  }

  // Tax year Y runs 6 April Y to 5 April Y+1.
  function currentTaxYear() {
    var t = todayStr(), y = Number(t.slice(0, 4));
    return t >= y + '-04-06' ? y : y - 1;
  }
  function taxYearLabel(y) { return '6 April ' + y + ' to 5 April ' + (y + 1); }

  return {
    gbp2: gbp2, monthLabel: monthLabel, fileSize: fileSize, todayStr: todayStr,
    EXPENSE_CATEGORIES: EXPENSE_CATEGORIES, EXPENSE_LABEL: EXPENSE_LABEL, DOC_TYPES: DOC_TYPES, DOC_LABEL: DOC_LABEL,
    DOC_SUGGESTS_COMPLIANCE: DOC_SUGGESTS_COMPLIANCE, COMPLIANCE_OPTIONS: COMPLIANCE_OPTIONS,
    prepareUpload: prepareUpload, expenseFormHtml: expenseFormHtml, wireExpenseForm: wireExpenseForm, readExpenseForm: readExpenseForm, saveExpense: saveExpense,
    currentTaxYear: currentTaxYear, taxYearLabel: taxYearLabel,
    RATE_CHECK_DEFAULT: RATE_CHECK_DEFAULT, DEFAULT_REMAINING_TERM: DEFAULT_REMAINING_TERM, STATUS_LABEL: STATUS_LABEL, SECTIONS: SECTIONS, HOUSE_ICON: HOUSE_ICON,
    esc: esc, gbp: gbp, pct: pct, date: date, monthYear: monthYear, daysUntil: daysUntil, plural: plural,
    complianceSummary: complianceSummary, statusDot: statusDot, keyDates: keyDates, nextKeyDate: nextKeyDate, monthlyPayment: monthlyPayment,
    renderFields: renderFields, readFields: readFields, readVisibleFields: readVisibleFields, applyVisibility: applyVisibility,
    basePayload: basePayload, finalisePayload: finalisePayload,
    renderComplianceForm: renderComplianceForm, readComplianceForm: readComplianceForm, compressPhoto: compressPhoto
  };
})();
