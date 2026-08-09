/**
 * git-writer.js — turn a downloaded GitHub tree into a real `.git` directory.
 *
 * storage/github-repo.js materialises a repository's FILES (see its header for
 * why it fetches per-blob over CORS instead of unpacking an archive). What it
 * produced was a checkout without a repository: no history, no `git status`,
 * no `git pull`. This module adds the missing half — a `.git` that git itself
 * accepts as a `--depth 1 --single-branch` clone of the same commit.
 *
 * Why it is BUILT rather than fetched: git's own transport
 * (`github.com/<o>/<r>.git/info/refs?service=git-upload-pack`) answers with no
 * `Access-Control-Allow-Origin` header at all — measured, 2026-08 — so a page
 * cannot speak the packfile protocol to GitHub no matter what it sends. Every
 * in-browser git library works around this with a third-party CORS proxy;
 * routing a user's repository (and, for a private one, their token) through
 * someone else's server is not a trade this project makes. So: build the
 * objects locally out of data the CORS-open REST API does return, and verify
 * every one of them against the sha GitHub reported. Nothing is written on a
 * mismatch — a wrong object id is a corrupt repository, which is worse than
 * no repository.
 *
 * What lands on disk (identical in shape to `git clone --depth 1`):
 *   .git/objects/xx/…   loose zlib objects — one per blob, one per tree, one
 *                       for the commit
 *   .git/index          DIRC v2, so `git status` is CLEAN immediately
 *   .git/HEAD, refs/…, logs/…, config, shallow, info/exclude, description
 *
 * The three facts that make this possible:
 *
 *  1. TREES need no network. GitHub's recursive tree response carries every
 *     entry's mode, type and sha — including the sha of each subtree — so each
 *     tree object can be assembled independently and checked against the sha
 *     GitHub gave for that same path. (buildTreeObjects below.)
 *
 *  2. The COMMIT is the hard part, and has two routes. The REST API normalises
 *     `author.date`/`committer.date` to UTC ("…Z"), destroying the ±hhmm suffix
 *     that is part of the commit object's bytes — so a naive rebuild hashes to
 *     the wrong sha (measured on four repositories: always wrong). Therefore:
 *       (a) SIGNED commit → `verification.payload` IS the object's bytes minus
 *           the `gpgsig` header, timezone intact; splice the signature back in.
 *       (b) UNSIGNED commit → the instant is known exactly (the unix seconds
 *           are timezone-independent); only the ±hhmm TEXT is missing, and
 *           there are ~105 legal values. Try them, and accept only the
 *           candidate whose sha1 equals the sha we are cloning. Measured: the
 *           author==committer pass resolves it in ~150 hashes.
 *     Both routes are verified against the real sha, never assumed.
 *
 *  3. PARENTS are absent — this is a depth-1 clone — which is exactly what
 *     `.git/shallow` exists to declare. With it, git never looks for them.
 *
 * When neither commit route reproduces the sha (a commit carrying extra
 * headers the API does not expose — `mergetag`, `encoding`; in practice the
 * Linux kernel and little else), writeRepo falls back to SNAPSHOT mode: a root
 * commit over the same, verified tree. Content and `git status` are still
 * exact; only the history is one synthetic commit, and the caller is told so.
 * Snapshot mode deliberately writes no `refs/remotes/origin/*` and no branch
 * tracking config — recording a remote-tracking ref at a sha the remote has
 * never heard of would be a lie git would later act on.
 *
 * Browser-attached IIFE (window.__owGitWriter) with a CommonJS export for
 * node:test — the pure half (buildTreeObjects/commitCandidates/buildIndex) is
 * unit-tested in test/git-writer.test.js against fixtures produced by real git.
 * Style follows the rest of client-mobile: no `?.`, no `??`.
 */
(function () {
  'use strict';

  // ── bytes ────────────────────────────────────────────────────────────────

  var TE = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  function utf8(s) { return TE.encode(String(s)); }

  function concatBytes(list) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].length;
    var out = new Uint8Array(total);
    var at = 0;
    for (i = 0; i < list.length; i++) { out.set(list[i], at); at += list[i].length; }
    return out;
  }

  function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  }

  function hexToBytes(hex) {
    var s = String(hex || '');
    var out = new Uint8Array(s.length >> 1);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }

  function sha1Hex(bytes) {
    return crypto.subtle.digest('SHA-1', bytes).then(function (buf) {
      return bytesToHex(new Uint8Array(buf));
    });
  }

  // ArrayBuffer → base64, chunked (btoa blows the argument stack at ~65k
  // bytes). Same shape as opfs-store.js's `arrayBufferToBase64` and
  // github-repo.js's `bytesToBase64` — anchored by symbol name, per the
  // convention noted in run-pull.js.
  function bytesToBase64(bytes) {
    var CHUNK = 0x8000;
    var s = '';
    for (var i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  // Git's object id: sha1("<type> <byteLength>\0" + body).
  function objectBytes(type, body) {
    return concatBytes([utf8(type + ' ' + body.length + '\u0000'), body]);
  }
  function objectSha(type, body) { return sha1Hex(objectBytes(type, body)); }

  // Loose objects are zlib (RFC1950), which is exactly what CompressionStream
  // 'deflate' emits — 'deflate-raw' would be the bare stream git cannot read.
  function deflate(bytes) {
    var cs = new CompressionStream('deflate');
    var stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Response(stream).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  // Everything here needs both; a browser without them gets no .git rather
  // than a half-written one (github-repo.js checks this before it starts).
  function isSupported() {
    return typeof CompressionStream !== 'undefined' &&
      typeof crypto !== 'undefined' && !!crypto.subtle &&
      typeof TextEncoder !== 'undefined';
  }

  function objectPath(sha) {
    return '.git/objects/' + sha.slice(0, 2) + '/' + sha.slice(2);
  }

  // Write one loose object. `sha` is the id the object MUST have; it is
  // supplied rather than computed because every caller already knows it from
  // GitHub's own response, and re-deriving it would hide a mismatch instead of
  // surfacing one (see writeVerifiedObject for the paths that do check).
  function writeObject(store, sha, type, body) {
    return deflate(objectBytes(type, body)).then(function (z) {
      return store.writeFile({ path: objectPath(sha), data: bytesToBase64(z) });
    });
  }

  // Same, but refuses to write if the content does not hash to `sha`. Used
  // for blob bodies, where the bytes came off the network (or off disk) and
  // "this is the file GitHub listed" is a claim worth checking once.
  function writeVerifiedObject(store, sha, type, body) {
    return objectSha(type, body).then(function (actual) {
      if (actual !== sha) {
        throw new Error('git object id mismatch: expected ' + sha + ', got ' + actual);
      }
      return writeObject(store, sha, type, body);
    });
  }

  // ── trees ────────────────────────────────────────────────────────────────

  // Tree entries store the mode with no leading zero ("40000", not "040000" as
  // the API reports it). Type wins over mode for trees: the recursive listing
  // is the only place both appear, and they must not be able to disagree.
  function gitEntryMode(entry) {
    if (entry.type === 'tree') return '40000';
    var m = String(entry.mode || '100644').replace(/^0+/, '');
    return m || '100644';
  }

  /**
   * Git's own entry order (base_name_compare): plain byte order over the
   * names, EXCEPT that a tree sorts as though its name ended in "/". Getting
   * this wrong changes the tree's bytes and therefore its sha — which is why
   * buildTreeObjects verifies every result rather than trusting this.
   */
  function compareTreeEntries(a, b) {
    var an = utf8(a.name), bn = utf8(b.name);
    var n = Math.min(an.length, bn.length);
    for (var i = 0; i < n; i++) {
      if (an[i] !== bn[i]) return an[i] - bn[i];
    }
    var ac = an.length > n ? an[n] : (a.isTree ? 47 : 0);   // 47 = '/'
    var bc = bn.length > n ? bn[n] : (b.isTree ? 47 : 0);
    return ac - bc;
  }

  /**
   * buildTreeObjects(entries) → Promise<{objects, root, mismatched}>
   *
   * `entries` is GitHub's recursive tree, unfiltered: {path, mode, type, sha}
   * for every blob, tree, symlink and submodule. Each directory's object is
   * assembled from its direct children — whose shas GitHub already gave us,
   * subtrees included — so no bottom-up hashing and no extra requests.
   *
   * `mismatched` lists the paths whose computed sha did not match GitHub's.
   * It is expected to be empty; a non-empty list means our understanding of
   * the format is wrong for this repository, and the caller must not write
   * anything (a tree with the wrong id makes every object above it wrong too).
   */
  function buildTreeObjects(entries) {
    var dirs = { '': [] };
    var expected = {};                       // dir path → sha GitHub reported

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var path = String(e.path);
      var cut = path.lastIndexOf('/');
      var parent = cut === -1 ? '' : path.slice(0, cut);
      var name = cut === -1 ? path : path.slice(cut + 1);
      if (!dirs[parent]) dirs[parent] = [];
      dirs[parent].push({
        name: name,
        mode: gitEntryMode(e),
        sha: e.sha,
        isTree: e.type === 'tree',
      });
      if (e.type === 'tree') {
        expected[path] = e.sha;
        if (!dirs[path]) dirs[path] = [];
      }
    }

    var paths = Object.keys(dirs);
    var objects = [];
    var mismatched = [];
    var root = null;

    return paths.reduce(function (chain, dirPath) {
      return chain.then(function () {
        var kids = dirs[dirPath].slice().sort(compareTreeEntries);
        var parts = [];
        for (var k = 0; k < kids.length; k++) {
          parts.push(utf8(kids[k].mode + ' ' + kids[k].name + '\u0000'));
          parts.push(hexToBytes(kids[k].sha));
        }
        var body = concatBytes(parts);
        return objectSha('tree', body).then(function (sha) {
          if (dirPath === '') root = sha;
          else if (expected[dirPath] && expected[dirPath] !== sha) mismatched.push(dirPath);
          objects.push({ path: dirPath, sha: sha, body: body });
        });
      });
    }, Promise.resolve()).then(function () {
      return { objects: objects, root: root, mismatched: mismatched };
    });
  }

  // ── the commit object ────────────────────────────────────────────────────

  // Every ±hhmm git actually sees, ordered by how likely it is: UTC, then
  // whole hours, then the quarter-hour zones (Nepal, Chatham, parts of
  // Australia). 105 values — small enough to simply try them all.
  function timezoneOffsets() {
    var whole = [], partial = [];
    for (var m = -12 * 60; m <= 14 * 60; m += 15) {
      var abs = Math.abs(m);
      var text = (m < 0 ? '-' : '+') +
        String(Math.floor(abs / 60)).padStart(2, '0') +
        String(abs % 60).padStart(2, '0');
      if (text === '+0000') continue;
      (m % 60 === 0 ? whole : partial).push(text);
    }
    return ['+0000'].concat(whole, partial);
  }

  function isoToUnixSeconds(iso) {
    var t = Date.parse(String(iso));
    if (!isFinite(t)) return null;
    return Math.floor(t / 1000);
  }

  // "gpgsig " + the armored signature, every line after the first indented by
  // one space — git's own extra-header continuation form. The signature's
  // trailing newline is KEPT (it becomes a final " " line): measured against
  // real GitHub-signed commits, dropping it produces the wrong sha.
  function gpgsigHeader(signature) {
    return 'gpgsig ' + String(signature).split('\n').join('\n ');
  }

  function commitHeaderLines(c, authorTz, committerTz) {
    var lines = ['tree ' + c.tree.sha];
    var parents = c.parents || [];
    for (var i = 0; i < parents.length; i++) lines.push('parent ' + parents[i].sha);
    lines.push('author ' + c.author.name + ' <' + c.author.email + '> ' +
      isoToUnixSeconds(c.author.date) + ' ' + authorTz);
    lines.push('committer ' + c.committer.name + ' <' + c.committer.email + '> ' +
      isoToUnixSeconds(c.committer.date) + ' ' + committerTz);
    return lines;
  }

  /**
   * commitCandidates(commitJson) — every byte-sequence the commit could
   * plausibly be, best guess first. A GENERATOR, not an array: the timezone
   * search alone is ~22000 candidates, and a merge commit's message can run to
   * several kilobytes, so materialising them all would cost hundreds of
   * megabytes to answer a question that is normally settled by candidate #1.
   * Pure, so the ordering is testable; resolveCommitBody below is what
   * decides, by hashing each one against the sha we are actually cloning.
   *
   * The message variants exist because the API strips the trailing newline a
   * commit message almost always ends with — measured: `message + "\n"` is the
   * right answer for every unsigned commit checked, so it goes first.
   */
  function* commitCandidates(c) {
    var verification = c.verification || {};

    // (a) signed → the payload is the object itself, gpgsig removed.
    if (verification.payload) {
      var payload = String(verification.payload);
      if (verification.signature) {
        var lines = payload.split('\n');
        var at = -1;
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].indexOf('committer ') === 0) { at = i; break; }
        }
        if (at !== -1) {
          yield lines.slice(0, at + 1)
            .concat([gpgsigHeader(verification.signature)], lines.slice(at + 1)).join('\n');
          // Same splice with the signature's trailing newline dropped — the
          // shape older git wrote. Cheap to try, and only one of the two can
          // ever hash correctly.
          yield lines.slice(0, at + 1)
            .concat([gpgsigHeader(String(verification.signature).replace(/\n$/, ''))],
              lines.slice(at + 1)).join('\n');
        }
      }
      yield payload;
      yield payload + '\n';
    }

    // (b) unsigned → rebuild from the fields, one candidate per timezone. The
    // instant is exact; only the ±hhmm text is unknown (see the header).
    if (!c.tree || !c.author || !c.committer) return;
    if (isoToUnixSeconds(c.author.date) === null || isoToUnixSeconds(c.committer.date) === null) return;

    var messages = [c.message + '\n', c.message];
    var zones = timezoneOffsets();
    var m, z, z2;
    // Author and committer share a timezone in the overwhelming majority of
    // commits (the same machine wrote both), so that pass runs first and
    // costs ~200 hashes instead of ~22000.
    for (m = 0; m < messages.length; m++) {
      for (z = 0; z < zones.length; z++) {
        yield commitHeaderLines(c, zones[z], zones[z]).join('\n') + '\n\n' + messages[m];
      }
    }
    for (m = 0; m < messages.length; m++) {
      for (z = 0; z < zones.length; z++) {
        for (z2 = 0; z2 < zones.length; z2++) {
          if (z === z2) continue;
          yield commitHeaderLines(c, zones[z], zones[z2]).join('\n') + '\n\n' + messages[m];
        }
      }
    }
  }

  /**
   * resolveCommitBody(commitJson, sha) → Promise<Uint8Array|null>
   * The verification step: the first candidate that hashes to `sha` IS the
   * commit, byte for byte. null means none did — the caller falls back to
   * snapshot mode rather than writing an object under an id that isn't its own.
   */
  function resolveCommitBody(c, sha) {
    var it = commitCandidates(c);
    var BATCH = 256;         // bounded parallelism: 22k awaits in a row is slower

    function step() {
      var slice = [];
      for (var i = 0; i < BATCH; i++) {
        var next = it.next();
        if (next.done) break;
        slice.push(next.value);
      }
      if (!slice.length) return Promise.resolve(null);
      return Promise.all(slice.map(function (text) {
        var body = utf8(text);
        return objectSha('commit', body).then(function (got) {
          return got === sha ? body : null;
        });
      })).then(function (results) {
        for (var j = 0; j < results.length; j++) if (results[j]) return results[j];
        return step();
      });
    }
    return step();
  }

  // Snapshot mode's commit (see the header): a ROOT commit — no parents, so no
  // shallow boundary and no reference to history we cannot prove. The upstream
  // sha goes in the message, because it is the one thing a user needs to know
  // to reconcile this checkout with the real repository.
  function snapshotCommitBody(c, opts) {
    var when = Math.floor(Date.now() / 1000);
    var author = c && c.author ? c.author : { name: 'obsidian-web', email: 'obsidian-web@localhost' };
    var at = c && c.author ? isoToUnixSeconds(c.author.date) : when;
    var lines = [
      'tree ' + opts.tree,
      'author ' + author.name + ' <' + author.email + '> ' + at + ' +0000',
      'committer obsidian-web <obsidian-web@localhost> ' + when + ' +0000',
    ];
    var message = 'Snapshot of ' + opts.owner + '/' + opts.repo + '@' + opts.commit + '\n' +
      '\n' +
      'Downloaded by obsidian-web. The upstream commit object could not be\n' +
      'reproduced exactly, so this is a single root commit holding the same\n' +
      'tree. Run `git fetch origin` to get the real history.\n';
    return utf8(lines.join('\n') + '\n\n' + message);
  }

  // ── .git/index ───────────────────────────────────────────────────────────

  // The stat fields git caches per entry. We write zeros: git's refresh pass
  // sees the mismatch, re-hashes the file, finds the content identical, and
  // reports the entry clean (writing the real stat data back into the index as
  // it goes). `size` is the exception and IS filled in — with a zero size and a
  // non-zero file git skips the content check and calls the entry modified.
  var CE_VALID = 0x8000;            // "assume unchanged" — don't stat the worktree

  var FILE_MODES = {
    '100644': 0x81a4,               // 0100644 regular
    '100755': 0x81ed,               // 0100755 executable
    '120000': 0xa000,               // 0120000 symlink
    '160000': 0xe000,               // 0160000 gitlink (submodule)
  };

  /**
   * buildIndex(entries) → Promise<Uint8Array>  — DIRC version 2.
   *
   * `entries`: [{path, mode, sha, size, assumeValid}], any order.
   *
   * `assumeValid` is how a complete index coexists with an incomplete
   * checkout. Some paths in the tree deliberately never reach the working
   * directory — symlinks (the File System Access API cannot create one),
   * submodules, files past github-repo.js's size cap, and anything whose
   * download failed. Listing them normally would make `git status` report
   * deletions the user did not make; the assume-valid bit tells git to trust
   * the index for those paths and not look at the disk at all.
   */
  function buildIndex(entries) {
    var sorted = entries.slice().sort(function (a, b) {
      var an = utf8(a.path), bn = utf8(b.path);
      var n = Math.min(an.length, bn.length);
      for (var i = 0; i < n; i++) if (an[i] !== bn[i]) return an[i] - bn[i];
      return an.length - bn.length;
    });

    var parts = [];
    var header = new Uint8Array(12);
    var hv = new DataView(header.buffer);
    header.set(utf8('DIRC'), 0);
    hv.setUint32(4, 2);
    hv.setUint32(8, sorted.length);
    parts.push(header);

    for (var i = 0; i < sorted.length; i++) {
      var e = sorted[i];
      var name = utf8(e.path);
      // 62 fixed bytes (10 × uint32, 20-byte sha, uint16 flags) + the name,
      // NUL-padded to a multiple of 8 with at least one NUL.
      var len = 62 + name.length;
      var padded = len + (8 - (len % 8) || 8);
      var buf = new Uint8Array(padded);
      var dv = new DataView(buf.buffer);
      dv.setUint32(24, FILE_MODES[e.mode] || FILE_MODES['100644']);
      dv.setUint32(36, e.size || 0);
      buf.set(hexToBytes(e.sha), 40);
      dv.setUint16(60, Math.min(name.length, 0xfff) | (e.assumeValid ? CE_VALID : 0));
      buf.set(name, 62);
      parts.push(buf);
    }

    var body = concatBytes(parts);
    return crypto.subtle.digest('SHA-1', body).then(function (digest) {
      return concatBytes([body, new Uint8Array(digest)]);
    });
  }

  // ── the rest of the directory ────────────────────────────────────────────

  // filemode/symlinks are false everywhere, not just on Windows: this checkout
  // is written through the File System Access API, which can set neither an
  // executable bit nor a symlink. Saying so keeps git from reporting every
  // 100755 file as mode-changed. autocrlf is pinned off for the same reason —
  // the working files are byte-identical to the blobs, and Git for Windows
  // turns autocrlf on in its system config.
  function configText(opts) {
    var lines = [
      '[core]',
      '\trepositoryformatversion = 0',
      '\tfilemode = false',
      '\tbare = false',
      '\tlogallrefupdates = true',
      '\tsymlinks = false',
      '\tignorecase = ' + (opts.ignoreCase ? 'true' : 'false'),
      '\tautocrlf = false',
      '[remote "origin"]',
      '\turl = https://github.com/' + opts.owner + '/' + opts.repo + '.git',
    ];
    if (opts.exact) {
      // A depth-1 clone is a single-branch clone: the refspec names the one
      // branch we actually have, so a later `git fetch` cannot invent
      // remote-tracking refs for branches nothing here has ever seen.
      lines.push('\tfetch = +refs/heads/' + opts.branch + ':refs/remotes/origin/' + opts.branch);
      lines.push('[branch "' + opts.branch + '"]');
      lines.push('\tremote = origin');
      lines.push('\tmerge = refs/heads/' + opts.branch);
    } else {
      lines.push('\tfetch = +refs/heads/*:refs/remotes/origin/*');
    }
    return lines.join('\n') + '\n';
  }

  var EXCLUDE_TEXT = '# git ls-files --others --exclude-from=.git/info/exclude\n';
  var DESCRIPTION_TEXT =
    "Unnamed repository; edit this file 'description' to name the repository.\n";

  function reflogLine(sha, what) {
    var when = Math.floor(Date.now() / 1000);
    return '0000000000000000000000000000000000000000 ' + sha +
      ' obsidian-web <obsidian-web@localhost> ' + when + ' +0000\t' + what + '\n';
  }

  function writeText(store, path, text) {
    return store.writeFile({ path: path, data: text, encoding: 'utf8' });
  }

  /**
   * addShallow(store, commit) — declare `commit`'s parents absent, KEEPING
   * whatever was declared before.
   *
   * Replacing the file would be the obvious thing and is wrong. A pull leaves
   * the previous commit's object on disk; the new commit names it as a parent,
   * so it is still a reachable-looking object whose OWN parent was never
   * downloaded. Drop its shallow entry and git has an undeclared missing link
   * — measured: `git fsck` reports "broken link from commit <old> to commit
   * <older>". Every boundary we have ever created stays declared instead.
   */
  function addShallow(store, commit) {
    return store.readFile({ path: '.git/shallow', encoding: 'utf8' }).then(
      function (r) { return String((r && r.data) || ''); },
      function () { return ''; }             // no file yet — first clone
    ).then(function (text) {
      var seen = {};
      var lines = [];
      text.split('\n').concat([commit]).forEach(function (line) {
        var sha = line.trim();
        if (!/^[0-9a-f]{40}$/.test(sha) || seen[sha]) return;
        seen[sha] = true;
        lines.push(sha);
      });
      return writeText(store, '.git/shallow', lines.join('\n') + '\n');
    });
  }

  // A 40-hex `ref` is a commit id, not a branch — HEAD goes detached rather
  // than inventing a branch named after a sha. A tag name is indistinguishable
  // from a branch name here without another API call, and lands as a local
  // branch of that name: harmless, and it still points at the right commit.
  function isCommitSha(ref) { return /^[0-9a-f]{40}$/i.test(String(ref || '')); }

  /**
   * writeRepo(store, opts) → Promise<{mode, objects, tree, commit}>
   *
   * Writes everything except the blob objects, which the caller streams as it
   * downloads them (github-repo.js does this inside its existing fetch pool —
   * the bytes are already in hand there and never have to be held twice).
   *
   * opts:
   *   owner, repo, ref, commit   identity of what was cloned
   *   entries                    GitHub's recursive tree, unfiltered
   *   commitJson                 GET /repos/:o/:r/git/commits/:sha
   *   notCheckedOut              {path: true} — assume-valid in the index
   *   sizes                      {path: bytes} from the tree response
   *   onProgress({phase, done, total})
   *
   * `mode` in the result is 'exact' (the real commit, real history, shallow)
   * or 'snapshot' (see the header). Throws if the trees do not verify — a
   * caller that half-writes a corrupt .git is worse than one that writes none.
   */
  function writeRepo(store, opts) {
    var progress = opts.onProgress || function () {};
    var branch = isCommitSha(opts.ref) ? null : String(opts.ref);
    var result = { mode: 'exact', objects: 0, tree: null, commit: opts.commit };

    return buildTreeObjects(opts.entries).then(function (trees) {
      if (trees.mismatched.length) {
        throw new Error('rebuilt tree objects did not match GitHub (' +
          trees.mismatched.length + ' of ' + trees.objects.length + ', e.g. "' +
          trees.mismatched[0] + '") — not writing .git');
      }
      result.tree = trees.root;

      var done = 0;
      progress({ phase: 'git', done: 0, total: trees.objects.length + 1 });
      return trees.objects.reduce(function (chain, obj) {
        return chain.then(function () {
          return writeObject(store, obj.sha, 'tree', obj.body).then(function () {
            done++;
            result.objects++;
            progress({ phase: 'git', done: done, total: trees.objects.length + 1 });
          });
        });
      }, Promise.resolve()).then(function () { return trees.root; });
    }).then(function (rootTree) {
      // The commit object — exact if we can prove it, snapshot if we cannot.
      return resolveCommitBody(opts.commitJson, opts.commit).then(function (body) {
        if (body) {
          if (opts.commitJson.tree.sha !== rootTree) {
            throw new Error('rebuilt root tree ' + rootTree + ' is not the commit\'s tree ' +
              opts.commitJson.tree.sha + ' — not writing .git');
          }
          return writeObject(store, opts.commit, 'commit', body).then(function () {
            return opts.commit;
          });
        }
        result.mode = 'snapshot';
        var snap = snapshotCommitBody(opts.commitJson, {
          tree: rootTree, owner: opts.owner, repo: opts.repo, commit: opts.commit,
        });
        return objectSha('commit', snap).then(function (sha) {
          result.commit = sha;
          return writeObject(store, sha, 'commit', snap).then(function () { return sha; });
        });
      });
    }).then(function (headSha) {
      result.objects++;

      // Refs, HEAD and config. In exact mode the remote-tracking ref is the
      // truth about origin and `git pull` works out of the box; in snapshot
      // mode it is deliberately absent (see the header).
      var writes = [];
      if (branch) {
        writes.push(writeText(store, '.git/HEAD', 'ref: refs/heads/' + branch + '\n'));
        writes.push(writeText(store, '.git/refs/heads/' + branch, headSha + '\n'));
        writes.push(writeText(store, '.git/logs/HEAD', reflogLine(headSha, 'clone: from https://github.com/' + opts.owner + '/' + opts.repo + '.git')));
        writes.push(writeText(store, '.git/logs/refs/heads/' + branch, reflogLine(headSha, 'clone: from https://github.com/' + opts.owner + '/' + opts.repo + '.git')));
        if (result.mode === 'exact') {
          writes.push(writeText(store, '.git/refs/remotes/origin/' + branch, headSha + '\n'));
          writes.push(writeText(store, '.git/refs/remotes/origin/HEAD', 'ref: refs/remotes/origin/' + branch + '\n'));
        }
      } else {
        writes.push(writeText(store, '.git/HEAD', headSha + '\n'));
        writes.push(writeText(store, '.git/logs/HEAD', reflogLine(headSha, 'clone: from https://github.com/' + opts.owner + '/' + opts.repo + '.git')));
      }

      writes.push(writeText(store, '.git/config', configText({
        owner: opts.owner, repo: opts.repo,
        branch: branch || 'main',
        exact: result.mode === 'exact' && !!branch,
        ignoreCase: /Windows|Macintosh/.test(
          typeof navigator !== 'undefined' ? navigator.userAgent : ''),
      })));
      writes.push(writeText(store, '.git/description', DESCRIPTION_TEXT));
      writes.push(writeText(store, '.git/info/exclude', EXCLUDE_TEXT));

      // The depth-1 declaration: this commit's parents are not here, and git
      // must stop walking at it instead of reporting a broken object store.
      // Only in exact mode — a snapshot root commit HAS no parents to miss.
      if (result.mode === 'exact' &&
          opts.commitJson.parents && opts.commitJson.parents.length) {
        writes.push(addShallow(store, opts.commit));
      }

      return Promise.all(writes);
    }).then(function () {
      // The index last: it is what makes `git status` clean, so it should not
      // exist unless everything it describes already does.
      var sizes = opts.sizes || {};
      var notCheckedOut = opts.notCheckedOut || {};
      var indexEntries = [];
      for (var i = 0; i < opts.entries.length; i++) {
        var e = opts.entries[i];
        if (e.type === 'tree') continue;
        var mode = gitEntryMode(e);
        var gitlink = e.type === 'commit' || mode === '160000';
        indexEntries.push({
          path: e.path,
          mode: gitlink ? '160000' : (mode === '120000' ? '120000' : (mode === '100755' ? '100755' : '100644')),
          sha: e.sha,
          size: gitlink ? 0 : (sizes[e.path] || 0),
          assumeValid: gitlink || mode === '120000' || !!notCheckedOut[e.path],
        });
      }
      return buildIndex(indexEntries).then(function (bytes) {
        return store.writeFile({ path: '.git/index', data: bytesToBase64(bytes) });
      });
    }).then(function () {
      return result;
    });
  }

  var api = {
    isSupported: isSupported,
    writeObject: writeObject,
    writeVerifiedObject: writeVerifiedObject,
    writeRepo: writeRepo,
    addShallow: addShallow,
    // pure — exported for test/git-writer.test.js
    buildTreeObjects: buildTreeObjects,
    buildIndex: buildIndex,
    commitCandidates: commitCandidates,
    resolveCommitBody: resolveCommitBody,
    compareTreeEntries: compareTreeEntries,
    gitEntryMode: gitEntryMode,
    objectSha: objectSha,
    objectPath: objectPath,
    configText: configText,
    timezoneOffsets: timezoneOffsets,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof window !== 'undefined') {
    window.__owGitWriter = api;
  }
})();
