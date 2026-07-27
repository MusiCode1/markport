# System plugin dev guide

> Added: 2026-05-11
>
> איך מוסיפים תוסף Obsidian חדש שמוזרק אוטומטית לכל vault דרך ה-`server/system-plugins.js` overlay.

מסמך זה מסביר את ה-mechanics. הרקע התיאורטי על המנגנון נמצא ב-[`docs/investigations.md` → Virtual plugin overlay — deep dive](./investigations.md#virtual-overlay-deep-dive).

---

## מי זה "system plugin"?

תוסף Obsidian רגיל ש**נשמר ב-repo ב-`<repo>/plugins/<id>/`** במקום בכל vault של משתמש. השרת חושף אותו כאילו הוא חלק מ-`.obsidian/plugins/<id>/` של כל vault שנפתח, ו-`.obsidian/community-plugins.json` נראה לאפליקציה כאילו ה-id כבר רשום שם.

יתרון: הפלאגין זמין מהרגע הראשון לכל משתמש שפותח את obsidian-web, בלי שצריך להתקין שום דבר ובלי שהvault שלו מתלכלך.

---

## טבלת הבדלים מ-Obsidian plugin רגיל

| | Community plugin | System plugin |
|---|---|---|
| איפה חי | `<vault>/.obsidian/plugins/<id>/` | `<repo>/plugins/<id>/` |
| מי מתקין | המשתמש (דרך ה-UI / manually) | המפתח של obsidian-web (commit לrepo) |
| `community-plugins.json` enable | המשתמש שולט | system plugins תמיד "enabled" (re-injected at load) |
| `data.json` settings | per-vault, ב-vault | per-vault, ב-vault (system plugin אינו "global") |
| Bundling | חוסם — או build (TS/Rollup) או JS פשוט | אין build chain — JS פשוט, CommonJS |
| Update | בייפול plugin / GitHub release | git pull / git commit |

---

## הוספת system plugin חדש — 6 שלבים

### 1. צור תיקייה ב-`<repo>/plugins/`

שם התיקייה **חייב** להיות זהה ל-`id` שתצהיר ב-`manifest.json`. ה-server לא מתפשר על זה.

```bash
mkdir plugins/obsidian-web-<name>
cd plugins/obsidian-web-<name>
```

**Naming convention:** התחל ב-`obsidian-web-` כדי שיהיה ברור מאיפה הוא בא ושלא יתנגש עם תוספי community.

### 2. צור `manifest.json`

זה ה-manifest הסטנדרטי של Obsidian. ה-`id` חייב להיות אחיד עם שם התיקייה.

```json
{
  "id": "obsidian-web-<name>",
  "name": "Obsidian Web — <Human Name>",
  "version": "0.1.0",
  "minAppVersion": "1.0.0",
  "description": "Short description.",
  "author": "obsidian-web",
  "isDesktopOnly": false
}
```

חשוב:
- `isDesktopOnly: false` — אחרת לא ייטען ב-mobile runtime.
- אין `authorUrl`, `fundingUrl` וכו' שלא רלוונטיים לפלאגין שלא הולך לcommunity directory.

### 3. צור `main.js` — CommonJS module

אין build chain. הקובץ הוא ה-source. כתוב CommonJS פשוט שמייצא `default` בסגנון של פלאגין Obsidian:

```js
'use strict';

const obsidian = require('obsidian');

class MyPlugin extends obsidian.Plugin {
  async onload() {
    // Detect that we are running inside obsidian-web before doing anything
    // that depends on our globals. On real Obsidian (desktop/mobile app),
    // __owPlatform doesn't exist — keep the plugin a no-op there.
    // Caveat (docs/plans/runtime-platform-descriptors.md §3.1a): __owPlatform
    // is now set at RUNTIME by intercepting Object.defineProperty as
    // Obsidian's own bundle loads, not injected into the bundle at build
    // time — so this check can also be undefined ON obsidian-web itself, for
    // a few seconds, while app.js is still downloading. Don't gate anything
    // that must run before the vault is up on this check alone.
    if (typeof window.__owPlatform === 'undefined') {
      console.log('[obsidian-web-<name>] not running on obsidian-web, skipping');
      return;
    }

    // ribbon icon, commands, settings, etc.
    this.addRibbonIcon('settings', 'My Plugin', () => {
      new obsidian.Notice('Hello from obsidian-web');
    });

    this.addCommand({
      id: 'my-plugin:do-thing',
      name: 'Do the thing',
      callback: () => { /* ... */ },
    });
  }

  async onunload() {
    // cleanup
  }
}

module.exports = MyPlugin;
```

**מה קיים בסביבה?**
- `require('obsidian')` — ה-API הרגיל של Obsidian (`Plugin`, `Notice`, `Modal`, `Setting`, `TFile`, ...). זמין דרך ה-runtime — אין `require` של Node.js, יש את ה-`require` של Obsidian.
- `window.__owPlatform` — קיים רק על obsidian-web. השתמש כ-feature detection. ראה [`docs/investigations.md` → `__owPlatform` runtime API](./investigations.md#owplatform-api).
  **הערה**: הוא נחשף ב**זמן ריצה** (יירוט `Object.defineProperty`, לא הזרקה בזמן build —
  ראה `docs/plans/runtime-platform-descriptors.md` §3.1a), ולכן הוא יכול להיות `undefined`
  זמנית **גם על obsidian-web עצמו**, למשך כמה שניות, בזמן ש-`app.js` עדיין נטען. אל תבסס
  עליו לוגיקה שחייבת לרוץ לפני עליית הכספת.
- `window.app` — האפליקציה (זמין אחרי `onload`).
- `localStorage` — נורמלי. שמירת state ב-`obsidian-web:<plugin-id>:*` keys היא הconvention.

**מה אסור?**
- `require('fs')` / `require('child_process')` — לא קיים ב-mobile runtime. הוא כן קיים ב-desktop runtime, אבל אם אתה כותב system plugin, סבירות גבוהה שתרצה שהוא יעבוד בשני ה-runtimes. השתמש ב-`app.vault.adapter` במקום.
- Build artifacts ב-`<repo>/plugins/<id>/` — `main.js` הוא הקובץ עצמו, לא תוצאת build.

### 4. (אופציונלי) `styles.css`

אם הפלאגין מוסיף UI עם CSS, הוסף `styles.css` באותה תיקייה. Obsidian טוען אותו אוטומטית.

### 5. אין צורך ב-build / install

`server/system-plugins.js` סורק את `<repo>/plugins/` ב-`init()` (ב-startup של השרת). שינוי בקבצי הפלאגין:

- **Code change (`main.js`, `styles.css`, `manifest.json`):** restart לשרת **לא נדרש** — הקבצים מוגשים דרך `/api/fs/read` לכל request, ו-Obsidian טוען אותם ב-startup של ה-vault. כן צריך reload לדפדפן.
- **הוספת/הסרת תיקייה ב-`plugins/`:** דורש restart לשרת (`init()` סורק ב-startup בלבד).

### 6. וריפיקציה

```bash
# 1. בדוק שהמשרת מזהה את הפלאגין:
curl -s http://localhost:3000/api/fs/readdir?path=.obsidian/plugins | jq '.[].name'
# צריך לכלול "obsidian-web-<name>"

# 2. בדוק שה-manifest מוגש:
curl -s "http://localhost:3000/api/fs/read?path=.obsidian/plugins/obsidian-web-<name>/manifest.json"

# 3. בדוק שה-id מופיע ב-community-plugins.json הוירטואלי:
curl -s "http://localhost:3000/api/fs/read?path=.obsidian/community-plugins.json"
# צריך להחזיר array שמכיל "obsidian-web-<name>"

# 4. בדפדפן (אחרי reload):
#    app.plugins.plugins['obsidian-web-<name>']      → instance של המחלקה
#    app.plugins.manifests['obsidian-web-<name>']    → ה-manifest
```

---

## תרחיש פיתוח iterative

לולאת פיתוח טיפוסית:

```bash
# 1. ערוך plugins/obsidian-web-<name>/main.js
# 2. ב-browser DevTools:
app.plugins.disablePlugin('obsidian-web-<name>');
app.plugins.enablePlugin('obsidian-web-<name>');
# או פשוט reload לדפדפן.
```

**אזהרה:** `disablePlugin` של system plugin אינו persistent — הוא ייטען שוב ב-reload. זה התנהגות כוונה (ראה [Limitations](./investigations.md#virtual-overlay-deep-dive)), אבל מעצבן כשמנסים לבדוק התנהגות ללא הפלאגין. workaround: rename הזמני של תיקיית הפלאגין + restart לשרת.

---

## דוגמה קיימת לעקוב אחריה

`plugins/obsidian-web-layout/` הוא ה-system plugin הראשון, מימוש מינימלי טוב:

- ~140 שורות.
- מוסיף ribbon icon + 3 commands — משתיק את שניהם ויזואלית כש-`localStorage.EmulateMobile`
  פעיל (`docs/plans/runtime-platform-descriptors.md` §3.5), במקום להישאר "פעיל אך חסר-אפקט".
- קורא/כותב ל-`localStorage` (אין `data.json` settings).
- עושה feature detection על `window.__owPlatform`.

קרא אותו לפני כתיבת system plugin חדש.

---

## Future: opt-in via `SYSTEM_PLUGINS` env var

לפי תוכנית עתידית (טרם מומשה — ראה `PLAN.md` תחת "CF demo deployment"), ה-server יתמוך ב-env var:

```bash
SYSTEM_PLUGINS=obsidian-web-layout,obsidian-livesync node server/index.js
```

שיגביל אילו ids מ-`<repo>/plugins/` יוזרקו. שימושי ל-CF demo (שאינו רוצה את LiveSync — vault נמחק כל 4 שעות). אם תוסיף system plugin שמתאים רק לחלק מהפריסות, תיעד את זה ב-PLAN.md ו-`README.md`.
