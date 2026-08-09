'use strict';

/**
 * Unit tests for deploy-config.js's DEFAULTS + deepMerge (docs/plans/
 * deploy-config.md §4 Commit 1). Covers the "window.__owConfig loads (inject
 * or defaults)" DoD item at the deepMerge-logic level — the actual
 * window.__owConfig assignment (browser-only, guarded by `typeof window !==
 * 'undefined'`) is verified in a real browser by calev (no DOM in
 * node:test/bun test, same pattern as seed-example-vault.test.js).
 */

const assert = require('assert/strict');
const test = require('node:test');
const { DEFAULTS, deepMerge } = require('../deploy-config');

test('DEFAULTS mirrors src/config/deploy-config.json — today\'s hardcoded behavior (regression baseline)', () => {
  assert.equal(DEFAULTS.seedExampleContent, false);
  assert.equal(DEFAULTS.demoVault.enabled, false);
  assert.equal(DEFAULTS.layout.default, 'auto');
  assert.equal(DEFAULTS.layout.threshold, 900);
  assert.equal(DEFAULTS.plugins['obsidian-livesync'].install, true);
  assert.equal(DEFAULTS.plugins['obsidian-livesync'].enabled, false);
  assert.equal(DEFAULTS.plugins['obsidian-web-layout'].install, true);
  assert.equal(DEFAULTS.plugins['obsidian-web-layout'].enabled, true);
  assert.equal(DEFAULTS.defaultVaultLocation, 'device');
  assert.equal(DEFAULTS.defaultRepo.enabled, false);
});

// The anchor guard-deploy-target.sh greps for is the JSON serialisation of
// this subtree with `enabled` FIRST (`"defaultRepo":{"enabled":true`). Key
// order in a JS object literal is its insertion order, and build-assets.sh
// injects the config via JSON.stringify — so reordering these keys would
// silently blind the deploy guard while every other test still passed.
test('defaultRepo declares `enabled` as its first key — guard-deploy-target.sh anchors on it', () => {
  const fileConfig = require('../../config/deploy-config.json');
  assert.equal(Object.keys(fileConfig.defaultRepo)[0], 'enabled');
  assert.equal(Object.keys(DEFAULTS.defaultRepo)[0], 'enabled');
  assert.ok(JSON.stringify({ defaultRepo: { ...DEFAULTS.defaultRepo, enabled: true } })
    .includes('"defaultRepo":{"enabled":true'));
});

test('the gdd profile pins the site to a repository and enables nothing else that routes `/`', () => {
  // demoVault and defaultRepo both claim the bare origin. boot.js resolves
  // the collision in defaultRepo's favour, but a profile shipping both is a
  // config bug — this is what keeps the shipped one honest.
  const gdd = require('../../config/deploy-config.gdd.json');
  assert.equal(gdd.defaultRepo.enabled, true);
  assert.equal(gdd.demoVault.enabled, false);
  assert.equal(gdd.seedExampleContent, false);
});

// avigail finding 3: the test above only ever compared DEFAULTS against
// hardcoded literals — it never actually read src/config/deploy-config.json,
// so nothing caught the two files drifting apart. deepStrictEqual (not
// deepEqual) so a type-only drift (e.g. "true" vs true) is also caught.
test('DEFAULTS is byte-for-byte deepStrictEqual to src/config/deploy-config.json (drift guard)', () => {
  const fileConfig = require('../../config/deploy-config.json');
  assert.deepStrictEqual(DEFAULTS, fileConfig);
});

test('deepMerge with an empty override returns the defaults unchanged (regression: no config = today\'s behavior)', () => {
  const merged = deepMerge(DEFAULTS, {});
  assert.deepEqual(merged, DEFAULTS);
});

test('deepMerge with no override (undefined) returns the defaults unchanged', () => {
  const merged = deepMerge(DEFAULTS, undefined);
  assert.deepEqual(merged, DEFAULTS);
});

test('deepMerge overrides a top-level scalar without touching siblings', () => {
  const merged = deepMerge(DEFAULTS, { seedExampleContent: false });
  assert.equal(merged.seedExampleContent, false);
  assert.equal(merged.layout.threshold, 900);   // untouched
});

test('deepMerge merges nested objects key-by-key (does not replace the whole subtree)', () => {
  const merged = deepMerge(DEFAULTS, { layout: { threshold: 600 } });
  assert.equal(merged.layout.threshold, 600);
  assert.equal(merged.layout.default, 'auto');   // sibling key preserved
});

test('deepMerge merges deeply-nested plugin flags independently', () => {
  const merged = deepMerge(DEFAULTS, { plugins: { 'obsidian-livesync': { enabled: true } } });
  assert.equal(merged.plugins['obsidian-livesync'].enabled, true);
  assert.equal(merged.plugins['obsidian-livesync'].install, true);   // sibling preserved
  assert.equal(merged.plugins['obsidian-web-layout'].enabled, true);   // untouched branch preserved
});

test('deepMerge does not mutate the base object (DEFAULTS stays pristine across calls)', () => {
  const snapshot = JSON.parse(JSON.stringify(DEFAULTS));
  deepMerge(DEFAULTS, { layout: { threshold: 1 }, plugins: { 'obsidian-livesync': { enabled: true } } });
  assert.deepEqual(DEFAULTS, snapshot);
});
