// Registers the service worker (sw.js) so the app can be installed to a phone's
// home screen. Loaded by every page. updateViaCache:'none' makes the browser
// always check the network for a new sw.js, so a deploy is picked up promptly.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(function (err) { console.warn('Service worker registration failed:', err); });
  });
}
