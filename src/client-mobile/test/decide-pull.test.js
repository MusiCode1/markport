'use strict';

const assert = require('assert/strict');
const test = require('node:test');
const { decidePull } = require('../sync/decide-pull');

// brief docs/plans/server-sync-pull.md §3ב — decision table, hash-based.
// L = localHash (⊥ if no local file), R = remoteHash, S = lastSyncedHash (⊥ if never synced).

test('row 1 — L == R → skip (already in sync)', () => {
  const remote = [{ path: 'a.md', size: 10, hash: 'H1' }];
  const local = { 'a.md': { hash: 'H1', size: 10 } };
  const synced = {};
  const decisions = decidePull(remote, local, synced);
  assert.deepEqual(decisions, [{ path: 'a.md', decision: 'skip', size: 10, hash: 'H1' }]);
});

test('row 2 — L == ⊥ (no local file) → download', () => {
  const remote = [{ path: 'new.md', size: 5, hash: 'H2' }];
  const local = {};
  const synced = {};
  const decisions = decidePull(remote, local, synced);
  assert.deepEqual(decisions, [{ path: 'new.md', decision: 'download', size: 5, hash: 'H2' }]);
});

test('row 3 — L != R, S == ⊥ (never synced) → conflictSkip', () => {
  const remote = [{ path: 'b.md', size: 8, hash: 'HR' }];
  const local = { 'b.md': { hash: 'HL', size: 8 } };
  const synced = {};
  const decisions = decidePull(remote, local, synced);
  assert.deepEqual(decisions, [{ path: 'b.md', decision: 'conflictSkip', size: 8, hash: 'HR' }]);
});

test('row 4 — L != R, L == S, R != S (server changed, local untouched) → download (overwrite)', () => {
  const remote = [{ path: 'c.md', size: 9, hash: 'HR2' }];
  const local = { 'c.md': { hash: 'HS', size: 9 } };
  const synced = { 'c.md': 'HS' };
  const decisions = decidePull(remote, local, synced);
  assert.deepEqual(decisions, [{ path: 'c.md', decision: 'download', size: 9, hash: 'HR2' }]);
});

test('row 5 — L != R, L != S, R == S (local edited, server untouched) → skip (push is v2)', () => {
  const remote = [{ path: 'd.md', size: 3, hash: 'HS2' }];
  const local = { 'd.md': { hash: 'HL2', size: 3 } };
  const synced = { 'd.md': 'HS2' };
  const decisions = decidePull(remote, local, synced);
  assert.deepEqual(decisions, [{ path: 'd.md', decision: 'skip', size: 3, hash: 'HS2' }]);
});

test('row 6 — L != R, L != S, R != S (both sides changed) → conflictSkip', () => {
  const remote = [{ path: 'e.md', size: 4, hash: 'HR3' }];
  const local = { 'e.md': { hash: 'HL3', size: 4 } };
  const synced = { 'e.md': 'HS3' };
  const decisions = decidePull(remote, local, synced);
  assert.deepEqual(decisions, [{ path: 'e.md', decision: 'conflictSkip', size: 4, hash: 'HR3' }]);
});

test('multiple paths — each row evaluated independently, order preserved as in remote entries', () => {
  const remote = [
    { path: 'skip.md', size: 1, hash: 'S1' },
    { path: 'download.md', size: 2, hash: 'S2' },
    { path: 'conflict.md', size: 3, hash: 'S3' },
  ];
  const local = {
    'skip.md': { hash: 'S1', size: 1 },
    'conflict.md': { hash: 'LOCAL', size: 3 },
  };
  const synced = {};
  const decisions = decidePull(remote, local, synced);
  assert.deepEqual(decisions, [
    { path: 'skip.md', decision: 'skip', size: 1, hash: 'S1' },
    { path: 'download.md', decision: 'download', size: 2, hash: 'S2' },
    { path: 'conflict.md', decision: 'conflictSkip', size: 3, hash: 'S3' },
  ]);
});

test('empty remote-manifest → no decisions', () => {
  assert.deepEqual(decidePull([], {}, {}), []);
});

test('pure function — does not mutate its inputs', () => {
  const remote = [{ path: 'x.md', size: 1, hash: 'X' }];
  const local = { 'x.md': { hash: 'X', size: 1 } };
  const synced = { 'x.md': 'X' };
  const remoteCopy = JSON.parse(JSON.stringify(remote));
  const localCopy = JSON.parse(JSON.stringify(local));
  const syncedCopy = JSON.parse(JSON.stringify(synced));
  decidePull(remote, local, synced);
  assert.deepEqual(remote, remoteCopy);
  assert.deepEqual(local, localCopy);
  assert.deepEqual(synced, syncedCopy);
});
