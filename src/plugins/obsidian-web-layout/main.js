'use strict';

/**
 * Obsidian Web — Layout Switcher.
 *
 * Lets the user pick between three layout modes on the web wrapper:
 *   - auto    → use viewport heuristics (default)
 *   - mobile  → force the mobile layout
 *   - desktop → force the desktop layout
 *
 * The mode is persisted in localStorage under "obsidian-web:layout-mode".
 * client-mobile/boot.js reads this key and sets window.__owPlatformOverrides
 * before the Obsidian bundle initializes Platform. window.__owPlatform
 * itself is populated by client-mobile/platform-bridge.js's runtime
 * interception (not a build-time patch — see
 * docs/plans/runtime-platform-descriptors.md).
 *
 * In real Obsidian (desktop or mobile app) window.__owPlatform does not
 * exist, so this plugin loads as a no-op — no ribbon icon, no commands.
 *
 * docs/plans/runtime-platform-descriptors.md §3.5: `localStorage.EmulateMobile`
 * overrides window.__owPlatformOverrides in platform-bridge.js, so this
 * switcher would be a no-op while emulating (isMobile is locked true either
 * way). Rather than leave a button that looks active but does nothing —
 * worse than a disabled button (brief §3.5's explicit call) — it's shown
 * visually disabled and its commands/ribbon click are inert while emulating.
 */

const obsidian = require('obsidian');

const LAYOUT_KEY = 'obsidian-web:layout-mode';
const EMULATE_MOBILE_KEY = 'EmulateMobile';
const MODES = ['auto', 'mobile', 'desktop'];

function isEmulateMobileActive() {
  // Truthy VALUE, not mere key existence — mirrors the bundle's own guard
  // and platform-bridge.js's computeWant() (brief §3.5). Surprising but
  // deliberate: `localStorage.EmulateMobile = "0"` is ON here, same as in
  // the bundle and in platform-bridge.js's isEmulateActive() — a plain
  // `!!value` check on a string is not "0 means off". A prior round of this
  // slice special-cased "0"/"false" as OFF in platform-bridge.js ONLY,
  // which desynced it from this exact line and produced a real half-state
  // bug (calev, third pass). If "0" ever needs to mean OFF, it must change
  // in all three readers of this key at once — never here alone.
  return !!localStorage.getItem(EMULATE_MOBILE_KEY);
}

function getMode() {
  return localStorage.getItem(LAYOUT_KEY) || 'auto';
}

function setMode(mode) {
  if (!MODES.includes(mode)) return;
  if (mode === 'auto') {
    // Remove the key so boot.js falls back to viewport detection.
    localStorage.removeItem(LAYOUT_KEY);
  } else {
    localStorage.setItem(LAYOUT_KEY, mode);
  }
  showReloadOverlay(mode);
  setTimeout(() => location.reload(), 150);
}

function showReloadOverlay(mode) {
  const div = document.createElement('div');
  div.style.cssText = [
    'position:fixed', 'inset:0',
    'background:var(--background-primary)',
    'color:var(--text-normal)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font:14px var(--font-interface, sans-serif)',
    'z-index:99999',
  ].join(';');
  div.textContent = 'Switching to ' + mode + ' mode…';
  document.body.appendChild(div);
}

function modeLabel(mode) {
  return mode === 'auto'    ? 'Auto (by viewport)'
       : mode === 'mobile'  ? 'Mobile layout'
       : mode === 'desktop' ? 'Desktop layout'
       : mode;
}

module.exports = class ObsidianWebLayoutPlugin extends obsidian.Plugin {
  async onload() {
    // Only activate on obsidian-web (where __owPlatform exists).
    // In real Obsidian desktop/mobile, this plugin is a no-op.
    if (typeof window.__owPlatform === 'undefined') {
      console.log('[obsidian-web-layout] not on obsidian-web — plugin idle');
      return;
    }

    const emulating = isEmulateMobileActive();

    const ribbonEl = this.addRibbonIcon(
      'monitor-smartphone',
      emulating ? 'Layout mode (disabled during mobile emulation)' : 'Layout mode',
      (evt) => {
        if (emulating) {
          new obsidian.Notice('Layout switcher is disabled during mobile emulation.');
          return;
        }
        this.showMenu(evt);
      }
    );
    if (emulating) {
      ribbonEl.addClass('is-disabled');
      ribbonEl.setAttribute('aria-disabled', 'true');
      // .is-disabled alone isn't styled for ribbon actions in the bundle's
      // own CSS (only menu-items/text-icon-buttons are) — force the visual
      // unmistakably here rather than rely on an Obsidian rule that doesn't
      // exist for this element.
      ribbonEl.style.opacity = '0.35';
      ribbonEl.style.cursor = 'not-allowed';
    }

    for (const mode of MODES) {
      this.addCommand({
        id: 'set-layout-' + mode,
        name: 'Set layout: ' + modeLabel(mode),
        callback: () => {
          if (emulating) {
            new obsidian.Notice('Layout switcher is disabled during mobile emulation.');
            return;
          }
          setMode(mode);
        },
      });
    }
  }

  showMenu(evt) {
    const current = getMode();
    const menu = new obsidian.Menu();
    for (const mode of MODES) {
      menu.addItem((item) =>
        item
          .setTitle(modeLabel(mode))
          .setChecked(mode === current)
          .onClick(() => setMode(mode))
      );
    }
    menu.showAtMouseEvent(evt);
  }
};
