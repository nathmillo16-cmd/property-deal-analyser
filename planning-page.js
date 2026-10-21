// planning-page.js: shared frame for the logged-in Planning tool pages
// (portfolio-stress-test.html, refinance-planner.html, buy-box.html,
// private-finance.html). Login check, the account menu's email and Log
// out, the plan, page states, money inputs and API calls, so the four
// pages don't each repeat them.
//
// Load after auth-guard.js and nav.js. Each page calls:
//   var ctx = await PlanningPage.start();   // null while redirecting
//   ctx.session, ctx.profile, ctx.paid
//   PlanningPage.show('ready' | 'locked' | 'loading' | 'error' | 'empty')
//   PlanningPage.api('/api/portfolio') -> { ok, status, body }

var PlanningPage = (function () {
  'use strict';

  var state = { client: null, session: null, profile: null };

  async function start() {
    var auth = await requireAuth();
    if (!auth) return null;
    state.client = auth.client;
    state.session = auth.session;

    var link = document.getElementById('auth-link');
    if (link) {
      link.textContent = 'Log out';
      link.href = '#';
      link.onclick = async function (e) {
        e.preventDefault();
        try { await state.client.auth.signOut(); } catch (err) {}
        window.location.href = '/';
      };
    }
    var email = (state.session.user && state.session.user.email) || '';
    var a = document.getElementById('user-menu-email'); if (a) a.textContent = email || 'Account';
    var b = document.getElementById('user-menu-item-email'); if (b) b.textContent = email || '';

    // nav.js already loads the profile once for the account button; reuse it.
    var profile = null;
    try {
      var nav = window.NavAccount ? await NavAccount.ready : null;
      profile = nav && nav.profile ? nav.profile : null;
    } catch (e) {}
    if (!profile) {
      var r = await api('/api/profile');
      profile = r.ok ? r.body : {};
    }
    state.profile = profile || {};
    var paid = state.profile.plan === 'paid';
    var sub = document.getElementById('subscribe-link');
    if (sub) {
      sub.style.display = paid ? 'none' : '';
      sub.href = '/billing.html';
    }
    auth.client.auth.onAuthStateChange(function (_e, session) {
      state.session = session;
      if (!session) window.location.href = '/';
    });
    return { session: state.session, profile: state.profile, paid: paid };
  }

  async function api(path, opts) {
    opts = opts || {};
    var headers = { 'Authorization': 'Bearer ' + (state.session ? state.session.access_token : '') };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      var res = await fetch(API_BASE + path, {
        method: opts.method || 'GET', headers: headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
      });
      var body = null;
      try { body = await res.json(); } catch (e) { body = null; }
      return { ok: res.ok, status: res.status, body: body || {} };
    } catch (e) {
      return { ok: false, status: 0, body: { error: 'Could not reach the server. Check your connection and try again.' } };
    }
  }

  // Page states: every element with data-state="x" shows only for state x.
  function show(name) {
    document.querySelectorAll('[data-state]').forEach(function (el) {
      el.hidden = el.getAttribute('data-state').split(' ').indexOf(name) === -1;
    });
  }

  // ---------- formatting ----------
  function money(v) {
    if (v == null || !Number.isFinite(v)) return '£0';
    var r = Math.round(v);
    return (r < 0 ? '-£' : '£') + Math.abs(r).toLocaleString('en-GB');
  }
  function money2(v) {
    var r = Math.round(v * 100) / 100;
    return (r < 0 ? '-£' : '£') + Math.abs(r).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function about(v) {
    var r = Math.round(v / 100) * 100;
    return '£' + Math.max(0, r).toLocaleString('en-GB');
  }
  function pct(v, dp) {
    if (v == null || !Number.isFinite(v)) return '-';
    var d = dp == null ? 2 : dp;
    return (+v.toFixed(d)).toLocaleString('en-GB', { maximumFractionDigits: d }) + '%';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function line(label, value, cls) {
    return '<div class="tool-line' + (cls ? ' ' + cls : '') + '"><span>' + esc(label) + '</span><span>' + esc(value) + '</span></div>';
  }
  function plural(n, word, many) { return n + ' ' + (n === 1 ? word : (many || word + 's')); }

  // ---------- money inputs (live thousands separators) ----------
  function raw(el) { return String(el && el.value != null ? el.value : '').replace(/,/g, '').trim(); }
  function numVal(el) {
    var t = raw(el);
    if (t === '') return null;
    var v = Number(t);
    return Number.isFinite(v) ? v : null;
  }
  function formatMoney(el) {
    var before = el.value;
    var caret = el.selectionStart == null ? before.length : el.selectionStart;
    var digitsBefore = before.slice(0, caret).replace(/[^0-9.]/g, '').length;
    var clean = before.replace(/[^0-9.]/g, '');
    var dot = clean.indexOf('.');
    if (dot !== -1) clean = clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    var parts = clean.split('.');
    var whole = parts[0].replace(/^0+(?=\d)/, '');
    var out = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts.length > 1 ? '.' + parts[1] : '');
    if (out === before) return;
    el.value = out;
    if (document.activeElement !== el) return;
    var pos = 0, seen = 0;
    while (pos < out.length && seen < digitsBefore) { if (/[0-9.]/.test(out[pos])) seen++; pos++; }
    try { el.setSelectionRange(pos, pos); } catch (e) {}
  }
  function bindMoney(root) {
    (root || document).querySelectorAll('input[data-money]').forEach(function (el) {
      if (el._moneyBound) return;
      el._moneyBound = true;
      formatMoney(el);
      el.addEventListener('input', function () { formatMoney(el); });
    });
  }
  function setMoney(el, v) {
    el.value = v == null || v === '' ? '' : String(v);
    formatMoney(el);
  }

  // Reads a file input as { file_name, type, data (base64) }.
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result || '');
        resolve({ file_name: file.name, type: file.type, data: s.slice(s.indexOf(',') + 1) });
      };
      r.onerror = function () { reject(new Error('That file could not be read.')); };
      r.readAsDataURL(file);
    });
  }

  // Remembers simple settings (sliders, assumptions) on this device only.
  function loadLocal(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? Object.assign({}, fallback, v) : Object.assign({}, fallback); }
    catch (e) { return Object.assign({}, fallback); }
  }
  function saveLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }

  return {
    start: start, api: api, show: show,
    money: money, money2: money2, about: about, pct: pct, esc: esc, line: line, plural: plural,
    numVal: numVal, bindMoney: bindMoney, setMoney: setMoney, formatMoney: formatMoney, readFile: readFile,
    loadLocal: loadLocal, saveLocal: saveLocal,
    get session() { return state.session; }, get profile() { return state.profile; }
  };
})();
