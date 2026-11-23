// Offline check of snippets/apgo-max-per-order.liquid (2026-11-23): limits come
// only from the product tag apgo-max-per-order-N and the theme setting
// "Limits for single options" (variant_id:limit lines), never from a product
// named in code. Renders the real snippet with liquidjs; touches no store.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { Liquid } = require('liquidjs');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'snippets/apgo-max-per-order.liquid'), 'utf8')
  .replace(/{%-?\s*doc\s*-?%}[\s\S]*?{%-?\s*enddoc\s*-?%}/g, '');
const liquid = new Liquid();

async function limit({ tags = [], variant, setting }) {
  const out = await liquid.parseAndRender(source, {
    product: { tags },
    variant,
    settings: { apgo_variant_order_limits: setting },
  });
  return Number(out.trim());
}

async function run() {
  const cases = [
    ['没有标签、没有设定 → 不限', { tags: [] }, 0],
    ['标签 apgo-max-per-order-3 → 3', { tags: ['hot', 'apgo-max-per-order-3'] }, 3],
    ['标签 apgo-max-per-order-2 → 2', { tags: ['apgo-max-per-order-2'] }, 2],
    ['单一规格设定盖过标签 → 1', { tags: ['apgo-max-per-order-3'], variant: { id: 67638526705818 }, setting: '67638526705818:1' }, 1],
    ['同一商品的其他规格照标签 → 3', { tags: ['apgo-max-per-order-3'], variant: { id: 111 }, setting: '67638526705818:1' }, 3],
    ['多行、Windows 换行、空格、逗号都读得到', { variant: { id: 222 }, setting: '111:5\r\n 222 : 4 ,333:2\n' }, 4],
    ['没给规格时不看单一规格设定', { tags: ['apgo-max-per-order-3'], setting: '67638526705818:1' }, 3],
  ];
  const results = [];
  for (const [name, input, want] of cases) {
    const got = await limit(input);
    try {
      assert.equal(got, want);
      results.push({ ok: true, detail: name });
    } catch {
      results.push({ ok: false, detail: `${name}：得到 ${got}` });
    }
  }
  const code = ['snippets', 'sections', 'layout', 'blocks'].flatMap((dir) =>
    fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.liquid')).map((f) => path.join(dir, f)));
  const named = code.filter((f) => /pocket-friendly-deals|15468443173018|15468456673434/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  results.push({ ok: named.length === 0, detail: named.length ? '代码里还写死了商品：' + named.join('、') : '代码里没有写死的限购商品' });
  return results;
}

module.exports = { run };
if (require.main === module) {
  run().then((r) => {
    r.forEach((i) => console.log(`${i.ok ? 'PASS' : 'FAIL'} ${i.detail}`));
    process.exit(r.every((i) => i.ok) ? 0 : 1);
  });
}
