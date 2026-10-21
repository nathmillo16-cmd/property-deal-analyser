// refurb-workflow.js: the Quotes and Budget stages of the Refurbishment
// Estimator (refurb.html). Needs refurb-totals.js loaded first. Everything
// it stores goes through server.js (db/048); before that migration is run
// both stages say they need a quick database update.
//
// Budget maths (display only, no deal figures are touched):
//   Budget B is set by "Accept quote" (the quote amount) or "Use my estimate
//   as budget" (the estimate's grand total at that moment).
//   Contingency C: from an estimate it is the contingency already inside the
//   total (plus its VAT); from a quote it is the estimate's contingency %
//   applied on top of the quote.
//   Works budget W = B - C for an estimate budget, B for a quote budget.
//   Contingency left = C - max(0, spent - W).
//   Warnings at 90% (amber) and 100% (red) of B.
(function () {
  let ctx = null;
  let quotes = null, quotesState = null; // state: null | 'loading' | 'needs_db' | 'error'
  let payData = null, payState = null;
  let editingQuoteId = null;
  let quotesFor = null, paymentsFor = null;
  let notice = null;

  const TRADE_LABELS = Object.fromEntries(REFURB_SECTIONS.map(s => [s.id, s.name]).concat([['other', 'Other']]));
  // Quick-mode trades onto the categories payments are logged against.
  const QUICK_TO_SECTION = { electrics: 'electrics', plumbing: 'plumbing', bathroom: 'bathroom-kitchen-supply', kitchen: 'bathroom-kitchen-supply', plastering: 'plastering', painting: 'painting', flooring: 'flooring', roofing: 'roofing', 'windows-doors': 'windows-doors', masonry: 'masonry', garden: 'garden', demolition: 'demolition', epc: 'epc' };
  const TAX_NOTE = 'Refurb and improvement costs are usually treated differently for tax. Check with your accountant.';
  // Per-payment tax tag (db/049). Default "Not sure".
  const TAX_TAGS = { capital: 'Capital improvement', repair: 'Repair (like for like)', unsure: 'Not sure' };
  const TAX_TAG_HINT = 'Like-for-like repairs are usually deductible against rent. Improvements are usually capital. Your accountant decides.';
  function portfolioLabel(tag, address) {
    if (tag === 'repair') return { main: 'Also log this in Portfolio for ' + address, sub: 'Added to the property\'s expenses as Repairs and maintenance.' };
    if (tag === 'capital') return { main: 'Also log this in Portfolio for ' + address, sub: 'Added to the property\'s capital costs, separate from day-to-day expenses.' };
    return { main: 'Also log this in Portfolio for ' + address, sub: 'Added to the property\'s capital costs, flagged "check with accountant".' };
  }
  const DB_NOTE = 'This needs a quick database update (db/048) before it can be used. The rest of the estimator works as normal.';

  function headers(json) { const h = { Authorization: 'Bearer ' + ctx.session().access_token }; if (json) h['Content-Type'] = 'application/json'; return h; }
  async function api(method, path, body) {
    const res = await fetch(API_BASE + path, { method, headers: headers(!!body), body: body ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({}));
    if (res.status === 409 && d.needs_migration) { const e = new Error(/db\/04[9]/.test(d.error || '') ? d.error : DB_NOTE); e.needsDb = !/db\/049/.test(d.error || ''); throw e; }
    if (!res.ok) throw new Error(d.error || 'That did not work. Try again.');
    return d;
  }
  function fileToUpload(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      if (file.size > 10 * 1024 * 1024) return reject(new Error('Files can be up to 10MB.'));
      const type = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
      if (['application/pdf', 'image/jpeg', 'image/png'].indexOf(type) === -1) return reject(new Error('Files must be PDF, JPG or PNG.'));
      const r = new FileReader();
      r.onload = () => resolve({ type, data: String(r.result).split(',')[1], name: file.name });
      r.onerror = () => reject(new Error('That file could not be read.'));
      r.readAsDataURL(file);
    });
  }
  const today = () => new Date().toISOString().slice(0, 10);
  const esc = s => ctx.esc(s);
  const fmt = v => ctx.fmt(v);
  // A quote's figure including VAT (the server sends it as amount_inc_vat;
  // worked out here too for a quote just edited on the page).
  function incVat(q) { return q.amount_inc_vat != null ? q.amount_inc_vat : (q.vat_mode === 'plus' ? Math.round(q.amount * (1 + (q.vat_rate || 0) / 100) * 100) / 100 : q.amount); }
  // "£18,000 + VAT = £21,600" or "£21,600 inc VAT".
  function vatLine(q) {
    if (q.vat_known === false) return fmt(q.amount) + ' as entered';
    if (q.vat_mode === 'plus') return q.vat_rate ? `${fmt(q.amount)} + VAT = ${fmt(incVat(q))}` : `${fmt(q.amount)}, no VAT`;
    return fmt(q.amount) + ' inc VAT';
  }
  function signed(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v)); }
  function weeksText(w) { return w == null || w === '' ? 'No timeline' : w + (Number(w) === 1 ? ' week' : ' weeks'); }
  function noticeHtml() { return notice ? `<div class="notice ${notice.cls}">${notice.html}</div>` : ''; }

  // =================================================================
  // Quotes
  // =================================================================
  async function loadQuotes(est) {
    quotesFor = est.id; quotesState = 'loading'; quotes = null;
    try { quotes = await api('GET', '/api/refurb-estimates/' + est.id + '/quotes'); quotesState = null; }
    catch (e) { quotesState = e.needsDb ? 'needs_db' : 'error'; quotes = []; notice = e.needsDb ? null : { cls: 'danger', html: esc(e.message) }; }
  }

  async function showQuotes(el) {
    const est = ctx.estimate();
    if (!est) return;
    if (quotesFor !== est.id) { notice = null; el.innerHTML = '<p class="hint">Loading quotes…</p>'; await loadQuotes(est); }
    renderQuotes(el);
  }

  function renderQuotes(el) {
    el = el || document.getElementById('stage-quotes');
    const est = ctx.estimate();
    if (!est) return;
    if (quotesState === 'needs_db') { el.innerHTML = `<div class="notice warn">${esc(DB_NOTE)}</div>`; return; }
    // Your estimate's grand total. It includes VAT unless the estimate has
    // "No VAT" picked with ex-VAT rates, which the row below says.
    const mine = Math.round(ctx.totals().grandTotal);
    const ev = ctx.estimateVat();
    const myWeeks = ctx.durationWeeks();
    const list = (quotes || []).slice().sort((a, b) => incVat(a) - incVat(b));
    const cheapest = list.length >= 2 ? list[0].id : null;
    const timed = list.filter(q => q.timeline_weeks != null);
    const fastest = timed.length >= 2 ? timed.slice().sort((a, b) => a.timeline_weeks - b.timeline_weeks)[0].id : null;
    const budgetFromEstimate = est.budget_source === 'estimate' && est.budget_amount != null;

    const rows = list.map(q => {
      const diff = incVat(q) - mine;
      const pct = mine > 0 ? Math.round(diff / mine * 100) : null;
      const sub = [q.contact, q.quote_date ? ctx.fmtDate(q.quote_date) : null].filter(Boolean).map(esc).join(' · ');
      return `<div class="qrow${q.accepted ? ' accepted' : ''}">
        <div><div class="q-name">${esc(q.builder_name)}</div>
          ${sub ? `<div class="q-sub">${sub}</div>` : ''}
          ${q.notes ? `<div class="q-sub">${esc(q.notes)}</div>` : ''}
          <div class="q-badges">${q.accepted ? '<span class="badge acc">Accepted</span>' : ''}${q.id === cheapest ? '<span class="badge cheap">Cheapest</span>' : ''}${q.id === fastest ? '<span class="badge fast">Fastest</span>' : ''}</div></div>
        <div class="q-time">${esc(weeksText(q.timeline_weeks))}</div>
        <div class="q-diff ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${mine > 0 ? `${signed(diff)}${pct != null ? ' (' + (pct > 0 ? '+' : pct < 0 ? '−' : '') + Math.abs(pct) + '%)' : ''}<br><span class="hint" style="font-style:normal">vs your estimate</span>` : ''}</div>
        <div class="q-amt">${fmt(incVat(q))}<div class="q-vat">${esc(q.vat_known !== false && q.vat_mode === 'inc' ? 'inc VAT' : vatLine(q))}</div></div>
        <div class="q-actions">
          ${q.file_url ? `<a class="mini-btn" href="${esc(q.file_url)}" target="_blank" rel="noopener">View quote</a>` : ''}
          <button type="button" class="mini-btn" onclick="RefurbWorkflow.editQuote('${q.id}')">Edit</button>
          <button type="button" class="mini-btn danger" onclick="RefurbWorkflow.deleteQuote('${q.id}')">Delete</button>
          ${q.accepted ? `<button type="button" class="btn-primary" onclick="RefurbWorkflow.go('budget')">Track spend</button>` : `<button type="button" class="btn-primary" onclick="RefurbWorkflow.acceptQuote('${q.id}')">Accept quote</button>`}
        </div>
      </div>`;
    }).join('');

    const editing = editingQuoteId ? (quotes || []).find(q => q.id === editingQuoteId) : null;
    el.innerHTML = `${noticeHtml()}
      <div class="card" style="padding:1.25rem 1.25rem 1rem;margin-bottom:12px">
        <h2 style="font-size:16px;margin:0 0 .25rem">Compare quotes</h2>
        <p class="hint" style="margin:0 0 1rem">Your estimate against each builder, all including VAT. Accept one to set your budget.</p>
        ${ev.likeForLike ? '' : `<div class="notice warn">${esc(ev.warning)}</div>`}
        <div class="qrow mine">
          <div><div class="q-name">Your estimate</div><div class="q-sub">${esc(est.name)}</div>
            <div class="q-badges">${budgetFromEstimate ? '<span class="badge acc">Budget</span>' : ''}</div></div>
          <div class="q-time">${esc(weeksText(myWeeks))}</div>
          <div class="q-diff"></div>
          <div class="q-amt">${mine > 0 ? fmt(mine) : 'No total yet'}<div class="q-vat">${esc(ev.label)}</div></div>
        </div>
        ${rows || '<p class="hint" style="margin:.5rem 0 0">No quotes yet. Add the first one below.</p>'}
      </div>

      <details class="card cx" id="wf-quote-form"${editing || !list.length ? ' open' : ''}>
        <summary><span class="cx-title">${editing ? 'Edit quote' : 'Add a quote'}</span><span class="cx-sum">${editing ? esc(editing.builder_name) : 'Builder, amount and timeline'}</span><span class="chev"></span></summary>
        <div class="cx-body">
          <div class="field-grid">
            <div class="field"><label for="wq-name">Builder name</label><input type="text" id="wq-name" maxlength="120" value="${editing ? esc(editing.builder_name) : ''}"/></div>
            <div class="field"><label for="wq-contact">Contact (phone or email)</label><input type="text" id="wq-contact" maxlength="200" value="${editing && editing.contact ? esc(editing.contact) : ''}"/></div>
            <div class="field"><label for="wq-amount">Quote amount (£)</label><input type="number" inputmode="decimal" min="0" step="any" id="wq-amount" value="${editing ? editing.amount : ''}" oninput="RefurbWorkflow.vatPreview()"/></div>
            <div class="field"><label>Is VAT included?</label>
              <div class="choice-row" role="group" aria-label="VAT on this quote">
                <button type="button" class="choice${formVat.mode === 'plus' ? ' active' : ''}" id="wq-vat-plus" onclick="RefurbWorkflow.setFormVat('plus')">+ VAT</button>
                <button type="button" class="choice${formVat.mode === 'inc' ? ' active' : ''}" id="wq-vat-inc" onclick="RefurbWorkflow.setFormVat('inc')">Inc VAT</button>
                <select id="wq-vat-rate" class="vat-rate-select" onchange="RefurbWorkflow.vatPreview()" aria-label="VAT rate"${formVat.mode === 'plus' ? '' : ' hidden'}>${[20, 5].map(v => `<option value="${v}"${formVat.rate === v ? ' selected' : ''}>${v}%</option>`).join('')}</select>
              </div>
              <span class="hint" id="wq-vat-preview"></span></div>
            <div class="field"><label for="wq-weeks">Timeline (weeks)</label><input type="number" inputmode="numeric" min="0" step="1" id="wq-weeks" value="${editing && editing.timeline_weeks != null ? editing.timeline_weeks : ''}"/></div>
            <div class="field"><label for="wq-date">Quote date</label><input type="date" id="wq-date" value="${editing ? (editing.quote_date || '') : today()}"/></div>
            ${editing ? '' : `<div class="field"><label for="wq-file">Quote file (optional PDF or photo)</label><input type="file" id="wq-file" accept="application/pdf,image/jpeg,image/png"/></div>`}
          </div>
          <div class="field" style="margin-top:12px"><label for="wq-notes">Notes</label><textarea id="wq-notes" maxlength="2000" placeholder="What's included, exclusions, start date">${editing && editing.notes ? esc(editing.notes) : ''}</textarea></div>
          <div class="sum-actions">
            <button type="button" class="btn-primary" id="wq-save" onclick="RefurbWorkflow.saveQuote()">${editing ? 'Save changes' : 'Add quote'}</button>
            ${editing ? '<button type="button" class="link-btn muted" onclick="RefurbWorkflow.cancelEdit()">Cancel</button>' : ''}
          </div>
          <p class="save-msg" id="wq-msg"></p>
        </div>
      </details>

      <div class="card" style="padding:1rem 1.25rem">
        <p style="margin:0 0 .5rem;font-weight:700">No builder yet?</p>
        <p class="hint" style="margin:0 0 .75rem">You can track spend against your own estimate instead.</p>
        <button type="button" class="btn-secondary" onclick="RefurbWorkflow.useEstimate()" ${mine > 0 ? '' : 'disabled'}>Use my estimate as budget${mine > 0 ? ' (' + fmt(mine) + ')' : ''}</button>
      </div>`;
    vatPreview(); // the "£18,000 + VAT = £21,600" line under the form
  }

  async function saveQuote() {
    const est = ctx.estimate();
    const msg = document.getElementById('wq-msg');
    const btn = document.getElementById('wq-save');
    msg.className = 'save-msg'; msg.textContent = '';
    const body = {
      builder_name: document.getElementById('wq-name').value,
      contact: document.getElementById('wq-contact').value,
      amount: document.getElementById('wq-amount').value,
      vat_mode: formVat.mode,
      vat_rate: formVat.mode === 'plus' ? Number(document.getElementById('wq-vat-rate').value) : 20,
      timeline_weeks: document.getElementById('wq-weeks').value,
      quote_date: document.getElementById('wq-date').value || null,
      notes: document.getElementById('wq-notes').value,
    };
    if (!body.builder_name.trim()) { msg.className = 'save-msg error'; msg.textContent = 'Enter the builder\'s name.'; return; }
    if (body.amount === '') { msg.className = 'save-msg error'; msg.textContent = 'Enter the quote amount.'; return; }
    btn.disabled = true;
    try {
      if (editingQuoteId) {
        const q = await api('PUT', '/api/refurb-quotes/' + editingQuoteId, body);
        quotes = quotes.map(x => x.id === q.id ? q : x);
        if (q.accepted) { const e = ctx.estimate(); if (e) ctx.onEstimateUpdated({ ...e, budget_amount: incVat(q), budget_source: 'quote' }); }
        editingQuoteId = null;
        notice = { cls: q.vat_saved === false ? 'warn' : 'success', html: q.vat_saved === false ? 'Quote updated. Its VAT setting needs a quick database update (db/049), so the amount counts as entered.' : 'Quote updated.' };
      } else {
        const fileEl = document.getElementById('wq-file');
        body.file = await fileToUpload(fileEl && fileEl.files && fileEl.files[0]);
        const q = await api('POST', '/api/refurb-estimates/' + est.id + '/quotes', body);
        quotes.push(q);
        formVat = { mode: 'plus', rate: 20 };
        notice = q.vat_saved === false
          ? { cls: 'warn', html: 'Quote from ' + esc(q.builder_name) + ' added. Its VAT setting needs a quick database update (db/049), so the amount counts as entered.' }
          : { cls: 'success', html: 'Quote from ' + esc(q.builder_name) + ' added: ' + esc(vatLine(q)) + '.' };
      }
      renderQuotes();
    } catch (e) {
      msg.className = 'save-msg error'; msg.textContent = e.message;
      btn.disabled = false;
    }
  }

  // VAT toggle on the quote form, "+ VAT" at 20% unless changed.
  let formVat = { mode: 'plus', rate: 20 };
  function setFormVat(mode) {
    formVat.mode = mode;
    document.getElementById('wq-vat-plus').classList.toggle('active', mode === 'plus');
    document.getElementById('wq-vat-inc').classList.toggle('active', mode === 'inc');
    document.getElementById('wq-vat-rate').hidden = mode !== 'plus';
    vatPreview();
  }
  function vatPreview() {
    const el = document.getElementById('wq-vat-preview');
    if (!el) return;
    const a = Number(document.getElementById('wq-amount').value);
    formVat.rate = Number(document.getElementById('wq-vat-rate').value) || 20;
    if (!(a > 0)) { el.textContent = ''; return; }
    el.textContent = vatLine({ amount: a, vat_mode: formVat.mode, vat_rate: formVat.rate, vat_known: true });
  }
  function editQuote(id) {
    const q = quotes.find(x => x.id === id);
    formVat = q ? { mode: q.vat_mode === 'plus' ? 'plus' : 'inc', rate: q.vat_rate === 5 ? 5 : 20 } : { mode: 'plus', rate: 20 };
    editingQuoteId = id; notice = null; renderQuotes(); const f = document.getElementById('wf-quote-form'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function cancelEdit() { editingQuoteId = null; formVat = { mode: 'plus', rate: 20 }; renderQuotes(); }

  async function deleteQuote(id) {
    const q = quotes.find(x => x.id === id);
    if (!q || !confirm('Delete the quote from ' + q.builder_name + '?' + (q.accepted ? ' It is your accepted quote. Your budget stays as it is.' : ''))) return;
    try {
      await api('DELETE', '/api/refurb-quotes/' + id);
      quotes = quotes.filter(x => x.id !== id);
      if (editingQuoteId === id) editingQuoteId = null;
      notice = { cls: 'success', html: 'Quote deleted.' };
      renderQuotes();
    } catch (e) { alert(e.message); }
  }

  async function acceptQuote(id) {
    const q = quotes.find(x => x.id === id);
    if (!q) return;
    try {
      const d = await api('POST', '/api/refurb-quotes/' + id + '/accept');
      quotes = quotes.map(x => ({ ...x, accepted: x.id === id }));
      ctx.onEstimateUpdated(d.estimate);
      notice = { cls: 'success', html: `Accepted ${esc(q.builder_name)}. Your budget is now ${fmt(incVat(q))} inc VAT. <button type="button" class="link-btn" onclick="RefurbWorkflow.go('budget')">Track spend</button>` };
      renderQuotes();
    } catch (e) { alert(e.message); }
  }

  async function useEstimate() {
    const est = ctx.estimate();
    const amount = Math.round(ctx.totals().grandTotal);
    if (!est || !(amount > 0)) return;
    try {
      const d = await api('POST', '/api/refurb-estimates/' + est.id + '/budget', { action: 'use_estimate', amount });
      if (quotes) quotes = quotes.map(x => ({ ...x, accepted: false }));
      ctx.onEstimateUpdated(d.estimate);
      notice = null;
      ctx.goStage('budget');
    } catch (e) {
      notice = { cls: e.needsDb ? 'warn' : 'danger', html: esc(e.message) };
      renderQuotes();
    }
  }

  // =================================================================
  // Budget
  // =================================================================
  async function loadPayments(est) {
    paymentsFor = est.id; payState = 'loading'; payData = null;
    try { payData = await api('GET', '/api/refurb-estimates/' + est.id + '/payments'); payState = null; }
    catch (e) { payState = e.needsDb ? 'needs_db' : 'error'; payData = { payments: [], portfolio_property: null }; notice = e.needsDb ? null : { cls: 'danger', html: esc(e.message) }; }
  }

  async function showBudget(el) {
    const est = ctx.estimate();
    if (!est) return;
    if (paymentsFor !== est.id) { notice = null; el.innerHTML = '<p class="hint">Loading budget…</p>'; await loadPayments(est); }
    if (quotesFor !== est.id) await loadQuotes(est);
    renderBudget(el);
  }

  // Planned spend per category, scaled to the works budget.
  function plannedByCategory(est, worksBudget) {
    const out = {};
    if (est.mode === 'quick') {
      let total = 0;
      Object.keys(est.line_items || {}).forEach(t => { const v = Number(est.line_items[t]) || 0; const s = QUICK_TO_SECTION[t] || 'other'; out[s] = (out[s] || 0) + v; total += v; });
      Object.keys(out).forEach(k => { out[k] = total > 0 ? out[k] / total * worksBudget : 0; });
      return out;
    }
    const { total, sectionTotals } = computeDetailedSubtotal(est.line_items || {});
    Object.keys(sectionTotals).forEach(k => { if (sectionTotals[k] > 0) out[k] = total > 0 ? sectionTotals[k] / total * worksBudget : 0; });
    return out;
  }

  function budgetFigures(est, payments) {
    const B = Number(est.budget_amount) || 0;
    const T = computeTotals(est.mode, est.line_items || {}, est.contingency_enabled, Number(est.contingency_pct) || 0, Number(est.vat_rate) || 0);
    const vatF = 1 + (Number(est.vat_rate) || 0) / 100;
    const fromQuote = est.budget_source === 'quote';
    const C = fromQuote ? (est.contingency_enabled ? B * (Number(est.contingency_pct) || 0) / 100 : 0) : T.contingencyAmt * vatF;
    const W = fromQuote ? B : Math.max(0, B - C);
    const spent = payments.reduce((s, p) => s + p.amount, 0);
    const contLeft = C - Math.max(0, spent - W);
    return { B, C, W, spent, contLeft, fromQuote, pctSpent: B > 0 ? spent / B * 100 : 0 };
  }

  function renderBudget(el) {
    el = el || document.getElementById('stage-budget');
    const est = ctx.estimate();
    if (!est) return;
    if (payState === 'needs_db') { el.innerHTML = `<div class="notice warn">${esc(DB_NOTE)}</div>`; return; }
    const payments = (payData && payData.payments) || [];
    const prop = payData && payData.portfolio_property;
    const f = budgetFigures(est, payments);
    const accepted = (quotes || []).find(q => q.accepted);
    const sourceText = f.fromQuote ? (accepted ? 'Quote from ' + accepted.builder_name : 'Accepted quote') : 'Your estimate';
    const pctDone = Number(est.pct_complete) || 0;
    // Tax tags need db/049; before it, payments log without one.
    const tagsReady = !payData || payData.tags_ready !== false;

    let warn = '';
    if (f.B > 0 && f.spent > f.B) warn = `<div class="notice danger"><strong>Over budget by ${fmt(f.spent - f.B)}.</strong> You have spent ${Math.round(f.pctSpent)}% of the budget.</div>`;
    else if (f.B > 0 && f.spent >= f.B * 0.9) warn = `<div class="notice warn"><strong>You have used ${Math.round(f.pctSpent)}% of the budget.</strong> ${fmt(f.B - f.spent)} left.</div>`;

    const planned = plannedByCategory(est, f.W);
    const spentBy = {};
    payments.forEach(p => { spentBy[p.trade] = (spentBy[p.trade] || 0) + p.amount; });
    const cats = Object.keys(TRADE_LABELS).filter(k => (planned[k] || 0) > 0 || (spentBy[k] || 0) > 0);
    const catRows = cats.map(k => {
      const pl = planned[k] || 0, sp = spentBy[k] || 0;
      const ratio = pl > 0 ? sp / pl : (sp > 0 ? 2 : 0);
      const cls = ratio > 1 ? 'over' : ratio >= 0.9 ? 'warn' : '';
      return `<div class="cat-bar"><span class="n">${esc(TRADE_LABELS[k])}</span><span class="f${ratio > 1 ? ' over' : ''}">${fmt(sp)} of ${pl > 0 ? fmt(pl) : 'nothing planned'}</span>
        <span class="bar"><i class="${cls}" style="width:${Math.min(100, Math.round(ratio * 100))}%"></i></span></div>`;
    }).join('');

    const payRows = payments.map(p => `<div class="pay-row">
      <div class="pay-main"><div class="pay-title">${esc(p.description || TRADE_LABELS[p.trade] || p.trade)}</div>
        <div class="pay-sub">${ctx.fmtDate(p.paid_date)} · ${esc(TRADE_LABELS[p.trade] || p.trade)}${p.tax_tag ? ' · ' + esc(TAX_TAGS[p.tax_tag] || p.tax_tag) : ''}${p.portfolio_property_id ? ' · ' + (p.tax_tag === 'repair' ? 'In Portfolio expenses' : 'In Portfolio capital costs') : ''}</div></div>
      <span class="pay-amt">${fmt(p.amount)}</span>
      <span class="pay-actions">${p.receipt_url ? `<a class="mini-btn" href="${esc(p.receipt_url)}" target="_blank" rel="noopener">Receipt</a>` : ''}<button type="button" class="mini-btn danger" onclick="RefurbWorkflow.deletePayment('${p.id}')">Delete</button></span>
    </div>`).join('');

    const tradeOpts = Object.keys(TRADE_LABELS).map(k => `<option value="${k}">${esc(TRADE_LABELS[k])}</option>`).join('');

    el.innerHTML = `${noticeHtml()}${warn}
      <div class="wf-grid">
        <div class="wf-stat hero"><div class="k">Budget</div><div class="v">${fmt(f.B)}</div><div class="s">${esc(sourceText)}</div></div>
        <div class="wf-stat"><div class="k">Spent</div><div class="v">${fmt(f.spent)}</div><div class="s">${Math.round(f.pctSpent)}% of budget</div></div>
        <div class="wf-stat"><div class="k">Left to spend</div><div class="v">${f.spent > f.B ? '−' + fmt(f.spent - f.B) : fmt(f.B - f.spent)}</div><div class="s">${f.spent > f.B ? 'Over budget' : 'Within budget'}</div></div>
        <div class="wf-stat"><div class="k">Contingency left</div><div class="v">${fmt(Math.max(0, f.contLeft))}</div><div class="s">${f.C > 0 ? 'of ' + fmt(f.C) + (f.fromQuote ? ' on top of the quote' : ' in the budget') : 'No contingency set'}</div></div>
      </div>

      <details class="card cx" open>
        <summary><span class="cx-title">Progress</span><span class="cx-sum">${pctDone}% complete · ${Math.round(f.pctSpent)}% spent</span><span class="chev"></span></summary>
        <div class="cx-body">
          <div class="pct-row"><input type="range" min="0" max="100" step="5" value="${pctDone}" id="wb-pct" oninput="document.getElementById('wb-pct-v').textContent=this.value+'%'" onchange="RefurbWorkflow.setPct(this.value)" aria-label="Percent complete"/><span class="pv" id="wb-pct-v">${pctDone}%</span></div>
          <p class="hint" style="margin:.5rem 0 0">Set how far the work has got. Compare it with how much of the budget is spent.</p>
        </div>
      </details>

      <details class="card cx"${cats.length ? ' open' : ''}>
        <summary><span class="cx-title">Spend by category</span><span class="cx-sum">${cats.length ? cats.length + (cats.length === 1 ? ' category' : ' categories') : 'Nothing yet'}</span><span class="chev"></span></summary>
        <div class="cx-body">${catRows || '<p class="hint" style="margin:0">Log a payment to see spend by category.</p>'}
          ${f.fromQuote ? '<p class="hint" style="margin:.75rem 0 0">Planned amounts split the quote by your estimate\'s categories.</p>' : ''}</div>
      </details>

      <details class="card cx" id="wb-pay-form"${payments.length ? '' : ' open'}>
        <summary><span class="cx-title">Log a payment</span><span class="cx-sum">Date, trade and amount</span><span class="chev"></span></summary>
        <div class="cx-body">
          <div class="field-grid">
            <div class="field"><label for="wp-date">Date</label><input type="date" id="wp-date" value="${today()}"/></div>
            <div class="field"><label for="wp-trade">Trade</label><select id="wp-trade">${tradeOpts}</select></div>
            <div class="field"><label for="wp-amount">Amount (£)</label><input type="number" inputmode="decimal" min="0" step="any" id="wp-amount"/></div>
            <div class="field"><label for="wp-desc">What for</label><input type="text" id="wp-desc" maxlength="300" placeholder="e.g. First fix electrics"/></div>
            <div class="field"><label for="wp-receipt">Receipt (optional PDF or photo)</label><input type="file" id="wp-receipt" accept="application/pdf,image/jpeg,image/png"/></div>
          </div>
          ${tagsReady ? `<div class="field" style="margin-top:12px"><label>Tax treatment</label>
            <div class="choice-row" role="group" aria-label="Tax treatment">${Object.keys(TAX_TAGS).map(k => `<button type="button" class="choice${formTag === k ? ' active' : ''}" data-tag="${k}" onclick="RefurbWorkflow.setTag('${k}')">${esc(TAX_TAGS[k])}</button>`).join('')}</div>
            <p class="tax-note">${esc(TAX_TAG_HINT)}</p></div>` : ''}
          ${prop ? (() => { const pl = portfolioLabel(formTag, prop.address); return `<label class="check" style="margin-top:1rem"><input type="checkbox" id="wp-portfolio" ${tagsReady ? 'checked' : ''}/><span id="wp-portfolio-label">${esc(pl.main)}<small>${esc(pl.sub)}</small></span></label>`; })() : ''}
          ${tagsReady ? '' : `<p class="tax-note">${esc(TAX_NOTE)}</p>`}
          <div class="sum-actions"><button type="button" class="btn-primary" id="wp-save" onclick="RefurbWorkflow.savePayment()">Log payment</button></div>
          <p class="save-msg" id="wp-msg"></p>
        </div>
      </details>

      <details class="card cx"${payments.length ? ' open' : ''}>
        <summary><span class="cx-title">Payments</span><span class="cx-sum">${payments.length ? payments.length + (payments.length === 1 ? ' payment' : ' payments') + ' · ' + fmt(f.spent) : 'None yet'}</span><span class="chev"></span></summary>
        <div class="cx-body">${payRows || '<p class="hint" style="margin:0">No payments logged yet.</p>'}</div>
      </details>

      <p style="margin:1rem 0 0;display:flex;gap:16px;flex-wrap:wrap">
        <button type="button" class="link-btn" onclick="RefurbWorkflow.go('quotes')">Change the budget</button>
        <button type="button" class="link-btn muted" onclick="RefurbWorkflow.stopTracking()">Stop tracking this budget</button>
      </p>`;
  }

  async function savePayment() {
    const est = ctx.estimate();
    const msg = document.getElementById('wp-msg');
    const btn = document.getElementById('wp-save');
    msg.className = 'save-msg'; msg.textContent = '';
    const amount = document.getElementById('wp-amount').value;
    if (!(Number(amount) > 0)) { msg.className = 'save-msg error'; msg.textContent = 'Enter an amount above £0.'; return; }
    btn.disabled = true;
    try {
      const portfolioEl = document.getElementById('wp-portfolio');
      const body = {
        paid_date: document.getElementById('wp-date').value,
        trade: document.getElementById('wp-trade').value,
        amount,
        description: document.getElementById('wp-desc').value,
        receipt: await fileToUpload(document.getElementById('wp-receipt').files[0]),
        portfolio_property_id: portfolioEl && portfolioEl.checked && payData.portfolio_property ? payData.portfolio_property.id : null,
        tax_tag: formTag,
      };
      const p = await api('POST', '/api/refurb-estimates/' + est.id + '/payments', body);
      payData.payments.unshift(p);
      payData.payments.sort((a, b) => (b.paid_date || '').localeCompare(a.paid_date || ''));
      const where = !p.portfolio_property_id ? '' : p.tax_tag === 'repair' ? ', also in the property\'s Portfolio expenses' : p.tax_tag === 'unsure' ? ', also in Portfolio capital costs, flagged check with accountant' : ', also in Portfolio capital costs';
      notice = { cls: 'success', html: `Logged ${fmt(p.amount)} for ${esc(TRADE_LABELS[p.trade] || p.trade)} ${p.tax_tag ? ' as ' + esc(TAX_TAGS[p.tax_tag].toLowerCase()) : ''}${where}.` };
      formTag = 'unsure';
      renderBudget();
    } catch (e) {
      msg.className = 'save-msg error'; msg.textContent = e.message;
      btn.disabled = false;
    }
  }

  // Tax tag on the payment form, "Not sure" unless changed.
  let formTag = 'unsure';
  function setTag(tag) {
    formTag = tag;
    document.querySelectorAll('#wb-pay-form [data-tag]').forEach(b => b.classList.toggle('active', b.dataset.tag === tag));
    const lab = document.getElementById('wp-portfolio-label');
    if (lab && payData && payData.portfolio_property) { const pl = portfolioLabel(tag, payData.portfolio_property.address); lab.innerHTML = esc(pl.main) + '<small>' + esc(pl.sub) + '</small>'; }
  }

  async function deletePayment(id) {
    const pay = (payData.payments || []).find(p => p.id === id);
    if (!confirm('Delete this payment?' + (pay && pay.portfolio_expense_id ? ' It is also removed from the property\'s expenses in Portfolio.' : ''))) return;
    try {
      await api('DELETE', '/api/refurb-payments/' + id);
      payData.payments = payData.payments.filter(p => p.id !== id);
      notice = { cls: 'success', html: 'Payment deleted.' };
      renderBudget();
    } catch (e) { alert(e.message); }
  }

  async function setPct(v) {
    const est = ctx.estimate();
    try {
      const d = await api('POST', '/api/refurb-estimates/' + est.id + '/budget', { pct_complete: Number(v) });
      ctx.onEstimateUpdated(d.estimate);
      renderBudget();
    } catch (e) { alert(e.message); }
  }

  async function stopTracking() {
    const est = ctx.estimate();
    if (!confirm('Stop tracking this budget? Payments you have logged are kept and come back if you set a budget again.')) return;
    try {
      const d = await api('POST', '/api/refurb-estimates/' + est.id + '/budget', { action: 'clear' });
      if (quotes) quotes = quotes.map(x => ({ ...x, accepted: false }));
      ctx.onEstimateUpdated(d.estimate);
      ctx.goStage('quotes');
    } catch (e) { alert(e.message); }
  }

  window.RefurbWorkflow = {
    init(c) { ctx = c; },
    showQuotes, showBudget, saveQuote, editQuote, cancelEdit, setFormVat, vatPreview, deleteQuote, acceptQuote, useEstimate,
    savePayment, deletePayment, setPct, stopTracking, setTag,
    go(stage) { notice = null; ctx.goStage(stage); },
    budgetFigures,
  };
})();
