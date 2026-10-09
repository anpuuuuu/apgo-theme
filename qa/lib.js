// Shared helpers for the storefront QA scripts (qa/README.md).
// BASE      storefront origin, default https://apgo.my
// THEME_ID  run against an unpublished theme (staging) via preview_theme_id
const { webkit, chromium } = require('playwright');

const BASE = process.env.BASE || 'https://apgo.my';
const THEME_ID = process.env.THEME_ID || '';

function url(pathname, params = {}) {
  const u = new URL(pathname, BASE);
  if (THEME_ID) u.searchParams.set('preview_theme_id', THEME_ID);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

// Test sessions must not feed ads data or our own error alerts.
const BLOCK = /facebook\.com\/tr|connect\.facebook\.net|google-analytics\.com|googletagmanager\.com|analytics\.google\.com|doubleclick\.net|analytics\.tiktok\.com|tiktok\.com\/(api|i18n\/pixel)|clarity\.ms|apgo-error-monitor\.|monorail-edge\.shopifysvc\.com|\/api\/collect/;

const UA = {
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Mobile/15E148 Safari/604.1',
  iosFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/24A437 Safari/604.1 [FBAN/FBIOS;FBAV/581.0.0.64.71;FBBV/1080178719;FBDV/iPhone16,2;FBMD/iPhone;FBSN/iOS;FBSV/27.0;FBSS/3;FBID/phone;FBLC/en_Qaau_GB;FBOP/5;FBRV/1082709530;IABMV/1]',
  iosInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23F84 Instagram 448.0.0.39.66 (iPhone15,2; iOS 26_5_2; en_GB; en-GB; scale=3.00; 1179x2556; IABMV/1; 1072661960) Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 15; SM-A156E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
  androidFacebook: 'Mozilla/5.0 (Linux; Android 16; RMX3840 Build/BP2A.250605.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/154.0.8037.64 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/581.0.0.45.58;IABMV/1;]',
  ipadSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  desktopSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15',
};

const phone = (width, height, userAgent, deviceScaleFactor = 3) => ({ viewport: { width, height }, userAgent, isMobile: true, hasTouch: true, deviceScaleFactor });

const DEVICES = {
  'iphone15-safari': { label: 'iPhone 15 · Safari', engine: webkit, ctx: phone(393, 659, UA.iosSafari) },
  'iphoneSE-safari': { label: 'iPhone SE · Safari', engine: webkit, ctx: phone(375, 553, UA.iosSafari, 2) },
  'iphone-facebook': { label: 'iPhone · Facebook app', engine: webkit, ctx: phone(393, 740, UA.iosFacebook) },
  'iphone-instagram': { label: 'iPhone · Instagram app', engine: webkit, ctx: phone(393, 740, UA.iosInstagram) },
  'android-chrome': { label: 'Android · Chrome (360 wide)', engine: chromium, ctx: phone(360, 720, UA.androidChrome, 2.6) },
  'android-facebook': { label: 'Android · Facebook app', engine: chromium, ctx: phone(412, 800, UA.androidFacebook, 2.6) },
  'ipad-safari': { label: 'iPad mini · Safari', engine: webkit, ctx: { viewport: { width: 768, height: 1024 }, userAgent: UA.ipadSafari, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  'desktop-chrome': { label: 'Desktop · Chrome', engine: chromium, ctx: { viewport: { width: 1440, height: 900 }, userAgent: UA.desktopChrome } },
  'desktop-safari': { label: 'Desktop · Safari', engine: webkit, ctx: { viewport: { width: 1440, height: 900 }, userAgent: UA.desktopSafari } },
};

async function open(deviceId, extra = {}) {
  const d = DEVICES[deviceId];
  const browser = await d.engine.launch();
  const context = await browser.newContext({ locale: 'en-MY', timezoneId: 'Asia/Kuala_Lumpur', ...d.ctx, ...extra });
  await context.route('**/*', (route) => (BLOCK.test(route.request().url()) ? route.abort() : route.continue()));
  const page = await context.newPage();
  return { browser, context, page, device: d };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cart(page) {
  return page.evaluate(async () => (await fetch('/cart.js?_=' + Date.now())).json());
}

async function cartPost(page, endpoint, body) {
  return page.evaluate(async ([e, b]) => {
    const r = await fetch(e, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(b) });
    return r.status;
  }, [endpoint, body]);
}

async function clearCart(page) {
  return page.evaluate(() => fetch('/cart/clear.js', { method: 'POST', headers: { Accept: 'application/json' } }).then((r) => r.status));
}

// Phones: after a scroll, the shipping marquee must sit right under the last
// pinned bar of the header group (header, or the /collections/all category
// bar). Product pages do not pin the header on phones, so they are skipped.
async function stickyGap(page) {
  await page.evaluate(() => window.scrollTo(0, 900));
  await sleep(500);
  await page.evaluate(() => window.scrollTo(0, 820));
  await sleep(700);
  return page.evaluate(() => {
    if (document.body.classList.contains('apgo-product-page')) return { skipped: 'product page' };
    const m = document.getElementById('shopify-section-free-shipping-popup');
    if (!m) return { skipped: 'no marquee' };
    const pinned = [...document.querySelectorAll('#header-group > .shopify-section')]
      .filter((s) => getComputedStyle(s).position === 'sticky' && s.getBoundingClientRect().height > 0);
    if (!pinned.length) return { skipped: 'header not pinned' };
    const bottom = Math.max(...pinned.map((s) => s.getBoundingClientRect().bottom));
    const top = m.getBoundingClientRect().top;
    return { headerBottom: Math.round(bottom), marqueeTop: Math.round(top), gap: Math.round(top - bottom), hidden: document.body.classList.contains('apgo-scroll-hide') };
  });
}

// Sideways overflow and broken images that are actually on screen (lazy
// images not loaded yet, e.g. in the closed search drawer, are not broken).
async function layout(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
    const offenders = [];
    if (overflow > 1) {
      const clipped = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (/hidden|clip|auto|scroll/.test(getComputedStyle(p).overflowX)) return true;
        }
        return false;
      };
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed' && !clipped(el)) {
          offenders.push((el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '')).slice(0, 80));
          if (offenders.length >= 3) break;
        }
      }
    }
    const brokenImgs = [...document.images].filter((i) => {
      const r = i.getBoundingClientRect();
      return i.offsetParent && r.width > 0 && r.top < window.innerHeight && r.bottom > 0 && i.complete && i.naturalWidth === 0 && i.src && !i.src.startsWith('data:');
    }).map((i) => i.src.split('?')[0].split('/').pop()).slice(0, 5);
    const header = document.querySelector('#header-group > .shopify-section.header-section');
    const hr = header && header.getBoundingClientRect();
    return { vw, overflow: overflow > 1 ? overflow : 0, offenders, brokenImgs, headerVisible: !!(hr && hr.height > 20) };
  });
}

module.exports = { BASE, THEME_ID, url, DEVICES, open, sleep, cart, cartPost, clearCart, stickyGap, layout };
