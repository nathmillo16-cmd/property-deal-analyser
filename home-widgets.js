// home-widgets.js: the motivating parts of the logged-in Home page.
// Loaded only by home.html, which calls HomeWidgets.render(state) once its
// data has loaded. Everything here only reads data the page already
// fetched (deals, pipeline, portfolio, needs-attention, profile, snapshots)
// and never calculates deal figures itself: Quick analyse runs the shared
// calc-engine.js (cBTL) against a hidden set of its own input ids.
//
//   Setup checklist    six first steps, ticked automatically, until done
//   Portfolio street   one house per property owned, outlines up to the goal
//   Goals              cashflow ring, property count, months to go
//   Your next move     urgent items, or one suggested action
//   Milestones         earned badges plus the next one, celebrated once
//   Quick analyse      price + rent -> gross yield and max bid (cBTL)
//   Equity growth      line chart of monthly snapshots (db/043)

var HomeWidgets = (function () {
  var DAY = 24 * 60 * 60 * 1000;
  var NEXT_MOVE_PIPELINE_DAYS = 14;
  var NEXT_MOVE_ANALYSE_DAYS = 21;
  var REFI_DAYS = 60;
  var ANALYSED_KEY = 'dny-analysed-at';      // set by the calculator's Analyse buttons
  var SEEN_KEY_PREFIX = 'dny-milestones-seen:'; // per user, this device
  var DATES_KEY_PREFIX = 'dny-milestones-dates:'; // per user, this device: { id: ISO date earned }
  var BRRR_KEY = 'dny-brrr-analysed-at';         // set by the calculator when analysed on the BRRR tab
  var SETUP_DONE_PREFIX = 'dny-setup-done:';      // per user, this device: all items done once
  var SETUP_DISMISSED_PREFIX = 'dny-setup-dismissed:';

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function money(n) { return (n < 0 ? '−' : '') + '£' + Math.abs(Math.round(n)).toLocaleString('en-GB'); }
  function readLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function reducedMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function todayUTC() { var n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); }
  function dateOnlyUTC(s) { var p = String(s).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }

  // ---------------- progress: account first, this device as fallback ----------------
  // Checklist dismissed/completed, milestone dates, celebrations shown, last
  // analysed and BRRR analysed live on the profile (db/044) when
  // profile.progress_available is true, so they match on every device.
  // Before that migration is run (or if a save fails) the same localStorage
  // keys as before are used. Local values are always written too, and any
  // the account doesn't have yet are uploaded once, so nothing recorded on
  // an older version is lost.
  function parseSeen(raw) { if (raw === null) return null; try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function ms(iso) { var t = iso ? Date.parse(iso) : NaN; return isFinite(t) ? t : 0; }
  function iso(n) { return new Date(n).toISOString(); }

  function makeProgress(st) {
    var uid = st.userId || 'anon';
    var p = st.profile || {};
    var server = !!p.progress_available;
    var srvDates = (server && p.milestone_dates && typeof p.milestone_dates === 'object') ? p.milestone_dates : {};
    var srvSeen = server && Array.isArray(p.milestones_seen) ? p.milestones_seen : null;
    var local = {
      analysed: Number(readLS(ANALYSED_KEY)) || 0,
      brrr: Number(readLS(BRRR_KEY)) || 0,
      done: Number(readLS(SETUP_DONE_PREFIX + uid)) || 0,
      dismissed: Number(readLS(SETUP_DISMISSED_PREFIX + uid)) || 0,
      seen: parseSeen(readLS(SEEN_KEY_PREFIX + uid)),
      dates: readDates(uid)
    };
    var seen = null;
    if (srvSeen || local.seen) {
      seen = (srvSeen || []).slice();
      (local.seen || []).forEach(function (id) { if (seen.indexOf(id) === -1) seen.push(id); });
    }
    var dates = {};
    Object.keys(local.dates).forEach(function (k) { dates[k] = local.dates[k]; });
    Object.keys(srvDates).forEach(function (k) { dates[k] = srvDates[k]; });

    var pending = {};
    // One-time upload of anything this device knows that the account doesn't.
    if (server) {
      if (local.analysed && local.analysed > ms(p.last_analysed_at)) pending.last_analysed = iso(local.analysed);
      if (local.brrr && !p.brrr_analysed_at) pending.brrr_analysed = iso(local.brrr);
      if (local.done && !p.setup_completed_at) pending.setup_completed = iso(local.done);
      if (local.dismissed && !p.setup_dismissed_at) pending.setup_dismissed = iso(local.dismissed);
      var missing = Object.keys(local.dates).filter(function (k) { return !srvDates[k]; });
      if (missing.length) { pending.milestone_dates = {}; missing.forEach(function (k) { pending.milestone_dates[k] = local.dates[k]; }); }
      if (local.seen && local.seen.some(function (id) { return !srvSeen || srvSeen.indexOf(id) === -1; })) pending.milestones_seen = seen.slice();
    }

    function post(patch) {
      if (!server || !st.accessToken || typeof fetch !== 'function') return;
      fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/profile/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + st.accessToken },
        body: JSON.stringify(patch)
      }).catch(function () {});
    }

    return {
      analysedAt: Math.max(local.analysed, ms(p.last_analysed_at)),
      brrrDone: !!(local.brrr || p.brrr_analysed_at),
      setupHidden: !!(local.done || local.dismissed || p.setup_completed_at || p.setup_dismissed_at),
      seen: seen, // null = never recorded anywhere (first visit)
      dates: dates,
      setupCompleted: function () { writeLS(SETUP_DONE_PREFIX + uid, String(Date.now())); pending.setup_completed = true; },
      setupDismissed: function () { writeLS(SETUP_DISMISSED_PREFIX + uid, String(Date.now())); post({ setup_dismissed: true }); },
      recordSeen: function (ids) {
        var all = (seen || []).slice();
        ids.forEach(function (id) { if (all.indexOf(id) === -1) all.push(id); });
        var changed = !seen || all.length !== seen.length;
        seen = all;
        writeLS(SEEN_KEY_PREFIX + uid, JSON.stringify(all));
        if (changed || !srvSeen) pending.milestones_seen = all;
      },
      recordDates: function (map) {
        Object.keys(map).forEach(function (k) { if (!dates[k]) dates[k] = map[k]; });
        writeLS(DATES_KEY_PREFIX + uid, JSON.stringify(dates));
        pending.milestone_dates = pending.milestone_dates || {};
        Object.keys(map).forEach(function (k) { pending.milestone_dates[k] = map[k]; });
      },
      // Called once at the end of render(): sends everything queued in one request.
      flush: function () { if (Object.keys(pending).length) { post(pending); pending = {}; } }
    };
  }

  // ---------------- derived facts, shared by several widgets ----------------
  function facts(st) {
    var props = (!st.portfolioLocked && st.properties) ? st.properties : [];
    var t = st.portfolioTotals || {};
    var g = st.profile || {};
    var goalsSet = !!(g.goal_monthly_cashflow || g.goal_property_count);
    var today = todayUTC();
    var refiSoon = null, refiDone = false;
    props.forEach(function (p) {
      if (!p.refinance_date) return;
      var days = Math.round((dateOnlyUTC(p.refinance_date) - today) / DAY);
      if (days < 0) refiDone = true;
      else if (days <= REFI_DAYS && (!refiSoon || days < refiSoon.days)) refiSoon = { p: p, days: days };
    });
    var lastDealMs = 0;
    (st.savedDeals || []).forEach(function (d) { var ms = new Date(d.created_at).getTime(); if (ms > lastDealMs) lastDealMs = ms; });
    var analysedAt = st.progress ? st.progress.analysedAt : (Number(readLS(ANALYSED_KEY)) || 0);
    return {
      props: props,
      owned: props.length,
      cashflow: props.length ? (t.total_monthly_cashflow || 0) : 0,
      equity: props.length && t.total_equity != null ? t.total_equity : null,
      goals: g,
      goalsSet: goalsSet,
      goalsAvailable: !!g.goals_available,
      refiSoon: refiSoon,
      refiDone: refiDone,
      lastActivityMs: Math.max(lastDealMs, analysedAt),
      analysedEver: analysedAt > 0 || (st.savedDeals || []).length > 0,
    };
  }

  // ---------------- portfolio street ----------------
  var HOUSE = '<path d="M6 30 L20 17 L34 30"/><path d="M9 28 V46 H31 V28"/><path d="M17 46 V37 H23 V46"/><path d="M26 22 V16 H30 V25.5"/>';
  function renderStreet(f) {
    var el = document.getElementById('street');
    if (!el) return;
    var goal = Number(f.goals.goal_property_count) || 0;
    var total = goal > f.owned ? goal : f.owned + 1;
    var MAX = 10;
    var shown = Math.min(total, MAX);
    var solid = Math.min(f.owned, shown);
    var houses = '';
    for (var i = 0; i < shown; i++) {
      var owned = i < solid;
      houses += '<svg class="house' + (owned ? ' owned' : '') + '" viewBox="0 0 40 48" aria-hidden="true" style="--i:' + i + '">' +
        (owned ? '<path class="house-fill" d="M9 28 L20 18 L31 28 V46 H9 Z"/>' : '') + HOUSE + '</svg>';
    }
    var more = total > MAX ? '<span class="street-more">+' + (total - MAX) + '</span>' : '';
    var caption = goal
      ? f.owned + ' of ' + goal + ' properties'
      : (f.owned ? f.owned + (f.owned === 1 ? ' property' : ' properties') + ' and counting' : 'Your first property goes here');
    el.setAttribute('aria-label', 'Portfolio street: ' + caption);
    el.innerHTML = '<div class="street-row' + (reducedMotion() ? ' still' : '') + '">' + houses + more + '</div>' +
      '<div class="street-ground"></div><p class="street-caption">' + esc(caption) + '</p>';
  }

  // ---------------- goals ----------------
  function monthsToGo(dateStr) {
    var target = dateOnlyUTC(dateStr), now = new Date();
    var t = new Date(target);
    var months = (t.getUTCFullYear() - now.getFullYear()) * 12 + (t.getUTCMonth() - now.getMonth());
    if (t.getUTCDate() < now.getDate()) months -= 1;
    if (target < todayUTC()) return 'Target date passed';
    if (months < 1) return 'Less than a month to go';
    return months + (months === 1 ? ' month to go' : ' months to go');
  }

  function ring(pct) {
    var r = 38, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct));
    return '<span class="ring-wrap"><svg class="ring" viewBox="0 0 96 96" aria-hidden="true">' +
      '<circle class="ring-track" cx="48" cy="48" r="' + r + '"/>' +
      '<circle class="ring-fill" cx="48" cy="48" r="' + r + '" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + (c * (1 - p)).toFixed(2) + '"' +
      (reducedMotion() ? '' : ' style="--c:' + c.toFixed(2) + '"') + '/></svg>' +
      '<span class="ring-pct">' + Math.round(p * 100) + '%</span></span>';
  }

  function renderGoals(f) {
    var card = document.getElementById('goals-card');
    if (!card) return;
    // Before db/042 is run the goals fields don't exist: hide the card and
    // let Quick analyse take the full row.
    if (!f.goalsAvailable) { card.hidden = true; card.parentNode.classList.add('single'); return; }
    card.hidden = false; card.parentNode.classList.remove('single');
    var g = f.goals;
    if (!f.goalsSet) {
      card.innerHTML = '<h2>Your goals</h2>' +
        '<p class="goals-empty">Set a cashflow target and a property count, and Home will track your progress towards them.</p>' +
        '<p class="goals-example">e.g. £1,500/month from 5 properties by 2029</p>' +
        '<a class="btn-primary" href="/settings.html#goals">Set your goals</a>';
      return;
    }
    var parts = '';
    if (g.goal_monthly_cashflow) {
      var target = Number(g.goal_monthly_cashflow);
      parts += '<div class="goal-ring">' + ring(f.cashflow / target) +
        '<div><p class="goal-big">' + money(Math.max(0, f.cashflow)) + ' <span>of ' + money(target) + '/month</span></p>' +
        '<p class="goal-label">Monthly cashflow goal</p></div></div>';
    }
    if (g.goal_property_count) {
      var n = Number(g.goal_property_count);
      var w = Math.max(0, Math.min(100, (f.owned / n) * 100));
      parts += '<div class="goal-count"><p class="goal-big">' + f.owned + ' <span>of ' + n + ' properties</span></p>' +
        '<div class="goal-bar"><div style="width:' + w.toFixed(1) + '%"></div></div></div>';
    }
    var foot = g.goal_target_date ? '<p class="goal-date">' + esc(monthsToGo(g.goal_target_date)) + '</p>' : '';
    card.innerHTML = '<div class="goals-head"><h2>Your goals</h2><a class="goals-edit" href="/settings.html#goals">Edit</a></div>' + parts + foot;
  }

  // ---------------- setup checklist ----------------
  // Six first steps, each ticked from data the page already loaded. Steps
  // that need a paid feature the user can't use (portfolio, pipeline) or a
  // database column that isn't there yet (goals) are left out, so the list
  // never asks for something impossible. Hidden for good once every step is
  // done, or when dismissed (both remembered on the account, see makeProgress).
  var CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var ARROW_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

  function setupItems(st, f) {
    var props = f.props;
    var deals = st.savedDeals || [];
    var items = [];
    if (f.goalsAvailable) items.push({ id: 'goals', label: 'Set your goals', href: '/settings.html#goals', done: f.goalsSet });
    if (!st.portfolioLocked) items.push({ id: 'value', label: 'Add current value to a property', href: '/portfolio.html', done: props.some(function (p) { return p.current_value != null; }) });
    items.push({ id: 'save', label: 'Save a deal', href: '/index.html', done: deals.length > 0 });
    if (!st.pipelineLocked) items.push({ id: 'pipeline', label: 'Add a deal to your pipeline', href: '/saved-deals.html', done: (st.pipelineDeals || []).length > 0 || deals.some(function (d) { return !!d.pipeline_stage; }) });
    items.push({ id: 'brrr', label: 'Run a BRRR analysis', href: '/index.html', done: !!(st.progress && st.progress.brrrDone) || deals.some(function (d) { return d.deal_type === 'btl' && d.deal_data && d.deal_data.strategy === 'brrr'; }) });
    // "Refinance date" now only applies to BRRR properties, so this step
    // asks for mortgage dates in general (a fixed rate end or a refinance).
    if (!st.portfolioLocked) items.push({ id: 'refi', label: 'Add your mortgage dates', href: '/portfolio.html', done: props.some(function (p) { return !!(p.refinance_date || p.fixed_rate_end_date); }) });
    return items;
  }

  function renderSetup(st, f) {
    var card = document.getElementById('setup-card');
    if (!card) return;
    var pr = st.progress;
    if (pr.setupHidden) { card.hidden = true; return; }
    var items = setupItems(st, f);
    var done = items.filter(function (i) { return i.done; }).length;
    if (!items.length || done === items.length) {
      pr.setupCompleted();
      card.hidden = true;
      return;
    }
    var pct = Math.round((done / items.length) * 100);
    card.innerHTML =
      '<div class="setup-head"><div><h2>Get the most out of PROPulsion</h2>' +
        '<p class="setup-progress-text">' + done + ' of ' + items.length + ' done</p></div>' +
        '<button type="button" class="setup-dismiss" id="setup-dismiss">Dismiss</button></div>' +
      '<div class="setup-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + items.length + '" aria-valuenow="' + done + '" aria-label="Setup progress"><div style="width:' + pct + '%"></div></div>' +
      '<ul class="setup-list">' + items.map(function (i) {
        return '<li><a class="setup-item' + (i.done ? ' done' : '') + '" href="' + i.href + '">' +
          '<span class="setup-check" aria-hidden="true">' + (i.done ? CHECK_ICON : '') + '</span>' +
          '<span class="setup-label">' + esc(i.label) + (i.done ? '<span class="sr-only"> (done)</span>' : '') + '</span>' +
          (i.done ? '' : '<span class="setup-go" aria-hidden="true">' + ARROW_ICON + '</span>') + '</a></li>';
      }).join('') + '</ul>';
    card.hidden = false;
    document.getElementById('setup-dismiss').addEventListener('click', function () {
      pr.setupDismissed();
      card.hidden = true;
    });
  }

  // ---------------- your next move ----------------
  function suggestion(st, f) {
    if (!st.portfolioLocked && f.refiSoon) {
      var d = f.refiSoon.days;
      return { title: 'Refinance window opening', text: f.refiSoon.p.address + ': ' + (d === 0 ? 'opens today.' : 'opens in ' + d + (d === 1 ? ' day.' : ' days.')) + ' Line up a broker and a valuation.', cta: 'View property', href: '/property.html?id=' + encodeURIComponent(f.refiSoon.p.id) };
    }
    if (!st.portfolioLocked) {
      var missing = f.props.filter(function (p) { return p.current_value == null || (p.mortgage_balance == null && Number(p.monthly_mortgage) > 0); });
      if (missing.length) {
        return { title: 'Add current value to see your equity', text: (missing.length === 1 ? missing[0].address + ' is' : missing.length + ' properties are') + ' missing a current value or mortgage balance.', cta: 'Add current value', href: '/portfolio.html' };
      }
    }
    // (c) "Set your goals": skipped while the goals card itself is showing
    // its own "Set your goals" prompt, so the same ask never appears twice.
    if (f.goalsAvailable && !f.goalsSet && !f.goalsPromptShown) {
      return { title: 'Set your goals', text: 'Pick a monthly cashflow target and how many properties you want. Home will track your progress.', cta: 'Set your goals', href: '/settings.html#goals' };
    }
    if (!st.pipelineLocked) {
      var now = Date.now();
      var stale = (st.pipelineDeals || []).filter(function (d) { return d.pipeline_stage && d.pipeline_stage !== 'completed' && d.pipeline_stage !== 'lost' && d.updated_at && now - new Date(d.updated_at).getTime() >= NEXT_MOVE_PIPELINE_DAYS * DAY; });
      if (stale.length) {
        var days = Math.floor((now - new Date(stale[0].updated_at).getTime()) / DAY);
        var nm = (stale[0].deal_data && stale[0].deal_data.name) || 'A deal';
        return { title: 'Move a deal forward', text: nm + ' has sat untouched for ' + days + ' days.', cta: 'Open the board', href: '/pipeline.html' };
      }
    }
    if (!f.lastActivityMs) {
      return { title: 'Analyse your first deal', text: 'Put a listing’s numbers in and see your max bid and money left in, in seconds.', cta: 'Analyse a deal', href: '/index.html' };
    }
    if (Date.now() - f.lastActivityMs >= NEXT_MOVE_ANALYSE_DAYS * DAY) {
      return { title: 'Analyse your next deal', text: 'It has been ' + Math.floor((Date.now() - f.lastActivityMs) / DAY) + ' days since your last one. Deals are found by looking.', cta: 'Analyse a deal', href: '/index.html' };
    }
    return { title: 'You’re on track', text: 'Nothing needs you right now. Keep the momentum going with your next analysis.', cta: 'Analyse a deal', href: '/index.html', positive: true };
  }

  function renderNextMove(st, f) {
    var card = document.getElementById('needs-attention-card');
    var list = document.getElementById('needs-attention-list');
    var title = document.getElementById('needs-attention-title');
    if (!card || !list) return;
    var urgent = st.pipelineLocked ? [] : (st.needsAttention || []);
    if (urgent.length) {
      title.textContent = 'Needs attention';
      var LABEL = { chase: 'Chase', update: 'Update', review: 'Review', refinance: 'Refinance', reminder: 'Reminder', fix_end: 'Fixed rate', tenancy: 'Tenancy', compliance: 'Compliance', rent: 'Rent', loan: 'Loan' };
      list.innerHTML = urgent.map(function (n) {
        // Portfolio alerts (refinance, fixed rate, tenancy, compliance, rent) open
        // that property's page; deal alerts open the deal.
        // A "Send follow-up letter" reminder (db/051) opens the Letter
        // Templates page on the Follow-up letter with that deal picked.
        // A private loan repayment opens that loan on the Private finance page.
        var href = n.loan_id ? '/private-finance.html#loan-' + encodeURIComponent(n.loan_id)
          : n.property_id ? '/property.html?id=' + encodeURIComponent(n.property_id)
          : (n.deal_id && n.action === 'followup_letter' ? '/letters.html?type=followup&deal=' + encodeURIComponent(n.deal_id)
          : (n.deal_id ? '/saved-deals.html?openDeal=' + encodeURIComponent(n.deal_id) : '/saved-deals.html'));
        var tagClass = esc(n.reason) + (n.severity ? ' ' + esc(n.severity) : '');
        return '<a class="na-row" href="' + href + '"><span class="na-info"><span class="na-name">' + esc(n.deal_name || 'Untitled deal') + '</span>' +
          '<span class="na-detail">' + esc(n.detail) + '</span></span><span class="na-tag ' + tagClass + '">' + esc(LABEL[n.reason] || n.reason) + '</span></a>';
      }).join('');
      return;
    }
    var s = suggestion(st, f);
    title.textContent = 'Your next move';
    list.innerHTML = '<div class="next-move' + (s.positive ? ' positive' : '') + '">' +
      '<span class="next-move-icon" aria-hidden="true">' + (s.positive
        ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg>') + '</span>' +
      '<div class="next-move-text"><p class="next-move-title">' + esc(s.title) + '</p><p class="next-move-body">' + esc(s.text) + '</p></div>' +
      '<a class="btn-primary next-move-cta" href="' + s.href + '">' + esc(s.cta) + '</a></div>';
  }

  // ---------------- milestones ----------------
  var ICON = {
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    save: '<path d="M6.5 3h11a1 1 0 0 1 1 1v17l-6.5-4.2L5.5 21V4a1 1 0 0 1 1-1z"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    refi: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    street: '<path d="M2 20h20M4 20v-8l4-3 4 3v8M12 20v-10l4-3 4 3v10"/>',
    equity: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'
  };
  function milestoneList(f) {
    return [
      { id: 'first-analysed', label: 'First deal analysed', icon: 'spark', done: f.analysedEver },
      { id: 'first-saved', label: 'First deal saved', icon: 'save', done: f.savedCount > 0 },
      { id: 'first-property', label: 'First property', icon: 'home', done: f.owned >= 1 },
      { id: 'first-refinance', label: 'First refinance logged', icon: 'refi', done: f.refiDone },
      { id: 'cashflow-500', label: '£500/month cashflow', icon: 'cash', done: f.owned > 0 && f.cashflow >= 500 },
      { id: 'cashflow-1000', label: '£1,000/month cashflow', icon: 'cash', done: f.owned > 0 && f.cashflow >= 1000 },
      { id: 'properties-3', label: '3 properties', icon: 'street', done: f.owned >= 3 },
      { id: 'properties-5', label: '5 properties', icon: 'street', done: f.owned >= 5 },
      { id: 'equity-100k', label: '£100k equity', icon: 'equity', done: f.equity != null && f.equity >= 100000 }
    ];
  }

  function badge(m, cls) {
    return '<div class="ms ' + cls + '" data-id="' + m.id + '"><span class="ms-icon" aria-hidden="true"><svg viewBox="0 0 24 24">' + ICON[m.icon] + '</svg></span>' +
      '<span class="ms-text">' + (cls === 'next' ? '<span class="ms-kicker">Next milestone</span>' : '') + '<span class="ms-label">' + esc(m.label) + '</span></span></div>';
  }

  function readDates(uid) {
    try { var d = JSON.parse(readLS(DATES_KEY_PREFIX + uid) || '{}'); return d && typeof d === 'object' ? d : {}; } catch (e) { return {}; }
  }

  // When each milestone was earned, where we know: a date recorded on the
  // account the moment it was first celebrated, or else one read straight
  // from the data (first saved deal, first property). Never guessed.
  function earnedDate(m, st, stored) {
    if (stored[m.id]) return stored[m.id];
    var list = m.id === 'first-saved' ? (st.savedDeals || []) : m.id === 'first-property' ? (st.properties || []) : null;
    if (!list || !list.length) return null;
    var min = null;
    list.forEach(function (x) { var t = x.created_at ? new Date(x.created_at).getTime() : NaN; if (isFinite(t) && (min === null || t < min)) min = t; });
    return min === null ? null : new Date(min).toISOString();
  }

  function renderMilestones(st, f) {
    var el = document.getElementById('milestones');
    if (!el) return;
    var all = milestoneList(f);
    var earned = all.filter(function (m) { return m.done; });
    var next = all.filter(function (m) { return !m.done; })[0];
    el.innerHTML = earned.map(function (m) { return badge(m, 'earned'); }).join('') +
      (next ? badge(next, 'next') : '') +
      (!earned.length ? '<p class="ms-hint">Milestones unlock as you analyse, save and buy.</p>' : '');

    // Celebrate newly earned ones once (remembered on the account, so a
    // badge celebrated on the phone isn't celebrated again on the laptop).
    // The very first visit just records what's already earned, so nobody
    // gets a burst.
    var pr = st.progress;
    var ids = earned.map(function (m) { return m.id; });
    var fresh = pr.seen === null ? [] : earned.filter(function (m) { return pr.seen.indexOf(m.id) === -1; });
    pr.recordSeen(ids);
    if (fresh.length) {
      var now = new Date().toISOString();
      var map = {};
      fresh.forEach(function (m) { map[m.id] = earnedDate(m, st, {}) || now; }); // real date from the data where known
      pr.recordDates(map);
      celebrate(fresh[fresh.length - 1], el);
    }
    bindMilestonesModal(all, st, pr.dates);
  }

  function fmtDay(iso) { var d = new Date(iso); return isFinite(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }

  function bindMilestonesModal(all, st, stored) {
    var btn = document.getElementById('milestones-see-all');
    var overlay = document.getElementById('ms-modal');
    var list = document.getElementById('ms-modal-list');
    if (!btn || !overlay || !list) return;
    var earnedCount = all.filter(function (m) { return m.done; }).length;
    document.getElementById('ms-modal-count').textContent = earnedCount + ' of ' + all.length + ' earned';
    list.innerHTML = all.map(function (m) {
      var when = m.done ? earnedDate(m, st, stored) : null;
      return '<li class="ms-row' + (m.done ? ' earned' : ' locked') + '">' +
        '<span class="ms-icon" aria-hidden="true"><svg viewBox="0 0 24 24">' + ICON[m.icon] + '</svg></span>' +
        '<span class="ms-row-text"><span class="ms-row-label">' + esc(m.label) + '</span>' +
        '<span class="ms-row-meta">' + (m.done ? (when ? 'Earned ' + esc(fmtDay(when)) : 'Earned') : 'Locked') + '</span></span></li>';
    }).join('');
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    var lastFocus = null;
    function open() { lastFocus = document.activeElement; overlay.hidden = false; document.body.classList.add('ms-modal-open'); document.getElementById('ms-modal-close').focus(); }
    function close() { overlay.hidden = true; document.body.classList.remove('ms-modal-open'); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
    btn.addEventListener('click', open);
    document.getElementById('ms-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !overlay.hidden) close(); });
  }

  function celebrate(m, el) {
    var b = el.querySelector('.ms[data-id="' + m.id + '"]');
    if (b && !reducedMotion()) b.classList.add('just-earned');
    var t = document.createElement('div');
    t.className = 'ms-toast';
    t.setAttribute('role', 'status');
    t.innerHTML = '<span class="ms-toast-kicker">Milestone unlocked</span><span>' + esc(m.label) + '</span>';
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 400); }, 3200);
  }

  // ---------------- quick analyse ----------------
  // Builds the hidden inputs/outputs cBTL() reads and writes, so the
  // existing engine does the maths. End value is set to the purchase price
  // and every cost to 0, so gross yield is on the price paid.
  var QA_IDS_IN = { 'b-pp': '', 'b-emv': '', 'b-rent': '', 'b-mr': '0', 'b-dp': '25', 'b-ref': '0', 'b-sol': '0', 'b-mf': '0', 'b-srch': '0', 'b-ins': '0', 'b-mgmt': '0', 'b-maint': '0', 'b-ty': '7', 'b-tr': '15', 'b-term': '25' };
  var QA_IDS_OUT = ['b-ly', 'b-lr', 'b-sn', 'b-oy', 'b-oyn', 'b-or', 'b-orn'];
  var qaTargetYield = 7;

  function qaVal(id) { var n = +String(document.getElementById(id).value).replace(/,/g, ''); return isFinite(n) && n > 0 ? n : 0; }
  function qaFormat(el) {
    var raw = el.value.replace(/[^\d.]/g, '');
    var parts = raw.split('.');
    var int = parts[0].replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    el.value = parts.length > 1 ? int + '.' + parts.slice(1).join('').slice(0, 2) : int;
  }

  function qaRun() {
    var pp = qaVal('qa-price'), rent = qaVal('qa-rent');
    var y = document.getElementById('qa-yield'), b = document.getElementById('qa-bid'), note = document.getElementById('qa-note');
    if (!pp || !rent || typeof cBTL !== 'function') { y.textContent = '—'; b.textContent = '—'; note.textContent = 'Yield on purchase price. Add end value and costs in the full analysis.'; return; }
    document.getElementById('b-pp').value = pp;
    document.getElementById('b-emv').value = pp;
    document.getElementById('b-rent').value = rent;
    document.getElementById('b-ty').value = qaTargetYield;
    try { cBTL(); } catch (e) { return; }
    var d = window.btlData || (typeof btlData !== 'undefined' ? btlData : {});
    y.textContent = d.gy != null ? d.gy.toFixed(2) + '%' : '—';
    y.className = 'qa-res-v ' + (d.gy >= qaTargetYield ? 'good' : 'warn');
    b.textContent = d.oY ? money(d.oY) : '—';
    var diff = d.oY - pp;
    note.textContent = d.oY ? (diff >= 0 ? money(diff) + ' headroom under that max bid.' : money(-diff) + ' over the max bid for a ' + qaTargetYield + '% yield.') : '';
  }

  function initQuickAnalyse(st) {
    var host = document.getElementById('qa-engine');
    if (!host || host.childNodes.length) return;
    var ty = Number(st.profile && st.profile.target_yield);
    qaTargetYield = ty > 0 ? ty : 7;
    QA_IDS_IN['b-ty'] = String(qaTargetYield);
    host.innerHTML = Object.keys(QA_IDS_IN).map(function (id) { return '<input id="' + id + '" value="' + QA_IDS_IN[id] + '"/>'; }).join('') +
      QA_IDS_OUT.map(function (id) { return '<span id="' + id + '"></span>'; }).join('');
    document.getElementById('qa-bid-label').textContent = 'Max bid at ' + qaTargetYield + '% yield';
    ['qa-price', 'qa-rent'].forEach(function (id) {
      var el = document.getElementById(id);
      el.addEventListener('input', function () { qaFormat(el); qaRun(); });
    });
    document.getElementById('qa-full').addEventListener('click', function () {
      var pp = qaVal('qa-price'), rent = qaVal('qa-rent');
      var fields = {};
      if (pp) { fields['b-pp'] = pp; fields['b-emv'] = pp; }
      if (rent) fields['b-rent'] = rent;
      // Same one-shot handoff the calculator already reads for saved deals
      // (applyRerunPayload in index.html). No deal id, so nothing is saved.
      try {
        sessionStorage.setItem('dny-rerun', JSON.stringify({ strategy: 'btl', fields: fields,
          note: 'Filled in from Quick analyse. Add the end value, refurb and costs for the full picture.' }));
      } catch (e) {}
      window.location.href = '/index.html';
    });
  }

  // ---------------- equity growth chart ----------------
  function monthLabel(s) { var p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }); }
  // A tidy tick step (1, 2, 2.5 or 5 x 10^n) so the axis tops out just above the data.
  function niceStep(range, ticks) { var raw = range / ticks; if (raw <= 0) return 1; var e = Math.pow(10, Math.floor(Math.log10(raw))); var m = raw / e; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e; }
  function compact(n) { var a = Math.abs(n); return (n < 0 ? '−' : '') + '£' + (a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'm' : a >= 1e3 ? Math.round(a / 1e3) + 'k' : Math.round(a)); }

  function renderGrowth(st, f) {
    var card = document.getElementById('growth-card');
    if (!card) return;
    // Only meaningful once the user tracks properties and db/043 exists.
    if (st.portfolioLocked || !f.owned || !st.snapshotsAvailable) { card.hidden = true; return; }
    card.hidden = false;
    var body = document.getElementById('growth-body');
    var snaps = (st.snapshots || []).slice();
    card.classList.toggle('compact', snaps.length < 2);
    if (snaps.length === 1) {
      var s0 = snaps[0];
      var hasEq = s0.total_equity != null;
      var p0 = String(s0.month).split('-').map(Number);
      var when = new Date(p0[0], p0[1] - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      document.getElementById('growth-title').textContent = hasEq ? 'Equity growth' : 'Portfolio value';
      body.innerHTML = '<div class="growth-start"><span class="growth-dot" aria-hidden="true"></span>' +
        '<p class="growth-start-text">Starting point: <strong>' + money(hasEq ? s0.total_equity : s0.portfolio_value) + '</strong> ' + (hasEq ? 'equity' : 'portfolio value') + ', ' + esc(when) + '</p></div>' +
        '<p class="growth-start-sub">Your growth chart appears from next month.</p>';
      return;
    }
    if (snaps.length < 2) {
      body.innerHTML = '<p class="growth-note"><span class="growth-dot" aria-hidden="true"></span>Equity tracking started. Your growth chart appears next month.</p>';
      return;
    }
    var useEquity = snaps.every(function (s) { return s.total_equity != null; });
    var key = useEquity ? 'total_equity' : 'portfolio_value';
    document.getElementById('growth-title').textContent = useEquity ? 'Equity growth' : 'Portfolio value';
    drawChart(body, snaps, key);
    if (!card.dataset.resizeBound) {
      card.dataset.resizeBound = '1';
      var timer = null;
      window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(function () { drawChart(body, snaps, key); }, 150); });
    }
  }

  function drawChart(body, snaps, key) {
    var W = Math.max(280, Math.round(body.clientWidth || 600)), H = 220;
    var pad = { l: 52, r: 30, t: 14, b: 30 };
    var vals = snaps.map(function (s) { return Number(s[key]) || 0; });
    var ticks = 4;
    var min = Math.min.apply(null, vals.concat([0]));
    var stepV = niceStep(Math.max.apply(null, vals) - min, ticks);
    var maxV = min + stepV * Math.ceil((Math.max.apply(null, vals) - min) / stepV || 1);
    ticks = Math.round((maxV - min) / stepV);
    var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    var x = function (i) { return pad.l + (snaps.length === 1 ? iw / 2 : (i / (snaps.length - 1)) * iw); };
    var y = function (v) { return pad.t + ih - ((v - min) / (maxV - min || 1)) * ih; };
    var grid = '';
    for (var k = 0; k <= ticks; k++) {
      var v = min + (maxV - min) * (k / ticks), gy = y(v);
      grid += '<line class="g-grid" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '"/>' +
        '<text class="g-tick" x="' + (pad.l - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end">' + compact(v) + '</text>';
    }
    var step = Math.ceil(snaps.length / Math.max(2, Math.floor(iw / 80)));
    var xl = '';
    snaps.forEach(function (s, i) {
      var lastI = snaps.length - 1;
      if ((i % step === 0 && lastI - i >= step / 2) || i === lastI) xl += '<text class="g-tick" x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (i === lastI ? 'end' : i === 0 ? 'start' : 'middle') + '">' + monthLabel(s.month) + '</text>';
    });
    var d = vals.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
    var area = d + ' L' + x(vals.length - 1).toFixed(1) + ' ' + (pad.t + ih) + ' L' + x(0).toFixed(1) + ' ' + (pad.t + ih) + ' Z';
    var last = vals.length - 1;
    var rows = snaps.map(function (s) {
      return '<tr><td>' + monthLabel(s.month) + '</td><td>' + (s.total_equity != null ? money(s.total_equity) : 'Not set') + '</td><td>' + money(s.portfolio_value) + '</td><td>' + money(s.monthly_cashflow) + '</td></tr>';
    }).join('');
    body.innerHTML = '<div class="g-wrap"><svg class="g-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + (key === 'total_equity' ? 'Total equity' : 'Portfolio value') + ' by month">' +
      grid + xl + '<path class="g-area" d="' + area + '"/><path class="g-line" d="' + d + '"/>' +
      '<circle class="g-end" cx="' + x(last).toFixed(1) + '" cy="' + y(vals[last]).toFixed(1) + '" r="4.5"/>' +
      '<line class="g-cross" y1="' + pad.t + '" y2="' + (pad.t + ih) + '" visibility="hidden"/><circle class="g-hover" r="5" visibility="hidden"/>' +
      '<rect class="g-hit" x="' + pad.l + '" y="' + pad.t + '" width="' + iw + '" height="' + ih + '"/></svg>' +
      '<div class="g-tip" hidden></div></div>' +
      '<div class="sr-only"><table><caption>Portfolio by month</caption><thead><tr><th>Month</th><th>Total equity</th><th>Portfolio value</th><th>Monthly cashflow</th></tr></thead><tbody>' + rows + '</tbody></table></div>';

    var svg = body.querySelector('.g-svg'), hit = body.querySelector('.g-hit'), cross = body.querySelector('.g-cross'), dot = body.querySelector('.g-hover'), tip = body.querySelector('.g-tip');
    function show(evt) {
      var r = svg.getBoundingClientRect();
      var px = ((evt.clientX - r.left) / r.width) * W;
      var i = Math.round(((px - pad.l) / iw) * (snaps.length - 1));
      i = Math.max(0, Math.min(snaps.length - 1, i));
      var cx = x(i), cy = y(vals[i]), s = snaps[i];
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
      tip.innerHTML = '<p class="g-tip-m">' + monthLabel(s.month) + '</p>' +
        '<p><span>Equity</span>' + (s.total_equity != null ? money(s.total_equity) : 'Not set') + '</p>' +
        '<p><span>Value</span>' + money(s.portfolio_value) + '</p><p><span>Cashflow</span>' + money(s.monthly_cashflow) + '/mo</p>';
      tip.hidden = false;
      var left = (cx / W) * r.width;
      tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, left - tip.offsetWidth / 2)) + 'px';
      tip.style.top = Math.max(0, (cy / H) * r.height - tip.offsetHeight - 14) + 'px';
    }
    function hide() { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; }
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide);
  }

  // ---------------- entry point ----------------
  function render(st) {
    st.progress = makeProgress(st);
    var f = facts(st);
    f.savedCount = (st.savedDeals || []).length;
    renderSetup(st, f);
    renderStreet(f);
    renderGoals(f);
    var gc = document.getElementById('goals-card');
    f.goalsPromptShown = !!(gc && !gc.hidden && !f.goalsSet);
    renderNextMove(st, f);
    renderMilestones(st, f);
    initQuickAnalyse(st);
    renderGrowth(st, f);
    st.progress.flush();
    return f;
  }

  // canAdd: the goals/motto fields exist (db/042), so offer "+ Add your motto".
  function renderMotto(text, canAdd) {
    var el = document.getElementById('motto');
    var add = document.getElementById('motto-add');
    if (!el) return;
    var t = (text || '').trim();
    el.textContent = t ? '“' + t + '”' : '';
    el.hidden = !t;
    if (add) add.hidden = !!t || !canAdd;
  }

  return { render: render, renderMotto: renderMotto, ANALYSED_KEY: ANALYSED_KEY };
})();
