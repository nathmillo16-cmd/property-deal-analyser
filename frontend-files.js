// The one definition of which repo files are "frontend" (pages, browser
// scripts, styles, icons, fonts) and so safe to hand to a browser. Everything
// else in the repo root is backend or tooling: server.js and its helper
// modules, db/, scripts/, CLAUDE.md, package.json, .git, .env, node_modules.
//
// Used by:
//  - server.js, which only serves files on this list (the website), and
//  - scripts/build-www.js, which only copies files on this list into www/
//    (the iOS app).
// Keeping both on one list means the website and the app can't drift apart.
//
// This is a server-side Node module and is itself never served.

const fs = require('fs');
const path = require('path');

// Server-side Node modules that live in the repo root next to the pages.
// Never frontend, even though they end in .js.
const BACKEND_FILES = new Set([
  'server.js',
  'frontend-files.js',
  'get-comps.js',
  'postcodes-io.js',
  'nomis-employment.js',
  'epc-floor-area.js',
  'crm-thresholds.js',
  'admin-users.js',
  'weekly-digest.js',
]);

// Website-only: the PWA service worker and its offline fallback page. The
// app has its files on the device already, and pwa.js skips registering the
// worker inside the app.
const WEB_ONLY_FILES = new Set(['sw.js', 'offline.html']);

// Root-level files are allowed; of the subfolders, only these hold frontend.
const FRONTEND_DIRS = ['admin', 'assets', 'fonts'];

const FRONTEND_EXT = new Set(['.html', '.css', '.js', '.webmanifest', '.png', '.ico', '.svg', '.jpg', '.jpeg', '.webp', '.ttf', '.woff', '.woff2', '.txt']);

// rel is a repo-relative path with forward slashes, e.g. "admin/index.html".
// forApp: true for the iOS build, which leaves out the website-only files.
function isFrontendPath(rel, { forApp = false } = {}) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || rel.includes('\\')) return false;
  const parts = rel.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..' || p.startsWith('.'))) return false; // .env, .git/, ...
  if (parts.length > 1 && !FRONTEND_DIRS.includes(parts[0])) return false; // db/, scripts/, exports/, node_modules/, ...
  if (!FRONTEND_EXT.has(path.extname(rel).toLowerCase())) return false; // CLAUDE.md, package.json, .sql, .csv, ...
  if (BACKEND_FILES.has(rel)) return false;
  if (forApp && WEB_ONLY_FILES.has(rel)) return false;
  // macOS Finder duplicates like "home 2.html" are stray copies, not pages.
  if (/ \d+\.[a-z]+$/i.test(parts[parts.length - 1])) return false;
  return true;
}

// Safety net: a .js file that requires modules or reads env vars is server
// code, whatever the rules above say.
function looksServerSide(rel, src) {
  return path.extname(rel) === '.js' && /\brequire\(|process\.env|module\.exports/.test(src);
}

// Walks the repo on disk and returns the Set of files the website may serve.
// Built once at server start. A server-looking .js file is left out and
// reported, so a new backend module added to the root is never published by
// mistake (fails closed).
function listPublicFiles(root) {
  const out = new Set();
  const flagged = [];
  const walk = (dirRel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, dirRel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = dirRel ? dirRel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (!dirRel && FRONTEND_DIRS.includes(e.name)) walk(rel);
        else if (dirRel) walk(rel);
        continue;
      }
      if (!e.isFile() || !isFrontendPath(rel)) continue;
      if (looksServerSide(rel, fs.readFileSync(path.join(root, rel), 'utf8'))) { flagged.push(rel); continue; }
      out.add(rel);
    }
  };
  walk('');
  if (flagged.length) {
    console.warn('Not serving these, they look like server-side files (add them to BACKEND_FILES in frontend-files.js):\n  ' + flagged.join('\n  '));
  }
  return out;
}

module.exports = { isFrontendPath, looksServerSide, listPublicFiles, BACKEND_FILES };
