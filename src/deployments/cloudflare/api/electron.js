/**
 * Electron IPC stubs — mirrors server/api/electron.js.
 *
 * Returns static/computed values for every ipcRenderer.sendSync channel
 * Obsidian uses. No real Electron runtime needed.
 */

const APP_VERSION = '1.12.7';

// Must match app.js's hardcoded EULA string exactly, or app.js calls
// window.close() and boot silently freezes with no window.app and no error
// (browsers refuse to close a tab they didn't open — see server/api/electron.js).
const OBSIDIAN_TERMS = 'I understand and agree that I am not allowed to '
  + 'distribute the Obsidian application, in any form, without explicit '
  + 'approval from the Obsidian team. I also understand that Obsidian is '
  + 'a registered trademark, and I cannot use it without explicit '
  + 'permission granted by the Obsidian team.';

const SIMPLE_VALUES = {
  'is-dev':         false,
  'is-quitting':    false,
  'resources':      '',
  'frame':          'native',
  'terms':          OBSIDIAN_TERMS,
  'policy':         {},
  'version':        APP_VERSION,
  'update':         '',
  'check-update':   false,
  'disable-update': true,
  'insider-build':  false,
  'cli':            false,
  'disable-gpu':    false,
  'sandbox':        null,
  'starter':        null,
  'help':           null,
  'adblock-lists':  [],
  'adblock-frequency': 0,
  'get-icon':       null,
  'get-sandbox-vault-path': '',
};

export function handleElectron(request, url, vault) {
  const channel = url.pathname.replace(/^\/api\/electron\//, '');
  const method  = request.method;

  // ── Simple GET channels ────────────────────────────────────────────────
  if (method === 'GET' && Object.hasOwn(SIMPLE_VALUES, channel)) {
    return Response.json({ value: SIMPLE_VALUES[channel] });
  }

  // ── vault ──────────────────────────────────────────────────────────────
  if (channel === 'vault' && method === 'GET') {
    return Response.json({ value: { id: 'demo', path: '/vault' } });
  }

  // ── vault-list ─────────────────────────────────────────────────────────
  if (channel === 'vault-list' && method === 'GET') {
    return Response.json({ value: { demo: { path: '/vault', ts: Date.now(), open: true } } });
  }

  // ── documents-dir / desktop-dir / get-documents-path ──────────────────
  if (channel === 'documents-dir' || channel === 'get-documents-path') {
    return Response.json({ value: '/home/Documents' });
  }
  if (channel === 'desktop-dir') {
    return Response.json({ value: '/home/Desktop' });
  }

  // ── file-url ───────────────────────────────────────────────────────────
  if (channel === 'file-url' && method === 'GET') {
    const path = url.searchParams.get('path') || '';
    return Response.json({ value: 'file://' + path });
  }

  // ── trash ──────────────────────────────────────────────────────────────
  if (channel === 'trash' && method === 'POST') {
    return request.json().then(body => {
      const p = body.path || '';
      if (!vault.files.has(p)) {
        return Response.json({ ok: false, error: 'not found' }, { status: 404 });
      }
      if (vault.isProtected(p)) {
        return Response.json({ ok: false, error: 'This file is part of the demo and cannot be deleted.' }, { status: 403 });
      }
      vault.files.delete(p);
      vault.rebuildDirs();
      vault._broadcast({ type: 'unlink', path: p });
      return Response.json({ ok: true });
    });
  }

  // ── set-icon / vault-open / vault-remove / vault-move (no-ops for demo) ─
  if (['set-icon', 'vault-open', 'vault-remove', 'vault-move'].includes(channel)) {
    return Response.json({ value: null });
  }

  // ── Unhandled ──────────────────────────────────────────────────────────
  console.warn('[electron] unhandled channel:', channel);
  return Response.json({ value: null });
}
