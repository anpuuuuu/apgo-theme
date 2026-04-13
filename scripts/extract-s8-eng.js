const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'templates', 'index.json');
const outPath = path.join(root, 'snippets', 'apgo-homepage-s8-eng-content.liquid');

let raw = fs.readFileSync(indexPath, 'utf8');
raw = raw.replace(/^\/\*[\s\S]*?\*\/\s*/, '');
const j = JSON.parse(raw);
const liquid = j.sections.custom_liquid_hUDYDn.settings.custom_liquid;

fs.writeFileSync(outPath, liquid, 'utf8');
console.log('Wrote', outPath, 'bytes', liquid.length);
