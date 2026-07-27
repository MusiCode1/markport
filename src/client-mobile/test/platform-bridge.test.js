'use strict';

/**
 * Unit tests for platform-bridge.js's pure decision logic (docs/plans/
 * runtime-platform-descriptors.md §4 Commit 1, §3.7#8).
 *
 * The actual interception (Object.defineProperty wrapping, the
 * queueMicrotask candidate queue, Element.prototype.addClass wrapping) needs
 * `window`/`document`/a live webpack bundle and is NOT testable under
 * node:test (no DOM) — see brief §5 DoD#12. Those paths are verified in a
 * real browser by calev. This file covers only the pieces that don't touch
 * window/document: shape validation (§3.1), `want` computation from
 * __owPlatformOverrides + EmulateMobile (§3.0/§3.5), and the addClass-wrap
 * condition (§3.3) — the exact logic the brief calls out as having burned
 * three review rounds when gotten wrong.
 */

const assert = require('assert/strict');
const test = require('node:test');
const bridge = require('../platform-bridge');

// ── isValidShape (§3.1 — "must be enforced", spike defect #1: computed but not enforced) ──

test('isValidShape accepts an object with both isMobileApp and canPinSidebar', () => {
  assert.equal(bridge.isValidShape({ isMobileApp: true, canPinSidebar: false }), true);
});

test('isValidShape rejects an object missing isMobileApp (foreign Platform-shaped object)', () => {
  assert.equal(bridge.isValidShape({ canPinSidebar: false }), false);
});

test('isValidShape rejects an object missing canPinSidebar', () => {
  assert.equal(bridge.isValidShape({ isMobileApp: true }), false);
});

test('isValidShape rejects undefined (getter not ready yet — the common case, §3.1)', () => {
  assert.equal(bridge.isValidShape(undefined), false);
});

test('isValidShape rejects null and non-objects', () => {
  assert.equal(bridge.isValidShape(null), false);
  assert.equal(bridge.isValidShape('Platform'), false);
  assert.equal(bridge.isValidShape(42), false);
});

// ── computeWant (§3.0 fallback + §3.5 EmulateMobile precedence) ──

test('computeWant returns null when __owPlatformOverrides is missing — brief §3.0 fallback: "do not lock anything"', () => {
  assert.equal(bridge.computeWant(undefined, null), null);
  assert.equal(bridge.computeWant(null, null), null);
});

test('computeWant returns null for a non-object overrides value', () => {
  assert.equal(bridge.computeWant('nope', null), null);
});

test('computeWant returns null for an overrides object with neither isMobile nor isDesktop — "existing" is not "valid" (calev round 2, brief §3.0/§3.3 "המלכודת")', () => {
  assert.equal(bridge.computeWant({}, null), null);
  assert.equal(bridge.computeWant({ isPhone: true, isTablet: false }, null), null);
});

test('computeWant mirrors isMobile/isDesktop from overrides and always locks isMobileApp:true (§3.2, never derived); isDesktopApp mirrors isDesktop (desktop-layout-now §2.1 "want.isDesktopApp ⇔ !want.isMobile")', () => {
  const want = bridge.computeWant({ isMobile: false, isDesktop: true, isMobileApp: true, isPhone: false, isTablet: false, isDesktopApp: false }, null);
  assert.deepEqual(want, { isMobile: false, isMobileApp: true, isDesktop: true, isDesktopApp: true });
});

test('computeWant with mobile-layout overrides — isDesktopApp is strictly false, not merely falsy (DoD#0)', () => {
  const want = bridge.computeWant({ isMobile: true, isDesktop: false, isMobileApp: true }, null);
  assert.deepEqual(want, { isMobile: true, isMobileApp: true, isDesktop: false, isDesktopApp: false });
  assert.equal(want.isDesktopApp, false);
});

test('computeWant: EmulateMobile (truthy localStorage value) wins over __owPlatformOverrides — brief §3.5 "קדימות"', () => {
  const want = bridge.computeWant({ isMobile: false, isDesktop: true, isMobileApp: true }, '1');
  assert.deepEqual(want, { isMobile: true, isMobileApp: true, isDesktop: false, isDesktopApp: false });
});

test('computeWant: EmulateMobile is checked by truthiness of the raw value, not mere key existence (mirrors upstream Zee guard)', () => {
  // localStorage.getItem returns the string "" for an empty value, which is falsy —
  // must NOT be treated as "emulate active".
  const want = bridge.computeWant({ isMobile: false, isDesktop: true, isMobileApp: true }, '');
  assert.deepEqual(want, { isMobile: false, isMobileApp: true, isDesktop: true, isDesktopApp: true });
});

// ── isDesktopApp — desktop-layout-now.md §1א: the emulate-mobile branch is
// an EARLY RETURN, structurally separate from the "normal" literal — must
// carry isDesktopApp too, or emulation would leave it `undefined` (falsy,
// but not the strict `=== false` DoD#0 requires). ──

test('computeWant: isDesktopApp is === false under EmulateMobile, even starting from desktop overrides (§1א — the early-return path)', () => {
  const want = bridge.computeWant({ isMobile: false, isDesktop: true, isMobileApp: true, isDesktopApp: true }, '1');
  assert.equal(want.isDesktopApp, false);
});

test('computeWant: isDesktopApp is === true for desktop-layout overrides (isMobile:false/isDesktop:true) with no emulation active', () => {
  const want = bridge.computeWant({ isMobile: false, isDesktop: true, isMobileApp: true }, null);
  assert.equal(want.isDesktopApp, true);
});

// ── isEmulateActive (THIRD calev pass — round 2 special-cased "0"/"false" as
// OFF here, which desynced this function from the bundle's own guard AND
// from obsidian-web-layout/main.js's isEmulateMobileActive() — both plain
// truthiness, both treat "0" as ON. That desync produced a real "half-state"
// bug live: this bridge said desktop while the bundle's guard ran the
// mobile-emulation block anyway. Reverted to plain truthiness — surprising,
// but consistent with the other two readers of the same key; see the
// function's own comment.) ──

test('isEmulateActive is plain truthiness — "0" is ON here too, matching the bundle\'s own guard and obsidian-web-layout/main.js (NOT the "0"/"false" special-case from a prior, since-reverted round)', () => {
  assert.equal(bridge.isEmulateActive('0'), true);
  assert.equal(bridge.isEmulateActive('false'), true);
});

test('isEmulateActive treats null/undefined/empty-string as OFF', () => {
  assert.equal(bridge.isEmulateActive(null), false);
  assert.equal(bridge.isEmulateActive(undefined), false);
  assert.equal(bridge.isEmulateActive(''), false);
});

test('isEmulateActive treats "1"/"true"/arbitrary truthy strings as ON', () => {
  assert.equal(bridge.isEmulateActive('1'), true);
  assert.equal(bridge.isEmulateActive('true'), true);
  assert.equal(bridge.isEmulateActive('yes'), true);
});

test('computeWant: EmulateMobile="0" DOES activate emulation — matches the bundle\'s own guard (regression guard for the third-round revert; the second round\'s "0"=OFF behavior must NOT come back)', () => {
  const want = bridge.computeWant({ isMobile: false, isDesktop: true, isMobileApp: true }, '0');
  assert.deepEqual(want, { isMobile: true, isMobileApp: true, isDesktop: false, isDesktopApp: false });
});

// ── shouldWrapAddClass (§3.3 — "the exact condition, all three caveats folded in") ──

test('shouldWrapAddClass is true when want is valid and isMobile is false (desktop layout — must suppress the unconditional addClass)', () => {
  assert.equal(bridge.shouldWrapAddClass({ isMobile: false, isMobileApp: true, isDesktop: true }), true);
});

test('shouldWrapAddClass is false when want is valid and isMobile is true (mobile layout — nothing to suppress)', () => {
  assert.equal(bridge.shouldWrapAddClass({ isMobile: true, isMobileApp: true, isDesktop: false }), false);
});

test('shouldWrapAddClass is false when want is null — the §3.0 trap: on an empty object !want.isMobile is true, which would wrongly wrap', () => {
  assert.equal(bridge.shouldWrapAddClass(null), false);
});

// ── constants exist and are sane (named, not magic — §3.7 defect #5) ──

test('exposes named, positive tick/time budgets instead of magic numbers', () => {
  assert.equal(typeof bridge.CAPTURE_TICK_CEILING, 'number');
  assert.ok(bridge.CAPTURE_TICK_CEILING > 0);
  assert.equal(typeof bridge.CRASH_GUARD_MS, 'number');
  assert.ok(bridge.CRASH_GUARD_MS > 0);
  // brief §3.1a, third round: capture is anchored ONLY to app.js's own
  // load/error events now — this is a crash-guard that should never fire in
  // normal operation, not a give-up deadline. Regression guard against
  // re-introducing a short deadline that races app.js's own download time
  // (the exact bug this slice burned three calev rounds fixing: finding 1
  // measured 5000ms as 92% consumed at 3 Mbps; finding 2 measured the
  // "generous" 30000ms follow-up still failing at 200 kbps). Generous means
  // minutes, not seconds.
  assert.ok(bridge.CRASH_GUARD_MS >= 120000);
  assert.equal(typeof bridge.ADDCLASS_SAFETY_NET_MS, 'number');
  assert.ok(bridge.ADDCLASS_SAFETY_NET_MS > 0);
});

test('locks exactly the four permitted flags — isMobile, isMobileApp, isDesktop, isDesktopApp (§3.2 + desktop-layout-now §1) — never isPhone/isTablet', () => {
  assert.deepEqual(bridge.LOCKED_FLAGS.slice().sort(), ['isDesktop', 'isDesktopApp', 'isMobile', 'isMobileApp']);
});
