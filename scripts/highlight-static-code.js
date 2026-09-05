#!/usr/bin/env node
/**
 * Build-time syntax highlighting for the landing pages.
 *
 * The code samples on docs/index.html and docs/he.html never change at
 * runtime, so there is no reason to ship a highlighter to the visitor.
 * This tokenises each <pre><code> block once and writes the coloured
 * markup back into the file. The page keeps zero JavaScript.
 *
 * Idempotent: existing <span class="t-*"> wrappers are stripped before
 * re-tokenising, so running this twice is the same as running it once.
 *
 *   node scripts/highlight-static-code.js [file...]     (default: both pages)
 */

const fs = require('fs');
const path = require('path');

const KEYWORDS = new Set([
  'await', 'break', 'case', 'catch', 'const', 'continue', 'default', 'delete',
  'do', 'else', 'export', 'finally', 'for', 'function', 'if', 'import', 'in',
  'instanceof', 'let', 'new', 'of', 'return', 'switch', 'this', 'throw', 'try',
  'typeof', 'var', 'void', 'while', 'yield', 'async', 'class', 'extends',
  'true', 'false', 'null', 'undefined',
]);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const esc = (s) => s.replace(/[&<>]/g, (c) => ESC[c]);
const wrap = (cls, s) => `<span class="t-${cls}">${esc(s)}</span>`;

/** Minimal JS lexer — enough for the samples we ship, not a parser. */
function highlight(code) {
  let out = '';
  let i = 0;

  while (i < code.length) {
    const c = code[i];
    const rest = code.slice(i);

    // line comment
    let m = /^\/\/[^\n]*/.exec(rest);
    if (m) { out += wrap('c', m[0]); i += m[0].length; continue; }

    // block comment
    m = /^\/\*[\s\S]*?\*\//.exec(rest);
    if (m) { out += wrap('c', m[0]); i += m[0].length; continue; }

    // string — single, double, template. No escape handling needed here,
    // but \" and \' are consumed so a quote inside a string cannot end it.
    m = /^"(?:\\.|[^"\\])*"|^'(?:\\.|[^'\\])*'|^`(?:\\.|[^`\\])*`/.exec(rest);
    if (m) { out += wrap('s', m[0]); i += m[0].length; continue; }

    // number
    m = /^\d+(?:\.\d+)?/.exec(rest);
    if (m) { out += wrap('n', m[0]); i += m[0].length; continue; }

    // identifier / keyword / property
    m = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (m) {
      const word = m[0];
      const before = code.slice(0, i);
      const after = code.slice(i + word.length);
      let cls;
      if (KEYWORDS.has(word)) cls = 'k';
      // .property — only when the dot is on the SAME line. Without the
      // [ \t] restriction a comment ending in a full stop would make the
      // next line's first identifier look like a member access.
      else if (/\.[ \t]*$/.test(before)) cls = 'p';
      else if (/^\s*\(/.test(after)) cls = 'f';           // call()
      else cls = 'v';
      out += wrap(cls, word);
      i += word.length;
      continue;
    }

    // operators and punctuation
    m = /^[=!<>+\-*/%&|^~?:]+/.exec(rest);
    if (m) { out += wrap('o', m[0]); i += m[0].length; continue; }

    out += esc(c);
    i += 1;
  }
  return out;
}

/** Strip previous highlighting so the pass is idempotent. */
function unhighlight(html) {
  return html
    .replace(/<span class="t-[a-z]">/g, '')
    .replace(/<\/span>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function processFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  let blocks = 0;

  const out = src.replace(
    /(<pre[^>]*><code>)([\s\S]*?)(<\/code><\/pre>)/g,
    (_, open, body, close) => {
      blocks += 1;
      return open + highlight(unhighlight(body)) + close;
    }
  );

  if (out === src) {
    console.log(`${path.basename(file)}: ${blocks} blocks, unchanged`);
    return;
  }
  fs.writeFileSync(file, out);
  console.log(`${path.basename(file)}: ${blocks} blocks highlighted`);
}

const ROOT = path.resolve(__dirname, '..');
const files = process.argv.length > 2
  ? process.argv.slice(2)
  : [path.join(ROOT, 'docs/index.html'), path.join(ROOT, 'docs/he.html')];

for (const f of files) processFile(f);
