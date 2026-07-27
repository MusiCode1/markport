# Walkthrough — obsidian-web

> יומן-ביצוע כרונולוגי (אליעזר). רציונל ארכיטקטוני חי ב-docs/decisions (ריפו brief-driven-slices), לא כאן.

## 2026-07-27 — slice/zero-patches — Commit 3: §3ד — `template.js:92` (ההצהרה הציבורית) + README

### מה בוצע?

**`src/deployments/cloudflare/template.js:92`** — זו ההצהרה שמופיעה בדף הדמו הציבורי
(§0א בבריף), והייתה שגויה כשנכתבה (patch עדיין היה קיים). אחרי Commit 1 היא נכונה
כשלעצמה ("completely unmodified"), אך §3ד מבקש גם לשקול משפט שמסביר *איך* מושג
התנהגות-הפלטפורמה בלי לגעת בקובץ — נוסף: "byte-for-byte identical to Obsidian's own
Android bundle, zero build-time patches" + משפט שמפנה ל-`client-mobile/platform-bridge.js`
(`Object.defineProperty` interception) כהסבר. **לא נגעתי ב-`platform-bridge.js` עצמו** —
רק בפרוזה שמתארת אותו.

**`README.md`** — ארבע ההצהרות שנשארו מ-Commit 2 (במכוון נדחו לכאן): שורות 7, 45, 106,
242 — "one documented patch remains" / "applies one documented build-time patch" /
"apply a small set of documented patches" → "zero build-time patches" /
"byte-identical to the APK" / "does not modify... unmodified", עם הפניה ל-
`client-mobile/platform-bridge.js` בשורה 106. שורות 110 ו-204 (הוראות למשתמש להריץ
`node scripts/update-obsidian-mobile.js && node scripts/patch-obsidian-mobile.js`)
**לא שונו** — הפקודה עדיין תקינה ובטוחה (patch-obsidian-mobile.js הוא no-op עם
`PATCHES=[]`), אין בה הצהרה שגויה.

### בדיקות

`bun test`: 143/138/5/4 — זהה. `node --check src/deployments/cloudflare/template.js` —
עבר (קובץ template literals עם JS מסביב).

### סריקה סופית (DoD#9) — אפס אתרים שמתארים patches שלא קיימים, היקף `obsidian-web`

```
grep -rniE "one documented (build-time )?patch|patch #4|the ONE remaining...|4 patches|3 of the 4 patches remain"
```
שני hits בלבד נותרו, שניהם תקינים במכוון:
- `docs/investigations.md:544` — בלוק היסטורי עם "עדכון 2026-07-27" שמצהיר נכון על ההווה.
- `AGENTS.md:56` — "4 patches that used to exist" (past tense, היסטורי, לא הצהרת-הווה).

### חריגות

- מוצא (א) (§1ג, אתרי-מתכון) קיים גם ב-`docs-repo` (ריפו נפרד) — **לא בהיקף הסלייס
  הזה** (DoD#9 מתוחם ל-`obsidian-web`). מדווח כאן כדי שמרדכי יפתח קומיט נפרד שם.

## 2026-07-27 — slice/zero-patches — Commit 2: §3ג — ניקוי תיעוד (רחב מ-grep על השם)

### מה בוצע?

חיפוש לפי מושג (`patch`, `unmodified`, `documented`, `4 patches`, `3 of the`,
`__owPlatformOverrides`, "still remains"/"patch #4"), לא לפי שם — היקף: ריפו `obsidian-web`
בלבד, `*.md`+`*.js`+`*.html`, מחריג `node_modules`/`.tmp`/`vendor`. תוקנו רק הצהרות
שמתיימרות לתאר את **ההווה**; יומן-חקירה היסטורי (`docs/investigations.md`, רובו) נשאר
כפי-שהיה, עם **הוספת** הערות-עדכון מתוארכות (לא שכתוב) באותו סגנון שכבר קיים בקובץ.

- **`AGENTS.md`** ("Before you touch the bundle") — "One patch... still remains" → אפס
  patches, `PATCHES=[]` כתשתית.
- **`docs/architecture.md`** — "patch יחיד ותיעודי" → "אפס patches", זהה-בייט ל-APK.
- **`PLAN.md`** (חמש הצהרות — נעדר מהבריף המקורי, נכנס בסבב 2): שורה 21 (מבנה תיקיות),
  §Mobile (שורות ~190-194), טבלת `Key files` (`vendor/obsidian-mobile/`,
  `update-obsidian-mobile.js`, `patch-obsidian-mobile.js`).
- **`src/client-mobile/shims/electron.js`** (הערת-קוד ליד `vault`/`vault-list`) —
  "patch #4, still in place" → מפנה ל-`platform-bridge.js`'s `isDesktopApp` locking.
- **`src/client-mobile/platform-bridge.js`** (הערת-כותרת) — "The 4th patch... is NOT
  replaced... until the vault-panel slice removes it" → "was NOT replaced... until
  zero-patches removed it outright".
- **`scripts/patch-obsidian-mobile.js`** (הערת-כותרת) — "down to ONE documented patch...
  blocked on a separate slice... see this patch's own doc block below" (הבלוק ההוא כבר
  לא קיים, נמחק ב-Commit 1) → מתאר את המצב הנוכחי (`PATCHES=[]`) ומפנה ל-"HOW TO FIX".
- **`src/client-mobile/boot.js`** (הערת-כותרת) — "patch יחיד ותיעודי... עדיין קיים" →
  "אפס build-time patches". **אתר שלא היה ברשימת-הדוגמאות של הבריף** — נמצא ע"י הסריקה
  הרחבה שהבריף דרש ("לא רשימה סגורה").
- **`docs/investigations.md`** — שורה 53 (סעיף "Current state", לא יומן-היסטורי — מתוקן
  ישירות, לא רק עדכון-מתוארך); הוספת "עדכון 2026-07-27" לשני הבלוקים ההיסטוריים (שורה
  ~544 ו-~780) שכבר נשאו "עדכון 2026-07-26"; **שלושת אתרי-המתכון** (§1ג, DoD#9 מוצא-א):
  - שורה 799 (Hooks bullet): `{ isMobile: false }` → `{ isMobile: false, isDesktop: true }`
  - שורה 1045 (דוגמת-קוד): אותו תיקון + הערה שמסבירה **למה** (`computeWant` גוזר
    `isDesktopApp` מ-`overrides.isDesktop`, לא מ-`overrides.isMobile`)
  - שורה 1058 (טבלת `layout-mode`, שורת `desktop`): אותו תיקון
  - ⚠️ שורה 1057 (שורת `mobile`) **לא** תוקנה — `{ isMobile: true }` בלבד אינו דיברגנטי
    (ראה מדידה למטה) — עקבי עם §8 בבריף (סבב 5, ממצא #7).

### אימות עצמאי של DoD#5א ומוצא (א) — למה התיקון נכון (לא רק "כי הבריף אמר")

הרצתי את `platform-bridge.js`'s `computeWant()` האמיתי (Node, לא בדפדפן) בשלוש צורות-קלט:

```
overrides={isMobile:false} בלבד            → want={isMobile:false, isDesktopApp:false}
                                              !isMobile===true  אבל  isDesktopApp===false
                                              ⇒ דיברגנטי (בדיוק כפי שהבריף טוען)
overrides={isMobile:false, isDesktop:true} → want={isMobile:false, isDesktopApp:true}
                                              !isMobile===true  ו-  isDesktopApp===true
                                              ⇒ לא דיברגנטי — התיקון עובד
overrides={isMobile:true} (המתכון ל-mobile) → want={isMobile:true, isDesktopApp:false}
                                              !isMobile===false ו-  isDesktopApp===false
                                              ⇒ לא דיברגנטי — למה שורה 1057 לא נזקקת לתיקון
```

וגם מסלול-המוצר האמיתי (`boot.js:252-259`, שני הצורות `layout.isMobile===true/false`):
שני הכיוונים מציבים `isMobile`/`isDesktop`/`isDesktopApp` בעקביות מלאה
(`isDesktop===isDesktopApp===!isMobile` תמיד) — **מאשש ישירות את DoD#5א**: הדיברגנציה
בלתי-נגישה ממסלול-מוצר, נגישה רק דרך המתכון הידני (מה שתוקן כאן).

בנוסף אימתתי מבנית את §1ד (המסלול השישי): `pump()` קורא ל-`capture(P)` (שורה 355)
**בלי try/catch** מסביבו; בתוך `capture()`, `isDesktopApp` הוא **האחרון** ברשימת
`LOCKED_FLAGS` (`['isMobile','isMobileApp','isDesktop','isDesktopApp']`) — חריגה מ-`orig()`
(`Object.defineProperty`) על אחד הדגלים הקודמים תשאיר את `isDesktopApp` לא-נעול בלי שה-
`reportCaptureFailure`/באנר יופעלו (ה-`finally` עדיין משחזר את `Object.defineProperty`,
אבל לא מגיע ל-warning). תיאורטי (תלוי שדגל אחד יהיה לא-`configurable` בבאנדל של Obsidian) —
לא נבדק בדפדפן חי, לא חוסם, מתועד כפי שהבריף דרש.

### בדיקות

`node --check` על כל 4 קובצי ה-JS שנגעתי בהם (`patch-obsidian-mobile.js`,
`platform-bridge.js`, `shims/electron.js`, `boot.js`) — עברו. `bun test` (מהשורש) —
143/138/5/4, **זהה** ל-baseline ולתוצאת Commit 1 (אין שינוי — אלו קבצי תיעוד/הערות,
`platform-bridge.js`'s own logic לא נגעתי בו, רק בהערת-הכותרת).

### חריגות

- `README.md` ו-`src/deployments/cloudflare/template.js:92` **לא** נגעתי בהם כאן —
  נדחו במכוון ל-Commit הבא (§3ד), יחד עם המשפט המפנה ל-`platform-bridge.js`
  שהבריף מבקש לשקול שם.
- מוצא (א) חוצה גם את ריפו `docs-repo` (אתרי-מתכון זהים שם) — **לא בהיקף הסלייס הזה**
  (DoD#9 מתוחם ל-`obsidian-web`); יתועד כאן כדי שמרדכי יפתח עבורו קומיט נפרד בריפו הנפרד.

## 2026-07-27 — slice/zero-patches — Commit 1: §3א+§3ב — מחיקת ה-patch האחרון מ-`PATCHES`

### מה בוצע?

- **`scripts/patch-obsidian-mobile.js`** — הוסר כליל האובייקט `vault-profile-on-desktop-layout`
  ממערך `PATCHES` (כולל ה-`find`/`replace`/`expectedMatches` וה-doc-comment הצמוד לו).
  `PATCHES = []`. בלוק `HOW TO FIX A BROKEN PATCH` בראש הקובץ **נשאר** — ידע תפעולי לגרסה
  הבאה, לפי §3ב בבריף. **הערת הכותרת של הקובץ (`As of ... down to ONE documented patch`)
  לא נגעתי בה כאן** — מתוקנת ב-Commit הבא (§3ג, ניקוי-תיעוד רחב).
- **`src/client-mobile/obsidian-version.js`** — נכתב-מחדש ע"י `update-obsidian-mobile.js`
  (קובץ generated); התוכן (`1.12.7`) לא השתנה, רק נוסח-ההערה שלו התעדכן ל-תבנית הנוכחית
  של הסקריפט (drift לא-קשור לסלייס הזה, אך תוצר-לוואי אמיתי של ההרצה — נשמר).

### DoD#0 — `applyPatches` על מערך ריק

`node scripts/update-obsidian-mobile.js --version 1.12.7` (מפורש) רץ **בלי לזרוק**, ולא
הדפיס אף שורת `patched: ...` (הלולאה על `PATCHES` ריקה) — "Done. obsidian-mobile/ is ready".

### DoD#1 — ה-hash הקובע

```
sha256(vendor/obsidian-mobile/app.js) = e4594089a106754dcc93575160351f5e0747255a8f7348be4b8be25417b91606
size                                  = 3,754,511 bytes
```

**זהה** ל:
1. הערך שהבריף הצהיר עליו (נמדד פעמיים ע"י אביגיל/מרדכי).
2. המדידה העצמאית שלי מ-`unzip` ישיר על `assets/public/app.js` מתוך `Obsidian-1.12.7.apk`
   (**לפני** הרצת הסקריפט כלל — ראה הערך למעלה ב-"קרקע המדידה").

`dev/vendor/obsidian-mobile/app.js` נשאר `4b1ccd3aaf7c6292fdb1c7d2dfca21e7f6272351354d4b797eb07b16257018cf`
— **ללא שינוי** — אומת שוב אחרי ההרצה הזו (DoD#7ב).

### ארבע הפקודות של §2א.3 — מדידה **אחרי** (על הבאנדל עם `PATCHES.length===0`)

```
grep -c 'window.__owPlatform='                     → 0
grep -c '__owPlatformOverrides'                     → 0
grep -c '!bn.isMobile){var i=e.vault.getName()'     → 0   (היה 1)
grep -c 'bn.isDesktopApp){var i=e.vault.getName()'  → 1   (היה 0)
```

**הזוג הדו-כיווני התהפך בשני הכיוונים** — השער עובר. (⚠️ `grep -c 'vault-profile'` **לא**
שימש כאן — הוא היה מחזיר `1` בשני המצבים דרך `workspace-sidedock-vault-profile`, מחלקת-CSS
של Obsidian, ולכן אינו יכול להיכשל — סבב 5 בבריף.)

### בדיקות

`bun test` (מהשורש, `/home/user/Projects/obsidian-web/worktrees/zero-patches`) — baseline
נמדד **על ה-base, לפני כל שינוי בסלייס**: **143 טסטים / 138 עוברים / 5 נכשלים / 4 שגיאות**
(אחרי `npm install` ב-`src/runtime-server/server` שהיה חסר ב-worktree הטרי — `express` וכו').
תואם בדיוק לטווח שהבריף מצטט (§4 DoD#8). אחרי הקומיט הזה: אותה תוצאה בדיוק (143/138/5/4) —
אין שינוי, כצפוי (זהו קובץ סקריפט build-time, אין לו טסט ייעודי; האימות האמיתי הוא ה-hash
+ ארבע ה-greps למעלה).

### חריגות

- `src/runtime-server/server/package-lock.json` השתנה (`npm install` הוסיף שדה `license`)
  — **הוחזר** (`git checkout --`) לפני commit, לא קשור לסלייס.
- אין חריגה מהותית אחרת. בדיוק לפי §3א+§3ב.

## 2026-07-27 — slice/zero-patches — קרקע המדידה (§2, לפני Commit 1)

### מה בוצע?

לפני כל שינוי קוד, לפי §2ב+§2א בבריף:

- **עותק מבודד**: `cp -a dev/vendor /tmp/zero-patches-vendor` ואז
  `ln -sfn /tmp/zero-patches-vendor worktrees/zero-patches/vendor`. **לא** נגעתי ב-`dev/vendor`
  ישירות — ה-symlink של הוורקטרי מצביע על `/tmp/...`, לא על `dev/vendor` (`readlink` אומת).
- **`sha256` של `dev/vendor/obsidian-mobile/app.js` — נמדד לפני, ונמדד שוב אחרי כל הרצה של
  `update-obsidian-mobile.js`**: `4b1ccd3aaf7c6292fdb1c7d2dfca21e7f6272351354d4b797eb07b16257018cf`
  לפני ואחרי, בלי שינוי — `dev/vendor` שרד את כל ההרצות בסלייס הזה.
- **מטמון ה-APK הועתק** מ-`dev/.tmp/cache/obsidian-releases/Obsidian-1.12.7.apk` (`.tmp/` הוא
  פר-worktree — לא משותף) ל-`worktrees/zero-patches/.tmp/cache/obsidian-releases/`, ואומת
  `sha256` זהה לשני הקבצים (`74a0741f…`) — נמנעה הורדה חוזרת (~15MB), אם כי הבדיקה גם אישרה
  שיש חיבור-רשת חי (`GET https://api.github.com/...` הצליח).
- **אימות עצמאי של DoD#1 לפני כל ריצת סקריפט**: `unzip` ישיר של `assets/public/app.js`
  מתוך ה-APK הנ"ל נתן `sha256 = e4594089a106754dcc93575160351f5e0747255a8f7348be4b8be25417b91606`
  ב-3,754,511 בתים — זהה לערך שהבריף הצהיר עליו, **לפני** שהרצתי סקריפט כלשהו של הפרויקט.

### הרצת `node scripts/update-obsidian-mobile.js --version 1.12.7` (מפורש — לא ברירת-מחדל)

הרצתי אותה **פעמיים**:

1. **לפני §3א** (`PATCHES` עדיין מכיל את `vault-profile-on-desktop-layout`): הבנייה הטרייה
   (מ-APK, לא ממטמון-vendor) הפיקה `sha256 = 4b1ccd3aaf7c6292fdb1c7d2dfca21e7f6272351354d4b797eb07b16257018cf`
   — **זהה** לערך שנמדד ע"י מרדכי ב-§2 של הבריף. מאשר: סקריפט-ה-patch של הענף הזה
   (`slice/desktop-layout-now`'s script, שממנו נוצר `slice/zero-patches`) עדיין תואם, ו-1
   התאמה ל-regex (כצפוי, `expectedMatches: 1`).
2. **אחרי §3א** (ראה למטה) — `sha256 = e4594089…`, DoD#1.

### ארבע הפקודות של §2א.3 — מדידה **לפני** (על הבאנדל עם ה-patch עדיין בפנים)

```
grep -c 'window.__owPlatform='                     → 0
grep -c '__owPlatformOverrides'                     → 0
grep -c '!bn.isMobile){var i=e.vault.getName()'     → 1
grep -c 'bn.isDesktopApp){var i=e.vault.getName()'  → 0
```

תואם למצופה: ה-patch עדיין הופך `bn.isDesktopApp` ל-`!bn.isMobile`.

## 2026-07-27 — slice/desktop-layout-now — סבב-תיקון §10א: חיווט `window.electronWindow` (calev NO-GO ממצא #1)

### מה בוצע?

- **`src/client-mobile/shims/electron.js`** — נוצר `mainWindowInstance = makeWindow()` **instance
  יחיד** (לא factory), מוגדר ליד `webContentsInstance`. `remote.getCurrentWindow()` הוחלף
  מ-`makeWindow` (יצר proxy חדש בכל קריאה) ל-`() => mainWindowInstance` (אותו אובייקט תמיד).
  בסוף הקובץ נוסף `global.electronWindow = mainWindowInstance` — **נקודת-חשיפה שלישית**,
  לצד `global.electron`/`global.__owElectron` הקיימים.

### למה זה תיקן את הרגרסיה שכלב הוכיח A/B

§5ב בבריף המקורי טען ש"הבאנדל מציב את `window.electronWindow` בעצמו מ-
`remote.getCurrentWindow()`" — **מדידה שגויה**. בדקתי בבאנדל: הפונקציה שעושה את ההצבה הזו
(`e.electronWindow=i.remote.getCurrentWindow()`) יושבת בתוך `v$`, שרץ **רק על חלונות-בת**
(popout/print-preview — מחוץ ל-scope, `canPopoutWindow` נעול `false`). על **החלון הראשי**
שום דבר בבאנדל לא מציב את הגלובל — ב-Electron האמיתי preload script עושה את זה לפני
שהרנדרר-סקריפט רץ. `WorkspaceRoot.prototype.focus` (`Px.prototype.focus`) קורא
`this.win.electronWindow`, וב-`this.win === window` לחלון הראשי — ולכן ללא ההצבה, כל קריאה
ל-`openFile`/`revealLeaf`/`setActiveLeaf(...,{focus:true})` בזמן ש-`document.hasFocus()===false`
זרקה `TypeError: Cannot read properties of undefined (reading 'isMinimized')`.

### שחזור חי לפני התיקון (git stash) ואימות אחריו

הרצתי Chromium/Playwright מול `http://127.0.0.1:3593/vault/0000demo0000demo` (layout=desktop,
`serviceWorkers:'block'`), עם `document.hasFocus` מוחלף ל-`() => false` (ללא stubbing נוסף) —
אותה שיטת-שחזור שכלב תיעד ב-`22-iframe-unfocused.png`:

| | לפני התיקון (`git stash`) | אחרי התיקון |
|---|---|---|
| `typeof window.electronWindow` | `"undefined"` | `"object"` |
| `app.workspace.rootSplit.focus()` | **THROW** `TypeError: … reading 'isMinimized'` | no throw |
| `leaf.openFile(f)` | **THROW** אותה שגיאה, הקובץ לא נפתח | no throw, `activeFile === 'CalevProbe2.md'` |

בנוסף אימתתי ישירות שכל שיטות ה-alias שכלב ציין (`isMinimized`/`restore`/`isMaximized`/
`unmaximize`/`minimize`/`setAlwaysOnTop`/`maximize`/`show`/`isFocused`/`isFullScreen`/
`webContents`) וגם `remote.systemPreferences.getUserDefault`/`remote.app.relaunch` — כולן
לא זורקות על `window.electronWindow` (היו כבר ממומשות ב-`makeWindow()`/`remote` מקומיים —
החוט החסר היה רק בין `makeWindow()` לגלובל, כפי שדוח כלב אבחן: "צרכן ומוצא לב תקינים,
הצנרת ביניהם לא נמתחה").

### מדידה עצמאית (לא הסתמכתי על רשימת הבריף)

הבריף הזהיר שגריפ נאיבי על `electronWindow` פספס 7 שיטות שנקראות דרך alias
(`var w = this.win.electronWindow`). בדקתי ידנית בבאנדל את כל אתרי-הקריאה (11 מופעים) —
כל השיטות שנקראות עליו כבר קיימות ב-`windowMethodReturns`/`windowStatefulMethods` הקיימים
(שהיו שם עוד מ-Commit 2); לא נדרשה תוספת לטבלאות עצמן, רק חיווט הגלובל.

### בדיקות

- `bun test` תחת `src/client-mobile` — 86 pass / 0 fail (ללא שינוי במספר — הקובץ הזה אין לו
  טסטים ייעודיים; האימות האמיתי הוא ריצה חיה בדפדפן, כמתואר למעלה).
- `node --check` על `shims/electron.js` — עבר.

### חריגות

- אין. תיקון ממוקד, בדיוק לפי §10א בבריף.

## 2026-07-27 — slice/desktop-layout-now — סבב-תיקון §10ב: מדידה+תיעוד DoD#15 (calev NO-GO ממצא #2)

### מה בוצע?

- **`docs/investigations.md`** — שלושה ערכים חדשים תחת "בעיות פתוחות" (B-006/B-007/B-008),
  לפי §10ב בבריף ("שלושת הנושאים, ל-`docs/investigations.md`"):
  1. **B-006 — שער `isDesktopOnly` נפתח**: פלאגין `isDesktopOnly:true` עובר מ"סירוב מנומק +
     תווית Unsupported" ל"נטען, ואז נופל מאוחר יותר על API לא-ממומש (`require('fs')===undefined`)".
  2. **B-007 — `<webview>` בקנבס/Web Viewer**: `document.createElement('webview')` הוא
     `HTMLUnknownElement` בדפדפן (אין `isLoading`/`loadURL`/`getWebContentsId`) — אך הפלאגין
     הפנימי `webviewer` כבוי כברירת-מחדל, ולכן הנתיב השבור לא נגיש היום.
  3. **B-008 — מפתחות `sec:`**: אין רגרסיה — טאב "Keychain" קיים גם ב-base (`717d193`),
     18 טאבי-הגדרות זהים בין base לסלייס.

### מדידה עצמאית (לא הועתק מדוח כלב)

- **B-006**: grep ישיר על `vendor/obsidian-mobile/app.js` — שני אתרי-הקריאה
  (`!bn.isDesktopApp&&u.isDesktopOnly` / `!bn.isDesktopApp&&n.isDesktopOnly`) + אימות-חי:
  שתלתי פלאגין `isDesktopOnly:true`, `enablePlugin()` החזיר `true`, `require('fs')` בתוכו
  `undefined`.
- **B-007**: אימות-חי — `document.createElement('webview').constructor.name ===
  'HTMLUnknownElement'`, `.isLoading`/`.loadURL` שניהם `undefined`; `app.internalPlugins
  .plugins.webviewer.enabled === false`.
- **B-008**: הרצתי שרת נפרד על ה-**base** (`worktrees/runtime-platform-descriptors`,
  commit `717d193`, port 3594) והשוויתי את רשימת טאבי ה-Settings מול הסלייס (port 3593) —
  18/18 זהים בייט-בבייט (לא הסתמכתי על ההשוואה שכלב כבר עשה).

### בדיקות

- `bun test` תחת `src/client-mobile` — 86 pass / 0 fail (ללא שינוי — commit תיעוד בלבד).

### חריגות

- אין. §10ב מפורש: "למדוד ולתעד — לא לחסום. אין כאן שינוי התנהגות" — שלושתם תועדו כפתוחים,
  לא תוקנו.

## 2026-07-27 — slice/desktop-layout-now — סבב-תיקון §10ג: תיקון DoD#14 — הבדיקה המכריעה הישנה הייתה ריקה בלינוקס (calev NO-GO ממצא #3)

### מה בוצע?

- **`docs/walkthrough.md`** — תוקנה רשומת Commit 6 (DoD#14): הטענה "קליק כפול על כותרת-טאב
  מפעיל בפועל state אמיתי" סומנה במפורש כירוק-מזויף, עם הפניה לממצא ולתיקון.
- **אין שינוי קוד** — §10ג הוא תיקון-בדיקה (methodology), לא באג-קוד: הקוד עצמו
  (`makeWindow()`, alias-methods, `remote.systemPreferences`) היה תקין כל הזמן; מה
  שהיה שגוי הוא **הבדיקה שקבעתי כ"מכריעה"** ב-DoD#14 המקורי.

### הבעיה שנמצאה (NF3 בדוח כלב)

`DoD#14`'s "הבדיקה המכריעה" המקורית — "קליק כפול על כותרת-טאב, לא זורק TypeError" —
**ריקה בלינוקס**: הבאנדל רושם את ה-listener הזה רק תחת
`function Ox(e){ bn.isMacOS && bn.isDesktopApp && e.addEventListener("dblclick", …) }`.
בלינוקס `bn.isMacOS===false` ⇒ ה-listener **לא נרשם בכלל** ⇒ הקליק-הכפול "עבר" כי אין
שום קוד שמאזין לו ויכול לזרוק — לא כי `window.electronWindow` היה תקין. **בדיוק באותו
רגע `window.electronWindow` היה `undefined`** (ראה §10א למעלה) — כלומר ה-DoD "עבר" בזמן
שהפיצ'ר שהוא אמור לבדוק היה שבור.

### הבדיקה המכריעה החדשה — כבר בוצעה ותועדה ב-§10א

הבריף (§10ג) מגדיר את הבדיקה הנכונה: לגרום ל-`document.hasFocus()===false` (לא תלוי
`isMacOS`) ואז לקרוא `openFile`. **זו בדיוק הבדיקה שכבר בוצעה ותועדה בקומיט הקודם
(§10א)** — `document.hasFocus` הוחלף ל-`() => false`, `leaf.openFile(f)` נקרא, ואומת
"no throw" גם לפני התיקון (THROW, כדי להוכיח שהבדיקה אכן רגישה) וגם אחריו (no throw).
אין צורך לחזור על הריצה — היא כבר קיימת כעדות ב-commit של §10א
(Evidence: `/tmp/desktop-layout-now/phase-10a/after-fix.png`).

**בנוסף**, אימתתי גם את מסלול ה-macOS עצמו (הקוד שהיה "אמור" להיבדק על ידי הבדיקה
הישנה) ישירות מול `remote.systemPreferences.getUserDefault`/`window.electronWindow`
(ללא תלות ב-`bn.isMacOS`, שאין לו דרך-אמת בדפדפן): שתי הקריאות לא זורקות.

### בדיקות

- `bun test` תחת `src/client-mobile` — 86 pass / 0 fail (ללא שינוי — אין שינוי-קוד בקומיט הזה).

### חריגות

- אין שינוי-קוד ב-commit הזה, לפי §10ג — "פגם בבריף שלי", לא בקוד. התיקון הוא תיעודי
  (סימון הטענה השגויה + הפניה לבדיקה הנכונה שכבר בוצעה).

## 2026-07-27 — slice/desktop-layout-now — סיכום סלייס (כולל סבב-תיקון §10)

**עודכן אחרי calev-heavy NO-GO (13/17, 2 חוסמים+1 confusion) וסבב-תיקון ממוקד (§10,
3 commits נוספים — §10א/§10ב/§10ג, ראה למעלה).**

**11 commits** סה"כ (`slice/runtime-platform-descriptors..HEAD`): 8 המקוריים (§6 בבריף) +
3 מסבב-התיקון. **86 pass / 0 fail** (`bun test` תחת `src/client-mobile`, ללא שינוי מהסבב
הראשון — הסבב לא נגע בטסטים). **אימות-דפדפן חי** בשני הסבבים (Chromium/Playwright, Node
runtime-server, secure context).

**מה תוקן בסבב-התיקון (§10, לפי scope שאושר ע"י המשתמשת — שני האדומים בלבד)**:
- **§10א (blocker, רגרסיה מוכחת A/B)**: `window.electronWindow` לא היה מחווט לחלון הראשי
  ⇒ `TypeError` בכל `openFile`/`revealLeaf`/`setActiveLeaf` כש-`document.hasFocus()===false`.
  שוחזר חי לפני התיקון (`git stash`) ואומת שנעלם אחריו.
- **§10ב (blocker, spec-drift)**: DoD#15 ("מדידה ותיעוד") לא הופק כלל בסבב הראשון —
  הושלם עכשיו ב-`docs/investigations.md` (B-006/B-007/B-008), עם מדידה עצמאית
  (כולל הרצת שרת נפרד על ה-base להשוואת-אמת).
- **§10ג (תיעודי)**: DoD#14 המקורי ("קליק כפול על כותרת-טאב") תוקן — הבדיקה הייתה
  ריקה בלינוקס (ירוק-מזויף), הוחלפה בבדיקה לא-תלוית-פלטפורמה שכבר בוצעה כחלק מ-§10א.

**שלושה ממצאים צהובים מדוח calev — נשארו כחוב מתועד, במכוון, לפי הנחיית המשתמשת**:
NF4 (10 פקודות דסקטופ חדשות, חלקן no-op שקט), NF5 (§5א קוד-מת בחלון הראשי), NF6 (DoD#2
לא בר-אימות בסביבה מקומית). **לא טופלו בסבב הזה.**

**חריגה אחת מתועדת שנשארת ל-מרדכי**: תיקון `runtime-platform-descriptors.md` §3.2
(docs-repo) — לא בוצע ע"י אליעזר, לפי הקונבנציה בבריפי A/B הקודמים.

**מה עדיין פתוח (מוצהר בבריף עצמו, §9 שם, ומורחב ב-B-006/B-007/B-008)**: 76 מתוך 95
שימושי `isDesktopApp` בבאנדל לא נדגמו ישירות. שער `isDesktopOnly` **נפתח בפועל** (B-006 —
לא רק "פתוח לתיעוד", יש כאן שינוי-התנהגות מדוד). `<webview>` בקנבס (B-007) ומפתחות `sec:`
(B-008) — מדידה/תיעוד בלבד, ללא רגרסיה.

פרטים מלאים בתתי-הרשומות למטה: §10א/§10ב/§10ג (סבב-התיקון, למעלה) ו-Commit 1 עד Commit 8
(הסבב המקורי, למטה).

---

## 2026-07-27 — slice/desktop-layout-now — Commit 8: תיעוד

### מה בוצע?

- **`docs/investigations.md`** — סעיף `window.__owPlatform` runtime API (§ "שני
  globals שונים — אל תבלבל ביניהם"): שתי הצהרות הפכו שקריות ותוקנו —
  1. `window.__owPlatform.isDesktopApp // false ב-mobile bundle תמיד` → תוקן לתאר את
     ההתנהגות הנוכחית (true בדסקטופ, false במובייל/אמולציה) + הפניה ל-§1.
  2. `LOCKED_FLAGS = ['isMobile','isMobileApp','isDesktop']` (שלושה, עם הערה
     "isDesktopApp נקרא ונענה בכוונה" — כלומר "מוותרים עליו במפורש") → עודכן לארבעה
     דגלים, ההערה השקרית הוסרה.
  **אותה מחלקת-טעות בדיוק כמו §1ג** (platform-bridge.js, Commit 5) — רק במסמך שני.

### חריגות (מתועד, לא מבוצע כאן)

- **§1ג מבקש גם תיקון ל-`runtime-platform-descriptors.md` §3.2** — מסמך ב-docs-repo
  (לא בריפו הקוד הזה). **לא בוצע ע"י אליעזר**, לפי הקונבנציה שנקבעה בבריפים
  הקודמים באותה שרשרת (`electron-shim-foundation.md`/`desktop-shell-shim.md` §6:
  "ב-docs-repo, mordechai מעדכן, לא בני-commit מהסלייס"). **מדווח כאן ומופנה למרדכי**
  (כבר סומן גם ב-Commit 5).
- שאר `docs/investigations.md` (טבלת ה-Electron IPC של ה-desktop bundle הארכיוני,
  §"Electron stubs שצריך לדעת") — **לא נגעו**: אלה הערות-חקירה היסטוריות על ה-desktop
  client (`archive/desktop-runtime`), לא הצהרות על המצב הנוכחי של `client-mobile/`,
  ותיקון מקיף שלהן חורג מ-scope הבריף (§1ג + הפניה בלבד).

### בדיקות

- `bun test` תחת `src/client-mobile` — 86 pass / 0 fail (ללא שינוי — commit תיעוד בלבד).

## 2026-07-27 — slice/desktop-layout-now — Commit 7: הסרת חטיפת-הקליק על vault-switcher

### מה בוצע?

- **`src/client-mobile/boot.js`** — הוסר בלוק ה-`document.addEventListener('click', ...,
  true)` שתפס קליק על `.workspace-drawer-vault-switcher` וחסם את ה-handler הנייטיב
  (עגן: "── Vault switcher click → openVaultChooser ──"). ה-handler הנייטיב עכשיו
  **פונקציונלי** (Commit 6 אימת: `vault`/`vault-list`/`vault-open` עובדים).
- **⚠️ שלוש שורות "נשארות"**, כנדרש בבריף (§6 Commit 7): דריסת `app.vault.getName` ·
  `refreshVaultProfileLabel` + הקריאה לה · ה-`<select>` "נהל כספות" (עגן:
  `o.value === 'manage-vaults'`, פקד-מובייל, לא קשור). **אף אחת מהשלוש לא נגעה.**
- עדכון הערה סמוכה (ליד `refreshVaultProfileLabel`) שהתייחסה ל-listener שהוסר —
  נכתבה מחדש כדי לא להטעות (ההזהרה מפני דריסת textContent על ה-switcher עצמו
  נשארת נכונה, רק ה"listener" שהיא מגנה עליו השתנה מהמיירט שהוסר לנתיב הנייטיב).

### בדיקות

- `node --check` על `boot.js` — עבר.
- `bun test` תחת `src/client-mobile` — 86 pass / 0 fail (ללא רגרסיה).
- **בדיקת-דפדפן חיה (DoD#5, שהיה חסום עד לקומיט הזה)**: קליק על
  `.workspace-drawer-vault-switcher` פותח **תפריט-DOM נייטיב** (לא שלנו — `class="menu"`
  הרגילה של Obsidian, `menu-grabber`/`menu-scroll`/`menu-group`) עם "Demo" **וסימן ✓**
  (`mod-checked`) על הכספת הנוכחית, ו-"Manage vaults..." שמנווט ל-`/starter` בקליק
  אמיתי. ✅ **בדיוק לפי DoD#5.**
- **רגרסיה במובייל**: `isMobile===true`, `<select>` הפוליפיל עדיין קיים ותקין, אפס
  שגיאות-קונסולה חדשות.

### חריגות

- אין.

## 2026-07-27 — slice/desktop-layout-now — Commit 6: אימות מלא בדפדפן

**סביבה**: Node runtime-server מקומי (`http://127.0.0.1:3577`, secure-context —
127.0.0.1 נחשב trustworthy), Chromium (Playwright 1.61.1 מקומי, headless), כספת דמו
OPFS (`0000demo0000demo`, נוצרת lazy דרך `/vault/0000demo0000demo`).
⚠️ `SYSTEM_PLUGINS_SEED_DISABLED=obsidian-livesync` נדרש כדי ש-livesync ייזרע מקומית —
ברירת-המחדל של השרת המקומי (לא CF) לא זורעת אותו כלל (התנהגות קיימת, לא קשורה לסלייס).

### מה נבדק ואומת (לייב, לא בקוד)

- **DoD#0** — `window.__owPlatform.isDesktopApp === true` בפריסת-דסקטופ, `=== false`
  בפריסת-מובייל (נבדק בקונסולה, לא דרך `require('obsidian')`). ✅
- **DoD#1** — ribbon, `.mod-left-split`, `.mod-right-split`, status bar קיימים;
  `.mobile-navbar`/`.mobile-toolbar` נעדרים; `is-mobile` נעדר מ-`body`. ✅
- **DoD#2** — `app.vault !== null`, `getName()==='Demo'`, `.workspace-leaf` קיים.
  ⚠️ `getFiles().length === 0` — **לא רגרסיה**: `example-vault.json` קיים רק ב-build
  של CF (מתועד כבר בקוד `boot.js`), אז כספת-הדמו המקומית ריקה במכוון בסביבת-הפיתוח
  המקומית. נבדק גם קרוא+כתיבה אמיתיים (DoD#9, ראה למטה) שמוכיחים שהכספת אכן פעילה.
- **DoD#3** — `resourcePathPrefix === "file:///"`, "Show debug info" מציג
  `API version: 1.12.7` (לא ריק) ואין "installer version too low"/"Manual update
  required". ✅
- **DoD#4** — `canExportPdf === false`, `canPopoutWindow === false` **קפדני**. ✅
- **DoD#7** — קליק-ימני בתוך העורך פותח `.menu.mod-context` (הבדיקה המכריעה של
  §2.6א — לפני התיקון היה "לא קורה כלום"). ✅
- **DoD#8** — מעבר `mobile`/`desktop`/`auto` (localStorage + reload) — כל שלושתם
  עקביים (`isMobile`/`isDesktopApp`/`is-mobile`/`.mobile-navbar` תואמים), אפס שגיאות. ✅
- **DoD#9** — יצירת קובץ + הקלדה אמיתית בעורך (מקלדת, לא API בלבד) + reload —
  התוכן שרד. ✅
- **DoD#11** — `obsidian-livesync` מופעל ידנית (`enablePluginAndSave`) — אפס שגיאות
  חדשות. `window.require('electron')` (הנתיב שפלאגין-real מקבל) מחזיר אובייקט אמיתי
  עם `ipcRenderer`. ✅
- **DoD#12** — הזרקת `delete window.__owPlatformOverrides` (route interception על
  בקשת `app.js`, לפני שהוא רץ — **חובה** `serviceWorkers:'block'` בקונטקסט, אחרת
  ה-SW עוקף את ה-interception) → הבאנר `#ow-platform-warning` מופיע עם הטקסט הנכון,
  `isDesktopApp === false` (לא נעול, לא crash). ✅
- **DoD#13** — הדלקת `nativeMenus` (`vault.setConfig` + `saveConfig()` + reload,
  1000ms debounce על `requestSaveConfig` — נדרש להמתין/לקרוא ל-save מפורשות) → קליק-ימני
  על tab-header פותח `.menu.mod-context` (השim שלנו, `remote.Menu.buildFromTemplate`)
  **במיקום הקליק בדיוק** (לא 0,0). ✅ מאשש את תיקון §5ד.
- **DoD#14** — קליק כפול על כותרת-טאב לא זורק (מפעיל בפועל את
  `remote.systemPreferences.getUserDefault` → `electronWindow.isMaximized()`/`maximize()`
  — state אמיתי, לא no-op). כל שיטות ה-alias (`isMinimized`/`restore`/`isMaximized`/
  `unmaximize`/`minimize`/`setAlwaysOnTop`/`webContents`) נבדקו ישירות — אף אחת לא זרקה.
  `remote.app.relaunch()` לא זרק. ✅
  ⚠️ **תוקן 2026-07-27 (calev NO-GO ממצא #1+#3, §10א/§10ג)**: הטענה "מפעיל בפועל" הייתה
  **ירוק-מזויף** — ה-listener הזה רשום ב-`vendor/obsidian-mobile/app.js` תחת
  `bn.isMacOS&&bn.isDesktopApp` בלבד; **בלינוקס הוא לא נרשם בכלל**, אז הקליק-הכפול "עבר"
  כי אין מה שיזרוק, לא כי `electronWindow` עבד. ה-alias-methods שכן נבדקו ישירות עדיין
  תקינים (זו לא הייתה שגיאה), אבל `window.electronWindow` עצמו **היה `undefined`** באותו
  רגע — ראה תיקון §10א למטה ואת הבדיקה המכריעה החדשה (§10ג).
- **DoD#5** — **נדחה במכוון ל-אחרי Commit 7** (כפי שהבריף דורש: חטיפת-הקליק ב-`boot.js`
  עדיין קיימת, ומפנה ל-`/starter` **דרך ה-`starter` channel שממומש כבר** — אישרתי את
  זה ישירות: קליק על `.workspace-drawer-vault-switcher` נחת על `/starter`, מוכיח
  ש-`sendSync('starter')` עובד).
- **מסך-בדיקה כללי (חלק מ-DoD#10)** — Settings, Command palette (`Ctrl+P`), Search
  (`Ctrl+Shift+F`), About tab — כולם נפתחים, אפס `pageerror` חדשות.

### רעש שאינו רגרסיה (נמדד ומתועד, לא תוקן)

- **"A network error occurred." × 8** ו-404 על שני קובצי `.woff2` — **מופיע גם
  בפריסת-מובייל הטהורה** (`isDesktopApp` לא מעורב כלל, נבדק ישירות) — רעש קיים-מראש
  של סביבת-הבדיקה הזו (ככל-הנראה fetch חיצוני שנכשל ברשת הסנדבוקס של הריצה), **לא
  רגרסיה מהסלייס הזה**.

### חריגות

- אין קוד חדש ב-commit הזה — אימות בלבד, לפי §6 Commit 6 בבריף.

## 2026-07-27 — slice/desktop-layout-now — Commit 5: הדלקת הדגל (isDesktopApp) + lockConst + עדכון טסטים + חיווט DoD#12

### מה בוצע?

- **`src/client-mobile/platform-bridge.js`**:
  - `LOCKED_FLAGS` — נוסף `'isDesktopApp'` (4 דגלים במקום 3).
  - `computeWant()` — **שני** מסלולי-היציאה מחזירים `isDesktopApp` עכשיו: מסלול
    ה-emulate-mobile (early return) → `isDesktopApp: false` **קפדני** · המסלול הרגיל →
    `isDesktopApp: !!overrides.isDesktop` (מגזרת isDesktop, לא נקרא מ-`overrides.isDesktopApp`
    ישירות — אותה גישה כמו isMobileApp הקבוע).
  - **§1ג** — ההערה שליד `LOCKED_FLAGS` נכתבה מחדש: כבר לא טוענת ש-`isDesktopApp` הוא no-op
    (זה היה נכון לפני שהיה shim ל-`window.electron`; עכשיו זה שקר).
  - **§4** — `lockConst(P, key, value)` חדש (אותה צורת `defineProperty`/`set` no-op כמו
    `lockFlag`, בלי תלות ב-`want`) — נקרא **תמיד** (בשני הענפים של `capture`, גם כש-`want`
    הוא `null`): `lockConst(P, 'canExportPdf', false)` ו-`lockConst(P, 'canPopoutWindow', false)`.
  - **DoD#12** — הענף `overrides-missing` (`want === null`) עבר מ-`warnOnce(...)`
    (console-only) ל-`reportCaptureFailure(...)` — עכשיו יש גם באנר-משתמש, לא רק console.warn.
- **`src/client-mobile/boot.js`** — `window.__owPlatformOverrides.isDesktopApp` עבר מ-`false`
  קבוע ל-`!layout.isMobile` (עקבי עם `isDesktop`). ההערה בת-3-השורות ליד השדה נכתבה מחדש
  (אותה מחלקה כמו §1ג — הנימוק הישן, "הריצה תמיד דפדפן", כבר לא נכון).
- **`src/client-mobile/test/platform-bridge.test.js`** (§1ד) — **6 ה-assertions שנשברו
  תוקנו** (לא נמחקו): 5× `deepEqual(want, {...})` קיבלו `isDesktopApp` בליטרל הצפוי ·
  ה-assertion של `LOCKED_FLAGS.sort()` עודכן ל-4 איברים. **נוספו 4 טסטים חדשים** (כיסוי
  מפורש ל-`isDesktopApp === false`/`=== true` בשני המסלולים, כולל את המקרה הקריטי של
  §1א — emulate מתוך overrides של desktop).

### בדיקות

- `bun test` תחת `src/client-mobile` — **86 pass / 0 fail** (עלה מ-84 → 86, מעל ה-baseline
  76 — DoD#16 "מספר טסטים ≥ base" מתקיים, בלי "רצפה" של מחיקת assertions).
- `node --check` על כל הקבצים שנגעו בהם — עבר.
- **טרם בוצעה בדיקת-דפדפן חיה** — DoD#0 (`Platform.isDesktopApp`), DoD#4
  (`canExportPdf`/`canPopoutWindow`), DoD#12 (הזרקת `undefined` ל-`__owPlatformOverrides`
  ובדיקת הבאנר) דורשים סביבה חיה — Commit 6.

### חריגות

- **מתועד ולא מבוצע ע"י אליעזר**: §1ג מבקש גם לתקן את `runtime-platform-descriptors.md`
  §3.2 (המסמך ב-docs-repo, לא בריפו הזה) — לפי הקונבנציה שנקבעה בבריפים הקודמים באותה
  שרשרת (`electron-shim-foundation.md`/`desktop-shell-shim.md` §6: "ב-docs-repo, mordechai
  מעדכן, לא בני-commit מהסלייס"), התיקון הזה מדווח כאן ומופנה למרדכי, לא מבוצע כ-commit
  בריפו הקוד.

## 2026-07-27 — slice/desktop-layout-now — Commit 4: ערוצי vault*/starter/help + context-menu round-trip + clipboard.readImage

### מה בוצע?

- **`shims/electron.js`** — `sendSync`:
  - `vault` → `{ path: api.vaultPath(__owVaultId, (registry.get(id)||{}).name) }`.
  - `vault-list` → מפה `{ [id]: {path} }` על `registry.list()` (רק local/folder — server
    לא מופיע, מוסכם ב-desktop-shell-shim.md §2.4).
  - `vault-open` → מחלץ `id` מ-`/^\/ow\/([^/]+)\//` (שם-כספת עשוי להכיל `/`, לא נסמכים על
    שאר המחרוזת), מנווט ל-`/vault/<id>` (setTimeout-0), **מחזיר `true` בדיוק**.
  - `starter` → `location.href = '/starter'`. `help` → `window.open('https://help.obsidian.md/')`.
  - `vault-remove`/`vault-move` — **לא מומשו בכוונה** (0 קריאות בבאנדל, נמדד).
- **`send('context-menu')`** — שודרג מ-no-op שקט ל-**round-trip אמיתי**: מגיב ב-microtask
  עם `{webContentsId, editFlags:{canCut,canCopy,canPaste,...}, misspelledWord:''}` דרך
  `ipcRenderer.emit`. בלעדיו — תפריט-ההקשר בעורך "לא קורה כלום" (§2.6א, מצב-כשל שקט).
- **`remote.webContents.fromId`/`getFocusedWebContents`** — מחזירים עכשיו את
  `webContentsInstance` האמיתי (לא `null`) כדי ש-`.cut()`/`.copy()`/`.paste()` על
  תוצאת ה-context-menu round-trip לא יזרקו.
- **`clipboard.readImage()`** — **סינכרוני** (לא Promise — הבאנדל קורא בלי await), מחזיר
  `nativeImage` ריק (`isEmpty()===true`) כדי שנתיב ה"הדבקת תמונה" ידלג בחן במקום לזרוק.

### בדיקות

- `node --check` על `shims/electron.js` — עבר.
- `bun test` תחת `src/client-mobile` — 84 pass / 0 fail (ללא רגרסיה; אין עדיין טסטים
  ייעודיים ל-electron.js — האימות האמיתי בדפדפן, Commit 6).

### חריגות

- אין.

## 2026-07-27 — slice/desktop-layout-now — Commit 3: EISDIR בשורש-הכספת + api.vaultPath + בדיקות-יחידה

### מה בוצע?

- **`src/client-mobile/vault-root-path.js`** (חדש) — `isVaultRootPath(p)`, לוגיקה טהורה
  (בלי DOM), דפוס dual-export זהה ל-`bootstrap-lookup.js`. מנרמל trailing slashes ובודק
  `''`/`'.'` אחרי נירמול — **לא** `path === ''` בלבד (electron-shim-foundation.md §3.3:
  הנתיב שנמדד בפועל הוא `"<id>//"`, לא `""`).
- **`src/client-mobile/shims/capacitor-shim.js`** — ה-`Filesystem` Proxy (get trap) עוטף
  את `readFile` ספציפית: אם `fullPath(opts)` הוא שורש-הכספת → `Promise.reject(EISDIR)`
  במקום להמשיך ל-backend (server/local/folder — התיקון מגן על שלושתם דרך נקודת-ההשתלה
  היחידה). שאר המתודות (כולל ה-`bind`) לא נגעו.
- **`src/client-mobile/local-vault-registry.js`** — `api.vaultPath(id, name)` →
  `'/ow/' + id + '/' + (name || id)`. חתימת שני-ארגומנטים במכוון (§3.4: `get(id)` לא מחזיר
  `id`, כך ש-`vaultPath(get(id))` היה נותן `/ow/undefined/<name>`).
- **`src/client-mobile/index.html`** — תג script חדש ל-`vault-root-path.js?v=1`, אחרי
  `local-vault-registry.js`/`opfs-store.js`/`folder-handle-store.js` ולפני `capacitor-shim.js`.
- **בדיקות-יחידה חדשות**: `test/vault-root-path.test.js` (שורש: `''`/`'/'`/`'.'`/`'//'`/`'///'`
  → root; `'Welcome.md'`/`'Features/Backlinks.md'`/`'.obsidian/...'`/`'Features/'` → **לא**
  root) · תוספת ל-`test/local-vault-registry.test.js` עבור `vaultPath` (כולל fallback ל-id).

### בדיקות

- `bun test` תחת `src/client-mobile` — **84 pass / 0 fail** (עלה מ-76 — 8 טסטים חדשים).
- `node --check` על כל הקבצים שנגעו בהם — עבר.

### חריגות

- אין.

## 2026-07-27 — slice/desktop-layout-now — Commit 2: shims/electron.js (seed + §5א/§5ב) + boot.js רישום

### מה בוצע?

- **`src/client-mobile/shims/electron.js`** (חדש, 510→~530 שורות) — seeded מ-
  `archive/desktop-runtime:src/client/shims/electron.js`, עם השינויים המחייבים
  (electron-shim-foundation.md §3.1): הסרת **כל** מופעי `__owSyncJson` (טבלת-ערוצים
  מקומית עם תשובה קנויה במקום XHR לשרת שלא קיים) · `remote.safeStorage` (4 מתודות) ·
  export כפול (`window.electron` **וגם** `global.__owElectron`, אותו אובייקט) ·
  `getCurrentWebContents().session.availableSpellCheckerLanguages` · הסרת ה-short-circuit
  של `__owBootstrapCache.electron` · `nativeImage` + `clipboard.writeImage` (לא מגודר-דגל,
  Web Viewer "העתק תמונה").
- **§5א** — `sendSync('frame')` מחזיר **תמיד** `'native'`, ללא תלות בכתיבה דרך Settings
  (דריסה מפורשת ומתועדת של `electron-shim-foundation.md` §3.2, שקבע `'hidden'`).
- **§5ב** — `makeWindow()` נשאר Proxy יחיד (מותר ע"י foundation) אך עם טבלה מורחבת:
  המתודות שנמדדו דרך alias (`isMinimized`/`restore`/`isMaximized`/`unmaximize`/`minimize`/
  `setAlwaysOnTop`) מקבלות מימוש **stateful** אמיתי (לא סתם no-op), כדי שהגייט הכפול-קליק
  (`isMaximized()` אחרי `maximize()`) יתנהג בעקביות.
- **§5ג** — `remote.systemPreferences` (2 צרכנים: double-click-titlebar guard +
  `AudioRecorder.getMediaAccessStatus`), `remote.app.relaunch`/`quit` (quit עושה
  `location.reload()`; relaunch no-op — שני הכפתורים תמיד קוראים לשניהם ברצף).
- **§5ד** — `Menu.buildFromTemplate(...).popup()` נופל חזרה למיקום-עכבר אחרון
  (`lastPointer`, נעקב ב-`mousedown`/`contextmenu` capture) כש-`opts.x`/`opts.y` חסרים —
  שני אתרי-הקריאה בבאנדל מעבירים רק `{window}`.
- **`file-url` → `'file:///'`** — ערוץ top-level שרץ בכל עלייה (נשמט מהטיוטה הראשונה,
  נתפס בבדיקת ה-grep מול הבאנדל האמיתי; ראה "חריגות" למטה).
- **`vault-open`/`vault-remove`/`vault-move`** — לא מומשו (מוקצים ל-Commit 4 / נמחקו כקוד-מת
  לפי המדידה שאין קריאות בבאנדל).
- **`src/client-mobile/boot.js`** — `modules['electron'] = window.electron` (רישום
  ללא-תנאי, כמו כל שאר המפה) · `process.versions.electron = '30.0.0'` (ליטרל נושא-משקל —
  שלושה אילוצים בו-זמנית: `major>=13`, `>= '28.2.3'`, `major<40`).
- **`src/client-mobile/index.html`** — תג script חדש ל-`shims/electron.js?v=1`, אחרי
  `platform-bridge.js` ולפני `boot.js`.

### בדיקות

- `node --check` על `shims/electron.js` ו-`boot.js` — עבר.
- `bun test` תחת `src/client-mobile` — 76 pass / 0 fail (baseline; טסטים ייעודיים ל-electron.js
  לא נדרשים ב-DoD של הבריף — האימות האמיתי הוא בדפדפן, Commit 6).
- לא בוצעה עדיין בדיקת-דפדפן חיה (מתוכננת ל-Commit 6, per §6 בבריף — "אימות מלא בדפדפן").

### חריגות

- טיוטה ראשונית של הקובץ פספסה את ערוץ `file-url` (מטופל ב-§3.0 של
  electron-shim-foundation.md, לא בטבלת §3.2) — אותר ותוקן **לפני** ה-commit, ע"י גריפ ישיר
  מול `vendor/obsidian-mobile/app.js` (לא מתוך זיכרון של טבלת הבריף). בלעדיו
  `resourcePathPrefix` היה נשאר `''` (ברירת-המחדל הריקה), לא `'file:///'` — DoD#3 היה נכשל.
- **החלטה מתועדת**: `makeWindow()` נשאר Proxy (לפי היתר foundation "בדיוק אחד מותר"),
  לא הומר לאובייקט רגיל — למרות שדיווח-ה-dispatch הזהיר מ"Proxy גורף = truthy". הפתרון
  שיושם: לא שינוי המנגנון (Proxy), אלא הרחבת הטבלה המפורשת + תיקון root-cause האמיתי
  (`remote.systemPreferences` חסר לגמרי) — כי "isMaximizable" כבר היה בטבלה עם ערך נכון
  (`true`), לא ברירת-מחדל שגויה של ה-Proxy. מתועד גם בקוד עצמו (הערה מעל
  `windowMethodReturns`).

## 2026-07-27 — slice/desktop-layout-now — Commit 1: מקור-אמת לגרסת Obsidian

### מה בוצע?

- **`src/client-mobile/obsidian-version.js`** (חדש) — `window.__owObsidianVersion = '1.12.7'`, GENERATED,
  מקור-אמת יחיד לגרסה (docs/plans/electron-shim-foundation.md §3.0).
- **`scripts/update-obsidian-mobile.js`** — כותב את הקובץ הנ"ל מיד אחרי resolve הגרסה (לפני ההורדה),
  עם הודעת-console בולטת.
- **`src/client-mobile/shims/capacitor-shim.js`** — `App.getInfo().version` קורא עכשיו מ-
  `window.__owObsidianVersion` (עצלנית, בתוך גוף הפונקציה) במקום ליטרל `'1.12.7'` קשיח.
  Fallback ל-`'1.12.7'` נשאר, למקרה שהסקריפט לא רץ.
- **`src/client-mobile/index.html`** — תג script חדש ל-`obsidian-version.js?v=1`, לפני
  `shims/capacitor-shim.js` (וממילא לפני `boot.js`).

### בדיקות

- `node --check` על שלושת הקבצים הנוגעים ב-JS — עבר.
- `bun test` תחת `src/client-mobile` — 76 pass / 0 fail (baseline, לא נגעו בטסטים כאן).

### חריגות

- אין.
