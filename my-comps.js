// Your own comparables, alongside ours.
//
// Used by the calculator's Comps tab (index.html) and the Comps dropdown on
// the deal page (saved-deals.html). The user can:
//   - see every sale our comps engine found (in a closed dropdown),
//   - remove any of ours (e.g. wrong condition), with Undo,
//   - add their own (sold, sold STC, for sale), with an optional link/note.
// Our figures are never changed. When the user has removed or added any,
// a second "Your comps" figure appears, worked out the same way ours are
// (median, and median price per sqm, using get-comps.js's percentile).
//
// State shape, saved on the deal as deals.user_comps (db/061):
//   { excluded: [key, ...], added: [{ id, address, price, status, date, beds, sqm, link, note }] }
(function () {
  var STATUSES = [['sold', 'Sold'], ['stc', 'Sold STC'], ['for-sale', 'For sale']];
  var STATUS_LABEL = { sold: 'Sold', stc: 'Sold STC', 'for-sale': 'For sale' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function gbp(n) { return '£' + Math.round(n).toLocaleString('en-GB'); }
  function fmtDate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
    var p = iso.slice(0, 10).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  }
  function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // A stable key for one of our sales, so a removal survives a reload.
  function key(c) { return [c.address || '', c.date || '', c.price || ''].join('|').slice(0, 300); }

  function normalise(s) {
    s = s && typeof s === 'object' ? s : {};
    return {
      excluded: Array.isArray(s.excluded) ? s.excluded.filter(function (k) { return typeof k === 'string'; }) : [],
      added: Array.isArray(s.added) ? s.added.filter(function (a) { return a && Number(a.price) > 0; }) : []
    };
  }
  function changed(s) { s = normalise(s); return s.excluded.length > 0 || s.added.length > 0; }

  // Same percentile maths as get-comps.js (linear between the two nearest).
  function percentile(sorted, p) {
    var n = sorted.length; if (!n) return null; if (n === 1) return sorted[0];
    var idx = p * (n - 1), lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  // "Your comps": our sales minus the removed ones, plus the user's own.
  function stats(ourComps, state) {
    state = normalise(state);
    var out = new Set(state.excluded);
    var kept = (ourComps || []).filter(function (c) { return !out.has(key(c)); });
    var prices = kept.map(function (c) { return Number(c.price); })
      .concat(state.added.map(function (a) { return Number(a.price); }))
      .filter(function (n) { return n > 0; }).sort(function (a, b) { return a - b; });
    var psqm = kept.filter(function (c) { return c.floorAreaMatched && c.pricePerSqM > 0; }).map(function (c) { return c.pricePerSqM; })
      .concat(state.added.filter(function (a) { return Number(a.sqm) > 0; }).map(function (a) { return Number(a.price) / Number(a.sqm); }))
      .sort(function (a, b) { return a - b; });
    return {
      count: prices.length, kept: kept.length, removed: (ourComps || []).length - kept.length, added: state.added.length,
      median: percentile(prices, 0.5), psqm: percentile(psqm, 0.5), psqmCount: psqm.length
    };
  }

  // Renders the whole block into el. opts:
  //   comps     our sales (array, may be empty)
  //   state     the saved state
  //   editable  false shows the list only
  //   onChange(state)  called after every change
  //   onUse(median)    optional: shows a "Use" button on the Your comps figure
  //   useLabel         text for that button
  function render(el, opts) {
    if (!el) return;
    var comps = opts.comps || [];
    var state = normalise(opts.state);
    var editable = opts.editable !== false;
    var out = new Set(state.excluded);
    var adding = el._adding || false;
    var openList = el._openList != null ? el._openList : false;
    var st = stats(comps, state);

    var summary = '';
    if (changed(state) && st.count) {
      var parts = [];
      if (st.removed) parts.push(st.removed + ' of ours removed');
      if (st.added) parts.push(st.added + ' of yours added');
      summary = '<div class="mc-yours">' +
        '<div class="mc-yours-top"><span class="mc-tag">Your comps</span><span class="mc-yours-n">' + st.count + ' sale' + (st.count === 1 ? '' : 's') + '</span></div>' +
        '<p class="mc-yours-v">' + gbp(st.median) + '</p>' +
        '<p class="mc-yours-s">Median price' + (st.psqm ? ' · ' + gbp(st.psqm) + ' per sqm' : '') + ' · ' + parts.join(', ') + '</p>' +
        (opts.onUse ? '<button type="button" class="mc-use" data-mc="use">' + esc(opts.useLabel || 'Use as end value') + '</button>' : '') +
        '</div>';
    }

    var rows = comps.map(function (c) {
      var k = key(c), gone = out.has(k);
      var meta = [fmtDate(c.date), c.floorAreaMatched && c.floorAreaSqM ? Math.round(c.floorAreaSqM) + ' sqm' : '', c.floorAreaMatched && c.pricePerSqM ? gbp(c.pricePerSqM) + '/sqm' : '',
        c.distanceMiles != null ? (Math.round(c.distanceMiles * 10) / 10) + ' mi' : ''].filter(Boolean).join(' · ');
      return '<li class="mc-row' + (gone ? ' mc-gone' : '') + '">' +
        '<div class="mc-main"><span class="mc-addr">' + esc(c.address || 'Sale') + '</span><span class="mc-meta">' + esc(meta) + '</span></div>' +
        '<span class="mc-price">' + gbp(c.price) + '</span>' +
        (editable ? (gone
          ? '<button type="button" class="mc-x mc-undo" data-mc="undo" data-k="' + esc(k) + '">Undo</button>'
          : '<button type="button" class="mc-x" data-mc="remove" data-k="' + esc(k) + '" aria-label="Remove ' + esc(c.address || 'this sale') + '">×</button>') : '') +
        '</li>';
    }).join('');
    var mine = state.added.map(function (a) {
      var meta = [STATUS_LABEL[a.status] || 'Sold', fmtDate(a.date), a.beds ? a.beds + ' bed' : '', a.sqm ? a.sqm + ' sqm' : '', a.sqm ? gbp(a.price / a.sqm) + '/sqm' : ''].filter(Boolean).join(' · ');
      var link = a.link && /^https?:\/\//i.test(a.link) ? ' <a class="mc-link" href="' + esc(a.link) + '" target="_blank" rel="noopener noreferrer">Listing ↗</a>' : '';
      return '<li class="mc-row mc-mine">' +
        '<div class="mc-main"><span class="mc-addr"><span class="mc-tag">Yours</span> ' + esc(a.address || 'Your comparable') + link + '</span><span class="mc-meta">' + esc(meta) + '</span>' +
        (a.note ? '<span class="mc-note">' + esc(a.note) + '</span>' : '') + '</div>' +
        '<span class="mc-price">' + gbp(a.price) + '</span>' +
        (editable ? '<button type="button" class="mc-x" data-mc="delete" data-id="' + esc(a.id) + '" aria-label="Delete ' + esc(a.address || 'your comparable') + '">×</button>' : '') +
        '</li>';
    }).join('');

    var total = comps.length + state.added.length;
    var listLabel = comps.length
      ? 'See the ' + comps.length + ' sale' + (comps.length === 1 ? '' : 's') + (state.added.length ? ' and ' + state.added.length + ' of yours' : '')
      : (state.added.length ? 'Your ' + state.added.length + ' comparable' + (state.added.length === 1 ? '' : 's') : '');
    var list = total ? '<details class="mc-list"' + (openList ? ' open' : '') + '><summary>' + esc(listLabel) + '</summary><ul>' + mine + rows + '</ul>' +
      (comps.length && editable ? '<p class="mc-hint">Remove any that aren\'t a fair match, for example a different condition. Our figures above stay as they are.</p>' : '') + '</details>' : '';

    var form = !editable ? '' : adding
      ? '<div class="mc-form">' +
          '<div class="mc-grid">' +
            '<label class="mc-f mc-wide">Address<input type="text" data-mcf="address" maxlength="200" placeholder="e.g. 22 Elm Road"/></label>' +
            '<label class="mc-f">Price (£)<input type="text" inputmode="decimal" data-mcf="price" placeholder="e.g. 185,000"/></label>' +
            '<label class="mc-f">Status<select data-mcf="status">' + STATUSES.map(function (s) { return '<option value="' + s[0] + '">' + s[1] + '</option>'; }).join('') + '</select></label>' +
            '<label class="mc-f">Date<input type="date" data-mcf="date"/></label>' +
            '<label class="mc-f">Bedrooms<input type="number" inputmode="numeric" min="0" max="50" data-mcf="beds"/></label>' +
            '<label class="mc-f">Floor area (sqm)<input type="number" inputmode="decimal" min="0" data-mcf="sqm"/></label>' +
            '<label class="mc-f mc-wide">Link (optional)<input type="url" data-mcf="link" placeholder="https://"/></label>' +
            '<label class="mc-f mc-wide">Note (optional)<input type="text" data-mcf="note" maxlength="300" placeholder="e.g. Fully refurbished, same street"/></label>' +
          '</div>' +
          '<p class="mc-err" data-mcf="err" hidden></p>' +
          '<div class="mc-actions"><button type="button" class="mc-save" data-mc="save">Add comparable</button><button type="button" class="mc-cancel" data-mc="cancel">Cancel</button></div>' +
        '</div>'
      : '<button type="button" class="mc-add" data-mc="add">+ Add a comparable</button>';

    el.innerHTML = summary + list + form;
    var det = el.querySelector('.mc-list');
    if (det) det.addEventListener('toggle', function () { el._openList = det.open; });
    if (adding) { var first = el.querySelector('[data-mcf="address"]'); if (first) first.focus(); }

    el.onclick = function (e) {
      var t = e.target.closest('[data-mc]'); if (!t) return;
      var act = t.dataset.mc, s = normalise(state);
      if (act === 'use') { if (opts.onUse && st.median) opts.onUse(Math.round(st.median)); return; }
      if (act === 'add') { el._adding = true; render(el, opts); return; }
      if (act === 'cancel') { el._adding = false; render(el, opts); return; }
      if (act === 'remove') { s.excluded.push(t.dataset.k); }
      else if (act === 'undo') { s.excluded = s.excluded.filter(function (k) { return k !== t.dataset.k; }); }
      else if (act === 'delete') { s.added = s.added.filter(function (a) { return a.id !== t.dataset.id; }); }
      else if (act === 'save') {
        var v = function (f) { var i = el.querySelector('[data-mcf="' + f + '"]'); return i ? i.value.trim() : ''; };
        var price = Number(v('price').replace(/[^0-9.]/g, ''));
        var err = el.querySelector('[data-mcf="err"]');
        if (!(price > 0)) { err.textContent = 'Enter a price.'; err.hidden = false; return; }
        var link = v('link');
        if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
        s.added.push({ id: uid(), address: v('address').slice(0, 200), price: Math.round(price), status: v('status') || 'sold',
          date: v('date') || null, beds: v('beds') ? Math.round(Number(v('beds'))) : null, sqm: v('sqm') ? Math.round(Number(v('sqm'))) : null,
          link: link.slice(0, 500) || null, note: v('note').slice(0, 300) || null });
        el._adding = false; el._openList = true;
      } else return;
      opts.state = s;
      render(el, opts);
      if (opts.onChange) opts.onChange(s);
    };
  }

  window.MyComps = { render: render, stats: stats, key: key, normalise: normalise, changed: changed };
})();
