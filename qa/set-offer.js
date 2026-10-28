// Detergent set offer (any 3 for RM99, 95827fd): theme settings → APGO —
// Bundle Widget → Set offer. Before the switch, a cart attribute
// _apgo_preview_set_offer=1 turns it on for the test cart only, so this runs
// on the live site without shoppers seeing it.
//   node set-offer.js          live, offer still off (also checks shoppers see the old picker)
//   ON=1 node set-offer.js     live, offer switched on (no preview attribute)
// If Shopify shows its "verify your connection" page, stop and run it later.
const fs = require('fs');
const path = require('path');
const { url, open, sleep, cart, cartPost, clearCart } = require('./lib');

const OUT = path.join(__dirname, 'out', 'set-offer');
fs.mkdirSync(OUT, { recursive: true });
const PDP = '/products/apgo-laundry-detergent-special-promotion-1';
const SCENTS = [48952581488794, 48952581587098, 48952581619866];
const ON = process.env.ON === '1';

async function preview(page, on) {
  if (ON) return;
  await cartPost(page, '/cart/update.js', { attributes: { _apgo_preview_set_offer: on ? '1' : '' } });
}

async function goto(page, pathname, country) {
  await page.goto(url(pathname, { country }), { waitUntil: 'load', timeout: 60000 });
  if (await page.evaluate(() => /verified before you can proceed/i.test(document.body.innerText))) {
    throw new Error('Shopify 机器人检查页，停下来，过一阵子再跑');
  }
}

async function readPdp(page) {
  return page.evaluate(() => {
    const visible = (el) => el && el.offsetParent !== null;
    const widget = [...document.querySelectorAll('[data-apgo-bundle]')].find(visible);
    if (!widget) return null;
    const tiers = [...widget.querySelectorAll('[data-apgo-bundle-tier]')];
    const active = tiers.find((t) => t.classList.contains('is-active'));
    const set = tiers.find((t) => /^Any /.test(t.getAttribute('data-tier-label')));
    const giftPart = widget.querySelector('[data-apgo-bundle-gift-part]');
    return {
      tiers: tiers.map((t) => t.getAttribute('data-tier-label')),
      active: active && active.getAttribute('data-tier-label'),
      setPrice: set && set.querySelector('.apgo-bundle__tier-price').textContent.trim(),
      setMeta: set && set.querySelector('.apgo-bundle__tier-meta').textContent.replace(/\s+/g, ' ').trim(),
      setBonus: set ? [...set.querySelectorAll('.apgo-bundle__tier-bonus')].map((b) => b.textContent.trim()) : [],
      setChip: set && (set.querySelector('.apgo-bundle__tier-chip') || {}).textContent,
      note: (widget.querySelector('.apgo-bundle__stack-note') || {}).textContent || '',
      giftPartShown: !!giftPart && !giftPart.hidden,
      subtitle: ([...document.querySelectorAll('.apgo-subtitle, .apgo-mpdp-subtitle')].find(visible) || {}).textContent || '',
    };
  });
}

// Free shipping as the cart page shows it, after the page's own scripts ran.
async function cartFreeShip(page) {
  return page.evaluate(async () => {
    const c = await (await fetch('/cart.js?_=' + Date.now())).json();
    const sticky = document.querySelector('[data-sticky-goal]');
    return {
      packs: c.item_count,
      stickyUnlocked: !!sticky && sticky.classList.contains('is-unlocked'),
      js: window.apgoFreeShippingTitle ? window.apgoFreeShippingTitle(c) : 'no function',
      shipMinor: window.apgoEstimatedShippingMinor ? window.apgoEstimatedShippingMinor(c) : 'no function',
      detergentPwp: !!document.querySelector('[data-offer-group][aria-label="Detergent PWP"]:not([hidden])'),
    };
  });
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '：' + detail : ''}`); };

(async () => {
  // 1. Malaysia.
  console.log(ON ? '马来西亚' : '马来西亚（预览）');
  for (const device of ['desktop-chrome', 'iphone15-safari']) {
    const { browser, page } = await open(device);
    await goto(page, '/', 'MY');
    await clearCart(page);
    await preview(page, true);
    await goto(page, PDP, 'MY');
    await sleep(1500);
    const r = await readPdp(page);
    await page.screenshot({ path: path.join(OUT, `my-${device}.png`) });
    check(`${device} 选项`, !!r && JSON.stringify(r.tiers) === JSON.stringify(['Single pack', 'Any 3 for RM99.00']), r && r.tiers.join(' / '));
    if (r) {
      check(`${device} 预设选任选 3 包`, r.active === 'Any 3 for RM99.00', r.active);
      check(`${device} 价钱 RM99.00`, r.setPrice === 'RM99.00', `${r.setPrice}（${r.setMeta}）`);
      check(`${device} 卡片写赠品和免运`, r.setBonus.length === 2 && /Floor Cleaner/.test(r.setBonus[0]) && r.setBonus[1] === 'Free shipping', r.setBonus.join(' | '));
      check(`${device} 标签 Flash Deal`, r.setChip === 'Flash Deal', r.setChip);
      check(`${device} 下方说明换掉`, r.note.length > 0 && !/promotion is limited/.test(r.note), r.note);
      check(`${device} 不写 includes 0 free gift`, !r.giftPartShown, '');
      check(`${device} 副标换掉`, r.subtitle.length > 0 && !/6\+3|3\+1/.test(r.subtitle), r.subtitle.trim());
    }

    if (device === 'desktop-chrome') {
      await page.locator('.apgo-desktop-only [data-apgo-bundle-action="random"]').click();
      await sleep(500);
      await page.locator('.apgo-desktop-only [data-apgo-bundle-add]').click();
      await sleep(4000);
      const c = await cart(page);
      const tierProps = [...new Set(c.items.map((i) => i.properties && i.properties._bundle_tier))];
      check('选择器加入 3 包', c.item_count === 3 && tierProps.join() === 'Any 3 for RM99.00', `${c.item_count} 包，${tierProps.join()}，RM${(c.total_price / 100).toFixed(2)}`);

      await goto(page, '/cart', 'MY');
      await sleep(3000);
      await page.screenshot({ path: path.join(OUT, 'my-cart-3.png'), fullPage: true });
      const f3 = await cartFreeShip(page);
      check('购物车 3 包：免运', f3.stickyUnlocked && !!f3.js && f3.shipMinor === 0, JSON.stringify(f3));
      if (ON) check('购物车没有 Detergent PWP 分页', !f3.detergentPwp, '');

      const line = c.items[0];
      await cartPost(page, '/cart/change.js', { id: line.key, quantity: line.quantity - 1 });
      await goto(page, '/cart', 'MY');
      await sleep(3000);
      const f2 = await cartFreeShip(page);
      check('购物车 2 包：不免运', f2.packs === 2 && !f2.stickyUnlocked && f2.js === null && f2.shipMinor > 0, JSON.stringify(f2));
    }
    await clearCart(page);
    await preview(page, false);
    await browser.close();
  }

  // 2. Singapore keeps Single pack + 3+1 (owner, 2026-10-28): the offer is Malaysia only.
  console.log(ON ? '\n新加坡' : '\n新加坡（预览）');
  {
    const { browser, page } = await open('iphone15-safari');
    await goto(page, '/', 'SG');
    await clearCart(page);
    await preview(page, true);
    await goto(page, PDP, 'SG');
    await sleep(1500);
    const r = await readPdp(page);
    check('SG 选项照旧（单包 + 3+1）', !!r && JSON.stringify(r.tiers) === JSON.stringify(['Single pack', 'Buy 3 get 1 free']), r && r.tiers.join(' / '));
    if (r) {
      check('SG 预设选 3+1', r.active === 'Buy 3 get 1 free', r.active);
      check('SG 说明照旧', r.note.trim() === '3+1 promotion is limited to once per order*', r.note.trim());
      check('SG 副标照旧', r.subtitle.trim() === '3+1 promotion is limited to once per order*', r.subtitle.trim());
    }
    await cartPost(page, '/cart/add.js', { items: SCENTS.map((id) => ({ id, quantity: 1 })) });
    await goto(page, '/cart', 'SG');
    await sleep(3000);
    const f = await cartFreeShip(page);
    check('SG 3 包不算免运', f.js === null, JSON.stringify(f));
    await clearCart(page);
    await preview(page, false);
    await browser.close();
  }

  // 3. Before the switch: a shopper without the attribute sees the old picker.
  if (!ON) {
    console.log('\n一般顾客（开关还没开）');
    const { browser, page } = await open('desktop-chrome');
    await goto(page, '/', 'MY');
    await goto(page, PDP, 'MY');
    await sleep(1500);
    const r = await readPdp(page);
    check('MY 选项照旧', !!r && JSON.stringify(r.tiers) === JSON.stringify(['Single pack', 'Buy 6 get 3 free', 'Buy 3 get 1 free']), r && r.tiers.join(' / '));
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} 项失败（截图在 qa/out/set-offer）` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
