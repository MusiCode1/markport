# ‏יומן החלטות — obsidian-web

> ‏רציונל ‏ארכיטקטוני ‏פר-slice (‏מרדכי). ‏ליד הקוד, ‏לא ‏בריפו ‏השיטה.

## 2026-07-06 — browser auth: login form + cookie session for private vaults

### ‏רציונל
ה-Node server קיבל שכבת גישה פרטית פשוטה שנועדה להבדיל את ה-fork הזה מהמקור: במקום להשאיר את ה-vault פתוח לכל מי שמחזיק את ה-URL, השרת מציג `/login`, יוצר cookie session אחרי התחברות מוצלחת, ומנתב את `/logout` לניקוי הסשן. זו שכבה קלה יותר מ-OAuth, אבל טובה מספיק לפריסה אישית ב-Zo כשהמטרה היא לשים את Obsidian מאחורי דלת אחת פשוטה.

### ‏מה נכנס
- טופס כניסה רגיל ב-`/login`
- cookie session חתום ו-HttpOnly
- `GET /logout` לניקוי הסשן
- fallback ל-basic auth למקרה שמישהו רוצה לקלוט גישה ישנה או לבדוק ידנית
- auth כבוי אם `OBSIDIAN_WEB_PASSWORD` ריק

### ‏משתני סביבה
- `OBSIDIAN_WEB_USERNAME`
- `OBSIDIAN_WEB_PASSWORD`
- `OBSIDIAN_WEB_REALM`
- `OBSIDIAN_WEB_SESSION_SECRET`
- `OBSIDIAN_WEB_COOKIE_NAME`
- `OBSIDIAN_WEB_COOKIE_DAYS`

### ‏החלטת מוצר
ה-auth הזה שייך ל-fork הזה, לא ל-upstream. הוא מתועד כאן כדי שיהיה ברור שהריפו שלנו הוא גרסה מחוזקת לפריסה אישית, לא רק mirror של הקוד המקורי.

## 2026-06-13 — PR #9 shims: opt-in דרך env var, לא ברירת-מחדל (החלטת המשתמשת)

> החלטה צופה-קדימה. נאכפת בסלייס **client-wiring** העתידי (שם יש לה שיניים), לא ב-server-shims הנוכחי. נכתבה כאן כדי לכוון את ה-brief של client-wiring כשייכתב.

### ‏רציונל
ה-shims של PR #9 שמשרתים את ion-sync על HTTP — keytar צד-שרת (`api/keytar.js`),
localStorage מגובה-שרת (`api/localstorage.js` + client `remote-localstorage.js`),
וה-polyfill של `crypto.subtle` ב-`boot.js` — **חייבים להיות opt-in דרך environment
variable, לא ברירת-מחדל**.

ב-fork הם נדלקים אוטומטית: keytar/localStorage תמיד מחווטים בגרסת web, וה-crypto
polyfill מותקן כש-`crypto.subtle` חסר — כלומר על כל חיבור HTTP לא-מאובטח
(`boot.js:36`: `if (typeof crypto !== 'undefined' && !crypto.subtle)`, בלי gate).
הבעיה: keytar/localStorage שומרים סודות/טוקנים כ-**plaintext JSON** תחת `user-data/`
(`api/keytar.js` כותב `.keychain.json`; `api/localstorage.js` כותב `.localstorage.json`
שמחזיק את טוקני ה-safeStorage שמצביעים לסודות). זו הורדה ממאובטחות keychain של ה-OS
לקובץ-טקסט-בדיסק. המשתמשת לא רוצה שהתנהגות הזו תידלק לכולם בשקט — מי שמפעיל אותה
צריך לבחור בה במודע.

### ‏איפה זה נאכף (לכוון את ה-brief של client-wiring)
- ה-gate שייך לסלייס **client-wiring** העתידי — שם יש לו שיניים: gating של `boot.js`
  מהזרקת ה-shims וה-polyfill. ה-env var הוא server-side, ולכן צריך לחשוף אותו לקליינט
  (למשל דרך תשובת ה-bootstrap) כדי ש-`boot.js` ידע אם להתקין.
- שקול לעטוף גם את **רישום ה-routes בשרת** מאחורי אותו דגל — כך שכשהדגל כבוי,
  ה-endpoints אפילו לא קיימים (defence in depth), לא רק שהקליינט לא קורא להם.
- **בחירת שם הדגל וברירת-המחדל (off)** הם החלטת ה-brief של client-wiring.

### ‏למה לא עכשיו (server-shims)
הסלייס הנוכחי `server-shims` מוסיף **רק** את שלושת ה-endpoints, inert בלי client
wiring — אף קליינט לא קורא להם, ה-polyfill לא מוזרק, שום סוד לא נכתב בפועל בזרימה
אמיתית. לכן **אין צורך ב-gate עדיין**, וזו הסיבה ש-server-shims נשאר נקי ופשוט
(complexity 3). הוספת ה-gate ל-server-shims הייתה מקדימה תלות שאין לה צרכן —
היא שייכת לסלייס שבו ה-shims מתחברים בפועל לקליינט.

### ‏רעיונות שנדחו
- **להדליק ברירת-מחדל ולתעד אזהרה** — נדחה: התנהגות בשקט עם סודות plaintext היא בדיוק
  מה שהמשתמשת לא רוצה. opt-in מפורש.
- **gate ב-server-shims הנוכחי** — נדחה: אין צרכן, מקדים תלות. שייך ל-client-wiring.

## 2026-06-13 — server-shims: ‏חילוץ נקי ראשון מ-PR #9

### ‏רציונל
PR #9 ‏(fork ‏חיצוני s39n, 39 ‏קבצים) ‏לא ניתן למיזוג as-is: ‏`index.js` ‏ו-`config.js` ‏בו **‏חתוכים פיזית** ‏ב-PR head,
‏יש רגרסיה (`warmUpBootstrapCache` ‏יובא אך לא נקרא, ‏ארגומנט `bootstrap` ‏הוסר מ-`createBootstrapRouter`),
‏וקונפליקט מול main ‏ב-electron.js (‏חופף לתיקון clipboard-recursion ‏של #8). ‏ההחלטה: ‏לפצל ל-slices ‏דרך הזרימה הרגילה.
‏הסלייס הראשון הוא **‏החילוץ הנקי**: ‏שלושת ה-routers ‏העצמאיים שאין להם תלות בשום רכיב אחר ב-PR —
keytar (keychain ‏צד-שרת), localstorage (server-backed), pbkdf2 (‏key derivation native). ‏כל אחד מקבל רק `userDataPath`.
‏בחרנו אותם ראשונים כי הם greenfield, ‏בלי call sites, ‏בלי תלויות חדשות, ‏ובלי קונפליקט מול main.

### ‏ממצאי אביגיל
verdict=READY (‏חריג — track record ‏של "תמיד יש בעיה" ‏לא התממש, ‏כי זה חילוץ as-is ‏של קוד שעבר ב-PR ‏אמיתי).
‏כל 8 ה-spot-checks ‏עברו: ‏anchors ‏ב-index.js/config.js ‏תואמים main ‏מילה-במילה, ‏הקבצים ב-pr9-ref ‏שלמים,
‏הטענה ש-index.js/config.js ‏חתוכים — ‏אומתה, baseline 15/15. ‏שני minor ‏ירוקים בלבד (‏ניסוח §6 ‏תוקן).

### ‏שינויי-כיוון
‏וקטור הבדיקה ל-pbkdf2 ‏שכתבתי בתחילה (`0c60c80f...`) ‏היה שגוי — ‏זה וקטור RFC-6070 ‏ל-SHA**1**.
‏הערך הנכון ל-HMAC-SHA256 ‏הוא `65acafe9655d154ebe7ca04e8b7ebdbc2bfd1684` (‏אומת מקומית עם `crypto.pbkdf2`). ‏תוקן ב-brief.

### ‏רעיונות שנדחו
- **‏מיזוג ה-PR כמו שהוא** — ‏נדחה: ‏קבצים חתוכים + ‏רגרסיה + ‏קונפליקט. ‏לא בר-מיזוג.
- **‏לכלול auth (TOTP) ‏בחילוץ הראשון** — ‏נדחה: auth ‏דורש תלויות חדשות (otplib, qrcode), ‏rate-limiting, sessions, ‏ווקטור אבטחה. ‏לא "נקי". ‏slice ‏נפרד.
- **‏לכלול vault-registry path-guard ‏או MIME/mkdirRepair** — ‏נדחה: ‏הם נוגעים בקוד קיים (‏לא greenfield). ‏slice ‏נפרד.
- **‏לחלץ index.js/config.js ‏מ-pr9-ref** — ‏נדחה מפורשות: ‏חתוכים פיזית. ה-wiring ‏ידני על גבי main.

## 2026-06-13 — server-bootstrap-perf: ‏invalidation ‏כירורגי + threadpool ‏רחב

### ‏רציונל
‏ה-bootstrap cache ‏היה ‏"לפעמים ‏איטי ‏מאוד". ‏מדידה ‏אמפירית ‏על ‏ה-vault ‏הגדול
(009428c4, ‏על ‏מאונט **rclone FUSE מול Google Drive**, ~104 ‏תיקיות + 450 ‏קבצי
‏טקסט) ‏הראתה: ‏cold full build ‏לוקח **~37s @ threadpool=4** ‏(latency-bound),
‏ו-compression/stringify ‏זניחים (~0.5s ‏יחד). ‏שני ‏שורשים:
1. **‏כל ‏mutation ‏מוחק ‏את ‏כל ‏ה-cache** (`serverCache.delete(vaultId)`) → ‏ה-bootstrap
   ‏הבא ‏הוא ‏full re-scan. ‏Obsidian ‏שומר ‏בתכיפות (workspace.json, notes) → ‏misses ‏תכופים.
2. **‏ה-"incremental" ‏שמובטח ‏בהערות ‏לא ‏ממומש** — `changedDirs` ‏מחושב ‏ונזרק.
‏בנוסף, ‏ה-libuv threadpool ‏נשאר 4, ‏מה ‏שמסדר ‏מאות ‏פעולות-Drive ‏4-בכל-רגע.

‏הגישה: (Phase 1) ‏להגדיל `UV_THREADPOOL_SIZE` ‏כדי ‏להסתיר ‏latency; (Phase 2)
‏invalidation ‏כירורגי ‏ברמת-רשומה ‏במקום ‏nuke-all; (Phase 3) ‏incremental rebuild
‏ל-`changedDirs` ‏כרשת-ביטחון ‏ל-restart / ‏שינוי-חיצוני. ‏הצרכן (shims) ‏מקבל ‏אותו
‏payload ‏בדיוק — slice ‏ביצועי, ‏לא ‏שינוי-contract.

### ‏ממצאי אביגיל
‏סבב 1: **USABLE-AFTER-FIX, 7 ‏ממצאים** (2 🔴). ‏הקריטי: ‏ההנחה ‏"כל ‏הכתיבות
‏עוברות ‏דרך `/api/fs`" ‏שגויה — `api/electron.js:/trash` ‏הוא ‏נתיב-מחיקה ‏שני ‏עם
‏עותק invalidation ‏משלו. ‏שאר ‏הממצאים: ‏אין helper abs→rel (‏ולא ‏צריך, relPath ‏מ-req),
‏אי-עקביות ‏שמות, ‏ניסוח ‏line-numbers ‏של Commit 2, race-key ‏של pendingBuilds, ‏write-coalesce.
‏סבב 2: ‏אחרי ‏תיקון — **READY, 0 ‏ממצאים**.

### ‏שינויי-כיוון
‏Phase 2 ‏שונה ‏מ"להוסיף invalidation" ‏ל"להפוך ‏את ‏ה-invalidation ‏הקיים ‏(בשני ‏הקבצים,
‏fs.js + electron.js) ‏מ-nuke ‏ל-surgical". ‏באג ‏ה-stale-on-edit ‏שחשדנו ‏בו ‏התברר ‏כלא-קיים
‏לכתיבות-אפליקציה (‏כי ‏ה-delete-all ‏מנקה ‏הכל) — ‏רלוונטי ‏רק ‏לשינוי ‏חיצוני, ‏שמכוסה ‏ב-Phase 3.

### ‏רעיונות שנדחו
- **watcher-driven invalidation** (chokidar → cache): ‏נדחה — ‏כל ‏הכתיבות ‏עוברות ‏דרך ‏השרת
  (fs.js + electron.js), ‏אז ‏write-path ‏invalidation ‏מדויק ‏וזול ‏יותר; ‏polling ‏על rclone ‏יקר.
- **rclone VFS tuning** (`--vfs-cache-mode`): ‏host-managed (Proxmox), ‏מחוץ ‏לריפו — ‏לא ‏בקוד.

## 2026-06-13 — livesync-requesturl (Slice A): App.requestUrl

### ‏רציונל
‏אינטגרציית LiveSync (vrtmrz/obsidian-livesync) ‏מתחילה ‏מ-`App.requestUrl` — ‏היום stub.
‏פוצל ל-3 slices: A (requestUrl, `[]`), B (install-livesync.js, `[]`, מקבילי), C (E2E+docs, `[A,B]`).
‏A ‏ראשון ‏כי ‏הוא ‏הבסיס ‏לכל ‏השאר ‏וה-מסוכן ‏ביותר (base64 round-trip ‏לבינארי).
‏אסטרטגיה: fetch ‏ישיר + CORS (‏proxy ‏נדחה ‏מפורשות ב-PLAN.md). ‏מבוסס ‏על ‏תוכנית
`livesync-implementation.md` (11/5) ‏שמעודכנת ‏ל-layout ‏אחרי ה-reorg.

### ‏ממצאי אביגיל
READY ‏ישר (0 ‏חוסמים). 2 ‏nits: (1) Content-Type guard ‏לא ‏case-insensitive — ‏הוטמע;
(2) ה-offsets ‏ב-livesync-implementation.md ‏מצביעים ‏על ‏menu defs ‏לא ‏requestUrl (‏הקוד ‏האמיתי
‏ב-byte 1089452) — ‏אבל ‏החוזה ‏עצמו (body ‏עובר atob ‏ללא-תנאי) ‏אומת.

### ‏שינויי-כיוון
‏reuse ‏של ‏דפוס ה-base64 ‏המקוטע ‏הקיים ‏ב-Filesystem (‏שורות 188-213) ‏במקום ‏מימוש ‏חדש —
‏מונע ‏את ‏מלכודת btoa-on-large ‏ושומר ‏עקביות.

### ‏רעיונות שנדחו
- ‏מימוש `CapacitorHttp.request` ‏ספקולטיבי — ‏רק ‏אם ‏פלאגין ‏באמת ‏קורא ‏לו.
- ‏טיפול ב-`_changes?feed=continuous` ‏(stream ‏אינסופי) — ‏מחוץ ל-scope; ‏אם ‏עולה ‏ב-Slice C → ‏plan ‏נפרד.

## 2026-06-13 — livesync-install (Slice B): vendor/plugins overlay + install script

### ‏רציונל
‏פלאגיני ‏צד-שלישי (LiveSync) ‏לא ‏שייכים ‏לא ‏לגיט (‏הם ‏הורדות) ‏ולא ‏לכספת (‏הם ‏client-side).
‏החלטה: ‏תיקיית ‏ייעודית `vendor/plugins/` (‏gitignored ‏תחת `vendor/` ‏הקיים, regenerated ‏ע"י סקריפט),
‏לצד `src/plugins/` (‏הקוד ‏שלנו, tracked). ‏ה-overlay ‏סורק ‏את ‏שתיהן. `install-livesync.js` ‏מודל ‏על
`update-obsidian-mobile.js`.

### ‏ממצאי אביגיל
‏סבב 1: USABLE-AFTER-FIX, 3 ‏ממצאים. ‏הקריטי (🔴): `Map.set` ‏נאיבי ‏בסדר ‏src→vendor ‏נותן ‏ל-vendor
‏לדרוס ‏את ‏src — ‏הפוך ‏מה"src ‏מנצח" ‏שהוצהר. ‏תוקן ל-first-wins ‏מפורש (`has` ‏guard).
‏עוד: (א) `fs.js:253` ‏משתמש ‏ב-`SYSTEM_PLUGINS_DIR` ‏הקבוע — ‏חייב resolver ‏פר-id (‏getSystemPluginDir);
(ב) ‏ייבוא ‏מת ‏פוטנציאלי ‏ב-fs.js; (ג) ‏טסט ‏overlay ‏חדש ‏(לא ‏קיים). ‏סבב 2: READY, 0 ‏ממצאים.

### ‏שינויי-כיוון
`SYSTEM_PLUGIN_IDS` (Set) → `Map<id, rootDir>` ‏כדי ‏לדעת ‏מאיזו ‏תיקייה ‏בא ‏כל id (‏נדרש ‏לפתרון ‏נתיב ‏נכון
‏אחרי ‏הוספת ‏התיקייה ‏השנייה).

### ‏רעיונות שנדחו
- ‏לקמט ‏את ‏הפלאגין ‏לגיט (vendor-in-repo) — ‏נדחה ‏לטובת gitignored+regenerate, ‏עקבי ‏עם `vendor/`.
- `SYSTEM_PLUGINS` env-var gating — future (PLAN.md), ‏לא ‏חוסם.
