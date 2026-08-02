/**
 * check-core-boundary.mjs
 *
 * Enforces the dependency boundary of packages/core:
 * - Relative imports (./) within the package are allowed
 * - node:* built-ins are allowed
 * - Anything else must be listed in packages/core/package.json "dependencies"
 * - ../ that escapes packages/core/ is forbidden
 *
 * Anchored to import.meta.dirname (not cwd) because this script runs from
 * packages/core via the test script.
 */

import { readFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { readdirSync } from 'node:fs';

const coreDir = resolve(import.meta.dirname, '..', 'packages', 'core');
const pkgPath = join(coreDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const allowedDeps = new Set(Object.keys(pkg.dependencies || {}));

/**
 * Recursively collect all .ts files under a directory.
 */
function collectTsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Extract import/require specifiers from a TypeScript source string.
 * Handles:
 *   import ... from 'specifier'
 *   import 'specifier'
 *   require('specifier')
 *   export ... from 'specifier'
 */
function extractSpecifiers(source) {
  const specifiers = [];
  // import ... from '...'  /  import '...'  /  export ... from '...'
  const importExportRe = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = importExportRe.exec(source)) !== null) {
    specifiers.push(m[1]);
  }
  // require('...')
  const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requireRe.exec(source)) !== null) {
    specifiers.push(m[1]);
  }
  return specifiers;
}

const files = collectTsFiles(coreDir);
let violations = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const specifiers = extractSpecifiers(source);
  for (const spec of specifiers) {
    // node:* built-ins are always allowed
    if (spec.startsWith('node:')) continue;

    // Relative imports
    if (spec.startsWith('./') || spec.startsWith('../')) {
      // Resolve the target and check it stays within packages/core
      const resolvedTarget = resolve(file, '..', spec);
      const relToCore = relative(coreDir, resolvedTarget);
      if (relToCore.startsWith('..') || resolve(resolvedTarget) === coreDir) {
        // Escapes packages/core
        const relFile = relative(coreDir, file);
        console.error(`VIOLATION: ${relFile}: '${spec}' escapes packages/core/`);
        violations++;
      }
      continue;
    }

    // Bare specifier — must be in dependencies
    if (!allowedDeps.has(spec)) {
      const relFile = relative(coreDir, file);
      console.error(`VIOLATION: ${relFile}: '${spec}' is not in packages/core dependencies`);
      violations++;
    }
  }
}

console.log(`checked ${files.length} files`);

if (violations > 0) {
  console.error(`${violations} boundary violation(s)`);
  process.exit(1);
}
