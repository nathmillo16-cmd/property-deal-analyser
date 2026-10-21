// refurb-rate-card.js: "Your rates", the user's own rate per refurb line
// item, shared by refurb.html and settings.html.
//
// Rate priority everywhere: the user's own rate, then the indicative guide
// rate (typical x region factor, refurb-guide-rates.js), then empty.
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

  // ---- Indicative guide rates (refurb-guide-rates.js) and region ----
  // The user's region lives in this browser for now (Settings sets it).
  const REGION_KEY = 'dny-refurb-region';
  function guideData() { return (typeof REFURB_GUIDE_RATES !== 'undefined' && REFURB_GUIDE_RATES) || {}; }
  function num(v) { return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v); }
  function round2(n) { return Math.round(n * 100) / 100; }
  function baseRegion() { return guideData().base_region || 'UK average'; }
  function regions() { const f = guideData().region_factors; return f ? Object.keys(f) : [baseRegion()]; }
  function matchRegion(name) {
    if (!name) return null;
    const n = String(name).trim().toLowerCase();
    return regions().find(r => r.toLowerCase() === n) || null;
  }
  function getRegion() {
    try { const r = matchRegion(localStorage.getItem(REGION_KEY)); if (r) return r; } catch (e) {}
    return baseRegion();
  }
  function setRegion(r) {
    try {
      const m = matchRegion(r);
      if (!m || m === baseRegion()) localStorage.removeItem(REGION_KEY); else localStorage.setItem(REGION_KEY, m);
    } catch (e) {}
  }

  // The region a postcode is in, via postcodes.io (England's region, or
  // Wales / Scotland / Northern Ireland). null if it can't be worked out.
  const pcRegionCache = {};
  async function regionFromPostcode(postcode) {
    const pc = String(postcode || '').replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z0-9]{5,7}$/.test(pc)) return null;
    if (pc in pcRegionCache) return pcRegionCache[pc];
    try {
      const res = await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(pc));
      const d = await res.json().catch(() => null);
      const r = d && d.result;
      let region = null;
      if (res.ok && r) region = r.country === 'England' ? matchRegion(r.region) : matchRegion(r.country);
      if (res.ok || res.status === 404) pcRegionCache[pc] = region; // don't cache outages
      return region;
    } catch (e) {
      return null;
    }
  }

  // The indicative guide for one line in a region (default: the user's
  // region): { typical, low, high, region, asOf }, already multiplied by
  // the region factor. null when the typical rate or the factor isn't set.
  function guide(key, region) {
    const d = guideData();
    const it = d.items && d.items[key];
    if (!it) return null;
    const r = matchRegion(region) || getRegion();
    const f = num((d.region_factors || {})[r]);
    const t = num(it.typical);
    if (f == null || t == null) return null;
    const lo = num(it.low), hi = num(it.high);
    return { typical: round2(t * f), low: lo != null ? round2(lo * f) : null, high: hi != null ? round2(hi * f) : null, region: r, asOf: d.rates_as_of || null };
  }
  function guideRate(key, region) { const g = guide(key, region); return g ? g.typical : null; }

  // "Indicative, East Midlands, Nov 2026"
  function asOfText(asOf) {
    const m = /^(\d{4})-(\d{2})/.exec(asOf || '');
    if (!m) return asOf || '';
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1] + ' ' + m[1];
  }
  function guideLabel(g) {
    const region = g ? g.region : getRegion();
    const asOf = g ? g.asOf : guideData().rates_as_of;
    return 'Indicative, ' + region + (asOf ? ', ' + asOfText(asOf) : '');
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
            <input type="text" inputmode="decimal" id="rc-${s.id}-${it.id}" data-key="${key}" data-sec="${s.id}" placeholder="${g != null ? 'Indicative ' + esc(money(g)) : '£'}" value="${rates[key] != null ? esc(rates[key]) : ''}" oninput="RefurbRateCard.onEditorInput(this)"/></div>`;
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

  window.RefurbRateCard = { load, save, resolve, guide, guideRate, guideLabel, regions, baseRegion, getRegion, setRegion, regionFromPostcode, renderEditor, onEditorInput, readEditor, money };
})();
