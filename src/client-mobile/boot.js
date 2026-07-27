/**
 * boot.js — mobile client
 *
 * מקביל ל-client/boot.js של הddesktop:
 *  1. בחירת vault + localStorage
 *  2. חישוב Platform overrides (לפני שה-bundle רץ)
 *  3. הגדרת window.require לפלאגינים
 *  4. async: אימות vault → הזרקה דינמית של scripts → הסרת ספינר
 *
 * הפריסה (mobile/desktop) נקבעת ב-client-mobile/platform-bridge.js —
 * יירוט Object.defineProperty בזמן ריצה שקורא את ה-overrides שנקבעים כאן
 * (ראה docs/plans/runtime-platform-descriptors.md). אפס build-time patches
 * על vendor/obsidian-mobile/app.js (docs/plans/zero-patches.md) — כל
 * התנהגות-הפלטפורמה, כולל פאנל ה-vault-profile, מותאמת ברמת-ריצה, לא ע"י
 * עריכת app.js. כאן רק קובעים את ה-overrides ש-platform-bridge.js יקרא
 * בעצלתיים בזמן ה-install.
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

  // ── Vault selection — path-based routing (brief §0/§3ב) ────────────────────
  // מקור-האמת עבר מ-?vault= (query, נמחק) ל-location.pathname:
  //   /vault/<id> → כספת פתוחה <id> (גלוי, ניתן-לשיתוף/סימניה)
  //   /starter    → מסך-בחירה, מתעלם מ-auto-resume (mobile-selected-vault/lastVaultId)
  //   כל path אחר (/, /mobile וכו') → entry: יש כספת-אחרונה → /vault/<id>; אחרת → /starter
  var __owPath = location.pathname;
  // vault-note-deeplink §3א: מפריד id (סגמנט יחיד — ids אמיתיים הם hashים בלי
  // slash) מ-note-path (רב-סגמנטי, עשוי לכלול slashים — Features/Tags וכו').
  var __owVaultMatch = __owPath.match(/^\/vault\/([^/]+)(?:\/(.*))?$/);
  var VAULT_ID = __owVaultMatch ? decodeURIComponent(__owVaultMatch[1]) : '';
  // פענוח פר-סגמנט (שומר slashים כמפרידי-נתיב, מפענח תווים מקודדים בתוך שם).
  var NOTE_PATH = (__owVaultMatch && __owVaultMatch[2])
                    ? __owVaultMatch[2].split('/').map(decodeURIComponent).join('/')
                    : '';
  var forceStarter = (__owPath === '/starter');

  // ── מסך-פתיחה נייטיב — helpers (opfs-ux) ───────────────────────────────────
  // הנייטיב (`.mobile-vault-chooser-screen`) שומר בחירת-vault תחת
  // 'mobile-selected-vault'. אנחנו כותבים לשם ערכים בצורה '<id>/<name>'
  // (executor spike: docs/plans/opfs-ux.md §3ה — הפורמט האמיתי ש-Obsidian
  // מצפה לו ב-Lte הוא מערך של path-strings גולמיים, לא אובייקטים {name,
  // location,storageType} כפי שהבריף המקורי הניח; ve()/basename מחלץ את השם
  // מהמחרוזת עצמה — לכן 'id/name' נותן גם id-חילוץ נקי וגם שם קריא).
  // owNativeVaultIdFromValue מחלץ את ה-id ומאמת מול registry מקומי
  // (local/folder) או ow-known-vault-ids (גם server) — למניעת loop על ערך יתום.
  function owNativeVaultIdFromValue(value) {
    if (!value) return null;
    var slash = value.indexOf('/');
    var id = slash !== -1 ? value.slice(0, slash) : value;
    if (window.__owLocalVaults && window.__owLocalVaults.get(id)) return id;
    var known = [];
    try { known = JSON.parse(localStorage.getItem('ow-known-vault-ids') || '[]'); } catch (e) {}
    if (known.indexOf(id) !== -1) return id;
    return null;
  }

  // navigateToVault — path-based, **אבסולוטי** (brief §3ב): '/vault/<id>' הוא
  // עכשיו מקור-האמת ל-URL, גלוי ונשאר (ניתן-לשיתוף/סימניה) — לא תלוי יותר
  // באיזה path הגיש את הדף (CF/מקומי מגישים שניהם אותו shell). משמש הן ע"י
  // ה-Create-vault interceptor למטה והן ע"י הגישור native-vault-open (Bug 2b).
  function navigateToVault(id) {
    location.href = '/vault/' + encodeURIComponent(id);
  }

  // מודל הנייטיב: 'mobile-selected-vault' = "כספת פתוחה/נבחרה" — מקור-האמת
  // (Bug 1, brief §0/§3א). היעדרו פירושו native close/"ניהול כספות" (quick
  // action 'close-vault' מוחק את המפתח ועושה reload) — כוונה מפורשת לחזור
  // למסך-הפתיחה, ולכן *לא* נופלים חזרה ל-lastVaultId (זו הייתה הסיבה
  // שהמסך לא חזר: lastVaultId שלנו נשאר מלא כי הנייטיב לא מנקה אותו).
  // אם sel קיים אבל לא ניתן לפענוח מול הregistry (יתום/stale) — fallback
  // ל-lastVaultId, כדי לא לשבור server-vault resume (§3א, DoD#4/#5).
  //
  // path-based routing (brief §3ב): /vault/<id> כבר קבע VAULT_ID מה-path —
  // אין צורך להתייעץ עם localStorage. /starter מתעלם מ-auto-resume לגמרי
  // (forceStarter, למטה). רק path "entry" (לא /vault/<id>, לא /starter — /,
  // /mobile וכו') מפנה בעצמו ל-/vault/<id> (יש כספת-אחרונה) או ל-/starter
  // (אין) — location.replace (לא push) כדי שלא ייווצר loop ב-back.
  if (forceStarter) {
    // מנקה מפתח-בחירה פעם-אחת (בלי reload נוסף — אין loop) כדי שהבאנדל
    // הנייטיב לא ינסה auto-open כשהוא רץ מיד למטה (מסך-הפתיחה, no-vault).
    if (localStorage.getItem('mobile-selected-vault')) localStorage.removeItem('mobile-selected-vault');
    localStorage.removeItem('obsidian-web:lastVaultId');
  } else if (!VAULT_ID) {
    var sel = localStorage.getItem('mobile-selected-vault');
    var resumeId = sel ? (owNativeVaultIdFromValue(sel) || localStorage.getItem('obsidian-web:lastVaultId') || '') : '';
    if (!sel) localStorage.removeItem('obsidian-web:lastVaultId');
    if (resumeId) {
      location.replace('/vault/' + encodeURIComponent(resumeId));
    } else {
      location.replace('/starter');
    }
    return;   // מנווטים החוצה — אין מה לעשות יותר בטיק הזה
  }

  // ── Demo vault — lazy create-if-missing (seed-demo §3ג) ────────────────────
  // Fixed-id demo vault (window.__owConfig.demoVault.id, default
  // '0000demo0000demo') — NOT registered ahead of time (brief §0 decision 2:
  // registry stays empty for a brand-new user → native onboarding screen,
  // not the vault-chooser, DoD#3). ensureDemo() is the only thing that ever
  // writes the Demo's registry entry — called here for the share-link
  // (/vault/<demoId>, DoD#5) and from the starter-screen button (installed
  // in a later commit, DoD#4). Idempotent: get(DEMO_ID) truthy on repeat
  // visits → no-op (the fixed id, not a fresh uuid, is what makes this work
  // — local-vault-registry.js create() opts.id, seed-demo §3א).
  var DEMO_ID = (window.__owConfig && window.__owConfig.demoVault && window.__owConfig.demoVault.id) || '0000demo0000demo';
  function ensureDemo() {
    // ES5 guard, avigail round-2 fix (precedence bug in the brief's draft
    // pseudocode `!d.enabled ?? true`, which isn't even valid without `??`):
    // `d && d.enabled === false` — explicit opt-out only; missing config or
    // missing `enabled` key both default to "on".
    var d = window.__owConfig && window.__owConfig.demoVault;
    if (d && d.enabled === false) return null;
    if (window.__owLocalVaults && !window.__owLocalVaults.get(DEMO_ID)) {
      window.__owLocalVaults.create('Demo', { id: DEMO_ID });
    }
    return DEMO_ID;
  }

  // /vault/<demoId> — share-link (DoD#5): create-if-missing on first visit;
  // repeat visits find the registry entry already there (idempotent, no-op).
  // Once created, VAULT_TYPE below resolves to 'local' (registry lookup
  // succeeds) instead of falling back to 'server' for an unknown id.
  if (VAULT_ID === DEMO_ID) ensureDemo();

  // Vault type: 'local' (OPFS, no server round-trip), 'folder' (real
  // directory picked via showDirectoryPicker, also OPFS-store-backed — see
  // capacitor-shim's fsBackend), or 'server' (HTTP /api/fs). Determined by
  // the browser-side local vault registry's `type` field (window.__owLocalVaults,
  // loaded synchronously via <script> before boot.js — see index.html loading
  // order). No entry in the registry → 'server' (unchanged from before).
  var __owV = window.__owLocalVaults && window.__owLocalVaults.get(VAULT_ID);
  var VAULT_TYPE = __owV ? (__owV.type || 'local') : 'server';   // 'folder' | 'local' | 'server'
  window.__owVaultType = VAULT_TYPE;
  window.__owVaultId   = VAULT_ID;
  console.log('[obsidian-web] vault type:', VAULT_TYPE, 'id:', VAULT_ID);

  // ── /_owres/ folder-vault RPC responder (sw-vault-resources §3ד) ─────────
  // The SW's `/_owres/` handler (sw.js) can read OPFS ('local' vaults)
  // directly, but a 'folder' vault's FileSystemDirectoryHandle needs FS
  // Access permission — `queryPermission`/`requestPermission` require a
  // user-activated Window, which a Service Worker doesn't have (spike #2,
  // §0.1). So for folder vaults the SW asks *this* page instead: one hop via
  // MessageChannel. Answers with the already permission-granted
  // `window.__owFolderRoot` (set once, via a real user gesture, by
  // showGrantScreen below) — not a fresh handle re-loaded from IndexedDB,
  // which could still need a permission re-check (finding 3, brief §3ד).
  // Registered unconditionally (cheap no-op for 'local'/'server' vaults —
  // just an early-return on vaultId/type mismatch) since VAULT_TYPE is known
  // synchronously here but __owFolderRoot is only set later, once the grant
  // resolves (verifyPromise below) — the listener checks it at call-time.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (ev) {
      var msg = ev.data;
      if (!msg || msg.type !== 'ow-res') return;
      var port = ev.ports && ev.ports[0];
      if (!port) return;
      if (msg.vaultId !== VAULT_ID || VAULT_TYPE !== 'folder' || !window.__owFolderRoot) {
        port.postMessage({ ok: false, error: 'no matching granted folder vault' });
        return;
      }
      var parts = String(msg.realRel || '').split('/').filter(function (p) { return p.length > 0; });
      var name = parts.pop();
      var cur = Promise.resolve(window.__owFolderRoot);
      parts.forEach(function (part) {
        cur = cur.then(function (dir) { return dir.getDirectoryHandle(part, { create: false }); });
      });
      cur.then(function (dir) { return dir.getFileHandle(name, { create: false }); })
        .then(function (fh) { return fh.getFile(); })
        .then(function (file) { return file.arrayBuffer(); })
        .then(function (buf) { port.postMessage({ ok: true, buffer: buf }, [buf]); })
        .catch(function (e) { port.postMessage({ ok: false, error: String((e && e.message) || e) }); });
    });
  }

  // (הוסר guard-הפניה ל-/starter כש-VAULT_ID ריק — brief §3א: no-vault
  // מזריק עכשיו את מסך-הפתיחה הנייטיב במקום redirect. /starter עדיין מטופל
  // בהמשך, אחרי setup ה-shims — ראה guard #2 למטה.)

  if (VAULT_ID) {
    localStorage.setItem('obsidian-web:lastVaultId', VAULT_ID);
    localStorage.setItem('mobile-selected-vault', VAULT_ID);
    localStorage.setItem('enable-plugin-' + VAULT_ID, 'true');
    // path-based routing (brief §3ב): אין יותר ?vault= query לנקות — ה-URL
    // '/vault/<id>' עצמו הוא מקור-האמת ונשאר גלוי (Bug 1 המקורי טופל אחרת —
    // ראה installNativeVaultOpenBridge, שם היירוט על removeItem('mobile-
    // selected-vault') מנווט ישירות ל-/starter במקום לסמוך על reload+URL).
  }

  // ── Platform overrides — applied BEFORE app.js loads ──────────────────────
  // client-mobile/platform-bridge.js קורא את האובייקט הזה בעצלתיים, בזמן
  // שהוא לוכד את ה-Platform האמיתי דרך יירוט Object.defineProperty (לא
  // build-time patch — ראה docs/plans/runtime-platform-descriptors.md).
  // מה שמוגדר כאן מנצח.
  //
  // המצב נשמר ב-localStorage תחת המפתח 'obsidian-web:layout-mode'.
  // deploy-config.md §3(ג): layout.default הוא ה-fallback כשאין עדיין
  // localStorage pref אישי (פורס יכול לקבוע ברירת-מחדל 'mobile'/'desktop'/
  // 'auto' לפריסה שלו); layout.threshold מחליף את סף ה-900px הקשיח
  // (innerHeight<600 נשאר קבוע — §3(ג) בבריף מחווט רק default/threshold).
  // ES5 guard pattern (avigail): (window.__owConfig && window.__owConfig.X).
  function computeLayoutMode() {
    var cfg = (window.__owConfig && window.__owConfig.layout) || {};
    var defaultMode = cfg.default || 'auto';
    var threshold = (typeof cfg.threshold === 'number') ? cfg.threshold : 900;
    var pref = localStorage.getItem('obsidian-web:layout-mode') || defaultMode;
    if (pref === 'mobile')  return { isMobile: true,  reason: 'user-pref-mobile' };
    if (pref === 'desktop') return { isMobile: false, reason: 'user-pref-desktop' };
    // 'auto' — viewport-based decision
    var small = window.innerWidth < threshold || window.innerHeight < 600;
    return { isMobile: small, reason: 'auto-' + (small ? 'mobile' : 'desktop') };
  }
  var layout = computeLayoutMode();
  // מציבים את *כל* דגלי-הפלטפורמה עקבית עם מצב ה-layout (לא רק isMobile):
  //  • isPhone/isMobile/isDesktop → ה-layout הכללי (ריווח, אנימציות, סרגלים)
  //    מותאם למצב. הערה: מסך-הסטארטר עצמו (onboarding מול chooser) נבחר ב-bundle
  //    לפי *קיום-vault* (אין vaults=onboarding, יש=chooser), לא לפי הרוחב —
  //    הרוחב קובע רק את ה-layout *בתוך* אותו מסך.
  //  • isDesktopApp — ⚠️ הופך שקרי כאן (docs/plans/desktop-layout-now.md §1ג,
  //    אותה מחלקה כמו ההערה שליד LOCKED_FLAGS ב-platform-bridge.js): עד
  //    לסלייס הזה הריצה הייתה *תמיד* דפדפן-בלבד (אין Node/Electron), וההערה
  //    הקודמת כאן (isDesktopApp:false קבוע, גם במצב desktop-layout — הנימוק
  //    היה שער isDesktopOnly) תיארה את זה נכון. עכשיו יש shim ל-window.electron
  //    (src/client-mobile/shims/electron.js) ⇒ הדגל **כן** נדלק במצב
  //    desktop-layout, עקבי עם isDesktop. platform-bridge.js's computeWant()
  //    הוא זה שבפועל נועל את הדגל (מגזרת isDesktop, לא נקרא מהשדה הזה
  //    ישירות) — הערך כאן נשאר לקריאוּת/עקביות עם שאר האובייקט, לא בגלל
  //    שמישהו קורא אותו ישירות.
  //    ⚠️ שער isDesktopOnly עצמו עדיין נפתח (פלאגיני desktop-only הופכים
  //    ניתנים-להתקנה) — נמדד ותועד, לא נחסם ידנית (docs/plans/
  //    desktop-shell-shim.md §2.5, §9 בבריף).
  window.__owPlatformOverrides = {
    isMobile:     layout.isMobile,
    isPhone:      layout.isMobile,
    isTablet:     false,
    isDesktop:    !layout.isMobile,
    isDesktopApp: !layout.isMobile,
    isMobileApp:  true,
  };
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
    // docs/plans/electron-shim-foundation.md §3.1 — window.electron is set
    // by shims/electron.js, loaded (index.html) BEFORE this script. Note
    // this registers unconditionally (no isDesktopApp check — the gate that
    // matters is the `emulate-mobile` body class the bundle itself checks
    // before it ever calls window.require('electron'), see brief §3.6),
    // exactly like every other entry in this map.
    'electron':      window.electron,
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
    // electron: '30.0.0' — docs/plans/electron-shim-foundation.md §3.0: a
    // WEIGHT-BEARING literal, not a "for example" placeholder. Derived
    // (Tn/Pn/Ln) values must satisfy THREE measured constraints at once —
    // major>=13, string>="28.2.3", major<40 — or the bundle throws an
    // "upgrade your installer" error at boot, or picks the wrong clipboard
    // API branch. '30.0.0' is the smallest version that clears all three.
    versions: { node: '0.0.0', electron: '30.0.0' }, env: {},
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
  // (הוסר guard-return ל-pathname==='/starter' — brief §3ב: /starter מגיש
  // עכשיו את אותו shell/boot.js כמו כל path אחר; forceStarter כבר אילץ
  // VAULT_ID='' למעלה, כך שהזרימה ממשיכה ישר לענף no-vault למטה ומרנדרת את
  // מסך-הפתיחה הנייטיב — בדיוק ההתנהגות הרצויה, בלי branch נפרד.)

  var statusEl = document.getElementById('ow-status');
  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  // אלמנט נפרד מ-#ow-loading/#ow-status (calev, סבב-תיקון שלישי, ממצא 3):
  // #ow-status נמחק/נדרס לפני שהמשתמש מספיק לקרוא אותו בתרחיש-הכשל הריאלי —
  // נמדד: ההודעה מופיעה, נדרסת ע"י ה-onload הבא ("Loading Obsidian mobile
  // (14/14)") ואז #ow-loading כולו מוסר לגמרי כש-.workspace מתרנדר, עוד לפני
  // שהמשתמש קרא משהו. הבאנר הזה הוא אלמנט **עצמאי**, ילד ישיר של <body> ולא
  // של #ow-loading — removeLoadingOverlayWhen() (למטה) לעולם לא נוגע בו,
  // ושום setStatus() עתידי לא כותב לתוכו. נוצר lazily (רק בכשל ראשון) כדי
  // שלא יתווסף DOM מיותר במסלול-ההצלחה הרגיל.
  var platformWarningEl = null;
  function showPlatformFailureBanner(text) {
    if (!platformWarningEl) {
      platformWarningEl = document.createElement('div');
      platformWarningEl.id = 'ow-platform-warning';
      platformWarningEl.style.cssText = [
        'position:fixed', 'left:0', 'right:0', 'bottom:0',
        'background:#5a1e1e', 'color:#fff', 'padding:10px 16px',
        'font:13px -apple-system, BlinkMacSystemFont, sans-serif',
        'z-index:100000', 'box-shadow:0 -1px 6px rgba(0,0,0,0.4)',
      ].join(';');
      document.body.appendChild(platformWarningEl);
    }
    platformWarningEl.textContent = text;
  }

  // חשוף עבור platform-bridge.js (נטען לפני script זה — index.html) — קו-
  // 3.1א בבריף: אם ה-bridge בסופו-של-דבר מוותר על לכידת Platform, אזהרת
  // console בלבד בלתי-נראית למשתמש. שורה זו רצה מוקדם וסינכרונית, הרבה לפני
  // ש-app.js אפילו מוזרק — עד שה-bridge יכול לקרוא לזה בכלל (רק אחרי ש-app.js
  // נטען, או אחרי רשת-הביטחון הארוכה), ה-hook כבר קיים.
  //
  // כותב לשני מקומות: setStatus() (עדיין מועיל בזמן שהספינר גלוי) וגם
  // showPlatformFailureBanner() — זה מה ש**שורד** אחרי ש-#ow-loading מוסר
  // ואחרי onload-ים מאוחרים יותר שדורסים את #ow-status (calev ממצא 3).
  window.__owReportPlatformFailure = function (msg) {
    setStatus(msg);
    showPlatformFailureBanner(msg);
  };

  // הזרקה דינמית — browser מוריד במקביל, מריץ לפי סדר (async=false).
  // חולצה מ-for-loop inline (היה כאן במקור) לפונקציה נגישה גם לזרימת
  // ה-no-vault (מסך-הפתיחה הנייטיב, למטה) וגם לזרימת ה-VAULT_ID הרגילה.
  function injectMobileScripts() {
    var loaded = 0;
    var appJsSrc = MOBILE_SCRIPTS[MOBILE_SCRIPTS.length - 1]; // app.js — תמיד אחרון (globals שהוא צריך חייבים לפניו)
    for (var i = 0; i < MOBILE_SCRIPTS.length; i++) {
      (function (src) {
        var s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.onload = function () {
          loaded++;
          setStatus('Loading Obsidian mobile (' + loaded + '/' + MOBILE_SCRIPTS.length + ')');
          // עוגן חלון-הלכידה של platform-bridge.js (docs/plans/
          // runtime-platform-descriptors.md §3.1a) — ה-`load` הנייטיבי של
          // app.js עצמו, לא דדליין שרירותי שסופר את זמן-ההורדה שלו.
          if (src === appJsSrc && window.__owPlatformBridge &&
              typeof window.__owPlatformBridge.notifyAppJsLoaded === 'function') {
            window.__owPlatformBridge.notifyAppJsLoaded();
          }
        };
        s.onerror = function () {
          console.error('[obsidian-web] failed to load: ' + src);
          setStatus('Error loading ' + src.split('/').pop());
          // עוגן שני-ל-חלון-הלכידה (docs/plans/runtime-platform-descriptors.md
          // §3.1a, סבב-תיקון שלישי) — אם app.js עצמו נכשל ברשת (`error`, לא
          // `load`), ל-platform-bridge.js אין דרך אחרת לדעת שהקוד הסינכרוני
          // שלו לעולם לא ירוץ; בלי זה הלכידה הייתה תלויה ב-crash-guard
          // (5 דקות) בלבד לתרחיש הזה בדיוק.
          if (src === appJsSrc && window.__owPlatformBridge &&
              typeof window.__owPlatformBridge.notifyAppJsFailed === 'function') {
            window.__owPlatformBridge.notifyAppJsFailed();
          }
        };
        document.head.appendChild(s);
      })(MOBILE_SCRIPTS[i]);
    }
  }

  // הסרת ספינר (#ow-loading) כש-selector מתרנדר — משותף לשתי הזרימות: זרימת
  // VAULT_ID רגילה ממתינה ל-.workspace; זרימת ה-no-vault (למטה) ממתינה למסך
  // הנייטיב עצמו (.mobile-vault-chooser-screen או .mobile-onboarding — ראה
  // executor spike: ל-Obsidian יש 2 מסכי-כניסה אפשריים, תלוי אם כבר יש
  // vault אחד לפחות ב-Lte/readdir; שניהם תקפים "מסך-פתיחה נייטיב מרונדר").
  // בלי זה — הספינר נשאר תקוע מעל המסך הנייטיב (regression שנתפס ב-spike).
  function removeLoadingOverlayWhen(selector) {
    var overlay = document.getElementById('ow-loading');
    if (!overlay) return;
    if (document.querySelector(selector)) { overlay.remove(); return; }
    var obs = new MutationObserver(function () {
      if (document.querySelector(selector)) {
        overlay.remove();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ── App-ready poll — helper רב-שימושי (docs/plans/vault-name-display.md §3) ─
  // אין ב-boot.js נקודת-ready אמינה מובנית (s.onload רק סופר scripts
  // שהורדו — לא app-init; אין onLayoutReady/setInterval/waitFor* קיים). ה-vendor
  // קובע את window.app (בשימוש כבר ב-openVaultChooser click handlers למטה) —
  // poll ל-window.app && window.app.vault הוא הדרך היציבה היחידה. timeout
  // שקט (לא זורק, לא תוקע) — cb פשוט לא נקרא. שם קבוע (owWhenAppReady) —
  // slice הבא (vault-note-deeplink) נשען על אותו helper, ראה coordination note.
  function owWhenAppReady(cb, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 8000);
    (function poll() {
      if (window.app && window.app.vault) { cb(window.app); return; }
      if (Date.now() >= deadline) return;   // timeout: no-op שקט
      setTimeout(poll, 50);
    })();
  }

  // ── עדכון-DOM של תווית שם-הכספת בפאנל (vault-name-display §3) ──────────────
  // probe אמפירי (Chromium headless): getName() נקרא **פעם-אחת** ב-construction
  // של הפאנל (Ex constructor ב-vendor: `t.createDiv({cls:"workspace-drawer-
  // vault-name",text:i})`, i=e.vault.getName() בזמן הבנייה) — override ל-
  // getName **לבדו** אינו מספיק כשהפאנל כבר רונדר (המצב השכיח: הפאנל נבנה
  // בערך באותו טיימינג שבו window.app הופך זמין, לפני שה-poll שלנו מתפענח).
  // לכן תמיד קובעים textContent ישירות בנוסף ל-override. finding אביגיל 3
  // (קריטי): הטרגט הוא ה-**child** `.workspace-drawer-vault-name` — לא
  // `.workspace-drawer-vault-switcher` עצמו — **לא** ה-click-target שלנו יותר
  // (docs/plans/desktop-layout-now.md §6 Commit 7: חטיפת-הקליק שהייתה כאן
  // הוסרה — הקליק על הפאנל עכשיו מגיע לנתיב הנייטיב, שהוא real עכשיו בזכות
  // ערוצי vault/vault-list/vault-open ב-shims/electron.js). דריסת textContent
  // על ה-switcher עצמו עדיין הייתה מוחקת ילדים ושוברת את ה-listener הנייטיב —
  // הזהירות נשארת נכונה, רק המקור שהיא מגינה עליו השתנה.
  // idempotent — בטוח לקרוא שוב (reload/late-render).
  // אם הפאנל עדיין לא רונדר כש-owWhenAppReady מתפענח — MutationObserver
  // קצר-מועד (עקבי עם removeLoadingOverlayWhen למעלה), מתנתק אחרי match/timeout.
  function refreshVaultProfileLabel(name) {
    var nameEl = document.querySelector('.workspace-drawer-vault-name');
    if (nameEl) { nameEl.textContent = name; return; }
    var obs = new MutationObserver(function () {
      var el = document.querySelector('.workspace-drawer-vault-name');
      if (el) { el.textContent = name; obs.disconnect(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 8000);
  }

  // ── מסך-פתיחה נייטיב (no-vault) — seed רשימת ה-vaults ──────────────────────
  // מאכלס mobile-external-vaults (Lte של הנייטיב) + ow-known-vault-ids
  // (משמש גם ע"י owNativeVaultIdFromValue וגם ע"י capacitor-shim's stat()
  // polyfill). /api/vaults/list מחזיר object map keyed-by-id (לא array —
  // finding 3 אביגיל) — Object.keys ולא array-iteration.
  // כל item בפורמט '<id>/<name>' — ראה הערת owNativeVaultIdFromValue למעלה.
  function seedNativeVaultList() {
    var localList = window.__owLocalVaults ? window.__owLocalVaults.list() : [];
    var items = localList.map(function (v) { return v.id + '/' + v.name; });
    var ids = localList.map(function (v) { return v.id; });
    return fetch('/api/vaults/list')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        Object.keys(res || {}).forEach(function (id) {
          var v = res[id] || {};
          var name = (v.path || id).split('/').pop();
          items.push(id + '/' + name);
          ids.push(id);
        });
      })
      .catch(function () { /* server vaults לא זמינים — ממשיכים עם local/folder בלבד */ })
      .then(function () {
        localStorage.setItem('mobile-external-vaults', JSON.stringify(items));
        localStorage.setItem('ow-known-vault-ids', JSON.stringify(ids));
      });
  }

  // ── מסך-פתיחה נייטיב (no-vault) — גישור בחירת/פתיחת-vault ──────────────────
  // executor spike (docs/plans/opfs-ux.md §3ד/§3ה, finding 4 אביגיל):
  // register() הנייטיב (הפונקציה שרצה אחרי "Open folder as vault"/לחיצה על
  // "Open vault" בשורת vault קיים/auto-resume בעלייה) פותח vault ישירות
  // בזיכרון (window.app=new ete(...)) בלי reload — עוקף לגמרי את זרימת
  // ה-VAULT_ID/boot.js שלנו. נקודת-העיגון האמינה היחידה: register תמיד כותב
  // ל-localStorage['mobile-selected-vault'] רגע לפני הפתיחה הישירה. מיירטים
  // את הכתיבה הזו (monkey-patch ל-localStorage.setItem, מותקן רק בזרימת
  // no-vault) ומנווטים בעצמנו ל-vault שנבחר — כך זרימת ה-boot.js הרגילה
  // (OPFS/folder/server, seed system plugins וכו') רצה כרגיל.
  // Bug 2b (brief §3ג, finding 5): navigateToVault (path-based, '/vault/<id>')
  // במקום '/mobile?vault=' הקשיח — שבר את CF (שם ה-entry הוא '/', אין route
  // '/mobile'). path-based שומר גם CF וגם מקומי (זהה ל-Bug 2 finding 1).
  //
  // brief §3ב finding 4 (קריטי, "מעבר-מיד-סשן"): מותקן עכשיו **גם** בענף
  // vault-open (לא רק no-vault) — אחרת switch (בחירת vault אחר מהרשימה)
  // רץ נייטיבית (setItem+reload באותו URL) ולא נוחת על /vault/<newid>.
  //
  // executor finding (אמפירי, spike ידני ב-Chromium): register() הנייטיב
  // (הפונקציה שמריצה את ה-setItem('mobile-selected-vault', t) שלמעלה) רצה
  // **גם** כחלק מהתחלת-עבודה הרגילה של app.js כש-mobile-selected-vault כבר
  // מוגדר לפני שהבאנדל עלה (בדיוק המצב שלנו — boot.js כותב אותו למעלה, לפני
  // injectMobileScripts). זה כתיבה **חוזרת של אותו id** (לא switch אמיתי) —
  // בלי guard, זה גרם ל-navigateToVault(sameId) → location.href לאותו URL →
  // reload → boot.js רץ מחדש → אותה כתיבה חוזרת → **loop אינסופי** (נתפס
  // ב-manual testing, ~55 מחזורי "vault ok, injecting mobile scripts" בלוג).
  // מיירטים רק כש-id **שונה** מה-VAULT_ID הפתוח כרגע (switch אמיתי); כתיבה
  // חוזרת של אותו id עוברת ל-origSetItem כרגיל (no-op, אין ניווט).
  //
  // סגירה (executor, לא כתוב מפורש בבריף §3ב אבל נדרש ע"י DoD#5): הנייטיב
  // "close-vault"/openVaultChooser() עושה removeItem('mobile-selected-vault')
  // + reload — עם URL קבוע (/vault/<id> נשאר path-based, לא ?vault= שנוקה
  // כבר עם ה-navigation). reload כזה היה נוחת שוב על אותו /vault/<id> (path
  // עדיין תואם) במקום /starter. מיירטים גם את removeItem, באותה משפחת-עוגן,
  // ומנווטים ישירות — עקבי עם המנגנון הקיים ל-setItem, בלי לסמוך על תזמון
  // reload/URL. פעיל רק כשכספת פתוחה (VAULT_ID truthy בזמן ההתקנה); בענף
  // no-vault הכתיבה/מחיקה של המפתח כבר מטופלת ע"י הזרימה הנייטיבית הרגילה.
  function installNativeVaultOpenBridge() {
    if (window.__owNativeVaultBridgeInstalled) return;
    window.__owNativeVaultBridgeInstalled = true;
    var origSetItem = localStorage.setItem.bind(localStorage);
    var origRemoveItem = localStorage.removeItem.bind(localStorage);
    var hadOpenVault = !!VAULT_ID;
    localStorage.setItem = function (key, value) {
      if (key === 'mobile-selected-vault') {
        var id = owNativeVaultIdFromValue(value);
        if (id && id !== VAULT_ID) {
          navigateToVault(id);
          return;
        }
      }
      return origSetItem(key, value);
    };
    localStorage.removeItem = function (key) {
      if (key === 'mobile-selected-vault' && hadOpenVault) {
        location.href = '/starter';
        return;
      }
      return origRemoveItem(key);
    };
  }

  // ── מסך-פתיחה נייטיב (no-vault) — Create-vault interceptor (Bug 2) ─────────
  // executor spike (§0): onCreateVault הנייטיב (בשני המסכים האפשריים —
  // `.mobile-onboarding` first-run "Configure your new vault" ו-המודל
  // `.mobile-vault-chooser-screen` "Create new vault") קורא בסופו של דבר
  // Filesystem.mkdir על ה-vault החדש. במצב no-vault __owVaultType='server'
  // (אין vault עדיין) → מנותב ל-/api/fs/mkdir → 404 (אין שרת שיודע ליצור
  // vault-id חדש בלי ליצור אותו קודם ב-registry שלנו) — no-op בפועל.
  // אימות אמפירי (spike, /tmp/mnp-spike4.js): מאזין click **capture-phase
  // שמותקן על `document`** (לא על הכפתור) חוסם את ה-handler הנייטיב גם
  // כשמותקן אחרי שההandler כבר רשום על הכפתור — listeners על אותו element
  // רצים לפי סדר-רישום ללא קשר ל-capture flag (capture אמיתי דורש ancestor
  // בנתיב ה-propagation, לא את ה-target עצמו).
  function installCreateVaultInterceptor() {
    var handler = function (e) {
      var btn = e.target && e.target.closest &&
        e.target.closest('.mobile-onboarding button.mod-cta, .mobile-vault-chooser-screen button.mod-cta');
      if (!btn) return;
      var btnText = (btn.textContent || '').trim();
      if (btnText !== 'Create a vault' && btnText !== 'Create') return;   // לא זה כפתור ה-Create (למשל "Continue without sync")

      // הטקסט "Create a vault" מופיע גם בכפתור-ה-mod-cta של מסך-הפתיחה
      // הראשוני (welcome screen, "Your thoughts are yours") — שמוביל לצעד
      // הבא (sync-intro) ולא ליצירה בפועל. הצעד היחיד שבו יש input[type=text]
      // בתוך אותו container הוא המסך האמיתי ("Configure your new vault" /
      // מודל "Create new vault") — היעדרו מסמן שזה עדיין לא צעד היצירה,
      // לא DOM שביר; מניחים לnative handler לרוץ כרגיל (ללא interception).
      var screen = btn.closest('.mobile-onboarding, .mobile-vault-chooser-screen');
      var nameInput = screen && screen.querySelector('input[type="text"]');
      if (!screen || !nameInput) return;

      e.preventDefault();
      e.stopImmediatePropagation();   // עוצר את onCreateVault הנייטיב (מונע את ה-mkdir הנכשל)

      // one-shot: מאזינים ל-pointerdown+mousedown+click (ראה הרשמה למטה), אז
      // אותה לחיצה עלולה לירות 3 פעמים → יצירת 3 vaults. הראשון תופס, השאר
      // חסומים (preventDefault למעלה כבר עצר את הנייטיב בכל אירוע).
      if (window.__owCreatingVault) return;
      window.__owCreatingVault = true;

      var name = nameInput.value.trim() || 'Untitled';
      var selectedRadio = screen.querySelector('.mobile-onboarding-radio-option.is-selected');
      var location_ = 'app';   // ברירת-מחדל בטוחה — לא דורש directory picker/permission
      if (selectedRadio) {
        var titleEl = selectedRadio.querySelector('.mobile-onboarding-radio-option-title');
        var title = (titleEl && titleEl.textContent) || '';
        location_ = /app storage/i.test(title) ? 'app' : 'external';
      }

      if (location_ === 'external') {
        // folder vault — choose()=showDirectoryPicker (opfs-ux) יוצר registry
        // entry ומחזיר {path:'id/name'}. *** choose() לא מנווט *** (finding 2)
        // → navigateToVault ידני חובה.
        window.Capacitor.Plugins.Filesystem.choose()
          .then(function (r) {
            if (r && r.path) {
              var id = owNativeVaultIdFromValue(r.path);
              if (id) navigateToVault(id);
            }
          })
          .catch(function (err) {
            // picker בוטל/נכשל — כמו הנייטיב, שקט (canceled) או log בלבד.
            console.warn('[obsidian-web] Create vault (external) failed:', err && err.message || err);
          });
      } else {
        var id2 = window.__owLocalVaults.create(name).id;   // OPFS (type ברירת-מחדל 'local')
        navigateToVault(id2);   // path-based — '/vault/<id2>', ניתן-לשיתוף
      }
    };
    // pointerdown+mousedown+click (capture) — לא רק click. בחלון צר (auto-mobile,
    // מסך .mobile-onboarding) ה-onCreateVault הנייטיב רץ על אירוע-מגע מוקדם
    // (pointerup/touchend) שקדם ל-click → interceptor שמאזין רק ל-click מגיע
    // מאוחר מדי → mkdir→/api/fs/mkdir→405 (הבאג של המשתמשת). תפיסה מוקדמת
    // (pointerdown) חוסמת את הנייטיב לפני שהוא רץ. one-shot guard מונע כפילות.
    ['pointerdown', 'mousedown', 'click'].forEach(function (evt) {
      document.addEventListener(evt, handler, true);
    });
  }

  // ── מסך-פתיחה נייטיב (no-vault) — כפתור "כספת דמו" (seed-demo §3ד) ─────────
  // spike (executor): הבריף (avigail סבב 2) מבקש במפורש `.mobile-onboarding`
  // (לא `.mobile-onboarding-screen`) — root ה-wizard של first-run
  // (`document.body.createDiv("mobile-onboarding")`, אומת גרפית מול
  // vendor/obsidian-mobile/app.js). לא `.mobile-vault-chooser-screen`
  // (משתמש עם ≥1 vault קיים) — הכפתור מיועד למסך-onboarding בלבד (§0).
  // MutationObserver (לא הזרקה חד-פעמית): שלבי-האשף (welcome→sync-intro→
  // configure-vault) עשויים לרנדר-מחדש תוכן פנימי; ה-observer מבטיח שהכפתור
  // חוזר אחרי כל שלב (idempotent — guard על .ow-demo-vault-btn), ופשוט
  // מפסיק להזריק כש-.mobile-onboarding מוסר (כספת נפתחה/reload — הדף עצמו
  // עומד להיטען מחדש, אין disconnect() נחוץ). guard demoVault.enabled===false
  // (ES5, אותו pattern כמו ensureDemo) — לא מציגים כפתור למשהו שלא יעשה כלום.
  function installDemoVaultButton() {
    function inject() {
      var d = window.__owConfig && window.__owConfig.demoVault;
      if (d && d.enabled === false) return;
      var root = document.querySelector('.mobile-onboarding');
      if (!root || root.querySelector('.ow-demo-vault-btn')) return;
      var btn = document.createElement('button');
      btn.className = 'ow-demo-vault-btn mod-cta';
      btn.type = 'button';
      btn.textContent = 'כספת דמו';
      btn.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9999;' +
        'padding:8px 16px;border:none;border-radius:4px;background:#7f6df2;' +
        'color:#fff;cursor:pointer;font:13px -apple-system,BlinkMacSystemFont,sans-serif;';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var id = ensureDemo();
        if (id) navigateToVault(id);
      });
      root.appendChild(btn);
    }
    inject();
    var obs = new MutationObserver(inject);
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ── מסך-פתיחה נייטיב (no-vault) ─────────────────────────────────────────────
  // אין VAULT_ID תקף (לא ב-/vault/<id> path, forceStarter, או שה-entry redirect
  // למעלה כבר קבע שאין כספת-אחרונה — ראה למעלה). ה-shims כבר מותקנים (require/capacitor) — מזריקים
  // ישירות את ה-bundle הנייטיב; מסך ה-vault-chooser שלו (Setup Sync/Create new
  // vault/Open folder as vault + רשימה) מתרנדר מלא בלי שינוי (spike §0).
  // choose()/stat() polyfill + seedNativeVaultList() + הגישור למעלה מחווטים
  // את הרשימה + הבחירה + open-folder ל-vaults שלנו (folder-vault/OPFS/server).
  if (!VAULT_ID) {
    setStatus('Loading Obsidian mobile...');
    installNativeVaultOpenBridge();
    installCreateVaultInterceptor();
    installDemoVaultButton();
    seedNativeVaultList()
      .catch(function (err) { console.warn('[obsidian-web] seedNativeVaultList failed:', err); })
      .then(function () {
        injectMobileScripts();
        removeLoadingOverlayWhen('.mobile-vault-chooser-screen, .mobile-onboarding');
      });
    return;
  }

  // folder vaults need a re-grant click (user gesture) whenever
  // queryPermission comes back != 'granted' (typically: every fresh reload —
  // browsers don't persist FS Access permissions across sessions outside
  // installed PWAs, brief §9 Q2/v2). Renders a button inside the existing
  // #ow-loading overlay; resolves with the requestPermission() result.
  function showGrantScreen(handle) {
    return new Promise(function (resolve) {
      var overlay = document.getElementById('ow-loading');
      setStatus('Access to "' + handle.name + '" is needed to continue.');
      var btn = document.createElement('button');
      btn.textContent = 'Grant access to ' + handle.name;
      btn.style.cssText = 'margin-top:8px;padding:8px 16px;background:#7f6df2;color:#fff;' +
        'border:none;border-radius:4px;cursor:pointer;font:13px -apple-system,BlinkMacSystemFont,sans-serif;';
      btn.onclick = async function () {
        btn.disabled = true;
        btn.textContent = 'Requesting…';
        var perm;
        try {
          perm = await handle.requestPermission({ mode: 'readwrite' });
        } catch (e) {
          perm = 'denied';
        }
        if (btn.parentNode) btn.parentNode.removeChild(btn);
        resolve(perm);
      };
      (overlay || document.body).appendChild(btn);
    });
  }

  // ── folder-vault external-change refresh (docs/plans/folder-watch.md §2/§3ד,
  // reused from slice/folder-refresh, which already verified DoD#3/4/5 there —
  // the retarget here (folder-watch) is the addListener capture itself, see
  // capacitor-shim.js + opfs-store.js) ──────────────────────────────────────
  // folder vaults (a real directory) can change from outside the browser —
  // another app, a sync client, another tab/device on the same directory.
  // OpfsStore (opfs-store.js) wires FileSystemObserver where supported and
  // always exposes rescan() as the manual/fallback path — this installs the
  // user-facing side: a manual refresh button (always shown — cheap even
  // when the observer IS active, covers edge cases like {recursive} not
  // fully supported) and, only when FileSystemObserver isn't supported, a
  // visibilitychange-triggered auto-rescan (debounced ~500ms) so switching
  // back to the tab/app picks up external edits without a manual click.
  // VAULT_TYPE==='folder' guard only (DoD#4) — 'local' (OPFS) vaults can
  // never change externally, must stay a no-op.
  function installFolderRefreshWatch() {
    if (VAULT_TYPE !== 'folder') return;
    if (!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.Filesystem) return;
    var fs = window.Capacitor.Plugins.Filesystem;
    var hasObserver = typeof self !== 'undefined' && 'FileSystemObserver' in self;

    function debounce(fn, ms) {
      var t = null;
      return function () {
        if (t) clearTimeout(t);
        t = setTimeout(fn, ms);
      };
    }

    // ── feedback helpers (docs/plans/folder-refresh-toolbar.md §0/§3ב) ───────
    // The button existed before (folder-watch) but gave zero feedback: click
    // → rescan() ran silently, {changed:N} was discarded, and doRescan only
    // ever logged on *failure*. First click without an observer only ever
    // captures a {changed:0} baseline, so nothing visible happens — the
    // button "feels dead" even when it works. Fix: always log the result,
    // spin the icon while in flight, and surface a Notice when available
    // (window.Notice — confirmed exposed by executor spike §0.1ד, not a
    // no-op fallback needed).
    function setSpin(on) {
      var btns = document.querySelectorAll('.ow-folder-refresh-btn');
      for (var i = 0; i < btns.length; i++) {
        if (on) btns[i].classList.add('is-spinning');
        else btns[i].classList.remove('is-spinning');
      }
    }
    function owNotice(n) {
      // window.Notice may be absent in odd embeddings — spin+log always work
      // regardless (brief §6 risk: "setIcon/Notice לא חשופים").
      if (typeof window.Notice !== 'function') return;
      new window.Notice(n ? ('נמצאו ' + n + ' שינויים') : 'אין שינויים חדשים');
    }

    var rescanning = false;
    function doRescan() {
      if (rescanning || typeof fs.rescan !== 'function') return;
      rescanning = true;
      setSpin(true);
      fs.rescan()
        .then(function (r) {
          var n = (r && r.changed) || 0;
          console.log('[ow] rescan: ' + n + ' changed');
          owNotice(n);
        })
        .catch(function (e) { console.warn('[ow] folder rescan failed', e); })
        .then(function () { rescanning = false; setSpin(false); });
    }

    // fallback trigger — only when there's no observer to do this for us.
    // visibilitychange, not window focus — more resilient: fires reliably on
    // tab-switch/app-resume, unlike focus which some mobile browsers skip.
    if (!hasObserver) {
      var debouncedRescan = debounce(function () {
        if (!document.hidden) doRescan();
      }, 500);
      document.addEventListener('visibilitychange', debouncedRescan);
    }

    // ── manual refresh button — injected into the file-explorer's own
    // nav-buttons-container (docs/plans/folder-refresh-toolbar.md §0.1 spike,
    // executor, Chromium headless against the real 1.12.7 mobile bundle) ────
    // §0.1א (DOM): `.workspace-leaf-content[data-type="file-explorer"]
    // .nav-header .nav-buttons-container` exists and holds 5 native
    // `.nav-action-button` siblings (New note/New folder/Change sort
    // order/Auto-reveal/Expand all). Exact markup, verified via outerHTML:
    // `<div class="clickable-icon nav-action-button" aria-label="...">`
    // wrapping an inline `<svg class="svg-icon lucide-<name>" .../>` — a
    // `<div>`, not a `<button>` (matches the brief's §3א pseudocode). We
    // clone that shape exactly instead of the old fixed-position overlay.
    // §0.1ג (icon): `window.setIcon`/`obsidian.setIcon` are NOT exposed
    // globally in this bundle (confirmed empirically — `typeof
    // window.setIcon === 'undefined'`) → inline SVG. `OW_REFRESH_SVG` below
    // uses the *exact* path data lucide-refresh-cw resolves to in this
    // bundle's icon table (grepped from app.js, not the generic/newer lucide
    // shape — bundled lucide versions drift), so it matches the sibling
    // icons pixel-for-pixel.
    // §0.1ב (timing/re-mount): the file-explorer view mounts after boot and
    // can remount (layout-change fires 8x in this bundle — confirmed a real,
    // subscribable `app.workspace` event via `workspace.trigger('layout-
    // change')` in the spike). `mountRefreshButton` is idempotent (dedupe via
    // `.querySelector('.ow-folder-refresh-btn')` per bar) so it's safe to
    // call both once via `owWhenAppReady` (first mount) and again on every
    // `layout-change` (recovers from remounts) without ever duplicating.
    var OW_REFRESH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" ' +
      'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-refresh-cw">' +
      '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>' +
      '<path d="M21 3v5h-5"></path>' +
      '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>' +
      '<path d="M8 16H3v5"></path></svg>';

    function mountRefreshButton() {
      var bars = document.querySelectorAll(
        '.workspace-leaf-content[data-type="file-explorer"] .nav-buttons-container');
      for (var i = 0; i < bars.length; i++) {
        var bar = bars[i];
        if (bar.querySelector('.ow-folder-refresh-btn')) continue;   // dedupe
        var btn = document.createElement('div');   // nav-action-button is a div in this bundle
        btn.className = 'clickable-icon nav-action-button ow-folder-refresh-btn';
        btn.setAttribute('aria-label', 'רענן — שינויים חיצוניים בתיקייה');
        btn.innerHTML = OW_REFRESH_SVG;
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          doRescan();
        });
        bar.appendChild(btn);
      }
    }

    // guard מקומי (owWaitForWorkspace pattern, vault-note-deeplink finding,
    // boot.js:1037-1053): window.app.vault יכול להיות קיים לפני
    // window.app.workspace (App.onload אסינכרוני) — owWhenAppReady לבד לא
    // מבטיח את זה. owWaitForWorkspace עצמו מוגדר scope-מקומי במקום אחר בקובץ
    // (לא נגיש מכאן) — פולינג-מקומי זהה, לא מגדיר מחדש את ה-helper המקורי.
    owWhenAppReady(function (app) {
      function whenWorkspaceReady(tries) {
        if (app.workspace) {
          mountRefreshButton();
          app.workspace.on('layout-change', mountRefreshButton);
          return;
        }
        if ((tries || 0) >= 160) return;   // timeout שקט — עקבי עם owWhenAppReady/owWaitForWorkspace
        setTimeout(function () { whenWorkspaceReady((tries || 0) + 1); }, 50);
      }
      whenWorkspaceReady(0);
    });
  }

  // ── pull-sync "Sync now" trigger (the pull-sync brief
  // §2/§3ד, pattern reused from installFolderRefreshWatch's manual-refresh
  // button above) ─────────────────────────────────────────────────────────
  // v1 = OPFS-local vaults only (brief §3א round-3 finding — the sync
  // engine's default OPFS root resolution only matches 'local' vaults'
  // layout). This VAULT_TYPE check is the ONE guard point run-pull.js
  // itself relies on (it never re-checks __owVaultType). A vault with no
  // stored `ow-sync:<id>` config (brief §3ה — v1 has no settings-UI, set
  // via localStorage directly) never gets a button, never touches the
  // network, never hashes anything (brief §5 DoD#6).
  function installSyncNowTrigger() {
    if (VAULT_TYPE !== 'local') return;
    if (!window.__owSyncRunPull) return;
    var cfg = window.__owSyncRunPull.getSyncConfig(VAULT_ID);
    if (!cfg) return; // guard — no config → no button, no network (DoD#6)

    // lucide "cloud-download" path data (stable across lucide releases —
    // unlike the refresh icon, this one wasn't grepped from this bundle's
    // app.js because it isn't a pre-existing bundle icon; inline SVG doesn't
    // depend on the bundle's icon table either way, brief §3ו / folder-
    // refresh-toolbar §0.1ג precedent: window.setIcon isn't exposed here).
    var OW_SYNC_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" ' +
      'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-cloud-download">' +
      '<path d="M12 13v8"></path><path d="m8 17 4 4 4-4"></path>' +
      '<path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"></path></svg>';

    function setSpin(on) {
      var btns = document.querySelectorAll('.ow-sync-now-btn');
      for (var i = 0; i < btns.length; i++) {
        if (on) btns[i].classList.add('is-spinning');
        else btns[i].classList.remove('is-spinning');
      }
    }

    var running = false;
    function doSync() {
      if (running) return; // UI-level debounce; window.__owSyncRunPull's own
                            // syncStatus mutex (brief §3ד) is the real guard —
                            // this just avoids spamming console/spin state.
      running = true;
      setSpin(true);
      window.__owSyncRunPull.run(VAULT_ID, cfg)
        .then(function (r) {
          if (r && r.skipped) {
            console.log('[ow-sync] busy — sync already running');
            return;
          }
          console.log('[ow-sync] ' + r.downloaded + ' downloaded, ' + r.skipped + ' skipped, ' + r.conflicts + ' conflicts');
          if (typeof window.Notice === 'function') {
            new window.Notice(r.downloaded + ' הורדו, ' + r.skipped + ' דילוגים, ' + r.conflicts + ' קונפליקטים');
          }
        })
        .catch(function (e) {
          console.warn('[ow-sync] sync failed', e);
          if (typeof window.Notice === 'function') {
            // 401 → explicit message, no retry-loop (brief §3ה).
            new window.Notice((e && e.code === 'EAUTH') ? 'סנכרון: אימות נכשל' : 'סנכרון נכשל');
          }
        })
        .then(function () { running = false; setSpin(false); });
    }

    function mountSyncButton() {
      var bars = document.querySelectorAll(
        '.workspace-leaf-content[data-type="file-explorer"] .nav-buttons-container');
      for (var i = 0; i < bars.length; i++) {
        var bar = bars[i];
        if (bar.querySelector('.ow-sync-now-btn')) continue;   // dedupe
        var btn = document.createElement('div');   // nav-action-button is a div in this bundle
        btn.className = 'clickable-icon nav-action-button ow-sync-now-btn';
        btn.setAttribute('aria-label', 'Sync now — משוך שינויים מהשרת');
        btn.innerHTML = OW_SYNC_SVG;
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          doSync();
        });
        bar.appendChild(btn);
      }
    }

    // same App.onload race guard as installFolderRefreshWatch above
    // (app.vault can exist before app.workspace).
    owWhenAppReady(function (app) {
      function whenWorkspaceReady(tries) {
        if (app.workspace) {
          mountSyncButton();
          app.workspace.on('layout-change', mountSyncButton);
          return;
        }
        if ((tries || 0) >= 160) return;
        setTimeout(function () { whenWorkspaceReady((tries || 0) + 1); }, 50);
      }
      whenWorkspaceReady(0);
    });
  }

  setStatus('Verifying vault...');

  // אמת שה-vault קיים: local → OPFS getDirectoryHandle (idempotent, אין
  // bootstrap בשרת ל-local); folder → שחזור handle מ-IndexedDB + permission
  // gate (queryPermission → showGrantScreen אם צריך); server → HTTP stat על
  // ה-root (כמו קודם).
  var verifyPromise;
  if (VAULT_TYPE === 'local') {
    verifyPromise = (async function () {
      if (!window.__owOpfsStore) throw new Error('OPFS store not loaded');
      var root = await navigator.storage.getDirectory();
      var vaults = await root.getDirectoryHandle('vaults', { create: true });
      await vaults.getDirectoryHandle(VAULT_ID, { create: true });   // idempotent
      return { isDirectory: true };
    })();
  } else if (VAULT_TYPE === 'folder') {
    verifyPromise = (async function () {
      if (!window.__owOpfsStore) throw new Error('OPFS store not loaded');
      if (!window.__owFolderHandles) throw new Error('folder handle store not loaded');
      var h = await window.__owFolderHandles.loadHandle(VAULT_ID);
      if (!h) throw new Error('folder handle missing — re-open the folder');
      var perm = await h.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await showGrantScreen(h);   // נתיב ראשי: כפתור → requestPermission (gesture)
      if (perm !== 'granted') throw new Error('Access not granted');
      window.__owFolderRoot = h;                                 // רק אחרי granted
      return { isDirectory: true };
    })();
  } else {
    verifyPromise = fetch('/api/fs/stat?vault=' + encodeURIComponent(VAULT_ID) + '&path=')
      .then(function (res) {
        if (!res.ok) throw new Error('Vault not found (HTTP ' + res.status + ')');
        return res.json();
      });
  }

  verifyPromise
    .then(async function(stat) {
      if (!stat || (!stat.isDirectory && stat.type !== 'directory')) throw new Error('Vault path is not a directory');

      // brief §3ב finding 4 (קריטי): מתקינים את הגישור גם כשכספת פתוחה — לא
      // רק בענף no-vault (למטה). בלי זה, switch/close שרצים מתוך vault פתוח
      // (בחירת vault אחר ברשימה, "close-vault"/openVaultChooser) רצים
      // נייטיבית (setItem/removeItem+reload) ולא נוחתים על /vault/<newid>
      // או /starter בהתאמה. installNativeVaultOpenBridge idempotent
      // (window.__owNativeVaultBridgeInstalled) — בטוח לקרוא גם אם הענף
      // no-vault כבר התקין (לא קורה באותו טעינת-עמוד, אבל להיות עקבי).
      installNativeVaultOpenBridge();

      // ── seed guard — empty-vault-only (seed-demo §0/§3ב, data-safety core) ──
      // A local/folder vault the user already has real content in must NEVER
      // be seeded (system plugins OR example content) without consent —
      // today's unconditional seed damages real vaults (brief §0). readdir
      // root, filter out .obsidian/.trash (Obsidian's own bookkeeping, not
      // user content) — ANY remaining entry → "not empty" → skip BOTH blocks
      // below entirely. readdir failure (e.g. permission edge) defaults to
      // "not empty" (skip) — data-safety-first when uncertain. `seedStore` is
      // reused by both blocks below (one makeStore()+readdir round-trip).
      var seedStore = null;
      var isVaultEmptyForSeed = false;
      if ((VAULT_TYPE === 'local' || VAULT_TYPE === 'folder') && window.__owOpfsStore) {
        var grSeed = VAULT_TYPE === 'folder' ? (async () => window.__owFolderRoot) : undefined;
        seedStore = window.__owOpfsStore.makeStore(VAULT_ID, { getRoot: grSeed });
        try {
          var rootListing = await seedStore.readdir({ path: '' });
          var userEntries = ((rootListing && rootListing.files) || []).filter(function (f) {
            return f.name !== '.obsidian' && f.name !== '.trash';
          });
          isVaultEmptyForSeed = userEntries.length === 0;
        } catch (e) {
          console.warn('[ow] seed guard readdir failed — skipping seed (data-safety default)', e);
        }
      }

      // seed system plugins ל-OPFS/folder לפני טעינת Obsidian (כדי ש-
      // community-plugins.json יהיה מוכן כש-Obsidian קורא אותו) — local
      // (OPFS) ו-folder vaults (לא server, שמקבל אותם דרך overlay צד-שרת
      // קיים). לא חוסם את הפתיחה אם נכשל (retry ב-boot הבא דרך ה-version-gate).
      // isVaultEmptyForSeed (למעלה): לעולם לא בכספת עם תוכן-משתמש קיים.
      if (isVaultEmptyForSeed && seedStore && window.__owSeedSystemPlugins) {
        try { await window.__owSeedSystemPlugins.seedSystemPlugins(seedStore); }
        catch (e) { console.warn('[ow] seed system plugins failed', e); }
      }

      // seed example content (Welcome.md, Features/*) לתוך vault ריק — CF static
      // בלבד (example-vault.json קיים רק ב-build של ה-CF deployment; מקומי
      // fetch מחזיר 404 ו-seedExampleVault מדלג). לא נוגע ב-.obsidian/ (finding
      // 1 בבריף — הקונפיג בבלעדיות של seedSystemPlugins למעלה). לא חוסם את
      // הפתיחה אם נכשל. ראה docs/plans/cf-mobile-seed.md §3ג.
      // deploy-config.md §3(ג): המתג seedExampleContent (ברירת-מחדל true —
      // התנהגות היום, DoD#2/#5) — ES5 guard pattern (avigail):
      // (window.__owConfig && window.__owConfig.X). isVaultEmptyForSeed
      // (למעלה): לעולם לא בכספת עם תוכן-משתמש קיים (seed-demo §0/§3ב).
      if (isVaultEmptyForSeed && seedStore && window.__owSeedExampleVault
          && (window.__owConfig && window.__owConfig.seedExampleContent)) {
        try { await window.__owSeedExampleVault.seedExampleVault(seedStore); }
        catch (e) { console.warn('[ow] seed example vault failed', e); }
      }

      setStatus('Loading Obsidian mobile...');
      console.log('[obsidian-web] vault ok, injecting mobile scripts');

      // ── Bootstrap fetch (parallel to script injection) — SERVER VAULTS ONLY.
      // /api/bootstrap returns the entire .obsidian/ tree + vault content
      // + dirs in one pre-compressed response. We expose it on
      // window.__owBootstrapCache so capacitor-shim's Filesystem.readFile/
      // stat/readdir can answer from cache instead of round-tripping per
      // file. watchAndStatAll awaits __owBootstrapPromise instead of
      // re-fetching. See docs/plans/mobile-bootstrap-cache.md.
      //
      // Local vaults have no server bootstrap endpoint (static-file server
      // only, per brief §2 scope boundary) — OpfsStore.watchAndStatAll
      // supplies the file tree directly from OPFS, no fetch needed. See
      // docs/plans/opfs-wire.md §4 Commit 1(ג).
      if (VAULT_TYPE === 'server') {
        var bootstrapPromise = fetch(
          '/api/bootstrap?vault=' + encodeURIComponent(VAULT_ID) + '&full=1',
          { headers: { 'Accept-Encoding': 'br, gzip' } },
        )
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            if (!data) return null;
            if (data.disabled) {
              console.log('[obsidian-web] bootstrap disabled by server, all FS reads will round-trip');
              window.__owBootstrapCache = null;
              return null;
            }
            window.__owBootstrapCache = data;
            var fileCount = data.fs ? Object.keys(data.fs).length : 0;
            var capped = data.capped ? ' (CAPPED: ' + data.cappedReason + ')' : '';
            console.log('[obsidian-web] bootstrap loaded: ' + fileCount + ' files cached' + capped);
            return data;
          })
          .catch(function (err) {
            console.warn('[obsidian-web] bootstrap failed:', err && err.message || err);
            window.__owBootstrapCache = null;
            return null;
          });
        window.__owBootstrapPromise = bootstrapPromise;
      }

      // הזרקה דינמית — browser מוריד במקביל, מריץ לפי סדר (async=false).
      // חולצה ל-injectMobileScripts() למעלה — נגישה גם לזרימת ה-no-vault.
      injectMobileScripts();

      // folder-vault external-change refresh (docs/plans/folder-watch.md §2) —
      // VAULT_TYPE guard is inside installFolderRefreshWatch itself (no-op
      // ל-local/server).
      installFolderRefreshWatch();

      // pull-sync "Sync now" trigger (the pull-sync brief
      // §2/§3ד) — VAULT_TYPE + config guards are inside installSyncNowTrigger
      // itself (no-op unless local vault + a stored ow-sync: config, brief
      // §5 DoD#6).
      installSyncNowTrigger();

      // ── שם-כספת מוצג מה-registry (docs/plans/vault-name-display.md §2/§3) ──
      // לכספת OPFS (local/folder) עם רשומת-registry, __owV.name הוא השם
      // שהמשתמשת נתנה; app.vault.getName() (basePath — ה-vault-id hash
      // לכספות OPFS) לא מתאים לתצוגה בפאנל (§0). guard: רק local/folder +
      // __owV.name לא-ריק — server ממשיך עם basename תקין (DoD#3, §2 "שינוי
      // לשם המוצג בכספת server ❌"), יתום (אין רשומה) נופל ל-getName הרגיל
      // (§9 Q3). ה-guard רץ רק בזרימת ה-VAULT_ID (לא בזרימת no-vault למעלה,
      // ששם VAULT_TYPE='server' תמיד) — עונה על גבול §2 "אחרי app-ready".
      if ((VAULT_TYPE === 'local' || VAULT_TYPE === 'folder') && __owV && __owV.name) {
        owWhenAppReady(function (app) {
          var desired = __owV.name;
          if (app.vault && typeof app.vault.getName === 'function') {
            var orig = app.vault.getName.bind(app.vault);
            app.vault.getName = function () { return desired || orig(); };
          }
          refreshVaultProfileLabel(desired);
        });
      }

      // הסרת ספינר כשה-workspace מוכן
      removeLoadingOverlayWhen('.workspace');

      // executor finding (vault-note-deeplink, אמפירי בChromium): owWhenAppReady
      // (מ-#1) בודק רק window.app && window.app.vault — App.onload הוא
      // async-generator (`this.vault=new mx(t)` ואז כמה awaits לפני
      // `this.workspace=...`, מאומת בgrep על הbundle), אז window.app.workspace
      // עלול עדיין להיות undefined באותו tick ש-vault כבר קיים (נתפס פעם אחת
      // ב-4 ריצות — "Cannot read properties of undefined (reading
      // 'onLayoutReady')"). guard מקומי — לא נוגע/מגדיר מחדש את owWhenAppReady
      // עצמו, רק ממתין בנוסף ל-workspace לפני שממשיכים. משותף לכיוון-נכנס
      // (למטה) ולכיוון-יוצא (§3ג, למטה).
      // timeout מוגבל (calev finding: אחרת רקורסיה אינסופית אם App.onload
      // קובע vault ואז נכשל לפני workspace — התיישר עם ה-8s deadline של
      // owWhenAppReady: 160 ניסיונות × 50ms. שקט בכשל — cb פשוט לא נקרא).
      function owWaitForWorkspace(app, cb, tries) {
        if (app.workspace) { cb(app); return; }
        if ((tries || 0) >= 160) return;
        setTimeout(function () { owWaitForWorkspace(app, cb, (tries || 0) + 1); }, 50);
      }

      // ── deep-link למסמך — כיוון-נכנס (vault-note-deeplink §3ב) ─────────────
      // NOTE_PATH הגיע מה-URL (/vault/<id>/<note-path>) — פותחים אותו אחרי
      // ש-workspace מוכן (onLayoutReady, לא רק window.app קיים — owWhenAppReady
      // לבד לא מבטיח שה-workspace layout כבר טעון). md בלי סיומת →
      // getFirstLinkpathDest (idiomatic ל-Obsidian, פותר קישורים); קובץ אחר
      // (עם סיומת, למשל תמונה) → fallback ל-getAbstractFileByPath (נתיב מדויק).
      // מסמך לא-קיים → graceful: נשאר בתצוגת-ברירת-מחדל של הכספת, בלי שגיאה
      // (DoD#3) — owWhenAppReady משתמש מחדש בהelper מ-vault-name-display (#1),
      // לא מוגדר מחדש.
      if (NOTE_PATH) {
        owWhenAppReady(function (app) {
          owWaitForWorkspace(app, function (app) {
            app.workspace.onLayoutReady(function () {
              var f = app.metadataCache.getFirstLinkpathDest(NOTE_PATH.replace(/\.md$/, ''), '')
                      || app.vault.getAbstractFileByPath(NOTE_PATH);
              if (f) app.workspace.getLeaf(false).openFile(f);
            });
          });
        });
      }

      // ── deep-link למסמך — כיוון-יוצא (vault-note-deeplink §3ג) ──────────────
      // מעדכן את ה-URL לפי הקובץ הפעיל בכל שינוי (ניווט לקישור, מעבר בין
      // מסמכים, סגירה). מקור-האמת הוא app.workspace.getActiveFile() (לא ה-arg
      // של file-open, finding 1 בבריף) — נרשם גם על file-open וגם על
      // active-leaf-change (file-open(null) לא מובטח בסגירה, active-leaf-change
      // כן יורה על leaf ריק → getActiveFile()===null → DoD#5). guard VAULT_ID +
      // מיקום בתוך בלוק vault-open בלבד (finding 2) — לא רץ בזרימת no-vault.
      // pathname!==url מונע history entries מיותרים ולולאה מול הפתיחה-הנכנסת
      // למעלה (replaceState לא עושה reload — boot לא רץ שוב, אין לולאה מבנית
      // גם בלי ה-guard). owWaitForWorkspace — אותו guard-הגנה כמו כיוון-נכנס
      // (§3ב, executor finding) למקרה ש-app.workspace עדיין undefined.
      owWhenAppReady(function (app) {
        if (!VAULT_ID) return;
        owWaitForWorkspace(app, function (app) {
          function syncUrlFromActiveFile() {
            var url = '/vault/' + encodeURIComponent(VAULT_ID);
            var file = app.workspace.getActiveFile && app.workspace.getActiveFile();
            if (file && file.path) {
              var p = file.path.replace(/\.md$/, '');
              url += '/' + p.split('/').map(encodeURIComponent).join('/');
            }
            if (location.pathname !== url) history.replaceState(null, '', url);
          }
          app.workspace.on('file-open', syncUrlFromActiveFile);
          app.workspace.on('active-leaf-change', syncUrlFromActiveFile);
        });
      });

      // ── "נהל כספות" <select> → openVaultChooser (polyfill) ────────────────
      // ה-<select> "נהל כספות" (vault-switcher, תחתית-שמאל) מקבל אופציה אחת
      // בלבד: "manage-vaults" (רשימת ה-vaults ריקה כי Bte() מחזיר ריק כשכספת
      // פתוחה — out-of-scope, ראה §2). מכיוון שהאופציה היחידה כבר הערך הנבחר,
      // הקשה עליה לא מפעילה `change` (הדפדפן לא יורה change באותה בחירה) →
      // openVaultChooser() לא נקרא → no-op. תופסים pointerdown+mousedown
      // (לפני native picker, לא change) בשלב ה-capture. guard opts.length<=1:
      // אם רשימת ה-vaults תאוכלס בעתיד (multi-option) → native change עובד →
      // לא מיירטים (docs/plans/vault-switcher-fix.md §3ב, §6).
      ['pointerdown', 'mousedown'].forEach(function (evt) {
        document.addEventListener(evt, function (e) {
          var sel = e.target && e.target.closest ? e.target.closest('select') : null;
          if (!sel) return;
          var opts = Array.prototype.slice.call(sel.options);
          // כל select עם 'manage-vaults' → openVaultChooser. (הוסר guard opts.length<=1:
          // כשה-vault זרוע-תוכן, Bte()/readdir מוסיף תת-ספריות כ"vaults" מדומים
          // — למשל 'Features' — אז length>1, אבל אלה אינם vaults אמיתיים ניתנים-למעבר.
          // מעבר-vault אמיתי קורה במסך-הפתיחה; לכן תמיד → chooser. תוקן אחרי שהבאג
          // צף על ה-demo החי (vault זרוע), בעוד calev בדק vault ריק (length 1).)
          if (opts.some(function (o) { return o.value === 'manage-vaults'; })) {
            e.preventDefault(); e.stopImmediatePropagation();   // מנסה לדכא את ה-native picker
            if (window.app && typeof window.app.openVaultChooser === 'function') {
              window.app.openVaultChooser();   // אומת: removeItem('mobile-selected-vault')+reload(500ms)→chooser
            }
          }
        }, true);
      });
    })
    .catch(function(err) {
      console.warn('[obsidian-web] vault check failed:', err.message);
      setStatus('Error: ' + err.message);
      localStorage.removeItem('obsidian-web:lastVaultId');
      setTimeout(function(){ location.href = '/starter'; }, 2000);
    });
}());
