// Service worker: makes the app installable and gives a friendly offline page.
//
// Caching rules:
// - NEVER cached: anything under /api/ (our Express backend), any request that
//   isn't a GET, and any request to another domain except Google Fonts. That
//   covers Supabase, Stripe and the CDN scripts: the service worker doesn't
//   touch those at all, so they always go straight to the network.
// - Pages, JS and CSS: network first, so every deploy shows up straight away.
//   The cached copy is only used when the network fails (offline).
// - Fonts and icons: cache first. They rarely change.
// - A navigation that fails with nothing cached shows /offline.html.
//
// Bump CACHE_VERSION to throw away every old cache on the next visit.
const CACHE_VERSION = 'v1';
const SHELL_CACHE = 'propulsion-shell-' + CACHE_VERSION;
const STATIC_CACHE = 'propulsion-static-' + CACHE_VERSION;
const OFFLINE_URL = '/offline.html';

const PRECACHE = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/apple-touch-icon.png',
  '/assets/favicon-32x32.png',
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('propulsion-') && k !== SHELL_CACHE && k !== STATIC_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isCacheFirst(url) {
  if (FONT_HOSTS.includes(url.hostname)) return true;
  return url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/'));
}

function isShellFile(url) {
  return url.origin === self.location.origin &&
    /\.(html|js|css|webmanifest)$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // NetworkOnly: the backend API and every other domain (Supabase, Stripe,
  // CDNs). Returning without respondWith() leaves the request to the browser.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin && !FONT_HOSTS.includes(url.hostname)) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, SHELL_CACHE, true));
  } else if (isCacheFirst(url)) {
    event.respondWith(cacheFirst(req));
  } else if (isShellFile(url)) {
    event.respondWith(networkFirst(req, SHELL_CACHE, false));
  }
  // Anything else same-origin: not intercepted.
});

async function networkFirst(req, cacheName, isNavigation) {
  try {
    const res = await fetch(req);
    // Only keep clean same-origin successes (never redirects or errors).
    if (res.ok && res.type === 'basic' && !res.redirected) {
      const copy = res.clone();
      caches.open(cacheName).then((c) => c.put(req, copy));
    }
    return res;
  } catch (err) {
    const cached = await caches.match(req, { ignoreSearch: isNavigation });
    if (cached) return cached;
    if (isNavigation) {
      const offline = await caches.match(OFFLINE_URL);
      if (offline) return offline;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    const copy = res.clone();
    caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
  }
  return res;
}
