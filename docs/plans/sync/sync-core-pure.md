# sync-core-pure — ‏בריף (‏קו-הסנכרון, S1)

> **‏תאריך**: 2026-07-31 · **‏גרסה 4** (‏אחרי 3 ‏סבבי אביגיל: 20 → 11 → 12 ‏ממצאים)
> **‏סוג מסמך**: ‏בריף ביצועי לסלייס
> **‏סטטוס**: ‏טיוטה
> **‏אימות אביגיל**: ‏סבב 3 — USABLE-AFTER-FIX. ‏גרסה זו ממתינה לסבב 4.
> **Dispatch**: ‏מותר לאליעזר רק אם `אימות אביגיל = READY`
> **Complexity**: 4/10 (verifier: light)
> **‏תלויות (`depends_on`)**: `["monorepo-foundation"]`
> **‏Base**: `slice/monorepo-foundation`
> **‏Dev tip**: `6422b32`

> ## ‏שינויים מגרסה 3
>
> ‏שלושה סבבים הראו ש**‏משפחת-הכשלים החוזרת היא בלוק פקודות ה-DoD** — ‏הברחת `|`
> ‏בטבלה, `cd` ‏שנוחת בתיקייה הלא-נכונה, ‏ו-grep ‏שמחזיר ריק על תיקייה חסרה.
> ‏במקום תיקון רביעי, ‏ה-DoD **‏חולץ לסקריפט בר-הרצה**: `sync-core-pure-dod.sh`.
> ‏הוא הורץ בפועל ‏ונכשל ב-14 ‏בדיקות ‏מהסיבה הנכונה (R0 ‏טרם בוצע), ‏עם קוד-יציאה 14.

---

## §0 — Pre-flight

### ‏יחס לסלייסים האחרים

| ‏בריף | ‏יחס אלינו |
|------|----------|
| `docs/plans/restructure/monorepo-foundation.md` (**R0**) | **‏תלות אמיתית** — ‏יוצר את `packages/core` |
| `docs/plans/restructure/core-resolve-safe.md` (**R1**) | **‏אח מקביל, ‏לא תלות.** ‏איננו משתמשים ב-`resolveSafe` |

‏שני הבריפים האלה **‏אינם שלנו** — ‏סוכן אחר מתחזק אותם. **‏אין לערוך אותם.**
‏הבריפים של קו-הסנכרון חיים ב-`docs/plans/sync/` ‏ונושאים קידומת **S**.
‏**‏אין מספור גלובלי משותף** ‏בין שני הקווים — ‏זו הייתה התנגשות בסבבים 1-2.

> 🔴 **‏לפני חיתוך ה-worktree**: ‏שלושת הבריפים היו **untracked** ‏ב-dev. ‏worktree
> ‏שנחתך מ-`slice/monorepo-foundation` ‏**‏לא יכיל אף אחד מהם**. ‏מרדכי מקבע את הבריף
> ‏הזה ל-dev ‏אחרי READY; ‏אליעזר: ‏אם `docs/plans/sync/sync-core-pure.md` ‏אינו קיים
> ‏ב-worktree — ‏עצור (§7).

### 🔴 ‏שער pre-flight — ‏בדוק **‏קבצים**, ‏לא ‏שם-branch

‏גרסה 1 ‏בדקה רק ש-`packages/core/package.json` ‏קיים — ‏שער חלש מדי, ‏שהיה עובר
‏בהצלחה בזמן שהתלות כבר השתנתה. ‏הרץ **‏את כל אלה** ‏לפני ה-commit הראשון;
‏כל כישלון = ‏עצירה (§7):

```bash
test -f packages/core/package.json
test -f packages/core/tsconfig.json
test -f packages/core/fs/to-relative.ts     # ‏תבנית-הסגנון שאנחנו מחקים
test -f packages/core/fs/index.ts           # ‏תבנית ה-re-export
node -e "const d=require('./packages/core/package.json').dependencies||{};process.exit(Object.keys(d).length)"
```

> ‏אם אחד מאלה נכשל — ‏**‏התלות אינה במצב שה-brief מניח**. ‏עצור ‏ודווח למרדכי.

### Worktree

```bash
cd /home/user/Projects/obsidian-web
git worktree add /home/user/Projects/obsidian-web/worktrees/sync-core-pure \
    -b slice/sync-core-pure slice/monorepo-foundation
cd /home/user/Projects/obsidian-web/worktrees/sync-core-pure
ln -s ../../dev/vendor vendor      # ‏קונבנציית הריפו — `vendor` ‏אינו ב-git
bun install
```

‏⚠️ ‏ריפו עם bare repo — ‏**‏נתיבים מוחלטים חובה** ‏ב-`git worktree add`.
‏⚠️ ‏אם `slice/monorepo-foundation` ‏אינו קיים — R0 ‏טרם בוצע. ‏**‏אין dispatch.**

### ‏שלושת אילוצי-הפלטפורמה (‏ירושה מ-R0 — ‏**‏חלים גם עלינו**)

1. ‏**‏אין** `enum` / `namespace` / decorators (type-stripping ‏מסיר, ‏לא מקמפל).
2. ‏**‏אין top-level await.**
3. ‏**‏ייבוא יחסי חייב סיומת `.ts` ‏מפורשת** — `'./x'` ‏ו-`'./x.js'` ‏שניהם נכשלים.

### ‏איך להריץ

| ‏מה | ‏פקודה |
|----|-------|
| ‏טסטי המודול | `cd packages/core && node --test "sync/*.test.ts"` |
| ‏רק החבילה שלנו | `bun run --filter '@ow/core' test` (‏מהשורש) |
| typecheck | `bun run typecheck` |

**‏אין שרת, ‏אין דפדפן, ‏אין רשת.** ‏זו כל הנקודה.

### Reading list

**must-read**:
- `packages/core/fs/to-relative.ts` + `fs/to-relative.test.ts` (‏מ-R0) —
  **‏תבנית-הסגנון**: ‏חתימה, ‏שגיאה ייעודית, ‏מבנה טסטים, ‏סיומות `.ts` ‏בייבוא.
- `packages/core/fs/index.ts` — ‏תבנית ה-re-export ‏שנחקה ב-`sync/index.ts`.
- `packages/core/tsconfig.json` — ‏שים לב ל-`include` (‏ראה Commit 6).
- `scripts/check-core-boundary.mjs` (‏נוצר ב-R0) — **‏השומר שמכשיל ייבוא חיצוני**.
  ‏הוא זה שאוכף את "‏אפס תלויות"; ‏קרא אותו לפני שאתה כותב import ‏כלשהו.
- `docs/decisions/obsidian-web.md`, ‏רשומת **2026-07-31** — ‏הרקע הארכיטקטוני.

> ‏`packages/core/README.md` ‏**‏אינו נוצר** ‏ב-R0. ‏אל תניח שהוא קיים ‏ואל תיצור אותו.

**reference** (‏הקשר בלבד — **‏אין לגעת**): `src/client-mobile/sync/decide-pull.js`,
`src/sync-server/manifest.js` — ‏מנוע ה-pull ‏הישן (legacy).

---

## §1 — ‏מטרה

‏אחרי ה-slice הזה יש ב-`packages/core/sync/` **‏חמישה מודולים טהורים** ‏שכל מנוע-סנכרון
‏עתידי נשען עליהם — ‏כל אחד קלט→פלט, ‏בלי state, ‏בלי IO, ‏**‏בלי שעון**. ‏כולם נבדקים
‏ב-`node --test` ‏בלי רשת, ‏בלי דפדפן ‏ובלי Drive.

‏מנקודת-מבט המשתמש: **‏שום דבר לא משתנה עדיין.** ‏זה המצע ש-slices ‏הבאים (Automerge,
‏מתאם-Drive) ‏יעמדו עליו — ‏ואותו מצע בדיוק ישרת גם את obsidian-web ‏וגם פלאגין-דסקטופ.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| `sync/names.ts` — ‏נרמול + ‏התנגשות **‏פר-תיקייה** | ✅ | ‏כאן |
| `sync/storage-key.ts` — ‏קידוד `string[]` ↔ ‏שם-קובץ בטוח | ✅ | ‏כאן |
| `sync/sync-plan.ts` — ‏מה למשוך / ‏מה להעלות | ✅ | ‏כאן |
| `sync/retention.ts` — ‏מדיניות-שימור מדורגת | ✅ | ‏כאן |
| `sync/vault-link.ts` — ‏קידוד/פענוח מתאר-כספת | ✅ | ‏כאן |
| `sync/index.ts` + `exports` + **‏הרחבת `tsconfig.include`** | ✅ | ‏כאן |
| **Automerge** (‏כל תלות, ‏כל import) | ❌ | slice ‏הבא |
| **StorageAdapter / OAuth / fetch / Drive** | ❌ | slice ‏הבא |
| **‏שינוי כלשהו ב-`src/`** | ❌ | ‏מפורשות out of scope |
| **‏עריכת `monorepo-foundation.md` / `core-resolve-safe.md`** | ❌ | ‏של סוכן אחר |
| **`packages/core/README.md`** | ❌ | ‏לא קיים, ‏ולא ניצור |

---

## §3 — Architecture diagram

```
packages/core/                     ← ‏מ-R0
  package.json                     ← ‏מרחיבים רק exports + test
  tsconfig.json                    ← ‏מרחיבים רק include
  fs/to-relative.ts                ← ‏תבנית-סגנון (‏לא נוגעים)
  fs/index.ts
  sync/                            ← ‏**‏כל התיקייה חדשה**
    names.ts          ‏נרמול NFC + ‏קיפול + ‏התנגשות פר-תיקייה
    storage-key.ts    string[] ↔ ‏שם-קובץ (‏הפיך, ‏בלי '/', ‏חסין-רישיות)
    sync-plan.ts      (local, remote) → {fetch[], upload[]}
    retention.ts      (chunks, policy, nowMs, selfDeviceId) → {keep[], drop[]}
    vault-link.ts     {folderId,key} ↔ fragment
    index.ts          re-export
    *.test.ts
```

**‏חוזה**: ‏אפס תלויות · ‏אפס DOM · ‏אפס `node:*` **‏בקוד המקור** (‏בטסטים `node:test`
‏מותר ‏ונדרש) · **‏אפס `Buffer`** (‏גלובל של node — ‏שובר את יעד-הדפדפן ‏ב-§1, ‏ו**‏עובר**
‏גם typecheck ‏וגם שומר-הגבולות) · ‏אפס מקורות-זמן/אקראיות: `Date.now`, `new Date`,
`performance.now`, `Math.random`, `crypto.getRandomValues` — ‏**‏נכנסים כפרמטר** ·
‏אפס `enum`/`namespace`/decorators · ‏אפס top-level await · ‏ייבוא יחסי עם `.ts`.

> **‏הפרימיטיב המחייב ל-UTF-8**: `TextEncoder` / `TextDecoder` — ‏גלובלים ‏גם בדפדפן
> ‏וגם ב-node (‏אומת), ‏ואינם דורשים `import`. **`Buffer` ‏פסול.**

---

## §4 — Commits ‏בסדר

### Commit 1 — `names.ts` (approach: **tdd**)

```ts
/** NFC ‏בלבד. ‏לא משנה רישיות. ‏זורק TypeError ‏אם אינו string. */
export function normalizeName(name: string): string;

/** ‏מפתח-השוואה: NFC + `toLowerCase()`. ‏זורק TypeError ‏אם אינו string. */
export function foldName(name: string): string;

export type NameCollision = {
  readonly dir: string;      // ‏תיקיית-האב המשותפת ('' ‏לשורש)
  readonly folded: string;   // ‏שם-הבסיס אחרי foldName
  readonly paths: readonly string[];
};

/**
 * ‏מזהה שמות מתנגשים **‏בתוך אותה תיקיית-אב בלבד**.
 * ‏שני נתיבים מתנגשים ⇔ ‏אותה תיקיית-אב **‏וגם** ‏אותו `foldName(basename)`,
 * ‏אך ‏שם-בסיס גולמי שונה (‏רישיות ‏או ‏ייצוג-יוניקוד).
 * ‏נתיבים בתיקיות שונות **‏לעולם לא** ‏מתנגשים.
 * ‏מיון דטרמיניסטי: ‏לפי `dir` ‏ואז `folded`; ‏בתוך קבוצה — `paths` ‏ממוין.
 */
export function findNameCollisions(paths: readonly string[]): readonly NameCollision[];
```

**‏טסטים חובה (12)**:

| # | ‏קלט | ‏צפוי |
|---|-----|------|
| 1 | `foldName('Note.md')` ‏מול `foldName('note.md')` | ‏שווים |
| 2 | `normalizeName` ‏על NFD ‏מול NFC | ‏שווים |
| 3 | ‏עברית עם ניקוד, NFD ‏מול NFC | `foldName` ‏שווה |
| 4 | `['a/Note.md','a/note.md']` | ‏קבוצה אחת, `dir==='a'`, 2 ‏נתיבים |
| 5 | 🔴 `['a/Note.md','b/note.md']` | **‏מערך ריק** — ‏תיקיות שונות |
| 6 | ‏רשימה בלי התנגשויות | ‏מערך ריק |
| 7 | 3 ‏נתיבים באותה תיקייה+folded | ‏קבוצה אחת עם 3 |
| 8 | ‏שתי קבוצות בתיקיות שונות עם **‏אותו** `folded` | **2 ‏קבוצות נפרדות** (‏זה מה ש-`dir` ‏פותר) |
| 9 | ‏סדר-קלט הפוך | **‏אותו פלט בדיוק**, ‏כולל סדר `paths` |
| 10 | `foldName(null as any)` ‏ו-`normalizeName(42 as any)` | ‏שניהם ‏זורקים `TypeError` |
| 11 | ‏שני נתיבים **‏בשורש** (`['Note.md','note.md']`) | ‏קבוצה אחת עם `dir === ''` |
| 12 | ‏נתיב מקונן (`['a/b/c/Note.md','a/b/c/note.md']`) | ‏קבוצה אחת, `dir === 'a/b/c'` |

> ‏מחרוזת ריקה ‏היא **‏קלט חוקי** ‏ל-`normalizeName`/`foldName` (‏מחזירה `''`).
> ‏רק לא-מחרוזת ‏זורקת. (‏גרסה 1 ‏סתרה את עצמה כאן.)

---

### Commit 2 — `storage-key.ts` (approach: **tdd**)

`automerge-repo` ‏מזהה נתחים ב-`string[]`; Drive ‏מאחסן **‏שמות שטוחים**. ‏צריך קידוד הפיך.

**‏הסכימה מקובעת** (‏אליעזר: ‏אל תמציא אחרת):
```
encodeStorageKey(key) = key.map(seg => '_' + hexUtf8Lower(seg)).join('')
```
> 🔴 **‏המרת UTF-8 ‏חייבת להיעשות ב-`TextEncoder`/`TextDecoder`** (‏גלובלים בשתי
> ‏הסביבות). **`Buffer` ‏פסול** — ‏הוא ‏עובר typecheck ‏ואת שומר-הגבולות, ‏ושובר את
> ‏יעד-הדפדפן ‏בשקט.

- `['']` → `'_'` · `['a']` → `'_61'` · `['a','']` → `'_61_'`
- **‏מערך ריק ‏אינו מפתח חוקי** — `encodeStorageKey([])` ‏זורק (‏מחרוזת ריקה אינה שם-קובץ)
- ‏ובהתאמה **`decodeStorageKey('')` ‏זורק ‏גם הוא** — ‏אין מפתח שמייצג את המחרוזת הריקה
- hex ‏**‏אותיות קטנות בלבד** ⇒ ‏חסין-רישיות · ‏תווי-hex ‏לעולם אינם `_` ⇒ ‏פיצול חד-משמעי
- ‏אין `/`, ‏אין `#`, ‏אין תלות-locale

```ts
export class StorageKeyError extends Error { readonly code = 'EKEY'; }
export const MAX_ENCODED_LENGTH = 255;   // ‏תקרת שם-קובץ ב-Drive

export function encodeStorageKey(key: readonly string[]): string;   // ‏זורק ‏אם > MAX
export function decodeStorageKey(name: string): readonly string[];  // ‏זורק StorageKeyError
```

**‏טסטים חובה (12)** — round-trip ‏על: (1) ‏מפתח רגיל · (2) ‏מפתח בן 3 ‏מקטעים ·
(3) **‏מקטע ריק** · (4) ‏מקטע עם `/` · (5) `.` ‏ו-`..` · (6) ‏עברית/יוניקוד ·
(7) ‏מקטע יחיד. ‏ובנוסף:

| # | ‏דרישה | ‏צפוי |
|---|------|------|
| 8 | 🔴 `encodeStorageKey([])` | ‏זורק `StorageKeyError`; ‏ו-`encodeStorageKey([''])` === `'_'` |
| 9 | ‏הפלט ‏לעולם לא מכיל `/` ‏או `#` | ‏אמת לכל הקלטים |
| 10 | 🔴 ‏שני מפתחות שנבדלים **‏רק ברישיות** | ‏שמות שנבדלים **‏גם אחרי `foldName`** |
| 11 | `decodeStorageKey('zz')` ‏ו-`decodeStorageKey('_6')` | ‏שניהם ‏זורקים `StorageKeyError` |
| 12 | ‏מפתח שחורג מ-`MAX_ENCODED_LENGTH` | `encodeStorageKey` ‏זורק `StorageKeyError` |

---

### Commit 3 — `sync-plan.ts` (approach: **tdd**)

```ts
export type RemoteChunk = { readonly name: string; readonly size: number };
export type SyncPlan = { readonly fetch: readonly string[]; readonly upload: readonly string[] };

/** ‏הפרש-קבוצות טהור על **‏שמות מקודדים** (Commit 2). ‏שתי הרשימות ‏ממוינות. */
export function planChunkSync(
  localNames: readonly string[],
  remote: readonly RemoteChunk[],
): SyncPlan;
```

**‏טסטים חובה (8)**: ‏שניהם ריקים · ‏רק מרוחק → `fetch` ‏מלא · ‏רק מקומי → `upload` ‏מלא ·
‏חפיפה מלאה → ‏שניהם ריקים · ‏חפיפה חלקית · ‏כפילויות בקלט → ‏פעם אחת בפלט ·
‏סדר-קלט הפוך → ‏אותו פלט · `size` ‏אינו משפיע על ההחלטה.

---

### Commit 4 — `retention.ts` (approach: **tdd**)

```ts
export type ChunkInfo = {
  readonly name: string;
  readonly kind: 'snapshot' | 'incremental';
  readonly deviceId: string;
  readonly createdMs: number;
};
export type RetentionPolicy = { readonly keepAllMs: number; readonly keepSnapshotsMs: number };
export type RetentionPlan = { readonly keep: readonly string[]; readonly drop: readonly string[] };

/** `nowMs` ‏הוא **‏פרמטר** — ‏הפונקציה טהורה. */
export function planRetention(
  chunks: readonly ChunkInfo[],
  policy: RetentionPolicy,
  nowMs: number,
  selfDeviceId: string,
): RetentionPlan;
```

**🔴 ‏ארבעה אינווריאנטים — ‏הליבה, ‏לא קישוט**:
1. ‏נתח של `deviceId !== selfDeviceId` — ‏**‏לעולם** ‏ב-`keep`.
2. ה-snapshot ‏העדכני ביותר **‏של `selfDeviceId`** — ‏**‏לעולם** ‏ב-`keep`.
3. ‏אם ‏ל-`selfDeviceId` ‏**‏אין אף snapshot** — `drop` ‏**‏ריק**.
4. 🔴 ‏"‏כיסוי" ‏נספר **‏רק מ-snapshot של `selfDeviceId`**. snapshot ‏של מכשיר אחר
   ‏**‏אינו מכסה** ‏את הנתחים שלי. *(‏החור שגרסה 1 ‏אפשרה.)*

**‏גבולות מקובעים**: ‏השוואות-גיל הן `nowMs - createdMs > policy.keepAllMs` — ‏כלומר
**‏שווה-בדיוק ⇒ keep** (‏כיוון בטוח). `createdMs` ‏זהה בין snapshot ‏לנתח ⇒ **‏אינו מכסה**.

**‏טסטים חובה (12)**:

| # | ‏דרישה | ‏צפוי |
|---|------|------|
| 1 | ‏נתח ישן מאוד של מכשיר אחר | keep (‏אינו' 1) |
| 2 | ה-snapshot ‏שלי, ‏ישן מאוד, ‏העדכני שלי | keep (‏אינו' 2) |
| 3 | ‏אין לי אף snapshot, ‏יש incrementals ‏ישנים | `drop` ‏ריק (‏אינו' 3) |
| 4 | 🔴 snapshot **‏של מכשיר אחר** ‏חדש, ‏לי אין | `drop` ‏**‏ריק** (‏אינו' 4) |
| 5 | incremental ‏שלי בטווח `keepAllMs` | keep |
| 6 | incremental ‏שלי ישן, ‏ו-snapshot **‏שלי** ‏חדש ממנו | drop |
| 7 | incremental ‏שלי ישן, ‏אבל ה-snapshot ‏שלי ‏ישן ממנו | keep (‏לא מכוסה) |
| 8 | `createdMs` ‏זהה ל-snapshot ‏שלי | keep (‏גבול) |
| 9 | ‏גיל **‏שווה בדיוק** ל-`keepAllMs` | keep (‏גבול) |
| 10 | snapshot ‏שלי ישן מ-`keepSnapshotsMs` ‏שאינו העדכני | drop |
| 11 | ‏רשימה ריקה | ‏שתי רשימות ריקות |
| 12 | `keep ∪ drop` = ‏הקלט, ‏חיתוך ריק, ‏וסדר-קלט הפוך → ‏אותו פלט | ‏אמת תמיד |

> 🔴 ‏אליעזר: ‏אם טסט כאן נכשל — ‏זה **‏באג-נתונים**, ‏לא ציפייה שצריך להתאים. §7.

---

### Commit 5 — `vault-link.ts` (approach: **tdd**)

```ts
export type VaultLink = { readonly folderId: string; readonly key?: string };

/** ‏מחזיר מחרוזת ל**‏אחרי ה-`#`** ‏בלבד. ‏שמות על החוט: `folder`, `key`. */
export function encodeVaultLink(link: VaultLink): string;

/** ‏מקבל את מה שאחרי ה-`#` (‏עם או בלי `#` ‏מוביל). `null` ‏על קלט לא-תקין. */
export function decodeVaultLink(fragment: string): VaultLink | null;
```

**‏טסטים חובה (7)**: round-trip ‏עם מפתח · ‏בלי מפתח · `#` ‏מוביל נסבל ·
‏פרמטרים לא-מוכרים מתעלמים · `folder` ‏חסר → `null` · ‏מחרוזת ריקה → `null` ·
🔴 ‏הפלט **‏לעולם לא מכיל `#`** ‏גם כשהערכים מכילים תווים שדורשים escaping.

---

### Commit 6 — ‏חיווט (approach: integration)

- 🔴 `packages/core/tsconfig.json` — `include` ‏הוא ‏היום `["fs/**/*.ts"]`.
  ‏**‏הרחב ל-`["fs/**/*.ts", "sync/**/*.ts"]`.** ‏בלי זה ה-typecheck ‏על התיקייה החדשה
  ‏**‏ריק**, ‏ו-DoD#3 ‏חסר-משמעות.
- `packages/core/package.json` — ‏מוסיף `"./sync": "./sync/index.ts"` ‏ל-`exports`,
  ‏ומרחיב את ה-`test` script ‏שיריץ **‏גם** `sync/*.test.ts`.
- `packages/core/sync/index.ts` — re-export ‏של חמשת המודולים (‏בסגנון `fs/index.ts`).
- `docs/walkthrough.md` — ‏רשומה (‏סקיל `update-walkthrough`).

---

## §5 — DoD verifiable — **‏סקריפט, ‏לא ‏טבלה**

```bash
bash docs/plans/sync/sync-core-pure-dod.sh    # ‏משורש ‏ה-worktree
echo $?                                        # 0 = ‏כל ‏ה-DoD ‏ירוק
```

‏שלושה סבבי אימות מצאו שהפקודות שנכתבו בגוף הבריף היו **‏חסרות-שיניים**: הברחת `|`
‏בתא-טבלה הפכה חלופות למחרוזת ליטרלית, `cd ..` ‏נחת ב-`packages/` ‏במקום בשורש,
‏ו-`grep` ‏על תיקייה שאינה קיימת החזיר ריק — ‏שנקרא כמו מעבר. **‏לכן ה-DoD ‏הוא קובץ
‏בר-הרצה עם קוד-יציאה, ‏לא רשימה בפרוזה.**

‏הסקריפט **‏הורץ בפועל** ‏על העץ הנוכחי: 14 ‏כשלים, ‏אפס ירוקים, ‏קוד-יציאה 14 —
‏כולם מהסיבה הנכונה (R0 ‏טרם בוצע, ‏אז `packages/core` ‏אינו קיים). ‏הוא כולל
**‏שומר-ירוק-שקרי**: ‏כל בדיקה שרצה על `packages/core/sync` ‏מסומנת ❌ ‏אם התיקייה
‏חסרה, ‏במקום לדווח ריק.

| # | ‏מה נבדק |
|---|---------|
| pre-flight | ‏חמשת קבצי-התלות מ-R0 · `dependencies` ‏ריק · ‏שם החבילה `@ow/core` · `tsconfig.include` ‏מכסה `sync/` |
| 1+2 | ‏טסטים עוברים · ‏ספירה **‏≥ 51** |
| 3 | typecheck ‏נקי, ‏**‏ושתילת-שגיאה מכוונת ‏מפילה אותו** (‏הוכחת-כיסוי) |
| 4 | `@ow/core` ‏ירוק בנפרד מ-CF |
| 6 | ‏אפס `Date.now`/`new Date`/`performance.now`/`Math.random`/`crypto.getRandomValues`/`Buffer`/`node:` ‏בקוד המקור |
| 7 | ‏אפס `enum`/`namespace` |
| 8 | ‏אפס נגיעה ב-`src/` ‏ובבריפי הסוכן האחר (‏מקובעים **‏וגם** ‏עץ-עבודה; untracked ‏שלהם ‏אינו נגיעה שלנו) |
| 9 | ‏אפס **‏ייבוא** ‏של automerge |
| 10 | `import('@ow/core/sync')` ‏מחזיר ≥ 9 ‏סמלים |
| 11 | ‏אפס top-level await · ‏כל ייבוא יחסי (‏כולל `../`, side-effect, ‏ו-`import()` ‏דינמי) ‏נושא `.ts` |

> ‏`Buffer` ‏נבדק כ-`[^A-Za-z]Buffer[^a-zA-Z]` ‏ולא כתת-מחרוזת — ‏אחרת הוא תופס
> `ArrayBuffer`, ‏שהוא בדיוק מה ש-`TextEncoder` ‏מייצר.

> **‏live-preview gate**: ‏**‏לא חל** — ‏אין UI. ‏הסקריפט הוא התחליף.
> ‏מרדכי: ‏אשר את הפטור מפורשות מול המשתמש לפני merge.

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| ‏התלות משתנה שוב תחתינו | ‏קרה בפועל ב-20:56 | ‏שער pre-flight ‏על **‏קבצים** (§0) |
| typecheck ‏ריק על `sync/` | `include` ‏מוגבל ל-`fs/**` | Commit 6 + DoD#3 ‏עם שתילת-שגיאה |
| ‏קידוד שמאחד `[]` ‏ו-`['']` | ‏באג בגרסה 1 | ‏סכימה מקובעת + ‏טסט 8 |
| ‏קידוד שמתנגש תחת קיפול-רישיות | Drive | hex ‏קטן בלבד + ‏טסט 10 |
| ‏"‏התנגשות" ‏גלובלית במקום פר-תיקייה | ‏קיצור-דרך טבעי | docstring ‏מפורש + ‏טסטים 5 ‏ו-8 |
| snapshot ‏של מכשיר אחר נחשב כיסוי | ‏חור בגרסה 1 | ‏אינווריאנט 4 + ‏טסט 4 |
| ‏הרחבת-glob ע"י ה-shell | ‏מוכר מ-R0 | **‏מרכאות חובה**; DoD#2 ‏דורש ספירה |
| ‏מחרוזות עברית קשיחות | dev-conventions | ‏אין UI; ‏שגיאות הן `code` ‏מכונה |

---

## §7 — Escalation triggers

- ‏אחת מבדיקות ה-pre-flight (§0) ‏נכשלה.
- ‏אתה נדרש להוסיף **‏תלות כלשהי** ‏ל-`packages/core`.
- ‏אתה רוצה לייבא `node:*` ‏בקוד מקור (‏לא בטסט) ‏או לגעת ב-DOM.
- ‏אתה רוצה לגעת ב-`src/` ‏או בבריף של סוכן אחר.
- ‏טסט מהטבלאות נראה "‏לא נכון" — ‏**‏אל תשנה את הטסט**, ‏דווח.
- ‏אתה רוצה לסטות מ-tdd ‏באחד מחמשת המודולים.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| ‏חמישה מודולים חדשים | +2 |
| ‏אינווריאנטים עם השלכת-אובדן-נתונים | +2 |
| ‏קידוד הפיך עם שתי מלכודות (‏ריק, ‏רישיות) | +1 |
| Pure logic, ‏אפס IO | -2 |
| TDD ‏מלא | -1 |
| ‏אפס שינוי בקוד קיים (‏מלבד 2 ‏שורות קונפיג) | -1 |
| ‏חוזה ואילוצים ידועים מ-R0 | -1 |

**Score**: **4** / 10 · **Tier**: `calev` (light)

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | ‏קידוד `storage-key` | **‏מקובע ב-Commit 2** — `'_' + hex` ‏פר-מקטע. base64url ‏פסול (‏תלוי-רישיות) | ❌ |
| 2 | ‏פורמט `vault-link` | `URLSearchParams`; ‏שמות-חוט `folder`/`key` (‏שדות הטיפוס: `folderId`/`key`) | ❌ |
| 3 | ‏האם `retention` ‏מכירה `docId`? | ‏לא — ‏הקורא מסנן פר-מסמך לפני הקריאה | ❌ |
| 4 | `toLowerCase` ‏או `toLocaleLowerCase`? | **`toLowerCase`** — ‏עצמאי-locale | ❌ |
| 5 | ‏להמתין ל-`core-resolve-safe` ‏לפני dispatch? | **‏לא** — ‏אינו תלות שלנו. ‏רק R0 ‏חוסם | ❌ |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

- ...
