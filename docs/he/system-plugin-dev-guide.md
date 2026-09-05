# System plugin dev guide

> Added: 2026-05-11
>
> איך מוסיפים תוסף Obsidian חדש שמוזרק אוטומטית לכל vault דרך ה-overlay
> ב-`src/runtime-server/server/system-plugins.js`.
> גרסה אנגלית של המסמך הזה נמצאת ב-[`docs/system-plugin-dev-guide.md`](../system-plugin-dev-guide.md).

מסמך זה מסביר את ה-mechanics של ה-overlay.

---

## מי זה "system plugin"?

תוסף Obsidian רגיל ש**נשמר ב-repo ב-`src/plugins/<id>/`** במקום בכל vault של משתמש. השרת חושף אותו כאילו הוא חלק מ-`.obsidian/plugins/<id>/` של כל vault שנפתח, ו-`.obsidian/community-plugins.json` נראה לאפליקציה כאילו ה-id כבר רשום שם.

יתרון: הפלאגין זמין מהרגע הראשון לכל משתמש שפותח את Markport, בלי שצריך להתקין שום דבר ובלי שהvault שלו מתלכלך.

---

## טבלת הבדלים מ-Obsidian plugin רגיל

| | Community plugin | System plugin |
|---|---|---|
| איפה חי | `<vault>/.obsidian/plugins/<id>/` | `src/plugins/<id>/` |
| מי מתקין | המשתמש (דרך ה-UI / manually) | מפתח של Markport (commit לריפו) |
| `community-plugins.json` enable | המשתמש שולט | system plugins תמיד "enabled" (re-injected at load) |
| `data.json` settings | per-vault, ב-vault | per-vault, ב-vault (system plugin אינו "global") |
| Bundling | חוסם - או build (TS/Rollup) או JS פשוט | אין build chain - JS פשוט, CommonJS |
| Update | בייפול plugin / GitHub release | git pull / git commit |

---

## הוספת system plugin חדש - 6 שלבים

### 1. צור תיקייה ב-`src/plugins/`

שם התיקייה **חייב** להיות זהה ל-`id` שתצהיר ב-`manifest.json`. ה-server לא מתפשר על זה.

```bash
mkdir src/plugins/markport-<name>
cd src/plugins/markport-<name>
```

**Naming convention:** התחל ב-`markport-` כדי שיהיה ברור מאיפה הוא בא ושלא יתנגש עם תוספי
community. ה-system plugin היחיד שקיים עדיין נקרא `obsidian-web-layout`; ה-id הזה מוקפא
בכוונה, כי הוא גם שם התיקייה בתוך `.obsidian/plugins/` של כל כספת קיימת.

### 2. צור `manifest.json`

זה ה-manifest הסטנדרטי של Obsidian. ה-`id` חייב להיות אחיד עם שם התיקייה.

```json
{
  "id": "markport-<name>",
  "name": "Markport - <Human Name>",
  "version": "0.1.0",
  "minAppVersion": "1.0.0",
  "description": "Short description.",
  "author": "Markport",
  "isDesktopOnly": false
}
```

חשוב:
- `isDesktopOnly: false` - אחרת לא ייטען ב-mobile runtime.
- אין `authorUrl`, `fundingUrl` וכו' שלא רלוונטיים לפלאגין שלא הולך לcommunity directory.

### 3. צור `main.js` - CommonJS module

אין build chain. הקובץ הוא ה-source. כתוב CommonJS פשוט שמייצא `default` בסגנון של פלאגין Obsidian:

```js
'use strict';

const obsidian = require('obsidian');

class MyPlugin extends obsidian.Plugin {
  async onload() {
    // Detect that we are running inside Markport before doing anything
    // that depends on our globals. On real Obsidian (desktop/mobile app),
    // __owPlatform doesn't exist - keep the plugin a no-op there.
    // Caveat: __owPlatform
    // is now set at RUNTIME by intercepting Object.defineProperty as
    // Obsidian's own bundle loads, not injected into the bundle at build
    // time - so this check can also be undefined ON Markport itself, for
    // a few seconds, while app.js is still downloading. Don't gate anything
    // that must run before the vault is up on this check alone.
    if (typeof window.__owPlatform === 'undefined') {
      console.log('[markport-<name>] not running on Markport, skipping');
      return;
    }

    // ribbon icon, commands, settings, etc.
    this.addRibbonIcon('settings', 'My Plugin', () => {
      new obsidian.Notice('Hello from Markport');
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
- `require('obsidian')` - ה-API הרגיל של Obsidian (`Plugin`, `Notice`, `Modal`, `Setting`, `TFile`, ...). זמין דרך ה-runtime - אין `require` של Node.js, יש את ה-`require` של Obsidian.
- `window.__owPlatform` - קיים רק על Markport. השתמש כ-feature detection.
  **הערה**: הוא נחשף ב**זמן ריצה** (יירוט `Object.defineProperty`, לא הזרקה בזמן build),
  ולכן הוא יכול להיות `undefined`
  זמנית **גם על Markport עצמו**, למשך כמה שניות, בזמן ש-`app.js` עדיין נטען. אל תבסס
  עליו לוגיקה שחייבת לרוץ לפני עליית הכספת.
- `window.app` - האפליקציה (זמין אחרי `onload`).
- `localStorage` - נורמלי. שמירת state ב-`obsidian-web:<plugin-id>:*` keys היא הconvention - הקידומת מוקפאת מאותה
  סיבת-תאימות כמו ה-id למעלה.

**מה אסור?**
- `require('fs')` / `require('child_process')` - לא קיים ב-mobile runtime. הוא כן קיים ב-desktop runtime, אבל אם אתה כותב system plugin, סבירות גבוהה שתרצה שהוא יעבוד בשני ה-runtimes. השתמש ב-`app.vault.adapter` במקום.
- Build artifacts ב-`<repo>/plugins/<id>/` - `main.js` הוא הקובץ עצמו, לא תוצאת build.

### 4. (אופציונלי) `styles.css`

אם הפלאגין מוסיף UI עם CSS, הוסף `styles.css` באותה תיקייה. Obsidian טוען אותו אוטומטית.

### 5. אין צורך ב-build / install

`system-plugins.js` סורק את `src/plugins/` ב-`init()` (ב-startup של השרת). שינוי בקבצי הפלאגין:

- **Code change (`main.js`, `styles.css`, `manifest.json`):** restart לשרת **לא נדרש** - הקבצים מוגשים דרך `/api/fs/read` לכל request, ו-Obsidian טוען אותם ב-startup של ה-vault. כן צריך reload לדפדפן.
- **הוספת/הסרת תיקייה ב-`plugins/`:** דורש restart לשרת (`init()` סורק ב-startup בלבד).

### 6. וריפיקציה

```bash
# 1. בדוק שהמשרת מזהה את הפלאגין:
curl -s http://localhost:3000/api/fs/readdir?path=.obsidian/plugins | jq '.[].name'
# צריך לכלול "markport-<name>"

# 2. בדוק שה-manifest מוגש:
curl -s "http://localhost:3000/api/fs/read?path=.obsidian/plugins/markport-<name>/manifest.json"

# 3. בדוק שה-id מופיע ב-community-plugins.json הוירטואלי:
curl -s "http://localhost:3000/api/fs/read?path=.obsidian/community-plugins.json"
# צריך להחזיר array שמכיל "markport-<name>"

# 4. בדפדפן (אחרי reload):
#    app.plugins.plugins['markport-<name>']      → instance של המחלקה
#    app.plugins.manifests['markport-<name>']    → ה-manifest
```

---

## תרחיש פיתוח iterative

לולאת פיתוח טיפוסית:

```bash
# 1. ערוך src/plugins/markport-<name>/main.js
# 2. ב-browser DevTools:
app.plugins.disablePlugin('markport-<name>');
app.plugins.enablePlugin('markport-<name>');
# או פשוט reload לדפדפן.
```

**אזהרה:** `disablePlugin` של system plugin אינו persistent - הוא ייטען שוב ב-reload. זו התנהגות מכוונת, אבל מעצבן כשמנסים לבדוק התנהגות ללא הפלאגין. workaround: rename הזמני של תיקיית הפלאגין + restart לשרת.

---

## דוגמה קיימת לעקוב אחריה

`src/plugins/obsidian-web-layout/` הוא ה-system plugin הראשון, מימוש מינימלי טוב:

- ~140 שורות.
- מוסיף ribbon icon + 3 commands - משתיק את שניהם ויזואלית כש-`localStorage.EmulateMobile`
  פעיל, במקום להישאר "פעיל אך חסר-אפקט".
- קורא/כותב ל-`localStorage` (אין `data.json` settings).
- עושה feature detection על `window.__owPlatform`.

קרא אותו לפני כתיבת system plugin חדש.

---

## Future: opt-in via `SYSTEM_PLUGINS` env var

תוכנית עתידית, **טרם מומשה** ב-`index.js` של השרת (אין `process.env.SYSTEM_PLUGINS` בקוד כיום):

```bash
SYSTEM_PLUGINS=markport-layout,obsidian-livesync node index.js
```

שיגביל אילו ids מ-`src/plugins/` יוזרקו. שימושי לפריסות שרוצות לצמצם אילו system plugins מוזרקים בכלל (למשל: פריסה שלא רוצה את קבצי LiveSync בפועל, לא רק disabled). אם תוסיף system plugin שמתאים רק לחלק מהפריסות, תיעד את זה ב-`README.md`.
