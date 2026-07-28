# Slice — demo-origin-split — ‏בריף

> **‏תאריך**: 2026-07-28
> **‏סוג מסמך**: ‏בריף ביצועי לסלייס
> **‏סטטוס**: ‏הושלם (אליעזר, 2026-07-28) — 7 commits על `slice/demo-origin-split`
> (`966bf04`..`31c55c2`), כולל תיקון calev-heavy NO-GO אחד (2 ממצאים, Commit 3
> phase). ‏ראה `docs/walkthrough.md` לפירוט מלא פר-commit.
> **‏אימות אביגיל**: ✅ **READY** (‏סבב 3). ‏סבב 1: NEEDS-REWORK, 11 ‏ממצאים · ‏סבב 2:
> USABLE-AFTER-FIX, 3 ‏ממצאים · ‏סבב 3: 0 ‏ממצאים.
> ‏דוחות (‏**‏מחוץ לריפו** — `reports/` ‏היא תיקייה-אחות של `dev/`, ‏לא נתיב יחסי בגיט):
> `/home/user/Projects/obsidian-web/reports/obsidian-web/demo-origin-split-avigail.md`
> ‏ו-`…-round2-avigail.md`. ‏(‏רישיות: `Projects` ‏באות גדולה. `projects` ‏היא ספרייה אחרת.)
> **Dispatch**: ‏מותר לאליעזר רק אם `אימות אביגיל = READY`
> **Complexity**: 8/10 (verifier: **heavy**)
> **‏תלויות (`depends_on`)**: [] — ‏בנוי ישירות על dev
> **‏Base**: dev
> **‏Dev tip**: `71e4265`

---

## §0 — Pre-flight

### ‏תלויות (‏חובה)

**‏אין תלויות.** ‏הסלייס בנוי ישירות על `dev` (`71e4265`, ‏זהה ל-`main` ‏אחרי ה-release).

> 🔴 **‏הענף `slice/demo-and-docs-truth` (`bd736d6`) — ‏מוקפא בכוונה, ‏לא ימוזג.**
> (‏אביגיל סבב 1, ‏ממצא 1.) ‏הענף נוגע בכל קובץ שהסלייס הזה נוגע בו, ‏משנה את הסכמה
> ‏של `plugins` ‏ב-`deploy-config.json`, ‏ומחליף את בלוק ה-system-plugins ‏ב-`build-assets.sh`.
> ‏**‏אין לזה השלכה כאן**, ‏כי הוכרע ב-2026-07-27 ‏שהוא לא ימוזג: ‏4 ‏הקומיטים השימושיים שלו
> ‏כבר נכנסו ל-dev ‏דרך `client-only-resilience`, ‏ו-19 ‏הנותרים מתארים מציאות של 4 patches
> ‏בעוד היום יש 0 — ‏מיזוגם היה מכניס הצהרות-שווא חדשות. ‏`depends_on` **‏ריק בכוונה**.
>
> ⚠️ **‏אליעזר: ‏אל תמזג, ‏אל תעשה rebase, ‏ואל תשאב שינויים מהענף ההוא.** ‏אם נראה לך
> ‏שאתה חייב משהו ממנו — ‏זה escalation (§7), ‏לא החלטה שלך.

### Worktree

‏הריפו הזה הוא **bare repo** ‏עם worktrees ‏אחיות — ‏השתמש בנתיב אבסולוטי, ‏והתיקייה היא
`worktrees/<name>` (‏**‏לא** `.worktrees/`, ‏זו הקונבנציה בפרויקט הזה — ‏ראה `git worktree list`):

```bash
cd /home/user/Projects/obsidian-web/dev
git worktree add /home/user/Projects/obsidian-web/worktrees/demo-origin-split \
  -b slice/demo-origin-split dev
cd /home/user/Projects/obsidian-web/worktrees/demo-origin-split
```

‏אין `pnpm install` ‏ברמת הריפו — ‏ראה "‏איך להריץ".

### ‏איך להריץ

| | |
|---|---|
| ‏בניית CF | `cd src/deployments/cloudflare && npm run build` (‏= `bash scripts/build-assets.sh`) |
| ‏טסטים CF | `cd src/deployments/cloudflare && bun test test/*.test.js` |
| ‏טסטים client | `cd src/client-mobile && npm test` (node:test) |
| ‏פלט הבניה | `.tmp/deployments/cloudflare/public/` (‏gitignored, ‏מחוץ ל-`src/`) |
| ‏העלאה | `npx wrangler pages deploy .tmp/deployments/cloudflare/public --project-name=<proj> --branch=<b> --commit-dirty=true` |

> ⚠️ **`vendor/` ‏הוא gitignored ‏ונדרש לבניה.** ‏אם `vendor/obsidian-mobile/app.js` ‏חסר
> ‏ב-worktree החדש — ‏ראה `AGENTS.md`; ‏אל תוריד את הבאנדל מחדש בלי צורך, ‏אפשר להעתיק
> ‏מ-`dev/vendor/`. **‏אל תוסיף אותו ל-git ‏בשום מצב.**

### Browser

‏אימות ידני ב-Chromium דרך `playwright-cli` ‏מול הבניה המקומית (‏ראה DoD §5).
‏אין צורך ב-linux-gui.

### Reading list

**must-read**:
- `src/client-mobile/boot.js` — ‏שורות 96-146 (‏ניתוב-כניסה + `ensureDemo`), 875-925
  (‏כפתור "‏כספת דמו" ‏במסך ה-onboarding), 1330-1375 (‏שער הזריעה `isVaultEmptyForSeed`)
- `src/client-mobile/seed-example-vault.js` — ‏כל הקובץ (46 ‏שורות)
- `src/client-mobile/deploy-config.js` — ‏בייחוד `DEFAULTS` (‏שורות ~35-44) ‏ו-`deepMerge`
- `src/deployments/cloudflare/scripts/build-assets.sh` — ‏שורות 39 (`CONFIG_PATH`),
  **100-160** (‏שתי ההזרקות — ‏גוף ההזרקה השנייה נמשך עד 160, ‏לא עד 140),
  198-216 (‏צעד LiveSync — ‏מקור אי-דטרמיניזם, ‏ראה DoD#7), 233-236 (‏בניית `example-vault.json`)
- `src/deployments/cloudflare/test/build-assets.test.js` — ‏שתי בדיקות ה-snippet
  ‏**‏בייט-בבייט** (‏שורות ~60-90). ‏שינוי snippet ‏= ‏שינוי טסט, ‏באותו commit.
- `src/client-mobile/test/deploy-config.test.js` — ‏שורות 16-25. ‏**‏הטסט הזה ייכשל
  ‏ב-Commit 0 ‏אם לא תעדכן אותו** (‏ראה שם).

**reference**:
- `src/deployments/cloudflare/template.js` — `TEMPLATE_FILES` (‏תוכן הדמו)
- `src/deployments/cloudflare/index.js` — ‏ניתוב ה-Worker
- `src/client-mobile/test/seed-example-vault.test.js` — 5 ‏בדיקות קיימות שחייבות להישאר ירוקות

### ‏מקורות חיצוניים

- Cloudflare Pages — preview deployments:
  https://developers.cloudflare.com/pages/configuration/preview-deployments/
  **‏מסקנה מחייבת-עיצוב**: ‏כל פריסת preview מקבלת `X-Robots-Tag: noindex` ‏אוטומטית
  (‏נמדד בפועל: `dev.obsidian-online.pages.dev` ‏מחזיר את ה-header, ‏הפרודקשן לא).
  ‏דומיין מותאם מחובר ל**‏ענף הפרודקשן** ‏של הפרויקט. ⇒ ‏הדמו מקבל **‏פרויקט Pages משלו**
  ‏ולא alias של ענף. ‏**‏אליעזר לא נוגע בטופולוגיה** — ‏ראה §2.

---

## §1 — ‏מטרה

‏מבקר שמגיע לדומיין **‏הראשי** ‏רואה מסך יצירת-כספת נקי — ‏אין כספת `Demo` ‏ברשימה, ‏אין
‏זריעת תוכן, ‏אין שום עקבה של דמו ב-OPFS שלו. ‏מבקר שמגיע לדומיין **‏הדמו** ‏נוחת ישירות
‏בתוך כספת עובדת עם התוכן העדכני — ‏בלי מסך-ביניים, ‏בלי אישור, ‏בלי לחיצה. ‏שתי החוויות
‏נבנות מ**‏אותה בניה**, ‏ונבדלות אך ורק ב-profile ‏קונפיג שנבחר בזמן ה-build ‏דרך משתנה
‏סביבה — ‏כך ששום התנהגות לא יכולה להיסחף בין הפריסות בלי שתופיע ב-`git diff`.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| `OW_PROFILE` ‏בוחר קובץ קונפיג בזמן build | ✅ | ‏בסלייס הזה |
| profile `demo` — ‏דמו פעיל, ‏זריעה, ‏פתיחה-אוטומטית | ✅ | ‏בסלייס הזה |
| ‏ברירת-המחדל (‏ללא `OW_PROFILE`) — ‏אפליקציה בלי דמו | ✅ | ‏בסלייס הזה |
| ‏זריעה-מחדש של קבצי הדמו כשהתוכן בשרת השתנה | ✅ | ‏בסלייס הזה |
| ‏קישור מהדמו לפריסה הראשית | ✅ | ‏בסלייס הזה |
| ‏סקריפטי פריסה נפרדים + ‏שומר נגד דגל-דמו בפרודקשן | ✅ | ‏בסלייס הזה |
| **‏יצירת פרויקט Pages שני / ‏חיבור דומיין / DNS** | ❌ | **‏ידני, ‏מרדכי + ‏המשתמשת אחרי merge** |
| **‏פריסה בפועל לכתובת ציבורית כלשהי** | ❌ | ‏אחרי merge, ‏באישור מפורש |
| ‏באנר "‏לרענן את תוכן הדמו?" | ❌ | ‏בוטל — ‏זריעה-מחדש אוטומטית מייתרת אותו |
| ‏ניקוי כספת Demo אצל מבקרים ותיקים | ❌ | ‏בוטל — ‏הדומיין הראשי חדש ומעולם לא פורסם |
| ‏כספת דמו נדיפה / read-only | ❌ | ‏נדחה — ‏הדמו נשאר OPFS רגילה במקור נפרד |

> **‏למה הטופולוגיה מחוץ ל-scope**: ‏יצירת פרויקט, ‏חיבור דומיין ו-DNS הן פעולות בדשבורד
> ‏שאינן ניתנות לאימות מתוך worktree ‏ואינן הפיכות בלחיצה. ‏הקוד **‏זהה** ‏בכל טופולוגיה
> ‏שתיבחר — ‏רק היעד של `wrangler pages deploy` ‏משתנה.

---

## §3 — Architecture

```
                    ‏בניה אחת, ‏שני profiles
                    ─────────────────────────
  src/config/deploy-config.json         ← ‏האפליקציה (‏ברירת-מחדל)
  src/config/deploy-config.demo.json    ← ‏הדמו            ‏חדש
                    │
                    ▼
        build-assets.sh   OW_PROFILE=demo ?     ← ‏משתנה, ‏שורה 39
                    │
                    ├── ‏מזריק window.__owConfigInjected  (‏קיים)
                    └── ‏מזריק window.__owDemoContent=<hash>  ‏חדש
                    │
                    ▼
        .tmp/.../public/  ──────►  wrangler pages deploy
                    │
      ┌─────────────┴─────────────┐
      ▼                           ▼
  ‏ברירת-מחדל                    OW_PROFILE=demo
  demoVault.enabled=false       demoVault.enabled=true
  seedExampleContent=false      seedExampleContent=true
                                demoVault.autoOpen=true

                    ‏בזמן ריצה — boot.js
                    ────────────────────
  /  ──► autoOpen?  ──‏כן──►  /vault/<demoId>          ‏חדש
        │
        └──‏לא──►  ‏כספת-אחרונה ‏או /starter            (‏קיים)

  /vault/<demoId> ──► ensureDemo() ──► ‏כספת ריקה? ──‏כן──► seedExampleVault()
                                            │
                                            └──‏לא──► __owDemoContent ≠ ‏המסומן?
                                                          │
                                                          └─‏כן─► seedExampleVault(force)  ‏חדש
                                                                  ‏דורס רק את קבצי-התבנית
```

---

## §4 — Commits ‏בסדר

### Commit 0 — `OW_PROFILE` ‏+ ‏קונפיג הדמו (approach: **integration**)

**‏קבצים חדשים**:
- `src/config/deploy-config.demo.json`

**‏קבצים שמשתנים**:
- `src/deployments/cloudflare/scripts/build-assets.sh` — ‏שורה 39 ‏בלבד (`CONFIG_PATH`)
- `src/config/deploy-config.json` — `seedExampleContent` ‏ו-`demoVault.enabled` ‏→ `false`
- `src/client-mobile/deploy-config.js` — `DEFAULTS` ‏חייב להישאר **‏מראה** ‏של ה-JSON.
  ‏עדכן גם את ההערה בשורה 33 (`Mirrors src/config/deploy-config.json`) ‏ל-"‏מראה של
  ‏**‏profile ברירת-המחדל**" — ‏עם שני profiles ‏היא דו-משמעית כפי שהיא.
- `src/client-mobile/test/deploy-config.test.js` — ‏**‏חובה** (‏אביגיל ‏ממצא 2)

> 🔴 **‏טסט אדום מובטח אם תדלג.** `deploy-config.test.js:17` ‏קובע
> `assert.equal(DEFAULTS.seedExampleContent, true)`. ‏הקומיט הזה הופך את הערך ל-`false`
> ⇒ ‏הטסט ייכשל, ‏ו-DoD#1 ‏דורש ירוק. ‏עדכן את ה-assertion ל-`false` ‏והוסף
> `assert.equal(DEFAULTS.demoVault.enabled, false)`.
>
> 🟡 **‏ובזמן שאתה שם — ‏המראה אינה אכיפה** (‏אביגיל ‏ממצא 3). ‏שם הטסט מבטיח
> "DEFAULTS mirrors src/config/deploy-config.json" ‏אבל הגוף משווה **‏ליטרלים קשיחים**
> ‏ומעולם לא קורא את ה-JSON. ‏הוסף טסט אמיתי אחד:
> `assert.deepStrictEqual(DEFAULTS, require('../../config/deploy-config.json'))`.
> ‏בלעדיו שום דבר לא יתפוס drift בין שני הקבצים אחרי הקומיט הזה.
>
> ‏(‏אביגיל אימתה אמפירית על dev כפי שהוא: ‏הטסט הזה **‏עובר היום** — ‏קבוצות המפתחות
> ‏זהות בשלוש הרמות, ‏אין מפתח עודף ואין הבדל-טיפוס — ‏ואחרי Commit 0 ‏שני הקבצים
> ‏מתהפכים יחד ‏ולכן הוא נשאר ירוק. `deepStrictEqual` ‏ולא `deepEqual`, ‏כדי לתפוס
> ‏גם drift-טיפוס.)

**‏השינוי ב-`build-assets.sh`** (‏עוגן: ‏השורה `CONFIG_PATH="$MAIN_DIR/src/config/deploy-config.json"`):

```bash
OW_PROFILE="${OW_PROFILE:-}"
if [[ -n "$OW_PROFILE" ]]; then
  CONFIG_PATH="$MAIN_DIR/src/config/deploy-config.$OW_PROFILE.json"
  if [[ ! -f "$CONFIG_PATH" ]]; then
    echo ""; echo "ERROR: unknown OW_PROFILE '$OW_PROFILE' — $CONFIG_PATH not found."; exit 1
  fi
  echo "  profile: $OW_PROFILE"
else
  CONFIG_PATH="$MAIN_DIR/src/config/deploy-config.json"
fi
```

> **‏כשל-רועש ‏חובה.** profile ‏שגוי חייב להפיל את הבניה, ‏לא ליפול בשקט חזרה לברירת-מחדל —
> ‏"‏בשקט" ‏כאן פירושו לפרוס דמו לפרודקשן. ‏זו אותה דוקטרינה שכבר מתועדת בקובץ הזה
> ‏עצמו (‏"Bare command, NOT inside `if`" ‏בהזרקת client-only signals).

**‏תוכן `deploy-config.demo.json`** — ‏קובץ **‏מלא** (‏לא overlay חלקי; `deepMerge` ‏אמנם
‏ממזג מעל `DEFAULTS`, ‏אבל קובץ מלא הוא מה שנקרא-ונבדק ‏ואין בו הפתעות-ירושה):

```json
{
  "defaultVaultLocation": "device",
  "seedExampleContent": true,
  "plugins": {
    "obsidian-livesync": { "install": true, "enabled": false },
    "obsidian-web-layout": { "install": true, "enabled": true }
  },
  "layout": { "default": "auto", "threshold": 900 },
  "demoVault": { "enabled": true, "id": "0000demo0000demo", "autoOpen": true },
  "branding": { "name": "Obsidian Web", "themeColor": "#1e1e1e" }
}
```

**Verification**:

```bash
cd src/deployments/cloudflare
npm run build && grep -o '__owConfigInjected={[^<]*' ../../../.tmp/deployments/cloudflare/public/index.html | head -c 300
# ‏מצופה: "demoVault":{"enabled":false,...}  ‏ו-"seedExampleContent":false
OW_PROFILE=demo npm run build && grep -o '__owConfigInjected={[^<]*' ../../../.tmp/deployments/cloudflare/public/index.html | head -c 300
# ‏מצופה: "enabled":true, "autoOpen":true, "seedExampleContent":true
OW_PROFILE=nope npm run build ; echo "exit=$?"   # ‏מצופה: exit≠0
bun test test/build-assets.test.js
```

---

### Commit 1 — hash ‏של תוכן הדמו מוזרק בבניה (approach: **integration**)

**‏קבצים שמשתנים**:
- `src/deployments/cloudflare/scripts/build-assets.sh` — ‏בלוק ההזרקה `OW_BACKEND_INJECT`
- `src/deployments/cloudflare/test/build-assets.test.js` — ‏הבדיקה הבייט-בבייט של אותו snippet

‏ה-hash נגזר מ-`example-vault.json` ‏**‏אחרי** ‏שהוא נכתב (‏עוגן: ‏השורה
`echo "  building example-vault.json (static)..."`), ‏ולכן **‏צעד בניית ה-JSON חייב לעבור
‏לפני בלוק ההזרקה** ‏— ‏היום הוא אחריו. ‏זו ההזזה היחידה המותרת בקובץ.

**‏ה-snippet החדש** (‏מדויק — ‏הטסט משווה אותו כמחרוזת):

```
<script>window.__owBackend="none";window.__owVersion=<json>;window.__owDemoContent=<json>;</script>
```

‏ה-hash: `sha256sum` ‏של הקובץ, 16 ‏תווים ראשונים.

> ‏מוזרק ב**‏שתי** ‏הבניות. ‏בברירת-המחדל הוא לא-מזיק (‏אין דמו ‏שיקרא אותו) ‏— ‏וכך
> ‏ההבדל היחיד בין הארטיפקטים נשאר קובץ הקונפיג. ‏זה מה שמאפשר ל-DoD#7 ‏לעבוד.

**Verification**:

```bash
cd src/deployments/cloudflare && bun test test/build-assets.test.js
OW_PROFILE=demo npm run build
grep -o '__owDemoContent="[^"]*"' ../../../.tmp/deployments/cloudflare/public/index.html
sha256sum ../../../.tmp/deployments/cloudflare/public/example-vault.json | cut -c1-16   # ‏חייב להתאים
npm run build && npm run build   # ‏פעמיים — ‏אותו hash (‏דטרמיניסטי, ‏לא תלוי BUST)
```

---

### Commit 2 — ‏פתיחה-אוטומטית של הדמו (approach: **manual**)

**‏קבצים שמשתנים**: `src/client-mobile/boot.js`

‏בבלוק ניתוב-הכניסה (‏עוגן: `} else if (!VAULT_ID) {` ‏ובתוכו `location.replace('/starter')`):
‏כשאין `VAULT_ID` ‏ואין כספת-אחרונה, ‏ובקונפיג `demoVault.autoOpen === true` ‏ו-`enabled !== false`
‏— ‏הפניה ל-**`/vault/<demoId>/Welcome`** ‏במקום ל-`/starter`.

> 🔧 **‏עודכן אחרי כלב-heavy (‏ממצא 1, ‏סבב runtime-gate).** ‏הניסוח המקורי אמר
> `/vault/<demoId>` ‏בלבד — ‏וזה בדיוק מה שנבנה. ‏אבל ‏Obsidian ‏נוחת אז על "New tab"
> ‏ריק: ‏עץ הקבצים מלא, ‏התוכן **‏לא מרונדר**, ‏והמבקר רואה `Create new note / Go to
> file / Close`. ‏כל מה שהסלייס קיים כדי להראות — ‏כולל הקישור לפריסה הראשית
> (Commit 4 / DoD#13) — ‏בלתי-נראה עד לחיצה יזומה.
>
> ‏זו הייתה **‏סתירה פנימית בבריף**: §5 DoD#4 ‏הבטיח חוויה ("`Welcome.md` ‏מרונדר")
> ‏ש-§4 ‏לא הנחה אף אחד לבנות. ‏ההכרעה: ‏מתקנים ‏**‏בקוד**, ‏לא מרככים את ה-DoD.
>
> ‏כלב מדד בדפדפן **‏נקי לחלוטין** (‏פרופיל חדש, ‏אין כספת, ‏אין `ow-demo-content`)
> ‏ש-`/vault/<demoId>/Welcome` ‏כבר עובד היום מקצה-לקצה: ‏כספת נוצרת, ‏תוכן נזרע,
> `Welcome.md` ‏מרונדר, ‏אפס לחיצות. ‏**‏יעד-הניתוב הוא הדבר היחיד שמשתנה** — ‏אין
> ‏פיצ'ר חדש לבנות.
>
> ‏רקע שכלב מצא: ‏שני המנגנונים שהיו נותנים את זה לבד מנוטרלים **‏במכוון** —
> `.obsidian/app.json` ‏עם `defaultViewMode: "preview"` ‏ו-`workspace.json` ‏מדולגים
> ‏שניהם בזריעה (finding 1, ‏ובצדק). ‏ניתוב הוא הדרך היחידה שנשארה.

> 🔴 **‏אילוץ סדר — ‏הכשל הצפוי בקומיט הזה.** `DEMO_ID` ‏מוגדר היום ‏**‏אחרי** ‏בלוק
> ‏ניתוב-הכניסה (‏עוגן: `var DEMO_ID = (window.__owConfig && ...)`). ‏שימוש בו בבלוק
> ‏שלמעלה ייתן `undefined` ‏ויפיק `/vault/undefined`. ‏העלה את הגדרת `DEMO_ID` ‏לפני
> ‏בלוק הניתוב — ‏**‏את ההגדרה בלבד**, ‏לא את `ensureDemo()` ‏ולא את הקריאה
> `if (VAULT_ID === DEMO_ID) ensureDemo();`, ‏שנשארות במקומן.

**‏שמור על**: `forceStarter` (‏הנתיב `/starter`) ‏חייב להמשיך לעקוף את הפתיחה-האוטומטית —
‏זו דרך המילוט היחידה למסך-הפתיחה בדומיין הדמו.

‏ES5 ‏בלבד (‏guard `(window.__owConfig && window.__owConfig.X)`, ‏בלי `?.`/`??`) — ‏ראה ההערה
‏ב-`deploy-config.js`.

**Verification**: ‏ידני, ‏שני ה-profiles — ‏ראה DoD#3 ‏ו-DoD#4.

---

### Commit 3 — ‏זריעה-מחדש כשהתוכן השתנה (approach: **tdd**)

**‏קבצים שמשתנים**:
- `src/client-mobile/seed-example-vault.js`
- `src/client-mobile/test/seed-example-vault.test.js`
- `src/client-mobile/boot.js`

**API skeleton** (‏חתימה מדויקת — ‏אליעזר לא משנה):

```js
// opts.force === true  →  ‏מדלג על שער-ה-stat, ‏כותב את כל קבצי-התבנית מחדש.
// ‏ברירת-מחדל (‏ללא opts) — ‏התנהגות היום, ‏בלי שינוי.
async function seedExampleVault(store, opts)
```

‏הדילוג על `.obsidian/` ‏(‏שורת ה-`continue` ‏הקיימת) **‏נשאר גם ב-force** — ‏קונפיג
‏הפלאגינים בבעלות בלעדית של `seedSystemPlugins`, ‏וזריעה-מחדש שתדרוס אותו תבטל את
‏מתג ה-layout. ‏זה finding 1 ‏המתועד בראש הקובץ; ‏אל תפתח אותו מחדש.

**‏החיווט ב-boot.js** — ‏בלוק **‏חדש ונפרד** ‏מיד אחרי בלוק הזריעה הקיים
(‏עוגן: `window.__owSeedExampleVault.seedExampleVault(seedStore)`):

```
‏תנאים (‏כולם):  seedStore ‏קיים
                window.__owSeedExampleVault ‏קיים          ← ‏אביגיל ‏ממצא 7
                window.__owConfig.seedExampleContent       ← ‏אביגיל ‏ממצא 7
                demoVault.enabled !== false
                VAULT_ID === DEMO_ID
                window.__owDemoContent ‏קיים
                window.__owDemoContent !== localStorage['ow-demo-content']
‏פעולה:          seedExampleVault(seedStore, {force:true})  ‏ואז ‏עדכון המפתח ב-localStorage
```

> 🔴 **‏זריעה כפולה בבוט הראשון — ‏הכשל הצפוי כאן** (‏אביגיל ‏ממצא 7). ‏הזריעה הראשונה
> ‏קורית בבלוק ה**‏קודם** (`boot.js:1368-1372`). ‏בבוט הראשון של הדמו `localStorage`
> ‏ריק ⇒ ‏הבלוק החדש רואה "‏שונה" ‏ומריץ `force:true` **‏מיד אחרי** ‏הזריעה הראשונה.
> ‏**‏הפתרון: ‏כתיבת המפתח מתווספת גם בתוך הבלוק הקיים** — ‏מיד אחרי
> `seedExampleVault(seedStore)` ‏שמצליחה. ‏שתי נקודות-כתיבה, ‏לא אחת.
>
> 🔴 **‏ולכתיבה ההיא ‏חייב להיות אותו guard: `VAULT_ID === DEMO_ID`** (‏אביגיל ‏סבב 2,
> ‏ממצא 1). ‏הבלוק הקיים רץ על **‏כל** ‏כספת local/folder ‏ריקה — ‏גם כספת שהמבקר יצר
> ‏לעצמו בדומיין הדמו. ‏בלי ה-guard, ‏הכספת ההיא תכתוב את ה-hash ‏הנוכחי ל-
> `localStorage['ow-demo-content']` (‏מפתח **‏אחד לכל המקור**, ‏לא פר-כספת) ⇒ ‏כשכספת
> ‏הדמו האמיתית תיטען, ‏ה-hash ‏כבר "‏מסומן כמעודכן" ‏ו**‏הזריעה-מחדש לא תרוץ לעולם**.
> ‏באג שקט: ‏אין טסט ואין DoD שתופס אותו — ‏רק ה-guard.

- ‏אחרי זריעה **‏ראשונה** ‏מוצלחת — ‏כתיבת המפתח **‏בתוך הבלוק הקיים** (‏ראה למעלה).
- ‏כישלון לא חוסם את הפתיחה (`try/catch` + `console.warn`), ‏כמו הבלוק שמעליו. ‏במקרה
  ‏כישלון **‏אל תעדכן** ‏את המפתח — ‏שהניסיון יחזור בבוט הבא.
- **‏רק בכספת הדמו** (`VAULT_ID === DEMO_ID`). ‏כספת אחרת של המשתמש לעולם לא נדרסת.

**‏טסטים חדשים** (‏מעל 5 ‏הקיימים, ‏שכולם חייבים להישאר ירוקים):
1. `force:true` ‏כותב מחדש למרות ש-`Welcome.md` ‏קיים
2. `force:true` ‏עדיין מדלג על `.obsidian/` ‏לגמרי
3. ‏קובץ שהמבקר יצר ‏(‏שאינו בתבנית) ‏לא נמחק ‏ולא נכתב

**Verification**: `cd src/client-mobile && npm test`

---

### Commit 4 — ‏קישור מהדמו לפריסה הראשית (approach: **none**)

**‏קבצים שמשתנים**: `src/deployments/cloudflare/template.js` — ‏תוכן `Welcome.md` ‏בלבד.

> ⚠️ **‏יש שני `Welcome.md` ‏בריפו** (‏אביגיל ‏ממצא 11). `user-data/demo-vault/Welcome.md`
> ‏הוא כספת-פיתוח מקומית ‏שאינה חלק מפריסת ה-CF — **‏אל תיגע בו**. ‏המקור שנארז
> ‏ל-`example-vault.json` ‏הוא `TEMPLATE_FILES` ‏ב-`template.js` **‏בלבד**. grep ‏על
> `Welcome.md` ‏ינחת על שניהם.

‏שורה אחת בתחתית `Welcome.md`: ‏קישור לפריסה הראשית עם הסבר של משפט —
"‏זו כספת דמו; ‏ליצירת כספת משלך →". ‏**‏אנגלית** (‏כל תוכן הדמו באנגלית).

‏ה-URL של הפריסה הראשית — ‏ראה §9 ‏שאלה 2 (‏ברירת-מחדל: `https://obsidian-online.pages.dev`).

> ‏קישור-כתוכן ‏ולא רכיב-UI: ‏הוא כבר עובר בזריעה-מחדש (Commit 3), ‏אפס קוד, ‏אפס CSS,
> ‏אפס RTL, ‏ואי-אפשר שיישבר בגרסת Obsidian הבאה.

---

### Commit 5 — ‏סקריפטי פריסה + ‏שומר (approach: **integration**)

**‏קבצים שמשתנים**:
- `src/deployments/cloudflare/package.json` — ‏שני scripts
- `src/deployments/cloudflare/test/build-assets.test.js` — ‏בדיקת השומר
- `src/deployments/cloudflare/README.md` — ‏תיעוד שתי הפריסות

```
build:demo   OW_PROFILE=demo bash scripts/build-assets.sh
```

**‏השומר** — ‏סקריפט קטן שנקרא לפני העלאה ומוודא שהארטיפקט תואם ליעד. ‏כשל = exit≠0
‏עם הודעה מפורשת.

> 🟡 **‏מחרוזת-העוגן — ‏אל תנחש** (‏אביגיל ‏ממצא 4). ‏חיפוש `"enabled":true` ‏לבדו
> ‏נותן false-positive **‏גם על הארטיפקט הראשי**, ‏כי `deploy-config.json:6` ‏מכיל
> `"obsidian-web-layout":{"install":true,"enabled":true}` ‏שמוזרק דרך `JSON.stringify`.
> ‏העוגן חייב להיות **`"demoVault":{"enabled":true`** ‏— ‏עם שם המפתח.

> **‏למה שומר ולא הקפדה**: ‏זהו הכשל היחיד בסלייס הזה שנוחת על משתמשים אמיתיים
> ‏בלי שאף טסט ירגיש — ‏הארטיפקט תקין, ‏רק הועלה ליעד הלא-נכון. ‏אחרי שהשומר קיים,
> ‏הכשל הזה בלתי-אפשרי.

**‏פקודות ה-`deploy` ‏עצמן ‏לא רצות בסלייס הזה** — ‏אליעזר כותב ובודק אותן ב-`--dry-run`
‏או בקריאת הפלט בלבד. ‏פריסה ציבורית היא החלטת מרדכי+המשתמשת אחרי merge.

> ⚠️ **‏השומר מאמת כוונה, ‏לא יעד** (‏כלב-heavy ‏ממצא 4). ‏כל עוד `deploy` ‏ו-`deploy:demo`
> ‏פונים לאותו `name` ‏ב-`wrangler.toml`, ‏ההבטחה "‏אחרי שהשומר קיים ‏הכשל הזה
> ‏בלתי-אפשרי" ‏**‏עדיין לא מתקיימת**. ‏זה לא באג בקוד — ‏זה תנאי-קדם בטופולוגיה,
> ‏באחריות מרדכי לפני הפריסה הציבורית. ‏ראה Commit 6.

---

### Commit 6 — ‏סבב runtime-gate (approach: **manual**)

> ‏נוסף אחרי כלב-heavy (PARTIAL, 13/14). ‏שלושה פריטים; ‏אף אחד מהם אינו blocker,
> ‏שניים מהם נוגעים ישירות במה שמבקר אמיתי רואה בשנייה הראשונה.

**‏א. ‏יעד-הניתוב של הפתיחה-האוטומטית** — ‏ראה Commit 2 ‏המעודכן. `/vault/<demoId>/Welcome`.
‏זה מה שסוגר את DoD#4.

**‏ב. ‏הכפתור "‏כספת דמו" ‏באנגלית** — `src/client-mobile/boot.js` (‏עוגן: `ow-demo-vault-btn`,
`btn.textContent = 'כספת דמו'`). ‏קוד **‏פרה-קיים** ‏שהסלייס הזה לא נגע בו — ‏אבל הסלייס
‏הזה הוא מה שהופך את הדמו למקור ציבורי אנגלי-בלבד, ‏ולכן הכפתור נעשה גלוי למבקרים
‏אמיתיים ‏וסותר את §6 ("‏כל טקסט-מבקר באנגלית"). ‏החלף ל-`Demo vault`.
‏**‏אל תיגע בשום דבר אחר בפונקציה** — ‏המיקום/CSS/MutationObserver ‏נושאים היסטוריה של
‏שני סבבי NO-GO ‏(‏ראה ההערות בגוף הקוד).

**‏ג. `_headers` ‏לארטיפקט הדמו** — ‏קובץ בשורש ה-`public/`, ‏מיוצר **‏רק** ‏בבניית הדמו:

```
/*
  X-Robots-Tag: index, follow
```

‏הרקע: `demo.obsidian-online.pages.dev` ‏הוא alias של ענף ⇒ Cloudflare ‏מוסיף
`X-Robots-Tag: noindex` ‏אוטומטית. ‏**‏נמדד בפועל** (2026-07-28) ‏ש-`_headers` ‏דורס אותו:
‏פריסת-בדיקה על `hdrtest.obsidian-online.pages.dev` ‏החזירה `x-robots-tag: index, follow`.
‏זה מה שמאפשר פרויקט Pages **‏אחד** ‏במקום שניים.
‏הבניה הראשית **‏לא** ‏מקבלת `_headers` — ‏היא פרודקשן וממילא מאונדקסת.

**Verification**:

```bash
cd src/deployments/cloudflare
npm run build                 && ls ../../../.tmp/deployments/cloudflare/public/_headers   # ‏מצופה: ‏לא קיים
OW_PROFILE=demo npm run build && cat ../../../.tmp/deployments/cloudflare/public/_headers  # ‏מצופה: ‏קיים
bun test test/*.test.js
```

> **‏שים לב**: ‏קובץ שקיים באחד הארטיפקטים ‏ולא בשני **‏משנה את DoD#7**. ‏עדכן את
> ‏הציפייה שם: `_headers` ‏מצטרף ל-`index.html` ‏ול-`sw.js` ‏כהבדל **‏צפוי**.

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | ‏כל הטסטים ירוקים | `cd src/client-mobile && npm test` ‏**‏וגם** `cd src/deployments/cloudflare && bun test test/*.test.js` |
| 2 | ‏שתי הבניות עוברות | `npm run build` ‏ו-`OW_PROFILE=demo npm run build` — ‏שתיהן exit 0 |
| 3 | **‏ראשי**: ‏אין דמו | ‏הגש את בניית ברירת-המחדל, ‏פתח `/` → ‏מסך יצירת-כספת. ‏אין כפתור "‏כספת דמו". `localStorage`+OPFS ‏ריקים מ-`0000demo0000demo` |
| 4 | **‏דמו**: ‏פתיחה ישירה | ‏הגש את בניית הדמו, ‏פתח `/` → ‏נוחת בכספת עם `Welcome.md` ‏מרונדר. ‏אפס לחיצות |
| 5 | ‏זריעה-מחדש עובדת | ‏בדמו: ‏טען, ‏ערוך את `Welcome.md`, ‏צור `My Note.md`, ‏שנה תוכן ב-`template.js`, ‏בנה מחדש, ‏טען שוב → `Welcome.md` ‏חדש, **`My Note.md` ‏קיים** |
| 6 | ‏אין זריעה-מחדש כשהתוכן לא השתנה | ‏טען את הדמו פעמיים ברצף אחרי עריכת `Welcome.md` → ‏העריכה שרדה (‏אין דריסה מיותרת) |
| 7 | ‏ההבדל בין הארטיפקטים = ‏הקונפיג בלבד | ‏ראה ההליך המדויק מתחת לטבלה — ‏**‏לא** `diff -r` ‏נאיבי |
| 8 | ‏השומר חוסם | ‏הרץ את השומר עם ארטיפקט-דמו מול יעד ראשי → exit≠0 |
| 9 | profile ‏שגוי מפיל את הבניה | `OW_PROFILE=nope npm run build` → exit≠0 |
| 10 | ‏regression: `/starter` | ‏גם בבניית הדמו, `/starter` ‏מציג את מסך-הפתיחה ‏ולא מפנה לדמו |
| 11 | ‏regression: ‏כספת של המשתמש | ‏בבניית הדמו — ‏צור כספת רגילה, ‏כתוב לתוכה קובץ, ‏ערוך קובץ קיים, ‏טען מחדש → ‏שניהם שרדו מילה-במילה, ‏והסמן `ow-demo-content` **‏לא נכתב** ‏מכספת שאינה הדמו. (‏**‏ניסוח מתוקן** ‏אחרי כלב ‏ממצא 2: ‏כספת ריקה **‏חדשה** ‏כן מקבלת תוכן-דמו ברגע היצירה — ‏התנהגות פרה-קיימת ‏שהבריף מכיר ב-§4 Commit 3. ‏מה שנבדק כאן הוא **‏שרידות** ‏ו-**‏אי-זיהום הסמן**) |
| 12 | ‏regression: ‏אפס patches | `sha256sum` ‏של `app.js` ‏בשני הארטיפקטים ‏זהה ל-`vendor/obsidian-mobile/app.js`. (‏**‏אין** ‏דגל `--check` ‏ב-`patch-obsidian-mobile.js` — `argv[2]` ‏הוא נתיב לקובץ. ‏אביגיל ‏ממצא 8) |
| 13 | ‏הקישור לראשי קיים | `Welcome.md` ‏בדמו מכיל קישור עובד לפריסה הראשית |
| 14 | `vendor/` ‏לא נכנס ל-git | `git status --short \| grep vendor` → ‏ריק |
| 15 | ‏הכפתור באנגלית | ‏בבניית הדמו, `/starter` ‏→ ‏הכפתור אומר `Demo vault`. ‏אפס עברית בטקסט-מבקר. ‏ב-390×844 ‏גם: ‏לא חופף לשורת-הגרסה |
| 16 | `_headers` ‏רק בדמו | `ls public/_headers` → ‏קיים בבניית הדמו, ‏חסר בראשית. ‏תוכנו `X-Robots-Tag: index, follow` |

### ‏ההליך של DoD#7 — ‏השוואת שני הארטיפקטים

‏שני מכשולים שהופכים `diff -r` ‏נאיבי לחסר-ערך (‏אביגיל ‏ממצאים 5-6):

1. **`PUBLIC_DIR` ‏קשיח ‏ועובר `rm -rf` ‏בכל בניה** (`build-assets.sh:21,47`) — ‏אין env
   ‏ליעד. ‏בנוסף, `bun test test/*.test.js` (DoD#1) ‏מריץ את הבניה **‏3 ‏פעמים עם קונפיג
   ‏ברירת-המחדל** ‏ודורס בשקט ארטיפקט-דמו שיושב שם.
   ⇒ **`cp -r` ‏הצידה בין הבניות**, ‏ולהשוות רק כששתי ההעתקות בידך.
2. **`system-plugins/` ‏אינו דטרמיניסטי** — `build-assets.sh:198-216` ‏קורא ל-
   `install-livesync.js`, ‏שפונה ל-GitHub `latest` ‏**‏בכל בניה**; ‏כשל רשת ⇒ ‏אזהרה
   ‏והתיקייה כולה נשמטת (‏הפלייקינס מתועד ב-`build-assets.test.js:9-13`). ‏שתי בניות
   ‏במצב-רשת שונה ⇒ ‏הבדל עצום שאינו קונפיג.
   ⇒ ‏או ‏נעילת `SEED_LIVESYNC_VERSION` (`build-assets.sh:199`) ‏בשתי הבניות, ‏או
   **‏החרגת `system-plugins/`** ‏מההשוואה — ‏ובדוח לציין במפורש מה הוחרג.

```bash
cd src/deployments/cloudflare
rm -rf /tmp/art-app /tmp/art-demo   # ‏חובה: cp -r ‏ליעד קיים ‏מקנן public/ ‏בתוכו ‏ומערבב ארטיפקטים
npm run build                 && cp -r ../../../.tmp/deployments/cloudflare/public /tmp/art-app
OW_PROFILE=demo npm run build && cp -r ../../../.tmp/deployments/cloudflare/public /tmp/art-demo
diff -r -x 'system-plugins' /tmp/art-app /tmp/art-demo
# ‏מצופה: ‏הבדל ב-index.html (‏שורת הקונפיג + BUST) ‏וב-sw.js (BUST), ‏ו-_headers
# ‏קיים ‏רק ‏ב-/tmp/art-demo ‏(Commit 6, DoD#16) — ‏שלושת ‏אלה ‏בלבד.
```

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| `DEMO_ID` ‏נקרא לפני שהוגדר → `/vault/undefined` | ‏סדר הקוד ב-`boot.js` | Commit 2 ‏מורה במפורש להעלות את ההגדרה; DoD#4 ‏תופס |
| ‏שינוי ה-snippet שובר טסט בייט-בבייט | `build-assets.test.js` ‏משווה מחרוזת | ‏קוד+טסט ‏באותו commit (Commit 1) |
| `DEFAULTS` ‏ב-`deploy-config.js` ‏מתפצל מה-JSON | ‏שני מקורות לאותה אמת | **‏היום אין שום אכיפה** — `deploy-config.test.js` ‏משווה ליטרלים קשיחים ‏ולא קורא את ה-JSON (‏אביגיל ‏ממצא 3). Commit 0 ‏מוסיף טסט-מראה אמיתי; ‏בלעדיו המיטיגציה ריקה |
| ‏ארטיפקט-דמו נדרס ע"י ריצת הטסטים ‏באמצע ההשוואה | `PUBLIC_DIR` ‏קשיח + `rm -rf` | `cp -r` ‏הצידה — ‏ראה ההליך של DoD#7 |
| `system-plugins/` ‏שונה בין הארטיפקטים בגלל רשת, ‏לא בגלל קונפיג | `install-livesync.js` ‏פונה ל-GitHub `latest` | ‏נעילת גרסה ‏או החרגה מפורשת — ‏ראה ההליך של DoD#7 |
| ‏זריעה-מחדש דורסת `.obsidian/` ‏ומבטלת את מתג ה-layout | finding 1 ‏בראש `seed-example-vault.js` | ‏שורת ה-`continue` ‏נשארת גם ב-force; ‏טסט ייעודי |
| ‏זריעה-מחדש נוגעת בכספת של משתמש אמיתי | ‏הבלוק החדש ב-`boot.js` | ‏תנאי `VAULT_ID === DEMO_ID`; DoD#11 |
| ‏ארטיפקט דמו עולה ליעד הראשי | ‏טעות אנוש בפריסה | ‏השומר (Commit 5); DoD#8 |
| ‏מחרוזות עברית קשיחות בקוד | ‏מוסכמת הפרויקט | ‏כל טקסט-מבקר באנגלית (‏תוכן הדמו כולו אנגלית) |
| `vendor/` ‏נדחף ל-git ‏מה-worktree החדש | `AGENTS.md` | DoD#14 |

---

## §7 — Escalation triggers

‏עצור ושאל:

- ‏`deepMerge` ‏לא נותן את הקונפיג הצפוי ‏ואתה שוקל לשנות את `deploy-config.js` ‏מעבר ל-`DEFAULTS`
- ‏אתה שוקל לגעת ב-`vendor/` ‏או ב-`scripts/patch-obsidian-mobile.js`
- ‏אתה שוקל לגעת בטופולוגיה (wrangler.toml, ‏שמות פרויקטים, ‏דומיינים) — **‏מחוץ ל-scope**
- ‏אתה רוצה לסטות מ-testing strategy ‏של commit כלשהו
- ‏זריעה-מחדש דורשת שינוי בשער `isVaultEmptyForSeed` ‏הקיים
- ‏נראה לך שאתה חייב שינוי מ-`slice/demo-and-docs-truth` (‏הענף המוקפא, §0)

---

## §8 — Complexity score

| ‏פרמטר | ‏ניקוד |
|------|------|
| Refactor של קוד קיים (boot.js, build-assets.sh) | +1 |
| >5 files ‏ב->2 packages (client-mobile + deployments/cloudflare + config) | +1 |
| State machine / ‏תיאום async (‏שער הזריעה + ‏שער הגרסה ‏ברצף הבוט) | +2 |
| Deploy ‏לפרודקשן מיד אחרי | +2 |
| ‏האזור הזה החזיר bugs בסלייסים קודמים (‏עדות: ‏הערות `calev-heavy NO-GO round 2` ‏ב-boot.js) | +2 |

**Score**: **8/10** → **`calev-heavy`** (Opus)

**Verifier-phase**: ‏אחרי **Commit 3** (‏זריעה-מחדש — ‏הקומיט היחיד שכותב לכספת של מבקר).

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | ‏ברירת-המחדל של `deploy-config.json` ‏מתהפכת ל-"‏בלי דמו" — ‏משנה גם את חוויית ה-self-host ‏של `runtime-server` | ‏להפוך. ‏אפליקציה שמישהו מארח לעצמו לא אמורה לזרוע לו כספת דמו | ❌ |
| 2 | ‏ה-URL בקישור מהדמו לראשי | `https://obsidian-online.pages.dev` | ❌ |
| 3 | ‏טופולוגיה סופית (‏פרויקט Pages שני מול alias של ענף) | ‏פרויקט שני — ‏מאונדקס, ‏בלי `noindex` ‏של preview | ❌ — ‏לא נוגע בקוד |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor)

- **‏אין סטיות מבניות מהבריף.** ‏כל 6 ה-commits (0-5) בוצעו לפי הסדר, ‏הגישה
  ‏(approach) ‏שנקבעה פר-commit, ‏וה-API skeleton המדויק (`seedExampleVault(store, opts)`).
- **‏Commit 3 — calev-heavy NO-GO ‏אחד ‏בפאזה, 2 ‏ממצאים אמיתיים, ‏תוקנו באותו
  phase** (‏לא escalation — ‏בטווח 1-2 ‏לפי המדיניות): (1) NBug1/blocker —
  ‏זריעה-מחדש אחרי redeploy יכלה לפגוע ב-cache הישן של ה-SW ‏ולכתוב תוכן ‏לא-
  ‏עדכני תוך חתימת ה-hash החדש (‏קבוע); ‏תוקן ע"י `opts.cacheBust` ‏ב-
  `seedExampleVault` (query string חדש = cache miss ‏מובטח). (2) NBug2 —
  ‏כשל-fetch שקט עדכן את `ow-demo-content` בכל זאת; ‏תוקן ע"י ערך-חזרה
  `true`/`false` מ-`seedExampleVault` שה-caller מכבד. ‏שני התיקונים נוספו
  ‏ל-API ‏(`opts.cacheBust`, ‏ערך-חזרה) ‏בלי לשנות את החתימה `(store, opts)`
  ‏עצמה. ‏6 ‏טסטי TDD חדשים + ‏אימות ידני חוזר (5/5 ‏ריצות redeploy). ‏דוח:
  `reports/obsidian-web/demo-origin-split-commit3-calev.md`.
- **DoD#4 — ‏ניסוח, ‏לא קוד** (‏דווח ‏גם ‏ע"י ‏אליעזר ‏ב-Commit 2, ‏גם ‏אושר ‏ע"י
  ‏calev-heavy ‏ב-Commit 3 phase): ‏הנחיתה בדמו אחרי הפתיחה-האוטומטית ‏היא על
  ‏"New tab" ‏ריק של Obsidian (‏אין `workspace.json` ‏מזורע — `.obsidian/`
  ‏מדולג במכוון), ‏לא ‏על `Welcome.md` ‏פתוח-על-המסך כפי ‏שהניסוח המילולי
  ‏"‏נוחת בכספת עם `Welcome.md` ‏מרונדר" ‏עשוי לרמז. ‏הארכיטקטורה (§3) ‏מציינת
  ‏יעד-ניתוב `/vault/<demoId>` ‏בלבד (‏בלי note-path) — ‏כך מומש. `Welcome.md`
  ‏קיים ‏וניתן-לפתיחה מיד (‏קליק אחד ‏בעץ הקבצים). ‏לא ‏שיניתי ‏קוד ‏על ‏דעת ‏עצמי;
  ‏מוסר להחלטת מרדכי — ‏תיקון-ניסוח ‏ב-DoD#4 ‏או ‏הוספת פתיחת-קובץ ‏יזומה (‏שינוי
  ‏קוד ‏קטן ‏אם ‏יוחלט ‏שנדרש).
- **DoD#11 — ‏חידוד-ניסוח מוצע** (‏העלה calev-heavy, ‏לא ‏תוקן): ‏המשפט "‏לא
  ‏נזרע לתוכה" ‏עשוי להשתמע ‏שכספת local ‏חדשה בדומיין הדמו לעולם לא ‏מקבלת
  ‏תוכן-דמו — ‏אך זו ‏התנהגות פרה-קיימת (‏מתועדת ‏בבריף עצמו, Commit 3: "‏הבלוק
  ‏הקיים רץ על **‏כל** ‏כספת local/folder ‏ריקה") ‏שנשארת ‏כך ‏במכוון; ‏ה-guard
  ‏הנדרש (`VAULT_ID===DEMO_ID`) ‏חל ‏רק ‏על ‏נקודות-הכתיבה ‏ל-`localStorage`, ‏לא
  ‏על ‏קריאת-הזריעה ‏עצמה. ‏ההליך המדויק ‏בטבלת ‏ה-DoD (‏קובץ *בתוך* ‏הכספת, ‏אז
  ‏reload) ‏עובר. ‏לא ‏קוד — ‏ניסוח ‏בלבד, ‏למרדכי.
