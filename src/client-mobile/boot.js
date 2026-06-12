/**
 * boot.js — mobile client
 *
 * מקביל ל-client/boot.js של הddesktop:
 *  1. בחירת vault + localStorage
 *  2. חישוב Platform overrides (לפני שה-bundle רץ)
 *  3. הגדרת window.require לפלאגינים
 *  4. async: אימות vault → הזרקה דינמית של scripts → הסרת ספינר
 *
 * הפריסה (mobile/desktop) נקבעת ב-build-time patches על
 * obsidian-mobile/app.js — ראה scripts/patch-obsidian-mobile.js.
 * כאן רק קובעים את ה-overrides שה-IIFE של הbundle יקרא.
 */

// רשימת הscripts של Obsidian Mobile — מוזרקים דינמית אחרי האימות.
// הlib חייבים לפני app.js (globals שנקראים ב-module level).
const MOBILE_SCRIPTS = [
  '/obsidian-mobile/lib/codemirror/codemirror.js',
  '/obsidian-mobile/lib/codemirror/overlay.js',
  '/obsidian-mobile/lib/codemirror/markdown.js',
  '/obsidian-mobile/lib/codemirror/cm-addons.js',
  '/obsidian-mobile/lib/codemirror/vim.js',
  '/obsidian-mobile/lib/codemirror/meta.min.js',
  '/obsidian-mobile/lib/moment.min.js',
  '/obsidian-mobile/lib/pixi.min.js',
  '/obsidian-mobile/lib/i18next.min.js',
  '/obsidian-mobile/lib/scrypt.js',
  '/obsidian-mobile/lib/turndown.js',
  '/obsidian-mobile/enhance.js',
  '/obsidian-mobile/i18n.js',
  '/obsidian-mobile/app.js',
];

(function () {
  'use strict';

  if (typeof global === 'undefined') window.global = window;

  // ── Vault selection ────────────────────────────────────────────────────────
  var params  = new URLSearchParams(location.search);
  var VAULT_ID = params.get('vault') || localStorage.getItem('obsidian-web:lastVaultId') || '';

  if (!VAULT_ID && location.pathname !== '/starter') {
    location.href = '/starter';
    return;
  }

  if (VAULT_ID) {
    localStorage.setItem('obsidian-web:lastVaultId', VAULT_ID);
    localStorage.setItem('mobile-selected-vault', VAULT_ID);
    localStorage.setItem('enable-plugin-' + VAULT_ID, 'true');
  }

  // ── Platform overrides — applied BEFORE app.js loads ──────────────────────
  // הbundle עבר 3 patches (ראה scripts/patch-obsidian-mobile.js) שגורמים
  // ל-IIFE שלו למזג את האובייקט הזה לתוך דגלי ה-Platform עם Object.assign,
  // אחרי ברירות המחדל. מה שמוגדר כאן מנצח.
  //
  // המצב נשמר ב-localStorage תחת המפתח 'obsidian-web:layout-mode'.
  function computeLayoutMode() {
    var pref = localStorage.getItem('obsidian-web:layout-mode') || 'auto';
    if (pref === 'mobile')  return { isMobile: true,  reason: 'user-pref-mobile' };
    if (pref === 'desktop') return { isMobile: false, reason: 'user-pref-desktop' };
    // 'auto' — viewport-based decision
    var small = window.innerWidth < 900 || window.innerHeight < 600;
    return { isMobile: small, reason: 'auto-' + (small ? 'mobile' : 'desktop') };
  }
  var layout = computeLayoutMode();
  window.__owPlatformOverrides = { isMobile: layout.isMobile };
  console.log('[obsidian-web] platform overrides:', layout);

  // ── window.require לפלאגינים ───────────────────────────────────────────────
  var modules = {
    'path':          window.__owPath,
    'url':           window.__owUrl,
    'os':            window.__owOs,
    'btime':         window.__owBtime,
    'crypto':        makeCryptoShim(),
    'node:crypto':   makeCryptoShim(),
    'util':          makeUtilShim(),
    'node:util':     makeUtilShim(),
    'buffer':        { Buffer: window.Buffer },
    'process':       window.process,
    'child_process': makeChildProcessStub(),
  };

  function makeChildProcessStub() {
    var ERR = new Error('[obsidian-web] child_process not available in web mode');
    function noop() {}
    function fakeProc() {
      return { stdout:{on:noop,pipe:noop}, stderr:{on:noop,pipe:noop},
               stdin:{write:noop,end:noop}, on:noop, once:noop, kill:noop, pid:0 };
    }
    return {
      exec: function(cmd,opts,cb){ if(typeof opts==='function')cb=opts; if(typeof cb==='function')setTimeout(function(){cb(ERR,'','')},0); return fakeProc(); },
      execSync: function(){ throw ERR; },
      spawn: function(){ return fakeProc(); },
      spawnSync: function(){ return {stdout:'',stderr:'',status:1,error:ERR}; },
      execFile: function(f,a,opts,cb){ if(typeof opts==='function')cb=opts; if(typeof cb==='function')setTimeout(function(){cb(ERR,'','')},0); return fakeProc(); },
      fork: function(){ return fakeProc(); },
    };
  }

  function makeUtilShim() {
    return {
      promisify: function(fn){ return function(){ var args=[].slice.call(arguments); return new Promise(function(res,rej){ args.push(function(e,v){e?rej(e):res(v);}); fn.apply(this,args); }); }; },
      callbackify: function(fn){ return function(){ var args=[].slice.call(arguments), cb=args.pop(); fn.apply(this,args).then(function(v){cb(null,v);},function(e){cb(e);}); }; },
      inspect: function(o){ try{return JSON.stringify(o);}catch(_){return String(o);} },
      inherits: function(ctor,sup){ ctor.super_=sup; Object.setPrototypeOf(ctor.prototype,sup.prototype); },
    };
  }

  function makeCryptoShim() {
    // Mirror of client/boot.js makeCryptoShim — keeps desktop and mobile
    // runtimes in sync. WebCrypto's subtle.digest is async-only; we expose
    // a callback-based async path on .digest() and a sync path that warns
    // and returns empty. Algo names mapped from Node to WebCrypto.
    return {
      randomBytes: function(n) {
        var arr = new Uint8Array(n);
        crypto.getRandomValues(arr);
        arr.toString = function(enc) {
          if (enc==='hex') { var s=''; for(var i=0;i<this.length;i++) s+=this[i].toString(16).padStart(2,'0'); return s; }
          return Uint8Array.prototype.toString.call(this);
        };
        return arr;
      },
      createHash: function(algo) {
        // Map Node algo names to WebCrypto names. md5 falls back to SHA-256
        // (browsers don't ship MD5); callers that need real MD5 must bundle
        // their own (e.g. spark-md5, as LiveSync already does).
        var algoMap = { sha1: 'SHA-1', sha256: 'SHA-256', sha512: 'SHA-512', md5: 'SHA-256' };
        var subtleAlgo = algoMap[(algo || '').toLowerCase()] || 'SHA-256';
        var chunks = [];
        var hash = {
          update: function(d){ chunks.push(typeof d==='string'?new TextEncoder().encode(d):d); return hash; },
          digest: function(encoding, cb){
            if (typeof encoding === 'function') { cb = encoding; encoding = 'hex'; }
            // Async path — caller provided a callback.
            if (typeof cb === 'function') {
              var totalLen = 0;
              for (var k = 0; k < chunks.length; k++) totalLen += chunks[k].length;
              var combined = new Uint8Array(totalLen);
              var off = 0;
              for (var j = 0; j < chunks.length; j++) { combined.set(chunks[j], off); off += chunks[j].length; }
              crypto.subtle.digest(subtleAlgo, combined).then(function(buf){
                var bytes = new Uint8Array(buf);
                if (encoding === 'hex') {
                  var s = '';
                  for (var i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
                  cb(null, s);
                } else {
                  cb(null, bytes);
                }
              }).catch(function(err){ cb(err); });
              return hash;
            }
            // Sync path: WebCrypto cannot hash synchronously. Warn so we can
            // spot if something actually relies on it.
            console.warn('[obsidian-web] crypto.createHash(' + algo + ').digest() called synchronously — returning empty. If this causes issues, wrap the caller to use the async (callback) path.');
            return encoding === 'hex' ? '' : new Uint8Array(0);
          },
        };
        return hash;
      },
    };
  }

  var missing = (function(){
    var hits = {};
    return {
      record: function(n){ hits[n]=(hits[n]||0)+1; },
      summary: function(){ console.table(Object.entries(hits).map(function(e){return{module:e[0],count:e[1]};})); },
    };
  })();

  window.require = function(name) {
    if (Object.prototype.hasOwnProperty.call(modules, name)) return modules[name];
    missing.record(name);
    return undefined;
  };
  window.__owMissing = missing;

  window.process = window.process || {
    platform: 'linux', arch: 'x64',
    versions: { node: '0.0.0' }, env: {},
    cwd: function(){ return '/'; },
    nextTick: function(fn){ return Promise.resolve().then(fn); },
  };

  if (!window.Buffer) {
    window.Buffer = {
      from: function(data, enc) {
        if (typeof data==='string') {
          if (enc==='base64') { var b=atob(data),a=new Uint8Array(b.length); for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i); return a; }
          return new TextEncoder().encode(data);
        }
        return new Uint8Array(data);
      },
      isBuffer: function(x){ return x instanceof Uint8Array; },
      alloc: function(n){ return new Uint8Array(n); },
    };
  }

  console.log('[obsidian-web] mobile boot: require + shims installed, vault=' + VAULT_ID);

  // ── אימות vault + הזרקה דינמית של scripts ─────────────────────────────────
  if (!VAULT_ID || location.pathname === '/starter') return;

  var statusEl = document.getElementById('ow-status');
  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  setStatus('Verifying vault...');

  // אמת שה-vault קיים על השרת (stat על ה-root)
  // אמת vault + טען localStorage מהשרת במקביל — שניהם חייבים להיות מוכנים
  // לפני הזרקת הסקריפטים של Obsidian (app.js קורא localStorage באתחול).
  // כשל ב-localStorage אינו פטאלי — נשארים עם האחסון המקומי של הדפדפן.
  Promise.all([
    fetch('/api/fs/stat?vault=' + encodeURIComponent(VAULT_ID) + '&path=')
      .then(function(res) {
        if (!res.ok) throw new Error('Vault not found (HTTP ' + res.status + ')');
        return res.json();
      }),
    (window.__owInstallRemoteLocalStorage
      ? window.__owInstallRemoteLocalStorage()
      : Promise.resolve()
    ).catch(function(e) {
      console.warn('[obsidian-web] remote localStorage unavailable, staying device-local:', e && e.message);
    }),
  ])
    .then(function(results) {
      var stat = results[0];
      if (!stat || (!stat.isDirectory && stat.type !== 'directory')) throw new Error('Vault path is not a directory');

      setStatus('Loading Obsidian mobile...');
      console.log('[obsidian-web] vault ok, injecting mobile scripts');

      // הזרקה דינמית — browser מוריד במקביל, מריץ לפי סדר (async=false)
      var loaded = 0;
      for (var i = 0; i < MOBILE_SCRIPTS.length; i++) {
        (function(src) {
          var s = document.createElement('script');
          s.src = src;
          s.async = false;
          s.onload = function() {
            loaded++;
            setStatus('Loading Obsidian mobile (' + loaded + '/' + MOBILE_SCRIPTS.length + ')');
          };
          s.onerror = function() {
            console.error('[obsidian-web] failed to load: ' + src);
            setStatus('Error loading ' + src.split('/').pop());
          };
          document.head.appendChild(s);
        })(MOBILE_SCRIPTS[i]);
      }

      // הסרת ספינר כשה-workspace מוכן
      var overlay = document.getElementById('ow-loading');
      if (overlay) {
        var spinnerObs = new MutationObserver(function() {
          if (document.querySelector('.workspace')) {
            overlay.remove();
            spinnerObs.disconnect();
          }
        });
        spinnerObs.observe(document.body, { childList: true, subtree: true });
      }

      // ── Vault switcher click → /starter ──────────────────────────────────
      // ה-mobile bundle מציג את ה-vault profile panel רק כש-Platform.isDesktopApp
      // הוא true. ב-patch-obsidian-mobile.js שינינו את התנאי הזה ל-!isMobile כדי
      // שהפאנל יופיע גם במצב desktop-layout. אבל ה-click handler המקורי בתוך
      // הפאנל קורא ל-`electron.ipcRenderer.sendSync("vault" | "vault-list" |
      // "vault-open")` — שלא קיים ב-mobile runtime (אין shim ל-window.electron
      // ב-client-mobile/). תופסים את הקליק בשלב ה-capture, חוסמים את ה-handler
      // המקורי, ומנווטים ל-/starter שיודע לעשות את אותו דבר ועוד.
      document.addEventListener('click', function (e) {
        var target = e.target && e.target.closest && e.target.closest('.workspace-drawer-vault-switcher');
        if (!target) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        location.href = '/starter';
      }, true);
    })
    .catch(function(err) {
      console.warn('[obsidian-web] vault check failed:', err.message);
      setStatus('Error: ' + err.message);
      localStorage.removeItem('obsidian-web:lastVaultId');
      setTimeout(function(){ location.href = '/starter'; }, 2000);
    });
}());
