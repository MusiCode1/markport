---
title: "Markport - אובסידיאן בתוך הדפדפן"
description: "המנוע המקורי של אובסידיאן, רץ בדפדפן רגיל. הכספת נשארת אצלך."
---

<header class="wrap">
  <p class="wordmark">Markport</p>
  <h1>אובסידיאן, רץ <span>בדפדפן שלך</span></h1>
  <p class="tagline">
    המנוע המקורי של Obsidian - ממש הוא, בייט-בייט ללא שינוי - כשכל תלות ב-Electron
    וב-Capacitor הוחלפה בשכבות-ביניים מבוססות-דפדפן.
  </p>
  <div class="actions">
    <a class="btn btn-primary" href="/he/install">
      להריץ בעצמך
      <small>כמה דקות, על המחשב שלך</small>
    </a>
  </div>
  <p class="disclaimer">
    Markport הוא פרויקט עצמאי. הוא אינו מיוצר על-ידי Obsidian, אינו מסונף אליה ואינו מאושר
    על ידה. <strong>אין מופע ציבורי</strong> - ההסבר למטה.
  </p>
</header>

## אז איפה הפתקים שלך יושבים

ישנן שתי אפשרויות, ובאף אחת מהן אין שרת.

### תיקייה אמיתית על המחשב שלך

מכוונים את Markport לתיקייה כלשהי, והוא קורא וכותב ישירות אליה דרך
[File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
של הדפדפן. הפתקים נשארים קובצי Markdown רגילים על הדיסק ואפשר לפתוח אותם בכל עורך אחר,
לגבות אותם, ולסנכרן אותם במה שכבר יש לך. שום דבר לא מועתק לתוך הדפדפן, והדפדפן לא רואה
דבר מחוץ לתיקייה שבחרת. פועל בדפדפני Chromium בלבד.

### בתוך הדפדפן

אם אתה מעדיף לא לתת גישה לתיקייה, הכספות יכולות לחיות ב-[OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) -
פרטיות לך, לא נשלחות לשום שרת, לא משותפות בין מבקרים. הן שורדות רענון של הדף ונשארות
עד שתמחק את נתוני הגלישה של אותו אתר. עובד בכל דפדפן מודרני.

> יש גם שרת-סנכרון אופציונלי שאפשר להריץ בעצמך - הוא **מושך בלבד, לקריאה בלבד, בלי הצפנה**.
> עדיין לא בשל לשימוש.

> **חריג אחד:** בקשות אל `github.com`, `githubusercontent.com` ו-`obsidian.md` - התקנת תוסף
> קהילתי, והבדיקה האחת ש-Obsidian עצמו עושה לתוספים מיושנים בטעינת הכספת - עוברות דרך פרוקסי
> קטן, כי דפדפן לא יכול לפנות למארחים האלה ישירות. הפתקים שלך לא חלק מזה בשום שלב. שרת סנכרון
> שתחבר בעצמך הוא חיבור ישיר ולא עובר דרך הפרוקסי.

## אפס תיקונים לבאנדל של Obsidian

`app.js` מוגש בדיוק כפי ש-Obsidian מפיצה אותו - מאומת ב-checksum מול הבאנדל הרשמי לאנדרואיד.
שום דבר לא נכתב מחדש בזמן הבנייה. התנהגות הפלטפורמה (פריסת דסקטופ מול מובייל) מותאמת
*בזמן ריצה*, דרך שכבה שלוכדת את אובייקט ה-`Platform` של Obsidian עצמה במקום לערוך את הקוד
שלה. *הריפוזיטורי הזה לא מכיל ולא מפיץ את הבאנדל.*

## מה עובד

- עריכת Markdown מלאה ותצוגה חיה, במנוע של Obsidian עצמה
- עץ קבצים, לשוניות, חלוקת מסך, תצוגת גרף
- קישורים דו-כיווניים, backlinks, תגיות, חיפוש, פלטת פקודות
- תוספי הליבה, ותוספי קהילה שמותקנים מתוך האפליקציה
- כספות-תיקייה, או אחסון מקומי בדפדפן - ראה למעלה
- תמיכה מלאה בעברית, ב-RTL וביוניקוד

## מה לא עובד

- **תוספים שזקוקים ל-API אמיתי של Node** - הרצת תהליכים, גישה מחוץ לכספת. תוספים שנכתבו מול
  ה-API הבטוח-למובייל עובדים בדרך כלל.
- **כספות-תיקייה** - ב-Chromium בלבד; Firefox ו-Safari לא מממשים את בורר-התיקיות.
- **רענון אוטומטי בשינוי חיצוני** - ב-Chromium בלבד; במקומות אחרים הרענון קורה כשהטאב חוזר
  לפוקוס.
- **מקור לא מאובטח.** אחסון הדפדפן אינו זמין בלי `https://` (או `localhost`), ויצירת כספת
  נכשלת בשקט על מארח עם כתובת-IP חשופה.

## Obsidian 1.13

**Obsidian 1.13 ומעלה.** Markport נעוץ ב-1.12.7. החל מ-1.13, Obsidian מבקש מסביבת האירוח שלו
שדה `terms` שמכיל אישור מילה-במילה, לפני שהוא מאתחל. ההצהרה יושבת בשני הצדדים - אחד מספק,
השני משווה לעותק שלו *(הקוד אינו מדויק, והוא למטרת המחשה)*.

**במובייל**, דרך פלאגין ה-App של Capacitor:

```js
const ACKNOWLEDGEMENT = "I understand and agree that I am not allowed to … granted by the Obsidian team.";

// ### צד הפלטפורמה ###
// המחרוזת מהודרת לתוך classes.dex ומוגשת דרך פלאגין ה-App של Capacitor
App.getInfo = () => ({
  name: 'Obsidian', id: 'md.obsidian', build: '…', version: '1.13.4',
  terms: ACKNOWLEDGEMENT,
});

// ### צד הלקוח ###
const appInfo = await App.getInfo();
Platform.build   = appInfo.build;
Platform.version = appInfo.version;

// …

if (ACKNOWLEDGEMENT !== appInfo.terms) throw new Error();
```

**בדסקטופ**, אותו ערך דרך IPC - באותה ריצה שבה נקראים גם `version` ו-`resources`:

```js
const ACKNOWLEDGEMENT = "I understand and agree that I am not allowed to … granted by the Obsidian team.";

// ### צד הפלטפורמה ###
electron.ipcMain.on("terms",         e => { e.returnValue = ACKNOWLEDGEMENT }),
electron.ipcMain.on("documents-dir", e => { e.returnValue = documentsDir }),
electron.ipcMain.on("resources",     e => { e.returnValue = resourcesPath }),
electron.ipcMain.on("version",       e => { e.returnValue = appVersion }),

// ### צד הלקוח ###
Platform.version = electron.ipcRenderer.sendSync("version");
Platform.build   = electron.remote.app.getVersion();

// …

const termsFromIPC = electron.ipcRenderer.sendSync("terms");

if (ACKNOWLEDGEMENT !== termsFromIPC) return window.close();
```

## תמיכת דפדפנים

| יכולת | Chromium | Firefox | Safari |
|---|:---:|:---:|:---:|
| אחסון כספת - קריאה | ✅ | ✅ | ✅ |
| אחסון כספת - כתיבה | ✅ | ✅ | ⚠️ |
| כספות-תיקייה | ✅ | ❌ | ❌ |
| רענון אוטומטי בשינוי חיצוני | ✅ | ❌ | ❌ |

> Chromium נותן את החוויה המלאה. ב-Safari הכתיבה ל-OPFS הגיעה הרבה אחרי הקריאה - כדאי לבדוק
> את הגרסה. בכל דפדפן נדרש הקשר מאובטח (`https://` או `localhost`).

## אין מופע ציבורי

אין פריסה ציבורית. הקוד למטרות הדגמת הרעיון. הריפוזיטורי הזה אינו מכיל ואינו מפיץ את הבאנדל
של אובסידיאן. אם תרצה, תוכל להוריד אותו מ-Obsidian, אל המחשב שלך.

## להריץ בעצמך

ישנם שני מצבי פריסה.

- בנייה סטטית לגמרי בצד-הלקוח - כל אחסון סטטי כמו Vercel או Cloudflare Pages, או פשוט תיקייה
  על המחשב שלך.
- שרת Node.js אופציונלי ששומר כספות כקבצים אמיתיים על הדיסק ודוחף עדכונים חיים אל צד הלקוח.

שניהם מריצים את אותה ליבת-דפדפן.

[הוראות התקנה ←](/he/install)
