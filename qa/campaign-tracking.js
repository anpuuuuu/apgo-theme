// Offline check of assets/apgo-campaign-tracking.js (2026-11-23), run in a
// fake page with the real privacy snippet. Touches no store.
// - Banner and card events use the Shopify Google app's item IDs
//   (shopify_ZZ_<product>_<variant>), so GA4 can match them to cart items.
// - Clicked banners go on the cart attribute apgo_promo_clicked (newest
//   last, no repeats), and the list restarts when the cart changes.
// - The exit event is not sent after 25+ idle minutes (it would open a GA4
//   session with no source).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const privacyScript = read('snippets/apgo-telemetry-privacy.liquid').match(/<script>([\s\S]*?)<\/script>/)[1];
const trackingScript = read('assets/apgo-campaign-tracking.js');

class El {
  constructor(attrs = {}, { cls = '', tag = 'div', parent = null } = {}) {
    this.attrs = attrs; this.cls = cls; this.tag = tag; this.parentElement = parent;
    this.handlers = {}; this.children = {};
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  querySelectorAll(sel) { return this.children[sel] || []; }
  querySelector(sel) { return (this.children[sel] || [])[0] || null; }
  matches(selector) {
    return selector.split(',').some((raw) => {
      const sel = raw.trim();
      if (sel.includes(' ')) return false;
      if (sel === 'a[href]') return this.tag === 'a' && this.hasAttribute('href');
      if (sel.startsWith('[')) return this.hasAttribute(sel.slice(1, -1));
      if (sel.startsWith('.')) return this.cls.split(' ').includes(sel.slice(1));
      return false;
    });
  }
  closest(sel) { let e = this; while (e) { if (e.matches(sel)) return e; e = e.parentElement; } return null; }
}

function page({ cookie = '', idleMinutes = 0 } = {}) {
  let clock = Date.UTC(2026, 10, 23, 12);
  const ga = [], fetches = [], win = {}, storage = {};
  const zone = new El({
    'data-apgo-campaign-section': '', 'data-section-id': 'deal01', 'data-section-name': 'Deal 01',
    'data-product-id': '333', 'data-product-name': 'Boss Bundle', 'data-apgo-track-variant-id': '444',
  }, { cls: 'apgo-event-linked-banner-zone' });
  const promo = new El({
    'data-apgo-campaign-promotion-link': '', 'data-promotion-id': '11-11_deal01_banner',
    'data-promotion-name': 'Deal 01', href: '/products/boss',
  }, { tag: 'a', parent: zone });
  const homeLink = new El({
    'data-apgo-homepage-campaign-link': '', 'data-campaign-promotion-id': 'homepage_hero',
    'data-campaign-promotion-name': 'Hero', 'data-slide-position': '1', href: '/pages/sale',
  }, { tag: 'a' });
  const card = new El({
    'data-apgo-home-item': '', 'data-product-id': '111', 'data-product-name': 'Atomic',
    'data-variant-id': '46971377909914', 'data-card-position': '1',
  });
  const list = new El({ 'data-apgo-home-list': '', 'data-list-id': 'best', 'data-list-name': 'Best' });
  list.children['[data-apgo-home-item]'] = [card];
  const root = new El({ 'data-campaign-id': '11-11', 'data-market': 'MY', 'data-currency': 'MYR' });
  const docHandlers = {};
  const document = {
    readyState: 'complete', referrer: '', hidden: false, cookie,
    documentElement: { scrollHeight: 900 },
    addEventListener: (name, fn) => { docHandlers[name] = fn; },
    querySelector: (sel) => (sel === '[data-apgo-campaign-root]' ? root : null),
    querySelectorAll: (sel) => ({
      '[data-apgo-homepage-campaign-link]': [homeLink],
      '[data-apgo-home-list]': [list],
      '[data-apgo-campaign-promotion-link]': [promo],
    })[sel] || [],
  };
  Object.assign(win, {
    document, location: { origin: 'https://store.invalid', pathname: '/pages/11-11-sale', href: 'https://store.invalid/pages/11-11-sale' },
    URL, JSON, Math, Object, Array, String, Number, console, Element: El,
    Date: { now: () => clock },
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
    innerHeight: 800, scrollY: 0, dispatchEvent: () => {}, CustomEvent: class {},
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
    gtag: (type, name, params) => { if (type === 'event') ga.push({ name, params }); },
    fetch: (url, init) => { fetches.push({ url, init, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true }); },
  });
  const winHandlers = {};
  win.addEventListener = (name, fn) => { winHandlers[name] = fn; };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(privacyScript, win);
  vm.runInContext(trackingScript, win);
  return {
    ga, fetches, win, promo, homeLink,
    click: (target) => docHandlers.click({ target }),
    clickHome: () => homeLink.handlers.click(),
    wait: (minutes) => { clock += minutes * 60 * 1000; },
    leave: () => winHandlers.pagehide(),
    lastAttribute: () => fetches[fetches.length - 1].body.attributes.apgo_promo_clicked,
  };
}

async function run() {
  const results = [];
  const check = (detail, fn) => {
    try { fn(); results.push({ ok: true, detail }); } catch (error) { results.push({ ok: false, detail: `${detail}：${error.message}` }); }
  };

  const p = page({ cookie: 'cart=tokA%3Fkey%3Dabc; other=1' });
  check('首页商品列 view_item_list 的 item_id 是 shopify_ZZ_商品_规格，没有被遮成 [redacted] 的 item_variant', () => {
    const item = p.ga.find((e) => e.name === 'view_item_list').params.items[0];
    assert.equal(item.item_id, 'shopify_ZZ_111_46971377909914');
    assert.equal(item.item_variant, undefined);
  });
  check('banner 曝光 view_promotion 用 banner 区块的规格编号', () => {
    assert.equal(p.ga.find((e) => e.name === 'view_promotion').params.items[0].item_id, 'shopify_ZZ_333_444');
  });
  p.click(p.promo);
  check('点 banner：select_promotion 的 item_id 对得上 Google 格式', () => {
    assert.equal(p.ga.find((e) => e.name === 'select_promotion').params.items[0].item_id, 'shopify_ZZ_333_444');
  });
  check('点 banner：用 keepalive 写进购物车属性 apgo_promo_clicked', () => {
    const last = p.fetches[p.fetches.length - 1];
    assert.equal(last.url, '/cart/update.js');
    assert.equal(last.init.keepalive, true);
    assert.equal(p.lastAttribute(), '11-11_deal01_banner');
  });
  p.clickHome();
  p.click(p.promo);
  check('多次点击：新的放最后、不重复', () => assert.equal(p.lastAttribute(), 'homepage_hero, 11-11_deal01_banner'));
  p.win.document.cookie = 'cart=tokB%3Fkey%3Dxyz';
  p.clickHome();
  check('购物车换了（例如下单后）：清单重新开始', () => assert.equal(p.lastAttribute(), 'homepage_hero'));

  const idle = page();
  idle.wait(26);
  idle.leave();
  check('闲置 26 分钟后离开：不送 apgo_campaign_exit', () => assert.ok(!idle.ga.some((e) => e.name === 'apgo_campaign_exit')));
  const active = page();
  active.wait(1);
  active.leave();
  check('1 分钟内离开：照常送 apgo_campaign_exit', () => assert.ok(active.ga.some((e) => e.name === 'apgo_campaign_exit')));

  return results;
}

module.exports = { run };
if (require.main === module) {
  run().then((r) => {
    r.forEach((i) => console.log(`${i.ok ? 'PASS' : 'FAIL'} ${i.detail}`));
    process.exit(r.every((i) => i.ok) ? 0 : 1);
  });
}
