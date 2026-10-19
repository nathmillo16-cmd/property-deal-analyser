// The ONE place the backend's address lives. To switch domains (e.g. to
// https://propulsionproperty.co.uk), change BACKEND_URL below and rebuild the
// iOS app. Nothing else needs touching.
var BACKEND_URL = 'https://dealsnyields.com';

// Every page loads this file first, before any other script. On the website,
// API_BASE is '' so calls stay relative ('/api/...') and keep hitting whichever
// server served the page (live site, or localhost when developing). Inside the
// Capacitor iOS app the pages are bundled files served from capacitor://localhost,
// so a relative '/api/...' would go nowhere: there, API_BASE is BACKEND_URL.
var IS_NATIVE_APP = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
  || window.location.protocol === 'capacitor:';
var API_BASE = IS_NATIVE_APP ? BACKEND_URL : '';

// Express serves landing.html at '/', but the app's bundled files serve
// index.html (the calculator) there. In the app, the bare root goes to the
// simple welcome screen (welcome.html) instead of the marketing landing page,
// so every "no session, go to /" redirect (logout, expired login) lands
// there. The website is unaffected.
if (IS_NATIVE_APP && window.location.pathname === '/') {
  window.location.replace('/welcome.html');
}

// App-only behaviour (bottom tab bar, no purchasing UI) lives in native-app.js.
// Only the app loads it, so the website never downloads it. document.write
// keeps it loading in order, before the page's own scripts run.
if (IS_NATIVE_APP) {
  document.write('<script src="/native-app.js"><\/script>');
  document.write('<script src="/native-reminders.js"><\/script>'); // deal reminders (local notifications)
}
