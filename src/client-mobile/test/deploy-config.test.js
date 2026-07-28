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
