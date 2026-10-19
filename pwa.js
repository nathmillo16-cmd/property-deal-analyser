// Registers the service worker (sw.js) so the app can be installed to a phone's
// home screen. Loaded by every page. updateViaCache:'none' makes the browser
// always check the network for a new sw.js, so a deploy is picked up promptly.
// Skipped inside the iOS app: its files are already bundled on the device, and
// WKWebView doesn't support service workers on the capacitor:// scheme anyway.
if ('serviceWorker' in navigator && !(typeof IS_NATIVE_APP !== 'undefined' && IS_NATIVE_APP)) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(function (err) { console.warn('Service worker registration failed:', err); });
  });
}
