// track.js: in-house error and feature tracking. No third parties.
//
// Loaded on every page straight after app-config.js. It does two things:
//  1. Sends browser errors (window.onerror and unhandled promise
//     rejections) to POST /api/client-errors, stored in error_log (db/058).
//  2. Gives pages dnyTrack('event_name'), which sends a feature event to
//     POST /api/events, stored in feature_events (db/058). The server only
//     accepts names on its own list (TRACKING_EVENTS in server.js).
//
// What's sent: the error message, stack (URLs without query strings) and
// the page path. No email, no form contents, no browser details. The user
// id comes from the server checking the login token, if there is one.
// Everything here fails silently: tracking must never break a page.
(function () {
  if (window.dnyTrack) return;

  var base = (typeof API_BASE === 'string') ? API_BASE : '';

  // The Supabase login token, read from the browser's own storage, so this
  // works on pages that never create a Supabase client (the calculators).
  function token() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(k)) {
          var v = JSON.parse(localStorage.getItem(k));
          var s = v && (v.access_token ? v : v.currentSession);
          if (s && s.access_token) return s.access_token;
        }
      }
    } catch (e) {}
    return null;
  }

  // The original fetch, captured before auth-guard.js wraps it, so a
  // tracking call can never trigger its "session ended" redirect.
  var rawFetch = window.fetch ? window.fetch.bind(window) : null;
  function post(path, body) {
    if (!rawFetch) return;
    try {
      var headers = { 'Content-Type': 'application/json' };
      var t = token();
      if (t) headers.Authorization = 'Bearer ' + t;
      rawFetch(base + path, { method: 'POST', headers: headers, body: JSON.stringify(body), keepalive: true }).catch(function () {});
    } catch (e) {}
  }

  function path() { return location.pathname; }
  function stripQuery(u) { return String(u || '').replace(/(https?:\/\/[^\s?#)]+)[?#][^\s)]*/g, '$1'); }

  // At most 10 errors per page load, and each distinct message once.
  var sentErrors = {};
  var errorCount = 0;
  function reportError(message, stack, file, line) {
    message = String(message || '').slice(0, 1000);
    if (!message || message === 'Script error.') return; // a cross-site script, no detail to log
    if (/extension:\/\//.test(String(stack) + String(file))) return; // a browser extension, not us
    if (errorCount >= 10 || sentErrors[message]) return;
    sentErrors[message] = true;
    errorCount++;
    post('/api/client-errors', {
      message: message,
      stack: stripQuery(stack).slice(0, 4000),
      source_file: stripQuery(file).slice(0, 300),
      line: line || null,
      page: path()
    });
  }

  window.addEventListener('error', function (e) {
    if (!e || !e.message) return; // a broken image or script tag, not a code error
    reportError(e.message, e.error && e.error.stack, e.filename, e.lineno);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    var msg = r && r.message ? r.message : (typeof r === 'string' ? r : 'Unhandled promise rejection');
    reportError('Unhandled promise rejection: ' + msg, r && r.stack, null, null);
  });

  // dnyTrack('calculator_used:stamp_duty'). once: true sends it at most
  // once per page load (for "used this tool" events fired on every input).
  var sentOnce = {};
  window.dnyTrack = function (event, opts) {
    if (!event) return;
    if (opts && opts.once) {
      if (sentOnce[event]) return;
      sentOnce[event] = true;
    }
    post('/api/events', { event: String(event).slice(0, 64) });
  };
})();
