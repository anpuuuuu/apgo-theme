const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'templates', 'index.json');
const outPath = path.join(root, 'sections', 'apgo-homepage-s8-eng.liquid');

let raw = fs.readFileSync(indexPath, 'utf8');
raw = raw.replace(/^\/\*[\s\S]*?\*\/\s*/, '');
const j = JSON.parse(raw);
const liquid = j.sections.custom_liquid_hUDYDn.settings.custom_liquid;

const schema = `

{% schema %}
{
  "name": "Homepage S8 Eng Block",
  "settings": [],
  "presets": [
    {
      "name": "Homepage S8 Eng Block"
    }
  ]
}
{% endschema %}
`;

fs.writeFileSync(outPath, liquid + schema, 'utf8');
console.log('Wrote', outPath, 'bytes', liquid.length + schema.length);
