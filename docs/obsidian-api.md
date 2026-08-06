# Obsidian plugin API — מפת הסמלים המיוצאים

> **גרסה ראשונה, מיוצרת מהבאנדל.** טרם עברה אימות ידני — ראה "מצב המסמך" בסוף.
> קהל: מי שמפתח על obsidian-web ורוצה לדעת על מה אפשר להישען.

## למה המסמך הזה קיים

obsidian-web מזייף ל-Obsidian פלטפורמה (Electron/Capacitor/Node) דרך shims. ככל שנוכל
להישען על **ה-API הציבורי של Obsidian** במקום על מבנים פנימיים או על patches לבאנדל —
הפרויקט יציב יותר מול שדרוגי גרסה, ועמדתו מול תנאי-השימוש של Obsidian נוחה יותר.

`docs/investigations.md` ממפה את הצד ההפוך — את **Capacitor**, כלומר מה ש*אנחנו* מממשים.
המסמך הזה ממפה מה ש**Obsidian מציעה**.

## מאיפה זה נלקח

מודול `obsidian` (זה ש-`require('obsidian')` מחזיר לפלאגינים) מייצא **155 סמלים**.
הרשימה חולצה ממפת-הייצוא בבאנדל — רצף `Name:()=>symbol` בטווח 252,892–256,121
של `vendor/obsidian-mobile/app.js` (Obsidian 1.12.7):

```js
…Notice:()=>ww, Platform:()=>bn, Plugin:()=>a0, PluginSettingTab:()=>s0…
```

לשחזור אחרי שדרוג גרסה: חפשו `Platform:()=>` וקחו את הרצף הרציף סביבו.

## מקרא

**`שם`** ✅ — מוזכר היום בקוד שלנו (`src/`). 17 מתוך 155.
`שם` — מיוצא ולא נגענו בו.

> ⚠️ הסימון הוא היוריסטיקה טקסטואלית. שמות גנריים (`App`, `Vault`, `Setting`) עלולים
> להיספר בהקשר אחר. אימות ידני — ראה "מצב המסמך".

## ממצאים ששווים מבט

**`Platform`** — האובייקט שדרכו Obsidian מדווחת mobile/desktop/phone/tablet. **הוא API ציבורי**,
לא סמל פנימי. זה הבסיס למעבר מ-build-time patches ל-property descriptors בזמן ריצה
(בריף `runtime-platform-descriptors`).

**`CapacitorAdapter` ו-`FileSystemAdapter`** — שני ה-adapters של Obsidian מיוצאים בפומבי.
`app.vault.adapter` הוא `CapacitorAdapter` בבאנדל המובייל, וזה מה שה-shim שלנו מזין.
⚠️ **הדגל `isMobileApp` הוא שקובע איזה adapter נבחר — אסור לדרוס אותו** (`investigations.md:711`).

**`Bases` — 29 סמלים, ואנחנו לא נוגעים באף אחד.** הפיצ'ר החדש של Obsidian
(`BasesView`, `BasesQueryResult`, ומערכת טיפוסים שלמה: `StringValue`, `DateValue`, `LinkValue`…).
כספת-הדמו כבר מכילה קובץ `.base`. משטח לא-בדוק לגמרי אצלנו.

**עוזרי rendering שאולי מייתרים קוד שלנו** — `htmlToMarkdown`, `sanitizeHTMLToDom`,
`renderMath`/`finishRenderMath`, ו-loaders עצלים: `loadMathJax`, `loadMermaid`, `loadPdfJs`, `loadPrism`.
שווה לבדוק אם הם מייתרים טעינות שאנחנו מנהלים ידנית.

**`SecretStorage`** — מיוצא. היום `SecureStorage` שלנו הוא `localStorage` עם קידומת ו**ללא הצפנה**
(`capacitor-shim.js:31`), ושם נוחתים פרטי-החיבור של LiveSync. שווה בדיקה.

**`requireApiVersion` / `apiVersion`** — מאפשרים לפלאגינים לבדוק תאימות. רלוונטי אם נרצה
שה-system plugins שלנו יתנהגו נכון על פני גרסאות.

---

## המפה המלאה (155)

### Adapters — קבצים

- **`CapacitorAdapter`** ✅
- `FileManager`
- `FileSystemAdapter`
- `TAbstractFile`
- `TFile`
- `TFolder`
- **`Vault`** ✅
- `getBlobArrayBuffer`
- `normalizePath`

### Bases — הפיצ'ר החדש

- `BasesEntry`
- `BasesEntryGroup`
- `BasesQueryResult`
- `BasesView`
- `BasesViewConfig`
- `BooleanValue`
- `DateValue`
- `DurationValue`
- `FileValue`
- `HTMLValue`
- `IconValue`
- `ImageValue`
- `LinkValue`
- `ListValue`
- `NotNullValue`
- `NullValue`
- `NumberValue`
- `ObjectValue`
- `PrimitiveValue`
- `QueryController`
- `RegExpValue`
- `RelativeDateValue`
- `RenderContext`
- `StringValue`
- `TagValue`
- `UrlValue`
- `Value`
- `ValueComponent`
- `parsePropertyId`

### Workspace & Views

- `EditableFileView`
- `FileView`
- `HoverPopover`
- `ItemView`
- `MarkdownView`
- `PopoverState`
- `TextFileView`
- `View`
- `ViewRegistry`
- `Workspace`
- `WorkspaceContainer`
- `WorkspaceFloating`
- `WorkspaceItem`
- `WorkspaceLeaf`
- `WorkspaceParent`
- `WorkspaceRibbon`
- `WorkspaceRoot`
- `WorkspaceSidedock`
- `WorkspaceSplit`
- `WorkspaceTabs`
- `WorkspaceWindow`

### Markdown & rendering

- `MarkdownPreviewRenderer`
- `MarkdownPreviewSection`
- `MarkdownPreviewView`
- `MarkdownRenderChild`
- `MarkdownRenderer`
- `finishRenderMath`
- `htmlToMarkdown`
- `loadMathJax`
- `loadMermaid`
- `loadPdfJs`
- `loadPrism`
- `renderMath`
- `resolveSubpath`
- `sanitizeHTMLToDom`
- `stripHeading`
- `stripHeadingForLink`

### Editor / CodeMirror גשר

- `Editor`
- `EditorSuggest`
- `Keymap`
- `Scope`
- `editorEditorField`
- `editorInfoField`
- `editorLivePreviewField`
- `editorViewField`
- `livePreviewState`

### Metadata / links / frontmatter

- `MetadataCache`
- `getAllTags`
- `getFrontMatterInfo`
- `getLinkpath`
- `iterateCacheRefs`
- `iterateRefs`
- `parseFrontMatterAliases`
- `parseFrontMatterEntry`
- `parseFrontMatterStringArray`
- `parseFrontMatterTags`
- `parseLinktext`
- `parseYaml`
- `stringifyYaml`

### חיפוש

- `SearchComponent`
- `fuzzySearch`
- `prepareFuzzySearch`
- `prepareQuery`
- `prepareSimpleSearch`
- `renderMatches`
- `renderResults`
- `sortSearchResults`

### UI components / settings

- `AbstractInputSuggest`
- `AbstractTextComponent`
- `BaseComponent`
- `ButtonComponent`
- `ColorComponent`
- **`Component`** ✅
- `DropdownComponent`
- `ExtraButtonComponent`
- `FuzzySuggestModal`
- **`Menu`** ✅
- `MenuItem`
- `MenuSeparator`
- `Modal`
- `MomentFormatComponent`
- **`Notice`** ✅
- `PluginSettingTab`
- `PopoverSuggest`
- `ProgressBarComponent`
- `SecretComponent`
- **`Setting`** ✅
- `SettingGroup`
- `SettingTab`
- `SliderComponent`
- `SuggestModal`
- `TextAreaComponent`
- `TextComponent`
- `ToggleComponent`
- `addIcon`
- `displayTooltip`
- `getIcon`
- `getIconIds`
- `removeIcon`
- **`setIcon`** ✅
- `setTooltip`

### Plugin lifecycle

- **`App`** ✅
- **`Events`** ✅
- **`Platform`** ✅
- **`Plugin`** ✅
- `SecretStorage`
- `apiVersion`
- `requireApiVersion`

### Utilities

- **`arrayBufferToBase64`** ✅
- `arrayBufferToHex`
- **`base64ToArrayBuffer`** ✅
- **`debounce`** ✅
- `getLanguage`
- `hexToArrayBuffer`
- **`moment`** ✅
- **`request`** ✅
- **`requestUrl`** ✅

---

## מצב המסמך

**מה מאומת:** רשימת 155 הסמלים — חולצה ישירות ממפת-הייצוא של הבאנדל.

**מה לא מאומת:**
1. **החתימות** — אין כאן טיפוסים/פרמטרים. המקור הרשמי הוא `obsidian.d.ts` בריפו
   `obsidianmd/obsidian-api`; כדאי להצליב.
2. **סימוני ה-✅** — היוריסטיקה טקסטואלית, ראה מקרא.
3. **הקטגוריות** — נגזרו מדפוסי-שמות, לא מקריאת קוד.
4. **מה באמת שמיש אצלנו** — סמל מיוצא לא בהכרח עובד בסביבה שלנו. כל שימוש חדש
   דורש בדיקה בדפדפן אמיתי.

**הצעד הבא:** הצלבה מול `obsidian.d.ts` הרשמי, וסימון פר-סמל של
"עובד / לא נבדק / שבור אצלנו".
