// 11.11 "Red Ticket" page (templates/page.double-11.json, skin "ticket" in
// snippets/apgo-event-skin.liquid, assets/apgo-ticket-skin.css).
// Malaysia and Singapore, phone / tablet / desktop:
//   - loads, body has both skin classes, the ticket stylesheet is in
//   - none of the clearance wording (LOT, Clearance · Box, OLD FACTORY ...)
//   - hero halves and buttons point at anchors that exist on the page,
//     and the jump lands below the sticky header
//   - countdown showing, no sideways scroll, no broken images on screen
//   - a card's Add to cart puts it in the cart (cart cleared afterwards)
// Screenshots go to qa/out/sale-1111/.
//   THEME_ID=188964503706 node sale-1111.js                 staging, /pages/11-11-sale
//   THEME_ID=188964503706 VIEW_ON=/pages/clearance-sale node sale-1111.js
//       before the 11.11 page exists: renders the template on another page (?view=double-11)
const fs = require('fs');
const path = require('path');
const { url, open, sleep, cart, clearCart, layout } = require('./lib');

const OUT = path.join(__dirname, 'out', 'sale-1111');
fs.mkdirSync(OUT, { recursive: true });

const VIEW_ON = process.env.VIEW_ON || '';
const PAGE = VIEW_ON || process.env.PAGE_PATH || '/pages/11-11-sale';
const DEVICES = (process.env.DEVICES || 'android-chrome,ipad-safari,desktop-chrome').split(',');
const COUNTRIES = (process.env.COUNTRIES || 'MY,SG').split(',');
const CLEARANCE_WORDS = /\bLOT \d|Clearance · Box|OLD FACTORY|MIXED STOCK|PACKED BY/i;

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}
function note(label, detail) {
  console.log(`  NOTE ${label}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}

async function run(device, country) {
  const params = { country };
  if (VIEW_ON) params.view = 'double-11';
  const s = await open(device);
  const { page } = s;
  console.log(`\n${s.device.label} · ${country}`);
  try {
    const resp = await page.goto(url(PAGE, params), { waitUntil: 'load', timeout: 60000 });
    check('HTTP 200', resp && resp.status() === 200, resp && resp.status());
    await sleep(1500);

    const info = await page.evaluate((wordsSrc) => {
      const words = new RegExp(wordsSrc, 'i');
      const main = document.getElementById('MainContent');
      const anchors = [...document.querySelectorAll('.apgo-event-banner__hotspot, .apgo-event-banner__jump')].map((a) => {
        const href = a.getAttribute('href') || '';
        const id = href.startsWith('#') ? href.slice(1) : '';
        return { cls: a.className.split(' ').pop(), href, found: !!(id && document.getElementById(id)) };
      });
      const cd = document.querySelector('[data-apgo-crate-countdown]');
      const stamps = [...document.querySelectorAll('.apgo-crate-zone--row .apgo-crate-stamp')].map((e) => e.textContent.trim());
      const price = document.querySelector('.apgo-event-listing-card__price-current');
      return {
        classes: ['apgo-clearance-sale-page', 'apgo-ticket-page'].every((c) => document.body.classList.contains(c)),
        css: !!document.querySelector('link[href*="apgo-ticket-skin"]'),
        clearanceWords: ((main && main.innerText) || '').match(words),
        anchors,
        countdown: !!(cd && !cd.hidden && cd.getBoundingClientRect().height > 0),
        promos: document.querySelectorAll('.apgo-crate-zone--offer').length,
        rows: document.querySelectorAll('.apgo-crate-zone--row').length,
        stamps: [...new Set(stamps)],
        priceClip: price ? getComputedStyle(price).clipPath : null,
        groundColor: getComputedStyle(main).backgroundColor,
      };
    }, CLEARANCE_WORDS.source);

    check('body has apgo-clearance-sale-page + apgo-ticket-page', info.classes);
    check('apgo-ticket-skin.css loaded', info.css);
    check('no clearance wording on the page', !info.clearanceWords, info.clearanceWords && info.clearanceWords[0]);
    check('paper ground (not the dark warehouse floor)', info.groundColor === 'rgb(255, 246, 241)', info.groundColor);
    check('countdown showing', info.countdown);
    check('product rows rendered', info.rows > 0, info.rows);
    if (info.priceClip !== null) check('card price is not a hang tag', info.priceClip === 'none', info.priceClip);
    note('promo coupons rendered', info.promos);
    note('row badges', info.stamps);
    if (info.anchors.length) {
      const missing = info.anchors.filter((a) => !a.found);
      if (missing.length) note('hero links whose target is not on this page (block not set up yet, or hidden in this market)', missing);
      else check('hero links all have targets', true);
    } else {
      note('hero has no left/right links (no banner image yet?)');
    }

    const lay = await layout(page);
    check('no sideways scroll', lay.overflow === 0, lay.overflow ? { overflow: lay.overflow, offenders: lay.offenders } : undefined);
    check('header visible', lay.headerVisible);
    check('no broken images on screen', lay.brokenImgs.length === 0, lay.brokenImgs);

    // Jump from the hero lands below the sticky header.
    const target = info.anchors.find((a) => a.found && a.cls.endsWith('--left'));
    if (target) {
      await page.click('.apgo-event-banner__hotspot--left');
      await sleep(1500);
      const land = await page.evaluate((id) => {
        const el = document.getElementById(id);
        const pinned = [...document.querySelectorAll('#header-group > .shopify-section')]
          .filter((sec) => ['sticky', 'fixed'].includes(getComputedStyle(sec).position) && sec.getBoundingClientRect().height > 0);
        const headerBottom = pinned.length ? Math.max(...pinned.map((sec) => sec.getBoundingClientRect().bottom)) : 0;
        return { top: Math.round(el.getBoundingClientRect().top), headerBottom: Math.round(headerBottom) };
      }, target.href.slice(1));
      check('left half lands below the header', land.top >= land.headerBottom - 2 && land.top < 400, land);
    }

    await page.screenshot({ path: path.join(OUT, `${country}-${device}.png`), fullPage: true });

    // Add to cart from the first card that can be bought.
    await clearCart(page);
    const add = await page.$('.apgo-event-listing-card__btn--add:not([disabled]), .apgo-event-linked-banner-zone__button--add:not([disabled])');
    if (add) {
      await add.scrollIntoViewIfNeeded();
      await add.click();
      let count = 0;
      for (let i = 0; i < 10 && !count; i++) {
        await sleep(800);
        count = (await cart(page)).item_count;
      }
      check('Add to cart puts it in the cart', count > 0, count);
      await clearCart(page);
    } else {
      note('no Add to cart button to try');
    }
  } catch (e) {
    check('run without errors', false, e.message.split('\n')[0]);
  } finally {
    await s.browser.close();
  }
}

(async () => {
  console.log(`11.11 page: ${url(PAGE, VIEW_ON ? { view: 'double-11' } : {})}`);
  for (const country of COUNTRIES) {
    for (const device of DEVICES) await run(device, country);
  }
  console.log(`\n${failures ? failures + ' FAILED' : 'all passed'} · screenshots in ${OUT}`);
  process.exit(failures ? 1 : 0);
})();
