// Copies ONLY the frontend (the pages, their browser scripts, styles, icons and
// fonts) into www/, which is the folder Capacitor bundles into the iOS app.
// The repo root also holds the Express backend (server.js, its helper modules,
// db/, scripts/, .env), and none of that may ever end up inside the app.
//
// Usage: npm run build:www   (then: npx cap sync ios)
//
// This only reads the repo and writes www/. It doesn't change how Express
// serves files.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'www');

// Server-side Node modules that live in the repo root next to the pages.
// Anything listed here is never copied, even though it ends in .js.
const BACKEND_FILES = new Set([
  'server.js',
  'get-comps.js',
  'postcodes-io.js',
  'nomis-employment.js',
  'epc-floor-area.js',
  'crm-thresholds.js',
  'admin-users.js',
  'weekly-digest.js',
  // Website-only: the PWA service worker and its offline fallback page. The
  // app has its files on the device already, and pwa.js skips registering
  // the worker inside the app.
  'sw.js',
  'offline.html',
]);

// Whole folders that are backend or tooling, never frontend.
const BACKEND_DIRS = ['db/', 'scripts/', 'node_modules/', 'ios/', 'android/', 'www/', 'resources/'];

// What counts as a frontend file.
const FRONTEND_EXT = new Set(['.html', '.css', '.js', '.webmanifest', '.png', '.ico', '.svg', '.jpg', '.jpeg', '.webp', '.ttf', '.woff', '.woff2', '.txt']);

// Every tracked file plus new files not yet committed (but not git-ignored
// ones, so .env is excluded at this step too).
const candidates = execSync('git ls-files --cached --others --exclude-standard', { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

const copied = [];
const skipped = [];
for (const rel of candidates) {
  const base = path.basename(rel);
  const ext = path.extname(rel).toLowerCase();
  if (!fs.existsSync(path.join(ROOT, rel))) continue; // deleted but not yet committed
  if (BACKEND_DIRS.some((d) => rel.startsWith(d))) continue;
  if (base.startsWith('.')) continue; // .env, .gitignore, etc.
  if (rel.includes('/') && !/^(admin|assets|fonts)\//.test(rel)) continue; // only these subfolders hold frontend
  if (!FRONTEND_EXT.has(ext)) continue; // CLAUDE.md, package.json, lockfiles, ...
  if (BACKEND_FILES.has(rel)) continue;
  // macOS Finder duplicates like "home 2.html" are stray copies, not pages.
  if (/ \d+\.[a-z]+$/i.test(base)) { skipped.push(rel); continue; }
  copied.push(rel);
}

// Safety net: refuse to build if anything that looks like server code or a
// secret slipped through the rules above.
const problems = [];
for (const rel of copied) {
  if (path.extname(rel) !== '.js') continue;
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  if (/\brequire\(|process\.env|module\.exports/.test(src)) problems.push(rel);
}
if (problems.length) {
  console.error('Refusing to build www/: these look like server-side files:\n  ' + problems.join('\n  '));
  console.error('Add them to BACKEND_FILES in scripts/build-www.js.');
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const rel of copied) {
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), dest);
}

console.log(`Copied ${copied.length} frontend files into www/.`);
if (skipped.length) console.log('Skipped stray duplicates: ' + skipped.join(', '));
