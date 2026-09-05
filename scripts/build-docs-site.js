#!/usr/bin/env node
/**
 * Build the documentation site from the Markdown in docs/.
 *
 * Nothing here reaches the visitor: `marked` runs at build time and the
 * output is plain HTML. The pages carry no JavaScript, and the code samples
 * are coloured by scripts/highlight-static-code.js afterwards.
 *
 * Layout produced in .tmp/site/ :
 *
 *   index.html                    ->  /                    (English landing)
 *   architecture.html             ->  /architecture
 *   system-plugin-dev-guide.html  ->  /system-plugin-dev-guide
 *   version-support.html          ->  /version-support
 *   he/index.html                 ->  /he/                 (Hebrew landing)
 *   he/architecture.html          ->  /he/architecture
 *   he/system-plugin-dev-guide.html
 *
 * The two landing pages are hand-written and copied verbatim; only the
 * Markdown documents are rendered.
 *
 *   node scripts/build-docs-site.js
 */

const fs = require('fs');
const path = require('path');
const { marked } = require(path.join(__dirname, 'node_modules', 'marked'));

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(ROOT, '.tmp', 'site');

/** Documents to render. `out` is relative to OUT, without the extension. */
// Only pages a visitor has a reason to open. The system-plugin guide is for
// people contributing to Markport, and obsidian-version-support duplicates the
// landing page's "what does not work" section - both stay in the repo, and
// neither is published as a route.
const PAGES = [
  { src: 'install.md',         out: 'install',      lang: 'en' },
  { src: 'architecture.md',    out: 'architecture', lang: 'en' },
  { src: 'he/install.md',      out: 'he/install',   lang: 'he' },
  { src: 'he/architecture.md', out: 'he/architecture', lang: 'he' },
];

/** Pull the <style> block out of the landing page so there is one source of truth. */
function sharedStyle() {
  const landing = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const m = /<style>[\s\S]*?<\/style>/.exec(landing);
  if (!m) throw new Error('No <style> block found in docs/index.html');
  return m[0];
}

const EXTRA_CSS = `
<style>
  /* Documentation pages: a little more room and a plain document rhythm. */
  .doc { max-width: 820px; margin: 0 auto; padding: 34px 20px 70px; }
  .doc h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 6px; letter-spacing: -0.02em; }
  .doc h2 { font-size: 1.3rem; margin: 34px 0 12px; padding-top: 22px; border-top: 1px solid var(--line); }
  .doc h3 { font-size: 1.06rem; margin: 24px 0 8px; }
  .doc blockquote { margin: 14px 0; padding: 0 0 0 14px; border-inline-start: 3px solid var(--line); color: var(--dim); }
  .doc blockquote p { margin: 6px 0; }
  .doc table { margin: 14px 0; }
  .doc td, .doc th { text-align: start; }
  .doc td:not(:first-child), .doc th:not(:first-child) { text-align: start; width: auto; }
  .doc img { max-width: 100%; }
  .doc hr { border: none; border-top: 1px solid var(--line); margin: 26px 0; }
  .crumb { display: block; margin-bottom: 20px; font-size: .92rem; color: var(--dim); }
  .crumb a { text-decoration: none; }
</style>`;

function page({ title, lang, body, home, homeLabel, altHref, altLabel, altLang }) {
  const rtl = lang === 'he';
  return `<!doctype html>
<html lang="${lang}"${rtl ? ' dir="rtl"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - Markport</title>
<meta name="theme-color" content="#1e1e1e">
<meta property="og:title" content="${title} - Markport">
${sharedStyle()}${EXTRA_CSS}
</head>
<body>

<a class="lang" href="${altHref}" hreflang="${altLang}" lang="${altLang}"${altLang === 'he' ? ' dir="rtl"' : ''}>${altLabel}</a>

<article class="doc">
  <a class="crumb" href="${home}">${homeLabel}</a>
${body}
</article>

<footer class="wrap">
  <a href="https://github.com/MusiCode1/markport">GitHub</a>
  <p class="note" style="margin-top:14px">
    Markport is free software under the GPL-3.0 - that covers Markport's own code, not
    Obsidian's. Obsidian is a trademark of its owner.
  </p>
</footer>

</body>
</html>
`;
}

function render(p) {
  const md = fs.readFileSync(path.join(DOCS, p.src), 'utf8');
  let body = marked.parse(md, { mangle: false, headerIds: false });

  // Repo-relative .md links are correct on GitHub and dead on the site, so
  // they are rewritten to the published route. `he/x.md` and `../x.md` are
  // the two shapes the documents actually use.
  body = body
    .replace(/href="he\/([^"]+)\.md"/g, 'href="/he/$1"')
    .replace(/href="\.\.\/([^"]+)\.md"/g, 'href="/$1"')
    .replace(/href="([A-Za-z0-9-]+)\.md"/g, 'href="/$1"')
    .replace(/href="\/obsidian-version-support"/g, 'href="/version-support"');

  // The first heading becomes the <title>; strip the trailing " - Markport"
  // the documents already carry so it is not doubled.
  const h1 = /^#\s+(.+)$/m.exec(md);
  const title = (h1 ? h1[1] : p.out).replace(/\s*-\s*Markport\s*$/i, '').trim();

  const he = p.lang === 'he';
  const html = page({
    title,
    lang: p.lang,
    body,
    home: he ? '/he/' : '/',
    homeLabel: he ? '→ חזרה לדף הראשי' : '← Back to the home page',
    altHref: he ? '/' + p.out.replace(/^he\//, '') : '/he/' + p.out,
    altLabel: he ? 'English' : 'עברית',
    altLang: he ? 'en' : 'he',
  });

  const dest = path.join(OUT, p.out + '.html');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html);
  return dest;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'he'), { recursive: true });

// Landing pages, verbatim. The Hebrew one moves to he/index.html so that
// /he and /he/<doc> live under the same prefix.
fs.copyFileSync(path.join(DOCS, 'index.html'), path.join(OUT, 'index.html'));
fs.copyFileSync(path.join(DOCS, 'he.html'), path.join(OUT, 'he', 'index.html'));
console.log('landing: index.html, he/index.html');

for (const p of PAGES) console.log('rendered:', path.relative(OUT, render(p)));
console.log('\nout:', path.relative(ROOT, OUT));
