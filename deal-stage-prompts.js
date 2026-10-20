// deal-stage-prompts.js: the short question asked when a deal moves stage,
// shared by the Board (pipeline.html) and the Deal page (saved-deals.html).
//
//   Viewing    viewing date             (POST /api/deals/:id/viewing-date)
//   Offered    offer amount and date    (POST /api/deals/:id/offers)
//   Agreed     solicitor, target completion date (POST /api/deals/:id/details)
//   Completed  offers "Move to portfolio" after the move
//   Lost       reason (required), optional note, sent with the stage change
//
// Every prompt except Lost can be skipped: the deal still moves. Closing a
// prompt (×, Escape, the backdrop) cancels the move.
//
// StagePrompts.ask(opts) resolves to null (cancelled) or to the extra body
// fields for POST /api/pipeline/:id/stage ({} or { lost_reason, lost_note }).
//   opts: { deal, toStage, token, name, container? }
// With opts.container (an element), the prompt renders inline inside it
// instead of as a popup, so it never stacks on top of another modal.

var StagePrompts = (function () {
  var LOST = [['outbid', 'Outbid'], ['survey', 'Survey issues'], ['numbers', "Numbers didn't stack"], ['vendor', 'Vendor pulled out'], ['other', 'Other']];

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function todayISO() { var n = new Date(); var p = function (x) { return (x < 10 ? '0' : '') + x; }; return n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate()); }
  function moneyNum(v) { var n = Number(String(v || '').replace(/[£,\s]/g, '')); return isFinite(n) && n > 0 ? n : null; }

  var overlay = null;
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'sp-overlay';
    overlay.innerHTML = '<div class="card sp-card" role="dialog" aria-modal="true" aria-labelledby="sp-title"></div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  async function post(url, token, body) {
    var res = await fetch(API_BASE + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) { var err = new Error(data.error || 'Could not save.'); err.status = res.status; err.body = data; throw err; }
    return data;
  }

  function formFor(stage, deal) {
    if (stage === 'viewing') {
      return { title: 'When is the viewing?', body:
        '<div class="field"><label for="sp-viewing-date">Viewing date</label><input type="date" id="sp-viewing-date" value="' + esc(deal.viewing_date || '') + '"/></div>',
        primary: 'Save and move', skip: 'Move without a date' };
    }
    if (stage === 'offered') {
      return { title: 'What did you offer?', body:
        '<div class="sp-row"><div class="field"><label for="sp-offer-amount">Offer amount (£)</label><input type="text" inputmode="decimal" id="sp-offer-amount" placeholder="e.g. 145,000"/></div>' +
        '<div class="field"><label for="sp-offer-date">Date</label><input type="date" id="sp-offer-date" value="' + todayISO() + '"/></div></div>' +
        '<p class="hint">Saved to this deal\'s offer history as Pending.</p>',
        primary: 'Save offer and move', skip: 'Move without an offer' };
    }
    if (stage === 'agreed') {
      return { title: 'Offer agreed', body:
        '<div class="field"><label for="sp-solicitor">Solicitor</label><input type="text" id="sp-solicitor" placeholder="Firm and contact name" value="' + esc(deal.solicitor || '') + '"/></div>' +
        '<div class="field"><label for="sp-completion">Target completion date</label><input type="date" id="sp-completion" value="' + esc(deal.target_completion_date || '') + '"/></div>',
        primary: 'Save and move', skip: 'Move without these' };
    }
    if (stage === 'lost') {
      return { title: 'Why was this deal lost?', body:
        '<div class="sp-reasons" role="radiogroup" aria-label="Reason">' + LOST.map(function (r) {
          return '<label class="sp-reason"><input type="radio" name="sp-lost" value="' + r[0] + '"' + (deal.lost_reason === r[0] ? ' checked' : '') + '/> ' + esc(r[1]) + '</label>';
        }).join('') + '</div>' +
        '<div class="field"><label for="sp-lost-note">Note (optional)</label><input type="text" id="sp-lost-note" maxlength="500" placeholder="Anything worth remembering" value="' + esc(deal.lost_note || '') + '"/></div>',
        primary: 'Mark as lost', skip: null };
    }
    return null;
  }

  // Saves the stage's extra details. Returns the extra stage-change body.
  async function saveFor(stage, deal, token) {
    if (stage === 'viewing') {
      var vd = document.getElementById('sp-viewing-date').value;
      if (!vd) throw new Error('Pick a date, or choose "Move without a date".');
      await post('/api/deals/' + deal.id + '/viewing-date', token, { viewing_date: vd });
      return {};
    }
    if (stage === 'offered') {
      var amt = moneyNum(document.getElementById('sp-offer-amount').value);
      var od = document.getElementById('sp-offer-date').value;
      if (!amt) throw new Error('Enter the offer amount, or choose "Move without an offer".');
      if (!od) throw new Error('Pick the date of the offer.');
      await post('/api/deals/' + deal.id + '/offers', token, { amount: amt, offer_date: od, outcome: 'Pending' });
      return {};
    }
    if (stage === 'agreed') {
      var sol = document.getElementById('sp-solicitor').value.trim();
      var cd = document.getElementById('sp-completion').value;
      if (!sol && !cd) return {};
      try {
        await post('/api/deals/' + deal.id + '/details', token, { solicitor: sol || null, target_completion_date: cd || null });
      } catch (e) {
        if (e.body && e.body.needs_migration) return { _note: 'The deal moved, but the solicitor and date need a quick database update before they can be saved.' };
        throw e;
      }
      return {};
    }
    if (stage === 'lost') {
      var pick = document.querySelector('input[name="sp-lost"]:checked');
      if (!pick) throw new Error('Choose a reason.');
      return { lost_reason: pick.value, lost_note: document.getElementById('sp-lost-note').value.trim() || null };
    }
    return {};
  }

  function ask(opts) {
    var stage = opts.toStage, deal = opts.deal;
    var form = formFor(stage, deal);
    if (!form) return Promise.resolve({});

    return new Promise(function (resolve) {
      var inline = !!opts.container;
      var host;
      if (inline) {
        host = opts.container;
        host.hidden = false;
      } else {
        ensureOverlay();
        host = overlay.querySelector('.sp-card');
      }
      host.innerHTML =
        '<div class="sp-head"><h2 id="sp-title">' + esc(form.title) + '</h2>' +
          '<button type="button" class="modal-close sp-close" aria-label="Cancel">×</button></div>' +
        (opts.name ? '<p class="sp-deal">' + esc(opts.name) + '</p>' : '') +
        form.body +
        '<p class="save-msg error sp-msg" role="alert"></p>' +
        '<div class="sp-actions">' +
          (form.skip ? '<button type="button" class="mini-btn sp-skip">' + esc(form.skip) + '</button>' : '') +
          '<button type="button" class="btn-primary sp-primary">' + esc(form.primary) + '</button>' +
        '</div>';
      var msg = host.querySelector('.sp-msg');
      var done = false;

      function finish(result) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        if (inline) { host.innerHTML = ''; host.hidden = true; }
        else { overlay.classList.remove('open'); host.innerHTML = ''; }
        resolve(result);
      }
      function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } }
      document.addEventListener('keydown', onKey, true);

      host.querySelector('.sp-close').onclick = function () { finish(null); };
      if (!inline) overlay.onclick = function (e) { if (e.target === overlay) finish(null); };
      var skip = host.querySelector('.sp-skip');
      if (skip) skip.onclick = function () { finish({}); };
      var primary = host.querySelector('.sp-primary');
      primary.onclick = async function () {
        msg.textContent = '';
        primary.disabled = true;
        try {
          var extra = await saveFor(stage, deal, opts.token);
          finish(extra);
        } catch (e) {
          msg.textContent = e.message;
          primary.disabled = false;
        }
      };
      if (!inline) overlay.classList.add('open');
      var first = host.querySelector('input');
      if (first) setTimeout(function () { try { first.focus(); } catch (e) {} }, 30);
    });
  }

  // After a deal reaches Completed: offer to move it to the portfolio.
  // onMove() is called if the user says yes.
  function offerPortfolio(opts) {
    return new Promise(function (resolve) {
      var inline = !!opts.container;
      var host = inline ? opts.container : (ensureOverlay(), overlay.querySelector('.sp-card'));
      if (inline) host.hidden = false;
      host.innerHTML =
        '<div class="sp-head"><h2 id="sp-title">Deal completed</h2><button type="button" class="modal-close sp-close" aria-label="Close">×</button></div>' +
        (opts.name ? '<p class="sp-deal">' + esc(opts.name) + '</p>' : '') +
        '<p class="sp-text">Congratulations. Add it to your portfolio to track its rent, cashflow and equity from here on.</p>' +
        '<div class="sp-actions"><button type="button" class="mini-btn sp-skip">Not now</button><button type="button" class="btn-primary sp-primary">Move to portfolio</button></div>';
      function close(yes) {
        if (inline) { host.innerHTML = ''; host.hidden = true; } else { overlay.classList.remove('open'); host.innerHTML = ''; }
        document.removeEventListener('keydown', onKey, true);
        resolve(yes);
        if (yes && opts.onMove) opts.onMove();
      }
      function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(false); } }
      document.addEventListener('keydown', onKey, true);
      host.querySelector('.sp-close').onclick = function () { close(false); };
      host.querySelector('.sp-skip').onclick = function () { close(false); };
      host.querySelector('.sp-primary').onclick = function () { close(true); };
      if (!inline) { overlay.onclick = function (e) { if (e.target === overlay) close(false); }; overlay.classList.add('open'); }
    });
  }

  var css =
    '.sp-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:450;align-items:center;justify-content:center;padding:1rem}' +
    '.sp-overlay.open{display:flex}' +
    '.sp-card{max-width:420px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.35)}' +
    '.sp-inline{background:var(--surface-2);border:1px solid var(--hairline);border-radius:var(--radius-sm);padding:1rem;margin:.75rem 0}' +
    '.sp-head{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:.5rem}' +
    '.sp-head h2{font-size:17px;margin:0}' +
    '.sp-deal{font-size:12.5px;color:var(--muted);margin:0 0 .85rem;overflow-wrap:anywhere}' +
    '.sp-text{font-size:13.5px;color:var(--ink);margin:0 0 1rem;line-height:1.5}' +
    '.sp-row{display:flex;gap:10px;flex-wrap:wrap}.sp-row .field{flex:1 1 140px}' +
    '.sp-reasons{display:flex;flex-direction:column;gap:6px;margin:0 0 .85rem}' +
    '.sp-reason{display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--ink);cursor:pointer;padding:6px 8px;border:1px solid var(--hairline);border-radius:var(--radius-sm);background:var(--surface)}' +
    '.sp-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-top:.5rem}' +
    '.sp-msg:empty{display:none}';
  var style = document.createElement('style');
  style.id = 'stage-prompts-styles';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  return { ask: ask, offerPortfolio: offerPortfolio, LOST_REASONS: LOST };
})();
