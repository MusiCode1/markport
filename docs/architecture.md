# Architecture - obsidian-web

> קהל: מי שמשנה את הקוד. ה"למה", לא ה"איך-משתמשים" (זה `README.md`).

## מה זה
מריצים את ה-renderer של Obsidian (בַּאנדל upstream, `vendor/obsidian-mobile/`)
בדפדפן רגיל, ע"י shims שמזייפים את Electron/Capacitor. אחרי ה-mobile-first
collapse יש **core אחד** (client-mobile) עם **backend מתחלף**, לא שני ראנטיימים.

## שכבות ה-runtime (לא frozen - שכבות אמיתיות)

| שכבה | סטטוס | אחסון | פריסה |
|------|-------|-------|-------|
| **serverless** | ★ ראשי | OPFS (בדפדפן) + folder-vaults (FSA API) | CF Pages static + Worker proxy |
| **server** | חי, אופציה 2 | קבצים אמיתיים דרך `/api/fs` | `deployments/server/` (node; אין Dockerfile בריפו) |
| **desktop** | נשמר, עתיד פתוח | - | `vendor/obsidian-desktop` (מקביל ל-mobile) |

**הטריגר בין serverless↔server**: **לא** probe / capability-detection על `/api/fs` - אין
כזה. הטריגר הוא **רישום מקומי** (`window.__owLocalVaults`, נטען סינכרונית ב-`<script>`
לפני `boot.js`, ראה סדר-הטעינה ב-`index.html`): אם ה-vault-id מופיע ברישום, ה-`type`
הרשום שלו (`'local'` / `'folder'`) קובע OPFS; **אחרת** ברירת-המחדל היא `'server'` - **גם
בפריסה סטטית בלי שרת בכלל** (`boot.js:149-151`):
```js
var __owV = window.__owLocalVaults && window.__owLocalVaults.get(VAULT_ID);
var VAULT_TYPE = __owV ? (__owV.type || 'local') : 'server';
```
כלומר: vault-id שלא נוצר/נפתח מקומית (ולכן לא ברישום) ינסה `'server'` גם על CF -
אין נפילה-אוטומטית ל-OPFS למי שלא ברישום. ההשלכה ההתנהגותית (מה קורה בפועל כש-
`'server'` נבחר בלי שרת) מטופלת בסלייס `client-only-resilience` (גל 2ב), לא כאן.

## מבנה תיקיות (יעד)
```
vendor/                    upstream, gitignored, מיוצר ע"י scripts (משותף)
  obsidian-mobile/         ה-renderer הפעיל (מ-APK אנדרואיד)
  obsidian-desktop/        אופציה שנייה (מקביל)
  plugins/                 LiveSync וכו'
scripts/                   tooling משותף: update/patch-obsidian-{mobile,desktop}
src/
  core/                    (R3 עתידי) base shims משותפים: path/os/url/btime + dispatcher
  client-mobile/           הלקוח (שומרים "Mobile") - OPFS backend, boot, seed, SW
  runtime-server/          קוד ספציפי-לשרת, מבודד:
     server/               Node: /api/fs, watch, bootstrap
     client-shims/         ענף ה-HTTP backend + shims ייחודיים-לשרת
  deployments/
     cloudflare/           serverless (static + _worker.js)   ← ברירת-מחדל
     server/               פריסת-שרת (node; אין Dockerfile בריפו כיום)
```

## עקרונות מנחים
- **serverless ראשי** - כל שינוי core לא שובר את הפריסה הסטטית.
- **HTTPS+auth = אחריות המפעיל** - השרת מגיש HTTP; reverse-proxy (Caddy מומלץ)
  נותן TLS+auth. לכן `crypto.subtle` נייטיבי, בלי polyfills כתובים-ביד.
- **"צד-שרת" עתידני** = OPFS + sync-plugin (LiveSync), לא הרחבת /api/fs.
- **boot-order**: FS adapter חייב pre-boot (לפתוח כספת) → **לא יכול להיות פלאגין**.

## הבַּאנדל של Obsidian (vendor)
- `vendor/*` gitignored, מיוצר ע"י `scripts/update-obsidian-mobile.js` (מוריד APK).
- **אפס patches** (`docs/plans/zero-patches.md`) - `vendor/obsidian-mobile/app.js` זהה-בייט
  לרשומת ה-APK (`assets/public/app.js`). `scripts/patch-obsidian-mobile.js` נשאר קיים
  כתשתית (`PATCHES = []`) לגרסה עתידית שתדרוש patch. כל התנהגות-הפלטפורמה (mobile/desktop
  layout, כולל פאנל ה-vault-profile) מותאמת ב-runtime ע"י
  `client-mobile/platform-bridge.js` (יירוט `Object.defineProperty`, לא עריכת app.js) -
  ראה `docs/plans/runtime-platform-descriptors.md`.
- version-bump: הרץ update עם `--version <X>`; אם ייווסף patch עתידי וזה יזרוק - עקוב אחר
  בלוק ANCHOR/REBUILD שלו ב-`scripts/patch-obsidian-mobile.js`.
