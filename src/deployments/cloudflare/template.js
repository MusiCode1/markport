/**
 * Demo vault template.
 *
 * All vault files as plain strings, keyed by relative path. Seeded into the
 * visitor's own private OPFS vault on first visit (client-side only — see
 * src/client-mobile/seed-example-vault.js). There is no server-side vault
 * store in this deployment; nothing here is shared between visitors or ever
 * reset.
 *
 * Note content is kept small. `PLUGIN_FILES` (imported below) is an orphan
 * import from a retired build step — build-assets.sh stubs it to an empty
 * Map before importing this file (see the "example vault content" comment
 * there). The `dataview`/`templater-obsidian` entries in
 * `.obsidian/community-plugins.json` below are not actually seeded either:
 * seed-example-vault.js skips the whole `.obsidian/` subtree so it doesn't
 * clobber the system-plugins config that's seeded separately.
 */

import { PLUGIN_FILES } from './plugins-generated.js';

export const TEMPLATE_FILES = new Map([

  // ── .obsidian config ──────────────────────────────────────────────────────
  ['.obsidian/app.json', JSON.stringify({
    legacyEditor: false,
    livePreview: true,
    defaultViewMode: 'preview',
  }, null, 2)],

  ['.obsidian/appearance.json', JSON.stringify({
    theme: '',
    cssTheme: '',
    baseFontSize: 16,
  }, null, 2)],

  ['.obsidian/core-plugins.json', JSON.stringify([
    'file-explorer', 'global-search', 'switcher', 'graph',
    'backlink', 'outgoing-link', 'tag-pane', 'properties',
    'command-palette', 'editor-status', 'word-count',
  ])],

  ['.obsidian/core-plugins-migration.json', JSON.stringify({ 'file-explorer': true })],

  ['.obsidian/community-plugins.json', JSON.stringify([
    'dataview',
    'templater-obsidian',
  ])],

  // ── Notes ─────────────────────────────────────────────────────────────────

  ['Welcome.md', `# Welcome to Obsidian Web

> **Obsidian's desktop app — running in your browser, no Electron needed.**

This is a live demo of **obsidian-web**, an open-source project that runs Obsidian's original renderer in a standard browser by replacing every Capacitor/Electron dependency with lightweight browser-native shims.

**Everything works in the browser:** edit notes, create folders, rename files. Your changes are stored **locally in your browser** (via [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)) — private to you, never sent to a server, and never reset automatically. They survive a page reload and stick around until you clear this site's browsing data.

---

## Things to try

- **Edit this note** — click the pencil icon above to switch to edit mode
- **Create a new note** — click the "new note" icon in the file tree
- **Quick open** — \`Ctrl+O\` (or \`Cmd+O\` on Mac)
- **Command palette** — \`Ctrl+P\` (or \`Cmd+P\`)
- **Search** — \`Ctrl+Shift+F\` for full-text search
- **Backlinks** — open [[How It Works]] and check the backlinks panel
- **Graph view** — click the graph icon in the left sidebar

---

## Notes in this demo

- [[How It Works]] — architecture and technical details
- [[Features/Markdown Showcase]] — Obsidian's Markdown rendering
- [[Features/Links and Backlinks]] — bidirectional linking
- [[Features/Tags]] — tag-based organization
- [[Features/Dataview Queries]] — live queries with the Dataview plugin

---

> **Note:** this vault is **yours alone** — it lives only in this browser's local storage (OPFS), is never sent to a server, and nobody else can see it. Nothing here resets automatically; edit, delete, or recreate anything freely.

---

**[GitHub](https://github.com/MusiCode1/obsidian-web)** | Built by [MusiCode1](https://github.com/MusiCode1) and [Claude Code](https://claude.ai/code)

> [!important] Disclaimer
> This is an educational proof-of-concept, not an official Obsidian product. Not affiliated with or endorsed by [Obsidian](https://obsidian.md) or Dynalist Inc.

#demo #welcome
`],

  ['How It Works.md', `# How It Works

**obsidian-web** runs Obsidian's original renderer code (\`app.js\`) completely unmodified. Instead of forking Obsidian, we replace the Capacitor/Node.js APIs it depends on with browser-compatible shims.

## Architecture

\`\`\`
Browser
├── client-mobile/shims/       ← replace Capacitor/Node APIs
│   ├── capacitor-shim.js      ← Capacitor.Plugins.* → OPFS store / HTTP / Web APIs
│   ├── path.js, os.js, url.js, btime.js  ← POSIX-ish utilities
│   └── sync-http.js           ← synchronous XHR where Obsidian needs it
├── client-mobile/storage/
│   └── opfs-store.js          ← the vault engine backing this demo (OPFS)
├── client-mobile/boot.js      ← installs window.require, opens the vault
└── obsidian-mobile/app.js     ← Obsidian's code, completely untouched
\`\`\`

## This demo: browser-only storage (OPFS)

This deployment (Cloudflare Pages + a small edge Worker) does **not** store your vault anywhere on a server — there is no database and no per-visitor server-side state:

| Component | What it does |
|-----------|-------------|
| **Worker** (\`index.js\`) | Serves the static app bundle. Two exceptions: \`POST /api/proxy-request\` (a CORS-safe proxy so community-plugin installs can reach GitHub) and the \`/starter\`, \`/vault/*\` SPA-fallback routes |
| **OPFS** | The [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) — a private, sandboxed filesystem the browser gives this site. Your vault's files live there, on your device |
| **Seed** | On first visit, this demo vault's files are copied into your own OPFS vault once (client-side, \`seed-example-vault.js\`) — after that, it's just your vault |

There is no server-side database, no cross-tab WebSocket sync, and no scheduled reset in this deployment — everything above lives entirely in your browser's OPFS.

## Fast bootstrap (server-backed mode only)

The optional Node.js server deployment (\`src/runtime-server/server/\`) can load faster than the desktop app: instead of Obsidian reading dozens of config files one by one, the server serves everything in a single HTTP request (\`/api/bootstrap\`) — all files, directories, and metadata arrive at once. **This demo doesn't use that path** — with OPFS there's no HTTP round-trip for vault reads at all; the shim talks to the browser's local storage directly.

## The shim approach

When Obsidian calls a Capacitor \`Filesystem\` method, \`capacitor-shim.js\` intercepts it. In this deployment it routes straight to \`opfs-store.js\` (browser-local, no network); the same shim can instead call an HTTP \`/api/fs\` backend when running against the optional Node server — Obsidian's own code never knows the difference.

Key shims:
- **Filesystem** (Capacitor) — \`readFile\`, \`writeFile\`, \`stat\`, \`readdir\`, \`mkdir\`, \`rmdir\`, \`rename\`, \`copy\`, \`deleteFile\` — OPFS-backed here, HTTP-backed on the optional Node server
- **Clipboard / Browser / Preferences** — delegate straight to Web APIs (\`navigator.clipboard\`, \`window.open\`, \`localStorage\`)
- **path / os / url** — standard POSIX-ish implementations

## Links

- [[Welcome]] ← back to the main page
- [[Features/Markdown Showcase]]

#architecture #obsidian-web
`],

  ['Features/Markdown Showcase.md', `# Markdown Showcase

Everything Obsidian's renderer supports works here — it's the same code.

## Text Formatting

**Bold**, *italic*, ~~strikethrough~~, \`inline code\`, ==highlight==

## Lists

1. Ordered item
2. Another item
   - Nested unordered
   - Also nested
     - Triple nested

## Task Lists

- [x] Boot Obsidian in the browser
- [x] File system shims (Capacitor → OPFS, browser-local)
- [x] Private per-visitor storage, no server round-trip
- [ ] Plugin support

## Code Blocks

\`\`\`typescript
interface VaultFile {
  content: string;
  mtime:   number;
  size:    number;
}

// This demo holds every file in your browser's OPFS, not on a server
const vault = new Map<string, VaultFile>();
\`\`\`

## Tables

| Feature       | Node Server | This demo (Browser/OPFS) |
|---------------|:-----------:|:------------------------:|
| FS API        | ✅ (HTTP)    | ✅ (local, no network)    |
| WebSocket     | ✅           | ❌ (not needed — one tab, no server round-trip) |
| Persistent    | ✅ (real files) | ✅ (until you clear site data) |
| Private       | depends on your setup | ✅ (never leaves your browser) |
| Global CDN    | ❌           | ✅ (static assets only)   |

## Blockquote

> Obsidian's renderer runs untouched in the browser.
> Only the Capacitor/Node.js APIs are replaced with browser-native shims (OPFS in this demo).

## Callouts

> [!info] How this works
> This note is rendered by Obsidian's real Markdown pipeline — CodeMirror for editing, their custom renderer for preview. We don't reimplement anything.

> [!warning] Demo vault
> Nothing here resets automatically — this vault is private to your browser. Clearing this site's browsing data is the only thing that removes it. Create your own notes to experiment!

## Math

$$E = mc^2$$

## Horizontal Rule

---

← [[Welcome]] | [[Features/Links and Backlinks]]

#markdown #features
`],

  ['Features/Links and Backlinks.md', `# Links and Backlinks

Obsidian's killer feature — bidirectional links between notes.

## Internal Links

- [[Welcome]] — back to start
- [[How It Works]] — architecture
- [[Features/Markdown Showcase]] — formatting examples

## Link with alias

[[Welcome|Back to the welcome page]] — same note, different display text.

## Backlinks Panel

Open this note and click the **backlinks icon** in the right sidebar. You'll see every note that links here.

Notes linking to this page:
- [[Welcome]] (from the notes list)
- [[Features/Markdown Showcase]] (from the bottom navigation)

## Outgoing Links

The **outgoing links** panel shows all links *from* this note to other notes.

## Unresolved Links

[[A Note That Does Not Exist]] — Obsidian highlights unresolved links in a different color. Click it to create the note.

← [[Features/Markdown Showcase]] | [[Features/Tags]]

#links #backlinks #graph
`],

  ['Features/Tags.md', `# Tags

Tags in Obsidian let you categorize notes without a rigid folder structure.

## Inline Tags

Use \`#tagname\` anywhere in a note: #features #tags #demo

## Tag Pane

Open the **Tag Pane** from the left sidebar to see all tags in the vault and how many notes use each one.

## Nested Tags

#features/markdown
#features/links
#features/tags

Nested tags appear as a hierarchy in the tag pane.

## Tags in This Vault

| Tag | Notes |
|-----|-------|
| #demo | Welcome, Tags |
| #features | Markdown, Links, Tags |
| #architecture | How It Works |

← [[Features/Links and Backlinks]] | [[Welcome]]

#tags #features #demo
`],

  ['Features/Dataview Queries.md', `# Dataview Queries

[Dataview](https://blacksmithgu.github.io/obsidian-dataview/) is a community plugin that lets you query your vault like a database. It's installed and active in this demo.

## List all notes

\`\`\`dataview
LIST
FROM ""
SORT file.name ASC
\`\`\`

## Notes by tag

\`\`\`dataview
TABLE tags AS "Tags", file.size AS "Size"
FROM #features
SORT file.name ASC
\`\`\`

## Notes linking here

\`\`\`dataview
LIST
FROM [[]]
\`\`\`

## Task example

- [ ] Try editing this note
- [ ] Create a new note and add a Dataview query
- [x] Open the demo

\`\`\`dataview
TASK
FROM "Features/Dataview Queries"
\`\`\`

---

> [!info] About Dataview
> These queries run live — if you create new notes or add tags, the results update automatically. Dataview supports LIST, TABLE, TASK, and CALENDAR query types.

← [[Features/Tags]] | [[Welcome]]

#features #dataview #demo
`],

]);

// Merge auto-generated plugin files into the template.
for (const [path, content] of PLUGIN_FILES) {
  TEMPLATE_FILES.set(path, content);
}
