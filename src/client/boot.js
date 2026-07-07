/**
 * Boot script - runs before Obsidian's code.
 *
 * Responsibilities:
 *   1. Install window.require so Obsidian's window.require("...") calls
 *      hit our shims instead of failing.
 *   2. Pre-set platform flags (window.electron, etc.) where Obsidian
 *      reads them outside of a require() call.
 *   3. Configure the vault base path that the fs shim will use.
 *   4. Fetch the bootstrap cache asynchronously (non-blocking), then
 *      inject Obsidian's scripts dynamically so the spinner stays visible
 *      (and the main thread stays unblocked) during the fetch.
 *
 * Order of script tags in index.html ensures all shim files have already
 * loaded their __ow* globals by the time this runs.
 *
 * Obsidian's scripts are NOT listed in index.html anymore. They are
 * injected here, after the async bootstrap resolves, with async=false so
 * the browser can download them in parallel but executes them in order.
 */

// Ordered list of Obsidian's renderer scripts — mirrors the old <script defer>
// list in index.html. Keep in sync with obsidian/index.html if Obsidian is
// updated to add or remove scripts.
const OBSIDIAN_SCRIPTS = [
  '/obsidian/lib/codemirror/codemirror.js',
  '/obsidian/lib/codemirror/overlay.js',
  '/obsidian/lib/codemirror/markdown.js',
  '/obsidian/lib/codemirror/cm-addons.js',
  '/obsidian/lib/codemirror/vim.js',
  '/obsidian/lib/codemirror/meta.min.js',
  '/obsidian/lib/moment.min.js',
  '/obsidian/lib/pixi.min.js',
  '/obsidian/lib/i18next.min.js',
  '/obsidian/lib/scrypt.js',
  '/obsidian/lib/turndown.js',
  '/obsidian/enhance.js',
  '/obsidian/i18n.js',
  '/obsidian/app.js',
];

(function () {
  // Many Node.js npm packages (e.g. node-forge) reference the Node.js global
  // object as `global`. In the browser this doesn't exist; alias it to window
  // so plugins that bundle such packages don't crash on startup.
  if (typeof global === 'undefined') {
    window.global = window;
  }

  const VAULT_BASE = '/vault';
  const params = new URLSearchParams(location.search);
  let VAULT_ID = params.get('vault') || localStorage.getItem('obsidian-web:lastVaultId') || '';

  if (!VAULT_ID && location.pathname !== '/starter') {
    location.href = '/starter';
    return;
  }

  if (VAULT_ID) {
    localStorage.setItem('obsidian-web:lastVaultId', VAULT_ID);
  }

  // Tell the fs shim what path prefix to strip when talking to the server.
  window.__owFs.setVaultBase(VAULT_BASE);
  window.__owFs.setVaultId(VAULT_ID);

  // Auto-trust community plugins in demo mode so the "Do you trust this
  // vault?" modal doesn't block first-time visitors.
  // Obsidian checks: localStorage.getItem("enable-plugin-" + appId)
  if (VAULT_ID) {
    localStorage.setItem('enable-plugin-' + VAULT_ID, 'true');
  }

  // Mobile emulation: on small viewports, set the EmulateMobile flag so
  // Obsidian activates its mobile UI (170 CSS rules + JS behavior).
  // Obsidian reads this from localStorage before we can intervene, so it
  // must be set before app.js loads (which it is — boot.js runs first).
  if (window.innerWidth < 600 || window.innerHeight < 600) {
    localStorage.setItem('EmulateMobile', '1');
  } else {
    localStorage.removeItem('EmulateMobile');
  }

  // Map module name -> shim object.
  const modules = {
    'fs':          window.__owFs,
    'original-fs': window.__owFs,
    'path':        window.__owPath,
    'url':         window.__owUrl,
    'os':          window.__owOs,
    'electron':    window.__owElectron,
    'btime':       window.__owBtime,
    'crypto':      makeCryptoShim(),
    'node:crypto': makeCryptoShim(),   // plugins that use the node: prefix
    'util':        makeUtilShim(),
    'node:util':   makeUtilShim(),
    'buffer':      { Buffer: window.Buffer },   // require('buffer').Buffer
    'process':     window.process,              // require('process')
    // child_process: stub so plugins that optionally use it (e.g. Templater
    // system commands) can load. Commands will fail gracefully at runtime.
    'child_process': makeChildProcessStub(),
    '@electron/remote': window.__owElectron.remote,
  };

  function makeChildProcessStub() {
    const ERR = new Error('[obsidian-web] child_process is not available in web mode');
    function noop() {}
    // Minimal EventEmitter-like object returned by spawn/exec
    function fakeProc() {
      return {
        stdout: { on: noop, pipe: noop },
        stderr: { on: noop, pipe: noop },
        stdin:  { write: noop, end: noop },
        on: noop, once: noop, off: noop,
        kill: noop, pid: 0,
      };
    }
    return {
      exec(cmd, opts, cb) {
        if (typeof opts === 'function') { cb = opts; }
        if (typeof cb === 'function') { setTimeout(() => cb(ERR, '', ''), 0); }
        return fakeProc();
      },
      execSync() { throw ERR; },
      spawn() { return fakeProc(); },
      spawnSync() { return { stdout: '', stderr: '', status: 1, error: ERR }; },
      execFile(file, args, opts, cb) {
        if (typeof opts === 'function') { cb = opts; }
        if (typeof cb === 'function') { setTimeout(() => cb(ERR, '', ''), 0); }
        return fakeProc();
      },
      fork() { return fakeProc(); },
    };
  }

  function makeUtilShim() {
    // Minimal Node.js `util` polyfill.
    // promisify: wraps a (err, value) callback-style function into a Promise.
    function promisify(fn) {
      return function (...args) {
        return new Promise((resolve, reject) => {
          fn.call(this, ...args, (err, value) => {
            if (err) reject(err);
            else resolve(value);
          });
        });
      };
    }
    // callbackify: inverse of promisify.
    function callbackify(fn) {
      return function (...args) {
        const cb = args.pop();
        fn.apply(this, args).then(
          (v) => cb(null, v),
          (e) => cb(e instanceof Error ? e : new Error(String(e))),
        );
      };
    }
    // inspect: basic stringification (subset of Node's util.inspect).
    function inspect(obj) {
      try { return JSON.stringify(obj); } catch (_) { return String(obj); }
    }
    // inherits: prototype chain helper used by older Node packages.
    function inherits(ctor, superCtor) {
      ctor.super_ = superCtor;
      Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
    }
    return { promisify, callbackify, inspect, inherits };
  }

  function makeCryptoShim() {
    // Obsidian uses crypto for hashing and random bytes. The browser's
    // Web Crypto API covers it; we expose a Node-style facade.
    return {
      randomBytes(n) {
        const arr = new Uint8Array(n);
        crypto.getRandomValues(arr);
        // Node returns a Buffer; a Uint8Array is close enough for the
        // ways Obsidian uses it (calls .toString('hex') etc.).
        arr.toString = function (encoding) {
          if (encoding === 'hex') {
            let s = '';
            for (let i = 0; i < this.length; i++) {
              s += this[i].toString(16).padStart(2, '0');
            }
            return s;
          }
          return Uint8Array.prototype.toString.call(this);
        };
        return arr;
      },
      createHash(algo) {
        // LIMITATION: WebCrypto's subtle.digest() is async-only — there is no
        // synchronous hashing API in browsers. We buffer input via .update()
        // and expose two paths on .digest():
        //   - If called with a callback (e.g. .digest('hex', cb)): uses
        //     subtle.digest asynchronously — actual result delivered to cb.
        //   - If called without a callback (sync path, legacy): logs a warning
        //     and returns an empty result. Most core Obsidian code paths that
        //     call createHash() do so asynchronously or don't use the result
        //     for critical logic. If a plugin breaks here, add a shim for that
        //     specific hash use-case.
        //
        // Map Node algo names to WebCrypto names.
        const algoMap = { sha1: 'SHA-1', sha256: 'SHA-256', sha512: 'SHA-512', md5: 'SHA-256' };
        const subtleAlgo = algoMap[(algo || '').toLowerCase()] || 'SHA-256';
        const chunks = [];
        const hash = {
          update(data) {
            chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
            return hash;
          },
          digest(encoding, cb) {
            if (typeof encoding === 'function') { cb = encoding; encoding = 'hex'; }
            // Async path: caller provided a callback.
            if (typeof cb === 'function') {
              const combined = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
              let off = 0;
              for (const c of chunks) { combined.set(c, off); off += c.length; }
              crypto.subtle.digest(subtleAlgo, combined).then((buf) => {
                const bytes = new Uint8Array(buf);
                if (encoding === 'hex') {
                  let s = '';
                  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
                  cb(null, s);
                } else {
                  cb(null, bytes);
                }
              }).catch((err) => cb(err));
              return hash;
            }
            // Sync path: no callback. WebCrypto cannot do this synchronously.
            // Return empty and warn so we can spot if something actually relies on it.
            console.warn('[obsidian-web] crypto.createHash(' + algo + ').digest() called synchronously — returning empty. If this causes issues, wrap the caller to use the async path.');
            return encoding === 'hex' ? '' : new Uint8Array(0);
          },
        };
        return hash;
      },
    };
  }

  // ── Missing-shim tracker ────────────────────────────────────────────────
  // Collects every require(), sendSync(), and send() call that we don't handle.
  // Inspect from DevTools: __owMissing.summary() / .table() / .list()
  (function () {
    const hits = new Map(); // key → { type, name, count, firstSeen, lastSeen }

    function record(type, name) {
      const key = type + ':' + name;
      const now = Math.round(performance.now());
      if (hits.has(key)) {
        const e = hits.get(key);
        e.count++;
        e.lastSeen = now;
      } else {
        hits.set(key, { type, name, count: 1, firstSeen: now, lastSeen: now });
      }
    }

    function summary() {
      const rows = [...hits.values()].sort((a, b) => b.count - a.count);
      if (rows.length === 0) {
        console.log('[obsidian-web] __owMissing: nothing missing \u2713');
        return [];
      }
      console.group('[obsidian-web] Missing shims — ' + rows.length + ' distinct, ' +
        rows.reduce((s, r) => s + r.count, 0) + ' total calls');
      console.table(rows.map(r => ({
        type: r.type, name: r.name, count: r.count,
        'first(ms)': r.firstSeen, 'last(ms)': r.lastSeen,
      })));
      console.groupEnd();
      return rows;
    }

    window.__owMissing = { record, summary, list: () => [...hits.values()] };
  })();

  // Install window.require.
  window.require = function (name) {
    if (Object.prototype.hasOwnProperty.call(modules, name)) {
      return modules[name];
    }
    console.warn('[obsidian-web] window.require: unknown module "' + name + '"');
    window.__owMissing && window.__owMissing.record('require', name);
    return undefined;
  };

  // Some Obsidian code reads window.electron directly (bypassing require).
  window.electron = window.__owElectron;

  // Some Obsidian code reads window.process.platform / arch.
  window.process = window.process || {
    platform: 'linux',
    arch: 'x64',
    versions: { electron: '0.0.0', node: '0.0.0' },
    env: {},
    cwd: () => '/',
    nextTick: (fn, ...args) => Promise.resolve().then(() => fn(...args)),
  };

  // Set the global Buffer if Obsidian needs it. We don't ship a full
  // Buffer polyfill yet - if something blows up here, that's our cue.
  if (!window.Buffer) {
    window.Buffer = {
      from: (data, encoding) => {
        if (typeof data === 'string') {
          if (encoding === 'base64') {
            const bin = atob(data);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            return arr;
          }
          return new TextEncoder().encode(data);
        }
        return new Uint8Array(data);
      },
      isBuffer: (x) => x instanceof Uint8Array,
      alloc: (n) => new Uint8Array(n),
    };
  }

  // Expose the vault path where Obsidian expects to find one.
  // It will be passed when Obsidian opens a vault; our launcher
  // (later) tells Obsidian to open VAULT_BASE.
  window.__obsidianWeb = {
    vaultBase: VAULT_BASE,
    vaultId: VAULT_ID,
  };

  console.log('[obsidian-web] boot complete; require + shims installed');

  // ── Async bootstrap + dynamic script injection ──────────────────────────
  //
  // All synchronous setup above (window.require, shims, globals) is complete
  // before this block runs. The fetch is async so the spinner renders
  // immediately without blocking the main thread.
  //
  // After the cache is populated we inject Obsidian's scripts with async=false:
  // the browser downloads them in parallel but executes them in insertion
  // order, so Obsidian's dependencies are always satisfied.
  //
  // sendSync() / statSync() are only called AFTER app.js starts running,
  // which is after this promise resolves — so the cache is always ready.
  if (VAULT_ID && location.pathname !== '/starter') {
    var statusEl = document.getElementById('ow-status');
    var pollTimer = null;
    var vaultParam = encodeURIComponent(VAULT_ID);

    // Start polling /api/bootstrap/status after 2 seconds of waiting.
    // Shows progress to the user during slow cold-start builds.
    var pollDelay = setTimeout(function () {
      pollTimer = setInterval(function () {
        fetch('/api/bootstrap/status?vault=' + vaultParam)
          .then(function (r) { return r.json(); })
          .then(function (s) {
            if (!statusEl || s.state === 'idle' || s.state === 'ready') return;
            var text = s.label || '';
            if (s.state === 'scanning' && s.dirs) {
              text += ' (' + s.dirs + ' dirs, ' + (s.files || 0) + ' files)';
            }
            if (s.state === 'reading' && s.filesRead) {
              text += ' (' + s.filesRead + '/' + (s.total || '?') + ')';
            }
            statusEl.textContent = text;
          })
          .catch(function () {});
      }, 1000);
    }, 2000);

    function stopPolling() {
      clearTimeout(pollDelay);
      if (pollTimer) clearInterval(pollTimer);
    }

    fetch('/api/bootstrap?vault=' + vaultParam + '&full=1')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        stopPolling();
        var vault = data.electron && data.electron['vault'];
        if (!vault || !vault.id) {
          localStorage.removeItem('obsidian-web:lastVaultId');
          location.href = '/starter';
          return;
        }
        window.__owBootstrapCache = data;
        window.__owAuthMode = data.electron && data.electron['auth-mode'];
        if (statusEl) statusEl.textContent = 'Loading Obsidian...';
        console.log('[obsidian-web] bootstrap loaded: ' + Object.keys(data.fs).length + ' files pre-cached');

        // Readonly mode: inject CSS and keyboard guards for unauthenticated users.
        // These hide editing UI and block the Ctrl+E / Cmd+E toggle shortcut.
        if (window.__owAuth && window.__owAuth.mode === 'readonly' && !window.__owAuth.authorized) {
          var gStyle = document.createElement('style');
          gStyle.setAttribute('data-ow-readonly', '');
          gStyle.textContent = [
            '.view-action[aria-label="Edit"] { display: none !important; }',
            '.view-action[aria-label="Source mode"] { display: none !important; }',
            '.view-action[aria-label="Enter edit mode"] { display: none !important; }',
            '.cm-editor { display: none !important; }',
            '.markdown-source-view { display: none !important; }',
            '.workspace-leaf-content[data-type="markdown"] .view-content .cm-s-obsidian { display: none !important; }',
            '#ow-logout { display: none !important; }',
            '.nav-action-button[aria-label="New note"] { display: none !important; }',
            '.side-dock-ribbon-action[aria-label="Open today\'s note"] { display: none !important; }',
          ].join('\n');
          document.head.appendChild(gStyle);
          document.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
              e.preventDefault();
              e.stopPropagation();
            }
          }, true);
        }

        // Inject Obsidian's scripts in order. async=false preserves execution
        // order while allowing parallel download.
        var loaded = 0;
        for (var i = 0; i < OBSIDIAN_SCRIPTS.length; i++) {
          var s = document.createElement('script');
          s.src = OBSIDIAN_SCRIPTS[i];
          s.async = false;
          s.onload = function () {
            loaded++;
            if (statusEl) statusEl.textContent = 'Loading Obsidian (' + loaded + '/' + OBSIDIAN_SCRIPTS.length + ')';
          };
          document.head.appendChild(s);
        }

        // Hide the loading overlay once Obsidian's workspace element appears.
        var overlay = document.getElementById('ow-loading');
        if (overlay) {
          var obs = new MutationObserver(function () {
            if (document.querySelector('.workspace')) {
              overlay.remove();
              obs.disconnect();
            }
          });
          obs.observe(document.body, { childList: true, subtree: true });
        }
      })
      .catch(function (err) {
        stopPolling();
        console.warn('[obsidian-web] bootstrap failed:', err.message);
        localStorage.removeItem('obsidian-web:lastVaultId');
        location.href = '/starter';
      });
  }
})();
