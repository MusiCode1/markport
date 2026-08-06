/**
 * platform-bridge.js — runtime interception of Obsidian's `Platform` object.
 *
 * Replaced three of the four build-time patches that scripts/patch-obsidian-mobile.js
 * used to apply to vendor/obsidian-mobile/app.js (expose-platform,
 * iife-overrides, is-mobile-class); docs/plans/zero-patches.md then removed the
 * fourth, so **no build-time patch remains** and app.js is byte-identical to
 * Obsidian's own APK. Those patches edited
 * Obsidian's own minified source; this module achieves the same effect by
 * intercepting the native `Object.defineProperty` call webpack's export map
 * uses to wire up `Platform` (`n.d(e,{Platform:()=>bn})`), without touching
 * a single byte of app.js. See docs/plans/runtime-platform-descriptors.md
 * (§0-§3) for the full design and the live-browser spike that proved it.
 *
 * The 4th patch (vault-profile-on-desktop-layout) was NOT replaced by this
 * module — it stayed a build-time patch (see scripts/patch-obsidian-mobile.js)
 * until docs/plans/zero-patches.md removed it outright: this module's own
 * `isDesktopApp` locking (see LOCKED_FLAGS below) already covers what that
 * patch used to do, once desktop-layout-now turned isDesktopApp into a real,
 * locked flag. Zero build-time patches remain on the bundle.
 *
 * Load order (brief §3.0 — this is what makes the timing work):
 *   index.html   this script          → installs the interceptor, idle
 *   index.html   boot.js              → sets window.__owPlatformOverrides
 *                                        (sync, before anything async runs)
 *   boot.js      injectMobileScripts() → dynamically injects app.js (later,
 *                                        after vault verification)
 *   app.js       n.d(...Platform...)  → interceptor fires, reads
 *                                        __owPlatformOverrides (already set)
 *
 * Must be loaded as a classic <script> BEFORE boot.js — see index.html.
 * ES5 style throughout (var/function, no arrow functions, no
 * Object.assign/optional-chaining) to match this codebase's convention for
 * code that must survive being parsed before any transpiler runs (see
 * boot.js's "ES5 guard pattern" comment) — index.html serves classic
 * scripts only, `type="module"` would be silently rejected.
 *
 * Exports the pure decision logic (no window/document access) for
 * node:test — same "module.exports under Node, window.__owX in the
 * browser" pattern as bootstrap-lookup.js / local-vault-registry.js. The
 * actual interception (Object.defineProperty wrapping, the candidate queue,
 * Element.prototype.addClass wrapping) needs a live DOM/webpack bundle and
 * is verified in a real browser only (brief §5 DoD#12).
 */
(function () {
  'use strict';

  // ── named, reasoned constants — never magic numbers (brief §3.7 defect #5) ──

  // Per-candidate queueMicrotask retry budget before giving up on that one
  // candidate. The spike measured 2 ticks between webpack wiring the export
  // getter (`n.d(...Platform...)`) and the `var bn=` assignment landing
  // (brief §3.1 "קריטי"). 500 is a wide margin: ticks are microtask turns,
  // not wall-clock time, so waiting longer is essentially free — but an
  // unbounded loop would wrap Object.defineProperty forever if Obsidian's
  // shape ever changes so the assignment never lands.
  var CAPTURE_TICK_CEILING = 500;

  // Crash-guard ONLY — brief §3.1a, THIRD round: the second round's fix
  // ("anchor to app.js's `load` event, but keep a 30s wall-clock give-up
  // too") still contained a wall-clock DEADLINE on capture, and any deadline
  // reproduces the exact same silent failure once the network is slow
  // enough — calev measured it live: at 200 kbps app.js lands at 46.4s,
  // past that round's 30s bound, same failure, word for word. The bug was
  // never the constant's SIZE; it was that a timer "gave up" on capture at
  // all while app.js could still legitimately be on the wire. Capture is now
  // anchored ONLY to app.js's own <script> element settling — either
  // notifyAppJsLoaded() (native `load`) or notifyAppJsFailed() (native
  // `error`, boot.js's existing s.onerror) — see both below. THIS timer
  // fires only if NEITHER of those two ever happens, i.e. app.js's <script>
  // element never settles at all (should be impossible in a browser; this
  // guards the "impossible" case, e.g. some future change breaks the
  // load/error wiring). Documented as: this should never fire. Generous on
  // purpose — 5 minutes — because it no longer races anything real.
  var CRASH_GUARD_MS = 5 * 60 * 1000;

  // Mirrors the spike's addClass safety net: if document.body's "is-mobile"
  // class is never added (so the wrapped addClass never self-restores — see
  // wrapAddClass() "restore on first filter"), unwrap
  // Element.prototype.addClass anyway after this window so the wrapper
  // doesn't tax addClass calls for the rest of the runtime (brief §3.1
  // "עטיפה שנשארת היא מס על כל הרנטיים").
  var ADDCLASS_SAFETY_NET_MS = 3000;

  // Exactly these four are locked — brief §3.2 + docs/plans/
  // desktop-layout-now.md §1. isPhone/isTablet are read from
  // window.__owPlatformOverrides upstream (boot.js) but intentionally never
  // locked here: Obsidian's own wn() rewrites them on every viewport change
  // (matchMedia), and locking would freeze
  // canSplit/canStackTabs/canDisplayRibbon/canPinSidebar.
  //
  // ⚠️ isDesktopApp — §1ג: THIS COMMENT USED TO SAY overriding isDesktopApp
  // would be a no-op because "the bundle never sets it on the mobile
  // codepath" (runtime-platform-descriptors.md §3.2, written before this
  // repo shipped an electron shim). That was true THEN and is false NOW:
  // desktop-layout-now turns isDesktopApp into the flag that gates ~95 code
  // paths (window.electron consumers, the vault-switcher panel, PDF
  // export/popout gating, …) — locking it is the entire point of this
  // slice. Do not revert this to a comment claiming it's a no-op; it isn't.
  var LOCKED_FLAGS = ['isMobile', 'isMobileApp', 'isDesktop', 'isDesktopApp'];

  // ── pure decision logic — no window/document access, unit-testable ──────

  // brief §3.1 — spike defect #1: this check existed in the spike but was
  // only computed, never enforced. Here it gates whether a captured object
  // is accepted at all.
  function isValidShape(P) {
    return !!P && typeof P === 'object' &&
      ('isMobileApp' in P) && ('canPinSidebar' in P);
  }

  // brief §3.5 says "truthy VALUE, not mere key existence" — and THIRD-round
  // fix: "truthy" means exactly what the BUNDLE's own guard means by it
  // (`localStorage.getItem(Zee) &&`), not human intuition about "0"/"false"
  // strings. A second calev pass special-cased "0"/"false" as OFF here —
  // which looked reasonable in isolation but desynced this function from
  // the TWO OTHER readers of the identical `EmulateMobile` key: the bundle's
  // own guard and obsidian-web-layout/main.js's isEmulateMobileActive()
  // (both plain `!!localStorage.getItem(...)`, both treat "0" as ON). A
  // third calev pass caught the result live: with
  // `localStorage.EmulateMobile = "0"`, this bridge said OFF while the
  // bundle's guard ran the mobile-emulation block anyway — the exact
  // "half-state" brief §3.5 declared impossible (mixed is-mobile/desktop
  // flags, layout switcher permanently disabled for a feature the bridge
  // insisted wasn't even active). Consistency with the bundle wins over
  // intuition: `"0"` is surprising but ON, same as everywhere else this key
  // is read. If that ever needs to change, it must change in all three
  // places at once — never here alone.
  function isEmulateActive(value) {
    return !!value;
  }

  // Combines brief §3.0 (fallback when __owPlatformOverrides is missing) and
  // §3.5 (EmulateMobile takes precedence — "קדימות"). `overrides` is
  // whatever window.__owPlatformOverrides currently holds; `emulateValue` is
  // the raw string from localStorage.getItem('EmulateMobile') (checked via
  // isEmulateActive() above — truthy VALUE and not one of the "off" strings
  // a user could plausibly set by hand, not mere key existence).
  //
  // Returns null when there is nothing valid to lock onto — callers MUST
  // treat null as "do not lock anything, do not wrap addClass" (brief §3.0
  // "המלכודת": on an empty object `!want.isMobile` is `true`, which would
  // wrongly suppress is-mobile while Platform still reports mobile).
  function computeWant(overrides, emulateValue) {
    // docs/plans/desktop-layout-now.md §1א — TWO exit paths build a want
    // literal, and BOTH must carry isDesktopApp explicitly. This
    // emulate-mobile path is an EARLY RETURN, textually and structurally
    // separate from the "normal" literal below — a naive "just add
    // isDesktopApp to computeWant" that only touches the second literal
    // leaves this one returning `undefined` for isDesktopApp under
    // emulation (falsy, but NOT `=== false`, which DoD#0 requires strictly).
    if (isEmulateActive(emulateValue)) {
      return { isMobile: true, isMobileApp: true, isDesktop: false, isDesktopApp: false };
    }
    if (!overrides || typeof overrides !== 'object') return null;
    // calev (round 2) — "existing" is not "valid": window.__owPlatformOverrides
    // = {} is a plain object, so the check above alone let it through, and
    // shouldWrapAddClass() then wrapped addClass off an overrides value that
    // never actually said anything about isMobile/isDesktop. Brief §3.0/§3.3
    // name this trap explicitly ("המלכודת") and require `want` to be
    // "קיים ותקף" (existing AND valid) — require at least one of the two
    // flags this module actually locks-from to be present in overrides
    // before treating it as a real decision. Not reachable through boot.js
    // today (it always publishes all six flags), but the guard the brief
    // asked for belongs here regardless of today's only caller.
    if (!('isMobile' in overrides) && !('isDesktop' in overrides)) return null;
    return {
      isMobile: !!overrides.isMobile,
      isMobileApp: true, // brief §3.2: always locked true, never derived from overrides
      isDesktop: !!overrides.isDesktop,
      // docs/plans/desktop-layout-now.md §2.1 — "want.isDesktopApp ⇔
      // !want.isMobile": derived from the SAME source as isDesktop (boot.js
      // computes isDesktop as !layout.isMobile too — there is no separate
      // "desktop app vs. desktop layout" distinction upstream), not read
      // from overrides.isDesktopApp directly (boot.js's own overrides
      // object still carries an isDesktopApp field for readability, but
      // this module never trusts it — same "never derived FROM overrides
      // for this key" posture as isMobileApp above, just mirroring a
      // different source flag instead of a hardcoded constant).
      isDesktopApp: !!overrides.isDesktop,
    };
  }

  // brief §3.3 — "כל שלושת הסייגים במקום אחד": want must exist AND be a
  // real (non-empty) decision, AND that decision must be "not mobile". A
  // missing/null want must never satisfy this (see computeWant's doc above).
  function shouldWrapAddClass(want) {
    return !!want && !want.isMobile;
  }

  var api = {
    isValidShape: isValidShape,
    isEmulateActive: isEmulateActive,
    computeWant: computeWant,
    shouldWrapAddClass: shouldWrapAddClass,
    CAPTURE_TICK_CEILING: CAPTURE_TICK_CEILING,
    CRASH_GUARD_MS: CRASH_GUARD_MS,
    ADDCLASS_SAFETY_NET_MS: ADDCLASS_SAFETY_NET_MS,
    LOCKED_FLAGS: LOCKED_FLAGS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return; // under node:test — never touch window/Object.defineProperty
  }
  if (typeof window === 'undefined') return;

  window.__owPlatformBridge = api; // exposed for the same-turn self-test (brief §5 DoD#12)

  // ── browser wiring — installs the Object.defineProperty interceptor ─────

  var orig = Object.defineProperty;
  var queue = [];            // { getter, tries } — brief §3.1 "תור מועמדים, לא מועמד יחיד"
  var pumpScheduled = false;
  var settled = false;       // true once we've captured (or globally given up) — stop everything
  // Set by EITHER notifyAppJsLoaded() (native `load`) OR notifyAppJsFailed()
  // (native `error`) — brief §3.1a, third round: exactly one of these two
  // fires, exactly once, for app.js's <script> element. Either is equally
  // definitive that "nothing more can ever be queued from app.js's own
  // top-level evaluation", so both route through the same give-up check.
  var appJsOutcomeSignalReceived = false;

  // One warning PER DISTINCT message, not one warning total (brief §3.1a
  // finding 3, calev): a single shared flag let an early, low-value warning
  // ("a foreign candidate never resolved") permanently swallow the two
  // high-value ones ("overrides missing", "capture never completed") —
  // weakening the one telemetry signal that replaced applyPatches' loud
  // throw (brief §3.0).
  var warnedFor = {};
  function warnOnce(key, msg) {
    if (warnedFor[key]) return;
    warnedFor[key] = true;
    console.warn('[obsidian-web] platform-bridge: ' + msg);
  }

  // A genuine give-up (not the benign "one foreign candidate dropped, still
  // listening" case) gets more than a console message nobody will see
  // (brief §3.1a: "warning אחד לא מספיק... להוסיף אינדיקציה שהמשתמש יכול
  // לפעול לפיה"). boot.js exposes this hook right after defining its own
  // setStatus(), long before app.js is even injected — both give-up paths
  // below only fire after app.js has been injected (or, for the absolute
  // fallback, well after boot.js's synchronous top level has run), so the
  // hook is always present by the time this could possibly be called.
  function reportCaptureFailure(key, msg) {
    warnOnce(key, msg);
    if (typeof window.__owReportPlatformFailure === 'function') {
      window.__owReportPlatformFailure(msg);
    }
  }

  var wrapped = function (target, prop, desc) {
    if (!settled && prop === 'Platform' && desc && typeof desc.get === 'function') {
      queue.push({ getter: desc.get, tries: 0 });
      schedulePump();
    }
    return orig.apply(this, arguments);
  };
  Object.defineProperty = wrapped;

  function restoreDefineProperty() {
    if (Object.defineProperty === wrapped) Object.defineProperty = orig;
  }

  // Crash-guard (brief §3.1a, THIRD round). Not a normal give-up path at
  // all — see CRASH_GUARD_MS's own comment above. The two real anchors are
  // notifyAppJsLoaded() and notifyAppJsFailed() below; this timer only fires
  // if app.js's <script> element never settles either way, which should be
  // impossible in a browser.
  setTimeout(function () {
    if (settled) return;
    settled = true;
    restoreDefineProperty();
    reportCaptureFailure('crash-guard',
      'capture never completed within the ' + (CRASH_GUARD_MS / 1000) +
      's crash-guard — app.js\'s <script> element never fired load OR error, which should not be possible; running with Platform unmodified. Try reloading the page.');
  }, CRASH_GUARD_MS);

  // Shared give-up check for both of app.js's <script>-element outcomes
  // (brief §3.1a, third round: "לעגן בשני אירועים"). By the time EITHER
  // `load` or `error` fires, app.js's synchronous top-level evaluation —
  // where the real defineProperty('Platform', ...) call would happen
  // (webpack's export map, n.d(e,{Platform:()=>bn})) — has already either
  // run to completion (`load`) or never run at all (`error`, the request
  // itself failed). Either way:
  //   · if NO candidate was ever queued, nothing is left to wait for — give
  //     up right away.
  //   · if a candidate WAS queued but hasn't resolved yet (only possible on
  //     the `load` path — bn's assignment lands a couple microtask ticks
  //     later per the spike's measurement), its own per-candidate ceiling
  //     (tick-based, not ms — CAPTURE_TICK_CEILING) keeps governing it via
  //     the normal pump() path; pump()'s own post-load queue-drain check
  //     (below) takes over from there.
  function onAppJsSettled(giveUpMessage) {
    if (settled || appJsOutcomeSignalReceived) return;
    appJsOutcomeSignalReceived = true;
    // One microtask hop of margin (brief §3.1a "ניקוז microtasks, ticks לא
    // ms") before deciding — defensive: per HTML's task/microtask-queue
    // ordering this is already guaranteed to run after any pump() turn
    // queued during app.js's own synchronous evaluation, but checking
    // straight from a queued microtask (rather than synchronously inside
    // this call, which runs from boot.js's script-load/error task handler)
    // keeps this independent of that guarantee.
    queueMicrotask(function () {
      if (settled) return;
      if (queue.length === 0) {
        settled = true;
        restoreDefineProperty();
        reportCaptureFailure('no-candidate-post-load', giveUpMessage);
      }
      // else: a real candidate is mid-flight (load path only) — see
      // pump()'s post-load queue-drain check for what happens once it
      // settles.
    });
  }

  // Called by boot.js once app.js's OWN <script> element fires its native
  // `load` event — the anchor for the common case (finding 1: replaces the
  // wall-clock deadline that used to count Obsidian's own bundle-download
  // time).
  function notifyAppJsLoaded() {
    onAppJsSettled('app.js finished loading but no Platform export was ever intercepted; running with Platform unmodified. Try reloading the page.');
  }
  window.__owPlatformBridge.notifyAppJsLoaded = notifyAppJsLoaded;

  // Called by boot.js once app.js's OWN <script> element fires its native
  // `error` event (brief §3.1a, third round — previously missing: only the
  // success path had an anchor, so a network failure fell all the way
  // through to whatever wall-clock fallback existed). app.js's request
  // failed outright, so its top-level code never ran — nothing can ever be
  // queued from it, and this settles immediately (no in-flight candidate is
  // possible on this path, unlike the `load` case above).
  function notifyAppJsFailed() {
    onAppJsSettled('app.js failed to load (network error); running with Platform unmodified. Try reloading the page.');
  }
  window.__owPlatformBridge.notifyAppJsFailed = notifyAppJsFailed;

  function schedulePump() {
    if (pumpScheduled || settled) return;
    pumpScheduled = true;
    queueMicrotask(pump);
  }

  // Single recurring microtask pump processing the WHOLE queue each turn
  // (brief §3.1 "מי מתזמן: queueMicrotask יחיד ורץ-בלולאה... לא tick נפרד
  // למועמד"). This is what lets two defineProperty('Platform', ...) calls
  // that land in the same synchronous turn (before any microtask has run)
  // both get a fair first check — the second is not simply overwritten by
  // the first (brief §5 DoD#12 same-turn self-test).
  function pump() {
    pumpScheduled = false;
    if (settled) return;
    var next = [];
    for (var i = 0; i < queue.length; i++) {
      if (settled) return; // capture() below may settle mid-loop
      var candidate = queue[i];
      var P;
      try { P = candidate.getter(); } catch (e) { P = undefined; }
      if (P && typeof P === 'object') {
        if (isValidShape(P)) {
          capture(P);
          return; // capture() restores synchronously (finally) — stop
        }
        // Foreign Platform-shaped object that failed shape validation —
        // dropped immediately, keep scanning the REST of the queue in this
        // same tick (brief §3.1 "נזרק מיד, ועוברים לבא בתור באותו tick").
        continue;
      }
      // Not ready yet (getter returned undefined — var not assigned yet).
      candidate.tries++;
      if (candidate.tries >= CAPTURE_TICK_CEILING) {
        // Per-candidate ceiling, not global (brief §3.1) — a candidate stuck
        // forever does not consume the budget of others behind it, because
        // each candidate carries its own `tries` counter. Benign by itself
        // (re-arm keeps listening) — not a reportCaptureFailure, just a
        // diagnostic warning.
        warnOnce('candidate-ceiling', 'a Platform candidate never resolved to an object within ' + CAPTURE_TICK_CEILING + ' ticks; dropping it.');
        continue;
      }
      next.push(candidate);
    }
    queue = next;
    if (queue.length) {
      schedulePump();
      return;
    }
    // Queue drained without a verified capture this turn. Before app.js has
    // finished loading, an empty queue is expected and fine — a later
    // <script> may still queue the real candidate (brief §3.1 "נשארים
    // עטופים"). But once app.js HAS loaded, every script that could ever
    // call defineProperty('Platform', ...) has already run — nothing left
    // to wait for, so restore synchronously right now instead of relying
    // on the wall-clock fallback (brief §3.1a finding 2: "תקרה פר-מועמד
    // חייבת לשחזר defineProperty סינכרונית" — an existing §3.1 requirement
    // that wasn't met, not a new one).
    if (appJsOutcomeSignalReceived && !settled) {
      settled = true;
      restoreDefineProperty();
      reportCaptureFailure('queue-drained-post-load',
        'app.js\'s <script> settled and the capture queue drained with nothing captured; running with Platform unmodified. Try reloading the page.');
    }
  }

  function capture(P) {
    settled = true; // no more candidates accepted/scheduled from here on
    try {
      var want = computeWant(window.__owPlatformOverrides, localStorage.getItem('EmulateMobile'));
      if (want) {
        for (var i = 0; i < LOCKED_FLAGS.length; i++) {
          lockFlag(P, LOCKED_FLAGS[i], want);
        }
        // Expose only a validated, (attempted-)locked reference — brief
        // §3.0 "מועמד שנדחה באימות — לעולם לא נחשף" / "רק להפניה שעברה
        // אימות-צורה". If lockFlag above throws, we never reach this line —
        // that's the point of try/finally over try/catch here (brief §3.7
        // defect #4): a genuine failure mid-install must not expose a
        // half-configured Platform nor wrap addClass.
        window.__owPlatform = P;
        if (shouldWrapAddClass(want)) wrapAddClass();
      } else {
        // brief §3.0 fallback: __owPlatformOverrides missing/invalid at
        // install time — do not lock anything and do NOT wrap addClass, but
        // still expose the validated reference (existing consumers like
        // obsidian-web-layout/main.js:65 must keep working).
        //
        // docs/plans/desktop-layout-now.md §1ב/DoD#12 — THIS is the "app
        // boots, and the user has a way to notice" path: computeWant
        // returning null means Platform.isDesktopApp could silently come
        // out however the bundle's own default happens to be, with zero
        // visible indication. reportCaptureFailure() (defined above,
        // already wired to boot.js's __owReportPlatformFailure banner for
        // the OTHER give-up paths — crash-guard, queue-drained, etc.) was
        // NOT called from here before this slice; a plain warnOnce() only
        // ever reached the browser console. Now it does — the bottom banner
        // boot.js already renders for every other give-up path also covers
        // this one.
        reportCaptureFailure('overrides-missing', 'window.__owPlatformOverrides missing at install — running without platform locking.');
        window.__owPlatform = P;
      }
      // docs/plans/desktop-layout-now.md §4 — canExportPdf/canPopoutWindow
      // locked to a fixed `false`, UNCONDITIONALLY (both branches above,
      // not just when `want` locked successfully): this deployment never
      // supports real PDF export or Electron popout windows, independent
      // of layout mode — there is no "want" value for either (they're not
      // derived from isMobile/isDesktop at all, unlike LOCKED_FLAGS).
      // lockFlag's `want[key]` pattern can't express a value with no
      // corresponding `want` entry — hence the separate lockConst() below,
      // same defineProperty/set-noop shape, no `want` lookup.
      lockConst(P, 'canExportPdf', false);
      lockConst(P, 'canPopoutWindow', false);
    } finally {
      restoreDefineProperty();
    }
  }

  function lockFlag(P, key, want) {
    // `set` no-op is mandatory, not optional (brief §3.2): the bundle's own
    // entry IIFE assigns these flags inside `"use strict"`, and assigning to
    // an accessor with no setter throws there.
    orig(P, key, {
      get: function () { return want[key]; },
      set: function () {},
      configurable: true,
      enumerable: true,
    });
  }

  // docs/plans/desktop-layout-now.md §4 — same defineProperty/set-noop
  // shape as lockFlag above, but for a genuinely CONSTANT value with no
  // corresponding `want` entry (canExportPdf/canPopoutWindow are never
  // derived from isMobile/isDesktop — they're just always false in this
  // deployment). ✅ safe against `defineProperty` throwing: both
  // canExportPdf/canPopoutWindow are plain object-literal getters on the
  // captured Platform object, hence `configurable` by default.
  function lockConst(P, key, value) {
    orig(P, key, {
      get: function () { return value; },
      set: function () {},
      configurable: true,
      enumerable: true,
    });
  }

  function wrapAddClass() {
    var proto = Element.prototype;
    if (typeof proto.addClass !== 'function') return;
    var origAC = proto.addClass;
    var acRestored = false;
    function restoreAC() {
      if (acRestored) return;
      acRestored = true;
      if (proto.addClass === wrappedAC) proto.addClass = origAC;
    }
    var wrappedAC = function () {
      var args = Array.prototype.slice.call(arguments);
      if (this === document.body) {
        var idx = args.indexOf('is-mobile');
        if (idx !== -1) {
          args.splice(idx, 1);
          restoreAC(); // restore on first filter — brief §3.3
          // Mirror the ORIGINAL addClass's return contract: it always
          // returns undefined (brief §3.7 defect #7 — the spike wrongly
          // returned `this`). Only call through when there's something left
          // to add; either way, return undefined.
          if (args.length) origAC.apply(this, args);
          return undefined;
        }
      }
      return origAC.apply(this, args);
    };
    proto.addClass = wrappedAC;
    setTimeout(restoreAC, ADDCLASS_SAFETY_NET_MS);
  }
})();
