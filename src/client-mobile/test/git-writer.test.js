'use strict';

/**
 * Unit tests for the pure half of storage/git-writer.js — everything that
 * decides the BYTES of a git object, which is the only thing standing between
 * "a real clone" and "a corrupt repository nobody can open".
 *
 *   buildTreeObjects   — a tree's bytes, and therefore its sha
 *   resolveCommitBody  — recovering the exact commit object from an API
 *                        response that has thrown away part of it
 *   buildIndex         — the DIRC file that makes `git status` clean
 *   configText         — what `git pull` will and won't try to do
 *
 * The FIXTURE below is not invented: it is `git ls-tree -r -t -l` plus
 * `git cat-file commit` from a repository built by real git, with the commit
 * dates put through the same normalisation GitHub's REST API applies (both
 * reported as "…Z", original offsets discarded). So every sha here is git's
 * own answer, and a test failing means our bytes disagree with git's — which
 * is exactly the failure worth catching.
 *
 * The fixture deliberately includes the cases that broke earlier attempts:
 *   a.md / a-b.md / a/       tree entries sort as if a directory ended in "/",
 *                            so the order here is a.md's byte '.' (46) against
 *                            the tree's implied '/' (47)
 *   Ünï.md                   a non-ASCII name (byte order, not code-point order)
 *   lnk (120000), sub (160000), a-b.md (100755)
 *                            modes that never reach the working directory
 *   author +0545 / committer -0330
 *                            two DIFFERENT non-UTC offsets, the case that
 *                            forces the cross-product pass of the search
 *
 * The writing half (writeRepo/writeObject) is verified end-to-end against real
 * `git fsck` / `git status` / `git fetch --unshallow` — see the slice notes;
 * a mock store here would only re-assert the mock.
 */

const assert = require('assert/strict');
const test = require('node:test');

const gw = require('../storage/git-writer');

const FIXTURE = {
  head: '8abde5cb03791c169de746ad0fe6f68e055b66f9',
  rootTree: 'e13c7c18de2d32c74dcd89aeabe7dbb98c24422a',
  entries: [
    { path: 'a-b.md', mode: '100755', type: 'blob', sha: '81bf396956110ad81c14860af1bbcc9dfbe4df20', size: 3 },
    { path: 'a.md', mode: '100644', type: 'blob', sha: '78981922613b2afb6025042ff6bd878ac1994e85', size: 2 },
    { path: 'a', mode: '040000', type: 'tree', sha: 'e24649deb540dcf7f7e96d060623e3b75bfe587f' },
    { path: 'a/inner.md', mode: '100644', type: 'blob', sha: 'f05648e753bc95da97c2b753903c1111061d67af', size: 6 },
    { path: 'bin.dat', mode: '100644', type: 'blob', sha: '494b1410a95b9ef0a980c33411fbf7d564472741', size: 3 },
    { path: 'lnk', mode: '120000', type: 'blob', sha: 'e77de8562fa61286381cc40e34a75024c20e17eb', size: 4 },
    { path: 'sub', mode: '160000', type: 'commit', sha: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d' },
    { path: 'Ünï.md', mode: '100644', type: 'blob', sha: '4ae8ef021bf6fcfff43a13be5abfa52bb6fb5dbc', size: 2 },
  ],
  // exactly what GitHub returns for this commit — offsets normalised away
  commitJson: {
    sha: '8abde5cb03791c169de746ad0fe6f68e055b66f9',
    tree: { sha: 'e13c7c18de2d32c74dcd89aeabe7dbb98c24422a' },
    parents: [],
    author: { name: 'Fixture Author', email: 'fixture@example.com', date: '2024-05-06T01:23:09Z' },
    committer: { name: 'Fixture Author', email: 'fixture@example.com', date: '2024-05-06T05:33:04Z' },
    message: 'fixture commit\n\nbody line',
    verification: { verified: false, reason: 'unsigned', signature: null, payload: null },
  },
  // what git actually stored, byte for byte
  rawCommit: 'tree e13c7c18de2d32c74dcd89aeabe7dbb98c24422a\n' +
    'author Fixture Author <fixture@example.com> 1714958589 +0545\n' +
    'committer Fixture Author <fixture@example.com> 1714973584 -0330\n' +
    '\nfixture commit\n\nbody line\n',
};

// ── tree objects ───────────────────────────────────────────────────────────

test('buildTreeObjects reproduces git\'s own tree shas', async () => {
  const r = await gw.buildTreeObjects(FIXTURE.entries);
  assert.deepEqual(r.mismatched, [], 'no tree may disagree with the sha GitHub reported');
  assert.equal(r.root, FIXTURE.rootTree);
  assert.equal(r.objects.length, 2);                    // the root and "a/"
  assert.ok(r.objects.some((o) => o.path === 'a'));
});

test('buildTreeObjects reports a mismatch instead of writing a wrong object', async () => {
  const bad = FIXTURE.entries.map((e) =>
    (e.path === 'a' ? Object.assign({}, e, { sha: '0'.repeat(40) }) : e));
  const r = await gw.buildTreeObjects(bad);
  assert.deepEqual(r.mismatched, ['a']);
});

test('tree entries sort with a directory\'s implied trailing slash', () => {
  const entries = [
    { name: 'a.md', isTree: false },
    { name: 'a', isTree: true },
    { name: 'a-b.md', isTree: false },
  ];
  assert.deepEqual(
    entries.slice().sort(gw.compareTreeEntries).map((e) => e.name),
    ['a-b.md', 'a.md', 'a']);      // '-'(45) < '.'(46) < '/'(47)
});

test('gitEntryMode drops the API\'s leading zero and trusts type over mode', () => {
  assert.equal(gw.gitEntryMode({ type: 'tree', mode: '040000' }), '40000');
  assert.equal(gw.gitEntryMode({ type: 'blob', mode: '100644' }), '100644');
  assert.equal(gw.gitEntryMode({ type: 'blob', mode: '120000' }), '120000');
  assert.equal(gw.gitEntryMode({ type: 'commit', mode: '160000' }), '160000');
});

// ── the commit object ──────────────────────────────────────────────────────

test('resolveCommitBody recovers the exact commit despite UTC-normalised dates', async () => {
  const body = await gw.resolveCommitBody(FIXTURE.commitJson, FIXTURE.head);
  assert.ok(body, 'the offset search must find the commit');
  assert.equal(Buffer.from(body).toString('utf8'), FIXTURE.rawCommit);
});

test('resolveCommitBody returns null rather than an unverified object', async () => {
  const body = await gw.resolveCommitBody(FIXTURE.commitJson, '0'.repeat(40));
  assert.equal(body, null);
});

test('a signed commit is tried as payload+gpgsig before any offset search', () => {
  const signed = {
    verification: {
      payload: 'tree ' + FIXTURE.rootTree + '\n' +
        'author A <a@x> 1 +0000\ncommitter C <c@x> 2 +0000\n\nhello',
      signature: '-----BEGIN PGP SIGNATURE-----\n\nabc\n-----END PGP SIGNATURE-----\n',
    },
  };
  const first = gw.commitCandidates(signed).next().value;
  assert.match(first, /^tree .*\nauthor A <a@x> 1 \+0000\ncommitter C <c@x> 2 \+0000\ngpgsig -----BEGIN/);
  // continuation lines are indented by exactly one space, blank ones included
  assert.ok(first.includes('gpgsig -----BEGIN PGP SIGNATURE-----\n \n abc\n -----END PGP SIGNATURE-----\n \n\nhello'));
});

test('the offset search tries UTC first and covers the quarter-hour zones', () => {
  const zones = gw.timezoneOffsets();
  assert.equal(zones[0], '+0000');
  assert.ok(zones.includes('+0545'));      // Nepal
  assert.ok(zones.includes('-0330'));      // Newfoundland
  assert.ok(zones.includes('+1245'));      // Chatham
  assert.ok(zones.indexOf('+0100') < zones.indexOf('+0545'), 'whole hours before quarters');
});

// ── the index ──────────────────────────────────────────────────────────────

async function parseIndex(bytes) {
  const buf = Buffer.from(bytes);
  assert.equal(buf.slice(0, 4).toString(), 'DIRC');
  const version = buf.readUInt32BE(4);
  const count = buf.readUInt32BE(8);
  const entries = [];
  let at = 12;
  for (let i = 0; i < count; i++) {
    const mode = buf.readUInt32BE(at + 24);
    const size = buf.readUInt32BE(at + 36);
    const sha = buf.slice(at + 40, at + 60).toString('hex');
    const flags = buf.readUInt16BE(at + 60);
    const nameLen = flags & 0xfff;
    const name = buf.slice(at + 62, at + 62 + nameLen).toString('utf8');
    entries.push({ name, mode, size, sha, assumeValid: !!(flags & 0x8000) });
    // git's own rule (read-cache.c): the ENTRY's length is padded to a
    // multiple of 8 with at least one NUL — which is not the same as the file
    // offset being aligned, since the 12-byte header comes first.
    const len = 62 + nameLen;
    const entryLen = (len + 8) & ~7;
    assert.equal(entryLen % 8, 0);
    assert.ok(entryLen > len, 'a name must always be NUL-terminated');
    at += entryLen;
  }
  const trailer = buf.slice(at).toString('hex');
  const { createHash } = require('crypto');
  assert.equal(createHash('sha1').update(buf.slice(0, at)).digest('hex'), trailer,
    'the trailing checksum must cover the whole file');
  assert.equal(at + 20, buf.length);
  return { version, count, entries };
}

test('buildIndex writes a DIRC v2 file git can read', async () => {
  const bytes = await gw.buildIndex([
    { path: 'Ünï.md', mode: '100644', sha: FIXTURE.entries[7].sha, size: 2 },
    { path: 'a.md', mode: '100644', sha: FIXTURE.entries[1].sha, size: 2 },
    { path: 'a-b.md', mode: '100755', sha: FIXTURE.entries[0].sha, size: 3 },
    { path: 'lnk', mode: '120000', sha: FIXTURE.entries[5].sha, size: 4, assumeValid: true },
  ]);
  const idx = await parseIndex(bytes);
  assert.equal(idx.version, 2);
  assert.equal(idx.count, 4);
  // sorted by raw bytes — the multi-byte name sorts last, not first
  assert.deepEqual(idx.entries.map((e) => e.name), ['a-b.md', 'a.md', 'lnk', 'Ünï.md']);
  assert.equal(idx.entries[0].mode, 0o100755);
  assert.equal(idx.entries[1].mode, 0o100644);
  assert.equal(idx.entries[2].mode, 0o120000);
  assert.equal(idx.entries[1].size, 2);
});

test('buildIndex marks only the not-checked-out paths assume-valid', async () => {
  const bytes = await gw.buildIndex([
    { path: 'here.md', mode: '100644', sha: '0'.repeat(40), size: 1 },
    { path: 'missing.bin', mode: '100644', sha: '1'.repeat(40), size: 99, assumeValid: true },
  ]);
  const idx = await parseIndex(bytes);
  assert.equal(idx.entries[0].assumeValid, false);
  assert.equal(idx.entries[1].assumeValid, true);
});

// ── .git/shallow ───────────────────────────────────────────────────────────

// The one write-side invariant worth a unit test: it is not observable in a
// single clone, only two syncs later. Measured before the fix — `git fsck`
// answered "broken link from commit <previous> to commit <its parent>".
test('addShallow keeps every boundary it has ever declared', async () => {
  const files = {};
  const store = {
    async readFile({ path: p }) {
      if (!(p in files)) throw new Error('ENOENT');
      return { data: files[p] };
    },
    async writeFile({ path: p, data }) { files[p] = data; return { uri: '' }; },
  };
  const first = 'a'.repeat(40);
  const second = 'b'.repeat(40);

  await gw.addShallow(store, first);
  assert.equal(files['.git/shallow'], first + '\n');

  // a later pull: the previous commit's object is still on disk and still has
  // a parent nobody downloaded, so its entry must survive
  await gw.addShallow(store, second);
  assert.equal(files['.git/shallow'], first + '\n' + second + '\n');

  await gw.addShallow(store, second);      // idempotent
  assert.equal(files['.git/shallow'], first + '\n' + second + '\n');
});

// ── config ─────────────────────────────────────────────────────────────────

test('exact mode configures the single branch it actually cloned', () => {
  const text = gw.configText({ owner: 'o', repo: 'r', branch: 'trunk', exact: true, ignoreCase: true });
  assert.match(text, /url = https:\/\/github\.com\/o\/r\.git/);
  assert.match(text, /fetch = \+refs\/heads\/trunk:refs\/remotes\/origin\/trunk/);
  assert.match(text, /\[branch "trunk"\]/);
  assert.match(text, /merge = refs\/heads\/trunk/);
  // pinned off: the working files are byte-identical to the blobs, and Git for
  // Windows turns autocrlf on in its own system config
  assert.match(text, /autocrlf = false/);
});

test('snapshot mode claims no upstream branch', () => {
  const text = gw.configText({ owner: 'o', repo: 'r', branch: 'trunk', exact: false, ignoreCase: false });
  assert.doesNotMatch(text, /\[branch "trunk"\]/);
  assert.match(text, /fetch = \+refs\/heads\/\*:refs\/remotes\/origin\/\*/);
});
