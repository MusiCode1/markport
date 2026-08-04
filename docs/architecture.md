# Architecture — obsidian-web

> קהל: מי שמשנה את הקוד. ה"למה", לא ה"איך-משתמשים" (זה `README.md`).

## מה זה
מריצים את ה-renderer של Obsidian (בַּאנדל upstream, `vendor/obsidian-mobile/`)
בדפדפן רגיל, ע"י shims שמזייפים את Electron/Capacitor. אחרי ה-mobile-first
collapse יש **core אחד** (client-mobile) עם **backend מתחלף**, לא שני ראנטיימים.

## שכבות ה-runtime (לא frozen — שכבות אמיתיות)

| שכבה | סטטוס | אחסון | פריסה |
|------|-------|-------|-------|
| **serverless** | ★ ראשי | OPFS (בדפדפן) + folder-vaults (FSA API) + github-vaults (repo משוכפל לאחד מהשניים) | CF Pages static + Worker proxy |
| **server** | חי, אופציה 2 | קבצים אמיתיים דרך `/api/fs` | `deployments/server/` (node; אין Dockerfile בריפו) |
| **desktop** | נשמר, עתיד פתוח | — | `vendor/obsidian-desktop` (מקביל ל-mobile) |

**הטריגר בין serverless↔server**: **לא** probe / capability-detection על `/api/fs` — אין
כזה. הטריגר הוא **רישום מקומי** (`window.__owLocalVaults`, נטען סינכרונית ב-`<script>`
לפני `boot.js`, ראה סדר-הטעינה ב-`index.html`): אם ה-vault-id מופיע ברישום, ה-`type`
הרשום שלו (`'local'` / `'folder'` / `'github'`) קובע OPFS; **אחרת** ברירת-המחדל היא `'server'` — **גם
בפריסה סטטית בלי שרת בכלל** (`boot.js:149-151`):
```js
var __owV = window.__owLocalVaults && window.__owLocalVaults.get(VAULT_ID);
var VAULT_TYPE = __owV ? (__owV.type || 'local') : 'server';
```
כלומר: vault-id שלא נוצר/נפתח מקומית (ולכן לא ברישום) ינסה `'server'` גם על CF —
אין נפילה-אוטומטית ל-OPFS למי שלא ברישום. ההשלכה ההתנהגותית (מה קורה בפועל כש-
`'server'` נבחר בלי שרת) מטופלת בסלייס `client-only-resilience` (גל 2ב), לא כאן.

**`'github'`** אינו backend נוסף אלא **מקור-תוכן**: `storage/github-repo.js` משכפל את ה-repo
בפתיחה הראשונה, ומשם והלאה זו כספת רגילה לכל דבר — אותו `OpfsStore`, אותו נתיב
`/_owres/` ב-SW, אותו `fsBackend()`. ה-`type` שומר רק שתי עובדות: מאיפה התוכן הגיע,
ושפעולת "Pull" רלוונטית. מצב-הסנכרון (owner/repo/ref/commit + מפת blob-shas) יושב
ב-`localStorage['ow-github:'+vaultId]`, באותה מוסכמה של `ow-sync:<id>`.

**`storage`** (שדה-רישום שני, `'opfs'` | `'folder'`) עונה על השאלה הנפרדת **היכן הבתים
יושבים** — OPFS, או ספרייה שהמשתמש בחר ב-`showDirectoryPicker` (הדיאלוג נפתח ב-
`startIn:'downloads'`, ונוצרת בתוכה תת-ספרייה בשם ה-repo). עד שאפשר היה לשכפל repo
לספרייה אמיתית, ה-`type` לבדו ענה גם על זה — ולכן `'github'+'folder'` הוא בדיוק הצירוף
ששבר את ההנחה. כל בדיקה ששואלת "האם צריך handle מורשה-הרשאה?" (ה-permission gate
ב-`verifyPromise`, ה-responder של `/_owres/`, ה-watch לשינויים חיצוניים, מפעלי-ה-store)
שואלת את `storage`; כל בדיקה ששואלת "איזו כספת זו ומה אפשר לעשות בה" ממשיכה לשאול
`type`. רשומות שנכתבו לפני שהשדה קיים גוזרות אותו (`storageOf` ב-
`local-vault-registry.js`: `type:'folder'` ⇒ `'folder'`, אחרת `'opfs'`) — אין מיגרציה.

כספת `'github'` ששוכנת ב-`'folder'` מקבלת גם **`.git` אמיתי**
(`storage/git-writer.js`): loose objects לכל blob/tree, ה-commit עצמו,
`index` (כך ש-`git status` נקי מיד), `HEAD`/`refs`/`config`/`shallow` — כלומר
בדיוק מה ש-`git clone --depth 1 --single-branch` היה יוצר, עד כדי sha. הוא
**נבנה ולא נמשך**, כי פרוטוקול ה-git של GitHub לא שולח CORS כלל (טבלת המדידה
ב-[investigations](investigations.md#github-folder-clone)); כל object מאומת מול
ה-sha ש-GitHub דיווח, ואי-התאמה מבטלת את כתיבת ה-`.git` כולה במקום להשאיר repo
פגום. ב-`'opfs'` זה מכובה — `.git` שם בלתי-נראה לכל git שקיים, ורק היה מכפיל
את הצריכה מהמכסה. `gitCommit` ב-state הוא ה-commit שה-`.git` שלו **שלם**, ולכן
כספת שנוצרה לפני התכונה בונה אותו ב-Pull הבא מהקבצים שכבר על הדיסק (בלי הורדה
מחדש). `.git` ברמת השורש מוחרג משתי הסריקות הרקורסיביות ב-`opfs-store.js`
(`watchAndStatAll`, `snapshotTree`) — הוא לא תוכן-כספת, ו-repo אמיתי מכיל object
לכל גרסת-קובץ.

זהו גם הסוג היחיד שיש לו **URL ניתן-לשיתוף**: `/github/<owner>/<repo>[/<note>]`
(`parseShareLink` ב-`storage/github-repo.js`, מנותב בראש `boot.js` לפני ניתוב-הכניסה
הרגיל). `/vault/<id>` **אינו** ניתן-לשיתוף — ה-id הוא מפתח ברישום המקומי של הדפדפן
השולח, ואצל הנמען הוא נפתר ל"הכספת אינה במכשיר הזה". המסלול החדש נושא את ה-repo עצמו,
כך שהכספת נבנית בהגעה: קיימת ⇒ נכנסים אליה (עם העריכות המקומיות); לא קיימת ⇒ נוצרת
רשומת-רישום ומעבירים ל-`/vault/<id>`, ששם רץ **מסלול-השכפול הקיים** של פתיחה-ראשונה
(לא עותק שני שלו). שתי הפריסות חייבות להגיש את ה-shell גם ל-`/github/*` —
`runtime-server/server/index.js` ו-`deployments/cloudflare/index.js`.

## מבנה תיקיות (יעד)
```
vendor/                    upstream, gitignored, מיוצר ע"י scripts (משותף)
  obsidian-mobile/         ה-renderer הפעיל (מ-APK אנדרואיד)
  obsidian-desktop/        אופציה שנייה (מקביל)
  plugins/                 LiveSync וכו'
scripts/                   tooling משותף: update/patch-obsidian-{mobile,desktop}
src/
  core/                    (R3 עתידי) base shims משותפים: path/os/url/btime + dispatcher
  client-mobile/           הלקוח (שומרים "Mobile") — OPFS backend, boot, seed, SW
  runtime-server/          קוד ספציפי-לשרת, מבודד:
     server/               Node: /api/fs, watch, bootstrap
     client-shims/         ענף ה-HTTP backend + shims ייחודיים-לשרת
  deployments/
     cloudflare/           serverless (static + _worker.js)   ← ברירת-מחדל
     server/               פריסת-שרת (node; אין Dockerfile בריפו כיום)
```

## עקרונות מנחים
- **serverless ראשי** — כל שינוי core לא שובר את הפריסה הסטטית.
- **HTTPS+auth = אחריות המפעיל** — השרת מגיש HTTP; reverse-proxy (Caddy מומלץ)
  נותן TLS+auth. לכן `crypto.subtle` נייטיבי, בלי polyfills כתובים-ביד.
- **"צד-שרת" עתידני** = OPFS + sync-plugin (LiveSync), לא הרחבת /api/fs.
- **boot-order**: FS adapter חייב pre-boot (לפתוח כספת) → **לא יכול להיות פלאגין**.

## הבַּאנדל של Obsidian (vendor)
- `vendor/*` gitignored, מיוצר ע"י `scripts/update-obsidian-mobile.js` (מוריד APK).
- **אפס patches** (`docs/plans/zero-patches.md`) — `vendor/obsidian-mobile/app.js` זהה-בייט
  לרשומת ה-APK (`assets/public/app.js`). `scripts/patch-obsidian-mobile.js` נשאר קיים
  כתשתית (`PATCHES = []`) לגרסה עתידית שתדרוש patch. כל התנהגות-הפלטפורמה (mobile/desktop
  layout, כולל פאנל ה-vault-profile) מותאמת ב-runtime ע"י
  `client-mobile/platform-bridge.js` (יירוט `Object.defineProperty`, לא עריכת app.js) —
  ראה `docs/plans/runtime-platform-descriptors.md`.
- version-bump: הרץ update עם `--version <X>`; אם ייווסף patch עתידי וזה יזרוק — עקוב אחר
  בלוק ANCHOR/REBUILD שלו ב-`scripts/patch-obsidian-mobile.js`.
