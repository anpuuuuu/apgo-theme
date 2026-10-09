// Cross-device / cross-browser check (qa/README.md, for layout and global
// changes). Read-only for the store: test carts only, no order is placed.
//   node devices.js                      all 9 devices
//   node devices.js iphone15-safari ...  only these
// Screenshots go to qa/out/devices/<device>/.
const fs = require('fs');
const path = require('path');
const { url, THEME_ID, DEVICES, open, sleep, cart, clearCart, stickyGap, layout } = require('./lib');

const OUT = path.join(__dirname, 'out', 'devices');

const PAGES = [
  { id: 'home', path: '/' },
  { id: 'clearance', path: '/pages/clearance-sale' },
  { id: 'pdp-pfd', path: '/products/pocket-friendly-deals' },
  { id: 'pdp-laundry', path: '/products/apgo-laundry-detergent-special-promotion-1' },
  { id: 'all-products', path: '/collections/all' },
  { id: 'cart', path: '/cart' },
];

// Devices that also walk product page → add to cart → cart → checkout.
const FLOW = ['iphone15-safari', 'iphone-facebook', 'android-chrome', 'android-facebook', 'desktop-chrome', 'desktop-safari'];
const FLOW_OPTION = 'Shoe Cleaner 30ml';

// Errors caused by the tracker blocking in lib.js, not by the theme.
const NOISE = /access control checks|importScripts|Failed to fetch|Load failed|NetworkError|ERR_FAILED/i;

async function visibleFirst(page, selectors) {
  for (const s of selectors) {
    const loc = page.locator(s);
    const n = await loc.count();
    for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible()) return loc.nth(i);
  }
  return null;
}

async function flow(page, dir) {
  const steps = [];
  const step = (name, ok, detail) => steps.push({ name, ok, detail });
  try {
    await page.goto(url('/products/pocket-friendly-deals'), { waitUntil: 'load', timeout: 60000 });
    await sleep(1500);
    const chip = page.locator('.apgo-cc-pdp__chip:visible', { hasText: FLOW_OPTION }).first();
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await sleep(600);
    step('选选项', true, FLOW_OPTION);
    const before = (await cart(page)).item_count;
    const add = await visibleFirst(page, ['[data-apgo-cc-buybar-add]', '[data-apgo-cc-add]']);
    if (!add) throw new Error('看不到 Add to cart 按钮');
    await add.click();
    await sleep(4000);
    const after = (await cart(page)).item_count;
    step('加入购物车', after === before + 1, `购物车 ${before} → ${after}`);
    await page.goto(url('/cart'), { waitUntil: 'load', timeout: 60000 });
    await sleep(1500);
    await page.screenshot({ path: path.join(dir, 'flow-cart.png') });
    const checkout = await visibleFirst(page, ['button[name="checkout"]']);
    if (!checkout) throw new Error('看不到 Check out 按钮');
    await checkout.click();
    await page.waitForURL(/\/checkouts\//, { timeout: 45000 });
    await page.waitForLoadState('load');
    await sleep(3000);
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    await page.screenshot({ path: path.join(dir, 'flow-checkout.png') });
    step('进到结帐页（不下单）', /Contact|Delivery|Payment/.test(text), '金额 ' + (text.match(/(RM|MYR|SGD|\$)\s?[\d.,]+/) || ['（没读到）'])[0]);
  } catch (e) {
    step('流程中断', false, String(e.message).split('\n')[0].slice(0, 160));
  }
  try {
    await page.goto(url('/'), { waitUntil: 'load', timeout: 60000 });
    await clearCart(page);
  } catch (e) {}
  return steps;
}

async function runDevice(id) {
  const { browser, page, device } = await open(id);
  const dir = path.join(OUT, id);
  fs.mkdirSync(dir, { recursive: true });
  const phone = device.ctx.isMobile && device.ctx.viewport.width < 750;
  const problems = [];
  const errors = [];
  let current = '';
  page.on('pageerror', (e) => { if (!NOISE.test(e.message)) errors.push(`${current}: ${String(e.message).slice(0, 160)}`); });

  for (const pg of PAGES) {
    current = pg.id;
    try {
      const resp = await page.goto(url(pg.path), { waitUntil: 'load', timeout: 60000 });
      await sleep(1500);
      const l = await layout(page);
      await page.screenshot({ path: path.join(dir, pg.id + '.png') });
      if (resp.status() !== 200) problems.push(`${pg.id}: HTTP ${resp.status()}`);
      if (l.overflow) problems.push(`${pg.id}: 横向超出 ${l.overflow}px（${l.offenders.join('、')}）`);
      if (!l.headerVisible) problems.push(`${pg.id}: 看不到 header`);
      if (l.brokenImgs.length) problems.push(`${pg.id}: 图片坏掉 ${l.brokenImgs.join('、')}`);
      if (phone) {
        const g = await stickyGap(page);
        await page.screenshot({ path: path.join(dir, pg.id + '-scrolled.png') });
        if (!g.skipped && Math.abs(g.gap) > 1) problems.push(`${pg.id}: 往下滑后跑马灯和 header 之间有 ${g.gap}px 缝`);
      }
    } catch (e) {
      problems.push(`${pg.id}: 打不开（${String(e.message).split('\n')[0].slice(0, 120)}）`);
    }
  }

  let steps = null;
  if (FLOW.includes(id)) {
    current = 'flow';
    steps = await flow(page, dir);
    for (const s of steps) if (!s.ok) problems.push(`流程「${s.name}」失败：${s.detail}`);
  }
  await browser.close();
  return { id, label: device.label, problems, errors, steps };
}

(async () => {
  const only = process.argv.slice(2);
  const ids = only.length ? only : Object.keys(DEVICES);
  const unknown = ids.filter((i) => !DEVICES[i]);
  if (unknown.length) {
    console.log('不认识的装置：' + unknown.join('、') + '\n可用：' + Object.keys(DEVICES).join('、'));
    process.exit(2);
  }
  console.log(`对象：${url('/')}${THEME_ID ? '（预览主题 ' + THEME_ID + '）' : ''}\n`);
  const results = [];
  for (const id of ids) {
    const t = Date.now();
    let r;
    try {
      r = await runDevice(id);
    } catch (e) {
      r = { id, label: DEVICES[id].label, problems: ['执行出错：' + String(e.message).split('\n')[0].slice(0, 160)], errors: [] };
    }
    results.push(r);
    const s = Math.round((Date.now() - t) / 1000);
    console.log(`${r.problems.length ? 'FAIL' : 'PASS'} ${r.label}（${s}s）`);
    for (const p of r.problems) console.log('     ✗ ' + p);
    if (r.steps) console.log('     流程：' + r.steps.map((x) => `${x.ok ? '✓' : '✗'}${x.name}`).join(' → '));
    for (const e of r.errors) console.log('     JS 错误 ' + e);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter((r) => r.problems.length).length;
  console.log(failed ? `\n${failed} 种装置有问题（截图在 qa/out/devices）` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})();
