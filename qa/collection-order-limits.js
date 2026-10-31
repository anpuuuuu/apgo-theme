const assert = require('assert/strict');
const path = require('path');
const { open, url, cart, cartPost, clearCart, sleep } = require('./lib');

async function run() {
  const results = [];
  const products = [
    { id: 15468443173018, variant: 67986611273882 },
    { id: 15468456673434, variant: 67986732351642 },
  ];
  for (const device of ['android-chrome', 'desktop-chrome']) {
    const { browser, page } = await open(device);
    const dialogs = [];
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
    let posts = 0;
    page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/cart/add.js') posts++; });
    const quantity = async variant => (await cart(page)).items.filter(i => i.variant_id === variant).reduce((n, i) => n + i.quantity, 0);
    const waitReady = async () => page.waitForFunction(() => !document.getElementById('apgoCollAddBtn').disabled && !document.getElementById('apgoCollBuyBtn').disabled);
    const waitClosed = async () => {
      await page.waitForFunction(() => !document.getElementById('apgoCollectionVariantShell').classList.contains('active'));
      await sleep(400);
    };
    const show = async id => {
      await page.locator(`product-card[data-product-id="${id}"] [data-apgo-collection-drawer-open]`).first().click({ force: true });
      await page.waitForFunction(() => document.getElementById('apgoCollectionVariantShell').classList.contains('active'));
    };
    try {
      await page.goto(url('/collections/all', { country: 'MY' }), { waitUntil: 'load' });
      await clearCart(page);
      for (const p of products) {
        await show(p.id);
        await page.locator('#apgoCollectionVariantShell [data-apgo-qty="1"]').evaluate(b => { b.click(); b.click(); b.click(); });
        assert.equal(await page.locator('#apgoCollQtyValue').innerText(), '2');
        await page.waitForFunction(() => document.querySelector('.apgo-cart-success-toast--error')?.textContent.includes('Limit 2'));
        await page.locator('#apgoCollAddBtn').click();
        await waitClosed();
        assert.equal(await quantity(p.variant), 2);
        await show(p.id);
        const before = posts;
        for (const button of ['#apgoCollAddBtn', '#apgoCollBuyBtn']) {
          await page.locator('.apgo-cart-success-toast').evaluateAll(es => es.forEach(e => e.remove()));
          await page.locator(button).click();
          await page.waitForFunction(() => document.querySelector('.apgo-cart-success-toast--error')?.textContent.includes('Limit 2'));
          await waitReady();
          assert.equal(await quantity(p.variant), 2);
          assert.equal(posts, before);
          assert.equal(new URL(page.url()).pathname, '/collections/all');
        }
        if (device === 'android-chrome' && p === products[0]) {
          await page.screenshot({ path: path.join(__dirname, '../../../outputs/all-products-order-limit-mobile.png') });
        }
        await page.locator('[data-apgo-collection-drawer-close]').first().click();
        await waitClosed();
        results.push({ ok: true, detail: `${device}: ${p.id} 数量停在 2，满额 Add/Buy 都显示提示且不发加购请求` });
      }
      await clearCart(page);
      await cartPost(page, '/cart/add.js', { items: [{ id: products[0].variant, quantity: 1 }] });
      await show(products[0].id);
      await page.locator('#apgoCollectionVariantShell').evaluate(shell => {
        shell.querySelector('#apgoCollAddBtn').click();
        shell.querySelector('#apgoCollBuyBtn').click();
      });
      await waitClosed();
      assert.equal(await quantity(products[0].variant), 2);
      assert.equal(new URL(page.url()).pathname, '/collections/all');
      results.push({ ok: true, detail: `${device}: 同时点击 Add/Buy 只增加 1 套` });
      await show(8614519931034);
      await page.locator('#apgoCollectionVariantShell [data-apgo-qty="1"]').evaluate(b => { b.click(); b.click(); });
      assert.equal(await page.locator('#apgoCollQtyValue').innerText(), '3');
      results.push({ ok: true, detail: `${device}: 非活动商品仍可选择 3 件` });
      assert.deepEqual(dialogs, []);
    } finally {
      await page.goto(url('/')).catch(() => {});
      await clearCart(page).catch(() => {});
      await browser.close();
    }
  }
  return results;
}

module.exports = { run };
if (require.main === module) run().then(results => results.forEach(r => console.log('PASS ' + r.detail))).catch(e => { console.error(e); process.exitCode = 1; });
