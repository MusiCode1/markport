# Slice R0 — restructure/monorepo-foundation — ‏בריף

> **‏תאריך**: 2026-07-31
> **‏סוג מסמך**: ‏בריף ביצועי לסלייס
> **‏סטטוס**: ‏**‏מאומת — ‏מוכן ‏ל-dispatch**
> **‏אימות אביגיל**: 1=NEEDS-REWORK(12) → 2=USABLE(11) → 3=USABLE(8) → 4=USABLE(6) → **‏צומצם** → 5=USABLE(11) → 6=USABLE(10) → 7=USABLE(6) → 8=USABLE(5, ‏אפס blockers) → **9 = ✅ READY**
> (`reports/obsidian-web/monorepo-foundation-avigail-round9.md`)
> **Dispatch**: ‏מותר לאליעזר רק אם `אימות אביגיל = READY`
> **Complexity**: 3/10 (verifier: light)
> **‏תלויות (`depends_on`)**: []
> **‏Base**: ‏קצה `dev` ‏בעת ‏פתיחת ‏ה-worktree. ‏**‏אין ‏קיבוע hash** — dev ‏זז ‏שלוש ‏פעמים
> ‏במהלך ‏האימות (`dbcec12`→`6422b32`→`5b8bb04`), ‏וכל ‏הדלתאות ‏היו `docs/` ‏בלבד
> (‏סוכן ‏מקביל ‏על ‏קו-הסנכרון). ‏אליעזר: ‏אם `git diff --stat <base>..dev` ‏מראה ‏שינוי
> **‏מחוץ ל-`docs/`** — ‏**‏עצור ‏ודווח** (§7); ‏המדידות ‏בבריף ‏עלולות ‏להתיישן.

---

> ## ‏למה ‏ה-scope ‏צומצם (‏החלטת ‏המשתמש, 2026-07-31)
>
> ‏ארבעה ‏סבבי ‏אימות ‏על ‏הגרסה ‏הקודמת ‏הראו ‏שתי ‏משפחות ‏ממצאים ‏שונות ‏לגמרי:
>
> | ‏משפחה | ‏סבב 1 | 2 | 3 | 4 | ‏מצב |
> |-------|------|---|---|---|------|
> | ‏איחוד `resolveSafe` / ‏שחזור ‏חוט | 6 | 6 | 3 | 3 | **‏ממשיך ‏לייצר ‏רגרסיות** |
> | ‏כלים (tsconfig, ‏גבול, workspaces) | 2 | 2 | 2 | 1 | **‏התכנס — ‏הכל ‏נמדד ‏ירוק** |
>
> ‏איחוד `resolveSafe` ‏נגע ‏ב-4 ‏אתרי-אבטחה ‏ובשתי ‏נקודות-קצה, ‏וכל ‏סבב ‏מצא ‏שדה ‏או
> ‏אתר ‏שהתיקון ‏הקודם ‏פספס. ‏הוא ‏**‏עבר ‏ל-`docs/plans/restructure/core-resolve-safe.md`** (Slice R1).
>
> ‏מה ‏שנשאר ‏כאן ‏הוא ‏רק ‏תשתית, ‏ו-**‏אפס ‏שינוי ‏בקוד ‏פרודקשן** — ‏ראה DoD#7.

---

## §0 — Pre-flight

### ‏תלויות

‏אין. ‏ה-slice ‏הראשון ‏ברצף; ‏כל ‏השאר ‏תלויים ‏בו.

### ‏מה ספציפי ל-slice הזה מעבר ל-`AGENTS.md`

`AGENTS.md` ‏אומר ‏היום *"don't assume `bun` works for every package"*. **‏ה-slice ‏הזה
‏משנה ‏את ‏זה**: bun ‏הוא ‏המתקין ‏היחיד (‏החלטת ‏המשתמש). ‏עדכון `AGENTS.md`
‏הוא ‏חלק ‏מה-DoD (Commit 3). **`README.md` ‏לא ‏נגוע** — ‏ראה ‏שם ‏למה.

### Worktree

```bash
cd /home/user/Projects/obsidian-web
git worktree add /home/user/Projects/obsidian-web/worktrees/monorepo-foundation \
    -b slice/monorepo-foundation dev
cd /home/user/Projects/obsidian-web/worktrees/monorepo-foundation
ln -s ../../dev/vendor vendor        # 🔴 ‏חובה — ‏ראה ‏למטה
bun install
```

‏⚠️ ‏ריפו ‏עם bare repo — ‏**‏נתיבים ‏מוחלטים ‏חובה**. ‏אין `pnpm` ‏בפרויקט.

> 🔴 **‏סימלינק ‏ה-vendor ‏אינו ‏אופציונלי** (‏אביגיל ‏סבב 5 ‏ממצא 1). `vendor/` ‏הוא
> gitignored, ‏כלומר worktree ‏חדש ‏נולד ‏**‏בלעדיו**. ‏ו-`bun run test` ‏מריץ ‏את
> `src/deployments/cloudflare`, ‏שהטסטים ‏שלו ‏עושים `execSync('bash scripts/build-assets.sh')`
> ‏ב-7 ‏טסטים ‏נפרדים — ‏והסקריפט ‏עוצר ‏קשיח (`exit 1`) ‏בלי `vendor/obsidian-mobile/app.js`.
> ‏בלי ‏השורה ‏הזו **‏ה-Verification ‏של Commit 0 ‏נכשל ‏מיד**, ‏ואליעזר ‏יחשוד ‏ב-workspaces
> ‏במקום ‏ב-vendor.
>
> ‏זו ‏הקונבנציה ‏הקיימת ‏בריפו — `.gitignore` ‏עצמו ‏מתעד ‏אותה:
> *"a symlink named `vendor`, which is how every worktree points at the shared copy"*.

### ‏איך להריץ

| ‏מה | ‏פקודה |
|----|-------|
| ‏התקנה | `bun install` (‏בשורש) |
| ‏כל ‏הטסטים | `bun run test` |
| typecheck | `bun run typecheck` |

> ⏱️ `bun run test` ‏כולל ‏את `src/deployments/cloudflare`, ‏שהטסטים ‏שלו ‏מריצים ‏את
> ‏סקריפט-הבנייה ‏האמיתי ‏ופונים ‏לרשת ‏אמיתית. ‏איטי ‏ועלול ‏להיות flaky.
> ‏לכן DoD#3 ‏שובר ‏טסט ‏ב-`packages/core` ‏ולא ‏ב-CF.

### Browser

‏לא ‏נדרש. ‏אין ‏שינוי UI ‏ואין ‏שינוי ‏התנהגות ‏בכלל.

### Reading list

**must-read**: `AGENTS.md` (‏סעיף Conventions), `README.md` (anchor: `Node 18+` — **‏לקריאה ‏בלבד, ‏לא ‏נגוע**),
`.gitignore` (‏בלוק Bun)

**reference**: ‏ארבעת ‏ה-`package.json` ‏הקיימים —
`src/{client-mobile,sync-server,deployments/cloudflare}`, `src/runtime-server/server`

> 🔴 **‏אל ‏תעגן ‏במספרי-שורות** — `AGENTS.md` ‏מחייב ‏עיגון ‏לתבנית.

### ‏מקורות חיצוניים — ‏עיגון + ‏מסקנות מחייבות-עיצוב

‏כל ‏שורה ‏כאן ‏**‏נמדדה ‏אמפירית**, ‏רובן ‏פעמיים ‏בנפרד (‏מרדכי + ‏אביגיל), ‏על
node v25.9.0 / bun 1.3.14 / typescript **7.0.2**, ‏ובנוסף 5.9.3 ‏ו-5.6.3.

| ‏יכולת | ‏נמדד | ‏מסקנה ‏מחייבת |
|-------|------|--------------|
| node ‏טוען `.ts` ‏נייטיבית | ✅ `require` ‏מ-CJS ‏ו-`import` ‏מ-ESM, ‏אפס ‏דגלים | ‏אין ‏שלב-קומפילציה ‏לטסטים |
| bun workspaces + node consumer | ✅ `node --test` ‏פותר `@ow/core/*` ‏דרך ‏סימלינק ‏של bun | bun ‏כמתקין ‏לא ‏שובר ‏חבילות node |
| ESM/CJS interop | ✅ ‏צרכן `"type":"commonjs"` ‏עושה `require()` ‏על ‏חבילה `"type":"module"`, ‏כולל `instanceof` | ‏מבנה `exports` ‏של Commit 1 ‏תקף |
| ‏מיקום ‏הסימלינק | ⚠️ ‏נמדד ‏תחת linker **isolated**. ‏תחת `hoisted` ‏שהבריף ‏מקבע — ‏הקישורים ‏יושבים ‏**‏בשורש**, ‏לא ‏פר-חבילה | ‏הרזולוציה ‏עובדת ‏בשני ‏המצבים (‏נמדד). ‏רלוונטי ‏ל-R1 — ‏ב-R0 ‏אין ‏צרכן |
| `node --test "fs/*.test.ts"` | ✅ ‏תופס ‏מספר ‏קבצים, ‏מסכם ‏ב-`tests N` ‏אחד | ‏אין "0 tests" ‏ירוק ‏כוזב |
| `bun run --filter '*' test` | ✅ `exit 1` ‏על ‏כשלון ‏בחבילה ‏אחת; ‏תופס ‏שם ‏עם scope; ‏לא ‏נכנס ‏לרקורסיה ‏על ‏חבילת ‏השורש | ‏אין ‏צורך ‏ב-fallback ‏משורשר |
| `tsc --build` ‏עם ‏התוכן ‏של Commit 1 | ✅ exit 0 ‏ב-**7.0.2** (‏ה-`latest` ‏הנוכחי), ‏וגם ‏ב-5.9.3 ‏וב-5.6.3. ‏הרצה ‏חוזרת exit 0; ‏ארטיפקט ‏יחיד `tsconfig.tsbuildinfo` | ‏ה-tsconfigs ‏מקובעים ‏ועובדים ‏חוצה-major |
| **TypeScript 7 ‏באמת ‏בודק** | ✅ ‏שגיאת-טיפוס ‏מכוונת ‏נתפסה ‏כ-`TS2322` — ‏לא ‏"‏עובר ‏בשקט" | ‏אפשר ‏לסמוך ‏על `bun run typecheck` ‏כשער |
| ‏esbuild → IIFE | ✅ ‏חבילת workspace ‏נצרפה ‏לקובץ ‏קלאסי ‏יחיד | ‏מסלול ‏הדפדפן ‏פתוח ‏ל-slices ‏הבאים |

> ⚠️ **‏שלושה ‏אילוצים ‏מחייבים ‏על `packages/core`** (node **‏מסיר ‏טיפוסים, ‏לא ‏מקמפל**;
> `require(esm)` ‏סינכרוני):
> 1. ‏אין `enum`, `namespace`, decorators
> 2. ‏אין **top-level await**
> 3. **‏ייבוא ‏יחסי ‏חייב ‏סיומת `.ts` ‏מפורשת** — `'./x.js'` ‏ו-`'./x'` ‏שניהם
>    `ERR_MODULE_NOT_FOUND` ‏תחת type-stripping (‏נמדד). ‏זה ‏מה ‏שמכתיב ‏את ‏ה-tsconfig.

---

## §1 — ‏מטרה

‏לפרויקט ‏יש ‏שלד ‏מונוריפו ‏עובד: **‏פקודה ‏אחת ‏מתקינה** ‏את ‏כל ‏החבילות,
**‏פקודה ‏אחת ‏מריצה ‏את ‏כל ‏הטסטים** (‏היום ‏אין ‏כזו ‏בכלל — ‏אין `package.json` ‏בשורש),
‏ו-`@ow/core` ‏קיימת ‏כחבילה ‏עם ‏**‏אפס ‏תלויות ‏מוצהרות ‏וגבול ‏נאכף ‏אוטומטית**.

**‏אפס ‏שינוי ‏בקוד ‏פרודקשן** — `git diff` ‏על `src/` ‏ריק ‏לחלוטין (DoD#7).
‏אחרי ‏ה-slice ‏אפשר ‏להעביר ‏לוגיקה ‏ל-`core` ‏בביטחון, ‏אבל ‏שום ‏לוגיקה ‏עוד ‏לא ‏עברה.

> 🟡 **‏שינוי ‏התנהגות ‏אחד ‏אמיתי ‏במסלול ‏ה-npm — ‏מדוד, ‏תחום, ‏ומתועד.**
> ‏עם `package.json` ‏עם `workspaces` ‏בשורש, `npm install` ‏בתת-חבילה ‏נפתר ‏מול ‏השורש:
> ‏נוצר `package-lock.json` ‏**‏בשורש**, ‏ה-lock ‏המקומי ‏שבמעקב ‏**‏נעקף** ‏ולא ‏משתנה,
> ‏ובפועל ‏מותקנת ‏גרסה ‏אחרת (‏נמדד: `express 4.22.2` ‏במקום `4.22.1` ‏שנעוץ ‏שם).
> ‏כלומר ‏מסלול ‏ה-npm ‏עדיין ‏**‏עובד**, ‏אבל ‏מאבד ‏את ‏השחזוריות ‏שה-lock ‏המקומי ‏נתן.
> ‏זה ‏מתועד ‏ב-`AGENTS.md` (Commit 3).
>
> 🔴 **‏ומה ‏שכן ‏היה ‏שגוי ‏בשני ‏נוסחים ‏קודמים ‏כאן** — ‏שני ‏תיקונים ‏נפרדים:
> 1. ‏סבב 6 ‏טען ‏שהוא ‏מושך ‏את ‏תלויות ‏**‏כל** ‏החבילות ‏כולל `wrangler` — ‏נמדד ‏כשגוי;
>    ‏רק ‏עץ ‏ה-cwd ‏מתממש.
> 2. ‏הנוסח ‏**‏שלי** ‏שנכתב ‏בעקבות ‏סבב 6 ‏טען ‏שזה ‏**‏בלתי-נמנע** ("‏המחיר ‏של ‏מונוריפו") —
>    ‏שגוי. ‏סבב 7 ‏הוא ‏זה ‏שמדד ‏את ‏הקריסה ‏**‏יחד ‏עם ‏התרופה ‏בת-השורה**: ‏היא ‏נבעה ‏מ-
>    `linker = "isolated"` ‏ב-bunfig ‏**‏גלובלי ‏של ‏המכונה**, ‏ו-`bunfig.toml` ‏בשורש
>    (Commit 0) ‏מבטל ‏אותה. DoD#12 ‏שומר ‏על ‏זה.
>
> ‏הלקח ‏שנשמר: **‏אל ‏תתעד "‏בלתי-נמנע" ‏לפני ‏שבידדת ‏את ‏הסיבה**, ‏ו**‏אל ‏תבטל ‏טענה
> ‏שלמה ‏כשרק ‏חלק ‏ממנה ‏שגוי** — ‏הביטול ‏של ‏סבב 8 ‏עצמו ‏היה ‏רחב ‏מדי ‏וסתר ‏את Commit 3.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| `package.json` ‏שורש + bun workspaces | ✅ | ‏כאן |
| 3 ‏קבצי tsconfig + `bunfig.toml` (**‏תוכן ‏מקובע**) | ✅ | ‏כאן |
| `packages/core` + `scripts/check-core-boundary.mjs` | ✅ | ‏כאן |
| `core/fs/to-relative.ts` + 7 ‏טסטים — **‏לא ‏מחווט ‏לאיש** | ✅ | ‏כאן |
| `.gitignore` + `AGENTS.md` | ✅ | ‏כאן |
| **‏הוספת `@ow/core` ‏כתלות ‏לחבילה ‏קיימת** | ❌ | **Slice R1** — ‏ראה ‏למטה |
| **‏טסטי-הוכחת-interop** | ❌ | **Slice R1** |
| **‏שינוי `README.md`** | ❌ | **Slice R1** |
| **‏איחוד `resolveSafe`** | ❌ | **Slice R1** |
| **‏שינוי ‏כלשהו ‏בקוד ‏פרודקשן** | ❌ | ‏אף ‏פעם ‏ב-slice ‏הזה — DoD#7 |
| **‏העברת ‏חבילות ‏ל-`packages/`** | ❌ | slices ‏בהמשך |
| **‏פיצול `boot.js` / `capacitor-shim.js`** | ❌ | slices ‏בהמשך |
| **‏חיווט esbuild ‏ל-`build-assets.sh`** | ❌ | slice ‏עתידי |
| **scripts ‏של `cloudflare`** (`npx wrangler`, `npm run build`) | ❌ | ‏אל ‏תיגע |

> ‏ה-workspaces ‏מוגדרים ‏על ‏**‏המיקומים ‏הנוכחיים**. ‏ההעברה ‏ל-`packages/` ‏היא slice
> ‏נפרד ‏לכל ‏חבילה.

---

## §3 — Architecture diagram

```
‏לפני:                              ‏אחרי:

(‏אין package.json ‏בשורש)          package.json      ← workspaces, bun
(‏אין ‏פקודת-טסט ‏אחת)                tsconfig.json     ← files:[] + references
                                   tsconfig.base.json
src/client-mobile/     pkg         scripts/check-core-boundary.mjs
src/runtime-server/…/  pkg              │
src/sync-server/       pkg         packages/core/     ← ‏חדש, ‏אפס ‏תלויות
src/deployments/cf/    pkg           package.json
                                     tsconfig.json
                                     fs/to-relative.ts   ← ‏פונקציה ‏אחת, ‏טהורה
                                     fs/index.ts
                                     fs/to-relative.test.ts

                                   ‏🔴 ‏אף ‏חץ ‏לכאן. ‏ל-`core` ‏אין ‏צרכן ‏ב-R0 —
                                      ‏ארבע ‏החבילות ‏תחת `src/` ‏אינן ‏נגועות ‏כלל.
                                      ‏החיווט ‏הראשון ‏קורה ‏ב-R1.
```

**‏חוזה `core`**: ‏רק ‏מה ‏שמוצהר ‏ב-`dependencies` (‏ב-R0: ‏ריק). ‏אפס express.
‏אפס DOM. `node:path` ‏מותר (built-in).

---

## §4 — Commits ‏בסדר

### Commit 0 — ‏שלד workspaces (approach: integration)

**‏חדש**: `package.json` (‏שורש)

```jsonc
{
  "name": "obsidian-web",
  "private": true,
  "workspaces": [
    "packages/*",
    "src/client-mobile",
    "src/runtime-server/server",
    "src/sync-server",
    "src/deployments/cloudflare"
  ],
  "scripts": {
    "test": "bun run --filter '*' test",
    "typecheck": "tsc --build"
  },
  "devDependencies": {
    "typescript": "^7.0.0",
    "@types/node": "^24.0.0"
  }
}
```

> `@types/node` ‏חובה — `core` ‏וקבצי ‏הטסט ‏מייבאים `node:*`, ‏ובלעדיו tsc ‏נכשל
> `TS2307` (‏נמדד). ‏זו devDependency ‏של ‏**‏השורש** — ‏אינה ‏מפרה ‏את ‏חוזה `core`.
>
> **esbuild ‏הוסר** (‏אביגיל ‏סבב 5 ‏ממצא 8): ‏הוא ‏אינו ‏בשימוש ‏ב-slice ‏הזה (§2 ‏דוחה
> ‏את ‏חיווטו), ‏ו-`^0.24.0` ‏ממילא ‏ננעל ‏על ‏טווח ‏ישן (latest = 0.28.1). ‏מוסיפים ‏אותו
> ‏ב-slice ‏שבאמת ‏מחווט ‏אותו, ‏עם ‏טווח ‏עדכני ‏שיימדד ‏אז.
>
> `@types/node` ‏עלה ‏ל-`^24` — `^22` ‏נפתר ‏ל-22.20.1 ‏מול runtime node v25.9.0,
> ‏פער ‏של ‏שלושה ‏מייג'ורים. ‏אליעזר: ‏אם `^24` ‏מייצר ‏שגיאות-טיפוס ‏שלא ‏היו ‏ב-`^22`,
> **‏דווח** ‏ואל ‏תשתיק ‏אותן — ‏אלה ‏פערים ‏אמיתיים ‏מול ‏הריצה.

**‏חדש ‏גם**: `bunfig.toml` (‏שורש) — **‏מקובע**:

```toml
[install]
linker = "hoisted"
```

> 🔴 **‏שורה ‏אחת ‏שמונעת ‏שבירה ‏של ‏כל ‏מסלולי ‏ה-npm ‏בריפו** (‏אביגיל ‏סבב 7 ‏ממצא 1,
> ‏אחרי bisect ‏משותף). ‏עם linker **isolated**, `bun install` ‏בשורש ‏יוצר ‏פריסת
> `node_modules` ‏ש-npm's arborist ‏לא ‏יודע ‏לפרסר, ‏וכל `npm install` ‏בריפו ‏מת ‏ב-
> `Cannot read properties of null (reading 'isDescendantOf')`. ‏זה ‏שובר ‏את ‏שלוש
> ‏ההוראות ‏ב-`README.md` ‏ואת `src/deployments/cloudflare` (`npm run build`).
>
> ‏ה-bisect ‏שאיתר ‏את ‏זה: ‏הטריגר ‏הוא **‏חבר-workspace ‏שני ‏שיש ‏לו ‏תלויות ‏משלו**.
> ‏עם `packages/core` + `runtime-server` ‏בלבד — exit 0; ‏מרגע ‏ש-`sync-server` ‏נוסף — exit 1.
>
> ⚠️ **‏מקור ‏התקלה ‏אינו ‏הפרויקט**: `~/.bunfig.toml` ‏של ‏המכונה ‏מכיל
> `linker = "isolated"` (‏לא ‏קשור ‏לריפו). ‏ברירת-המחדל ‏של bun ‏היא `hoisted`,
> ‏ולכן ‏מפתח ‏אחר **‏לא ‏היה ‏רואה ‏את ‏הקריסה ‏בכלל** — ‏וזו ‏בדיוק ‏הסיבה
> ‏לקבע ‏את ‏זה ‏בריפו: ‏קונפיג ‏גלובלי ‏פר-מכונה ‏לא ‏אמור ‏להכריע ‏אם ‏הפרויקט ‏נבנה.
> ‏אומת ‏פעמיים ‏בנפרד (‏מרדכי + ‏אביגיל): ‏עם `bunfig.toml` ‏הזה, `npm install` ‏חוזר ‏ל-exit 0
> ‏גם ‏עם ‏כל ‏חמשת ‏החברים.

**‏משתנה ‏ב-Commit ‏הזה** (‏לא ‏ב-Commit 1): `.gitignore` — ‏הוספת `/package-lock.json`.

> 🔴 **‏חייב ‏להיות ‏כאן, ‏לא ‏מאוחר ‏יותר** (‏אביגיל ‏סבב 8 ‏ממצא 2): ‏ה-Verification
> ‏למטה ‏מריץ `npm install`, ‏שיוצר `package-lock.json` **‏בשורש** — lockfile ‏של npm
> ‏במונוריפו ‏שמנוהל ‏ב-bun. ‏אם ‏כלל ‏ההחרגה ‏מגיע ‏רק ‏ב-Commit 1, `git add -A` ‏בסוף
> Commit 0 ‏מכניס ‏אותו ‏לקומיט. ‏מוחרג ‏רק ‏בשורש (`/`) — ‏שני ‏ה-`package-lock.json`
> ‏תחת `src/` ‏הם ‏קבצים ‏**‏במעקב** ‏ואסור ‏לגעת ‏בהם.

**Verification**:
```bash
bun install
bun run test ; echo "exit=$?"                                  # exit=0
cd src/runtime-server/server && npm install ; echo "exit=$?"   # exit=0 ← ‏השער ‏החדש
! git status --porcelain | grep -q package-lock.json           # ‏מוחרג ‏כבר ‏עכשיו
```

**‏אליעזר: `git add bunfig.toml`** — ‏קובץ ‏קיים-אך-לא-במעקב ‏עובר ‏את DoD#12 ‏בשקט
‏ונעלם ‏אצל ‏כל ‏מפתח ‏אחר. (DoD#15)

---

### Commit 1 — ‏חבילת core + tsconfig + ‏גבול (approach: integration)

**‏חדש**: `packages/core/package.json`

```jsonc
{
  "name": "@ow/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { "./fs": "./fs/index.ts" },
  "dependencies": {},
  "scripts": {
    "test": "node ../../scripts/check-core-boundary.mjs && node --test \"fs/*.test.ts\""
  }
}
```

**‏חדש**: `tsconfig.base.json` (‏שורש) — **‏מקובע, ‏אל ‏תאלתר**:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"]
  }
}
```

**‏חדש**: `tsconfig.json` (‏שורש) — **‏מקובע**:

```jsonc
{
  "files": [],
  "references": [{ "path": "./packages/core" }]
}
```

**‏חדש**: `packages/core/tsconfig.json` — **‏מקובע**:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "rootDir": "."
  },
  "include": ["fs/**/*.ts"]
}
```

> 🔴 **‏שלושת ‏הקבצים ‏מקובעים ‏כי ‏כל ‏סטייה ‏נמדדה ‏ככושלת** — ‏זהו ‏הממצא ‏שחזר ‏בכל
> ‏ארבעת ‏סבבי ‏האימות:
> - ‏בלי `module`/`moduleResolution: NodeNext` ‏ב-base → `import test from 'node:test'`
>   ‏נכשל **TS1259 ×5**
> - ‏בלי `allowImportingTsExtensions` → **TS5097** (type-stripping ‏מחייב ‏סיומת `.ts`)
> - ‏עם `allowImportingTsExtensions` ‏אבל ‏עם `outDir` → **TS5096**
> - ‏שורש ‏בלי `"files": []` → **TS6305 ×5 + TS6310** ("Referenced project may not
>   disable emit"), ‏שנקרא ‏כסתירה ‏ישירה ‏ל-`noEmit` ‏שבעלה
>
> ‏הצירוף ‏שלמעלה ‏הורץ ‏על **7.0.2** (‏מרדכי) ‏ועל **5.9.3 ‏ו-5.6.3** (‏אביגיל) — exit 0
> ‏בשלושתן, ‏כולל ‏הרצה ‏חוזרת. ‏אליעזר: ‏אם ‏זה ‏לא ‏עובר — **‏עצור ‏ודווח** (§7).
> ‏אל ‏תנחש ‏דגלים.
>
> ℹ️ **‏למה TypeScript 7**: ‏הוא ‏ה-`latest` ‏ב-npm ‏נכון ‏ל-2026-07-31 (7.0.2 ‏יציב;
> 6.0.0 ‏עדיין ‏תחת ‏תג `beta`). ‏זהו ‏ה-port ‏הנייטיבי ‏ל-Go, ‏ולכן ‏**‏לא ‏הנחתי ‏שהדגלים
> ‏נתמכים** — ‏מדדתי: `composite`+`allowImportingTsExtensions`+`noEmit`+`references`
> ‏עוברים, ‏וגם ‏שגיאת-טיפוס ‏מכוונת ‏נתפסת (`TS2322`). ‏ה-`^7.0.0` ‏אינו ‏שובר ‏את
> ‏המדידות ‏של ‏אביגיל: ‏אותו ‏קונפיג ‏עובר ‏גם ‏ב-5.x.

**‏חדש**: `scripts/check-core-boundary.mjs`

> **‏למה ‏סקריפט ‏ולא eslint**: ‏אין eslint ‏בריפו ‏כלל; eslint 9 ‏הוא flat-config
> ‏שדורש compat ‏ל-`import/no-extraneous-dependencies`. ‏תשתית-לינט ‏שלמה ‏היא
> scope creep ‏ל-slice ‏תשתית.
>
> ‏מה ‏הוא ‏עושה: ‏קורא ‏רקורסיבית ‏את ‏קבצי ‏ה-`.ts` ‏של `packages/core`, ‏מוציא ‏כל
> specifier ‏של `import`/`require`, ‏ומכשיל ‏אם ‏אחד ‏מהם ‏אינו ‏יחסי **‏ובתוך ‏החבילה**
> (‏כלומר `./` ‏מותר; **`../` ‏שיוצא ‏מ-`packages/core` ‏אסור** — ‏אחרת ‏אפשר ‏להגיע
> ‏ל-`src/` ‏ולעקוף ‏את ‏כל ‏הגבול, ‏אביגיל ‏סבב 6 ‏ממצא 7), ‏אינו
> `node:`-prefixed, ‏**‏ואינו ‏מופיע ‏ב-`dependencies` ‏של `packages/core/package.json`**.
> ‏מדפיס `checked N files` ‏כדי ‏שאפשר ‏יהיה ‏לראות ‏שהוא ‏באמת ‏בדק.
>
> 🔴 **‏הגבול ‏הוא "‏רק ‏תלויות ‏מוצהרות", ‏לא "‏אפס ‏תלויות"** (‏אביגיל ‏סבב 5 ‏ממצא 6).
> ‏הניסוח ‏הקודם ‏היה ‏חוסם ‏כל ‏ספרייה ‏לנצח. ‏הניסוח ‏הזה ‏עדיין ‏אוכף ‏את ‏מה ‏שחשוב —
> ‏אי-אפשר ‏להבריח `express` ‏או ‏גישה ‏ל-DOM ‏בלי ‏להצהיר ‏עליהם ‏במקום ‏שנראה ‏בסקירת-קוד —
> ‏אבל ‏מאפשר ‏לחבילה ‏לגדול. ‏ב-R0 ‏רשימת ‏ה-`dependencies` ‏היא `{}`, ‏כך ‏שהתנהגות ‏השער
> ‏זהה ‏בפועל ‏לניסוח ‏הקודם.
>
> 🔴 **‏חייב ‏לעגן ‏ב-`import.meta.dirname`, ‏לא ‏ב-cwd.** ‏הוא ‏רץ ‏מתוך `scripts.test`
> ‏של ‏החבילה, ‏כלומר cwd = `packages/core`. ‏נמדד: glob ‏יחסי-ל-cwd ‏מחזיר **5 ‏קבצים
> ‏מהשורש ‏ו-0 ‏מ-`packages/core`** — ‏כלומר ‏השער ‏נצבע ‏ירוק ‏בלי ‏לבדוק ‏קובץ ‏אחד.
> ‏אביגיל ‏אימתה ‏שהגרסה ‏המעוגנת ‏מדפיסה `checked N files` ‏משני ‏ה-cwd-ים, ‏ומחזירה
> **exit 1** ‏על `import express` ‏מכוון.

**‏משתנה**: `.gitignore` — ‏שני ‏שינויים ‏בלבד:
1. ‏הוספת `*.tsbuildinfo` (‏הארטיפקט ‏היחיד; ‏אין `dist/` ‏כי `noEmit`)
2. ‏בבלוק Bun — ‏להביא ‏אותו ‏**‏בדיוק** ‏לצורה:

```gitignore
bun.lockb
bun.lock
!/bun.lock
```

‏ובנוסף, ‏שורה ‏חדשה: `/package-lock.json` — **‏אבל ‏היא ‏כבר ‏נוספה ‏ב-Commit 0**, ‏ראה ‏שם.

> 🔴 **‏למה `/package-lock.json`** (‏אביגיל ‏סבב 6 ‏ממצא 2): ‏ברגע ‏שיש `package.json`
> ‏בשורש, `npm install` ‏שמורץ ‏בטעות ‏מהשורש ‏או ‏מתת-חבילה ‏ייצר lockfile ‏של **npm**
> ‏במונוריפו ‏שמנוהל ‏ע"י **bun**. ‏אין ‏היום ‏שום ‏כלל ‏שמכסה ‏אותו, ‏ו-`git add -A` ‏היה
> ‏מכניס ‏אותו ‏לקומיט. ‏מוחרג ‏רק ‏בשורש (`/`) — ‏שני ‏ה-`package-lock.json` ‏הקיימים
> ‏תחת `src/` ‏הם ‏קבצים ‏**‏במעקב** ‏ואסור ‏לגעת ‏בהם.

**‏אליעזר: ‏הוסף ‏את `bun.lock` ‏של ‏השורש ‏לקומיט ‏במפורש** (`git add bun.lock`).
‏שורת ‏ה-`!/bun.lock` ‏רק ‏מסירה ‏את ‏ההחרגה — ‏היא ‏לא ‏מוסיפה ‏אותו ‏למעקב.
‏מונוריפו ‏בלי lockfile ‏במעקב ‏מאבד ‏שחזוריות, ‏וזו ‏כל ‏מטרת ‏השינוי. (DoD#12ב)

> 🔴 **‏שורת ‏ה-`!/bun.lock` ‏היא ‏קריטית** (‏אביגיל ‏סבב 5 ‏ממצא 3). ‏הסרה ‏פשוטה ‏של
> `bun.lock` ‏מה-.gitignore ‏הייתה ‏חושפת ‏**‏שלושה** lockfiles ‏מקומיים ‏קיימים ‏מתחת
> ‏ל-`src/` (`sync-server/`, `runtime-server/server/`, ‏ו-`src/server/` ‏— ‏ספריית-יתומה
> ‏שאינה workspace ‏כלל). ‏הם ‏היו ‏נכנסים ‏לקומיט, **DoD#7 ‏היה ‏נכשל ‏כוזב**, ‏ואליעזר
> ‏היה ‏מגיע ‏ל-§7 ("‏נגעת ‏בקוד ‏פרודקשן") ‏באסקלציית-שווא.
>
> ‏הצורה ‏למעלה ‏עוקבת ‏אחרי **‏רק ‏ה-lockfile ‏של ‏השורש** — ‏שהוא ‏היחיד ‏שמשמעותי ‏במונוריפו —
> ‏ומשאירה ‏את ‏השלושה ‏המקומיים ‏מוסתרים ‏כפי ‏שהם ‏היום. `bun.lockb` ‏(‏בינארי, bun ‏ישן)
> ‏נשאר ‏מוחרג ‏לגמרי. **‏אל ‏תמחק ‏את ‏הבלוק ‏כולו** ‏ואל ‏תסתפק ‏בהסרת ‏שורה.

**Verification**:
```bash
bun run typecheck                          # exit 0
cd packages/core && bun run test           # ‏מדפיס "checked N files"
# ‏הוסף ‏זמנית `import express from 'express'` → **‏חייב** exit 1 → ‏הסר
```

---

### Commit 2 — `toRelative` ‏ב-core (approach: **tdd**)

‏הפונקציה ‏הראשונה ‏ב-`core`. ‏נבחרה ‏כי ‏היא **‏טהורה, ‏זעירה, ‏ואין ‏לה ‏אף ‏קורא ‏קיים** —
‏כלומר ‏אפס ‏סיכון-רגרסיה. ‏Slice R1 ‏הוא ‏שיחווט ‏אותה.

**‏חדש**: `packages/core/fs/to-relative.ts`, `fs/index.ts`, `fs/to-relative.test.ts`

```ts
/** ‏מקלף `'/'` ‏מוביל **‏בלבד** (‏לא ‏בקסלאש).
 *  ‏זורק TypeError ‏עם ‏ההודעה `path must be a string` ‏אם rel ‏אינו ‏מחרוזת.
 *  ‏מימוש ‏מחייב: rel.replace(/^\/+/, '') */
export function toRelative(rel: string): string;
```

> 🔴 **`'/'` ‏בלבד — ‏לא `[\\/]`.** ‏קובץ ‏בשם `\` ‏הוא ‏שם ‏חוקי ‏ב-POSIX, ‏ומימוש
> "‏מגונן" ‏עם `/^[\\/]+/` ‏היה ‏מוחק ‏אותו ‏מהנתיב.
>
> ‏ℹ️ **‏אין ‏ל-`toRelative` ‏אף ‏קורא ‏ב-R0** — ‏היא ‏פונקציה ‏עצמאית ‏שמוגדרת ‏ע"י ‏הטבלה
> ‏למעלה ‏ותו ‏לא. ‏השאלה ‏מול ‏איזה ‏מארבעת ‏שומרי-הנתיב ‏היא ‏תואמת (‏והיא ‏תואמת ‏את
> `api/fs.js` ‏אך ‏**‏לא** ‏את `sync-server/resolve-safe.js`, ‏שזורק ‏על ‏קלט ‏מוחלט) ‏שייכת
> ‏כולה ‏ל-**R1** ‏ומוכרעת ‏שם. ‏אל ‏תנמק ‏כאן ‏שום ‏שורה ‏ב"‏מה ‏R1 ‏יצטרך" —
> ‏זה ‏מה ‏שאביגיל ‏סימנה ‏כשריד ‏משפחה ‏שהוצאה (‏סבב 5 ‏ממצא 5).
>
> ‏אותו ‏דבר ‏לגבי `TypeError`: ‏שני ‏המימושים ‏הקיימים ‏זורקים `Error` ‏רגיל. ‏ההתאמה
> ‏ביניהם ‏היא ‏החלטה ‏של ‏R1; ‏כאן `TypeError` ‏נבחר ‏כי ‏הוא ‏הנכון ‏לפונקציה ‏חדשה ‏בלי ‏קוראים.

| # | ‏קלט | ‏צפוי |
|---|-----|------|
| 1 | `'/'` | `''` |
| 2 | `'//'` | `''` |
| 3 | `'/a/b'` | `'a/b'` |
| 4 | `'a/b'` | `'a/b'` |
| 5 | `'/etc/passwd'` | `'etc/passwd'` |
| 6 | `'\\'` | `'\\'` — **‏בקסלאש ‏אינו ‏מפריד** |
| 7 | `(null as any)` | ‏זורק `TypeError('path must be a string')` |

**Verification**: `cd packages/core && node --test "fs/*.test.ts"` → ‏הפלט ‏מראה `tests 7`

> ‏אליעזר: ‏אמת ‏שהפלט ‏מציג `tests 7` — ‏לא ‏רק "‏ירוק".

---

### Commit 3 — ‏תיעוד (approach: none)

- `AGENTS.md` — bun ‏כמתקין ‏יחיד; ‏מבנה ‏ה-workspaces; ‏חוזה `packages/core`
  ‏עם ‏שלושת ‏האילוצים (§0); **‏רצפת ‏Node ‏לפיתוח** (‏ראה ‏למטה)
- `docs/walkthrough.md` — ‏רשומה ‏חדשה ‏בראש (‏סקיל `update-walkthrough`)
- `docs/decisions/obsidian-web.md` — **‏מרדכי ‏כותב, ‏לא ‏אליעזר**

**‏עוד ‏ב-`AGENTS.md` — ‏שינוי ‏התנהגות ‏ה-npm** (§1, ‏אביגיל ‏סבב 6 ‏ממצא 1):
‏לתעד ‏ש-`npm install` ‏בתת-חבילה ‏מטפס ‏עכשיו ‏לשורש ‏ה-workspace ‏ועוקף ‏את
‏ה-`package-lock.json` ‏המקומי. ‏זו ‏ההשלכה ‏האמיתית ‏היחידה ‏של ‏ה-slice ‏על ‏משתמשים
‏קיימים, ‏והיא ‏חייבת ‏להיות ‏כתובה ‏במקום ‏שמפתח ‏יראה ‏אותה.

> 🔴 **‏רצפת ‏Node — ‏הבחנה ‏שנוצרה ‏בצמצום.** ‏העוגן `Node 18+` ‏קיים ‏ב-`AGENTS.md`
> ‏וב-`README.md`. (‏יש ‏מופע ‏שלישי ‏ב-`src/client-mobile/test/requesturl-base64.test.js` —
> ‏הערה ‏בקובץ-טסט, **‏לא ‏נוגעים ‏בו**; ‏אביגיל ‏סבב 6 ‏ממצא 8.) ‏אבל ‏אחרי ‏שהוצאנו
> ‏את ‏החיווט ‏ל-R1, ‏השתיים ‏**‏אינן ‏מדברות ‏על ‏אותו ‏דבר**:
>
> | ‏קובץ | ‏על ‏מה ‏הוא ‏מדבר | ‏ב-R0 |
> |------|---------------|-------|
> | `AGENTS.md` | ‏סביבת **‏פיתוח** — ‏הרצת ‏הטסטים | ‏**‏עולה ‏ל-22.18+**: `node --test "fs/*.test.ts"` ‏דורש type-stripping ‏ללא ‏דגל |
> | `README.md` | ‏**‏פריסה** ‏של ‏השרת ‏למשתמש | ‏**‏לא ‏משתנה** — ‏אף ‏חבילה ‏עדיין ‏לא ‏צורכת ‏את `core`, ‏אז ‏אין `require(esm)` ‏בזמן ‏ריצה |
>
> ‏🔴 **‏אל ‏תיגע ‏ב-`README.md` ‏ב-slice ‏הזה.** ‏העלאת ‏רצפת ‏הפריסה ‏שייכת ‏ל-R1, ‏שם
> `runtime-server` ‏באמת ‏יצרוך ‏את `core`. ‏העלאה ‏מוקדמת ‏= ‏תיעוד ‏שמשקר ‏לרעה
> (‏מרחיק ‏משתמשים ‏על node 18/20 ‏שהפריסה ‏אצלם ‏עדיין ‏תקינה ‏לחלוטין).

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | ‏התקנה ‏אחת | `bun install` — ‏אפס ‏שגיאות |
| 2 | ‏פקודה ‏אחת ‏מריצה ‏את ‏כל 5 ‏החבילות | `bun run test` |
| 3 | ‏כשלון ‏מכשיל ‏את ‏הפקודה | ‏שבור ‏טסט ‏**‏ב-`packages/core`** → `echo $?` ≠ 0 → ‏החזר |
| 4 | typecheck ‏נקי | `bun run typecheck` — exit 0 |
| 5 | ‏גבול ‏נאכף **‏ובאמת ‏בודק** | ‏פלט ‏מראה `checked N files` ‏עם N>0; `import express` → exit 1 |
| 6 | 7 ‏טסטי core ‏נספרים | ‏פלט ‏מראה `tests 7` |
| 7 | 🔴 **`src/` ‏לא ‏נגוע ‏כלל** | **‏שתי ‏פקודות, ‏שתיהן ‏חייבות ‏פלט ‏ריק**: `git diff --stat dev...HEAD -- src/` (‏קומיטים; ‏שלוש ‏נקודות = ‏מול ‏נקודת-הפיצול, ‏לא ‏מול ‏קצה dev ‏הנודד) **‏וגם** `git status --porcelain src/` (‏עץ-עבודה — ‏עריכות ‏לא-מקומטות ‏אינן ‏נראות ‏ב-diff, ‏אביגיל ‏סבב 7 ‏ממצא 6) |
| 8 | 🔴 **`scripts/` — ‏רק ‏קובץ ‏אחד ‏חדש** | `git diff --stat dev...HEAD -- scripts/` → ‏רק `check-core-boundary.mjs` |
| 9 | ‏אין lockfiles ‏מקומיים ‏בקומיט | `git status --short src/` → ‏אפס `bun.lock` |
| 10 | ‏רגרסיה: ‏שרת ‏עולה | `cd src/runtime-server/server && PORT=4099 timeout 5 node index.js; test $? -eq 124` — ‏קוד 124 = ‏רץ ‏עד ‏ה-timeout, ‏כלומר ‏עלה ‏ולא ‏קרס. **‏אל ‏תריץ ‏בלי `timeout`** — ‏הוא ‏חוסם ‏לנצח |
| 11 | ‏רגרסיה: ‏בניית CF | `cd src/deployments/cloudflare && npm run build` |
| 12 | 🔴 **‏מסלול ‏ה-npm ‏שלם** | `cd src/runtime-server/server && npm install ; echo $?` → **0**. ‏שער ‏אמיתי ‏עכשיו: ‏בלי `bunfig.toml` ‏הוא ‏**‏נכשל** (‏נמדד) |
| 12ב | `bun.lock` ‏של ‏השורש ‏**‏במעקב** | `git ls-files bun.lock` ‏מחזיר `bun.lock` — ‏נוסף ‏בפועל, ‏לא ‏רק ‏לא-מוחרג |
| 13 | ‏שלושת ‏ה-lockfiles ‏המקומיים ‏מוסתרים | `git check-ignore -v src/sync-server/bun.lock src/runtime-server/server/bun.lock src/server/bun.lock` → ‏שלושתם |
| 14 | ‏תיעוד | `AGENTS.md` + `.gitignore`. **`README.md` ‏לא ‏נגוע** |
| 15 | 🔴 **`bunfig.toml` ‏במעקב** | `git ls-files bunfig.toml` ‏מחזיר `bunfig.toml`. ‏קובץ ‏קיים-אך-לא-במעקב ‏עובר ‏את DoD#12 ‏ונעלם ‏אצל ‏כל ‏מפתח ‏אחר — ‏בדיוק ‏מלכודת `bun.lock` |

> **live-preview gate**: ‏לא ‏חל — ‏אין UI. **DoD#7 ‏הוא ‏העיקרי**, ‏והוא ‏חזק ‏יותר
> ‏מכל ‏שער ‏התנהגותי: ‏אם `git diff` ‏על `src/` ‏ריק, **‏מתמטית ‏אי-אפשר ‏היה ‏לשבור ‏כלום**
> ‏בקוד ‏הריצה. ‏זה ‏מה ‏שהצמצום ‏קנה — ‏קודם ‏היו ‏כאן ‏שני `package.json` ‏משתנים ‏ושני
> ‏קבצי ‏טסט ‏משתנים, ‏ומסלול ‏ה-npm ‏של ‏החבילות ‏הקיימות ‏היה ‏נשבר ‏ממש.
> ‏מרדכי: ‏אשר ‏את ‏הפטור ‏מול ‏המשתמש ‏לפני merge.

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| **worktree ‏בלי vendor → `bun run test` ‏נכשל ‏מיד** | ‏סבב 5 ‏ממצא 1 | ‏שורת ‏הסימלינק ‏ב-§0 + ‏הסבר ‏למה |
| **`workspace:*` ‏שובר `npm install` (EUNSUPPORTEDPROTOCOL)** | ‏סבב 5 ‏ממצא 2 | ‏החיווט ‏**‏הוסר** ‏מה-slice ‏כולו |
| **‏כל `npm install` ‏בריפו ‏מת ‏אחרי `bun install`** | ‏סבב 7 ‏ממצא 1 (bisect) | `bunfig.toml` ‏עם `linker="hoisted"` ‏ב-Commit 0 + **DoD#12** |
| ‏מסלול ‏ה-npm ‏מאבד ‏שחזוריות (lock ‏מקומי ‏נעקף) | ‏סבב 6 ‏ממצא 1, ‏אושר ‏מחדש ‏בסבב 8 | ‏אמיתי ‏ובלתי-נמנע. **‏מתועד** ‏ב-§1 ‏וב-`AGENTS.md` (Commit 3) |
| ‏קונפיג bun ‏גלובלי ‏פר-מכונה ‏מכריע ‏אם ‏הפרויקט ‏נבנה | ‏אותו ‏ממצא | ‏קיבוע ‏ב-`bunfig.toml` ‏של ‏הריפו — ‏גובר ‏על ‏הגלובלי |
| **`npm install` ‏מייצר lockfile ‏של npm ‏בשורש bun-only** | ‏סבב 6 ‏ממצא 2 | `/package-lock.json` ‏ב-.gitignore |
| ‏`bun.lock` ‏נשאר ‏לא-מוסף ‏למרות ‏שהוחרג | ‏סבב 6 ‏ממצא 5 | ‏הוראת `git add bun.lock` ‏מפורשת + DoD#12ב |
| `node index.js` ‏חוסם ‏את ‏הריצה ‏לנצח | ‏סבב 6 ‏ממצא 6 | DoD#10 ‏עם `timeout 5` ‏ובדיקת ‏קוד 124 |
| ‏`../` ‏בסקריפט-הגבול ‏עוקף ‏את ‏החבילה | ‏סבב 6 ‏ממצא 7 | ‏אסור ‏מפורשות ‏במפרט ‏הסקריפט |
| ‏diff ‏מול ‏קצה dev ‏הנודד | ‏סבב 6 ‏ממצא 3 | `dev...HEAD` (merge-base) ‏ב-DoD#7/#8 |
| **`bun.lock` ‏חושף 3 lockfiles ‏מקומיים** | ‏סבב 5 ‏ממצא 3 | `!/bun.lock` + DoD#9/#13 (‏הראשון ‏מאמת ‏אפס lockfiles ‏ב-`src/`) |
| ‏"‏אפס ‏שינוי ‏פרודקשן" ‏רחב ‏מהכיסוי | ‏סבב 5 ‏ממצא 4 | DoD#7 (`src/`) **‏ו-**DoD#8 (`scripts/`) |
| ‏גבול "‏אפס ‏תלויות" ‏חוסם ‏ספריות ‏לנצח | ‏סבב 5 ‏ממצא 6 | ‏הגבול ‏הוא "‏רק ‏מוצהרות ‏ב-`dependencies`" |
| tsconfig ‏לא-עביר (TS1259/5096/5097/6305/6310) | ‏חזר ‏בכל ‏סבבי ‏האימות | 3 ‏קבצים ‏מקובעים, ‏הורצו ‏ב-**7.0.2** ‏וגם ‏ב-5.9.3/5.6.3 + escalation |
| ‏סקריפט-הגבול ‏ירוק ‏ריק (0 ‏קבצים) | ‏סבב 3 ‏ממצא 3 | `import.meta.dirname` + `checked N files` ‏ב-DoD#5 |
| ‏רצפת Node — ‏עדכון ‏מוקדם ‏מדי ‏של README | ‏סבב 3 ‏ממצא 5 + ‏הצמצום | Commit 3 ‏מפריד ‏פיתוח (AGENTS.md) ‏מפריסה (README, ‏לא ‏נגוע) |
| `bun run test` ‏איטי/flaky (CF ‏מריץ ‏בנייה ‏אמיתית + ‏רשת) | ‏סבב 1 ‏ממצא 9 | ‏מתועד ‏ב-§0; DoD#3 ‏שובר ‏ב-core |
| bun ‏משנה ‏פתרון ‏תלויות ‏לחבילות node | ‏מעבר ‏npm→bun | DoD#10/#11/#12 |
| `toRelative` ‏עם `[\\/]` | ‏סבב 2 ‏ממצא 3 | ‏מימוש ‏מחייב + ‏טסט 6 |
| ‏מחיקת ‏בלוק Bun ‏כולו ‏מ-.gitignore | ‏סבב 4 ‏ממצא 6 | ‏הבלוק ‏כתוב ‏במלואו ‏ב-Commit 1 |
| ‏מחרוזות ‏עברית ‏קשיחות | dev-conventions §3 | ‏אין ‏קוד-UI ‏ב-slice ‏הזה |

---

## §7 — Escalation triggers

- ‏ה-tsconfig ‏של Commit 1 ‏לא ‏עובר — **‏אל ‏תנחש ‏דגלים**
- `bun install` ‏שובר ‏חבילה ‏קיימת ‏ולא ‏נפתר ‏בדקות
- DoD#7 ‏לא ‏מתקיים (`git diff` ‏על `src/` ‏אינו ‏ריק) — ‏נגעת ‏בקוד ‏פרודקשן
- ‏פתחת 3+ ‏גישות ‏לאותה ‏בעיה ‏ואף ‏אחת ‏לא ‏עבדה
- ‏רצון ‏לסטות ‏מ-testing strategy
- **‏רצון ‏לגעת ב-`resolveSafe`, ‏או ‏להוסיף `@ow/core` ‏כתלות ‏לחבילה ‏קיימת** — ‏זה Slice R1

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| ‏תשתית/כלים ‏חדשים | +2 |
| >5 files ‏ב->2 packages | +1 |
| Greenfield, ‏אין call sites ‏קיימים | -1 |
| Pure logic, ‏אין IO | -2 |
| TDD ‏מלא (Commit 2) | -1 |
| ‏כלי-העבודה ‏נמדדו ‏בארבעה ‏סבבים | -1 |
| **‏אפס ‏שינוי ‏בקוד ‏פרודקשן** (DoD#7/#8) | -2 |
| ‏מעבר ‏מתקין ‏לכל ‏הריפו | +2 |

**‏בסיס 5** (‏ברירת-המחדל) **+ ‏סכום ‏המקדמים (−2) = 3**.

**Score**: **3** / 10 — `calev` (light) ‏בלבד, ‏ללא verifier-phase.

---

## §9 — ‏שאלות ‏פתוחות

| # | ‏שאלה | ‏ברירת ‏מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | `core` ‏ו-`node:path` | ‏כן — built-in, ‏אינו dependency | ❌ |
| 2 | ‏לינטר-גבול | ‏סקריפט, ‏לא eslint | ❌ |
| 3 | `src/client-mobile` ‏כ-workspace | ‏כן — ‏כדי ‏שהטסטים ‏שלו ‏ייתפסו ‏ב-`bun run test` | ❌ |
| 4 | ‏להסיר `package-lock.json` ‏של CF | ‏לא ‏ב-slice ‏הזה — scripts ‏שלו ‏משתמשים ‏ב-`npm run`/`npx` | ❌ |
| 5 | ‏למה `toRelative` ‏ולא ‏פונקציה ‏אחרת ‏ראשונה | ‏טהורה, ‏זעירה, ‏אפס ‏קוראים ‏קיימים — ‏מוכיחה ‏את ‏הצינור ‏בסיכון ‏אפס | ❌ |

---

## ‏סטיות ‏מהתכנון (‏מתעדכן ‏ע"י executor)

- ...
