// draft-state.js — per-browser draft persistence for in-progress work, so an
// accidental page refresh doesn't wipe unsaved input. Never synced to an
// account, never a substitute for a real save (Saved Deals, saved refurb
// estimates, etc). Every entry point below is wrapped so a broken/old/
// foreign value in localStorage degrades to "no draft" rather than throwing
// into the caller — each page's own restore code is expected to add its own
// field-by-field defensiveness on top of this for the same reason.
const DRAFT_VERSION = 1;

function saveDraft(key, data) {
  try {
    localStorage.setItem('dny-draft-' + key, JSON.stringify({ v: DRAFT_VERSION, t: Date.now(), data }));
  } catch (e) {
    // storage full/unavailable (private browsing etc) — just skip persisting this change
  }
}

function loadDraft(key) {
  try {
    const raw = localStorage.getItem('dny-draft-' + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== DRAFT_VERSION || typeof parsed.data !== 'object' || parsed.data === null) return null;
    return parsed.data;
  } catch (e) {
    return null; // malformed JSON, wrong shape, whatever — load blank, never throw
  }
}

function clearDraft(key) {
  try { localStorage.removeItem('dny-draft-' + key); } catch (e) { /* nothing to do */ }
}

// Scroll-position persistence — a separate, plain-number key (not part of
// the versioned draft JSON above), so a future change to a page's draft
// shape can never affect this, and vice versa.
function saveScrollPosition(key) {
  try {
    localStorage.setItem('dny-scroll-' + key, String(Math.round(window.scrollY)));
  } catch (e) {
    // storage full/unavailable — just skip persisting this change
  }
}

// Callers must only call this once the page's draft content is already
// restored and rendered — restoring scroll against pre-restore layout
// would scroll to a position the real (restored) content hasn't reached
// yet.
function restoreScrollPosition(key) {
  try {
    const raw = localStorage.getItem('dny-scroll-' + key);
    if (raw == null) return;
    const y = parseInt(raw, 10);
    if (!Number.isFinite(y) || y < 0) return;
    window.scrollTo(0, y);
  } catch (e) {
    // malformed value or unavailable — just leave the page at the top
  }
}

function clearScrollPosition(key) {
  try { localStorage.removeItem('dny-scroll-' + key); } catch (e) { /* nothing to do */ }
}

// Wires a window-scroll listener that keeps the saved position for `key`
// up to date, throttled to at most once per animation frame (scroll fires
// far more often than that — no reason to hit localStorage on every tick).
// Call this once per page, and only AFTER that page's own initial
// restoreScrollPosition() call — attaching it any earlier risks a scroll
// event fired during initial layout (e.g. the browser auto-scrolling to a
// focused element) overwriting the just-restored position with a stale
// value before the user has scrolled at all.
function attachScrollSaver(key) {
  let ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      saveScrollPosition(key);
      ticking = false;
    });
  }, { passive: true });
}
