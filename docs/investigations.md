# obsidian-web - Investigations

> מסמך חקירה לבעיות שנחקרו לעומק. מטרתו: לא לחזור על אותו מחקר. כל פעם שמגלים משהו חדש על בעיה - מעדכנים את הסעיף הרלוונטי כאן.

מבנה: לכל בעיה - תאריך תחילת חקירה, סטטוס, מה ידוע בוודאות, מה השערה, מה צעדים הבאים, ולוגים/שאילתות שעבדו טוב כדי לחקור.

---

## Glossary — שלושה משמעויות שונות ל-"plugin" {#glossary}

המילה "plugin" מופיעה ב-codebase בשלושה הקשרים אורתוגונליים. כל סוכן/קורא חדש חייב להפריד ביניהם:

| מינוח | מי מגדיר | משמעות | דוגמאות בקוד |
|---|---|---|---|
| **Capacitor plugin** | חבילת Capacitor (Ionic) | מודול native שנקרא דרך `Capacitor.Plugins.<Name>`. ב-mobile bundle של Obsidian, ה-`vault.adapter` הוא `CapacitorAdapter` שמשתמש ב-Capacitor plugin בשם `Filesystem`. | `client-mobile/shims/capacitor-shim.js`, `PluginHeaders` |
| **Obsidian plugin** | Obsidian | extension של Obsidian (community / core) — JS module עם `manifest.json` + `main.js` שמרחיב את ה-app. רץ ב-renderer; נטען מ-`.obsidian/plugins/<id>/` של ה-vault. | `obsidian-livesync`, `obsidian-web-layout`, dataview |
| **System plugin** (שלנו) | obsidian-web | Obsidian plugin **שמוזרק מהריפו** ולא חי בvault של המשתמש. השרת `server/system-plugins.js` חושף את `<repo>/plugins/<id>/` כאילו הוא חלק מ-`.obsidian/plugins/` של כל vault. | `plugins/obsidian-web-layout/` |

### Diagram של ה-stack בvocab של "plugin"

```
Obsidian plugin (e.g. obsidian-livesync)        ← Obsidian plugin
  │   uses app.vault.adapter
  ▼
CapacitorAdapter                                 ← built into obsidian-mobile/app.js
  │   calls Capacitor.Plugins.Filesystem.readFile(opts)
  ▼
Capacitor.Plugins.Filesystem (Capacitor plugin)  ← Capacitor plugin
  │   via capacitor-shim.js (our impl)
  │   ↪ native-bridge.js → androidBridge.postMessage → routeNativeCall
  ▼
fetch('/api/fs/read?...')                        ← HTTP to our server
  │
  ▼
server/api/fs.js                                 ← may serve from vault OR system plugin overlay
```

LiveSync (Obsidian plugin) מעולם לא יודע ש-Filesystem (Capacitor plugin) הוא ה-shim שלנו; ובמסלול הפוך, ה-shim של Filesystem לא יודע מי הקליינט שלו (Obsidian plugin / core Obsidian / משתמש).

---

## Current state (2026-05-11) {#current-state}

הסעיף הזה מסכם את המצב הנוכחי של הארכיטקטורה. הסעיפים שלמטה הם **יומן חקירה היסטורי** — לפעמים תיאוריות שהוחלפו, לפעמים תיקונים שכבר אינם רלוונטיים.

**שני runtimes פעילים:**

- `/` — desktop bundle (`obsidian/app.js`) + electron shims (`client/`). ראה `client/boot.js`. שימושי כ-fallback.
- `/mobile` — mobile bundle (`obsidian-mobile/app.js`) + Capacitor shim (`client-mobile/`). זה ה-runtime המועדף; ראה הסעיפים [PluginHeaders mechanism](#pluginheaders), [Capacitor plugin inventory](#capacitor-plugin-inventory), ו-[`__owPlatform` runtime API](#owplatform-api).

**Runtime interception של ה-Platform object** (`client-mobile/platform-bridge.js`):
יירוט `Object.defineProperty` (לא regex patch על app.js) חושף את אובייקט ה-Platform כ-`window.__owPlatform` ונועל את `isMobile`/`isMobileApp`/`isDesktop` לפי `window.__owPlatformOverrides`. כך `client-mobile/boot.js` שולט ב-flag `isMobile` (UI layout) **לפני** ש-`app.js` רץ — ראה `docs/plans/runtime-platform-descriptors.md`.
**אין יותר build-time patches על ה-mobile bundle** (`docs/plans/zero-patches.md`, 2026-07-27) — `scripts/patch-obsidian-mobile.js` נשאר קיים כתשתית עם `PATCHES = []`, למקרה שגרסת Obsidian עתידית תדרוש patch. הפאטצ' האחרון (`vault-profile-on-desktop-layout`) הוסר: פאנל ה-vault-profile בתחתית הסיידבר ממשיך לרנדר במצב desktop-layout כי `client-mobile/platform-bridge.js` נועל את `isDesktopApp` ישירות — לא בזכות עריכת app.js.

**System plugin overlay** (`server/system-plugins.js`):
תוספי Obsidian מהריפו (`<repo>/plugins/`) מוזרקים כ-virtual entries לכל vault. ה-vault עצמו אינו מתלכלך — `community-plugins.json` ממוזג ב-read ומופשט ב-write. הראשון: `obsidian-web-layout` (ribbon + commands להחלפת layout). מקור עומק: [Virtual plugin overlay — deep dive](#virtual-overlay-deep-dive).

**Mobile bootstrap cache** (`src/client-mobile/{bootstrap-lookup,cache-invalidation}.js`):
שני runtimes צורכים את `/api/bootstrap` ל-cold boot מהיר. ה-mobile shim בודק את `window.__owBootstrapCache` לפני HTTP על כל `readFile`/`stat`/`readdir` (88% hit rate). שלושה env vars לדפלוייר: `BOOTSTRAP_DISABLED`, `BOOTSTRAP_MAX_FILE_KB`, `BOOTSTRAP_MAX_TOTAL_MB`. מגבלות ידועות: [Workers לא רואים את ה-cache](#mobile-bootstrap-cache-workers), [watch-event firehose ב-LiveSync](#mobile-bootstrap-cache-firehose).

**מקורות מידע משלימים:**
- `PLAN.md` — סטטוס, roadmap, ו-LiveSync integration plan.
- `docs/system-plugin-dev-guide.md` — איך להוסיף system plugin חדש.

---

## הערות כלליות על Obsidian internals

ידע גנרי שלמדנו על אובסידיאן כמערכת. שימושי גם לבעיות עתידיות.

### ארכיטקטורה כללית של app.js (Obsidian 1.12.7)

- **`window.app`** - האובייקט הראשי. זמין מ-DevTools.
- **`app.vault`** - ה-vault עצמו (`JT` class). מנהל קבצים.
- **`app.vault.adapter`** - DataAdapter. ב-desktop זה `FileSystemAdapter` (`Eu` class) שעוטף את `original-fs`. כל פעולות ה-fs עוברות דרכו. **הוא עובד אצלנו** - `adapter.rename()`, `adapter.read()`, וכו' עובדים מצוין.
- **`app.fileManager`** - שכבה מעל ה-adapter. עושה rename "חכם" שמעדכן גם links בקבצים אחרים. עובד אצלנו (תוקן עם F-005).
- **`app.metadataCache`** - cache של metadata לכל קובץ (frontmatter, headings, links, tags). שמור ב-IndexedDB (`default-cache` DB). עובד אצלנו (תוקן עם F-005). ראה פירוט flow האינדקס למטה.
- **`app.workspace`** - מנהל ה-leaves, tabs, panes.
- **`app.internalPlugins`** - core plugins (file-explorer, graph, וכו').

### ה-FileSystemAdapter API
זמין ב-`app.vault.adapter`:
```
adapter.read(path)          → string
adapter.readBinary(path)    → ArrayBuffer
adapter.write(path, data)
adapter.writeBinary(path, data)
adapter.exists(path)        → bool (משתמש ב-fsPromises.access)
adapter.stat(path)          → {size, mtime, ...} | null
adapter.list(path)          → {files: [...], folders: [...]}
adapter.mkdir(path)
adapter.remove(path)        → unlink (file)
adapter.rmdir(path)
adapter.rename(old, new)
adapter.fsPromises.readFile, writeFile, ... — node fs.promises ישיר
adapter.basePath            — root absolute path; אצלנו `/vault`
```

### flow האינדקס (metadataCache) — לחלוטין צד-לקוח

האינדקס רץ בדפדפן (renderer), לא בשרת. השרת רק מספק קבצים. ה-flow לכל קובץ:

1. קורא תוכן קובץ דרך `FileSystemAdapter` (HTTP לשרת אצלנו).
2. מחשב SHA-256 של התוכן דרך `window.crypto.subtle.digest("SHA-256", ...)`.
3. משווה ל-hash שב-IndexedDB — אם זהה, מדלג (incremental update).
4. שולח את הקובץ ל-**Web Worker** (`worker.js`) לפרסור Markdown.
5. ה-Worker מחזיר frontmatter, headings, links, tags.
6. תוצאות נשמרות ב-**IndexedDB בדפדפן** — לא בשרת.

**תוצאה מעשית:** IndexedDB הוא per-browser/session. דפדפן אחר או incognito → בנייה מחדש מאפס. אותו דפדפן → incremental update רק לקבצים שה-hash שלהם השתנה.

### IndexedDB databases
אובסידיאן יוצר 3 DBs בדפדפן:
- `default-cache` (version 19) - **שני object stores: `file` (mtime/size/hash) ו-`metadata`**
- `default-backup` (version 1)
- `default-sync` (version 1)

ה-`metadataCache.transactionSave` כותב ל-IndexedDB. עובד אצלנו (יש fileKeys ב-DB).

### ה-fileExplorer view
- מקום: `app.workspace.getLeavesOfType("file-explorer")[0].view`
- `view.fileItems[path]` - map של path → tree item. כל item יש לו `el`, `selfEl`, `innerEl`, `file`, `startRename()`, `stopRename()`.
- `view.fileBeingRenamed` - הקובץ שכרגע ב-rename mode (או null).
- `view.startRenameFile(file)` - מתחיל rename.
- `view.acceptRename()` - מסיים rename ושולח ל-`fileManager.renameFile`.
- `view.exitRename()` - מסיים את ה-rename UI.
- `view.fileRenameScope.register([], "Enter", view.onKeyEnterInRename)` - מטפל ב-Enter בזמן rename.

### crypto.subtle
- אובסידיאן מחשב SHA hashes עם `window.crypto.subtle.digest("SHA-256", ...)`.
- אצלנו זה **עובד** - בדקנו ידנית ויצא hash תקין באורך 32 בייטים.
- ה-shim שלנו ל-`require('crypto')` לא מגיע לכאן כי זה משתמש ב-`window.crypto.subtle` ישירות.

### System plugin overlay {#system-plugin-overlay}

איך Obsidian מגלה תוספים (community plugins) ב-vault:

1. בstartup, הוא קורא את `.obsidian/community-plugins.json` — מערך של plugin ids שהמשתמש "הפעיל".
2. עבור כל id, הוא עושה `readdir('.obsidian/plugins/<id>')` ומחפש `manifest.json` + `main.js`.
3. **חשוב — נתפס בהטמעה:** ה-bundle הmobile עושה `stat('.obsidian/plugins')` *לפני* readdir. אם זה 404, הוא מפסיק שם ולא מבצע readdir. בלי תיקייה בvault עצמו, ה-discovery מת לפני שהגיע ל-overlay של readdir.

**ה-overlay שלנו (`server/system-plugins.js` + `server/api/fs.js`):**

- `<repo>/plugins/<id>/` מוזרק כ"system plugin" שעוטף *כל* vault. מקור האמת לקבצים הוא ב-repo, לא בvault.
- `/read` ו-`/stat`: אם הvault מכיל את הקובץ — הוא מנצח. אחרת — נופלים-back ל-repo. ככה משתמש יכול לבדוק override ידני.
- `/stat` של `.obsidian/plugins` (ה-dir עצמו): כשלא קיים בvault ויש לפחות system-plugin אחד — מחזירים synthetic directory stat (`isDirectory:true`, mtime עכשווי). זה הgate הקריטי שגרם להstuck בהטמעה הראשונה.
- `/readdir` של `.obsidian/plugins`: ממזג בdir entries של כל ה-system plugins לרשימה. גם ENOENT שלם — מחזיר רק את ה-system plugins.
- `/readdir` של `.obsidian/plugins/<id>` (system plugin): אם הvault ריק שם, מחזיר את התוכן של `<repo>/plugins/<id>/`. אם הvault מחזיק שם משהו, נצמדים לvault (override מלא).
- `/read` של `.obsidian/community-plugins.json`: ממזג את ה-system plugin ids ל-array (גם אם הקובץ לא קיים בvault).
- `/write` של אותו קובץ: מסיר את ה-system ids לפני שמירה — כך הvault לא מתלכלך עם ה-id שלנו.

**הגנת path-traversal:** `tryGetSystemFilePath` בודק שה-resolved path נשאר תחת `SYSTEM_PLUGINS_DIR`. ניסיון כמו `.obsidian/plugins/obsidian-web-layout/../../../etc/passwd` מוחזר כ-null וה-handler נופל ל-resolveSafe של הvault → 404.

**הקריאות שראינו ב-server log עבור boot של תוסף מצליח:**

```
GET /api/fs/stat?path=.obsidian/plugins             → 200 (synth dir)
GET /api/fs/read?path=.obsidian/community-plugins.json → 200 ["obsidian-web-layout"]
GET /api/fs/readdir?path=.obsidian/plugins          → 200 [{name:"obsidian-web-layout",...}]
GET /api/fs/stat?path=.obsidian/plugins/obsidian-web-layout            → 200 (from repo)
GET /api/fs/read?path=.obsidian/plugins/obsidian-web-layout/manifest.json → 200 (from repo)
HEAD /api/fs/read?path=.obsidian/plugins/obsidian-web-layout/main.js  → 200 (from repo)
GET /api/fs/read?path=.obsidian/plugins/obsidian-web-layout/main.js   → 200 (from repo)
```

### כלי ניפוי שגיאות — globals זמינים ב-DevTools

שלושה globals מוזרקים ב-boot שימושיים לחקירה. הרץ אותם ב-DevTools console.

---

#### `__owMissing` — מה עדיין חסר שים

עוקב אחרי כל קריאה ל-`require()`, `ipcRenderer.sendSync()`, ו-`ipcRenderer.send()` שנפלה לנתיב ה"לא מטופל". מצטבר לאורך כל הסשן.

```js
// רשימה מסוכמת — הכי שימושי:
__owMissing.summary()
// מחזיר console.table עם עמודות: type | name | count | first(ms) | last(ms)

// רשימה גולמית (array) — שימושי לעיבוד:
__owMissing.list()
// → [{ type: 'require', name: 'child_process', count: 14, firstSeen: 340, lastSeen: 8200 }, ...]
```

**סוגי entries:**
| `type` | `name` | משמעות |
|---|---|---|
| `require` | שם module | Plugin קרא `require('X')` ואין שים ל-X |
| `sendSync` | שם channel | אובסידיאן קרא `ipcRenderer.sendSync('X')` שלא ממומש |
| `send` | שם channel | אובסידיאן קרא `ipcRenderer.send('X')` שלא ממומש |

**איך לפעול לפי התוצאה:**
- `require` עם `count` גבוה → כדאי לממש shim ב-`client/shims/<name>.js` ולרשום ב-`client/boot.js`.
- `require` עם `count` נמוך וchained errors → שים קל (stub) עדיף על `undefined`.
- `sendSync`/`send` → מממשים ב-`ipcRenderer.sendSync` / `ipcRenderer.send` ב-`client/shims/electron.js`.

**מיקום בקוד:** `client/boot.js` (הגדרת `__owMissing`) + `client/shims/electron.js` (calls ל-`__owMissing.record`).

---

#### `__owTelemetry` — ביצועי sync XHR

עוקב אחרי כל קריאת sync XHR שהשים עושים לשרת (FS, electron IPC). **לא** כולל `require()` או async calls.

```js
// סיכום לפי סוג קריאה — total blocking time:
__owTelemetry.summary()
// → console.table: label | count | totalMs | avgMs | uniquePaths

// טבלה מפורטת של כל קריאה בסדר כרונולוגי:
__owTelemetry.table()

// שמור ב-localStorage לניתוח מאוחר:
__owTelemetry.save()
// → localStorage['obsidian-web:telemetry']

// ייצוא JSON:
__owTelemetry.dump()
```

**שימושים נפוצים:**
- מציאת hot paths: `summary()` ממוין לפי `totalMs` — מה שמופיע ראשון הוא הצוואר בקבוק.
- בדיקת עוצמת ה-bootstrap cache: אחרי reload, `summary()` אמור להראות `count=0` או ספרות נמוכות מאוד לכל FS op (כי bootstrap מגיש מcache).
- Baseline vs. after: `clear()` → פתח פעולה → `summary()`.

**מיקום בקוד:** `client/shims/telemetry.js`.

---

#### `__owBootstrapCache` — תוכן ה-bootstrap

לא כלי ניפוי, אבל שימושי לאימות:
```js
// כמה קבצים נטענו מראש:
Object.keys(__owBootstrapCache.fs).length   // → 140 לדוגמה

// בדיקה שקובץ ספציפי קוש:
__owBootstrapCache.fs['.obsidian/app.json']
// → { content: '...', mtime: 1234, size: 512, isFile: true }

// electron IPC values שנטענו מראש:
__owBootstrapCache.electron
// → { vault: {id, path}, version: '1.12.7', 'is-dev': false, ... }
```

---

### starter.js — IPC channels שחקרנו מ-main.js

ה-starter.js המקורי מצפה ל-IPC channels הבאים (חולצו מ-`obsidian/main.js` שלא minified):

| channel | כיוון | מה מוחזר | הערות |
|---|---|---|---|
| `vault-list` | sendSync | `{ [id]: { path, ts, open } }` | כל הכספות. ts = timestamp אחרון. |
| `vault-open` | sendSync(path, createIfMissing) | `true` אם הצליח, string שגיאה אם לא | path הוא אבסולוטי. מחזיר `true` ולא id. |
| `vault-remove` | sendSync(path) | `true`/`false` | path אבסולוטי של הכספת. |
| `vault-move` | sendSync(oldPath, newPath) | `""` אם הצליח, `"EVAULTOPEN"` אם פתוחה, string שגיאה אחר | |
| `vault` | sendSync | `{ id, path }` | הכספת הנוכחית של החלון. |
| `starter` | sendSync | `null` | פותח את חלון ה-starter. |
| `is-dev` | sendSync | `false` | |
| `version` | sendSync | string (למשל `"1.12.7"`) | |

**חשוב:** `vault-open` מוחזר `true` ולא id. ה-id נוצר ב-main process ונשאר שם. ה-renderer לא מקבל את ה-id בחזרה — הוא יכול למצוא אותו אחר כך דרך `vault-list`.

**כיצד Obsidian שומר כספות (מ-main.js):** registry `P = { [16-char hex id]: { path, ts } }`, שמור ב-userData כ-JSON. הפונקציה `d(path)` פותחת כספת — בודקת אם הpath כבר ב-registry, אם כן — מעדכנת ts; אם לא — יוצרת id חדש.

### Electron stubs שצריך לדעת
- `window.electron.remote.Menu.buildFromTemplate(template)` - **חייב להחזיר EventEmitter** (`.on('menu-will-close', fn)`). תיקנו ב-electron.js.
- `window.electron.remote.nativeTheme` - חייב להיות chain-able (`.removeAllListeners().on()`).
- `window.electron.remote.getCurrentWebContents()` - חייב לחזור על אותו object שיש לו `getZoomFactor`.
- `ipcRenderer.send` channels שאובסידיאן שולח ושאנחנו מתעלמים: `set-menu`, `update-menu-items`, `render-menu`, `context-menu`.

### מתודות debugging שעבדו טוב

**הזרקת trace wrappers דרך eval:**
```js
const wrap = (obj, name, label) => {
  const orig = obj[name];
  obj[name] = function(...args) {
    console.log("[T]", label || name, "args:", args.map(a => a?.path || a?.name || String(a).slice(0, 50)).join(" | "));
    try {
      const r = orig.apply(this, args);
      if (r?.then) return r.then(
        v => { console.log("[T]", label, "resolved"); return v; },
        e => { console.log("[T]", label, "REJECTED:", e?.message); throw e; }
      );
      return r;
    } catch (e) { console.log("[T]", label, "THREW:", e?.message); throw e; }
  };
};
```
שימוש: `wrap(view, "acceptRename", "acceptRename")`.

**הערות על הרצת eval מכלי אוטומציה** (Playwright/CDP וכד'):
- החזר `JSON.stringify(...)` — serializers רבים נחנקים על objects מורכבים.
- מתודות שמחזירות Promise — חייב async או `.then()`/`.catch()`.
- ללא reload אובייקטים נשארים בזיכרון; בכל מקרה הם חוזרים אחרי כל שינוי בקוד.

**הפעלת השרת (עם auto-reload):**

```bash
cd src/runtime-server/server
nohup npm run dev > /tmp/obsidian-web-server.log 2>&1 &
```

`npm run dev` משתמש ב-`node --watch` המובנה — כל שינוי בקובץ JS בצד השרת גורם ל-restart אוטומטי. אין צורך ב-kill ידני.

אם הפורט תפוס (שרת ישן עדיין רץ):
```bash
kill $(lsof -ti :3000) 2>/dev/null
```
אפשר לאמת: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/starter` — צריך 200.

**גישה ל-server log חי:**
- `tail -f /tmp/obsidian-web-server.log`
- ה-middleware של request logging מסנן רק `/api`, `/i18n`, `/lib`. אם צריך יותר - להרחיב.

**גישה ל-console messages ב-browser:** ה-DevTools console, או קובץ ה-console שכלי
האוטומציה שלך כותב. הלוג מצטבר — רענן עם `goto` כדי לקבל console נקי, וסנן
ב-`grep TRACE` כדי לראות רק traces שלנו.

---

## בעיות פתוחות

### B-003: `readdir` נקרא על קובץ במקום על תיקייה

**סטטוס:** הוקטן (אבל לא נפתר לחלוטין).

#### תסמינים
בלוג השרת מופיעים:
```
GET 400 /api/fs/readdir?path=.obsidian%2Fworkspace.json
GET 400 /api/fs/readdir?path=.obsidian%2Fappearance.json
```

#### מה ידוע
- אובסידיאן (איפשהו ב-`reconcileFile` או reconcile flow) קורא `readdir` על נתיב שהוא לפעמים קובץ.
- בקוד יש `o = path.dirname(r); readdir(o)`. אם `r` הוא absolute path של קובץ, `dirname` יחזיר את התיקייה. אבל בפועל הקריאה מגיעה לשרת עם path של קובץ.
- חשד: יש קוד נוסף שעושה `readdir` על path מקורי (לא dirname), כנראה ב-reconciliation flow כש-fs.watch event מגיע.
- לפני תיקון fs.watch זה היה 7 פעמים. אחרי - פעם אחת. אז fs.watch היה מעורב.
- היום השרת מחזיר 404 (לא 400) כש-ENOTDIR, וזה משתיק את הצרחות בconsole.

#### הסבר אפשרי לקריאה האחת שנותרה
ב-startup, אובסידיאן עושה ניסיון לקרוא `.obsidian/workspace.json` כתיקייה (אולי לבדיקה אם זה backup folder?). זה התנהגות פנימית של אובסידיאן, לא משהו שאנחנו יכולים לתקן בצד שלנו.

#### השפעה
מינימלית. עכשיו 404, ואובסידיאן מתעלם מזה.

---

### B-004: רעש 404 על קבצי `.obsidian/*.json` שלא קיימים

**סטטוס:** מובן ונחשב **תקין** (לא באמת בעיה).

#### תסמינים
ב-console מופיעים בערך 15 שגיאות `404 Failed to load resource` על קבצים כמו:
- `.obsidian/types.json`
- `.obsidian/hotkeys.json`
- `.obsidian/global-search.json`
- `.obsidian/graph.json`
- `.obsidian/canvas.json`
- וכו'

#### למה זה קורה
אובסידיאן בודק אם יש הגדרות שמורות לכל core plugin. אם אין - הוא יוצר עם defaults. ה-404 הוא **התנהגות תקינה** של ה-FS API (`ENOENT` → 404).

#### למה לא נתקן
- רוב הקבצים האלה **לעולם לא נוצרים** עד שמשתמש משנה הגדרות. אם נחזיר `{}` ריק ב-server, אובסידיאן עלול לפרש אותו אחרת.
- הנכון: לדכא את ה-404 בגיש הconsole של הדפדפן (אבל זה רק קוסמטי).

#### אפשרות עתידית: pre-flight bundle
אנחנו יכולים להוסיף `/api/bootstrap` שמחזיר את **כל** קבצי `.obsidian/*.json` שקיימים במכה אחת. זה יחסוך 15+ HTTP round-trips ב-boot. הoptimization הזה ב-PLAN Phase 2.

---

### B-006: הדלקת `isDesktopApp` פותחת את שער `isDesktopOnly` — פלאגין desktop-only נטען ואז נופל בשקט

**סטטוס:** נמדד ותועד (`docs/plans/desktop-layout-now.md` §10ב/DoD#15 — "מדידה ותיעוד בלבד,
לא לחסום"). **לא תוקן, במכוון** — מחוץ ל-scope של הסלייס שהדליק את הדגל.

#### מה נמדד

שני אתרי-הקריאה היחידים ב-`vendor/obsidian-mobile/app.js` שבודקים `isDesktopOnly`:

```js
(S=!bn.isDesktopApp&&u.isDesktopOnly)&&f.createDiv({cls:"mod-warning",text:F1.labelUnsupported()})
// ...
if(!bn.isDesktopApp&&n.isDesktopOnly)return[2,!1];
```

לפני `desktop-layout-now`, `bn.isDesktopApp` היה `false` קבוע ⇒ `!bn.isDesktopApp` תמיד
`true` ⇒ השער תמיד נסגר — כל פלאגין (community/system) עם `manifest.isDesktopOnly:true`
היה מסורב טעינה + מקבל תווית "Unsupported" בחנות. **עכשיו, בפריסת-דסקטופ,
`bn.isDesktopApp===true` ⇒ `!bn.isDesktopApp===false` ⇒ שני האתרים "עוברים" — כל
פלאגין desktop-only **נטען בהצלחה**.

אומת חי (Chromium/Playwright, `/vault/0000demo0000demo`, layout=desktop): שתלתי פלאגין
עם `isDesktopOnly:true` בכספת — `enablePlugin()` החזיר `true` והפלאגין הופיע ב-
`app.plugins.plugins`. בתוך אותו פלאגין `require('fs')` עדיין מחזיר `undefined`
(כצפוי — הריצה עדיין דפדפן, לא Node/Electron אמיתי).

#### ההשלכה (לא תוקנה)

זה **שינוי-התנהגות אמיתי מול המשתמש**, לא רק פנימי: פלאגין desktop-only עובר מ"סירוב
מנומק בזמן טעינה + תווית *Unsupported* בחנות" ל"נטען בהצלחה, ואז נופל מאוחר יותר ברגע
שהוא באמת נוגע ב-API של Node/Electron שלא ממומש (למשל `require('fs')===undefined`)".
משתמש שמתקין פלאגין desktop-only יראה כישלון מאוחר ופחות ברור, במקום סירוב מיידי וברור.

#### למה לא תוקן כאן

מחוץ ל-scope של `desktop-layout-now` (§2 "בחוץ" בבריף: "שער `isDesktopOnly`" מפורש
כ"מדידה בלבד"). אין החלטה עדיין על מדיניות (לחסום את השער ידנית? להראות אזהרה ברורה
יותר? לתעד את הפלאגינים הידועים שנשברים?) — משאיר פתוח למרדכי/לסלייס הבא.

---

### B-007: `<webview>` בקנבס/Web Viewer — `HTMLUnknownElement` בדפדפן, לא נגיש כברירת-מחדל

**סטטוס:** נמדד ותועד (DoD#15). **לא שבור בפועל היום** — הפלאגין שמשתמש בזה כבוי כברירת-מחדל.

#### מה נמדד

הבאנדל עושה `doc.createElement("webview")` בשני מקומות (Web Viewer core plugin, גם
בתוך קנבס) ואז קורא למתודות כמו `.isLoading()`/`.loadURL()`/`.getWebContentsId()` —
אלה קיימות רק על התג `<webview>` האמיתי של Electron (Chromium embedder API), לא בדפדפן
רגיל. אומת ישירות:

```js
document.createElement('webview').constructor.name   // "HTMLUnknownElement"
document.createElement('webview').isLoading           // undefined
document.createElement('webview').loadURL             // undefined
```

⇒ אם קוד היה נוגע ב-`webview.isLoading()` היה זורק `TypeError: … is not a function`.

**אבל**: הפלאגין הפנימי `webviewer` (Web Viewer) **קיים** ברשימת ה-31 core plugins
(`app.internalPlugins.plugins.webviewer` קיים) **אך `enabled===false` כברירת-מחדל** —
לא נבדק שינוי לעומת base (לא רלוונטי, ברירת-המחדל של הפלאגין עצמו לא קשורה ל-
`isDesktopApp`). ⇒ הנתיב השבור **לא נגיש** למשתמש שלא מפעיל את הפלאגין ידנית.

#### ההשלכה (פתוחה)

אם משתמש יפעיל את Web Viewer ידנית (Settings → Core plugins), הוא ייתקל ב-TypeError
בפעם הראשונה שהפלאגין ינסה לטעון URL בתוך `<webview>`. לא נמדד/תועד מעבר לזה — אין
כרגע shim ל-`<webview>` (מחוץ ל-scope, `docs/plans/desktop-layout-now.md` §2).

---

### B-008: `sec:` keys (SecureStorage) — לא הושפעו מהסלייס, קיימים גם ב-base

**סטטוס:** נמדד, **אין רגרסיה**. הטאב "Keychain" קיים ב-Settings **גם ב-`717d193`**
(הבסיס, לפני `desktop-layout-now`) — הושוו 18 הטאבים בין base לסלייס, **זהים לחלוטין**
(אומת עצמאית, לא רק סמכתי על דוח האימות). ⇒ הדלקת `isDesktopApp` לא פתחה/סגרה שום
דבר בנתיב הזה. ראה גם רשומת SecureStorage הקיימת למעלה (`get`/`set`/`remove`/
`isKeyExists`/`getPlatformSupportLevel` על `localStorage` עם prefix `sec:`, לא מוצפן).

---

### B-005: vault switcher / starter לא עובד

**סטטוס:** תוקן ל-MVP ב-2026-05-06. הסטארטר עובד עם prompt להזנת נתיב שרת.

#### תסמינים
תפריט "נהל כספות..." לא פותח שום דבר. כפתור "פתח כספת נוספת" לא עושה כלום.

#### למה
ה-electron shim שלנו לא מטפל ב-IPC channels של vault management:
- `vault-open` (ipcMain.on)
- `vault-list`
- `vault-remove`
- `vault-move`

הבעיה המקורית הייתה תמיכה בכספת אחת קבועה (`id="default"`). עכשיו יש:
- `server/vault-registry.js` ששומר registry ב-`data/vaults.json`.
- API endpoints: `/api/vaults/list`, `/api/vaults/open`, `/api/vaults/remove`, `/api/vaults/move`.
- `client/starter.html` שטוען shims ואז את `obsidian/starter.js` המקורי.
- `electron.js` shim שמטפל ב-`vault-open`, `vault-remove`, `vault-move`, ו-`vault-list`.
- FS ו-watch לפי `vaultId`.

מגבלה נשארת: בחירת תיקייה היא `prompt()` עם נתיב שרת, לא browser תיקיות גרפי.

---

## בעיות שנפתרו (ארכיון)

### F-005: אינדקס מטא-דאטה תקוע לנצח (`inProgressTaskCount` תקוע על 3) ✅ תוקן 2026-05-06

**הבאג הקריטי שחסם את כל פעולות ה-rename דרך UI ועוד.**

**סיבה:** Obsidian יוצר Web Worker עם `new Worker("worker.js", {name: "Metadata Cache Worker"})`. ב-Electron עם `app://` protocol זה נפתר ל-`/Resources/obsidian/worker.js`. אצלנו ב-web, `new Worker("worker.js")` נפתר יחסית ל-document URL = `https://.../worker.js` שזה **404**. ה-Worker אובייקט נוצר אבל לא טוען קוד, ולעולם לא משיב ל-postMessage. ה-task הראשונה ב-workQueue תקועה ב-`await this.work(t)` שמחכה לתשובה שלא מגיעה. כי ה-workQueue הוא serial (`promise.then(task)` chain), כל ה-tasks הבאות גם תקועות.

**איך מצאנו:** עטיפת `workQueue.queue` ב-trace הראתה שיש 3 calls אבל רק 1 task starting (ולא finishing). מצא את `prototype.work` בקוד שעוטף `worker.postMessage` ב-Promise. בדיקה ש-`mc.worker` קיים אבל `mc.workerResolve` כבר function (פירוש: postMessage נקרא, מחכה לתשובה). `curl http://localhost:3000/worker.js` החזיר 404.

**תיקון:** ב-`server/index.js` - הוספת route חדש שמגיש `/worker.js` ו-`/sim.js` מ-`obsidian/`:
```js
const ROOT_FILES = ['worker.js', 'sim.js'];
for (const f of ROOT_FILES) {
  app.get('/' + f, (req, res) => res.sendFile(path.join(config.obsidianPath, f)));
}
```

**אישור:** אחרי תיקון - `inProgressTaskCount` יורד ל-0 בתוך 1-2 שניות, IndexedDB מקבל 3 metadata records (SHA hashes), הבאנר "אובסידיאן מוסיף לאינדקס" נעלם, rename דרך ה-UI עובד מקצה לקצה.

**Side effect חיובי:** B-002 (rename דרך UI) **נפתר אוטומטית** עם זה. גם כל פעולה אחרת שעברה דרך `runAsyncLinkUpdate` או `onCleanCache`.

**שיעור:** כל קובץ שאובסידיאן מבקש בlנתיב יחסי (worker.js וכנראה גם sim.js לעתיד) חייב להיות נגיש מ-root. ה-RESOURCE_DIRS שכבר היו (`i18n`, `lib`, `public`, `sandbox`) טיפלו בקבצי תיקיות אבל לא קבצים בודדים מ-root.

---

### F-001: `Menu.buildFromTemplate(...).on(...)` קרס ✅ תוקן 2026-05-06

**סיבה:** ה-shim שלנו החזיר `{popup, closePopup, items}` בלבד, בלי `.on()`. אובסידיאן עושה `.on('menu-will-close', ...)` ולכן `M.on is not a function`.

**תיקון:** ב-`client/shims/electron.js` - `makeMenu()` שמחזיר אובייקט EventEmitter מלא עם `on/off/once/addListener/removeListener/removeAllListeners/emit/popup/closePopup`. כל מתודה מחזירה את ה-menu עצמו (chain-able).

**Side effect שטיפלנו:** popup() עכשיו ממש מצייר context menu DOM (במקרה שאובסידיאן ינצל את זה). יש click handler גלובלי שסוגר את ה-menu בלחיצה מחוץ אליו ומפעיל `menu-will-close`.

### F-002: `fs.watch().on()` לא עבד ✅ תוקן 2026-05-06

**סיבה:** ה-shim החזיר `{close, on: () => {}}`. אובסידיאן רושם listeners עם `.on('change', ...).on('error', ...)` ולא קיבל אירועים אף פעם. זה גרם ל-reconciliation לא להתבצע.

**תיקון:** ב-`client/shims/original-fs.js` - watch() מחזיר עכשיו EventEmitter מלא עם dispatch table של handlers, וה-WebSocket message handler מפעיל אותם.

**תוצאה:** מספר קריאות `readdir` על קבצים ירד מ-7 ל-1 (השאריות שנשארה - ראה B-003).

### F-003: `readdir` על קובץ החזיר 400 → קולסת קונסולה ✅ תוקן 2026-05-06

**סיבה:** השרת החזיר 400 על EISDIR/ENOTDIR. ה-fetch בדפדפן ראה את זה כ-network error והדפיס בconsole.

**תיקון:** ב-`server/api/fs.js` - `handleError` מחזיר 404 עבור EISDIR/ENOTDIR/ENOENT. אובסידיאן יודע לטפל ב-404 כ"לא קיים" ומתעלם.

### F-004: IPC menu noise ✅ תוקן 2026-05-06

**סיבה:** אובסידיאן שולח `set-menu`, `update-menu-items`, `render-menu` ל-Electron menu bar. ה-shim הדפיס warnings.

**תיקון:** ב-`client/shims/electron.js` - מתעלמים בשקט מה-channels האלה.

---

## כיוון מיושם: obsidian-web-mobile — Capacitor approach

> נכון ל-2026-05-11 הגישה מיושמת בפועל: ה-mobile bundle נטען עם CapacitorAdapter, ו-3 build-time patches על `obsidian-mobile/app.js` נתנו לנו שליטה ב-layout (mobile/desktop) דרך `window.__owPlatformOverrides`. **עדכון 2026-07-26** (`docs/plans/runtime-platform-descriptors.md`): 3 מתוך ה-4 patches הוסרו והוחלפו ביירוט `Object.defineProperty` בזמן ריצה (`client-mobile/platform-bridge.js`); patch יחיד נותר (`vault-profile-on-desktop-layout`). ראה "Build-time patch approach (implemented)" בהמשך הסעיף — מתועד כפי-שהיה, לרפרנס היסטורי. **עדכון 2026-07-27** (`docs/plans/zero-patches.md`): גם הפאטצ' היחיד שנותר הוסר — אפס build-time patches על ה-mobile bundle כיום.



### הרקע

ב-2026-05-06 חקרנו את ה-APK של Obsidian לאנדרואיד (גרסה 1.12.7) ומצאנו שה-desktop bundle וה-mobile bundle הם **שני קבצים שונים לחלוטין**, לא גרסה אחת עם feature flags. מסקנה: ה-desktop bundle (שאנחנו משתמשים בו) הוא הבחירה הלא-אידיאלית לweb wrapper. ה-mobile bundle מתוכנן בדיוק לסביבה שבה אין Electron ואין sync APIs.

### ⚠️ אזהרה חשובה: UI מיועד למובייל, לא לdesktop

ה-mobile bundle מכיל UI שמתוכנן לטאצ', מסכים קטנים, ו-soft keyboard. פריסה על desktop browser עם ה-mobile bundle תיתן:
- Ribbon ו-tabs בגודל touch-friendly (גדולים מדי לעכבר)
- חלוקת panels לא מתאימה לחלון רחב
- חסרים features של desktop בלבד (popout windows, advanced drag-and-drop וכו')

**מסקנה:** ה-mobile bundle מתאים לגישה שונה — web app שמתנהגת כמו Obsidian Mobile (לדפדפן על טאבלט/טלפון). אם המטרה היא desktop-class experience בדפדפן — Desktop bundle + shims הוא הנתיב הנכון. אפשר להחזיק את שני הכיוונים בתיקיות נפרדות ולהחליט בהמשך.

### מה גילינו על ה-APK (גרסה 1.12.7)

**מבנה bundle:** (APK מחולץ ב-`/tmp/obsidian-mobile/apk_contents/assets/`)
| קובץ | גודל | תפקיד |
|---|---|---|
| `public/app.js` | 3.6MB | Bundle ראשי (vs 7MB+ לdesktop) |
| `native-bridge.js` | 48KB | Capacitor native bridge |
| `public/worker.js` | 234KB | Web Worker — זהה לdesktop |
| `public/app.css` | 581KB | עיצוב mobile-first |
| `public/cordova.js` | 0 | stub ריק |

**הבדל קריטי — Platform flags:**
Desktop bundle ו-mobile bundle מכילים קוד שונה לחלוטין:
```js
// Desktop: (קיים רק ב-desktop bundle)
Yl.isDesktopApp = true
Yl.isDesktop    = true

// Mobile: (קיים רק ב-mobile bundle, אחרי Capacitor init)
bn.isMobileApp  = true
bn.isMobile     = true
bn.isAndroidApp = true  // אם Android
```
`isMobileApp=!0` לא קיים ב-desktop bundle. `isDesktopApp=!0` לא קיים ב-mobile bundle.

**Capacitor bridge — `nativePromise` הוא ה-single entry point:**
כל קריאה ל-`Filesystem.readFile(opts)` עוברת דרך:
`Capacitor.nativePromise('Filesystem', 'readFile', opts)`.
אם מחליפים רק את `nativePromise` — הכל עובד ללא שינוי ב-app.js.

`getPlatform()` קובע פלטפורמה לפי:
```js
win.androidBridge ? 'android' : win.webkit?.messageHandlers?.bridge ? 'ios' : 'web'
```
ולכן `isNativePlatform()` מוחזר `true` רק כשאחד מהם קיים.

**Android vault directory:** `M.External = "EXTERNAL"` — כל פעולות ה-FS על הvault.

**מנגנון watching על mobile (ללא `fs.watch` של Node):**
```js
// הפעלה:
Iv.startWatch({ directory: 'EXTERNAL', path: vaultPath })
Iv.addListener("change", (event) => {
  // event.path = "/absolute/path/to/changed/file"
  const rel = event.path.substr(basePath.length);
  onFileChange(rel);
});
// עצירה:
Iv.stopWatch()
// אתחול מהיר (custom Obsidian API, לא standard Capacitor):
Iv.watchAndStatAll({ directory: 'EXTERNAL', path: vaultPath })
// → { children: [...] } — עץ קבצים שלם + מפעיל watcher בקריאה אחת
// fallback אם מחזירים 404: startWatch + listRecursive
```

**רשימת Capacitor plugins ב-APK:**
`Filesystem` (חיוני), `App`, `Browser`, `Clipboard`, `Device`, `Haptics`, `Keyboard`, `Preferences`, `SplashScreen`, `StatusBar`, `KeepAwake`, `SecureStorage`, `RateApp`.

### ממצא: ה-"IF ב-CSS" — body class `.is-mobile`

```js
// app.js ~line 3668037:
Yl.isMobile && o.addClass("is-mobile")
```

170 CSS rules תחת `.is-mobile` מופעלות **רק** כשPlatform.isMobile=true. בגרסת desktop שלנו — לא מופעלות בכלל, גם לא ב-viewport קטן.

לעומת זאת, `is-phone` ו-`is-tablet` **כן** מגיבים ל-viewport width (media query + JS toggle) — לכן חלק מהresponsiveness קיים.

**מסקנה:** לגרסת mobile-web אמיתית, חייבים `Platform.isMobile=true` — וזה קיים רק ב-mobile bundle.

### ⭐ ממצא חדש (2026-05-10): isMobile ≠ isPhone — הפרדה קריטית בין UI ללייאאוט

**חקרנו לעומק את השאלה: האם ניתן להשתמש בשכבות המובייל (Capacitor) תוך שמירה על UI דסקטופ?**

#### הממצא המרכזי — Platform object structure (זהה בשני ה-bundles):

```js
var Yl = {  // (Yl=desktop, bn=mobile — אותו אובייקט)
    isDesktop: false,    isMobile: false,
    isDesktopApp: false, isMobileApp: false,
    isPhone: false,      isTablet: false,
    // ...
    get canSplit()          { return !Yl.isPhone },   // ← isPhone, לא isMobile!
    get canDisplayRibbon()  { return !Yl.isPhone },   // ← isPhone, לא isMobile!
    get canStackTabs()      { return !Yl.isPhone },   // ← isPhone, לא isMobile!
    get canExportPdf()      { return Yl.isDesktopApp },
    get canPopoutWindow()   { return Yl.isDesktopApp && Yl.isDesktop },
    get canPinSidebar()     { return Yl.isMobile && !Yl.isPhone },
};
```

`isPhone` נקבע לפי **viewport width** (media query ~600px — נמדד ישירות ב-DoD#6 של
docs/plans/runtime-platform-descriptors.md, resize 1280→520 הופך אותו; תוקן מ-"~630px" הישן), **לא** לפי `isMobile`!

#### מה שולט במה:

| Feature | נשלט ע"י | desktop viewport (≥600px) עם isMobile=true |
|---|---|---|
| Split panes | `!isPhone` | **עובד** ✅ |
| Ribbon | `!isPhone` | **עובד** ✅ |
| Tab stacking | `!isPhone` | **עובד** ✅ |
| Mobile toolbar (is-mobile CSS) | `isMobile` | מופיע ⚠️ |
| Export PDF | `isDesktopApp` | לא ב-mobile bundle ❌ |
| Popout windows | `isDesktopApp && isDesktop` | לא ב-mobile bundle ❌ |

#### EmulateMobile בddesktop bundle — מה עושה בפועל:

```js
// desktop app.js (offset 3666422):
localStorage.getItem("EmulateMobile") && (
    Yl.isMobile = true,
    Yl.isDesktop = false,
    Yl.hasPhysicalKeyboard = false,
    documentElement.addClass("emulate-mobile"),
    // + touch hover behavior
);
// אחר כך, ב-App.initializeWithAdapter:
Yl.isMobile && body.addClass("is-mobile");   // ← is-mobile נוסף כאן
```

חשוב: EmulateMobile **לא** משנה `isDesktopApp` (נשאר true מה-entry IIFE).

#### Mobile bundle — entry IIFE (offset 3728028 מתוך 3,754,511 bytes):

```js
// case 0: await Promise.all([fv, Av.getInfo(), Nv.getInfo()])
// case 1: (לאחר Capacitor init)
bn.isMobileApp = true;   // ← UNCONDITIONAL — אין בדיקה של platform
bn.isMobile    = true;   // ← UNCONDITIONAL
bn.isAndroidApp = Dv;    // Dv = (isNativePlatform && platform=='android')
bn.isIosApp     = Tv;    // Tv = (isNativePlatform && platform=='ios')
...
document.body.addClass("is-mobile");   // ← UNCONDITIONAL
Dv && document.body.addClass("is-android");
```

**אין תנאי.** גם אם `getPlatform()='web'` ו-`isNativePlatform()=false`, `isMobileApp=true` ו-`isMobile=true` מוגדרים בכל מקרה.

#### תשובה סופית לשאלה: "האם ניתן להשתמש בשכבות המובייל עם UI דסקטופ?"

**לא, ללא שינוי ב-app.js** — אבל הבעיה פחות חמורה ממה שנראה:

| גישה | Capacitor adapter | Split panes (desktop viewport) | Mobile toolbar | isDesktopApp |
|---|---|---|---|---|
| A: Desktop bundle כרגיל | ❌ FileSystemAdapter | ✅ | ❌ | ✅ |
| B: Desktop + EmulateMobile תמיד | ❌ FileSystemAdapter | ✅ (isPhone=false) | ⚠️ is-mobile | ✅ |
| C: Mobile bundle (obsidian-web-mobile) | ✅ Capacitor | ✅ (isPhone=false!) | ⚠️ is-mobile | ❌ |
| D: Mobile bundle + patch entry IIFE | ✅ Capacitor | ✅ | ❌ | ✅ |

**גישה C (mobile bundle על viewport דסקטופ):** split panes ו-ribbon עדיין עובדים כי הם תלויים ב-`isPhone` (viewport-based), לא ב-`isMobile`. המגבלה העיקרית היא mobile toolbar ו-`isDesktopApp=false` (ללא export PDF ו-popout windows).

**גישה B (EmulateMobile תמיד):** נותנת `isMobile=true` לפלאגינים (plugin compat טוב יותר), split panes עובדים, mobile toolbar מופיע — אך אין Capacitor adapter (עדיין FileSystemAdapter).

**גישה D (patch entry IIFE):** השינוי הקטן ביותר ב-app.js — רק ה-100 שורות האחרונות — כדי לאתחל Capacitor במקום Electron. שאר ה-app.js נשאר ללא שינוי.

### ממצא: desktop vs mobile — codebase אחד, entry IIFE שונה

- **גדלים:** desktop 3.56MB, mobile 3.58MB — הפרש 25KB בלבד
- **כל הקוד קיים בשניהם:** `CapacitorAdapter` + `ElectronVaultAdapter` — זהים byte-for-byte
- **ה-split הוא entry IIFE בסוף הbundle:**
  - Desktop: `Yl.isDesktopApp=true` → Electron bootstrap (ללא בדיקת Capacitor)
  - Mobile: `bn.isMobileApp=true` → Capacitor bootstrap (אחרי await)
- **אין tree-shaking** — כל platform code קיים בשני הbundles
- **אין compile-time constants** — הכל runtime branching
- **Fake Capacitor לא יעזור לdesktop bundle** — ה-desktop IIFE מגדיר `isDesktopApp=true` ישירות בלי בדיקות

### תוכנית `obsidian-web-mobile/` (תיקייה נפרדת)

**עיקרון:** שיכפול של `obsidian-web`, החלפת electron shims ב-Capacitor shim, החלפת desktop bundle במobile bundle.

**מה משתנה ב-client:**
- `index.html`: סדר טעינה — `native-bridge.js` → `shims/capacitor.js` → mobile `app.js`
- `shims/capacitor.js` — קובץ מרכזי חדש (~200 שורות):
  - לאחר טעינת `native-bridge.js`, מחליף `Capacitor.nativePromise` ו-`getPlatform`
  - מממש `Filesystem` plugin ב-HTTP calls לשרת הקיים
  - מממש file watching דרך WebSocket הקיים
  - Stubs ל-Clipboard/Device/SplashScreen/Keyboard/Preferences/App
- `boot.js`: מפושט — ללא electron shim, עם path/util/crypto/buffer לפלאגינים

**מה משתנה ב-server (מינימלי):**
- `PUT /api/fs/append` — chunks של קבצים בינאריים גדולים (>5MB, כתיבה בחלקים)
- `POST /api/fs/copy` — העתקת קובץ
- שאר ה-API (`/api/fs/read`, `/api/fs/write`, `/api/watch`, וכו') — **זהה לחלוטין**

**מיפוי Capacitor → HTTP API:**

| Capacitor | HTTP | קיים? |
|---|---|---|
| `readFile({encoding:'utf8'})` | `GET /api/fs/read?encoding=utf8` | ✅ |
| `readFile` בינארי | `GET /api/fs/read` → base64 | ✅ |
| `readFile` >5MB | `fetch(getUri(path))` → `/api/fs/read` | ✅ |
| `writeFile` | `PUT /api/fs/write` | ✅ |
| `appendFile` | `PUT /api/fs/append` | ❌ חדש |
| `readdir` | `GET /api/fs/readdir` (format שונה) | ✅ |
| `stat` | `GET /api/fs/stat` | ✅ |
| `mkdir` | `POST /api/fs/mkdir` | ✅ |
| `deleteFile` | `DELETE /api/fs/unlink` | ✅ |
| `rename` | `POST /api/fs/rename` | ✅ |
| `copy` | `POST /api/fs/copy` | ❌ חדש |
| `getUri` | synthetic URL (`/api/fs/read?...`) | — |
| `watchAndStatAll` | 404 → fallback אוטומטי | — |
| `startWatch` + `addListener("change")` | WebSocket `/api/watch` | ✅ |
| `stopWatch` | סגירת WebSocket | ✅ |

**15 מתוך 15 calls ממופים. 2 endpoints חדשים בשרת.**

**מה צפוי לעבוד בmobile bundle שלא עובד עכשיו (desktop):**
- Templater — `isMobile=true` → דלג על child_process לחלוטין
- כל plugin שבודק `Platform.isMobile` לפני desktop-only features
- `adapter instanceof FileSystemAdapter` → `false` → plugins לוקחים mobile code paths
- אין sync XHR בכלל → אין deprecation warning, אין blocking

### Build-time patch approach (implemented, ואז הוחלף חלקית — ראה עדכון)

> **עדכון 2026-07-26** (`docs/plans/runtime-platform-descriptors.md`): הסעיף הזה מתאר את
> המצב **כפי שהיה עד לסלייס הזה** — נשאר כרפרנס היסטורי (הרציונל תקף גם למנגנון החדש).
> patches 1-3 בטבלה למטה **הוסרו**; המנגנון שהם מימשו קיים היום כ-runtime interception
> ב-`client-mobile/platform-bridge.js` (יירוט `Object.defineProperty`, לא regex על app.js).
> patch 4 (`vault-profile-on-desktop-layout`, לא בטבלה הזו) **היה עדיין קיים בזמן כתיבת
> העדכון הזה**. שלושת ה-"Hooks" וה-"עקרונות" למטה עדיין תקפים כהתנהגות-נצפית, **חוץ**
> מ"ההחלטה היא boot-time, לא runtime" — זה כבר לא נכון: הלכידה/נעילה של Platform קורות
> ב-runtime, רק ה-**overrides object עצמו** עדיין נקבע ב-boot-time (`boot.js`).
>
> **עדכון 2026-07-27** (`docs/plans/zero-patches.md`): patch 4 גם הוא **הוסר**.
> `PATCHES.length === 0` — אין יותר build-time patches על ה-mobile bundle כלל;
> `scripts/patch-obsidian-mobile.js` נשאר כתשתית ריקה. הפאנל vault-profile ממשיך לרנדר
> במצב desktop-layout כי `platform-bridge.js` נועל את `isDesktopApp` ישירות (ראה
> LOCKED_FLAGS שם) — לא כי הפאטצ' עדיין קיים.

**הבעיה שצריך לפתור:** ה-mobile bundle קובע ב-IIFE שלו `bn.isMobile=!0` ומוסיף `is-mobile` ל-body. גם על viewport דסקטופ זה גורם ל-170 CSS rules של mobile להופיע, mobile toolbar, ו-`isMobile=true` שמוטמע ב-`window.app` כשהוא נוצר. גישת ה-MutationObserver שהיתה ב-boot.js ניסתה לפרק את זה אחרי שה-workspace נטען — אבל זה ייצר flicker וגם לא שלט ב-`app.isMobile` שנקבע בזמן ההבנייה של ה-App.

**הפתרון:** שלושה patches על `obsidian-mobile/app.js` בזמן ההורדה/חילוץ (במודול `scripts/patch-obsidian-mobile.js`):

| # | regex | מה משיג |
|---|---|---|
| 1. `expose-platform` | `var (\w{1,3})=\{isDesktop:!1,isMobile:!1,isDesktopApp:!1` → `var $1=window.__owPlatform={isDesktop:!1,...` | חושף את אובייקט ה-Platform כ-global, כך שניתן לקרוא/לכתוב אליו מבחוץ |
| 2. `iife-overrides` | `\1.isMobileApp=!0,\1.isMobile=!0,\1.isAndroidApp=Dv,\1.isIosApp=Tv,` → `Object.assign($1,{isMobileApp:!0,isMobile:!0,...},window.__owPlatformOverrides\|\|{}),` | במקום הצבות לא-מותנות, ממזג גם את ה-overrides שהוגדרו ב-`window.__owPlatformOverrides` (כ-argument אחרון של `Object.assign` הוא מנצח את ברירות המחדל) |
| 3. `is-mobile-class` | `document.body.addClass("is-mobile"),` → `window.__owPlatform.isMobile&&document.body.addClass("is-mobile"),` | מתנה את הוספת ה-class בערך post-override של `isMobile` |

הregex של patch 2 משתמש ב-backreferences (`\1`) כדי לוודא שכל ארבע ההצבות משתמשות באותו שם משתנה מינימוף, ועומד גם אם המינוף ישנה בעתיד את שם המשתנה.

**Hooks שהפתרון פותח:**

- `window.__owPlatformOverrides = { isMobile: false, isDesktop: true }` ב-`client-mobile/boot.js` (לפני שה-bundle נטען) → desktop layout גם כשbundle הוא mobile. ⚠️ **`isDesktop: true` חובה** מ-2026-07-27 (`docs/plans/zero-patches.md` §1ג) — בלי זה `isMobile`/`isDesktopApp` מתבדרים (`!isMobile===true` אבל `isDesktopApp===false`) ופאנל ה-vault-profile נעלם בשקט, בלי באנר.
- `window.__owPlatform` (אחרי שה-bundle רץ) → גישה ל-flags של Platform מהקליינט (plugin עתידי, debugging).
- localStorage key `obsidian-web:layout-mode` (`auto` | `mobile` | `desktop`) — `boot.js` קורא וקובע את ה-overrides.

**עקרונות חשובים שנשמרים:**

- `isMobileApp` נשאר `true` תמיד — זה מה שגורם לבחירת `CapacitorAdapter` במקום `FileSystemAdapter`. אסור לדרוס אותו.
- ההחלטה היא boot-time, לא runtime — מתי שה-IIFE מתחיל לרוץ, `__owPlatformOverrides` כבר קיים. בלי race conditions.
- `is-android` / `is-ios` כבר מותנים ב-bundle המקורי (תלויים ב-`Dv`/`Tv`); לא נוגעים בהם.

---

## רעיונות לעתיד

### Pre-flight bundle (Phase 2)
endpoint יחיד שמחזיר את כל הקבצים של `.obsidian/` במכה אחת:
```
GET /api/bootstrap → {
  "app.json": "...",
  "core-plugins.json": "...",
  "workspace.json": "...",
  ...
}
```
החיסכון: 15+ HTTP round-trips ב-boot, כל אחד עם קישוריות tunnel = 100-300ms.

### Client-side cache עם fs.watch invalidation (Phase 2)
LRU cache ב-shim של `original-fs`:
- כל `read()`/`stat()` מאחסן את התוצאה לפי path.
- כש-fs.watch מקבל event על path, מנקה את הentry שלו.
- חיסכון: 90% מהקריאות החוזרות.

### זיהוי "stuck workQueue" אוטומטית
אם אנחנו רואים `inProgressTaskCount > 0` במשך 30 שניות בלי שינוי, להפעיל אוטומטית את ה-workaround מ-B-001 ולהתריע ב-console. לפחות עד שנמצא את הבעיה האמיתית.

### Service worker offline mode (Phase 5)
- cache של `obsidian/app.js` ו-static assets.
- read-only mode כשאין רשת.

---

## PluginHeaders mechanism — איך Capacitor מנתב method calls {#pluginheaders}

> Added: 2026-05-11. הגילוי המרכזי שפתח את ה-debugging של ה-mobile bundle.

### הבעיה שגילתה אותו

בהטמעה הראשונה של ה-Capacitor shim, כל קריאה מ-`app.js` לפלאגין החזירה:

```
Error: Filesystem is not implemented on android
```

`window.androidBridge.postMessage` קיים, `window.Capacitor.fromNative` קיים, `nativePromise` overridden — ועדיין השגיאה. הסיבה: ה-method call **לעולם לא הגיע** ל-`nativePromise` שלנו. הוא נחסם קודם ב-Proxy.

### מה `registerPlugin()` עושה ב-bundle המקורי

ב-`obsidian-mobile/app.js` (offset ~181781 בגרסה 1.12.7) יש פונקציה `registerPlugin(name, options)` שמחזירה **Proxy** ולא אובייקט רגיל. ה-Proxy עוטף את כל הקריאות ל-`Capacitor.Plugins.<name>.<method>(args)`. ה-handler עושה (מפושט):

```js
function registerPlugin(pluginName) {
  return new Proxy({}, {
    get(target, methodName) {
      // 1. חפש את הheaders של ה-plugin
      const header = c.PluginHeaders.find(h => h.name === pluginName);
      if (!header) throw new Error(pluginName + ' is not implemented on android');

      // 2. חפש את ה-method ברשימת ה-methods
      const meta = header.methods.find(m => m.name === methodName);
      if (!meta) throw new Error(methodName + ' is not implemented on ' + pluginName);

      // 3. לפי rtype, החזר wrapper שקורא ל-nativePromise / nativeCallback
      if (meta.rtype === 'promise') {
        return (opts) => Capacitor.nativePromise(pluginName, methodName, opts);
      } else if (meta.rtype === 'callback') {
        return (opts, cb) => Capacitor.nativeCallback(pluginName, methodName, opts, cb);
      }
    }
  });
}
```

המסקנה: **בלי entry ב-`c.PluginHeaders`, ה-call נחסם בProxy לפני שמגיע ל-`nativePromise` שלנו.** זה לא משנה כמה shims מקצועיים נכתוב — אם ה-method לא רשום ב-headers, הוא לא קיים מנקודת הראיה של ה-bundle.

### למה `androidBridge.postMessage` לבד לא מספיק

ה-`androidBridge.postMessage` הוא ה-transport: רק כשמשתמשים בו, `getPlatformId()` מחזיר `'android'` ו-`Em` (פלאג native) מוגדר `true`. אבל ה-transport הזה משמש רק **אחרי** שהProxy החליט שיש method לקרוא לו. אם אין PluginHeaders → אין wrapper → `androidBridge.postMessage` מעולם לא נקרא לקריאה הזו.

המשמעות: אנחנו צריכים שני דברים נפרדים, ושניהם חייבים להיות מוכנים בזמן הנכון:

| מי | למה צריך | מתי לחשוף |
|---|---|---|
| `window.androidBridge` | כדי ש-`native-bridge.js` יבחר platform=android בזמן הinit שלו | **לפני** `native-bridge.js` נטען |
| `window.Capacitor.PluginHeaders` | כדי ש-`registerPlugin()` Proxy ידע אילו methods קיימים | **אחרי** ש-`native-bridge.js` רץ ויצר את `window.Capacitor` |

ה-shim שלנו עושה את שניהם: `androidBridge` מוגדר ב-IIFE בראש הקובץ (לפני `<script src="native-bridge.js">`), ו-`PluginHeaders` מוגדר ב-`patchCapacitor()` שרץ מיד אחרי שה-IIFE מסיים (וגם שוב ב-`DOMContentLoaded`, ליתר ביטחון).

### ההבחנה בין `rtype: 'promise'` ל-`rtype: 'callback'`

| rtype | Wrapper שmproxy מחזיר | מתי בשימוש |
|---|---|---|
| `promise` | `(opts) => nativePromise(plugin, method, opts)` | כמעט כל ה-API. מחזיר `Promise<result>`. |
| `callback` | `(opts, cb) => nativeCallback(plugin, method, opts, cb)` | רק לאירועים מתמשכים — למשל `Filesystem.addListener('change', cb)`. ה-callback נקרא בכל event חוזר. |

ב-shim שלנו, כמעט הכל הוא `promise`. ה-helper `pm(name)` ב-`patchCapacitor` בנוי לזה:

```js
function pm(name) { return { name, rtype: 'promise' }; }
```

`Filesystem.addListener` היה צריך להיות `callback` כדי לקבל events מרובים — אך כרגע אנחנו מצהירים עליו כ-`promise` ומשתמשים ב-implementation שלנו ב-`capacitor-shim.js` ש-bypass-ssa את ה-bridge (`Filesystem.addListener` ב-JS מחזיר Promise עם `{remove}`, ה-callback נקרא ישירות מה-WebSocket — לא דרך `fromNative`). זה עובד כי ב-`patchCapacitor` אנחנו גם דורסים את `cap.Plugins.Filesystem` ישירות, אז ה-Proxy לעולם לא נקרא ל-`addListener`.

### Side note: למה לא להגדיר `cap.PluginHeaders` ב-IIFE לפני native-bridge

ניסינו. `native-bridge.js` יוצר את `window.Capacitor` מחדש ודורס את ה-`PluginHeaders` שהגדרנו. לכן ההגדרה חייבת להיות אחרי שה-bridge טען את עצמו. הפתרון הנוכחי: `patchCapacitor()` רץ מיד (sync) אחרי ה-IIFE ועוד פעם ב-`DOMContentLoaded` ליתר ביטחון.

### מיקום בקוד

- `client-mobile/shims/capacitor-shim.js:546-549` — הגדרת `window.androidBridge` (לפני native-bridge).
- `client-mobile/shims/capacitor-shim.js:592-674` — `cap.PluginHeaders` עם רשימת כל ה-plugins + methods.
- `client-mobile/shims/capacitor-shim.js:678-679` — קריאה ל-`patchCapacitor()` (sync + DOMContentLoaded).
- `client-mobile/shims/capacitor-shim.js:506-544` — `routeNativeCall` שמטפל ב-`postMessage` ומחזיר תוצאות דרך `cap.fromNative`.

---

## Capacitor plugin inventory {#capacitor-plugin-inventory}

> Added: 2026-05-11. רשימה מסכמת של 13 ה-Capacitor plugins ב-shim שלנו, מסווגים לפי סוג המימוש.

ה-mobile bundle תומך ב-13 Capacitor plugins (מסומנים ב-APK של גרסה 1.12.7). ה-shim שלנו מספק לכולם entry — חלקם implementations אמיתיים, חלקם stubs נקיים. הסיווג:

### Real implementations — מנותבים ל-HTTP API שלנו

הליבה האמיתית של ה-shim. כל קריאה הופכת לבקשת HTTP מול server/api/fs.js או WebSocket מול server/api/watch.js.

| Plugin | Methods | קורא ל |
|---|---|---|
| **Filesystem** | `readFile`, `writeFile`, `appendFile`, `stat`, `readdir`, `mkdir`, `rmdir`, `rename`, `copy`, `deleteFile`, `trash`, `getUri`, `startWatch`, `stopWatch`, `watchAndStatAll`, `addListener` | `/api/fs/*`, `/api/watch` (WS) |

`watchAndStatAll` משתמש ב-bootstrap (`/api/bootstrap?full=1`) כדי להחזיר snapshot של כל ה-tree + לפתוח watcher בקריאה אחת.

### Browser-native — delegation ל-Web APIs מובנים

אין צורך בשרת — ה-shim פשוט עוטף API קיים בדפדפן.

| Plugin | Methods | עוטף |
|---|---|---|
| **Clipboard** | `read`, `write` | `navigator.clipboard.readText` / `writeText` |
| **Browser** | `open`, `close` | `window.open(url, '_blank', 'noopener')` |
| **Preferences** | `get`, `set`, `remove`, `clear`, `keys` | `localStorage` עם prefix `cap:` |
| **SecureStorage** | `get`, `set`, `remove`, `isKeyExists`, `getPlatformSupportLevel` | `localStorage` עם prefix `sec:` (לא מוצפן באמת — אזהרה!) |

**הערה לגבי SecureStorage:** למרות השם, אין כאן הצפנה. הוא קיים כדי שפלאגינים שמשתמשים ב-`SecureStorage` יחיו, אך לא לאחסון של סודות אמיתיים.

### Identity stubs — מחזירים מידע אמיתי-למראית

המתודות פועלות, אך הנתון המוחזר הוא קבוע / נגזר מ-API דפדפן בסיסי. אין side effects.

| Plugin | Methods | המוחזר |
|---|---|---|
| **Device** | `getInfo`, `getId`, `getLanguageCode` | `{ platform: 'android', model: 'Browser', osVersion: '12', ... }`, `navigator.language` |
| **App** | `getInfo`, `getState`, `getLaunchUrl`, `isInstalledFromStore`, `getFonts`, ... | `{ name: 'Obsidian', version: '1.12.7', id: 'md.obsidian', build: '0' }` |

### Noop stubs — מחזירים success, לא עושים כלום

לא רלוונטיים ב-web. הם קיימים רק כדי שקוד שמצפה אליהם לא ייפול.

| Plugin | Methods | למה noop |
|---|---|---|
| **SplashScreen** | `show`, `hide` | אין splash screen בweb |
| **StatusBar** | `setStyle`, `setBackgroundColor`, `show`, `hide`, `getInfo` | אין status bar — UA chrome מטופל ע"י הדפדפן |
| **Keyboard** | `show`, `hide`, `addListener`, `setResizeMode`, ... | virtual keyboard מטופל ע"י ה-OS, לא הדפדפן |
| **KeepAwake** | `keepAwake`, `allowSleep`, `isKeptAwake` | אין wake-lock נדרש; אם יידרש — `navigator.wakeLock.request()` |
| **Haptics** | `impact`, `notification`, `vibrate`, `selection*` | לפעמים `navigator.vibrate` אפשרי. כרגע noop. |
| **RateApp** | `requestReview` | אין app store למעבר אליו |

### TODO / known limitations

| Plugin.method | מצב | מה צריך |
|---|---|---|
| `App.requestUrl` | מחזיר `{}` (no-op) | implementation אמיתי דרך `fetch()` — נדרש עבור LiveSync (CouchDB calls). ראה PLAN.md "Updated approach (2026-05-11): direct fetch + CORS". |

### Call flow

הזרימה המלאה של קריאה מ-`app.js` ועד שרת ושוב חזרה מתועדת ב-`client-mobile/shims/capacitor-shim.js:488-505` (comment block "Android bridge"). ה-mechanism של ה-Proxy שמכריח רישום מ-PluginHeaders מתועד בסעיף [PluginHeaders mechanism](#pluginheaders).

---

## `window.__owPlatform` runtime API {#owplatform-api}

> Added: 2026-05-11. ה-mechanism שמאפשר control בזמן ריצה על ה-Platform flags של Obsidian.
> **עדכון 2026-07-26** (`docs/plans/runtime-platform-descriptors.md`): המקור עבר מ-3
> build-time patches ל-runtime interception (`client-mobile/platform-bridge.js`,
> יירוט `Object.defineProperty`). ה-API הציבורי (שני ה-globals למטה) **זהה** —
> זו הסיבה שהמעבר לא שבר צרכנים כמו `obsidian-web-layout/main.js:65`. מה שהשתנה:
> `window.__owPlatform` הפך מ-plain-object חשוף ל-**reference שנלכד** אחרי אימות-צורה,
> ו-`isMobile`/`isMobileApp`/`isDesktop` הפכו מ-data properties כתיבים ל-**accessors נעולים**
> (getter קבוע + setter no-op) — כתיבה אליהם כבר לא "תופסת" בכלל, אפילו לא באופן לא-retroactive.

הסעיף הזה מתעד את ה-API הציבורי, שמומש קודם ע"י 3 build-time patches (עדיין מתועדים
ב-["Build-time patch approach (implemented)"](#build-time-patch-approach-implemented)
כרפרנס היסטורי) והיום ע"י runtime interception.

### שני globals שונים — אל תבלבל ביניהם

#### `window.__owPlatform` — reference חי לאובייקט Platform

נחשף ע"י `client-mobile/platform-bridge.js` אחרי לכידה מאומתת (`'isMobileApp' in P && 'canPinSidebar' in P`).
הוא **אותו אובייקט** שה-bundle משתמש בו פנימית כדי לבדוק `isMobile`, `isPhone`, `isDesktopApp` וכו'.

```js
window.__owPlatform.isMobile      // true / false  (קריא)
window.__owPlatform.isPhone       // נגזר מ-viewport (~600px), קריא לרוב
window.__owPlatform.isDesktopApp  // true בפריסת-דסקטופ, false במובייל/אמולציה —
                                   // ⚠️ עדכון 2026-07-27 (docs/plans/desktop-layout-now.md
                                   // §1): לפני הסלייס הזה זה היה false קבוע (אין electron
                                   // shim). עכשיו נעול כמו שלושת האחרים (למטה).
```

**`isMobile`/`isMobileApp`/`isDesktop` נעולים — כתיבה אליהם היא no-op** (accessor עם
`set(){}` ריק, ראה `platform-bridge.js` §3.2). שאר השדות (`isPhone`, `isTablet`,
`canSplit` וכו') נשארים plain data properties, כמו קודם — Obsidian עצמו ממשיך לכתוב
אליהם (למשל `wn()` על שינוי viewport). הדרך הבטוחה לשנות layout: לעדכן
`__owPlatformOverrides` ו-reload — לא לכתוב ל-`__owPlatform` ישירות.

#### `window.__owPlatformOverrides` — overrides שנקראים ב-install

נקרא ע"י `client-mobile/platform-bridge.js` **בעצלתיים, ברגע שה-Platform האמיתי נלכד**
(לא ב-init של ה-IIFE — ראה brief §3.0 לתרשים-הסדר המלא):

```js
// platform-bridge.js locks exactly these FOUR flags to window.__owPlatformOverrides
// (עדכון 2026-07-27, docs/plans/desktop-layout-now.md §1 — isDesktopApp נוסף; לפני
// כן היו רק שלושה, וההערה כאן טענה ש-isDesktopApp "נקרא ונענה בכוונה" — זה היה נכון
// לפני שהיה electron shim, ולא נכון יותר):
LOCKED_FLAGS = ['isMobile', 'isMobileApp', 'isDesktop', 'isDesktopApp'];
```

מה ש-`__owPlatformOverrides` מכיל מנצח את ברירות המחדל של ה-bundle לארבעת הדגלים האלה
בלבד; `isPhone`/`isTablet` נקראים ונענים בכוונה (viewport-based, לא ננעלים — ראה
`platform-bridge.js`'s own LOCKED_FLAGS comment).

**חובה להגדיר אותו לפני שה-bundle נטען.** ב-`client-mobile/boot.js` זה קורה ב-sync code לפני ה-`fetch()` ל-bootstrap (שאחריו ה-scripts מוזרקים). אם תגדיר אותו אחרי ש-`app.js` נטען, אין לזה השפעה — ה-bridge כבר קרא אותו פעם אחת, ב-install.

```js
// דוגמה — חייב לרוץ לפני <script src="/obsidian-mobile/app.js">:
window.__owPlatformOverrides = { isMobile: false, isDesktop: true };
// תוצאה: bn.isMobile יהיה false למרות שברירת המחדל היא true.
// ⚠️ isDesktop:true חובה (docs/plans/zero-patches.md §1ג) — computeWant() גוזר את
// isDesktopApp מ-overrides.isDesktop, לא מ-overrides.isMobile. בלי isDesktop:true כאן,
// isDesktopApp נשאר false בעוד ש-!isMobile===true — דיברגנציה, ופאנל ה-vault-profile
// (שגייטד על isDesktopApp בבאנדל עצמו, ללא patch יותר) לא ירונדר.
```

`isMobileApp` **לא** משתנה (זה מה שבוחר ב-CapacitorAdapter במקום FileSystemAdapter). רק ה-flags הקוסמטיים ו-layout flags ניתנים ל-override.

### localStorage key `obsidian-web:layout-mode` — מקור האמת

ה-key הזה הוא המקום היחיד ש-`client-mobile/boot.js` קורא ממנו את ההחלטה:

| Value | תוצאה |
|---|---|
| `mobile` | `__owPlatformOverrides = { isMobile: true }` — mobile UI תמיד |
| `desktop` | `__owPlatformOverrides = { isMobile: false, isDesktop: true }` — desktop UI תמיד ⚠️ `isDesktop: true` חובה, ראה §1ג לעיל |
| `auto` (ברירת מחדל) | viewport-based: `< 900` רוחב או `< 600` גובה → mobile, אחרת desktop |
| חסר | `auto` |

`computeLayoutMode()` ב-`client-mobile/boot.js:60-67` מבצע את החישוב. ה-`obsidian-web-layout` plugin (ribbon icon + commands) הוא ה-UI שכותב ל-key הזה ועושה reload.

### Use cases מעשיים

**ל-plugin / קוד שעובד בtime ה-renderer:**

```js
// לקרוא mode נוכחי:
const mode = localStorage.getItem('obsidian-web:layout-mode') || 'auto';

// לקבוע mode + reload (זו הדרך היחידה שמשפיעה על UI מבני):
localStorage.setItem('obsidian-web:layout-mode', 'desktop');
location.reload();

// לקרוא Platform flags כפי שהם כרגע:
const isMobile = window.__owPlatform?.isMobile;
const isPhone  = window.__owPlatform?.isPhone;
```

**ל-debugging מ-DevTools:**

```js
__owPlatform        // ה-object השלם — בדוק 30+ flags
__owPlatformOverrides // מה שהגדרנו ב-boot.js
```

### מגבלות

- `__owPlatform.isMobile`/`isMobileApp`/`isDesktop` נעולים (accessor, `set` no-op) — כתיבה אליהם היא no-op שקט, לא רק "לא-רטרואקטיבי". השדות האחרים (`isPhone`, `isTablet` וכו') נשארים כתיבים.
- `isPhone` נקבע מ-media query על viewport ב-runtime ולא בידי `__owPlatformOverrides`. אם תרצה לשנות אותו תיאלץ לעדכן ידנית את ה-property (וזה לא יעדכן רכיבי UI שכבר rendered).
- `isMobileApp` לא ניתן להעברה ל-`false` ב-mobile runtime — זה ישבור את ה-CapacitorAdapter selection. אם רוצים FileSystemAdapter, לך ל-`/` (desktop runtime).

---

## Virtual plugin overlay — deep dive {#virtual-overlay-deep-dive}

> Added: 2026-05-11. תיעוד מפורט של ה-mechanism. סיכום קצר ב-["System plugin overlay"](#system-plugin-overlay) למעלה.

המנגנון מאפשר לפלאגינים שיושבים ב-`<repo>/plugins/<id>/` להופיע כאילו הם חלק מ-`.obsidian/plugins/` של כל vault שמשתמש פותח — בלי לכתוב לדיסק של המשתמש.

### Decision tree על כל request

```
GET /api/fs/read?path=.obsidian/plugins/<id>/main.js
  │
  ├─ vault has the file?              ─yes→  serve vault file (override wins)
  │
  └─ no                                     ─→  tryGetSystemFilePath(rel)
                                                 │
                                                 ├─ matches a system plugin?  ─yes→  serve <repo>/plugins/<id>/main.js
                                                 │
                                                 └─ no                              ─→  404 ENOENT
```

אותה לוגיקה ל-`/stat`. עבור `/readdir` ול-`.obsidian/community-plugins.json` יש המבנה מיוחד:

### `.obsidian/community-plugins.json` — merge בread, strip בwrite

הקובץ הזה הוא array של ids של פלאגינים "מופעלים":

```json
["dataview", "obsidian-web-layout"]
```

| Operation | Behavior |
|---|---|
| GET `/read` | קוראים את הvault file (או `[]` אם לא קיים), ממזגים את כל ה-`getSystemPluginIds()`. הfront-end רואה תמיד את ה-system plugins כ-enabled. |
| PUT `/write` | מקבלים array מהfront-end, מסירים את כל ה-system plugin ids, ושומרים רק את השאר ל-disk. ה-vault שומר ניטרלי. |

זה מאפשר תרחיש: משתמש "מבטל" את ה-system plugin דרך UI → Obsidian כותב array חדש ללא ה-id → השרת רואה שאין שינוי אמיתי. בטעינה הבאה ה-id חוזר. כלומר **disable של system plugin אינו persistent** (מגבלה ידועה, ראה למטה).

### Synthesized directory stat + readdir

ה-bundle של Obsidian עושה `stat('.obsidian/plugins')` *לפני* `readdir`, ואם זה 404 — מפסיק שם. לכן:

#### Synthesized `stat` של `.obsidian/plugins`

```
GET /api/fs/stat?path=.obsidian/plugins
  │
  ├─ vault has .obsidian/plugins/ directory?     ─yes→  return its real stat
  │
  └─ no AND getSystemPluginIds().length > 0     ─→  return {
                                                     isDirectory: true,
                                                     mtime: Date.now(),
                                                     size: 0,
                                                     synthesized: true,
                                                   }
```

זה ה-gate הקריטי — בלעדיו, על vault חדש (שלא נפתח עדיין מ-`obsidian-web`), Obsidian לא יבצע readdir ולא יגלה את ה-system plugins.

#### Synthesized `readdir` של `.obsidian/plugins`

```
GET /api/fs/readdir?path=.obsidian/plugins
  │
  ├─ vault has the directory? → readdir → merge vault entries + system plugin ids (vault wins on collision)
  │
  └─ ENOENT in vault → return only system plugin entries (each as { name: id, isDirectory: true, ... })
```

### Precedence: vault > repo

החוקיות בכל המעברים: אם הקובץ קיים ב-vault, הוא מנצח. זה מאפשר:

- **Overrides ידניים** — משתמש שרוצה לבדוק שינוי לפלאגין יכול לשים את הקובץ ב-`.obsidian/plugins/obsidian-web-layout/main.js` של ה-vault שלו ולעקוף את ה-repo version.
- **רנייט בודקה (QA)** — overrides ב-vault מהווים unit test טבעי. הסר את הקובץ — חוזרים ל-repo version.

### Path traversal protection

`tryGetSystemFilePath(relPath)` ב-`server/system-plugins.js`:

1. מבצע `path.resolve(SYSTEM_PLUGINS_DIR, relPath.replace(/^\.obsidian\/plugins\//, ''))`.
2. בודק שה-resolved path **נשאר תחת** `SYSTEM_PLUGINS_DIR` (`resolved.startsWith(SYSTEM_PLUGINS_DIR + path.sep)`).
3. אם לא — מחזיר `null` (כאילו הקובץ לא קיים ב-system plugins).

ניסיון כמו `path=.obsidian/plugins/obsidian-web-layout/../../../etc/passwd` יוחזר כ-`null`; ה-handler נופל ל-resolveSafe של ה-vault שגם הוא מסנן path traversal → 404. כלומר הגנה כפולה.

### Limitations

| Limitation | סטטוס |
|---|---|
| Disable של system plugin דרך UI לא persist (re-injected each load) | בכוונה — system plugins הם "always on" עבור obsidian-web. |
| לא ניתן לעדכן system plugin בלי restart של השרת | `systemPlugins.init()` סורק רק ב-startup; שינוי ב-`<repo>/plugins/` דורש restart. |
| ה-`data.json` של system plugin נכתב ל-vault (לא ל-repo) | זה נכון — settings הם per-vault. ה-repo מכיל code; ה-vault מכיל state. |

### Use cases עתידיים

- **system plugin של LiveSync** — תוסף `obsidian-livesync` מוזרק לכל vault, מוגדר דרך `data.json` per-vault. ראה PLAN.md "Updated approach (2026-05-11): direct fetch + CORS" ו-Gap 15 לגבי opt-in via env var ל-CF demo.
- **system plugin של mobile UI tweaks** — תוסף שמוסיף touch gestures חסרים ב-mobile bundle.

---

## Mobile bootstrap cache — מגבלות ידועות {#mobile-bootstrap-cache-limits}

> Added: 2026-05-12. שני תרחישים שבהם ה-cache שהוטמע ב-mobile runtime לא יעזור באופן מלא. הקאש עצמו עובד מצוין (88% hit rate בהפעלה רגילה, 79-88% הפחתה בזמן cold boot על vault גדול) — אבל יש שני edge cases שכדאי להכיר.

### Web Workers לא רואים את ה-cache {#mobile-bootstrap-cache-workers}

#### הקונטקסט

ה-metadataCache של אובסידיאן סורק כל קובץ markdown בכספת ובונה אינדקס של כותרות, קישורים פנימיים (`[[...]]`), embeds, תגיות, footnotes, ו-frontmatter. הפרסור הזה יקר ב-CPU — אובסידיאן מעבירה אותו ל-**Web Worker** (`worker.js`) כדי שה-main thread לא ייחסם בזמן שמפרסרים את כל הכספת.

#### הבעיה הטכנית

Web Workers הם **קונטקסטים נפרדים לחלוטין** — להם יש `self` במקום `window`, יש להם `fetch` משלהם, ואין להם גישה ל-`window.__owBootstrapCache`, ל-`window.__owBootstrapLookup`, או ל-shims שלנו ב-`capacitor-shim.js`. אם worker היה רוצה לקרוא קובץ ישירות, הוא היה חייב לעשות `fetch('/api/fs/read?...')` בעצמו — ולעקוף לחלוטין את ה-cache. כל קובץ = round-trip.

#### למה זו לא בעיה בפועל בכספת שנבדקה (2026-05-12)

אובסידיאן בנו את ה-worker שלהם בצורה חכמה: **ה-worker לא קורא קבצים בכלל**. במקום זה:

1. ה-main thread (שעובר דרך ה-shim שלנו, עם cache) קורא את הקובץ.
2. ה-main thread שולח את ה-buffer ל-worker דרך `postMessage` כ-`{ metadataCache: <ArrayBuffer> }`.
3. ה-worker מקבל buffer, עושה `TextDecoder().decode()`, מפרסר את ה-Markdown, ומחזיר את האינדקס דרך `postMessage` חזרה.

ראיתי את זה כשבדקתי את `vendor/obsidian-mobile/worker.js` — הקוד שלו מקבל `e.data.metadataCache` כ-buffer ובכלל לא יודע מאיפה הקובץ הגיע. זו הסיבה שבמדידה ראיתי **88% cache hit rate** (322 hits מתוך 366 קריאות) ב-cold boot על כספת בדיקה (394 קבצים) — ה-main thread שקורא את הקבצים עבור ה-worker עובר דרך ה-shim שלנו ופוגע ב-cache.

#### מתי זה כן ייהפך לבעיה

הסיכון העתידי:

1. **plugin של מישהו** מחליט ליצור worker משלו ולעשות fetch מתוכו. נדיר אבל אפשרי — למשל plugin של search שרוצה לפרסר 1000 קבצים במקביל בלי לתפוס את ה-main thread.
2. **אובסידיאן עצמה משנה ארכיטקטורה** ומעבירה את קריאת הקבצים ל-worker. אם זה יקרה, כל ה-cache שלנו ב-mobile יהפוך לחסר ערך עד שנגיב.
3. **Service Workers** של LiveSync — אם LiveSync ירצה offline cache בעתיד, היא תרצה גישה לאותם נתונים.

#### פתרונות אפשריים אם זה ייהפך לבעיה

**אפשרות א' — Service Worker:** ליצור Service Worker שמיירט את כל בקשות ה-fetch ב-scope של ה-origin. הוא יושב בין הדפדפן לבין הרשת, ויכול לענות מ-IndexedDB cache. עובד גם ל-main thread, גם לכל Web Worker. החיסרון: setup מורכב, ה-cache חייב להיות ב-IndexedDB (לא in-memory בלבד), invalidation מסובכת.

**אפשרות ב' — `postMessage` לתקשורת עם הראשי:** לעדכן את ה-worker שייצור ל-main thread ב-`postMessage` כל פעם שהוא צריך קובץ. ה-main thread יענה דרך ה-cache. החיסרון: מצריך לעקוף את הקוד של אובסידיאן עצמה — לא שמיש בפועל.

לכן הושאר לעתיד — היום זה לא משפיע על ביצועים.

### Watch-event firehose ב-bulk operations {#mobile-bootstrap-cache-firehose}

#### הקונטקסט

ב-backend יש `chokidar` שצופה על תיקיית הכספת ב-filesystem. בכל שינוי (יצירה / שינוי / מחיקה), chokidar שולח event דרך WebSocket לקליינט. ה-shim שלנו מקבל את ה-event ועושה שני דברים:

1. מודיע ל-listeners של אובסידיאן (כדי שתרענן את ה-UI).
2. **חדש מהפלאן של 2026-05-12**: קורא ל-`invalidateCacheEntry(msg.path)` כדי שה-cache לא יחזיק תוכן ישן.

#### למה זה בדרך כלל בסדר

באופן רגיל זה עובד מעולה. עורך קובץ אחד → chokidar שולח event אחד → cache invalidation אחד → הקריאה הבאה לאותו path תיגש לשרת ותקבל את התוכן החדש. עלות זניחה.

#### למה זה הופך לבעיה — תרחיש LiveSync

LiveSync הוא plugin של אובסידיאן שמסנכרן את הכספת עם CouchDB ענן. כשמתחברים מ-device שני, LiveSync יכול לעשות **bulk-pull**: להוריד 1000 קבצים בבת אחת ולכתוב את כולם ל-disk תוך כמה שניות. מה שקורה אז:

1. LiveSync כותב 1000 קבצים → chokidar מזהה 1000 שינויים.
2. chokidar שולח **1000 events** ב-WebSocket תוך כמה שניות.
3. ה-shim שלנו קורא 1000 פעמים ל-`invalidateCacheEntry`.

#### החלק הזול לעומת היקר

עצם המחיקה של entry מ-`cache.fs` היא O(1) — `delete cache.fs[path]`. גם פר 1000 events זה זול, אולי 10ms בסך הכל.

הבעיה היא בשורה הזו ב-`invalidateCacheEntry` (`src/client-mobile/cache-invalidation.js`):

```js
const parent = p.includes('/') ? p.substring(0, p.lastIndexOf('/')) : '';
delete cache.dirs[parent];
```

כל קובץ שמתבטל מבטל גם את ה-listing של תיקיית-האב שלו. אם 1000 הקבצים נמצאים ב-50 תיקיות שונות, אנחנו מבטלים 50 entries של `cache.dirs`. עכשיו, בכל פעם שאובסידיאן תקרא `readdir` על אחת התיקיות האלה, ה-cache miss → תלך לשרת → round-trip. ב-50 תיקיות זה 50 קריאות `/api/fs/readdir` במקבץ. עוד 250ms של עיכוב.

זה לא קטסטרופלי, אבל מבזבז.

#### למה הושאר לעתיד

שני נימוקים:

1. **LiveSync עדיין לא הותקנה בפרויקט.** האינטגרציה שלה עדיין עתידית. עד שהיא תרוץ, אין firehose אמיתי. כשהיא תיכנס, נצבע נתונים אמיתיים על כמה תיקיות מתבטלות וכמה שניות זה מוסיף.

2. **הפתרון לא טריוויאלי וה-design choices לא ברורים מראש.** שלוש אפשרויות:

   **אפשרות א' — debounce:** לאסוף events במשך 100ms ואז לבטל פעם אחת ברצף. החיסרון: עיכוב נראה ל-UI (קובץ שמופיע ב-device אחר ייקח 100ms עד שיוצג אצלנו).

   **אפשרות ב' — חידוש חכם של ה-dir listing במקום מחיקה:** לעדכן את ה-entry של הקובץ בתוך `cache.dirs[parent]` (לשנות `size`+`mtime`), במקום למחוק את כל ה-listing. עובד יפה לשינוי קובץ קיים. נכשל ביצירה/מחיקה כי צריך להוסיף/למחוק entry ולא לדעת אם זה תיקייה או קובץ בלי קריאה לשרת.

   **אפשרות ג' — סימון stale עם חידוש עצל:** לסמן את ה-dir כ-"stale" במקום למחוק, ולחדש בעצלתיים בקריאה הבאה ל-`readdir`. החיסרון: עדיין round-trip — רק שהוא מתבזר על פני זמן ולא קורה בבת אחת.

   הבחירה תלויה במה שיתגלה כצוואר-בקבוק בפועל אחרי שה-LiveSync יתחיל לרוץ. עדיף למדוד לפני שמחליטים מאשר לבחור עכשיו ולשלם תחזוקה על פתרון שאולי לא צריך.

Pitfall #5 בתכנון ה-bootstrap cache מסמן את זה במפורש כ-"out of scope ל-v1; document".

---

## איך לעדכן את המסמך הזה

- **בעיה חדשה:** הוסף סעיף B-NNN חדש ב"בעיות פתוחות" עם התבנית: תאריך, סטטוס, חומרה, תסמינים, מה ידוע, השערות, בדיקות שצריכות להיעשות, workaround.
- **התקדמות בחקירה:** עדכן את הסעיף הקיים. עדכן את "מה ידוע" ו"השערות" כשמתבררים דברים.
- **בעיה נפתרה:** הזז את הסעיף ל"בעיות שנפתרו (ארכיון)", תקצר ל-3-5 שורות עם סיבה, תיקון, side effects.
- **דפוס שמופיע שוב:** הוסף ל"הערות כלליות על Obsidian internals" כדי שלא נחקור אותו שוב.
