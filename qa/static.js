// Tier 0 (qa/README.md): checks that need no browser, run before every push.
//   - every JSON file of the theme parses (Shopify's comment header allowed);
//   - every JS asset and {% javascript %} block parses. One syntax error in a
//     {% javascript %} block breaks compiled_assets/snippet-scripts.js, and
//     with it the scripts of every section, so this matters more than it looks;
//   - no Liquid file grows past the Shopify size limit.
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = path.join(__dirname, '..');
const LIQUID_LIMIT = 256 * 1024; // characters, Shopify's per-file limit
const LIQUID_WARN = 250 * 1000;

const failures = [];
const warnings = [];
let counts = { json: 0, js: 0, blocks: 0, liquid: 0 };

const files = (dir, ext) => {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((d) => {
    const rel = path.join(dir, d.name);
    if (d.isDirectory()) return files(rel, ext);
    return d.name.endsWith(ext) ? [rel] : [];
  });
};
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function parseJs(src) {
  try {
    acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
    return null;
  } catch (moduleError) {
    try {
      acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
      return null;
    } catch (scriptError) {
      return /\b(import|export)\b/.test(src) ? moduleError : scriptError;
    }
  }
}

for (const dir of ['config', 'locales', 'templates', 'sections']) {
  for (const rel of files(dir, '.json')) {
    counts.json++;
    const text = read(rel).replace(/^﻿?\s*\/\*[\s\S]*?\*\/\s*/, '');
    try {
      JSON.parse(text);
    } catch (e) {
      failures.push(`${rel}: JSON 格式错误 — ${e.message}`);
    }
  }
}

for (const rel of files('assets', '.js')) {
  counts.js++;
  const err = parseJs(read(rel));
  if (err) failures.push(`${rel}:${err.loc ? err.loc.line : '?'}: JS 语法错误 — ${err.message}`);
}

for (const dir of ['layout', 'sections', 'snippets', 'blocks', 'templates']) {
  for (const rel of files(dir, '.liquid')) {
    counts.liquid++;
    const src = read(rel);
    const chars = [...src].length;
    if (chars > LIQUID_LIMIT) failures.push(`${rel}: ${chars} 字元，超过 Shopify 单档上限 ${LIQUID_LIMIT}`);
    else if (chars > LIQUID_WARN) warnings.push(`${rel}: ${chars} 字元，接近单档上限 ${LIQUID_LIMIT}（别再加长）`);

    const re = /{%-?\s*javascript\s*-?%}([\s\S]*?){%-?\s*endjavascript\s*-?%}/g;
    let m;
    while ((m = re.exec(src))) {
      counts.blocks++;
      const err = parseJs(m[1]);
      if (err) {
        const startLine = src.slice(0, m.index).split('\n').length;
        const line = err.loc ? startLine + err.loc.line - 1 : startLine;
        failures.push(`${rel}:${line}: {% javascript %} 语法错误 — ${err.message}`);
      }
    }
  }
}

console.log(`检查了 ${counts.json} 个 JSON、${counts.js} 个 JS 档、${counts.blocks} 个 {% javascript %} 区块、${counts.liquid} 个 Liquid 档`);
for (const w of warnings) console.log('WARN', w);
for (const f of failures) console.log('FAIL', f);
console.log(failures.length ? `\n${failures.length} 项失败` : '\n全部通过');
process.exit(failures.length ? 1 : 0);
