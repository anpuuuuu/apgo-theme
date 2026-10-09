// Laundry promotion in Singapore without 6+3 (e80f963). Compares the theme
// under test (THEME_ID, e.g. staging) with what Malaysia must keep seeing,
// and checks Singapore's version. While the product is still locked to
// Malaysia (custom.only_market), the redirect is stripped from the page so
// Singapore's version can be looked at.
//   THEME_ID=188964503706 node laundry-sg.js
const fs = require('fs');
const path = require('path');
const { url, open, sleep, cart, cartPost, clearCart } = require('./lib');

const OUT = path.join(__dirname, 'out', 'laundry-sg');
fs.mkdirSync(OUT, { recursive: true });
const PDP = '/products/apgo-laundry-detergent-special-promotion-1';
const SCENTS = [48952581488794, 48952581587098, 48952581619866];
const MY_ONLY = ['1_2.png', 'detergent_30Days.jpg'];

async function openPage(device, country) {
  const s = await open(device);
  await s.context.route(/\/products\/apgo-laundry-detergent-special-promotion-1(\?|$)/, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const resp = await route.fetch();
    const body = (await resp.text()).replace(/<script>window\.location\.replace\([^<]*\);<\/script>/, '');
    route.fulfill({ response: resp, body });
  });
  await s.page.goto(url('/', { country }), { waitUntil: 'load', timeout: 60000 });
  return s;
}

async function readPdp(page) {
  return page.evaluate(() => {
    const file = (src) => (src || '').split('?')[0].split('/').pop();
    const desk = document.querySelector('.apgo-desktop-only');
    const visible = (el) => el && el.offsetParent !== null;
    const tiers = [...document.querySelectorAll('[data-apgo-bundle-tier]')].filter(visible);
    const active = tiers.find((t) => t.classList.contains('is-active'));
    const text = document.body.innerText;
    return {
      country: window.Shopify && Shopify.country,
      theme: window.Shopify && Shopify.theme && Shopify.theme.id,
      main: file((document.querySelector('[data-apgo-main-img]') || {}).src),
      thumbs: [...document.querySelectorAll('[data-apgo-thumb-idx] img')].map((i) => file(i.src)),
      slides: [...document.querySelectorAll('.apgo-mpdp-slide img')].map((i) => file(i.src)),
      tiers: tiers.map((t) => t.getAttribute('data-tier-label')),
      active: active && active.getAttribute('data-tier-label'),
      subtitle: (document.querySelector('.apgo-subtitle, .apgo-mpdp-subtitle') || {}).textContent || '',
      note: ((desk && desk.querySelector('.apgo-bundle__stack-note')) || document.querySelector('.apgo-bundle__stack-note') || {}).textContent || '',
      og: file((document.querySelector('meta[property="og:image"]') || {}).content),
      mentions6: (text.match(/6\s*\+\s*3|buy\s*6|6\s*get\s*3|6\s*free\s*3|floor cleaner 30ml included/gi) || []),
    };
  });
}

// The cart's Detergent PWP offer group: shown, and its audience attribute
// ('off' outside its market, read again by the script on cart changes).
async function detergentGroup(page) {
  return page.evaluate(() => {
    const g = document.querySelector('[data-offer-group][aria-label="Detergent PWP"]');
    return g && { shown: !g.hidden && g.offsetParent !== null, audience: g.getAttribute('data-audience') };
  });
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '：' + detail : ''}`); };

(async () => {
  // 1. Malaysia, theme under test vs live: must be the same.
  const pdp = {};
  for (const [label, themed] of [['live', false], ['test', true]]) {
    const { browser, page } = await openPage('desktop-chrome', 'MY');
    const target = themed ? url(PDP, { country: 'MY' }) : 'https://apgo.my' + PDP + '?country=MY&preview_theme_id=150443032730';
    await page.goto(target, { waitUntil: 'load', timeout: 60000 });
    await sleep(1500);
    pdp[label] = await readPdp(page);
    await page.screenshot({ path: path.join(OUT, `my-${label}.png`) });
    await browser.close();
  }
  console.log(`\n马来西亚（测试主题 ${pdp.test.theme} 对比线上 ${pdp.live.theme}）`);
  for (const k of ['main', 'thumbs', 'slides', 'tiers', 'active', 'subtitle', 'note', 'og']) {
    check(`MY ${k} 和线上一样`, JSON.stringify(pdp.test[k]) === JSON.stringify(pdp.live[k]), JSON.stringify(pdp.test[k]).slice(0, 120));
  }

  // 2. Singapore on the theme under test.
  console.log('\n新加坡（测试主题）');
  for (const device of ['desktop-chrome', 'iphone15-safari']) {
    const { browser, page } = await openPage(device, 'SG');
    await page.goto(url(PDP, { country: 'SG' }), { waitUntil: 'load', timeout: 60000 });
    await sleep(1500);
    const r = await readPdp(page);
    await page.screenshot({ path: path.join(OUT, `sg-${device}.png`) });
    check(`${device} 是新加坡`, r.country === 'SG', r.country);
    const imgs = device.startsWith('desktop') ? [r.main, ...r.thumbs] : r.slides;
    check(`${device} 没有 MY 专属图`, !imgs.some((f) => MY_ONLY.includes(f)), `${imgs.length} 张，第一张 ${imgs[0]}`);
    check(`${device} 选项没有 6+3`, JSON.stringify(r.tiers.filter(Boolean)) === JSON.stringify(['Single pack', 'Buy 3 get 1 free']), r.tiers.join(' / '));
    check(`${device} 预设选 3+1`, r.active === 'Buy 3 get 1 free', r.active);
    check(`${device} 副标`, r.subtitle.trim() === '3+1 promotion is limited to once per order*', r.subtitle.trim());
    check(`${device} 页面文字没提到 6+3`, r.mentions6.length === 0, r.mentions6.join('、') || '没有');
    check(`${device} 分享图不是 MY 专属图`, !MY_ONLY.includes(r.og), r.og);

    if (device === 'desktop-chrome') {
      // Pick 4 scents with the picker and add: 3+1 should cost 3 packs.
      await clearCart(page);
      await page.locator('.apgo-desktop-only [data-apgo-bundle-action="random"]').click();
      await sleep(500);
      await page.locator('.apgo-desktop-only [data-apgo-bundle-add]').click();
      await sleep(4000);
      const c = await cart(page);
      const packs = c.items.reduce((n, i) => n + i.quantity, 0);
      check('SG 用选择器加入 3+1', packs === 4 && c.total_price === 5070, `${packs} 包，${c.currency} $${(c.total_price / 100).toFixed(2)}（应为 4 包 $50.70）`);
      // 6 packs: the Detergent PWP group must not show (its discount is Malaysia-only).
      await clearCart(page);
      await cartPost(page, '/cart/add.js', { items: SCENTS.map((id) => ({ id, quantity: 2 })) });
      await page.goto(url('/cart', { country: 'SG' }), { waitUntil: 'load', timeout: 60000 });
      await sleep(1500);
      const g = await detergentGroup(page);
      await page.screenshot({ path: path.join(OUT, 'sg-cart.png'), fullPage: true });
      check('SG 购物车 6 包不出现 Detergent PWP', g && !g.shown && g.audience === 'off', JSON.stringify(g));
      // Search lists the product in Singapore too: its card must skip the MY-only image.
      await clearCart(page);
      await page.goto(url('/search', { q: 'laundry detergent promotion', country: 'SG' }), { waitUntil: 'load', timeout: 60000 });
      await sleep(1500);
      const card = await page.evaluate(() => {
        const a = [...document.querySelectorAll('a[href*="apgo-laundry-detergent-special-promotion-1"]')];
        const box = a.map((x) => x.closest('product-card, .product-card, li, article')).find(Boolean);
        return box ? [...box.querySelectorAll('img')].map((i) => (i.currentSrc || i.src).split('?')[0].split('/').pop()) : null;
      });
      check('SG 搜寻结果卡片没有 MY 专属图', card !== null && !card.some((f) => MY_ONLY.includes(f)), card ? card.slice(0, 3).join('、') : '搜不到这个商品');
    }
    await browser.close();
  }

  // 3. Malaysia cart with 6 packs still offers Detergent PWP.
  const { browser, page } = await openPage('desktop-chrome', 'MY');
  await cartPost(page, '/cart/add.js', { items: SCENTS.map((id) => ({ id, quantity: 2 })) });
  await page.goto(url('/cart', { country: 'MY' }), { waitUntil: 'load', timeout: 60000 });
  await sleep(1500);
  const gMy = await detergentGroup(page);
  check('MY 购物车 6 包仍有 Detergent PWP', gMy && gMy.shown && gMy.audience === 'trigger', JSON.stringify(gMy));
  await clearCart(page);
  await browser.close();

  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} 项失败（截图在 qa/out/laundry-sg）` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})();
