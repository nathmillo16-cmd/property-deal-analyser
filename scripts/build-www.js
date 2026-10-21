// Copies ONLY the frontend (the pages, their browser scripts, styles, icons and
// fonts) into www/, which is the folder Capacitor bundles into the iOS app.
// The repo root also holds the Express backend (server.js, its helper modules,
// db/, scripts/, .env), and none of that may ever end up inside the app.
//
// Usage: npm run build:www   (then: npx cap sync ios)
//
// This only reads the repo and writes www/.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'www');

// Which files count as frontend lives in frontend-files.js, shared with
// server.js, so the website and the app always publish the same set.
const { isFrontendPath, looksServerSide } = require('../frontend-files');

// Every tracked file plus new files not yet committed (but not git-ignored
// ones, so .env is excluded at this step too).
const candidates = execSync('git ls-files --cached --others --exclude-standard', { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

const copied = [];
const skipped = [];
for (const rel of candidates) {
  if (!fs.existsSync(path.join(ROOT, rel))) continue; // deleted but not yet committed
  if (/ \d+\.[a-z]+$/i.test(path.basename(rel)) && isFrontendPath(rel.replace(/ \d+(\.[a-z]+)$/i, '$1'), { forApp: true })) {
    skipped.push(rel); // macOS Finder duplicates like "home 2.html"
    continue;
  }
  if (isFrontendPath(rel, { forApp: true })) copied.push(rel);
}

// Safety net: refuse to build if anything that looks like server code or a
// secret slipped through the rules above.
const problems = [];
for (const rel of copied) {
  if (looksServerSide(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'))) problems.push(rel);
}
if (problems.length) {
  console.error('Refusing to build www/: these look like server-side files:\n  ' + problems.join('\n  '));
  console.error('Add them to BACKEND_FILES in frontend-files.js.');
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
