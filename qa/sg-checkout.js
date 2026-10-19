// Singapore: the clearance bundle reaches checkout in SGD with payment
// methods offered and no "not available" message. No order is placed.
//   node sg-checkout.js
const path = require('path');
const fs = require('fs');
const { url, open, sleep, cartPost, clearCart } = require('./lib');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const SG_BUNDLE = 67699980959898; // WAREHOUSE CLEARANCE SALE BUNDLE (SG)

(async () => {
  const results = [];
  for (const device of ['iphone15-safari', 'android-chrome']) {
    const { browser, page } = await open(device);
    let ok = false;
    let detail = '';
    try {
      await page.goto(url('/', { country: 'SG' }), { waitUntil: 'load', timeout: 60000 });
      const status = await cartPost(page, '/cart/add.js', { items: [{ id: SG_BUNDLE, quantity: 1 }] });
      await page.goto(url('/cart', { country: 'SG' }), { waitUntil: 'load', timeout: 60000 });
      await sleep(1500);
      await page.locator('button[name="checkout"]:visible').first().click();
      await page.waitForURL(/\/checkouts\//, { timeout: 45000 });
      await page.waitForLoadState('load');
      await sleep(4000);
      const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      const total = (text.match(/(SGD|S?\$)\s?[\d.,]+/) || ['（没读到金额）'])[0];
      const blocked = /not available|unavailable|can't be shipped|cannot be shipped/i.test(text);
      const payment = /Payment/i.test(text);
      ok = status === 200 && !blocked && payment;
      detail = `加入购物车 ${status}，结帐页金额 ${total}，${blocked ? '有「无法配送/不提供」讯息' : '没有错误讯息'}，${payment ? '有付款区块' : '没看到付款区块'}`;
      await page.screenshot({ path: path.join(OUT, `sg-checkout-${device}.png`), fullPage: true });
    } catch (e) {
      detail = '出错：' + String(e.message).split('\n')[0].slice(0, 160);
    }
    try { await page.goto(url('/', { country: 'SG' }), { waitUntil: 'load', timeout: 60000 }); await clearCart(page); } catch (e) {}
    await browser.close();
    results.push(ok);
    console.log(`${ok ? '✓' : '✗'} ${device}：${detail}`);
  }
  process.exit(results.every(Boolean) ? 0 : 1);
})();
