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
  // The user's region is saved to the account (Settings sets it) and cached
  // in this browser so it can be read instantly.
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
  // Shown under the indicative label wherever a guide rate is in use.
  const GUIDE_NOTE = 'Based on homeowner price guides. Investors using regular trades often pay less. Add your own rates for accuracy.';

  function guideLabel(g) {
    const region = g ? g.region : getRegion();
    const asOf = g ? g.asOf : guideData().rates_as_of;
    return 'Indicative, ' + region + (asOf ? ', ' + asOfText(asOf) : '');
  }

  // { rates, needsMigration, regionAvailable, error }
  // The region is saved to the account (db/057) and copied into this
  // browser as a cache, so getRegion() stays instant. The first time an
  // account has no region but this device does, the device's region is
  // moved onto the account.
  async function load(session) {
    try {
      const res = await fetch(API_BASE + '/api/refurb-rate-card', { headers: { Authorization: 'Bearer ' + session.access_token } });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return { rates: {}, error: d.error || 'Your rates could not be loaded.' };
      if (d.region_available) {
        const accountRegion = matchRegion(d.region);
        if (accountRegion) setRegion(accountRegion);
        else if (getRegion() !== baseRegion()) saveRegion(session, getRegion()).catch(() => {});
      }
      return { rates: d.rates || {}, needsMigration: !!d.needs_migration, regionAvailable: !!d.region_available };
    } catch (e) {
      return { rates: {}, error: 'Your rates could not be loaded.' };
    }
  }

  // Saves the region to the account and this browser's cache.
  async function saveRegion(session, region) {
    const m = matchRegion(region) || baseRegion();
    setRegion(m);
    const res = await fetch(API_BASE + '/api/refurb-rate-card', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify({ region: m }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 409 && d.needs_migration) throw new Error('Your region is saved on this device for now. It can be saved to your account after a quick database update.');
    if (!res.ok) throw new Error(d.error || 'Your region could not be saved.');
    return m;
  }

  // The builder CSV template (scripts/export-refurb-guide-csv.js, or the
  // copy Settings downloads): category,item,unit,low,typical,high,ref.
  // Columns are found by their header name, so their order doesn't matter.
  // Returns { matched: [{ key, label, section, unit, rate }], skipped, error }.
  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    const s = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const data = rows.filter(r => r.some(c => String(c).trim() !== ''));
    if (!data.length) return { matched: [], skipped: 0, error: 'That file is empty.' };
    const head = data[0].map(h => String(h).trim().toLowerCase());
    const iRef = head.indexOf('ref'), iTyp = head.indexOf('typical');
    if (iRef === -1 || iTyp === -1) return { matched: [], skipped: 0, error: 'That file needs "ref" and "typical" columns, like the builder template.' };
    const items = {};
    REFURB_SECTIONS.forEach(sec => sec.items.forEach(it => { items[sec.id + '.' + it.id] = { label: it.label, section: sec.name, unit: it.unit }; }));
    const matched = [];
    let skipped = 0;
    data.slice(1).forEach(r => {
      const key = String(r[iRef] || '').trim();
      const raw = String(r[iTyp] || '').replace(/[£,\s]/g, '');
      if (raw === '') return; // left blank by the builder: nothing to import
      const n = Number(raw);
      if (!items[key] || !Number.isFinite(n) || n < 0) { skipped++; return; }
      matched.push({ key, label: items[key].label, section: items[key].section, unit: items[key].unit, rate: Math.round(n * 100) / 100 });
    });
    return { matched, skipped };
  }

  // A blank copy of the builder template, built from the current line items.
  function templateCsv() {
    const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [['category', 'item', 'unit', 'low', 'typical', 'high', 'ref']];
    REFURB_SECTIONS.forEach(sec => sec.items.forEach(it => rows.push([sec.name, it.label, it.unit, '', '', '', sec.id + '.' + it.id])));
    return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
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

  window.RefurbRateCard = { load, save, saveRegion, parseCsv, templateCsv, resolve, guide, guideRate, guideLabel, GUIDE_NOTE, regions, baseRegion, getRegion, setRegion, regionFromPostcode, renderEditor, onEditorInput, readEditor, money };
})();
