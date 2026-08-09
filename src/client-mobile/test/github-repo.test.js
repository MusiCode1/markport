'use strict';

/**
 * Unit tests for the pure half of storage/github-repo.js — the parts that
 * decide what a sync will DO, before any network or OPFS is involved:
 *
 *   parseRepoRef — every shape a user can paste into the dialog
 *   gitBlobSha   — must equal git's own object id, since sync compares it
 *                  directly against the shas in GitHub's tree response
 *   planSync     — the three-way write/delete/conflict decision, i.e. the
 *                  only thing standing between a pull and a clobbered note
 *
 * The network half (resolveRepo/listTree/syncVault) is verified in a real
 * browser against a real repository — see the slice notes; mocking fetch
 * here would only re-assert the mock.
 *
 * No DOM under node:test — `localStorage` is polyfilled on `global` before
 * requiring the module, the same pattern local-vault-registry.test.js uses
 * and that github-repo.js's header documents ("no window. qualifier").
 */

const assert = require('assert/strict');
const test = require('node:test');

function makeFakeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

global.localStorage = makeFakeLocalStorage();
const gh = require('../storage/github-repo');

// ── parseRepoRef ───────────────────────────────────────────────────────────

test('parseRepoRef accepts a plain repository URL', () => {
  assert.deepEqual(gh.parseRepoRef('https://github.com/notnilcn/ggdd'),
    { owner: 'notnilcn', repo: 'ggdd', ref: null });
});

test('parseRepoRef tolerates the shapes people actually paste (trailing slash, .git, no scheme, www, bare owner/repo, ssh)', () => {
  const expected = { owner: 'notnilcn', repo: 'ggdd', ref: null };
  for (const input of [
    'https://github.com/notnilcn/ggdd/',
    'https://github.com/notnilcn/ggdd.git',
    'http://github.com/notnilcn/ggdd',
    'github.com/notnilcn/ggdd',
    'https://www.github.com/notnilcn/ggdd',
    'notnilcn/ggdd',
    '  notnilcn/ggdd  ',
    'git@github.com:notnilcn/ggdd.git',
  ]) {
    assert.deepEqual(gh.parseRepoRef(input), expected, `failed for: ${input}`);
  }
});

test('parseRepoRef reads a branch from a /tree/ URL and from the #branch shorthand', () => {
  assert.deepEqual(gh.parseRepoRef('https://github.com/notnilcn/ggdd/tree/master'),
    { owner: 'notnilcn', repo: 'ggdd', ref: 'master' });
  assert.deepEqual(gh.parseRepoRef('notnilcn/ggdd#master'),
    { owner: 'notnilcn', repo: 'ggdd', ref: 'master' });
});

test('parseRepoRef keeps slashes in a branch name — release/1.x is a legal ref', () => {
  assert.deepEqual(gh.parseRepoRef('https://github.com/o/r/tree/release/1.x'),
    { owner: 'o', repo: 'r', ref: 'release/1.x' });
});

test('parseRepoRef takes the ref from a /blob/ URL too (people paste file links)', () => {
  assert.equal(gh.parseRepoRef('https://github.com/o/r/blob/main/README.md').ref, 'main');
});

test('parseRepoRef prefers an explicit URL ref over the #branch shorthand — the more specific form wins', () => {
  assert.equal(gh.parseRepoRef('https://github.com/o/r/tree/dev#main').ref, 'dev');
});

test('parseRepoRef returns null for input that is not a repository', () => {
  for (const input of ['', '   ', null, undefined, 'notnilcn', 'https://github.com/notnilcn',
    'https://example.com', 'owner/re po', 'ow ner/repo']) {
    assert.equal(gh.parseRepoRef(input), null, `should reject: ${JSON.stringify(input)}`);
  }
});

// ── parseShareLink ─────────────────────────────────────────────────────────
// The share-link route, `/github/<owner>/<repo>[/<note>]`. Every assertion
// about `note` is about it staying ENCODED: boot.js appends it verbatim to
// `/vault/<id>/`, so a decode here would produce a path with raw spaces and
// the deep-link would miss the file.

test('parseShareLink reads owner and repo from the route', () => {
  assert.deepEqual(gh.parseShareLink('/github/notnilcn/ggdd', '', ''),
    { owner: 'notnilcn', repo: 'ggdd', ref: null, note: '' });
});

test('parseShareLink keeps the note path percent-encoded, slashes and all', () => {
  assert.deepEqual(
    gh.parseShareLink('/github/notnilcn/ggdd/Game%20Design%20Docs/01%20Executive%20Summary', '', ''),
    {
      owner: 'notnilcn',
      repo: 'ggdd',
      ref: null,
      note: 'Game%20Design%20Docs/01%20Executive%20Summary',
    });
});

test('parseShareLink takes the branch from ?ref=, and from a #fragment as a fallback', () => {
  assert.equal(gh.parseShareLink('/github/notnilcn/ggdd', '?ref=master', '').ref, 'master');
  assert.equal(gh.parseShareLink('/github/notnilcn/ggdd', '', '#master').ref, 'master');
  // ?ref= wins — a query is part of the request, a fragment never reaches the
  // server and is the weaker signal of the two.
  assert.equal(gh.parseShareLink('/github/notnilcn/ggdd', '?ref=master', '#dev').ref, 'master');
  // A slash-bearing branch survives both spellings (release/1.x is legal).
  assert.equal(gh.parseShareLink('/github/o/r', '?ref=release%2F1.x', '').ref, 'release/1.x');
});

test('parseShareLink ignores a trailing slash rather than reading it as an empty note', () => {
  assert.equal(gh.parseShareLink('/github/notnilcn/ggdd/', '', '').note, '');
  assert.equal(gh.parseShareLink('/github/notnilcn/ggdd//', '', '').note, '');
});

test('parseShareLink strips a .git suffix, like parseRepoRef does', () => {
  assert.equal(gh.parseShareLink('/github/notnilcn/ggdd.git', '', '').repo, 'ggdd');
});

test('parseShareLink returns null for anything that is not this route', () => {
  for (const input of ['', '/', '/starter', '/vault/abc123', '/vault/abc123/Note',
    '/github', '/github/', '/github/notnilcn', '/githubx/o/r', '/x/github/o/r']) {
    assert.equal(gh.parseShareLink(input, '', ''), null,
      `should reject: ${JSON.stringify(input)}`);
  }
});

test('parseShareLink rejects an owner or repo that GitHub could not have issued', () => {
  // Same NAME_RE gate parseRepoRef uses — a bad paste fails here rather than
  // as a confusing 404 two network calls later.
  assert.equal(gh.parseShareLink('/github/own%20er/repo', '', ''), null);
  assert.equal(gh.parseShareLink('/github/owner/re%20po', '', ''), null);
});

// ── defaultRepoUrl ─────────────────────────────────────────────────────────
// parseShareLink's inverse, used by boot.js's entry routing to turn a
// deploy-config `defaultRepo` into the share-link URL it redirects to. The
// pairing is what matters: anything this builds, parseShareLink must accept.

test('defaultRepoUrl builds the share-link route for an enabled repo', () => {
  assert.equal(
    gh.defaultRepoUrl({ enabled: true, owner: 'notnilcn', repo: 'ggdd' }),
    '/github/notnilcn/ggdd');
});

test('defaultRepoUrl encodes the note per segment, keeping slashes as separators', () => {
  assert.equal(
    gh.defaultRepoUrl({
      enabled: true, owner: 'notnilcn', repo: 'ggdd',
      note: 'Game Design Docs/01 Executive Summary',
    }),
    '/github/notnilcn/ggdd/Game%20Design%20Docs/01%20Executive%20Summary');
});

test('defaultRepoUrl round-trips through parseShareLink — the shipped gdd profile', () => {
  // The actual committed profile, not a hand-written fixture: this is the
  // pairing that decides whether khvgames.com's bare origin resolves at all.
  const cfg = require('../../config/deploy-config.gdd.json').defaultRepo;
  const url = gh.defaultRepoUrl(cfg);
  assert.ok(url, 'gdd profile must produce a URL');

  const [pathname, search] = url.split('?');
  const link = gh.parseShareLink(pathname, search ? `?${search}` : '', '');
  assert.ok(link, 'parseShareLink must accept what defaultRepoUrl built');
  assert.equal(link.owner, cfg.owner);
  assert.equal(link.repo, cfg.repo);
  assert.equal(link.ref, cfg.ref);
  // note comes back still-encoded, by parseShareLink's contract.
  assert.equal(link.note.split('/').map(decodeURIComponent).join('/'), cfg.note);
});

test('defaultRepoUrl appends ?ref= only when a ref is configured', () => {
  const base = { enabled: true, owner: 'o', repo: 'r' };
  assert.equal(gh.defaultRepoUrl({ ...base, ref: null }), '/github/o/r');
  assert.equal(gh.defaultRepoUrl({ ...base, ref: '' }), '/github/o/r');
  assert.equal(gh.defaultRepoUrl({ ...base, ref: 'release/1.x' }),
    '/github/o/r?ref=release%2F1.x');
});

test('defaultRepoUrl drops empty note segments rather than emitting an empty one', () => {
  // '/github/o/r//x' parses as the note '/x', a path no vault has.
  assert.equal(gh.defaultRepoUrl({ enabled: true, owner: 'o', repo: 'r', note: '/a//b/' }),
    '/github/o/r/a/b');
});

test('defaultRepoUrl returns null for anything it cannot build a valid link from', () => {
  // null = "route normally"; a bad config must land on the ordinary chooser,
  // never on a /github/ URL parseShareLink would refuse on arrival.
  const cases = [
    undefined, null, {},
    { enabled: false, owner: 'o', repo: 'r' },          // not enabled
    { enabled: 'true', owner: 'o', repo: 'r' },         // truthy, not === true
    { enabled: true, owner: '', repo: 'r' },            // no owner
    { enabled: true, owner: 'o', repo: '' },            // no repo
    { enabled: true, owner: 'own er', repo: 'r' },      // fails NAME_RE
    { enabled: true, owner: 'o', repo: 're po' },
  ];
  for (const cfg of cases) {
    assert.equal(gh.defaultRepoUrl(cfg), null, `should reject: ${JSON.stringify(cfg)}`);
  }
});

test('defaultRepoUrl strips a .git suffix, like parseShareLink and parseRepoRef do', () => {
  assert.equal(gh.defaultRepoUrl({ enabled: true, owner: 'notnilcn', repo: 'ggdd.git' }),
    '/github/notnilcn/ggdd');
});

test('the default profile ships defaultRepo disabled — the general app is not pinned to a repo', () => {
  assert.equal(gh.defaultRepoUrl(require('../../config/deploy-config.json').defaultRepo), null);
});

// ── gitBlobSha ─────────────────────────────────────────────────────────────
// Reference values from `git hash-object --stdin`. If this drifts, sync would
// silently treat every file as locally modified (or as unchanged) — the whole
// pull/conflict decision rests on these being byte-identical to git's.

test('gitBlobSha matches git hash-object for text content', async () => {
  const bytes = new TextEncoder().encode('hello world');
  assert.equal(await gh.gitBlobSha(bytes), '95d09f2b10159347eece71399a7e2e907ea3df4f');
});

test('gitBlobSha matches git hash-object for an empty file', async () => {
  assert.equal(await gh.gitBlobSha(new Uint8Array(0)),
    'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});

test('gitBlobSha matches git hash-object for a multi-line note', async () => {
  const bytes = new TextEncoder().encode('# Title\n\nBody\n');
  assert.equal(await gh.gitBlobSha(bytes), 'b0c530d492339aca543b48ab5bae2f1aa9df9025');
});

test('gitBlobSha accepts an ArrayBuffer as well as a Uint8Array', async () => {
  const view = new TextEncoder().encode('hello world');
  assert.equal(await gh.gitBlobSha(view.buffer), '95d09f2b10159347eece71399a7e2e907ea3df4f');
});

// ── planSync ───────────────────────────────────────────────────────────────

test('planSync on a first clone (nothing synced, nothing local) writes everything', () => {
  const plan = gh.planSync({
    remote: { 'a.md': 'sha-a', 'b/c.md': 'sha-c' },
    synced: {},
    local: {},
  });
  assert.deepEqual(plan.write.sort(), ['a.md', 'b/c.md']);
  assert.deepEqual(plan.delete, []);
  assert.deepEqual(plan.conflict, []);
});

test('planSync skips a file already byte-identical to the remote', () => {
  const plan = gh.planSync({
    remote: { 'a.md': 'sha1' },
    synced: { 'a.md': 'sha1' },
    local: { 'a.md': 'sha1' },
  });
  assert.deepEqual(plan.unchanged, ['a.md']);
  assert.deepEqual(plan.write, []);
});

test('planSync writes a clean upstream change — local still equals what we last synced', () => {
  const plan = gh.planSync({
    remote: { 'a.md': 'sha-new' },
    synced: { 'a.md': 'sha-old' },
    local: { 'a.md': 'sha-old' },
  });
  assert.deepEqual(plan.write, ['a.md']);
  assert.deepEqual(plan.conflict, []);
});

test('planSync REFUSES to overwrite a locally edited file that also moved upstream', () => {
  const plan = gh.planSync({
    remote: { 'a.md': 'sha-remote' },
    synced: { 'a.md': 'sha-old' },
    local: { 'a.md': 'sha-mine' },
  });
  assert.deepEqual(plan.conflict, ['a.md']);
  assert.deepEqual(plan.write, [], 'a local edit is never clobbered by a pull');
});

test('planSync treats a pre-existing file with no sync record as a conflict, not a write', () => {
  // e.g. the clone was interrupted and the manifest was lost — the file on
  // disk is unaccounted for, so it is preserved rather than overwritten.
  const plan = gh.planSync({
    remote: { 'a.md': 'sha-remote' },
    synced: {},
    local: { 'a.md': 'sha-mine' },
  });
  assert.deepEqual(plan.conflict, ['a.md']);
});

test('planSync deletes a file removed upstream when it was untouched locally', () => {
  const plan = gh.planSync({
    remote: {},
    synced: { 'gone.md': 'sha1' },
    local: { 'gone.md': 'sha1' },
  });
  assert.deepEqual(plan.delete, ['gone.md']);
});

test('planSync KEEPS a locally edited file that was removed upstream', () => {
  const plan = gh.planSync({
    remote: {},
    synced: { 'gone.md': 'sha1' },
    local: { 'gone.md': 'sha-mine' },
  });
  assert.deepEqual(plan.delete, [], 'the user\'s only copy is not deleted');
  assert.deepEqual(plan.conflict, ['gone.md']);
});

test('planSync is a no-op for a path already gone both upstream and locally', () => {
  const plan = gh.planSync({
    remote: {},
    synced: { 'gone.md': 'sha1' },
    local: { 'gone.md': null },
  });
  assert.deepEqual(plan.delete, []);
  assert.deepEqual(plan.conflict, []);
});

test('planSync seeds Obsidian\'s device-local workspace state once, then never touches it again', () => {
  // Absent → written, so a fresh clone opens the way the repo intends.
  const first = gh.planSync({
    remote: { '.obsidian/workspace.json': 'sha-repo' },
    synced: {},
    local: {},
  });
  assert.deepEqual(first.write, ['.obsidian/workspace.json']);

  // Present and (inevitably) diverged, because Obsidian rewrites it while
  // the vault is open. Neither a conflict to report nor a file to overwrite.
  const later = gh.planSync({
    remote: { '.obsidian/workspace.json': 'sha-repo' },
    synced: { '.obsidian/workspace.json': 'sha-repo' },
    local: { '.obsidian/workspace.json': 'sha-live' },
  });
  assert.deepEqual(later.conflict, [], 'never a permanent conflict');
  assert.deepEqual(later.write, [], 'never yanks the open workspace around');
  assert.deepEqual(later.unchanged, ['.obsidian/workspace.json']);
});

test('planSync does not delete device-local workspace state when the repo drops it', () => {
  const plan = gh.planSync({
    remote: {},
    synced: { '.obsidian/workspace.json': 'sha-repo' },
    local: { '.obsidian/workspace.json': 'sha-repo' },
  });
  assert.deepEqual(plan.delete, []);
  assert.deepEqual(plan.conflict, []);
});

test('planSync tolerates missing state objects', () => {
  const plan = gh.planSync({});
  assert.deepEqual(plan, { write: [], delete: [], conflict: [], unchanged: [] });
});

// ── per-vault state (localStorage round-trip) ──────────────────────────────

test('getVaultState/setVaultState round-trip, and getVaultState rejects a half-written entry', () => {
  assert.equal(gh.getVaultState('v1'), null);
  gh.setVaultState('v1', { owner: 'o', repo: 'r', ref: 'main', commit: 'abc', blobs: { 'a.md': 's' } });
  const st = gh.getVaultState('v1');
  assert.equal(st.owner, 'o');
  assert.equal(st.commit, 'abc');
  assert.deepEqual(st.blobs, { 'a.md': 's' });

  localStorage.setItem('ow-github:v2', JSON.stringify({ ref: 'main' })); // no owner/repo
  assert.equal(gh.getVaultState('v2'), null);

  localStorage.setItem('ow-github:v3', 'not json');
  assert.equal(gh.getVaultState('v3'), null);
});

test('getVaultState always returns a blobs map, even when the stored entry has none', () => {
  localStorage.setItem('ow-github:v4', JSON.stringify({ owner: 'o', repo: 'r', ref: 'main' }));
  assert.deepEqual(gh.getVaultState('v4').blobs, {});
});
