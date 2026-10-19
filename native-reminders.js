// native-reminders.js: iOS app (Capacitor) only, loaded by app-config.js
// alongside native-app.js. The website never loads it.
//
// Deal reminders scheduled on the phone itself with the Capacitor Local
// Notifications plugin. No server, no database: each reminder is a pending
// iOS notification carrying { dealId, dealName, kind, at } in its "extra"
// data, so listing a deal's reminders is just "pending notifications whose
// extra.dealId matches this deal".
//
// - saved-deals.html calls NativeReminders.render(deal) when a deal opens in
//   the Deal Workspace; it fills the (otherwise hidden) #workspace-reminders
//   section with a list of that deal's reminders and a "Remind me" form.
// - Notification permission is asked the first time someone sets a reminder,
//   never on app launch.
// - Tapping a delivered reminder opens that deal via the existing
//   /saved-deals.html?openDeal=<id> deep link.

(function () {
  var cap = window.Capacitor;
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;

  var LN = (cap.Plugins && cap.Plugins.LocalNotifications) ||
    (cap.registerPlugin ? cap.registerPlugin('LocalNotifications') : null);
  if (!LN) return;

  // Reminder types. "phrase" fills the notification text:
  // "[Deal name]: your <phrase> reminder is due". "months" pre-fills a
  // suggested date when the preset is picked; the user can change it.
  var KINDS = {
    refinance: { label: 'Refinance date', phrase: 'refinance', months: 6 },
    tenancy: { label: 'End of tenancy', phrase: 'end of tenancy', months: 12 },
    mortgage: { label: 'Mortgage deal ending', phrase: 'mortgage deal ending', months: 24 }
  };
  var DEFAULT_TIME = '09:00';

  // ---------- opening a deal from a tapped notification ----------
  // If the app was closed, it starts on the landing page, which sends a
  // logged-in user on to Home. The deal id is parked in sessionStorage so
  // Home can forward to the deal once the user is confirmed logged in.
  var OPEN_KEY = 'nr-open-deal';

  function goToDeal(dealId) {
    window.location.href = '/saved-deals.html?openDeal=' + encodeURIComponent(dealId);
  }

  (function forwardParkedDeal() {
    var parked = null;
    try { parked = JSON.parse(sessionStorage.getItem(OPEN_KEY) || 'null'); } catch (e) {}
    if (!parked) return;
    var fresh = Date.now() - (parked.t || 0) < 60 * 1000;
    var path = window.location.pathname;
    if (!fresh || /\/saved-deals\.html$/.test(path)) {
      try { sessionStorage.removeItem(OPEN_KEY); } catch (e) {}
      return;
    }
    // Only forward from Home (logged-in). The landing/login pages are left
    // alone so a logged-out user is never bounced in a loop.
    if (/\/home\.html$/.test(path)) {
      try { sessionStorage.removeItem(OPEN_KEY); } catch (e) {}
      goToDeal(parked.id);
    }
  })();

  LN.addListener('localNotificationActionPerformed', function (event) {
    var extra = event && event.notification && event.notification.extra;
    if (!extra || !extra.dealId) return;
    try { sessionStorage.setItem(OPEN_KEY, JSON.stringify({ id: extra.dealId, t: Date.now() })); } catch (e) {}
    goToDeal(extra.dealId);
  });

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function addMonths(months) {
    var d = new Date();
    d.setMonth(d.getMonth() + months);
    return d;
  }

  function fmtWhen(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function newId() {
    // iOS notification ids must be whole numbers that fit in 32 bits.
    return Math.floor(Math.random() * 2000000000) + 1;
  }

  async function ensurePermission() {
    var p = await LN.checkPermissions();
    if (p.display === 'granted') return true;
    if (p.display === 'denied') return false;
    p = await LN.requestPermissions();
    return p.display === 'granted';
  }

  async function remindersFor(dealId) {
    var res = await LN.getPending();
    return (res.notifications || [])
      .filter(function (n) { return n.extra && n.extra.dealId === dealId; })
      .sort(function (a, b) { return String(a.extra.at).localeCompare(String(b.extra.at)); });
  }

  // ---------- Deal Workspace section ----------
  var current = null; // { deal, name, kind }

  function ensureStyles() {
    if (document.getElementById('nr-styles')) return;
    var st = document.createElement('style');
    st.id = 'nr-styles';
    st.textContent =
      '.nr-list{margin:0 0 1rem}' +
      '.nr-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.6rem 0;border-bottom:1px solid var(--hairline)}' +
      '.nr-row:last-child{border-bottom:0}' +
      '.nr-kind{font-weight:600;font-size:14px;color:var(--ink)}' +
      '.nr-when{font-size:13px;color:var(--muted)}' +
      '.nr-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 .9rem}' +
      '.nr-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:.9rem}' +
      '@media(max-width:600px){.nr-grid{grid-template-columns:1fr}}' +
      '.nr-grid .field{margin:0}';
    document.head.appendChild(st);
  }

  function render(deal, name) {
    var el = document.getElementById('workspace-reminders');
    if (!el || !deal) return;
    ensureStyles();
    current = { deal: deal, name: name || 'Your deal', kind: 'refinance' };

    var chips = Object.keys(KINDS).map(function (k) {
      return '<button type="button" class="chip' + (k === current.kind ? ' active' : '') + '" data-nr-kind="' + k + '">' + esc(KINDS[k].label) + '</button>';
    }).join('');

    el.innerHTML =
      '<p class="subhead">Reminders</p>' +
      '<div class="nr-list" id="nr-list"><p class="hint">Loading…</p></div>' +
      '<div class="quick-add-form">' +
        '<div class="nr-chips">' + chips + '</div>' +
        '<div class="nr-grid">' +
          '<div class="field"><label for="nr-date">Date</label><input type="date" id="nr-date"></div>' +
          '<div class="field"><label for="nr-time">Time</label><input type="time" id="nr-time" value="' + DEFAULT_TIME + '"></div>' +
        '</div>' +
        '<button type="button" class="btn-primary" id="nr-set">Remind me</button>' +
        '<p class="save-msg" id="nr-msg"></p>' +
      '</div>';
    el.hidden = false;

    var dateEl = document.getElementById('nr-date');
    dateEl.min = ymd(new Date());
    dateEl.value = ymd(addMonths(KINDS[current.kind].months));

    el.querySelectorAll('[data-nr-kind]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        current.kind = btn.getAttribute('data-nr-kind');
        el.querySelectorAll('[data-nr-kind]').forEach(function (b) { b.classList.toggle('active', b === btn); });
        dateEl.value = ymd(addMonths(KINDS[current.kind].months));
      });
    });
    document.getElementById('nr-set').addEventListener('click', setReminder);

    refreshList();
  }

  async function refreshList() {
    if (!current) return;
    var dealId = current.deal.id;
    var listEl = document.getElementById('nr-list');
    if (!listEl) return;
    var items;
    try {
      items = await remindersFor(dealId);
    } catch (e) {
      listEl.innerHTML = '<p class="hint">Couldn\'t load reminders.</p>';
      return;
    }
    if (!current || current.deal.id !== dealId) return; // a different deal opened meanwhile
    if (!items.length) {
      listEl.innerHTML = '<p class="hint">No reminders set for this deal.</p>';
      return;
    }
    listEl.innerHTML = items.map(function (n) {
      var k = KINDS[n.extra.kind];
      return '<div class="nr-row"><div><div class="nr-kind">' + esc(k ? k.label : 'Reminder') + '</div>' +
        '<div class="nr-when">' + esc(fmtWhen(n.extra.at)) + '</div></div>' +
        '<button type="button" class="mini-btn danger" data-nr-cancel="' + n.id + '">Cancel</button></div>';
    }).join('');
    listEl.querySelectorAll('[data-nr-cancel]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        btn.disabled = true;
        try {
          await LN.cancel({ notifications: [{ id: Number(btn.getAttribute('data-nr-cancel')) }] });
        } catch (e) {}
        refreshList();
      });
    });
  }

  async function setReminder() {
    if (!current) return;
    var msg = document.getElementById('nr-msg');
    var btn = document.getElementById('nr-set');
    var date = document.getElementById('nr-date').value;
    var time = document.getElementById('nr-time').value || DEFAULT_TIME;
    msg.className = 'save-msg';
    msg.textContent = '';

    if (!date) { msg.textContent = 'Pick a date.'; msg.className = 'save-msg error'; return; }
    var parts = date.split('-').map(Number);
    var hm = time.split(':').map(Number);
    var at = new Date(parts[0], parts[1] - 1, parts[2], hm[0] || 0, hm[1] || 0, 0, 0); // phone's local time
    if (!(at.getTime() > Date.now())) {
      msg.textContent = 'Pick a time in the future.'; msg.className = 'save-msg error'; return;
    }

    btn.disabled = true;
    try {
      // First use is the only time iOS shows the permission prompt.
      var allowed = await ensurePermission();
      if (!allowed) {
        msg.textContent = 'Notifications are turned off for this app. Turn them on in your iPhone Settings, under Notifications.';
        msg.className = 'save-msg error';
        return;
      }
      var kind = KINDS[current.kind];
      await LN.schedule({
        notifications: [{
          id: newId(),
          title: 'Deal reminder',
          body: current.name + ': your ' + kind.phrase + ' reminder is due',
          schedule: { at: at },
          extra: { dealId: current.deal.id, dealName: current.name, kind: current.kind, at: at.toISOString() }
        }]
      });
      msg.textContent = 'Reminder set for ' + fmtWhen(at.toISOString()) + '.';
      msg.className = 'save-msg success';
      refreshList();
    } catch (e) {
      msg.textContent = 'Couldn\'t set the reminder. Please try again.';
      msg.className = 'save-msg error';
    } finally {
      btn.disabled = false;
    }
  }

  window.NativeReminders = { render: render };
})();
