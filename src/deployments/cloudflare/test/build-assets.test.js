// Integration test for scripts/build-assets.sh's config-driven behavior
// (docs/plans/deploy-config.md §4 Commit 3): plugins install/enabled must
// follow src/config/deploy-config.json (not the old hardcoded values), and
// the CF build must inject window.__owConfigInjected into index.html BEFORE
// the deploy-config.js loader tag.
//
// Runs the REAL build script against the REAL vendor/obsidian-mobile bundle
// and the REAL committed config — same pattern as proxy-worker.test.js
// exercising real network (LiveSync download). The LiveSync-specific
// assertion is soft (only checked when the download actually succeeded) so
// this test doesn't flake when the sandbox has no network — the
// config-driven layout-switcher + injected-config assertions below never
// depend on the network and always run.
//
// Run: bun test src/deployments/cloudflare/test/build-assets.test.js

import { expect, test } from 'bun:test';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CF_DIR = path.resolve(__dirname, '..');
const MAIN_DIR = path.resolve(CF_DIR, '..', '..', '..');
const PUBLIC_DIR = path.join(MAIN_DIR, '.tmp', 'deployments', 'cloudflare', 'public');
const CONFIG_PATH = path.join(MAIN_DIR, 'src', 'config', 'deploy-config.json');

test('build-assets.sh: plugins install/enabled follow config.json + index.html gets window.__owConfigInjected before deploy-config.js', () => {
  execSync('bash scripts/build-assets.sh', {
    cwd: CF_DIR,
    stdio: 'pipe',
    timeout: 120000,
  });

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'system-plugins', 'manifest.json'), 'utf8'));
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

  // ── layout-switcher: config-driven, no network dependency ────────────────
  const layout = manifest.plugins.find((p) => p.id === 'obsidian-web-layout');
  expect(layout).toBeTruthy();
  expect(layout.enabled).toBe(config.plugins['obsidian-web-layout'].enabled);
  expect(fs.existsSync(path.join(PUBLIC_DIR, 'system-plugins', 'obsidian-web-layout'))).toBe(
    config.plugins['obsidian-web-layout'].install,
  );

  // ── LiveSync: install gate is config-driven and network-independent; the
  // `enabled` flag is only checkable if the (network-dependent) download
  // actually produced a manifest entry.
  const liveSyncEntry = manifest.plugins.find((p) => p.id === 'obsidian-livesync');
  if (config.plugins['obsidian-livesync'].install) {
    if (liveSyncEntry) {
      expect(liveSyncEntry.enabled).toBe(config.plugins['obsidian-livesync'].enabled);
    } // else: network unavailable in this environment — build.sh already WARNs and continues, nothing more to assert.
  } else {
    expect(liveSyncEntry).toBeUndefined();
  }

  // ── window.__owConfigInjected: marker replaced, positioned before the
  // deploy-config.js loader tag (order is load-bearing — see
  // deploy-config.js comment).
  expect(html).not.toContain('<!-- OW_CONFIG_INJECT -->');
  const expectedSnippet = '<script>window.__owConfigInjected=' + JSON.stringify(config) + '</script>';
  expect(html).toContain(expectedSnippet);
  // (search for the actual <script src="..."> tag, not just any mention of
  // "deploy-config.js" — the comment above the marker also names the file.)
  expect(html.indexOf(expectedSnippet)).toBeLessThan(html.indexOf('src="/client-mobile/deploy-config.js'));
}, 120000);

// ── §3.2/§3.4 — client-only backend flag + version (docs/plans/client-only-resilience.md) ──

const VERSION_PATH = path.join(MAIN_DIR, 'src', 'config', 'version.json');

test('build-assets.sh: index.html gets window.__owBackend="none" + window.__owVersion before deploy-config.js', () => {
  execSync('bash scripts/build-assets.sh', {
    cwd: CF_DIR,
    stdio: 'pipe',
    timeout: 120000,
  });

  const version = JSON.parse(fs.readFileSync(VERSION_PATH, 'utf8')).version;
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

  expect(html).not.toContain('<!-- OW_BACKEND_INJECT -->');
  const expectedSnippet = '<script>window.__owBackend="none";window.__owVersion=' + JSON.stringify(version) + ';</script>';
  expect(html).toContain(expectedSnippet);
  expect(html.indexOf(expectedSnippet)).toBeLessThan(html.indexOf('src="/client-mobile/deploy-config.js'));
}, 120000);

// DoD#11 — the injection step must be a bare command (not swallowed by `if
// node ...; then` under `set -e`, the exact pitfall already hit once at the
// LiveSync step in this same script — see §3.2 finding). A source index.html
// missing the marker must fail the BUILD loudly, never silently ship a
// client-only bundle without window.__owBackend.
test('build-assets.sh: FAILS loudly (nonzero exit) when OW_BACKEND_INJECT marker is missing from the source index.html', () => {
  const SRC_HTML = path.join(MAIN_DIR, 'src', 'client-mobile', 'index.html');
  const original = fs.readFileSync(SRC_HTML, 'utf8');
  expect(original).toContain('<!-- OW_BACKEND_INJECT -->');   // sanity: marker really is there normally
  const mutated = original.replace('<!-- OW_BACKEND_INJECT -->', '');
  fs.writeFileSync(SRC_HTML, mutated);
  try {
    let threw = false;
    try {
      execSync('bash scripts/build-assets.sh', { cwd: CF_DIR, stdio: 'pipe', timeout: 120000 });
    } catch (err) {
      threw = true;
      expect(err.status).not.toBe(0);
      expect(String(err.stderr)).toContain('OW_BACKEND_INJECT marker not found');
    }
    expect(threw).toBe(true);
  } finally {
    fs.writeFileSync(SRC_HTML, original);   // restore regardless of pass/fail
  }
}, 120000);
