// tools-shell.js: shared frame for the standalone calculator pages
// (stamp-duty-calculator.html and friends). Those pages are public, so
// they work logged out too (good for search and the landing page).
//
// Placement: a plain <script src="/tools-shell.js"></script> straight after
// <div id="nav-root" ...></div>, same rule as nav.js.
//
// Header: if this browser has a saved login, the normal app nav (nav.js +
// crm-nav.js) is loaded, so logged-in users keep their menus. Otherwise a
// small public header with Log in / Sign up is drawn instead. This is only
// a display choice; nothing on these pages needs a login.
//
// "Run a full analysis": logged in, the inputs are handed to the main
// calculator through the same one-shot sessionStorage handoff Home's Quick
// analyse uses ('dny-rerun', read by applyRerunPayload() in index.html).
// Logged out, a short sign-up prompt is shown instead and nothing is stored.

var ToolShell = (function () {
  'use strict';

  function hasSavedLogin() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)) return true;
      }
    } catch (e) {}
    return false;
  }

  var likelyLoggedIn = hasSavedLogin() || (typeof IS_NATIVE_APP !== 'undefined' && IS_NATIVE_APP);
  var root = document.getElementById('nav-root');

  if (root && likelyLoggedIn) {
    document.write('<script src="/nav.js"><\/script><script src="/crm-nav.js"><\/script>');
  } else if (root) {
    root.innerHTML =
      '<div class="topbar tool-public-bar">' +
        '<a class="wordmark" href="/"><img src="/assets/propulsion-logo.png" alt="PROPulsion" class="wordmark-logo"></a>' +
        '<div class="auth-bar">' +
          '<a href="/login.html">Log in</a>' +
          '<a class="btn-primary" href="/login.html?mode=signup">Sign up free</a>' +
        '</div>' +
      '</div>';
  }

  // ---------- session (only needed for "Run a full analysis" and logout) ----------
  var clientPromise = null;
  function client() {
    if (!clientPromise) {
      clientPromise = (async function () {
        if (typeof supabase === 'undefined') return null;
        var res = await fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/config');
        if (!res.ok) return null;
        var cfg = await res.json();
        if (!cfg.supabaseUrl) return null;
        return supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
      })().catch(function () { return null; });
    }
    return clientPromise;
  }
  async function session() {
    try {
      var c = await client();
      if (!c) return null;
      var r = await c.auth.getSession();
      return r && r.data ? r.data.session : null;
    } catch (e) { return null; }
  }

  // The logged-in nav's "Log out" link (#auth-link) is wired by each page;
  // on these pages it's wired here.
  document.addEventListener('DOMContentLoaded', function () {
    var link = document.getElementById('auth-link');
    if (link && likelyLoggedIn) {
      link.addEventListener('click', async function (e) {
        e.preventDefault();
        try { var c = await client(); if (c) await c.auth.signOut(); } catch (err) {}
        window.location.href = '/';
      });
      session().then(function (s) {
        if (!s) return;
        var email = (s.user && s.user.email) || '';
        var a = document.getElementById('user-menu-email'); if (a) a.textContent = email;
        var b = document.getElementById('user-menu-item-email'); if (b) b.textContent = email;
      });
    }
  });

  // ---------- number inputs ----------
  function raw(el) { return String(el && el.value != null ? el.value : '').replace(/,/g, '').trim(); }
  function num(id) {
    var el = document.getElementById(id);
    var v = +raw(el);
    return Number.isFinite(v) ? v : 0;
  }
  function isBlank(id) { return raw(document.getElementById(id)) === ''; }

  // Live thousands separators, keeping the cursor next to the same digit.
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

  // Wires every input in the form: money fields get commas, and any change
  // re-runs the page's calculation.
  function bind(onChange) {
    document.querySelectorAll('.tool-inputs input, .tool-inputs select').forEach(function (el) {
      if (el.dataset.money !== undefined) {
        formatMoney(el);
        el.addEventListener('input', function () { formatMoney(el); onChange(); });
      } else {
        el.addEventListener('input', onChange);
        el.addEventListener('change', onChange);
      }
    });
    onChange();
  }

  // ---------- formatting ----------
  function money(v) {
    if (!Number.isFinite(v)) return '£0';
    var r = Math.round(v);
    return (r < 0 ? '-£' : '£') + Math.abs(r).toLocaleString('en-GB');
  }
  function money2(v) {
    var r = Math.round(v * 100) / 100;
    return (r < 0 ? '-£' : '£') + Math.abs(r).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct(v, dp) {
    if (!Number.isFinite(v)) return '0%';
    var d = dp == null ? 2 : dp;
    return (+v.toFixed(d)).toLocaleString('en-GB', { maximumFractionDigits: d }) + '%';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function set(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }
  function html(id, h) { var el = document.getElementById(id); if (el) el.innerHTML = h; }

  // A label/value line inside "How this is worked out".
  function line(label, value, cls) {
    return '<div class="tool-line' + (cls ? ' ' + cls : '') + '"><span>' + esc(label) + '</span><span>' + esc(value) + '</span></div>';
  }

  // ---------- Run a full analysis ----------
  // payload: { strategy, fields, planning, note } (the dny-rerun shape,
  // without a dealId, so the calculator never saves anything by itself).
  async function runFull(payload) {
    var btn = document.getElementById('tool-full');
    var signup = document.getElementById('tool-signup');
    if (btn) btn.disabled = true;
    var s = await session();
    if (btn) btn.disabled = false;
    if (!s) {
      if (signup) { signup.hidden = false; signup.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      return;
    }
    try {
      payload.fromTool = true;
      sessionStorage.setItem('dny-rerun', JSON.stringify(payload));
    } catch (e) {}
    window.location.href = '/index.html';
  }

  // ---------- the user's own defaults (Settings > Investment defaults) ----------
  // Logged in, resolves to UserDefaults.from(profile) (user-defaults.js);
  // logged out or on any failure, null, and the page keeps its built-in
  // figures. Fetched once per page.
  var defaultsPromise = null;
  function userDefaults() {
    if (!likelyLoggedIn || typeof UserDefaults === 'undefined') return Promise.resolve(null);
    if (!defaultsPromise) {
      defaultsPromise = (async function () {
        var s = await session();
        if (!s) return null;
        var res = await fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/profile', { headers: { Authorization: 'Bearer ' + s.access_token } });
        if (!res.ok) return null;
        return UserDefaults.from(await res.json());
      })().catch(function () { return null; });
    }
    return defaultsPromise;
  }
  // Puts a default into an input still showing its built-in value, with
  // thousands separators for money fields. Returns true if it changed.
  function fillDefault(id, value) {
    var el = document.getElementById(id);
    if (!el || value == null || typeof UserDefaults === 'undefined') return false;
    var changed = UserDefaults.fill(el, value);
    if (changed && el.dataset.money !== undefined) formatMoney(el);
    return changed;
  }

  return { num: num, isBlank: isBlank, bind: bind, money: money, money2: money2, pct: pct, esc: esc,
    set: set, html: html, line: line, runFull: runFull, session: session, likelyLoggedIn: likelyLoggedIn,
    userDefaults: userDefaults, fillDefault: fillDefault };
})();
