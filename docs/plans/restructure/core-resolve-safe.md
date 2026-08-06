# Slice R1 — restructure/core-resolve-safe — ‏בריף

> **‏תאריך**: 2026-07-31
> **‏סוג מסמך**: ‏בריף ביצועי לסלייס
> **‏סטטוס**: **‏טיוטה — ‏טרם ‏אומתה**. ‏חסום ‏על Slice R0.
> **‏אימות אביגיל**: ‏לא ‏מאומת ‏בצורתו ‏הנוכחית.
> **Dispatch**: ‏אסור ‏עד ‏READY ‏**‏וגם** ‏עד ‏ש-Slice 0 ‏מוזג.
> **Complexity**: 7/10 (verifier: **heavy** — ‏ראה §8)
> **‏תלויות (`depends_on`)**: `[monorepo-foundation]`
> **‏Base**: `slice/monorepo-foundation` (‏או dev ‏אחרי ‏שמוזג)
> **‏Dev tip**: ‏ייקבע ‏בעת ‏ה-dispatch

---

> ## ‏מקור ‏הבריף ‏הזה — ‏קרא ‏לפני ‏הכל
>
> ‏ה-slice ‏הזה ‏פוצל ‏מ-`monorepo-foundation` ‏אחרי ‏**‏ארבעה ‏סבבי ‏אימות ‏של ‏אביגיל**
> ‏שבהם ‏איחוד `resolveSafe` ‏ייצר ‏רגרסיה ‏חדשה ‏בכל ‏סבב:
>
> | ‏סבב | ‏מה ‏נמצא | ‏דוח |
> |-----|---------|-----|
> | 1 | `'/'`/`'//'` ‏מהלקוח ‏היו ‏הופכים ‏מ-200 ‏ל-500; ‏מימוש ‏**‏רביעי** ‏ב-`electron.js`; grep ‏ירוק-כוזב ‏על NUL | `monorepo-foundation-avigail.md` |
> | 2 | `code` ‏זולג ‏לחוט (ENOENT→EESCAPE); `system-plugins.js` ‏פוספס | `…-round2.md` |
> | 3 | ‏מחרוזת ‏ה-`error` ‏נסחפת (`/../escape`→`../escape`) | `…-round3.md` |
> | 4 | ‏התיקון ‏הוחל ‏על `fs.js` ‏ולא ‏על `electron.js`, ‏שיש ‏לו ‏הודעה ‏אחרת ‏לגמרי | `…-round4.md` |
>
> **‏הדפוס ‏שאביגיל ‏ניסחה**: *"‏התיקון ‏סוגר ‏את ‏השדה ‏שנבדק ‏ומשאיר ‏את ‏השדה ‏שלידו."*
> ‏ארבע ‏פעמים ‏ברציפות. **‏כל ‏תיקון ‏בבריף ‏הזה ‏חייב ‏להיבדק ‏מול ‏כל ‏ארבעת ‏האתרים
> ‏ושתי ‏נקודות-הקצה — ‏לא ‏רק ‏מול ‏זה ‏שנקוב ‏בממצא.**
>
> ‏🔴 **‏הבריף ‏הזה ‏עדיין ‏לא ‏עבר ‏סבב ‏אימות ‏בצורתו ‏הנוכחית.** ‏הוא ‏נשמר ‏כדי ‏לא ‏לאבד
> ‏את ‏מה ‏שנלמד. ‏לפני ‏dispatch — ‏אביגיל, ‏עם ‏דגש ‏על ‏שתי ‏נקודות-הקצה ‏יחד.

---

## §0 — Pre-flight

### ‏תלויות

**Slice 0 (`monorepo-foundation`) ‏חייב ‏להיות ‏מוזג ‏קודם.** ‏ממנו ‏מגיעים:
`packages/core` ‏עם ‏ה-tsconfigs ‏המקובעים, ‏סקריפט-הגבול, ‏ו-**`core/fs/to-relative.ts`
‏על 7 ‏טסטיה** — ‏שכאן ‏רק ‏מחווטת, ‏לא ‏נכתבת ‏מחדש.

### Reading list

**must-read** — ‏**‏ארבעה** ‏מימושים, ‏**‏שתי** ‏נקודות-קצה:
- `src/sync-server/resolve-safe.js` — ‏כולו (28 ‏שורות)
- `src/runtime-server/server/api/fs.js` — anchor: `function resolveSafe(req, relPath)`
- `src/runtime-server/server/system-plugins.js` — anchors: `function tryGetSystemFilePath`, `startsWith(prefix)`
- `src/runtime-server/server/api/electron.js` — anchor: `path escapes vault`
  ‏(⚠️ ‏העוגן ‏תופס 3 ‏קבצים; ‏מכוון ‏לזה)
- `src/client-mobile/shims/capacitor-shim.js` — anchors: `function fullPath`, `capError(`
- ‏ארבעת ‏דוחות ‏אביגיל ‏ב-`reports/obsidian-web/monorepo-foundation-avigail*.md`

> 🔴 ‏כל ‏העוגנים ‏הם `grep`, ‏לא ‏מספרי-שורות.
> 🔴 ‏כל grep ‏על `src/sync-server/` ‏חייב `-a` — `manifest.js` ‏מכיל 2 ‏בתי NUL
> ‏ולכן grep ‏רגיל ‏מסווג ‏אותו ‏כבינארי ‏ומחזיר ‏**‏ירוק ‏כוזב**.

### ‏מקורות ‏חיצוניים — ‏מסקנות ‏מחייבות ‏שנמדדו

| ‏טענה | ‏נמדד |
|------|------|
| `toRelative`+`resolveSafe` ≡ `path.resolve(root,'.'+sep+rel)` | ✅ **0 ‏פיצולים ‏ב-47 ‏קלטים** |
| `instanceof PathEscapeError` ‏בתוך catch ‏של ‏צרכן CJS, ‏חוצה ‏סימלינק bun | ✅ ‏עובד ‏ב-node ‏וב-bun |
| `handleError` ‏עושה `err.code \|\| null` ‏בלי ‏הסתעפות ‏לפי ‏מחלקה | ✅ `TypeError` ‏ו-`Error` → ‏אותו 500 ‏ואותו `code:null` |
| ‏אין ‏אתר ‏שלישי ‏ב-`fs.js` ‏שבו `PathEscapeError` ‏עוקפת ‏את ‏המתאם | ✅ |

---

## §1 — ‏מטרה

`resolveSafe` — ‏שומר ‏ה-path-traversal — ‏קיים ‏היום ‏ב**‏ארבעה** ‏מימושים ‏נפרדים
‏ולא-זהים ‏בשתי ‏חבילות. ‏אחרי ‏ה-slice ‏יש ‏**‏אחד**, ‏ב-`@ow/core`, ‏עם ‏טסטים.

`sync-server/resolve-safe.js` ‏מתעד ‏בעצמו ‏למה ‏זה ‏קרה:
*"Re-implemented here rather than imported from runtime-server/api/fs.js — that
resolveSafe is **coupled to `req`**"*. ‏זו ‏הפתולוגיה: ‏הלוגיקה ‏לא ‏הייתה ‏ניתנת
‏לשיתוף ‏כי ‏רותכה ‏ל-Express.

**‏מנקודת-מבט ‏המשתמש: ‏אפס ‏שינוי ‏התנהגות — ‏כולל ‏גוף ‏השגיאה ‏על ‏שתי ‏נקודות-הקצה.**
‏זו ‏דרישה ‏מחייבת. ‏ארבעה ‏סבבי ‏אימות ‏מצאו ‏כאן ‏רגרסיות ‏שקטות ‏שאף ‏טסט ‏קיים ‏לא ‏תפס.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא |
|------|------|
| `core/fs/resolve-safe.ts` + `PathEscapeError` + 14 ‏טסטים | ✅ |
| ‏שער-רגרסיה ‏לצורת-החוט — **‏לפני ‏החיווט** | ✅ |
| ‏חיווט 4 ‏אתרים: `sync-server`, `api/fs.js`, `system-plugins.js`, `api/electron.js` | ✅ |
| ‏מחיקת `src/sync-server/resolve-safe.js` | ✅ |
| ‏כתיבת `toRelative` ‏מחדש | ❌ — ‏מגיעה ‏מ-Slice 0 |
| ‏העברת ‏חבילות ‏ל-`packages/` | ❌ |

---

## §3 — ‏ארבעת ‏האתרים — ‏טבלת ‏ההבדלים ‏הנמדדת

**‏זו ‏הטבלה ‏החשובה ‏ביותר ‏בבריף.** ‏כל ‏שורה ‏נמדדה. ‏אתר ‏שמטופל ‏"‏כמו ‏השני" ‏נשבר.

| | `sync-server` | `api/fs.js` | `system-plugins.js` | `api/electron.js` |
|---|---|---|---|---|
| ‏prefix `'.'+sep` | ❌ ‏אין | ✅ ‏יש | ✅ ‏יש | ✅ ‏יש |
| ‏קלט ‏מוחלט ‏היום | **‏זורק** | ‏משכתב | ‏משכתב | ‏משכתב |
| ‏קלט ‏לא-מחרוזתי | ‏זורק | ‏זורק `path must be a string` | — | **‏ממיר ‏במרומז ‏ופותר** |
| ‏הודעה | `path escapes vault root: <rel>` | `path escapes vault root: <rel>` | — (‏מחזיר null) | **`path escapes vault`** |
| `code` ‏על ‏החוט | `EESCAPE` | **`null`** | — | ‏אין `code` ‏בגוף |
| ‏חוזה ‏כשל | throw | throw | **`null`** | throw |
| ‏על ‏מה ‏מחילים `toRelative` | ‏לא ‏מחילים | `relPath` | **‏על ‏הזנב ‏בלבד** | `String(rel)` |

> 🔴 **`system-plugins.js` — ‏על ‏הזנב, ‏לא ‏על ‏הכניסה.** ‏החלה ‏על `relPath` ‏בכניסה
> ‏הופכת ‏את ‏בדיקת ‏הקידומת: `'/.obsidian/plugins/x/main.js'.startsWith('.obsidian/plugins/')`
> ‏הוא `false` ‏היום ‏ו-`true` ‏אחרי → ‏בקשה ‏עם ‏סלאש ‏מוביל ‏עוברת ‏מ-404 ‏ל-overlay hit.
>
> 🔴 **‏האיסור ‏על `String()` ‏הוא ‏ספציפי ‏ל-`api/fs.js`** (‏שם ‏יש ‏בדיקת typeof ‏מפורשת
> ‏היום, ‏ו-`String(null)`→`''` ‏היה ‏ממפה ‏מחיקה ‏ל**‏שורש ‏הכספת**). ‏ב-`electron.js`
> ‏ההמרה ‏היא ‏דווקא ‏מה ‏שמשמר ‏את ‏ההתנהגות.

---

## §4 — Commits ‏בסדר

### Commit 0 — ‏שער-רגרסיה, **‏לפני ‏כל ‏חיווט** (approach: integration)

> 🔴 ‏מיקום ‏מכוון. ‏שער ‏שנכתב ‏אחרי ‏השינוי ‏לא ‏מוכיח ‏דבר. ‏**‏חייב ‏לעבור ‏על ‏הקוד
> ‏הלא-משונה ‏ואז ‏להישאר ‏ירוק ‏עד ‏הסוף.**

‏תקדים ‏להרמת ‏שרת ‏בטסט: `test/vaults-api.test.js` (anchor: `createApp`).
`createFsRouter(registry, vaultRoot)` ‏עולה ‏עם stub ‏של `{get, list}` ‏בלבד (‏אומת).

**‏ראוטר ‏`fs` — 7 ‏שורות:**

| ‏קריאה | `path=` | ‏סטטוס | **‏גוף** |
|-------|--------|-------|--------|
| `stat` | `/` | 200 | — |
| `stat` | `//` | 200 | — |
| `stat` | (‏ריק) | 200 | — |
| `readdir` | `/` | 200 | — |
| `stat` | `../escape` | 500 | `{"error":"path escapes vault root: ../escape","code":null}` |
| `stat` | `/../escape` | 500 | 🔴 `"…root: /../escape"` — ‏הנתיב ‏**‏המקורי** |
| `stat` | `?path=a&path=b` | 500 | 🔴 `{"error":"path must be a string","code":null}` |
| `stat` | `/etc/passwd` | 404 | `ENOENT … <vault>/etc/passwd` |

**‏נקודת-הקצה ‏השנייה — 2 ‏שורות:**

| ‏קריאה | ‏גוף | ‏סטטוס | **‏גוף ‏צפוי** |
|-------|-----|-------|--------------|
| `POST /api/electron/trash` | `{path:'../escape'}` | 500 | 🔴 `{"error":"path escapes vault"}` — ‏**‏בלי** `root`, ‏**‏בלי** ‏נתיב |
| `POST /api/electron/trash` | `{path: 123}` | ‏כמו ‏היום | 🔴 ‏פותר ‏יחסית-לכספת, **‏לא** ‏שגיאת-טיפוס |

> ‏הטסט ‏הקיים (anchor: `trash endpoint rejects path that escapes vault root`) ‏בודק
> **‏סטטוס ‏בלבד** — ‏ולכן ‏לא ‏תפס ‏את ‏הסחיפה ‏בסבב 4.

---

### Commit 1 — `resolveSafe` ‏ב-core (approach: **tdd**)

```ts
export class PathEscapeError extends Error {
  readonly code = 'EESCAPE';
  /** ‏הודעה: `path escapes vault root: ${relPath}` */
  constructor(relPath: string);
}
export function resolveSafe(root: string, rel: string): string;
```

| # | ‏קלט | ‏צפוי | | # | ‏קלט | ‏צפוי |
|---|-----|------|---|---|-----|------|
| 1 | `('/vault','note.md')` | `/vault/note.md` | | 8 | `('/vault','a/../../escape')` | ‏זורק |
| 2 | `('/vault','')` | `/vault` | | 9 | `('/vault', null)` | `TypeError` |
| 3 | `('/vault','a/b/c.md')` | `/vault/a/b/c.md` | | 10 | `('/vault','vault-sibling')` | `/vault/vault-sibling` |
| 4 | `('/vault','../escape')` | ‏זורק | | 11 | `('/v','.')` | `/v` |
| 5 | `('/vault','../../etc/passwd')` | ‏זורק | | 12 | ‏רווחים/יוניקוד | ‏תקין |
| 6 | `('/vault','/etc/passwd')` | ‏זורק | | 13 | `('/vault','..')` | ‏זורק |
| 7 | `('/vault','a/../b.md')` | `/vault/b.md` | | 14 | ‏הודעת 4 | `'path escapes vault root: ../escape'` ‏בדיוק |

> ‏טסט 10 ‏מגן ‏על ‏ה-`+ path.sep` ‏ב-`startsWith` (‏בלעדיו `/vault` ‏מתיר `/vault-evil`).
> ‏טסט 13 ‏הוא ‏הקלט ‏שהטסט ‏שנמחק ‏מ-`manifest.test.js` ‏בדק ‏ולא ‏מכוסה ‏ע"י 4/5/6/8.
> ‏טסט 14 ‏הופך ‏את ‏ההודעה ‏לניתנת-לגילוי (‏אחרת ‏היא ‏מקודדת ‏פעמיים ‏בלי ‏שער).

---

### Commit 2 — `sync-server` (approach: integration)

`blob.js` ‏ו-**`manifest.js`** (‏**‏כן** ‏מייבא, anchor: `require('./resolve-safe')`).
‏צורת ‏הייבוא ‏משתנה: `const { resolveSafe } = require('@ow/core/fs')` — ‏named, ‏לא default.
‏הכיסוי ‏ב-`manifest.test.js` (anchor: `blocks path traversal`) ‏מוסר — ‏מוחלף ‏בטסטים 3/5/13.

**DELETE**: `src/sync-server/resolve-safe.js` (anchor: `module.exports = resolveSafe`)
— ‏רק ‏אחרי ‏ששני ‏הייבואים ‏והטסט ‏טופלו.

**Verification**: `bun test` ; `grep -ran "resolve-safe" src/sync-server/` → ‏אפס

---

### Commit 3 — `runtime-server`, ‏שלושת ‏האתרים (approach: integration)

**(‏א) `api/fs.js`** — anchor: `function resolveSafe(req, relPath)`

```js
function resolveSafe(req, relPath) {
  const rel = toRelative(relPath);           // ‏לפני getVaultRoot — ‏משמר ‏סדר ‏הערכה
  try {
    return coreResolveSafe(getVaultRoot(req), rel);
  } catch (e) {
    // ‏משמר ‏את ‏החוט ‏בשני ‏שדותיו: ‏בלי code, ‏ועם relPath ‏**‏המקורי**
    if (e instanceof PathEscapeError) throw new Error('path escapes vault root: ' + relPath);
    throw e;
  }
}
```
‏11 ‏אתרי-הקריאה ‏ל-`resolveSafe(req,…)` ‏לא ‏משתנים.

**(‏ב) `system-plugins.js`** — `coreResolveSafe(pluginRoot, toRelative(parts.slice(1).join('/')))`
‏בתוך `try/catch → null`. **‏על ‏הזנב, ‏אחרי ‏בדיקת ‏הקידומת** (§3).

**(‏ג) `api/electron.js`** — ‏מתאם ‏משלו: `toRelative(String(rel))`, ‏ובקאץ'
`throw new Error('path escapes vault')` — **‏ההודעה ‏שלו, ‏לא ‏של `fs.js`**.

**Verification**: `node --test` (‏כולל ‏שער Commit 0 — ‏עדיין ‏ירוק) ; `bun run test`

---

### Commit 4 — ‏תיעוד (approach: none)

`docs/walkthrough.md`; `docs/decisions/obsidian-web.md` — **‏מרדכי ‏כותב**.

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | 14 ‏טסטי core ‏נספרים | ‏פלט ‏מראה ‏את ‏המספר |
| 2 | **‏צורת-החוט ‏שלמה ‏בשתי ‏נקודות-הקצה** | ‏שער Commit 0 ‏ירוק — ‏**‏כל 10 ‏השורות** |
| 3 | ‏אפס ‏שומרים ‏מוטמעים | `grep -ran "startsWith(.*path\.sep" src/ \| grep -v "/test/"` → ‏אפס |
| 4 | ‏קובץ ‏נמחק | `test ! -f src/sync-server/resolve-safe.js` |
| 5 | ‏אפס ‏ייבואים | `grep -ran "resolve-safe" src/` → ‏אפס (**`-a`**) |
| 6 | ‏נפתר ‏מ-node ‏ומ-bun | `node --test` / `bun test` ‏בחבילות |
| 7 | ‏שרת ‏עולה | `node index.js` |
| 8 | ‏בניית CF | `npm run build` |

> **DoD#3 ‏מעוגן ‏בתבנית-השומר** ‏ולא ‏בהודעת-שגיאה: ‏הנוסח ‏הקודם
> (`grep "escapes vault root"`) ‏פספס ‏את `electron.js` (‏שאומר `path escapes vault`)
> ‏ותפס ‏קבצי-טסט.

---

## §6 — Risks

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| ‏תיקון ‏מוחל ‏על ‏אתר ‏אחד ‏ולא ‏על ‏האחרים | **‏הדפוס, 4 ‏סבבים** | ‏טבלת §3 + ‏שער ‏על ‏שתי ‏נקודות-קצה |
| `code`/`error` ‏זולגים | ‏סבבים 2-3 | ‏המתאם ‏מפשיט ‏ובונה ‏מחדש + 3 ‏שורות ‏שער |
| `toRelative` ‏על ‏הכניסה ‏ב-system-plugins | ‏סבב 4 | §3 + Commit 3ב |
| grep ‏ירוק ‏כוזב (NUL) | ‏סבב 1 | `-a` ‏בכל ‏מקום |
| ‏מימוש ‏חמישי | ‏סבב 1 ‏גילה ‏רביעי | DoD#3 ‏מעוגן ‏בתבנית |

---

## §7 — Escalation

- ‏טסט **‏קיים** ‏משנה ‏התנהגות — ‏**‏אל ‏תתקן ‏את ‏הטסט**
- ‏שער Commit 0 ‏לא ‏עובר ‏על ‏הקוד ‏הלא-משונה
- ‏נמצא ‏מימוש ‏**‏חמישי**
- ‏רצון ‏לטפל ‏בשני ‏אתרים ‏"‏באותו ‏מתאם" — ‏ראה §3

---

## §8 — Complexity

‏קוד-אבטחה +2 · 4 ‏מימושים ‏ו-11 ‏אתרי-קריאה +2 · ‏שינוי ‏חוט ‏בשתי ‏נקודות-קצה +2 ·
Refactor +1 · ‏ארבע ‏רגרסיות ‏שהתגלו ‏באימות +2 · Pure logic ‏ב-core −2 ·
TDD −1 · ‏הכל ‏נמדד ‏מראש −1

**Score: 7/10** → `calev-heavy`? ‏**‏לא** — 7 ‏הוא ‏עדיין ‏light+phase. ‏אבל ‏בהינתן
‏ארבע ‏הרגרסיות ‏השקטות, **‏מרדכי ‏קובע `calev-heavy`** ‏בכל ‏זאת: ‏אלה ‏באגים ‏שאינם
‏מפילים ‏טסט, ‏וזה ‏בדיוק ‏הפרופיל ‏של ‏ה-tier ‏הכבד.

---

## ‏סטיות ‏מהתכנון

- ...
