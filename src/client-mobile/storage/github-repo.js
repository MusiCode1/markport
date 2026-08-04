/**
 * github-repo.js — "open a GitHub repository as a vault".
 *
 * A `github` vault is an OPFS-backed vault (byte-for-byte the same storage a
 * `local` vault uses — same OpfsStore, same `/_owres/` SW path, same seeding
 * guards) whose contents are materialised from a GitHub repository. This
 * module is the only piece that knows about GitHub; everything downstream
 * treats the vault as ordinary OPFS.
 *
 * Why clone-into-OPFS instead of a live HTTP-backed filesystem: Obsidian's
 * CapacitorAdapter does one `watchAndStatAll` plus hundreds of stat/read
 * calls at vault-open, and the metadata indexer re-reads every note. A
 * per-call network backend would be unusable (latency) and would exhaust
 * GitHub's rate limit on the first boot. Cloning once gives full offline
 * read/write, search, graph and backlinks for free.
 *
 * Network shape — deliberately CORS-direct, no proxy (measured, see below):
 *   - `api.github.com` sends `Access-Control-Allow-Origin: *`  → 2 calls per
 *     sync (resolve commit, list tree), so the anonymous 60/hour budget is
 *     never the limiting factor.
 *   - `raw.githubusercontent.com` also sends `*`, and is NOT metered against
 *     the API rate limit → every file body comes from there, pinned to the
 *     resolved COMMIT sha (not the branch name) so a push mid-clone can't
 *     splice two trees together.
 *   - `codeload.github.com` (the zipball/tarball redirect target) answers
 *     `Access-Control-Allow-Origin: https://render.githubusercontent.com`,
 *     i.e. it is NOT usable from a page — that's why this fetches per-blob
 *     rather than unpacking an archive.
 *   - `github.com/<o>/<r>.git/info/refs?service=git-upload-pack` (git's own
 *     transport) sends NO CORS header at all, so the packfile protocol is
 *     unreachable from a page. A folder-backed clone still gets a real `.git`
 *     — storage/git-writer.js builds it out of these same REST responses and
 *     verifies every object against the sha GitHub reported.
 * With a token, blob bodies go through `api.github.com/.../git/blobs/<sha>`
 * with `Accept: application/vnd.github.raw` instead, which is the only route
 * that works for a private repository (raw.githubusercontent.com rejects
 * Authorization headers cross-origin).
 *
 * Per-vault state lives in `localStorage['ow-github:'+vaultId]` — same
 * convention as the pull-sync engine's `ow-sync:<id>` (run-pull.js §3ה):
 *   { owner, repo, ref, commit, syncedAt, token?, blobs: {path: blobSha},
 *     gitCommit? }
 * `gitCommit` is the commit whose `.git` directory (storage/git-writer.js) is
 * COMPLETE on disk, and is deliberately not the same field as `commit`: a
 * vault cloned before that feature existed — or one whose git write failed —
 * has files at a commit with no objects behind them, and only a separate
 * field can say so. Absent ⇒ the next sync rebuilds the object store from
 * scratch (reading the files it already has, not re-downloading them).
 * The vault registry entry itself only carries `type:'github'` — no
 * duplicated metadata, one source of truth.
 *
 * `blobs` is what makes a second sync a *pull* rather than a re-clone: it is
 * the sha each path had when we last wrote it, so a three-way comparison
 * (remote sha / last-synced sha / the file's CURRENT git blob sha, computed
 * locally via SHA-1) can tell "changed upstream" from "edited here" and
 * never silently clobbers the user's own edit. See syncVault() below.
 *
 * A `github` vault is also the only kind that can be opened from a URL alone:
 * `/github/<owner>/<repo>[/<note>]` (parseShareLink below, routed in boot.js)
 * clones on first visit. `/vault/<id>` cannot be shared — the id is a key into
 * the sender's own browser registry and means nothing on another device.
 *
 * Browser-attached IIFE (window.__owGithubRepo) with a CommonJS export for
 * node:test — the pure half (parseRepoRef/parseShareLink/gitBlobSha/planSync)
 * is unit-tested in test/github-repo.test.js; the network half is exercised in
 * the browser.
 * Style follows the rest of client-mobile: no `?.`, no `??`.
 */
(function () {
  'use strict';

  var API_BASE = 'https://api.github.com';
  var RAW_BASE = 'https://raw.githubusercontent.com';

  // Files larger than this are skipped rather than pulled into OPFS. Obsidian
  // vaults are notes plus attachments; a single >25MB blob in a repo is
  // almost always a build artifact, and writing it would cost far more than
  // it's worth on a browser-quota-backed filesystem. Reported, never silent.
  var MAX_FILE_BYTES = 25 * 1024 * 1024;

  // Parallel body fetches. 8 keeps a cold clone fast without tripping
  // GitHub's abuse detection or queueing 500 sockets in the browser.
  var CONCURRENCY = 8;

  // ── pure helpers (unit-tested under node:test) ──────────────────────────

  // GitHub restricts both to these characters; validating here means a
  // typo'd paste fails with our message instead of a confusing 404 later.
  var NAME_RE = /^[A-Za-z0-9._-]+$/;

  /**
   * parseRepoRef(input) → {owner, repo, ref} | null
   *
   * Accepts every shape a user actually pastes:
   *   https://github.com/owner/repo            git@github.com:owner/repo.git
   *   https://github.com/owner/repo.git        owner/repo
   *   https://github.com/owner/repo/tree/main  owner/repo#branch
   * `ref` is null when unspecified — the caller resolves the repo's own
   * default branch (which is NOT always `main`: the test repo used to verify
   * this feature, notnilcn/ggdd, defaults to `master`).
   *
   * Everything after `/tree/` is taken as the ref, slashes included:
   * `release/1.x` is a legal branch name, and a branch is far likelier than
   * someone hand-writing a subdirectory URL they expect to become a vault.
   */
  function parseRepoRef(input) {
    var s = String(input || '').trim();
    if (!s) return null;

    var ref = null;

    // owner/repo#branch — the `#branch` suffix is our own shorthand, not a
    // GitHub URL form, so strip it before any URL parsing.
    var hash = s.indexOf('#');
    if (hash !== -1) {
      ref = s.slice(hash + 1) || null;
      s = s.slice(0, hash);
    }

    // git@github.com:owner/repo(.git) → normalise to the path form below.
    var scp = s.match(/^git@github\.com:(.+)$/i);
    if (scp) s = scp[1];

    // Any github.com URL (with or without scheme) → keep just the path.
    s = s.replace(/^[a-z+]+:\/\//i, '');
    if (/^(www\.)?github\.com\//i.test(s)) s = s.replace(/^(www\.)?github\.com\//i, '');
    s = s.replace(/^\/+/, '').replace(/\/+$/, '');

    var parts = s.split('/');
    if (parts.length < 2) return null;
    var owner = parts[0];
    var repo = parts[1].replace(/\.git$/i, '');
    if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) return null;

    // An explicit ref in the URL wins over the `#branch` shorthand (it's the
    // more specific form). The two URL forms are split differently on
    // purpose, because both are ambiguous and they resolve opposite ways:
    //   /tree/<rest>  — <rest> is a ref, possibly containing slashes
    //                   (`release/1.x`), OR a ref plus a subdirectory. A
    //                   whole-repo vault is what this feature is for, so the
    //                   slashy-branch reading is the useful one → greedy.
    //   /blob/<rest>  — <rest> is a ref followed by a FILE path, always. Only
    //                   the first segment can be the ref → non-greedy.
    // Either way a wrong guess fails loudly at resolveCommit ("Branch or
    // commit ... not found"), never silently as a half-cloned vault.
    if (parts.length > 3 && parts[2] === 'tree') {
      ref = parts.slice(3).join('/') || ref;
    } else if (parts.length > 3 && parts[2] === 'blob') {
      ref = parts[3] || ref;
    }

    return { owner: owner, repo: repo, ref: ref || null };
  }

  /**
   * parseShareLink(pathname, search, hash) → {owner, repo, ref, note} | null
   *
   * The share-link route: `/github/<owner>/<repo>[/<note path>]`. This is what
   * makes a vault shareable as a plain URL — the recipient's browser clones
   * the repository on first visit instead of hitting a `/vault/<id>` that only
   * ever existed in the sender's browser storage (the id is a local registry
   * key, not an identity anyone else can resolve).
   *
   * `note` is returned STILL PERCENT-ENCODED, exactly as it appeared in the
   * path. The caller's only job with it is to paste it onto `/vault/<id>/`,
   * and the incoming encoding is already the per-segment encoding that route
   * expects — decoding and re-encoding here would be a round trip whose only
   * possible outcome is a difference.
   *
   * The branch is NOT taken from the path: everything after `<repo>` is note
   * path, and a note path can be any depth, so there is no unambiguous slot
   * left for a ref. It comes from `?ref=` (or a `#branch` fragment, matching
   * parseRepoRef's shorthand above); absent, the caller resolves the repo's
   * own default branch.
   */
  function parseShareLink(pathname, search, hash) {
    var m = String(pathname || '').match(/^\/github\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
    if (!m) return null;

    var owner, repo;
    try {
      owner = decodeURIComponent(m[1]);
      repo = decodeURIComponent(m[2]).replace(/\.git$/i, '');
    } catch (_) {
      return null;      // malformed %-escape — not a link we can act on
    }
    if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) return null;

    var ref = null;
    try {
      ref = new URLSearchParams(String(search || '')).get('ref') || null;
    } catch (_) { /* no URLSearchParams → fall through to the fragment */ }
    if (!ref && hash) {
      try { ref = decodeURIComponent(String(hash).replace(/^#/, '')) || null; }
      catch (_) { ref = null; }
    }

    return {
      owner: owner,
      repo: repo,
      ref: ref,
      note: (m[3] || '').replace(/\/+$/, ''),
    };
  }

  /**
   * gitBlobSha(bytes) → Promise<hex sha1>
   *
   * Git's own object id: sha1("blob " + byteLength + "\0" + bytes). Computing
   * it locally is what lets syncVault() ask "is this file still exactly what
   * we last wrote?" without keeping a second copy of the content anywhere —
   * the sha in the GitHub tree response is directly comparable.
   */
  function gitBlobSha(bytes) {
    var body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var header = 'blob ' + body.length + ' ';
    var out = new Uint8Array(header.length + body.length);
    for (var i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
    out.set(body, header.length);
    return crypto.subtle.digest('SHA-1', out).then(function (buf) {
      var view = new Uint8Array(buf);
      var hex = '';
      for (var j = 0; j < view.length; j++) hex += view[j].toString(16).padStart(2, '0');
      return hex;
    });
  }

  /**
   * Obsidian's own device-local UI state: which panes are open, scroll
   * positions, the last active file. Obsidian rewrites these continuously
   * while the vault is open, so by the time any pull runs they differ from
   * the repo's copy — measured: a forced re-sync of an untouched clone
   * reported `.obsidian/workspace.json` as a conflict every single time.
   * Treating them as content would mean a permanent, unresolvable "kept
   * (edited here)" on every pull, and adopting the repo's copy would yank
   * the user's panes around mid-session. They are seeded once (so a fresh
   * clone opens the way the repo intends) and then left alone forever.
   */
  var DEVICE_LOCAL_PATHS = {
    '.obsidian/workspace.json': true,
    '.obsidian/workspace-mobile.json': true,
  };

  /**
   * planSync({remote, synced, local}) → {write, delete, conflict, unchanged}
   *
   * The three-way decision, extracted as a pure function so its (many) cases
   * are unit-testable without a network or OPFS.
   *   remote — {path: blobSha} from the GitHub tree we're syncing to
   *   synced — {path: blobSha} we last wrote (empty on a first clone)
   *   local  — {path: blobSha|null} what is on disk now (null = absent)
   *
   * Rules, data-safety first:
   *   - absent locally            → write (this is the whole clone path)
   *   - local === remote          → unchanged (already there, byte-identical)
   *   - local === synced          → write (clean upstream change, no local edit)
   *   - local !== synced          → CONFLICT: the user edited it here AND it
   *                                 moved upstream. Never overwrite; report.
   *   - gone upstream, local === synced → delete (clean upstream deletion)
   *   - gone upstream, local edited     → CONFLICT-ish: keep the file, silently
   *                                 dropping the user's only copy is worse
   *                                 than leaving an extra note behind.
   */
  function planSync(state) {
    var remote = state.remote || {};
    var synced = state.synced || {};
    var local = state.local || {};
    var plan = { write: [], delete: [], conflict: [], unchanged: [] };

    Object.keys(remote).forEach(function (path) {
      var r = remote[path];
      var l = local[path];
      var s = synced[path];
      if (!l) { plan.write.push(path); return; }
      // Device-local state: present locally is the end of it — never
      // rewritten, never reported (see DEVICE_LOCAL_PATHS above).
      if (DEVICE_LOCAL_PATHS[path]) { plan.unchanged.push(path); return; }
      if (l === r) { plan.unchanged.push(path); return; }
      if (l === s) { plan.write.push(path); return; }
      plan.conflict.push(path);
    });

    Object.keys(synced).forEach(function (path) {
      if (Object.prototype.hasOwnProperty.call(remote, path)) return;
      var l = local[path];
      if (!l) return;                       // already gone locally — nothing to do
      if (DEVICE_LOCAL_PATHS[path]) return;  // ours now, not the repo's to delete
      if (l === synced[path]) plan.delete.push(path);
      else plan.conflict.push(path);        // edited here, deleted upstream → keep
    });

    return plan;
  }

  // ── per-vault state (localStorage['ow-github:'+vaultId]) ────────────────

  function stateKeyFor(vaultId) { return 'ow-github:' + vaultId; }

  function getVaultState(vaultId) {
    try {
      var raw = localStorage.getItem(stateKeyFor(vaultId));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.owner || !parsed.repo) return null;
      if (!parsed.blobs) parsed.blobs = {};
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function setVaultState(vaultId, state) {
    try {
      localStorage.setItem(stateKeyFor(vaultId), JSON.stringify(state));
      return true;
    } catch (e) {
      // Quota — a very large repo's blob manifest can outgrow localStorage.
      // Degrade instead of failing the sync that already succeeded: drop the
      // manifest and keep the identity fields, so the vault still opens and
      // still knows which repo it came from. The next pull then behaves like
      // a first clone (no `synced` map → any local edit reads as a conflict
      // and is preserved), which is the safe direction to fail in.
      console.warn('[ow-github] could not persist sync manifest — next pull will be conservative', e);
      try {
        var slim = {
          owner: state.owner, repo: state.repo, ref: state.ref,
          commit: state.commit, syncedAt: state.syncedAt, token: state.token, blobs: {},
        };
        localStorage.setItem(stateKeyFor(vaultId), JSON.stringify(slim));
      } catch (_) { /* nothing more we can do */ }
      return false;
    }
  }

  function clearVaultState(vaultId) {
    try { localStorage.removeItem(stateKeyFor(vaultId)); } catch (_) {}
  }

  // ── network ─────────────────────────────────────────────────────────────

  function apiHeaders(token, accept) {
    var h = { Accept: accept || 'application/vnd.github+json' };
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  // Turn GitHub's error responses into something a user can act on. The
  // status alone is not enough: a 404 on a repo means "not found OR private
  // and you gave us no token", which is the single most likely thing to go
  // wrong here.
  function describeHttpError(res, what) {
    if (res.status === 404) {
      return new Error(what + ' not found. If it is a private repository, add a ' +
        'personal access token with `repo` scope.');
    }
    if (res.status === 401 || res.status === 403) {
      var remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        return new Error('GitHub rate limit reached. Add a personal access token, or wait and retry.');
      }
      return new Error('GitHub refused the request (HTTP ' + res.status + '). Check the token and its scopes.');
    }
    return new Error('GitHub request failed (HTTP ' + res.status + ') for ' + what + '.');
  }

  async function apiJson(path, token, what) {
    var res = await fetch(API_BASE + path, { headers: apiHeaders(token) });
    if (!res.ok) throw describeHttpError(res, what);
    return res.json();
  }

  /**
   * resolveRepo(spec, opts) → {owner, repo, ref, name, isPrivate, htmlUrl}
   * One call; used by the "Open GitHub repository" dialog to validate the
   * input BEFORE a vault entry is created, and to learn the default branch.
   */
  async function resolveRepo(spec, opts) {
    var token = (opts && opts.token) || null;
    var meta = await apiJson('/repos/' + spec.owner + '/' + spec.repo, token,
      'Repository ' + spec.owner + '/' + spec.repo);
    return {
      owner: meta.owner && meta.owner.login ? meta.owner.login : spec.owner,
      repo: meta.name || spec.repo,
      ref: spec.ref || meta.default_branch || 'main',
      name: meta.name || spec.repo,
      isPrivate: !!meta.private,
      htmlUrl: meta.html_url || ('https://github.com/' + spec.owner + '/' + spec.repo),
    };
  }

  // Branch/tag/sha → the commit sha it currently points at. Pinning bodies to
  // a commit (not the branch) is what makes a clone internally consistent.
  async function resolveCommit(spec, opts) {
    var token = (opts && opts.token) || null;
    var c = await apiJson(
      '/repos/' + spec.owner + '/' + spec.repo + '/commits/' + encodeURIComponent(spec.ref),
      token, 'Branch or commit "' + spec.ref + '"');
    if (!c || !c.sha) throw new Error('GitHub did not return a commit for "' + spec.ref + '".');
    return c.sha;
  }

  /**
   * listTree(spec, commit, opts) → {blobs, sizes, entries, truncated}
   *
   * One recursive call, read twice for two different purposes:
   *
   *   `blobs`/`sizes` — what can become a VAULT FILE. Entries that cannot are
   *     dropped here rather than half-handled later: directories (`tree`),
   *     submodules (`commit`) and symlinks (mode 120000 — its "content" is a
   *     link target, and writing that as a note would be nonsense).
   *
   *   `entries` — the response UNFILTERED, which is what git-writer.js needs:
   *     a tree object must list every child a directory really has, including
   *     the symlinks and submodules the vault skips, or its sha comes out
   *     wrong. Kept as one call because it is one response — asking GitHub
   *     twice for the same tree would only add a way for the two views to
   *     disagree.
   */
  async function listTree(spec, commit, opts) {
    var token = (opts && opts.token) || null;
    var data = await apiJson(
      '/repos/' + spec.owner + '/' + spec.repo + '/git/trees/' + commit + '?recursive=1',
      token, 'Tree for ' + spec.owner + '/' + spec.repo);
    var blobs = {};
    var sizes = {};
    var all = [];
    var entries = (data && data.tree) || [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || !e.path || !e.sha) continue;
      all.push({
        path: e.path,
        mode: e.mode,
        type: e.type,
        sha: e.sha,
        size: typeof e.size === 'number' ? e.size : 0,
      });
      if (e.type !== 'blob' || e.mode === '120000') continue;
      blobs[e.path] = e.sha;
      sizes[e.path] = typeof e.size === 'number' ? e.size : 0;
    }
    return { blobs: blobs, sizes: sizes, entries: all, truncated: !!(data && data.truncated) };
  }

  // One file body. Without a token: raw.githubusercontent.com, which is not
  // metered against the API rate limit. With a token: the blobs API with the
  // raw media type, the only route that reaches a private repository from a
  // browser (raw.githubusercontent.com ignores/rejects cross-origin auth).
  async function fetchBlob(spec, commit, path, sha, opts) {
    var token = (opts && opts.token) || null;
    var res;
    if (token) {
      res = await fetch(API_BASE + '/repos/' + spec.owner + '/' + spec.repo + '/git/blobs/' + sha,
        { headers: apiHeaders(token, 'application/vnd.github.raw') });
    } else {
      var url = RAW_BASE + '/' + spec.owner + '/' + spec.repo + '/' + commit + '/' +
        path.split('/').map(encodeURIComponent).join('/');
      res = await fetch(url);
    }
    if (!res.ok) throw describeHttpError(res, 'File "' + path + '"');
    return new Uint8Array(await res.arrayBuffer());
  }

  // One blob body BY SHA, always through the blobs API. raw.githubusercontent
  // needs a path, and the one caller here (symlink bodies, for the git object
  // store) has no usable path: raw serves what a symlink POINTS AT, not the
  // link itself, which would put the wrong bytes under the right object id.
  // Metered against the API rate limit, hence the cap at the call site.
  async function fetchBlobBySha(spec, sha, opts) {
    var token = (opts && opts.token) || null;
    var res = await fetch(API_BASE + '/repos/' + spec.owner + '/' + spec.repo + '/git/blobs/' + sha,
      { headers: apiHeaders(token, 'application/vnd.github.raw') });
    if (!res.ok) throw describeHttpError(res, 'Blob ' + sha);
    return new Uint8Array(await res.arrayBuffer());
  }

  // ArrayBuffer → base64, chunked (btoa blows the argument stack at ~65k
  // bytes). Same shape as opfs-store.js's private `arrayBufferToBase64` and
  // run-pull.js's copy of it — anchored by symbol name, per the convention
  // noted in run-pull.js.
  function bytesToBase64(bytes) {
    var CHUNK = 0x8000;
    var s = '';
    for (var i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  function base64ToBytes(b64) {
    var bin = atob(b64 || '');
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Run `worker` over `items` with at most CONCURRENCY in flight. Plain
  // promise pool — no dependency, and it keeps a 900-file clone from opening
  // 900 sockets at once.
  async function pool(items, worker) {
    var index = 0;
    var runners = [];
    var width = Math.min(CONCURRENCY, items.length);
    for (var i = 0; i < width; i++) {
      runners.push((async function () {
        while (index < items.length) {
          var mine = index++;
          await worker(items[mine], mine);
        }
      })());
    }
    await Promise.all(runners);
  }

  // storage/git-writer.js, however this file is being run. Optional on
  // purpose: a browser without CompressionStream, or a deployment that did
  // not ship the module, still gets a working vault — just no `.git`.
  function gitWriter() {
    if (typeof window !== 'undefined' && window.__owGitWriter) return window.__owGitWriter;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try { return require('./git-writer'); } catch (_) { return null; }
    }
    return null;
  }

  // Symlink bodies cost one rate-limited API call each (fetchBlobBySha above).
  // A vault-shaped repository has a handful at most; a repository with
  // hundreds is not worth spending the anonymous 60/hour budget on, and the
  // index marks the rest assume-valid either way, so `git status` stays clean.
  var MAX_SYMLINK_FETCHES = 25;

  /**
   * syncVault(store, vaultId, opts) → {commit, written, deleted, unchanged,
   *                                    conflicts[], skipped[], upToDate, git}
   *
   * The single entry point boot.js uses for BOTH the first clone and every
   * later pull — they differ only in whether a `blobs` manifest exists.
   * `opts.onProgress({phase, done, total, path})` drives the boot overlay.
   *
   * `opts.git` additionally writes a real `.git` directory (git-writer.js), so
   * the download is a clone rather than a copy of the files. boot.js turns it
   * on for folder-backed vaults only: a `.git` inside OPFS would be invisible
   * to every git there is, while still costing a second compressed copy of
   * every file against the browser's storage quota.
   *
   * The manifest is written only after the file writes finish, so an
   * interrupted sync (closed tab, dropped connection) resumes correctly on
   * the next attempt instead of recording work it never did.
   */
  async function syncVault(store, vaultId, opts) {
    opts = opts || {};
    var state = getVaultState(vaultId);
    if (!state) throw new Error('This vault has no GitHub repository configured.');
    var spec = { owner: state.owner, repo: state.repo, ref: state.ref };
    var token = opts.token || state.token || null;
    var net = { token: token };
    var progress = opts.onProgress || function () {};

    // `gitCommit` is the commit whose .git is COMPLETE on disk — deliberately
    // separate from `commit` (the files' commit), because the two can differ:
    // a vault cloned before this feature existed, or one whose git write
    // failed, has files at a commit and no objects for them. That gap is what
    // makes the "already up to date" shortcut below unsafe to take here.
    var gitw = opts.git ? gitWriter() : null;
    if (gitw && !gitw.isSupported()) {
      console.warn('[ow-github] this browser cannot build a .git (needs CompressionStream) — files only');
      gitw = null;
    }

    progress({ phase: 'resolve', done: 0, total: 0 });
    var commit = await resolveCommit(spec, net);
    if (commit === state.commit && !opts.force && !(gitw && state.gitCommit !== commit)) {
      return { commit: commit, written: 0, deleted: 0, unchanged: 0, conflicts: [], skipped: [], upToDate: true };
    }

    progress({ phase: 'tree', done: 0, total: 0 });
    var tree = await listTree(spec, commit, net);
    var remote = tree.blobs;
    var paths = Object.keys(remote);

    // Oversized files never enter the plan at all — reported as `skipped`.
    var skipped = [];
    for (var i = 0; i < paths.length; i++) {
      if (tree.sizes[paths[i]] > MAX_FILE_BYTES) {
        skipped.push(paths[i]);
        delete remote[paths[i]];
      }
    }
    if (tree.truncated) {
      // GitHub caps a recursive tree response. Say so rather than presenting
      // a partial clone as complete.
      console.warn('[ow-github] tree response was truncated by GitHub — some files were not listed');
    }

    // Current on-disk state, as git blob shas — the third leg of planSync's
    // comparison. Fast path first: a never-synced vault that is still empty
    // (the overwhelmingly common "clone" case) needs no per-path probing at
    // all, only one readdir, instead of N guaranteed-miss OPFS lookups.
    progress({ phase: 'scan', done: 0, total: 0 });
    var synced = state.blobs || {};
    var local = {};
    var isFirstSync = !state.commit && Object.keys(synced).length === 0;
    var vaultIsEmpty = false;
    if (isFirstSync) {
      try {
        var listing = await store.readdir({ path: '' });
        vaultIsEmpty = !listing || !listing.files || listing.files.length === 0;
      } catch (_) { /* unreadable → fall through to the full scan */ }
    }
    if (!vaultIsEmpty) {
      var interesting = Object.keys(remote).concat(
        Object.keys(synced).filter(function (p) { return !Object.prototype.hasOwnProperty.call(remote, p); }));
      await pool(interesting, async function (path) {
        try {
          var r = await store.readFile({ path: path });
          local[path] = await gitBlobSha(base64ToBytes(r.data));
        } catch (_) {
          local[path] = null;      // absent
        }
      });
    }

    var plan = planSync({ remote: remote, synced: synced, local: local });

    var total = plan.write.length + plan.delete.length;
    var done = 0;
    progress({ phase: 'download', done: 0, total: total });

    // The manifest we'll persist. Built per-outcome rather than seeded from
    // `remote` wholesale — recording a sha we did NOT write is what would
    // make a later pull mistake an untouched file for a local edit (or the
    // reverse), so each case states its own answer:
    var nextBlobs = {};
    // "unchanged" records the sha of what is actually on disk, not the
    // remote one. They are the same thing for ordinary files (that's what
    // made them unchanged), but a DEVICE_LOCAL_PATHS entry lands here while
    // legitimately differing from the repo — recording `remote` there would
    // claim we wrote a copy we deliberately did not.
    plan.unchanged.forEach(function (p) { nextBlobs[p] = local[p] || remote[p]; });
    plan.conflict.forEach(function (p) {
      // Keep what we knew before (possibly nothing). Either way the same
      // comparison re-runs next pull and the file stays a conflict until the
      // user resolves it — we never quietly adopt one side.
      if (Object.prototype.hasOwnProperty.call(synced, p)) nextBlobs[p] = synced[p];
    });
    // plan.write entries are recorded below, only once the write succeeds;
    // plan.delete entries are deliberately absent (the path is gone).

    // Blob shas whose loose object this run has already written. Kept so the
    // git phase below can tell "already stored" from "still needs bytes"
    // without a stat per object — the download loop is where the bytes exist,
    // and holding them until a later phase would mean holding the whole
    // repository in memory.
    var haveObject = {};
    var gitFailures = [];

    var failures = [];
    await pool(plan.write, async function (path) {
      try {
        var bytes = await fetchBlob(spec, commit, path, remote[path], net);
        await store.writeFile({ path: path, data: bytesToBase64(bytes) });
        nextBlobs[path] = remote[path];
        // The object store is a separate concern from the file: a git write
        // that fails must not make the FILE look unwritten (which is what
        // landing in `failures` means, and would cost a re-download next
        // pull). gitFailures below carries it instead, and its only effect is
        // that .git is not recorded as complete.
        if (gitw) {
          try {
            await gitw.writeVerifiedObject(store, remote[path], 'blob', bytes);
            haveObject[remote[path]] = true;
          } catch (ge) {
            gitFailures.push(path);
            console.warn('[ow-github] failed to store git object for ' + path, ge);
          }
        }
      } catch (e) {
        // Left out of nextBlobs entirely — an unwritten path must not be
        // recorded as synced, or the next pull would skip it forever.
        failures.push(path);
        console.warn('[ow-github] failed to fetch ' + path, e);
      }
      done++;
      progress({ phase: 'download', done: done, total: total, path: path });
    });

    for (var d = 0; d < plan.delete.length; d++) {
      try { await store.deleteFile({ path: plan.delete[d] }); }
      catch (e) { console.warn('[ow-github] failed to delete ' + plan.delete[d], e); }
      done++;
      progress({ phase: 'download', done: done, total: total, path: plan.delete[d] });
    }

    // ── the .git directory (opt-in — see opts.git above) ──────────────────
    var git = null;
    if (gitw && tree.truncated) {
      // A truncated listing is a tree we do not fully know. Every directory
      // object above a missing entry would hash to the wrong id, so there is
      // nothing to build — and a corrupt .git is worse than none.
      git = { error: 'GitHub truncated the file listing — no .git was written' };
      console.warn('[ow-github] ' + git.error);
    } else if (gitw) {
      try {
        git = await writeGitDirectory({
          store: store, spec: spec, commit: commit, tree: tree, net: net, gitw: gitw,
          remote: remote, local: local, synced: synced,
          skipped: skipped, failures: failures, gitFailures: gitFailures,
          haveObject: haveObject,
          // A vault whose .git was already complete at its last recorded
          // commit keeps every object it wrote then, so only what MOVED needs
          // storing. Without that record (a vault cloned before this feature,
          // or a previously failed git write) every blob has to be accounted
          // for — from disk where the file is already correct, from the
          // network only where it is not.
          incremental: !!state.gitCommit,
          progress: progress,
        });
      } catch (e) {
        git = { error: (e && e.message) || String(e) };
        console.warn('[ow-github] could not write .git', e);
      }
    }

    // Conflicted paths keep their previous synced sha (already carried over
    // above); everything else is now at the remote sha. Recording the commit
    // only when nothing failed keeps the next pull honest — a partial sync
    // must not look up-to-date.
    state.commit = failures.length ? state.commit : commit;
    state.blobs = nextBlobs;
    state.syncedAt = Date.now();
    if (token) state.token = token;
    // Recorded only when the whole .git landed — the same honesty the commit
    // field above keeps. A half-written object store that claimed to be
    // complete would never be repaired, because the next pull would believe it
    // and skip exactly the objects that are missing. A failed FILE counts too:
    // its blob never reached the object store either.
    if (git) {
      if (!git.error && !gitFailures.length && !failures.length) state.gitCommit = commit;
      else delete state.gitCommit;
    }
    setVaultState(vaultId, state);

    return {
      commit: commit,
      written: plan.write.length - failures.length,
      deleted: plan.delete.length,
      unchanged: plan.unchanged.length,
      conflicts: plan.conflict,
      failures: failures,
      skipped: skipped,
      git: git,
      upToDate: false,
    };
  }

  /**
   * writeGitDirectory(ctx) → {mode, objects, commit, ...}
   *
   * syncVault's git half, kept separate because it answers a different
   * question: syncVault decides what the WORKING TREE should contain, this
   * decides what the OBJECT STORE is missing. The two disagree by design —
   * a file the user edited locally is a conflict for the working tree (keep
   * theirs) and still needs the REMOTE blob stored, or `git status` could not
   * show the edit as an edit.
   */
  async function writeGitDirectory(ctx) {
    var gitw = ctx.gitw;
    var store = ctx.store;
    var remote = ctx.remote;
    var progress = ctx.progress;

    // Paths that are in the commit but will never be on disk. Listing them in
    // the index normally would make `git status` report deletions the user did
    // not make; git-writer.js marks these assume-valid instead.
    var notCheckedOut = {};
    ctx.skipped.forEach(function (p) { notCheckedOut[p] = true; });
    ctx.failures.forEach(function (p) { notCheckedOut[p] = true; });

    // Which blob objects are still missing. `incremental` means everything the
    // previous complete .git covered is still there, so a path whose remote
    // sha equals the sha we recorded last time needs nothing.
    var need = [];
    var remotePaths = Object.keys(remote);
    for (var i = 0; i < remotePaths.length; i++) {
      var p = remotePaths[i];
      if (notCheckedOut[p]) continue;                    // no object, no worktree file
      if (ctx.haveObject[remote[p]]) continue;           // stored moments ago
      if (ctx.incremental && ctx.synced[p] === remote[p]) continue;
      need.push(p);
    }

    var symlinks = [];
    for (var e = 0; e < ctx.tree.entries.length; e++) {
      var entry = ctx.tree.entries[e];
      if (entry.type === 'blob' && entry.mode === '120000') {
        symlinks.push(entry);
        notCheckedOut[entry.path] = true;   // the FSA API cannot create a symlink
      }
    }
    var symlinkBudget = Math.min(symlinks.length, MAX_SYMLINK_FETCHES);

    var gtotal = need.length + symlinkBudget;
    var gdone = 0;
    progress({ phase: 'git-objects', done: 0, total: gtotal });

    await pool(need, async function (path) {
      try {
        var bytes;
        if (ctx.local[path] === remote[path]) {
          // The file on disk already IS this blob (that is what made it
          // "unchanged"), so read it instead of spending a download on bytes
          // we are sitting on.
          var r = await store.readFile({ path: path });
          bytes = base64ToBytes(r.data);
        } else {
          bytes = await fetchBlob(ctx.spec, ctx.commit, path, remote[path], ctx.net);
        }
        await gitw.writeVerifiedObject(store, remote[path], 'blob', bytes);
      } catch (err) {
        ctx.gitFailures.push(path);
        console.warn('[ow-github] failed to store git object for ' + path, err);
      }
      gdone++;
      progress({ phase: 'git-objects', done: gdone, total: gtotal });
    });

    for (var s = 0; s < symlinkBudget; s++) {
      try {
        var linkBytes = await fetchBlobBySha(ctx.spec, symlinks[s].sha, ctx.net);
        await gitw.writeVerifiedObject(store, symlinks[s].sha, 'blob', linkBytes);
      } catch (err2) {
        console.warn('[ow-github] failed to store symlink object ' + symlinks[s].path, err2);
      }
      gdone++;
      progress({ phase: 'git-objects', done: gdone, total: gtotal });
    }

    // The commit object's own fields — the one thing not derivable from the
    // tree. See git-writer.js's header for why this response is enough.
    var commitJson = await apiJson(
      '/repos/' + ctx.spec.owner + '/' + ctx.spec.repo + '/git/commits/' + ctx.commit,
      ctx.net.token, 'Commit ' + ctx.commit);

    return gitw.writeRepo(store, {
      owner: ctx.spec.owner,
      repo: ctx.spec.repo,
      ref: ctx.spec.ref,
      commit: ctx.commit,
      entries: ctx.tree.entries,
      sizes: ctx.tree.sizes,
      commitJson: commitJson,
      notCheckedOut: notCheckedOut,
      onProgress: progress,
    });
  }

  var api = {
    parseRepoRef: parseRepoRef,
    parseShareLink: parseShareLink,
    gitBlobSha: gitBlobSha,
    planSync: planSync,
    resolveRepo: resolveRepo,
    resolveCommit: resolveCommit,
    listTree: listTree,
    syncVault: syncVault,
    getVaultState: getVaultState,
    setVaultState: setVaultState,
    clearVaultState: clearVaultState,
    MAX_FILE_BYTES: MAX_FILE_BYTES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof window !== 'undefined') {
    window.__owGithubRepo = api;
  }
})();
