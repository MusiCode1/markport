#!/usr/bin/env node
'use strict';

/**
 * update-obsidian-mobile.js
 *
 * Downloads the official Obsidian Android APK from GitHub releases and
 * extracts the web assets into obsidian-mobile/.
 *
 * The APK is a ZIP archive.  We pull out exactly the files that the mobile
 * web wrapper needs and discard the rest.
 *
 * Usage:
 *   node scripts/update-obsidian-mobile.js
 *   node scripts/update-obsidian-mobile.js --version 1.12.7
 *   node scripts/update-obsidian-mobile.js --force
 *   node scripts/update-obsidian-mobile.js --no-cache
 */

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const https = require('https');
const path = require('path');
const { pipeline } = require('stream/promises');
const { spawnSync } = require('child_process');

const { applyPatches } = require('./patch-obsidian-mobile');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR    = path.join(PROJECT_ROOT, '.tmp', 'cache', 'obsidian-releases');
const TARGET_DIR   = path.join(PROJECT_ROOT, 'vendor', 'obsidian-mobile');
const GITHUB_API   = 'https://api.github.com/repos/obsidianmd/obsidian-releases/releases';
const USER_AGENT   = 'obsidian-web-updater';

// Files to extract from the APK (ZIP path → target relative path).
// All paths inside the APK are under assets/.
const EXTRACT_MAP = {
  'assets/native-bridge.js':       'native-bridge.js',
  'assets/public/app.js':          'app.js',
  'assets/public/app.css':         'app.css',
  'assets/public/worker.js':       'worker.js',
  'assets/public/cordova.js':      'cordova.js',
  'assets/public/cordova_plugins.js': 'cordova_plugins.js',
  'assets/public/enhance.js':      'enhance.js',
  'assets/public/i18n.js':         'i18n.js',
  'assets/public/sim.js':          'sim.js',
};

// Directory prefixes to extract recursively.
const EXTRACT_DIRS = [
  { apk: 'assets/public/i18n/', target: 'i18n/' },
  { apk: 'assets/public/lib/',  target: 'lib/'  },
];

const REQUIRED_FILES = ['app.js', 'native-bridge.js', 'worker.js'];

// ── helpers ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { version: null, force: false, keepCache: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--version') {
      opts.version = argv[++i];
      if (!opts.version) throw new Error('--version requires a value');
    } else if (arg.startsWith('--version=')) {
      opts.version = arg.slice('--version='.length);
    } else if (arg === '--force')    { opts.force = true; }
    else if (arg === '--no-cache')   { opts.keepCache = false; }
    else if (arg === '--help' || arg === '-h') { opts.help = true; }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetries(label, fn, attempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (err.retryable === false || attempt === attempts) break;
      console.warn(`${label} failed (${err.message}); retrying ${attempt + 1}/${attempts}…`);
      await sleep(attempt * 1000);
    }
  }
  throw lastErr;
}

function request(url, { json = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        Accept: json ? 'application/vnd.github+json' : 'application/octet-stream',
        'User-Agent': USER_AGENT,
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(request(new URL(res.headers.location, url).toString(), { json }));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const err = new Error(`HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`);
          err.retryable = res.statusCode >= 500;
          reject(err);
        });
        return;
      }
      resolve(res);
    });
    req.on('error', err => { err.retryable = true; reject(err); });
  });
}

async function getJson(url) {
  return withRetries(`GET ${url}`, async () => {
    const res = await request(url, { json: true });
    const chunks = [];
    for await (const chunk of res) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  });
}

async function fetchRelease(version) {
  if (!version) return getJson(`${GITHUB_API}/latest`);
  const tag = version.startsWith('v') ? version : `v${version}`;
  return getJson(`${GITHUB_API}/tags/${encodeURIComponent(tag)}`);
}

function findApkAsset(release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  return assets.find(a => /^Obsidian-[\d.]+\.apk$/i.test(a.name));
}

async function fileExists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function downloadFile(asset, destination, force) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  if (!force && await fileExists(destination)) {
    console.log(`  Using cached ${path.relative(PROJECT_ROOT, destination)}`);
    return;
  }
  console.log(`  Downloading ${asset.name} (${(asset.size / 1e6).toFixed(1)} MB)…`);
  await withRetries(`download ${asset.name}`, async () => {
    const tmp = `${destination}.download`;
    await fsp.rm(tmp, { force: true });
    try {
      const res = await request(asset.browser_download_url);
      await pipeline(res, fs.createWriteStream(tmp));
      await fsp.rename(tmp, destination);
    } catch (err) {
      await fsp.rm(tmp, { force: true });
      throw err;
    }
  });
}

// ── APK extraction ────────────────────────────────────────────────────────────

async function extractApk(apkPath, tmpDir, targetDir) {
  await fsp.mkdir(tmpDir, { recursive: true });

  // Build list of paths to extract from the APK
  const apkPaths = [
    ...Object.keys(EXTRACT_MAP),
    ...EXTRACT_DIRS.map(d => d.apk + '*'),  // unzip supports wildcards
  ];

  console.log('  Extracting from APK…');
  const result = spawnSync('unzip', [
    '-o',           // overwrite without prompting
    apkPath,
    ...apkPaths,
    '-d', tmpDir,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  if (result.status !== 0 && result.status !== 1) {
    // unzip exits 1 when some files not found but still extracts what it can
    throw new Error(`unzip failed (exit ${result.status}): ${result.stderr?.toString().slice(0, 300)}`);
  }

  // Copy individual files
  for (const [apkRelPath, targetRelPath] of Object.entries(EXTRACT_MAP)) {
    const src  = path.join(tmpDir, apkRelPath);
    const dest = path.join(targetDir, targetRelPath);
    if (!await fileExists(src)) {
      console.warn(`  Warning: ${apkRelPath} not found in APK`);
      continue;
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
    const stat = await fsp.stat(dest);
    console.log(`  ${targetRelPath.padEnd(25)} ${(stat.size / 1024).toFixed(0)} KB`);
  }

  // Copy directories
  for (const { apk, target } of EXTRACT_DIRS) {
    const srcDir  = path.join(tmpDir, apk);
    const destDir = path.join(targetDir, target);
    if (!await fileExists(srcDir)) {
      console.warn(`  Warning: directory ${apk} not found in APK`);
      continue;
    }
    await fsp.mkdir(destDir, { recursive: true });
    await copyDirRecursive(srcDir, destDir);
    console.log(`  ${target.padEnd(25)} (directory)`);
  }
}

async function copyDirRecursive(src, dest) {
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await fsp.mkdir(destPath, { recursive: true });
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

async function verifyRequired(targetDir) {
  for (const file of REQUIRED_FILES) {
    const p = path.join(targetDir, file);
    if (!await fileExists(p)) throw new Error(`Required file missing: ${file}`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log([
      'Usage: node scripts/update-obsidian-mobile.js [options]',
      '',
      'Options:',
      '  --version <ver>  Specific version, e.g. 1.12.7 (default: latest)',
      '  --force          Re-download even if APK is cached',
      '  --no-cache       Delete downloaded APK after extraction',
      '  -h, --help       Show this help',
    ].join('\n'));
    return;
  }

  // 1. Fetch release metadata
  console.log(opts.version ? `Fetching release ${opts.version}…` : 'Fetching latest release…');
  const release = await fetchRelease(opts.version);
  const version = release.tag_name.replace(/^v/, '');
  console.log(`Release: ${release.tag_name}`);

  // Write the single source-of-truth version file BEFORE downloading the APK
  // (see docs/plans/electron-shim-foundation.md §3.0) — it's a resolved,
  // concrete version string either way (an explicit --version, or whatever
  // "latest" resolved to), so there is no reason to wait for extraction.
  // This is a TRACKED file — running this script (default: --version omitted
  // → "latest") silently overwrites it with whatever is newest on a plain
  // re-run, which is intentional but must never be quiet about it.
  const versionFilePath = path.join(PROJECT_ROOT, 'src', 'client-mobile', 'obsidian-version.js');
  const versionFileContent =
    '// GENERATED by scripts/update-obsidian-mobile.js — do not edit.\n' +
    '//\n' +
    '// Single source of truth for the currently-vendored Obsidian mobile version\n' +
    '// string. See docs/plans/electron-shim-foundation.md §3.0 for why every\n' +
    '// reader of the version string must share this one value.\n' +
    '//\n' +
    '// Regenerated by `node scripts/update-obsidian-mobile.js [--version X.Y.Z]`\n' +
    '// every time the vendored bundle is updated — committed so a fresh checkout\n' +
    '// that never ran the script still has a valid value.\n' +
    `window.__owObsidianVersion = '${version}';\n`;
  console.log(`Writing ${path.relative(PROJECT_ROOT, versionFilePath)} (Obsidian ${version})…`);
  await fsp.writeFile(versionFilePath, versionFileContent, 'utf8');

  // 2. Find APK asset
  const apkAsset = findApkAsset(release);
  if (!apkAsset) throw new Error('APK asset not found in release');
  console.log(`APK: ${apkAsset.name}`);

  // 3. Download APK to cache
  const apkCachePath = path.join(CACHE_DIR, apkAsset.name);
  await downloadFile(apkAsset, apkCachePath, opts.force);

  // 4. Extract to temp dir, then copy to obsidian-mobile/
  const tmpDir = path.join(CACHE_DIR, `apk-extract-${version}`);
  const targetDir = TARGET_DIR;

  // Clear target before writing fresh files
  await fsp.rm(targetDir, { recursive: true, force: true });
  await fsp.mkdir(targetDir, { recursive: true });

  await extractApk(apkCachePath, tmpDir, targetDir);

  // 5. Apply build-time patches (see scripts/patch-obsidian-mobile.js)
  console.log('Applying patches…');
  await applyPatches(path.join(targetDir, 'app.js'));

  // 6. Verify required files
  await verifyRequired(targetDir);
  console.log(`\nDone. obsidian-mobile/ is ready (Obsidian ${version}).`);

  // 6. Cleanup
  await fsp.rm(tmpDir, { recursive: true, force: true });
  if (!opts.keepCache) {
    await fsp.rm(apkCachePath, { force: true });
    console.log('APK cache cleared.');
  }
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
