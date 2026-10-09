// Regression list (qa/README.md): every bug we fixed once gets a check here,
// so a later change cannot quietly bring it back. Read-only for the store:
// carts are test carts in throwaway browser sessions, no order is placed.
//   node regression.js            all checks
//   node regression.js R5 R6      only these
// Checks tied to a campaign say so in `until`; delete them when it ends.
const fs = require('fs');
const path = require('path');
const { url, THEME_ID, open, sleep, cart, cartPost, clearCart, stickyGap, layout } = require('./lib');

const OUT = path.join(__dirname, 'out', 'regression');
fs.mkdirSync(OUT, { recursive: true });

const PFD = '/products/pocket-friendly-deals';
const WIPER = 67638526705818; // Pocket-Friendly: Car Wiper Fluid 200ml, limit 1
const SG_BUNDLE = 67699980959898; // WAREHOUSE CLEARANCE SALE BUNDLE (SG)
const SG_PWP_SHOE300 = 67701885108378; // Shoe Cleaner 300ml (WH Sales PWP)

async function goto(page, pathname, params) {
  const resp = await page.goto(url(pathname, params), { waitUntil: 'load', timeout: 60000 });
  await sleep(1500);
  return resp;
}

const CHECKS = [
  {
    id: 'R1',
    title: '手机往下滑后，跑马灯紧贴 header（867fa0e）',
    async run() {
      const out = [];
      for (const device of ['iphone15-safari', 'android-chrome']) {
        for (const p of ['/', '/pages/clearance-sale', '/collections/all']) {
          const { browser, page } = await open(device);
          await goto(page, p);
          const g = await stickyGap(page);
          await browser.close();
          if (g.skipped) out.push({ ok: true, detail: `${device} ${p}: 略过（${g.skipped}）` });
          else out.push({ ok: Math.abs(g.gap) <= 1, detail: `${device} ${p}: 缝 ${g.gap}px` });
        }
      }
      return out;
    },
  },
  {
    id: 'R2',
    title: '洗衣精页手机选单横排是米色底、字看得到（05d3a77）',
    async run() {
      const { browser, page } = await open('iphoneSE-safari');
      await goto(page, '/products/apgo-laundry-detergent-special-promotion-1');
      const r = await page.evaluate(() => {
        const row = document.querySelector('.apgo-menu-row');
        const link = document.querySelector('.apgo-menu-row__link:not(.apgo-menu-row__link--hot)');
        return row && { bg: getComputedStyle(row).backgroundColor, color: link && getComputedStyle(link).color };
      });
      await page.screenshot({ path: path.join(OUT, 'R2.png') });
      await browser.close();
      if (!r) return { ok: false, detail: '找不到选单横排' };
      return { ok: r.bg === 'rgb(246, 241, 231)' && r.color !== r.bg, detail: `底 ${r.bg}，字 ${r.color}` };
    },
  },
  {
    id: 'R3',
    title: 'iPad 的 All Products 分类列不被切掉、整页不横向超出（05d3a77）',
    async run() {
      const out = [];
      for (const [w, h] of [[768, 1024], [820, 1180], [1024, 768]]) {
        const { browser, page } = await open('ipad-safari', { viewport: { width: w, height: h } });
        await goto(page, '/collections/all');
        const r = await page.evaluate(() => {
          const first = document.querySelector('[class*="ai-secondary-menu__list-"] a');
          const vw = innerWidth;
          return { firstLeft: first ? Math.round(first.getBoundingClientRect().left) : null, overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw };
        });
        await browser.close();
        out.push({ ok: r.firstLeft !== null && r.firstLeft >= 0 && r.overflow <= 1, detail: `${w}x${h}: 第一个分类 left=${r.firstLeft}，超出 ${r.overflow}px` });
      }
      return out;
    },
  },
  {
    id: 'R4',
    title: 'Pocket-Friendly 限购：每样 3、雨刷精 1（f046843、4a091d9）',
    until: 'Pocket-Friendly Deals 活动结束',
    async run() {
      const { browser, page } = await open('desktop-chrome');
      await goto(page, PFD);
      const r = await page.evaluate(() => {
        const bar = document.querySelector('[data-apgo-cc-buybar]');
        return bar && { all: bar.getAttribute('data-apgo-cc-max-per-order'), perVariant: bar.getAttribute('data-apgo-cc-max-per-variant') };
      });
      await browser.close();
      if (!r) return { ok: false, detail: '找不到购买列' };
      return { ok: r.all === '3' && (r.perVariant || '').split(',').includes(`${WIPER}:1`), detail: `每样 ${r.all}，个别 ${r.perVariant}` };
    },
  },
  {
    id: 'R5',
    title: '购物车超过限购（「Buy again」、旧购物车）会自动降回上限（ac10bd2）',
    until: 'Pocket-Friendly Deals 活动结束',
    async run() {
      const { browser, page } = await open('desktop-chrome');
      await goto(page, '/');
      const product = await page.evaluate(async (h) => (await fetch(h + '.js')).json(), PFD);
      const v = product.variants.find((x) => x.available && x.id !== WIPER);
      if (!v) { await browser.close(); return { ok: false, detail: '找不到有货的选项' }; }
      const status = await cartPost(page, '/cart/add.js', { items: [{ id: v.id, quantity: 5 }] });
      const before = (await cart(page)).items.find((i) => i.variant_id === v.id);
      await goto(page, '/cart');
      let qty = before && before.quantity;
      for (let t = 0; t < 10 && qty > 3; t++) {
        await sleep(1000);
        const line = (await cart(page)).items.find((i) => i.variant_id === v.id);
        qty = line ? line.quantity : 0;
      }
      await sleep(1500);
      const toast = await page.evaluate(() => document.body.innerText.includes('in your cart'));
      await page.screenshot({ path: path.join(OUT, 'R5.png') });
      await clearCart(page);
      await browser.close();
      return { ok: qty === 3, detail: `用 API 加入 5 件（${status}），进购物车页后变成 ${qty} 件；提示${toast ? '有' : '没有'}出现` };
    },
  },
  {
    id: 'R6',
    title: '新加坡 PWP：有 Bundle 才有加购价，拿掉 Bundle 就恢复原价',
    until: 'SG WH Sales PWP 活动结束',
    async run() {
      const out = [];
      const { browser, page } = await open('iphone15-safari');
      await goto(page, '/', { country: 'SG' });
      await cartPost(page, '/cart/add.js', { items: [{ id: SG_BUNDLE, quantity: 1 }, { id: SG_PWP_SHOE300, quantity: 1 }] });
      let c = await cart(page);
      const line = (id) => c.items.find((i) => i.variant_id === id);
      out.push({ ok: c.currency === 'SGD', detail: `购物车币别 ${c.currency}` });
      out.push({ ok: !!line(SG_PWP_SHOE300) && line(SG_PWP_SHOE300).final_line_price === 590, detail: `有 Bundle：Shoe 300ml $${((line(SG_PWP_SHOE300) || {}).final_line_price / 100).toFixed(2)}（应为 $5.90）` });
      await goto(page, '/cart', { country: 'SG' });
      const adds = await page.locator('cart-offers-tabs button', { hasText: /^ADD$/ }).count();
      out.push({ ok: adds > 0, detail: `购物车 PWP 区块 ${adds} 个 ADD 按钮` });
      await page.screenshot({ path: path.join(OUT, 'R6.png') });
      await cartPost(page, '/cart/change.js', { id: String(SG_BUNDLE), quantity: 0 });
      c = await cart(page);
      out.push({ ok: !!line(SG_PWP_SHOE300) && line(SG_PWP_SHOE300).final_line_price === 990, detail: `拿掉 Bundle：Shoe 300ml $${((line(SG_PWP_SHOE300) || {}).final_line_price / 100).toFixed(2)}（应为 $9.90）` });
      await clearCart(page);
      await browser.close();
      return out;
    },
  },
  {
    id: 'R7',
    title: '马来西亚：购物车能进到结帐页（不下单）',
    async run() {
      const { browser, page } = await open('android-chrome');
      await goto(page, '/');
      const product = await page.evaluate(async (h) => (await fetch(h + '.js')).json(), PFD);
      const v = product.variants.find((x) => x.available && x.id !== WIPER);
      await cartPost(page, '/cart/add.js', { items: [{ id: v.id, quantity: 1 }] });
      await goto(page, '/cart');
      const btn = page.locator('button[name="checkout"]:visible').first();
      let ok = false;
      let detail = '';
      try {
        await btn.click();
        await page.waitForURL(/\/checkouts\//, { timeout: 45000 });
        await page.waitForLoadState('load');
        await sleep(3000);
        const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
        ok = /Contact|Delivery|Payment/.test(text) && !/not available|unavailable/i.test(text);
        detail = '结帐页金额 ' + ((text.match(/(RM|MYR)\s?[\d.,]+/) || ['（没读到）'])[0]);
        await page.screenshot({ path: path.join(OUT, 'R7.png') });
      } catch (e) {
        detail = String(e.message).split('\n')[0].slice(0, 160);
      }
      await goto(page, '/');
      await clearCart(page);
      await browser.close();
      return { ok, detail };
    },
  },
  {
    id: 'R8',
    title: '新加坡运送天数都是 3–5 天，没有旧的 5–7 天（e7a68d1）',
    async run() {
      const out = [];
      const { browser, page } = await open('desktop-chrome');
      for (const p of ['/', '/pages/clearance-sale', PFD, '/products/apgo-laundry-detergent-special-promotion-1']) {
        await goto(page, p, { country: 'SG' });
        const text = await page.evaluate(() => document.body.innerText);
        const old = text.match(/5\s*[-–~]\s*7\s*(business|working)?\s*days?/i);
        const now = /3\s*[-–~]\s*5\s*(business|working)?\s*days?/i.test(text);
        out.push({ ok: !old && now, detail: `${p}: ${old ? '还有「' + old[0] + '」' : now ? '显示 3–5 天' : '找不到 3–5 天'}` });
      }
      await browser.close();
      return out;
    },
  },
  {
    id: 'R9',
    title: '清仓页对新加坡开放（10/8 重新开放）',
    async run() {
      const { browser, page } = await open('desktop-chrome');
      const resp = await goto(page, '/pages/clearance-sale', { country: 'SG' });
      const r = await layout(page);
      await browser.close();
      return { ok: resp.status() === 200 && r.headerVisible, detail: `HTTP ${resp.status()}` };
    },
  },
];

(async () => {
  const only = process.argv.slice(2).map((s) => s.toUpperCase());
  const results = [];
  console.log(`对象：${url('/')}${THEME_ID ? '（预览主题 ' + THEME_ID + '）' : ''}\n`);
  for (const c of CHECKS) {
    if (only.length && !only.includes(c.id)) continue;
    let items;
    try {
      const r = await c.run();
      items = Array.isArray(r) ? r : [r];
    } catch (e) {
      items = [{ ok: false, detail: '执行出错：' + String(e.message).split('\n')[0].slice(0, 160) }];
    }
    const ok = items.every((i) => i.ok);
    results.push({ id: c.id, title: c.title, until: c.until, ok, items });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id} ${c.title}${c.until ? '（' + c.until + '后删）' : ''}`);
    for (const i of items) console.log(`     ${i.ok ? '✓' : '✗'} ${i.detail}`);
  }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} 项失败（截图在 qa/out/regression）` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})();
