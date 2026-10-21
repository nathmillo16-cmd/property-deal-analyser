// refurb-rate-card.js: "Your rates", the user's own rate per refurb line
// item, shared by refurb.html and settings.html.
//
// Rate priority everywhere: the user's own rate, then the guide rate
// (refurb-guide-rates.js), then empty.
//
// Needs refurb-totals.js and refurb-guide-rates.js loaded first, plus
// API_BASE from app-config.js.
(function () {
  function money(v) {
    if (v == null || v === '') return '';
    const n = Number(v);
    return '£' + n.toLocaleString('en-GB', n % 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {});
  }
  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function guideRate(key) {
    const g = (typeof REFURB_GUIDE_RATES !== 'undefined' && REFURB_GUIDE_RATES.rates) || {};
    const v = g[key];
    return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
  }

  // { rates, needsMigration, error }
  async function load(session) {
    try {
      const res = await fetch(API_BASE + '/api/refurb-rate-card', { headers: { Authorization: 'Bearer ' + session.access_token } });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return { rates: {}, error: d.error || 'Your rates could not be loaded.' };
      return { rates: d.rates || {}, needsMigration: !!d.needs_migration };
    } catch (e) {
      return { rates: {}, error: 'Your rates could not be loaded.' };
    }
  }

  async function save(session, rates) {
    const res = await fetch(API_BASE + '/api/refurb-rate-card', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify({ rates }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 409 && d.needs_migration) throw new Error('Saving your rates needs a quick database update (db/048) first.');
    if (!res.ok) throw new Error(d.error || 'Your rates could not be saved.');
    return d.rates || {};
  }

  // The rate to pre-fill and where it came from: { rate, source: 'yours'|'guide'|null }.
  function resolve(key, userRates) {
    const u = userRates && userRates[key];
    if (u != null && u !== '' && Number.isFinite(Number(u))) return { rate: Number(u), source: 'yours' };
    const g = guideRate(key);
    if (g != null) return { rate: g, source: 'guide' };
    return { rate: null, source: null };
  }

  // Settings page editor: one collapsible group per category, collapsed,
  // each with a one-line summary of how many rates are set.
  function renderEditor(container, rates) {
    container.innerHTML = REFURB_SECTIONS.map(s => {
      const set = s.items.filter(it => rates[s.id + '.' + it.id] != null).length;
      return `<details class="rc-sec">
        <summary><span class="rc-sec-name">${esc(s.name)}</span><span class="rc-sec-sum" id="rc-sum-${s.id}">${set ? set + ' of ' + s.items.length + ' set' : 'None set'}</span><span class="rc-chev" aria-hidden="true"></span></summary>
        <div class="rc-sec-body">${s.items.map(it => {
          const key = s.id + '.' + it.id;
          const g = guideRate(key);
          return `<div class="rc-row"><label for="rc-${s.id}-${it.id}"><span>${esc(it.label)}</span><span class="rc-unit">per ${esc(it.unit)}</span></label>
            <input type="text" inputmode="decimal" id="rc-${s.id}-${it.id}" data-key="${key}" data-sec="${s.id}" placeholder="${g != null ? 'Guide ' + esc(money(g)) : '£'}" value="${rates[key] != null ? esc(rates[key]) : ''}" oninput="RefurbRateCard.onEditorInput(this)"/></div>`;
        }).join('')}</div>
      </details>`;
    }).join('');
  }

  function onEditorInput(el) {
    const sec = el.dataset.sec;
    const inputs = document.querySelectorAll('input[data-sec="' + sec + '"]');
    const total = inputs.length;
    const set = [...inputs].filter(i => i.value.trim() !== '').length;
    const sum = document.getElementById('rc-sum-' + sec);
    if (sum) sum.textContent = set ? set + ' of ' + total + ' set' : 'None set';
  }

  // { rates } from the editor, or { error } if a value isn't a number.
  function readEditor(container) {
    const rates = {};
    for (const el of container.querySelectorAll('input[data-key]')) {
      const raw = el.value.replace(/[£,\s]/g, '');
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return { error: 'Rates must be numbers of £0 or more.', el };
      rates[el.dataset.key] = n;
    }
    return { rates };
  }

  window.RefurbRateCard = { load, save, resolve, guideRate, renderEditor, onEditorInput, readEditor, money };
})();
