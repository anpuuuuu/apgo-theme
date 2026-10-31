const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { Liquid } = require('liquidjs');
const { chromium, webkit } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TRIGGER = 67976724512922;
const OFFER = 47521770668186;
const PROP = '_apgo_aurora_pwp';
const MARKER = 'aurora-39';
const locale = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/en.default.json'), 'utf8').replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ''));
const liquid = new Liquid();
liquid.registerFilter('json', value => JSON.stringify(value ?? null));
liquid.registerFilter('money', value => 'RM' + (value / 100).toFixed(2));
liquid.registerFilter('asset_url', value => '/assets/' + value);
liquid.registerFilter('t', (key, ...args) => {
  let value = key.split('.').reduce((obj, part) => obj?.[part], locale) || key;
  args.forEach(arg => { if (Array.isArray(arg)) value = value.replace('{{ ' + arg[0] + ' }}', arg[1]); });
  return value;
});
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const cleanLiquid = text => text.replace(/{%-?\s*doc\s*-?%}[\s\S]*?{%-?\s*enddoc\s*-?%}/g, '');
const line = (variant_id, quantity = 1, properties = {}, key) => ({ variant_id, id: variant_id, quantity, properties, key: key || `${variant_id}:${JSON.stringify(properties)}`, final_line_price: quantity * (variant_id === OFFER ? 6000 : 11100) });
const marked = (quantity = 1, key) => line(OFFER, quantity, { [PROP]: MARKER }, key);

async function run() {
  const browser = await (process.argv.includes('--webkit') ? webkit : chromium).launch();
  const results = [];
  const check = (name) => { results.push({ ok: true, detail: name }); console.log('PASS ' + name); };
  async function setup({ country = 'MY', currency = 'MYR', items = [line(TRIGGER)], width = 393, available = true, noCard = false } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: 'no-preference' });
    const cart = { token: 'qa-cart', currency, items, item_count: 0 };
    const controls = { addFailure: false, updateFailure: false, lostResponse: false, readFailure: false, posts: 0, updates: 0, errors: [] };
    let documentHtml;
    const page = await context.newPage();
    page.on('pageerror', error => controls.errors.push(error.message));
    const render = async () => {
      const data = { cart: { ...cart, currency: { iso_code: cart.currency } }, localization: { country: { iso_code: country } }, original_price: 60, all_products: { 'apgo-car-interior-eco-friendly-coating': { title: 'Interior Set', variants: [{ id: OFFER, title: 'Car Interior Set', available }] } } };
      const config = await liquid.parseAndRender(cleanLiquid(source('snippets/apgo-cart-aurora-config.liquid')), data);
      const card = noCard ? '' : await liquid.parseAndRender(cleanLiquid(source('snippets/apgo-cart-aurora-offer.liquid')), data);
      return `<!doctype html><html><head><script type="importmap">{"imports":{"@theme/component":"/qa-component.js"}}</script><style>body{background:#000;color:#fff;font-family:Arial}.cart-page{max-width:700px;margin:auto}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}</style><link rel="stylesheet" href="/assets/apgo-cart-aurora-offer.css"></head><body><cart-items-component data-section-id="main"><div class="cart-page">${card}</div></cart-items-component><button name="checkout">Checkout</button>${config}</body></html>`;
    };
    await context.route('https://pwp.test/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      cart.item_count = cart.items.reduce((sum, item) => sum + item.quantity, 0);
      if (pathname === '/qa-component.js') return route.fulfill({ contentType: 'application/javascript', body: 'export class Component extends HTMLElement {}' });
      if (pathname.startsWith('/assets/')) return route.fulfill({ contentType: pathname.endsWith('.js') ? 'application/javascript' : 'text/css', body: source(pathname.slice(1)) });
      if (pathname === '/cart.js') return controls.readFailure ? route.fulfill({ status: 503, body: '{}' }) : json(cart);
      if (pathname === '/cart/add.js') {
        controls.posts++;
        if (controls.addFailure) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ description: 'Sold out' }) });
        const data = route.request().postDataJSON();
        assert.equal(data.items.length, 1);
        assert.equal(data.items[0].id, OFFER);
        assert.equal(data.items[0].quantity, 1);
        assert.deepEqual(data.items[0].properties, { [PROP]: MARKER });
        const existing = cart.items.find(item => item.variant_id === OFFER && item.properties[PROP] === MARKER);
        if (existing) existing.quantity++;
        else cart.items.push(marked());
        if (controls.lostResponse) return route.abort('failed');
        return json({ items: data.items, sections: {} });
      }
      if (pathname === '/cart/update.js') {
        controls.updates++;
        if (controls.updateFailure) return route.fulfill({ status: 503, body: '{}' });
        const data = route.request().postDataJSON();
        cart.items.forEach(item => { if (Object.hasOwn(data.updates, item.key)) item.quantity = data.updates[item.key]; });
        cart.items = cart.items.filter(item => item.quantity > 0);
        cart.item_count = cart.items.reduce((sum, item) => sum + item.quantity, 0);
        return json(cart);
      }
      documentHtml = await render();
      return route.fulfill({ contentType: 'text/html', body: documentHtml });
    });
    await page.goto('https://pwp.test/cart');
    await page.waitForFunction(() => window.apgoAuroraOffer?.cart && !window.apgoAuroraOffer.refreshPending);
    assert.equal(await page.locator('apgo-aurora-offer').count(), !noCard && country === 'MY' && currency === 'MYR' && items.some(item => item.variant_id === TRIGGER) ? 1 : 0);
    const settled = () => page.waitForFunction(() => !document.querySelector('[data-offer-transition]'));
    const refresh = async () => { await page.evaluate(() => window.apgoAuroraOffer.refresh()); await settled(); };
    const add = () => page.locator('.aurora-offer__button').click();
    const waitDone = () => page.waitForFunction(() => !window.apgoAuroraOffer.busy && !window.apgoAuroraOffer.writing && !document.querySelector('[data-offer-transition]'));
    return { context, page, cart, controls, refresh, add, waitDone, render, count: () => cart.items.filter(item => item.variant_id === OFFER).reduce((sum, item) => sum + item.quantity, 0) };
  }
  try {
    for (const width of [393, 1440]) {
      const test = await setup({ width });
      const { page, cart, controls } = test;
      const deadline = await page.evaluate(() => window.apgoAuroraOffer.deadline);
      await page.reload();
      await page.waitForFunction(() => window.apgoAuroraOffer?.cart);
      assert.equal(await page.evaluate(() => window.apgoAuroraOffer.deadline), deadline);
      await page.evaluate(async () => {
        const controller = window.apgoAuroraOffer;
        localStorage.setItem(controller.storageKey, JSON.stringify({ active: true, deadline: Date.now() - 1000 }));
        await controller.refresh();
      });
      assert.equal(await page.locator('[data-offer-minutes]').innerText(), '00');
      assert.equal(await page.locator('[data-offer-seconds]').innerText(), '00');
      assert.equal(await page.locator('.aurora-offer__button').isEnabled(), true);
      const animations = await page.locator('apgo-aurora-offer').evaluate(el => ({ border: getComputedStyle(el.querySelector('.aurora-offer__beam-core')).animationName, shimmer: getComputedStyle(el.querySelector('.aurora-offer__card'), '::after').animationName }));
      assert.notEqual(animations.border, 'none');
      assert.notEqual(animations.shimmer, 'none');
      await page.locator('.aurora-offer__button').evaluate(button => { button.click(); button.click(); button.click(); });
      await test.waitDone();
      assert.equal(test.count(), 1);
      assert.equal(controls.posts, 1);
      assert.equal(await page.locator('.aurora-offer__button').isDisabled(), true);
      assert.equal(await page.locator('apgo-aurora-offer').isHidden(), true);
      assert.equal(cart.items.find(item => item.variant_id === OFFER).final_line_price, 6000);
      await page.reload();
      await page.waitForFunction(() => window.apgoAuroraOffer?.cart);
      assert.equal(await page.locator('apgo-aurora-offer').isHidden(), true);
      const removalDeadline = await page.evaluate(() => window.apgoAuroraOffer.deadline);
      cart.items = cart.items.filter(item => item.variant_id !== OFFER);
      await test.refresh();
      assert.equal(await page.locator('apgo-aurora-offer').isVisible(), true);
      assert.equal(await page.locator('.aurora-offer__button').isEnabled(), true);
      assert.equal(await page.evaluate(() => window.apgoAuroraOffer.deadline), removalDeadline);
      await test.add(); await test.waitDone();
      assert.equal(test.count(), 1);
      assert.equal(await page.locator('apgo-aurora-offer').isHidden(), true);
      const originalDeadline = await page.evaluate(() => window.apgoAuroraOffer.deadline);
      cart.items = cart.items.filter(item => item.variant_id !== TRIGGER);
      await test.refresh();
      assert.equal(test.count(), 0);
      assert.equal(await page.locator('apgo-aurora-offer').isHidden(), true);
      cart.items.push(line(TRIGGER));
      await test.refresh();
      assert.ok(await page.evaluate(previous => window.apgoAuroraOffer.deadline > previous, originalDeadline));
      assert.equal(await page.locator('[data-offer-minutes]').innerText(), '10');
      assert.deepEqual(controls.errors, []);
      check(`${width}px: add hides card across reload; remove restores card and same timer; refresh continues timer; zero keeps add and animations; repeat clicks add one; trigger removal cleans up and resets timer; checkout price remains server controlled`);
      await test.context.close();
    }
    for (const country of ['MY', 'SG']) {
      const test = await setup({ country, currency: 'MYR', items: [line(TRIGGER), line(OFFER, 1, {}, 'normal'), marked(3, 'pwp')] });
      assert.equal(test.count(), 1);
      assert.equal(test.cart.items.find(item => item.key === 'normal').quantity, 1);
      assert.ok(!test.cart.items.some(item => item.key === 'pwp'));
      if (country === 'SG') assert.equal(await test.page.locator('apgo-aurora-offer').count(), 0);
      test.cart.items = test.cart.items.filter(item => item.variant_id !== TRIGGER);
      await test.refresh();
      assert.equal(test.count(), 1);
      check(`${country}: only tagged add-on is removed; regular Interior Set stays; country eligibility does not rely on currency alone`);
      await test.context.close();
    }
    {
      const test = await setup({ items: [line(TRIGGER), marked(3, 'a'), marked(2, 'b')] });
      assert.equal(test.count(), 1);
      test.cart.items = [];
      await test.refresh();
      assert.equal(await test.page.evaluate(() => window.apgoAuroraOffer.deadline), 0);
      test.cart.items = [line(TRIGGER)];
      await test.refresh();
      assert.equal(await test.page.locator('[data-offer-minutes]').innerText(), '10');
      test.cart.token = 'new-cart';
      await test.refresh();
      check('multiple marked lines clamp to one; empty/new cart resets timer');
      await test.context.close();
    }
    for (const lostResponse of [false, true]) {
      const test = await setup();
      test.controls.addFailure = !lostResponse;
      test.controls.lostResponse = lostResponse;
      await test.add(); await test.waitDone();
      if (lostResponse) { assert.equal(test.count(), 1); assert.equal(test.controls.posts, 1); }
      else {
        assert.equal(test.count(), 0);
        assert.equal(await test.page.locator('.aurora-offer__button').isEnabled(), true);
        assert.match(await test.page.locator('[data-offer-status]').innerText(), /Sold out/);
        test.controls.addFailure = false;
        await test.add(); await test.waitDone();
        assert.equal(test.count(), 1);
      }
      check(lostResponse ? 'lost add response recovers by reading cart without replaying POST' : 'failed add restores button and retry works');
      await test.context.close();
    }
    {
      const test = await setup();
      test.controls.readFailure = true;
      await test.add(); await test.waitDone();
      assert.equal(test.controls.posts, 0);
      test.controls.readFailure = false;
      await test.add(); await test.waitDone();
      test.cart.items = test.cart.items.filter(item => item.variant_id !== TRIGGER);
      test.controls.updateFailure = true;
      await test.refresh();
      assert.equal(await test.page.locator('button[name="checkout"]').isDisabled(), true);
      test.controls.updateFailure = false;
      await test.refresh();
      assert.equal(test.count(), 0);
      assert.equal(await test.page.locator('button[name="checkout"]').isEnabled(), true);
      check('read failure prevents add; failed cleanup holds checkout until retry succeeds');
      await test.context.close();
    }
    {
      const test = await setup({ country: 'SG', currency: 'SGD', noCard: true, items: [marked()] });
      assert.equal(test.count(), 0);
      check('global controller removes ineligible add-on outside the cart card');
      await test.context.close();
    }
    {
      const test = await setup();
      const second = await test.context.newPage();
      await second.goto('https://pwp.test/cart');
      await second.waitForFunction(() => window.apgoAuroraOffer?.cart && !window.apgoAuroraOffer.refreshPending);
      const deadline = await test.page.evaluate(() => window.apgoAuroraOffer.deadline);
      assert.equal(await second.evaluate(() => window.apgoAuroraOffer.deadline), deadline);
      await Promise.all([test.page.evaluate(() => window.apgoAuroraOffer.add()), second.evaluate(() => window.apgoAuroraOffer.add())]);
      assert.equal(test.count(), 1);
      assert.equal(test.controls.posts, 1);
      check('two tabs share countdown and simultaneous adds still create one set');
      await test.context.close();
    }
    {
      const test = await setup();
      const { page, cart } = test;
      const fullHeight = await page.locator('apgo-aurora-offer').evaluate(el => el.getBoundingClientRect().height);
      const closing = await page.evaluate(async () => {
        await window.apgoAuroraOffer.add();
        const el = document.querySelector('apgo-aurora-offer');
        el.visibilityAnimation.pause(); el.visibilityAnimation.currentTime = 140;
        return { height: el.getBoundingClientRect().height, opacity: Number(getComputedStyle(el).opacity), inert: el.inert };
      });
      assert(closing.height > 0 && closing.height < fullHeight);
      assert(closing.opacity > 0 && closing.opacity < 1);
      assert.equal(closing.inert, true);
      const morph = async () => page.evaluate(async html => {
        const { morph } = await import('/assets/morph.js');
        const incoming = new DOMParser().parseFromString(html, 'text/html').querySelector('cart-items-component');
        morph(document.querySelector('cart-items-component'), incoming);
      }, await test.render());
      await morph();
      assert.equal(await page.locator('apgo-aurora-offer').getAttribute('data-offer-transition'), 'closing');
      await page.evaluate(() => document.querySelector('apgo-aurora-offer').visibilityAnimation.finish());
      await test.waitDone();
      assert.equal(await page.locator('apgo-aurora-offer').isHidden(), true);
      cart.items = cart.items.filter(item => item.variant_id !== OFFER);
      await morph();
      assert.equal(await page.locator('apgo-aurora-offer').isHidden(), true);
      const opening = await page.evaluate(async () => {
        await window.apgoAuroraOffer.refresh();
        const el = document.querySelector('apgo-aurora-offer');
        el.visibilityAnimation.pause(); el.visibilityAnimation.currentTime = 140;
        return { height: el.getBoundingClientRect().height, opacity: Number(getComputedStyle(el).opacity) };
      });
      assert(opening.height > 0 && opening.height < fullHeight);
      assert(opening.opacity > 0 && opening.opacity < 1);
      await page.evaluate(async () => {
        await window.apgoAuroraOffer.add();
        document.querySelector('apgo-aurora-offer').visibilityAnimation.finish();
      });
      await test.waitDone();
      assert.equal(await page.locator('apgo-aurora-offer').isHidden(), true);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      cart.items = cart.items.filter(item => item.variant_id !== OFFER);
      await test.refresh();
      assert.equal(await page.locator('apgo-aurora-offer').isVisible(), true);
      assert.equal(await page.evaluate(() => document.querySelector('apgo-aurora-offer').visibilityAnimation), null);
      await test.add(); await test.waitDone();
      assert.equal(await page.locator('apgo-aurora-offer').isHidden(), true);
      assert.deepEqual(test.controls.errors, []);
      check('height and opacity animate together; cart morph preserves transition; rapid reversal settles; reduced motion skips animation');
      await test.context.close();
    }
    {
      const test = await setup({ available: false });
      assert.equal(await test.page.locator('.aurora-offer__button').isDisabled(), true);
      check('unavailable add-on cannot be selected');
      await test.context.close();
    }
  } finally { await browser.close(); }
  return results;
}

module.exports = { run };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
