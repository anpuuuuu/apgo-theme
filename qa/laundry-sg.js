// Laundry promotion in Singapore without 6+3 (e80f963): Malaysia keeps its
// page as it was, Singapore gets its own images and no 6+3. If the product
// is still locked to Malaysia (custom.only_market), the redirect is stripped
// from the page so Singapore's version can be looked at.
//   node laundry-sg.js                         live
//   THEME_ID=188964503706 node laundry-sg.js   staging
const fs = require('fs');
const path = require('path');
const { url, open, sleep, cart, cartPost, clearCart } = require('./lib');

const OUT = path.join(__dirname, 'out', 'laundry-sg');
fs.mkdirSync(OUT, { recursive: true });
const PDP = '/products/apgo-laundry-detergent-special-promotion-1';
const SCENTS = [48952581488794, 48952581587098, 48952581619866];
// Image files by market (alt text [MY] / [SG] in the admin).
const MY_ONLY = ['1_2.png', 'detergent_30Days.jpg'];
const SG_ONLY = ['detergent.png', 'photo_2026-10-09_18-55-31.jpg'];
const MY_MAIN = '1_2.png';
const SG_MAIN = 'detergent.png';

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

// Opens the cart page (where the AIOD app adds its gifts) and reports the
// laundry packs in the cart and whether the Floor Cleaner 30ml gift is there.
async function giftAfterCartPage(page, country) {
  await page.goto(url('/cart', { country }), { waitUntil: 'load', timeout: 60000 });
  await sleep(8000);
  const c = await cart(page);
  return {
    packs: c.items.filter((i) => SCENTS.concat([48952581652634, 48995858120858, 48995858153626]).includes(i.variant_id)).reduce((n, i) => n + i.quantity, 0),
    gift: c.items.some((i) => /Floor Cleaner 30ml/i.test(i.product_title)),
  };
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '：' + detail : ''}`); };

(async () => {
  // 1. Malaysia: the page as it was, without Singapore's images.
  console.log('马来西亚');
  for (const device of ['desktop-chrome', 'iphone15-safari']) {
    const { browser, page } = await openPage(device, 'MY');
    await page.goto(url(PDP, { country: 'MY' }), { waitUntil: 'load', timeout: 60000 });
    await sleep(1500);
    const r = await readPdp(page);
    await page.screenshot({ path: path.join(OUT, `my-${device}.png`) });
    const imgs = device.startsWith('desktop') ? [r.main, ...r.thumbs] : r.slides;
    check(`${device} 主图是 MY 主图`, imgs[0] === MY_MAIN, imgs[0]);
    check(`${device} 没有 SG 专属图`, !imgs.some((f) => SG_ONLY.includes(f)), `${imgs.length} 张`);
    check(`${device} 选项照旧`, JSON.stringify(r.tiers.filter(Boolean)) === JSON.stringify(['Single pack', 'Buy 6 get 3 free', 'Buy 3 get 1 free']), r.tiers.join(' / '));
    check(`${device} 预设选 6+3`, r.active === 'Buy 6 get 3 free', r.active);
    check(`${device} 副标照旧`, r.subtitle.trim() === '6+3 and 3+1 promotion is limited to once per order*', r.subtitle.trim());
    check(`${device} 分享图是 MY 主图`, r.og === MY_MAIN, r.og);
    await browser.close();
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
    check(`${device} 没有 MY 专属图`, !imgs.some((f) => MY_ONLY.includes(f)), `${imgs.length} 张`);
    check(`${device} 主图是 SG 主图`, imgs[0] === SG_MAIN, imgs[0]);
    check(`${device} 有 SG 退款保证图`, imgs.includes(SG_ONLY[1]), '');
    check(`${device} 选项没有 6+3`, JSON.stringify(r.tiers.filter(Boolean)) === JSON.stringify(['Single pack', 'Buy 3 get 1 free']), r.tiers.join(' / '));
    check(`${device} 预设选 3+1`, r.active === 'Buy 3 get 1 free', r.active);
    check(`${device} 副标`, r.subtitle.trim() === '3+1 promotion is limited to once per order*', r.subtitle.trim());
    check(`${device} 页面文字没提到 6+3`, r.mentions6.length === 0, r.mentions6.join('、') || '没有');
    check(`${device} 分享图是 SG 主图`, r.og === SG_MAIN, r.og);

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
      // 9 packs: no Floor Cleaner gift in Singapore (AIOD "Detergent Promoo" is Malaysia-only).
      await cartPost(page, '/cart/add.js', { items: SCENTS.map((id) => ({ id, quantity: 1 })) });
      const giftSg = await giftAfterCartPage(page, 'SG');
      check('SG 9 包不送 Floor Cleaner', !giftSg.gift && giftSg.packs === 9, JSON.stringify(giftSg));
      // Search lists the product in Singapore too: its card must skip the MY-only image.
      await clearCart(page);
      await page.goto(url('/search', { q: 'laundry detergent promotion', country: 'SG' }), { waitUntil: 'load', timeout: 60000 });
      await sleep(1500);
      const card = await page.evaluate(() => {
        const a = [...document.querySelectorAll('a[href*="apgo-laundry-detergent-special-promotion-1"]')];
        const box = a.map((x) => x.closest('product-card, .product-card, li, article')).find(Boolean);
        return box ? [...box.querySelectorAll('img')].map((i) => (i.currentSrc || i.src).split('?')[0].split('/').pop()) : null;
      });
      check('SG 搜寻结果卡片用 SG 主图', card !== null && card[0] === SG_MAIN && !card.some((f) => MY_ONLY.includes(f)), card ? card.slice(0, 3).join('、') : '搜不到这个商品');
    }
    await browser.close();
  }

  // 3. Malaysia cart with 6 packs still offers Detergent PWP.
  const { browser, page } = await openPage('desktop-chrome', 'MY');
  await cartPost(page, '/cart/add.js', { items: SCENTS.map((id) => ({ id, quantity: 3 })) });
  const giftMy = await giftAfterCartPage(page, 'MY');
  const gMy = await detergentGroup(page);
  check('MY 购物车满 6 包仍有 Detergent PWP', gMy && gMy.shown && gMy.audience === 'trigger', JSON.stringify(gMy));
  check('MY 9 包照送 Floor Cleaner', giftMy.gift && giftMy.packs === 9, JSON.stringify(giftMy));
  await clearCart(page);
  await browser.close();

  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} 项失败（截图在 qa/out/laundry-sg）` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})();
