// deal-cards.js: the parts of the Deals page shared by the List view
// (saved-deals.html) and the Board view (pipeline.html):
//
//   - smart deal cards: verdict dot, strategy, price, gross yield, monthly
//     cashflow, money left in (BRRR), stage and "X days in this stage"
//   - filters and sort (stage, strategy, verdict, date added), remembered
//     on this device so both views stay in step
//   - the pipeline stats card (active deals, value in play, offers made
//     this month, conversion, average discount off asking)
//
// NO DEAL MATHS. Every figure on a card is one calc-engine.js already
// worked out and stored in deal_data when the deal was saved. The verdict
// is deal-verdict.js's own rule (the calculator's), applied to those stored
// figures. Load after compare-deals.js and deal-verdict.js.
//
// BUY BOX: when the user has set one (Tools > Buy box, profiles.buy_box),
// each card shows "Fits 5 of 6" (planning-tools.js does the check, from
// the same stored figures) and the toolbar gets a "Buy box" filter. Pages
// call DealCards.initBuyBox(rerender) once nav.js has loaded. Pages that
// don't load planning-tools.js simply show no badge.

var DealCards = (function () {
  var V = window.DealVerdict;

  var STAGES = ['analysing', 'viewing', 'offered', 'agreed', 'completed', 'lost'];
  var STAGE_LABELS = { analysing: 'Analysing', viewing: 'Viewing', offered: 'Offered', agreed: 'Agreed', completed: 'Completed', lost: 'Lost' };
  var STAGE_COLORS = { analysing: '#c7c4ea', viewing: '#a49ee0', offered: '#7a72d4', agreed: '#4b45b2', completed: '#0f7a5a', lost: '#b9b6ae' };
  var LOST_REASONS = { outbid: 'Outbid', survey: 'Survey issues', numbers: "Numbers didn't stack", vendor: 'Vendor pulled out', other: 'Other' };
  var STRATEGY_LABELS = { btl: 'BTL', brrr: 'BRRR', hmo: 'HMO', sa: 'SA', flip: 'Flip' };
  var DAY = 24 * 60 * 60 * 1000;

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function money(v) { return (v == null || !isFinite(v)) ? '-' : V.money(v); }
  function pct(v) { return (v == null || !isFinite(v)) ? '-' : V.pct(v); }

  function strategyOf(deal) { return dealStrategy(deal); }
  function nameOf(deal) { return (deal.deal_data && deal.deal_data.name) ? deal.deal_data.name : 'Untitled deal'; }

  // ---------- verdict ----------
  // Same rule as the calculator. BTL/HMO/SA cards use the interest-only
  // figures (the default results tab); BRRR uses the after-refinance ones.
  // Deals saved before the needed figures existed get no verdict (grey).
  function verdictOf(deal) {
    var d = deal.deal_data || {};
    var st = strategyOf(deal);
    if (!(d.pp > 0)) return null;
    if (st === 'flip') {
      if (d.profit == null || d.roi == null || d.troi == null) return null;
      var fv = V.flipVerdict(d);
      fv.basis = 'Flip';
      return fv;
    }
    var base = st === 'brrr' ? 'btl' : st;
    var mode = st === 'brrr' ? 'brrr' : 'm';
    if (!V.CF_KEY[base]) return null;
    var m = V.metrics(base, mode, d);
    if (m.cf == null || m.gy == null || m.ty == null || m.tr == null || (m.roi == null && !m.allOut)) return null;
    var v = V.rentalVerdict(m, mode);
    v.basis = V.MODE_LABEL[mode];
    return v;
  }
  function verdictKey(deal) { var v = verdictOf(deal); return v ? v.level : 'none'; }

  // ---------- card figures ----------
  function cardFigures(deal) {
    var d = deal.deal_data || {};
    var st = strategyOf(deal);
    if (st === 'flip') {
      return [{ l: 'Profit', v: money(d.profit) }, { l: 'ROI', v: pct(d.roi) }];
    }
    var cfKey = st === 'brrr' ? (V.CF_KEY.btl.brrr) : (V.CF_KEY[st] ? V.CF_KEY[st].m : null);
    var figs = [
      { l: 'Gross yield', v: pct(d.gy) },
      { l: 'Cashflow /mo', v: money(cfKey ? d[cfKey] : null) }
    ];
    if (st === 'brrr') figs.push({ l: 'Left in', v: d.bbMLI != null && d.bbMLI <= 0 ? '£0' : money(d.bbMLI) });
    return figs;
  }

  // When the deal entered its current stage (db/045's stage_changed_at).
  // Before that migration: last touched for a pipelined deal, otherwise
  // when it was saved.
  function stageSince(deal) {
    var iso = deal.stage_changed_at || (deal.pipeline_stage ? deal.updated_at : null) || deal.created_at;
    var t = iso ? Date.parse(iso) : NaN;
    return isFinite(t) ? t : null;
  }
  function daysInStage(deal) {
    var t = stageSince(deal);
    return t == null ? null : Math.max(0, Math.floor((Date.now() - t) / DAY));
  }
  function daysText(deal) {
    var n = daysInStage(deal);
    if (n == null) return '';
    if (!deal.pipeline_stage) return n === 0 ? 'Saved today' : 'Saved ' + n + (n === 1 ? ' day' : ' days') + ' ago';
    return n === 0 ? 'Today in this stage' : n + (n === 1 ? ' day' : ' days') + ' in this stage';
  }
  function stageLabel(deal) { return deal.pipeline_stage ? (STAGE_LABELS[deal.pipeline_stage] || deal.pipeline_stage) : 'Saved'; }

  // The shared inside of a card. opts.showStage: include the stage pill
  // (the List does, the Board's columns already say the stage).
  function cardBody(deal, opts) {
    opts = opts || {};
    var d = deal.deal_data || {};
    var st = strategyOf(deal);
    var v = verdictOf(deal);
    var level = v ? v.level : 'none';
    var dotTitle = v ? v.label + (v.basis ? ' (' + v.basis + ')' : '') + ': ' + v.reason : 'No verdict for this deal yet. Re-run it in the calculator.';
    var figs = cardFigures(deal).map(function (f) {
      return '<span class="dc-fig"><span class="dc-fig-l">' + esc(f.l) + '</span><span class="dc-fig-v">' + esc(f.v) + '</span></span>';
    }).join('');
    var lost = deal.pipeline_stage === 'lost' && deal.lost_reason ? ' · ' + esc(LOST_REASONS[deal.lost_reason] || deal.lost_reason) : '';
    var stagePill = opts.showStage
      ? '<span class="dc-stage"><span class="dc-stage-dot" style="background:' + (STAGE_COLORS[deal.pipeline_stage] || 'var(--hairline-strong)') + '"></span>' + esc(stageLabel(deal)) + lost + '</span>'
      : (lost ? '<span class="dc-stage">' + lost.slice(3) + '</span>' : '');
    return '<div class="dc-head">' +
        '<span class="dc-dot dc-' + level + '" title="' + esc(dotTitle) + '" aria-label="' + esc(v ? v.label : 'No verdict') + '" role="img"></span>' +
        '<span class="dc-name">' + esc(nameOf(deal)) + '</span>' +
      '</div>' +
      '<p class="dc-sub">' + esc(STRATEGY_LABELS[st] || String(st).toUpperCase()) + (d.pp ? ' · ' + esc(money(d.pp)) : '') +
        (v ? ' · <span class="dc-verdict dc-' + level + '-t">' + esc(v.label) + '</span>' : '') + '</p>' +
      '<div class="dc-figs">' + figs + '</div>' +
      '<div class="dc-foot">' + stagePill + buyBoxBadge(deal) + '<span class="dc-days">' + esc(daysText(deal)) + '</span></div>';
  }

  // ---------- buy box ----------
  var buyBox = null;
  function bbTools() { return window.PlanningTools ? window.PlanningTools.buyBox : null; }
  function hasBuyBox() { var B = bbTools(); return !!(B && buyBox && B.isSet(buyBox)); }
  function buyBoxResult(deal) { return hasBuyBox() ? bbTools().score(deal, buyBox) : null; }
  function buyBoxBadge(deal) { var r = buyBoxResult(deal); return r ? bbTools().badgeHtml(r) : ''; }
  // Reads the box from the profile nav.js already loaded, then re-renders.
  function initBuyBox(rerender) {
    if (!bbTools() || !window.NavAccount) return;
    window.NavAccount.ready.then(function (nav) {
      var b = nav && nav.profile ? nav.profile.buy_box : null;
      if (!b || !bbTools().isSet(b)) { buyBox = null; return; }
      buyBox = b;
      if (typeof rerender === 'function') rerender();
    });
  }

  // ---------- filters and sort ----------
  var FILTER_KEY = 'dny-deals-filters';
  var DEFAULTS = { stage: 'all', strategy: 'all', verdict: 'all', buybox: 'all', sort: 'newest' };
  var state = (function () {
    try { var s = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null'); if (s && typeof s === 'object') return Object.assign({}, DEFAULTS, s); } catch (e) {}
    return Object.assign({}, DEFAULTS);
  })();
  var onChange = null;
  // ?buybox=fits (the Buy box page's "See deals that fit") turns the filter on.
  try {
    var bbParam = new URLSearchParams(location.search).get('buybox');
    if (bbParam === 'fits' || bbParam === 'misses') state.buybox = bbParam;
  } catch (e) {}

  var FILTER_OPTIONS = {
    stage: [['all', 'All stages'], ['saved', 'Saved (not in pipeline)']].concat(STAGES.map(function (s) { return [s, STAGE_LABELS[s]]; })),
    strategy: [['all', 'All strategies'], ['btl', 'BTL'], ['brrr', 'BRRR'], ['hmo', 'HMO'], ['sa', 'SA'], ['flip', 'Flip']],
    verdict: [['all', 'All verdicts'], ['good', 'Strong deal'], ['warn', 'Marginal'], ['bad', "Doesn't stack"], ['none', 'No verdict']],
    buybox: [['all', 'All deals'], ['fits', 'Fits my buy box'], ['misses', "Doesn't fit"]],
    sort: [['newest', 'Newest added'], ['oldest', 'Oldest added'], ['stage-long', 'Longest in stage']]
  };

  function optLabel(key, val) {
    var o = FILTER_OPTIONS[key].filter(function (x) { return x[0] === val; })[0];
    return o ? o[1] : FILTER_OPTIONS[key][0][1];
  }

  function ddHtml(key, label) {
    var id = 'dc-filter-' + key;
    var cur = state[key];
    var opts = FILTER_OPTIONS[key].map(function (o) {
      var sel = o[0] === cur;
      return '<li class="dd-opt' + (sel ? ' selected' : '') + '" role="option" aria-selected="' + sel + '" data-value="' + esc(o[0]) + '" onclick="selectDDOption(event,\'' + id + '\',\'' + esc(o[0]) + '\',\'' + esc(o[1]).replace(/'/g, '\\\'') + '\')">' + esc(o[1]) + '</li>';
    }).join('');
    return '<div class="dc-filter"><span class="dc-filter-l" id="' + id + '-label">' + esc(label) + '</span>' +
      '<div class="dd" id="' + id + '" data-value="' + esc(cur) + '" data-onchange="dealCardsFilterChanged">' +
        '<button type="button" class="dd-trigger" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="' + id + '-label" onclick="toggleDD(event,\'' + id + '\')" onkeydown="ddKeydown(event,\'' + id + '\')"><span>' + esc(optLabel(key, cur)) + '</span></button>' +
        '<ul class="dd-list" role="listbox">' + opts + '</ul>' +
      '</div></div>';
  }

  // opts.stage: show the stage filter. opts.onChange: called after any change.
  function renderToolbar(el, opts) {
    if (!el) return;
    opts = opts || {};
    onChange = opts.onChange || null;
    var showStage = opts.stage !== false;
    el.innerHTML = (showStage ? ddHtml('stage', 'Stage') : '') + ddHtml('strategy', 'Strategy') + ddHtml('verdict', 'Verdict') + (hasBuyBox() ? ddHtml('buybox', 'Buy box') : '') + ddHtml('sort', 'Sort') +
      '<button type="button" class="dc-clear" id="dc-filter-clear"' + (isFiltered(showStage) ? '' : ' hidden') + '>Clear filters</button>';
    var clear = document.getElementById('dc-filter-clear');
    if (clear) clear.onclick = function () {
      state = Object.assign({}, DEFAULTS, { sort: state.sort });
      save();
      renderToolbar(el, opts);
      if (onChange) onChange(state);
    };
    el._dcOpts = opts;
    el._dcEl = el;
    toolbarEl = el;
  }
  var toolbarEl = null;

  function isFiltered(showStage) {
    return (showStage !== false && state.stage !== 'all') || state.strategy !== 'all' || state.verdict !== 'all' || (hasBuyBox() && state.buybox !== 'all');
  }
  function save() { try { localStorage.setItem(FILTER_KEY, JSON.stringify(state)); } catch (e) {} }

  window.dealCardsFilterChanged = function (id, value) {
    var key = id.replace('dc-filter-', '');
    if (!(key in state)) return;
    state[key] = value;
    save();
    if (toolbarEl) renderToolbar(toolbarEl, toolbarEl._dcOpts);
    if (onChange) onChange(state);
  };

  function matches(deal, ignoreStage) {
    if (!ignoreStage && state.stage !== 'all') {
      if (state.stage === 'saved' ? !!deal.pipeline_stage : deal.pipeline_stage !== state.stage) return false;
    }
    if (state.strategy !== 'all' && strategyOf(deal) !== state.strategy) return false;
    if (state.verdict !== 'all' && verdictKey(deal) !== state.verdict) return false;
    if (state.buybox !== 'all' && hasBuyBox()) {
      var fits = buyBoxResult(deal).fits;
      if (state.buybox === 'fits' ? !fits : fits) return false;
    }
    return true;
  }

  function sortDeals(list) {
    var by = state.sort;
    var out = list.slice();
    out.sort(function (a, b) {
      if (by === 'stage-long') return (stageSince(a) || 0) - (stageSince(b) || 0);
      var ta = Date.parse(a.created_at) || 0, tb = Date.parse(b.created_at) || 0;
      return by === 'oldest' ? ta - tb : tb - ta;
    });
    return out;
  }

  // opts.ignoreStage: the Board applies the stage filter by hiding columns.
  function apply(deals, opts) {
    opts = opts || {};
    return sortDeals((deals || []).filter(function (d) { return matches(d, !!opts.ignoreStage); }));
  }

  // ---------- stats card ----------
  function isActive(deal) { return !!deal.pipeline_stage && deal.pipeline_stage !== 'completed' && deal.pipeline_stage !== 'lost'; }

  function infoTip(id, text) {
    return '<span class="dc-tip"><button type="button" class="dc-tip-btn" aria-label="What does this mean?" aria-describedby="' + id + '" aria-expanded="false">i</button>' +
      '<span class="dc-tip-text" role="tooltip" id="' + id + '">' + esc(text) + '</span></span>';
  }

  // deals: every deal the page has. stats: GET /api/deals-stats body, or
  // null if it hasn't loaded / failed.
  function renderStats(el, deals, stats) {
    if (!el) return;
    var active = (deals || []).filter(isActive);
    var value = active.reduce(function (s, d) { return s + (d.deal_data && d.deal_data.pp ? Number(d.deal_data.pp) : 0); }, 0);
    var f = stats && stats.funnel;
    var conv = f
      ? '<span class="dc-funnel">' + f.viewed + '<span class="dc-arrow" aria-hidden="true">→</span>' + f.offered + '<span class="dc-arrow" aria-hidden="true">→</span>' + f.agreed + '</span>'
      : '-';
    var convSub = f
      ? 'viewed → offered → agreed' + (f.viewed > 0 ? ' · ' + Math.round(f.offered / f.viewed * 100) + '% then ' + (f.offered > 0 ? Math.round(f.agreed / f.offered * 100) : 0) + '%' : '')
      : 'viewed → offered → agreed';
    var disc = stats && stats.avg_discount_pct != null ? (Math.round(stats.avg_discount_pct * 10) / 10).toFixed(1) + '%' : '-';
    var discSub = stats && stats.avg_discount_count ? 'across ' + stats.avg_discount_count + ' agreed deal' + (stats.avg_discount_count === 1 ? '' : 's') : 'no agreed deals with an accepted offer yet';
    el.innerHTML =
      '<div class="dc-stats-main"><p class="hero-label">Active deals</p><p class="hero-number">' + active.length + '</p></div>' +
      '<div class="hero-figures">' +
        '<div class="hero-fig"><span class="hero-fig-label">Value in play ' + infoTip('dc-tip-value', 'The total purchase price of your active deals: everything in the pipeline that is not Completed or Lost.') + '</span><span class="hero-fig-value">' + esc(money(value)) + '</span></div>' +
        '<div class="hero-fig"><span class="hero-fig-label">Offers made this month</span><span class="hero-fig-value">' + (stats ? stats.offers_this_month : '-') + '</span></div>' +
        '<div class="hero-fig"><span class="hero-fig-label">Conversion ' + infoTip('dc-tip-conv', 'How many of your deals reached each stage: viewed, then offered, then agreed. The percentages show how many viewed deals got an offer, and how many offers were agreed.') + '</span><span class="hero-fig-value">' + conv + '</span><span class="hero-fig-sub">' + esc(convSub) + '</span></div>' +
        '<div class="hero-fig"><span class="hero-fig-label">Avg discount off asking ' + infoTip('dc-tip-disc', 'For deals at Agreed or Completed with an accepted offer: how far below the purchase price you analysed the accepted offer was, on average.') + '</span><span class="hero-fig-value">' + disc + '</span><span class="hero-fig-sub">' + esc(discSub) + '</span></div>' +
      '</div>';
    wireTips(el);
  }

  function wireTips(root) {
    root.querySelectorAll('.dc-tip-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = btn.getAttribute('aria-expanded') === 'true';
        document.querySelectorAll('.dc-tip-btn[aria-expanded="true"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      });
    });
  }
  document.addEventListener('click', function () {
    document.querySelectorAll('.dc-tip-btn[aria-expanded="true"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') document.querySelectorAll('.dc-tip-btn[aria-expanded="true"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
  });

  async function loadStats(token) {
    try {
      var res = await fetch(API_BASE + '/api/deals-stats', { headers: { 'Authorization': 'Bearer ' + token } });
      var body = await res.json();
      return res.ok ? body : null;
    } catch (e) { return null; }
  }

  // ---------- styles ----------
  var css =
    '.dc-head{display:flex;align-items:flex-start;gap:8px;min-width:0}' +
    '.dc-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;margin-top:5px;background:var(--hairline-strong)}' +
    '.dc-dot.dc-good{background:var(--success)}.dc-dot.dc-warn{background:var(--warn)}.dc-dot.dc-bad{background:var(--danger)}' +
    '.dc-name{font-size:14px;font-weight:700;color:var(--ink);font-family:var(--font-body);min-width:0;overflow-wrap:anywhere}' +
    '.dc-sub{font-size:12px;color:var(--muted);margin:3px 0 0;font-variant-numeric:tabular-nums}' +
    '.dc-verdict{font-weight:600}.dc-good-t{color:var(--success-ink)}.dc-warn-t{color:var(--warn-ink)}.dc-bad-t{color:var(--danger-ink)}' +
    '.dc-figs{display:flex;flex-wrap:wrap;gap:6px 14px;margin:8px 0 0}' +
    '.dc-fig{display:flex;flex-direction:column;min-width:0}' +
    '.dc-fig-l{font-size:10.5px;color:var(--muted);letter-spacing:.02em}' +
    '.dc-fig-v{font-size:13px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}' +
    '.dc-foot{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:8px}' +
    '.dc-stage{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:var(--accent);background:rgba(75,69,178,.10);border:1px solid rgba(75,69,178,.18);border-radius:999px;padding:3px 10px;white-space:nowrap}' +
    '.dc-stage-dot{width:7px;height:7px;border-radius:50%}' +
    '.dc-days{font-size:11.5px;color:var(--muted)}' +
    '.dc-toolbar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px 12px;margin:0 0 var(--space-4)}' +
    '.dc-filter{display:flex;flex-direction:column;gap:3px;min-width:140px;flex:1 1 140px;max-width:220px}' +
    '.dc-filter-l{font-size:11px;font-weight:600;color:var(--muted);letter-spacing:.02em}' +
    '.dc-filter .dd-trigger{padding-top:7px;padding-bottom:7px;font-size:13px}' +
    '.dc-clear{font-family:var(--font-body);font-size:12px;font-weight:600;color:var(--accent);background:none;border:none;cursor:pointer;padding:8px 4px;white-space:nowrap}' +
    '.dc-clear:hover{text-decoration:underline}' +
    '@media(max-width:520px){.dc-filter{flex:1 1 calc(50% - 6px);max-width:none;min-width:0}}' +
    '.dc-stats .hero-figures{gap:var(--space-5) var(--space-6)}' +
    '.dc-stats .hero-fig{min-width:120px}' +
    '.dc-stats .hero-fig-sub{font-size:11px;color:rgba(255,255,255,.65);margin-top:2px}' +
    '.dc-funnel{display:inline-flex;align-items:center;gap:6px}.dc-arrow{font-size:13px;opacity:.7}' +
    '.dc-tip{position:relative;display:inline-block;vertical-align:middle}' +
    '.dc-tip-btn{width:16px;height:16px;border-radius:50%;border:1px solid rgba(255,255,255,.55);background:transparent;color:inherit;font:600 10px/14px var(--font-body);cursor:pointer;padding:0;text-align:center}' +
    '.dc-tip-text{display:none;position:absolute;left:50%;top:calc(100% + 6px);transform:translateX(-50%);width:min(240px,70vw);background:var(--surface);color:var(--ink);border:1px solid var(--hairline);border-radius:10px;padding:8px 10px;font-size:12px;line-height:1.45;font-weight:400;letter-spacing:0;text-transform:none;box-shadow:0 8px 24px rgba(0,0,0,.15);z-index:50}' +
    '.dc-tip-btn[aria-expanded="true"]+.dc-tip-text,.dc-tip-btn:focus-visible+.dc-tip-text{display:block}' +
    '@media(hover:hover){.dc-tip:hover .dc-tip-text{display:block}}' +
    '@media(max-width:520px){.dc-stats .hero-fig{min-width:calc(50% - var(--space-5))}.dc-tip-text{left:0;transform:none}}';
  var style = document.createElement('style');
  style.id = 'deal-cards-styles';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  return {
    STAGES: STAGES, STAGE_LABELS: STAGE_LABELS, STAGE_COLORS: STAGE_COLORS, LOST_REASONS: LOST_REASONS, STRATEGY_LABELS: STRATEGY_LABELS,
    verdictOf: verdictOf, cardBody: cardBody, daysInStage: daysInStage,
    initBuyBox: initBuyBox, buyBoxResult: buyBoxResult, getBuyBox: function () { return buyBox; },
    renderToolbar: renderToolbar, apply: apply, filters: function () { return Object.assign({}, state); },
    isFiltered: function () { return isFiltered(true); },
    renderStats: renderStats, loadStats: loadStats, isActive: isActive, esc: esc
  };
})();
