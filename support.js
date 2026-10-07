// support.js — the "Contact us" / bug report modal, shared by every
// logged-in page. Loaded by nav.js itself (not by a per-page <script> tag),
// so it is present on exactly the pages that render the "Contact us" nav
// link, no more and no fewer.
//
// Self-contained: injects its own modal markup into <body> on first open and
// builds its own Supabase client from /api/config (same pattern as
// auth-guard.js) to read the current session, so no page's own sbClient/
// session variables are touched or depended on. Uses .support-* class names
// (styles.css) rather than each page's own page-local .modal-overlay rules,
// since not every page defines those.
//
// Write path is browser -> server -> Supabase (POST /api/support-requests),
// same as every other write in the app. The email shown here is display
// only; the server takes it from the verified session, not from this form.

(function(){
  var SUPPORT_MAX_BYTES = 5 * 1024 * 1024;
  var SUPPORT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  var supportClientPromise = null;

  function getSupportClient(){
    if (!supportClientPromise) {
      supportClientPromise = fetch('/api/config')
        .then(function(r){ return r.json(); })
        .then(function(cfg){ return supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey); })
        .catch(function(err){
          // Don't cache a failure, or one bad fetch would break the modal for
          // the rest of the page's life (same fix as the Nomis cache bug).
          supportClientPromise = null;
          throw err;
        });
    }
    return supportClientPromise;
  }

  function getSession(){
    return getSupportClient().then(function(client){
      return client.auth.getSession().then(function(res){ return res.data.session; });
    });
  }

  function ensureMarkup(){
    if (document.getElementById('support-overlay')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="support-overlay" id="support-overlay" role="dialog" aria-modal="true" aria-labelledby="support-title">' +
        '<div class="card support-card">' +
          '<div class="support-header">' +
            '<h2 id="support-title">Contact us</h2>' +
            '<button type="button" class="support-close" id="support-close" aria-label="Close">×</button>' +
          '</div>' +
          '<form id="support-form" novalidate>' +
            '<p class="support-hint">Report a bug, ask a question or share an idea. We read every message.</p>' +
            '<div class="field"><label for="support-category">Category</label>' +
              '<select id="support-category">' +
                '<option value="Bug">Bug</option>' +
                '<option value="Question">Question</option>' +
                '<option value="Feature idea">Feature idea</option>' +
                '<option value="Billing">Billing</option>' +
              '</select>' +
            '</div>' +
            '<div class="field"><label for="support-trying">What were you trying to do?</label>' +
              '<textarea id="support-trying" rows="3" maxlength="5000"></textarea></div>' +
            '<div class="field"><label for="support-happened">What happened instead?</label>' +
              '<textarea id="support-happened" rows="3" maxlength="5000"></textarea></div>' +
            '<div class="field"><label for="support-screenshot">Screenshot (optional)</label>' +
              '<input type="file" id="support-screenshot" accept="image/png,image/jpeg,image/webp,image/gif"/>' +
              '<span class="support-small">PNG, JPG, WEBP or GIF, up to 5MB.</span></div>' +
            '<div class="support-meta">' +
              '<div><span class="support-meta-label">Your email</span><span id="support-email">Loading…</span></div>' +
              '<div><span class="support-meta-label">Page</span><span id="support-page"></span></div>' +
            '</div>' +
            '<p class="support-msg" id="support-msg"></p>' +
            '<div class="support-actions">' +
              '<button type="submit" class="btn-primary" id="support-submit">Send</button>' +
            '</div>' +
          '</form>' +
          '<div id="support-done" hidden>' +
            '<p class="support-success">Thanks, we\'ll reply within 2 working days.</p>' +
            '<div class="support-actions"><button type="button" class="btn-primary" id="support-done-close">Close</button></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);

    var overlay = document.getElementById('support-overlay');
    overlay.addEventListener('click', function(e){ if (e.target === overlay) closeSupportModal(); });
    document.getElementById('support-close').addEventListener('click', closeSupportModal);
    document.getElementById('support-done-close').addEventListener('click', closeSupportModal);
    document.getElementById('support-form').addEventListener('submit', submitSupportRequest);
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeSupportModal();
    });
  }

  // Origin + path + query only. The hash is dropped on purpose: Supabase's
  // auth flows put access tokens in the URL hash, and those must never end
  // up stored in a support ticket.
  function currentPageUrl(){
    return window.location.origin + window.location.pathname + window.location.search;
  }

  function setMsg(text, isError){
    var el = document.getElementById('support-msg');
    el.textContent = text || '';
    el.className = 'support-msg' + (isError ? ' error' : '');
  }

  function openSupportModal(e){
    if (e) e.preventDefault();
    if (typeof closeUserMenu === 'function') closeUserMenu();
    ensureMarkup();

    document.getElementById('support-form').reset();
    document.getElementById('support-form').hidden = false;
    document.getElementById('support-done').hidden = true;
    document.getElementById('support-submit').disabled = false;
    document.getElementById('support-submit').textContent = 'Send';
    setMsg('');
    document.getElementById('support-page').textContent = currentPageUrl();
    document.getElementById('support-email').textContent = 'Loading…';

    document.getElementById('support-overlay').classList.add('open');
    document.getElementById('support-trying').focus();

    getSession().then(function(session){
      document.getElementById('support-email').textContent =
        session && session.user ? session.user.email : 'Not logged in';
    }).catch(function(){
      document.getElementById('support-email').textContent = 'Unavailable';
    });
  }

  function closeSupportModal(){
    var overlay = document.getElementById('support-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  function readFileAsBase64(file){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(){
        // reader.result is "data:<type>;base64,<data>"; send only the data.
        var result = String(reader.result);
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = function(){ reject(reader.error); };
      reader.readAsDataURL(file);
    });
  }

  async function submitSupportRequest(e){
    e.preventDefault();
    setMsg('');

    var category = document.getElementById('support-category').value;
    var trying = document.getElementById('support-trying').value.trim();
    var happened = document.getElementById('support-happened').value.trim();
    var fileInput = document.getElementById('support-screenshot');
    var file = fileInput.files && fileInput.files[0];

    if (!trying) { setMsg('Tell us what you were trying to do.', true); return; }
    if (!happened) { setMsg('Tell us what happened instead.', true); return; }
    if (file && SUPPORT_TYPES.indexOf(file.type) === -1) { setMsg('Screenshots must be PNG, JPG, WEBP or GIF.', true); return; }
    if (file && file.size > SUPPORT_MAX_BYTES) { setMsg('Screenshots must be under 5MB.', true); return; }

    var btn = document.getElementById('support-submit');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      var session = await getSession();
      if (!session) { setMsg('Your session has expired. Log in again to contact us.', true); return; }

      var payload = {
        category: category,
        trying_to_do: trying,
        what_happened: happened,
        page_url: currentPageUrl()
      };
      if (file) payload.screenshot = { type: file.type, data: await readFileAsBase64(file) };

      var res = await fetch('/api/support-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
        body: JSON.stringify(payload)
      });
      var data = await res.json().catch(function(){ return {}; });
      if (!res.ok) { setMsg(data.error || 'Your message could not be sent. Please try again.', true); return; }

      document.getElementById('support-form').hidden = true;
      document.getElementById('support-done').hidden = false;
      document.getElementById('support-done-close').focus();
    } catch (err) {
      setMsg('Your message could not be sent. Check your connection and try again.', true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send';
    }
  }

  window.openSupportModal = openSupportModal;
  window.closeSupportModal = closeSupportModal;
})();
