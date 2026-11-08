// Offline regression: actual telemetry producers and actual Liquid snippets.
// No storefront calls, browser sessions, secrets or live customer data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Liquid } = require('liquidjs');
const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const script = file => read(file).match(/<script>([\s\S]*?)<\/script>/)[1];
const marker = 'SENSITIVE_TEST_VALUE';
const email = 'audit-person@example.invalid';
const loc = { origin: 'https://store.invalid', host: 'store.invalid', pathname: '/cart', href: `https://store.invalid/cart?token=${marker}#${marker}` };
function environment() {
  const listeners = {}, reports = [], ga = [], analytics = [];
  const context = {
    location: loc, URL, Blob, Date, JSON, Math, Object, console,
    document: { readyState: 'loading', visibilityState: 'visible', addEventListener: () => {} },
    navigator: { userAgent: 'Offline security QA', onLine: true, sendBeacon: (_url, blob) => { reports.push(blob); return true; } },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    addEventListener: (name, listener) => { listeners[name] = listener; },
    setTimeout: () => 1, clearTimeout: () => {}, dispatchEvent: () => {}, CustomEvent: class {},
    Shopify: { analytics: { publish: (name, data) => { analytics.push({ name, data }); } } },
    gtag: (type, name, data) => { ga.push({ name, data }); },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(script('snippets/apgo-telemetry-privacy.liquid'), context);
  return { context, listeners, reports, ga, analytics };
}
function noSensitive(value) {
  const json = JSON.stringify(value);
  for (const sample of [marker, email, '60123456789']) assert.ok(!json.includes(sample), `Sensitive fixture survived: ${sample}`);
}

async function main() {
  const env = environment();
  const privacy = env.context.apgoTelemetryPrivacy;
  assert.equal(privacy.pathOnly(loc.href), '/cart');
  assert.equal(privacy.pathOnly(`https://store.invalid/checkouts/cn/${marker}`), '/checkouts/[redacted]');
  assert.equal(privacy.pathOnly(`https://store.invalid/account/reset/123/${marker}`), '/account/reset/[redacted]');
  assert.equal(privacy.pathOnly('javascript:alert(1)'), '');
  assert.equal(privacy.pathOnly(`https://store.invalid/${email}`), '/[redacted]');
  assert.equal(privacy.stack(`TypeError: ${email}\n at lookup (https://store.invalid/assets/theme.js?token=${marker}:7:9)`), 'at /assets/theme.js:7:9');
  const clean = privacy.payload({
    page_location: loc.href, page_referrer: `https://other.invalid/account?email=${email}`,
    destination_path: `https://store.invalid/cart?token=${marker}`,
    message: `Customer ${email}, token=${marker}, phone=60123456789`,
    email, access_token: marker, customer: { email },
    product_id: '15466747920538', section_id: 'template--20134659817626__hero', item_name: 'Interior Clean & Coat', price: 30, active: true,
    items: [{ item_id: '47521770668186', item_name: 'Car Interior Set', url: loc.href }],
    extra: `Bearer ${marker}`, details: `token=${marker}`,
  });
  noSensitive(clean);
  assert.equal(clean.product_id, '15466747920538');
  assert.equal(clean.section_id, 'template--20134659817626__hero');
  assert.equal(clean.items[0].item_id, '47521770668186');
  assert.equal(clean.price, 30);
  assert.equal(clean.active, true);

  vm.runInContext(script('snippets/apgo-error-monitor.liquid').replace(/\{\{[\s\S]*?\}\}/g, '4'), env.context);
  env.listeners.error({ message: `TypeError: ${email}`, filename: `https://store.invalid/assets/theme.js?token=${marker}`, lineno: 7, colno: 9, error: { stack: `TypeError: ${email}\n at lookup (https://store.invalid/assets/theme.js?token=${marker}:7:9)` } });
  env.listeners.unhandledrejection({ reason: { message: email, stack: `Error: ${email}\n at https://store.invalid/assets/cart.js?token=${marker}:4:6` } });
  env.context.apgoReportCartError({ message: email, url: loc.href, action: `bad ${email}`, stage: 'response', status: 422, critical: true });
  const reports = await Promise.all(env.reports.map(async blob => JSON.parse(await blob.text())));
  assert.equal(reports.length, 3);
  noSensitive(reports);
  assert.equal(reports[0].m, 'TypeError');
  assert.equal(reports[0].src, '/assets/theme.js');
  assert.equal(reports[0].stack, 'at /assets/theme.js:7:9');
  assert.equal(reports[2].status, 422);
  const fallback = environment();
  let fallbackBody;
  fallback.context.navigator.sendBeacon = () => false;
  fallback.context.fetch = (_url, init) => { fallbackBody = JSON.parse(init.body); return Promise.resolve({ ok: true }); };
  vm.runInContext(script('snippets/apgo-error-monitor.liquid').replace(/\{\{[\s\S]*?\}\}/g, '4'), fallback.context);
  fallback.context.apgoReportCartError({ message: marker, action: 'add', stage: 'network', url: loc.href });
  noSensitive(fallbackBody);
  assert.equal(fallbackBody.src, '/cart');

  // Exercise the actual campaign click listener, not a copy of publish().
  const campaign = environment();
  const documentEvents = {};
  const root = { getAttribute: key => ({ 'data-campaign-id': '11-11', 'data-market': 'MY', 'data-currency': 'MYR' })[key], setAttribute: () => {}, querySelectorAll: () => [] };
  campaign.context.document = { readyState: 'complete', referrer: `https://store.invalid/account?email=${email}`, hidden: false, querySelectorAll: () => [], querySelector: selector => selector === '[data-apgo-campaign-root]' ? root : null, addEventListener: (name, listener) => { documentEvents[name] = listener; }, documentElement: { scrollHeight: 900 } };
  campaign.context.setInterval = () => 1;
  campaign.context.clearInterval = () => {};
  campaign.context.innerHeight = 800;
  campaign.context.scrollY = 0;
  vm.runInContext(read('assets/apgo-campaign-tracking.js'), campaign.context);
  assert.ok(campaign.ga.some(event => event.name === 'apgo_campaign_view'));
  noSensitive(campaign.ga);
  noSensitive(campaign.analytics);
  assert.equal(campaign.ga[0].data.page_location, '/cart');
  assert.equal(campaign.ga[0].data.page_referrer, '/account');

  const video = environment();
  const videoSource = read('snippets/apgo-inview-video.liquid').match(/\{% javascript %\}([\s\S]*?)\{% endjavascript %\}/)[1];
  const videoPublish = videoSource.slice(videoSource.indexOf('function publish('), videoSource.indexOf('// Furthest step'));
  vm.runInContext(videoPublish, video.context);
  video.context.publish({ duration: 12, closest: () => ({ dataset: { videoId: 'demo-video', productId: '15466747920538', productHandle: 'interior-set', productTitle: email } }) }, 'apgo_video_view', { url: loc.href, elapsed_seconds: 3 });
  assert.equal(video.ga.length, 1);
  noSensitive(video.ga);
  noSensitive(video.analytics);
  assert.equal(video.ga[0].data.elapsed_seconds, 3);

  const liquid = new Liquid({ root: path.join(ROOT, 'snippets'), extname: '.liquid' });
  const malicious = '</textarea><img src=x onerror=alert(1)>';
  const note = await liquid.parseAndRender(read('snippets/cart-note.liquid'), { cart: { note: malicious } });
  assert.ok(!note.includes(malicious));
  assert.ok(note.includes('&lt;/textarea&gt;'));
  for (const file of ['contact-form', 'blog-comment-form']) {
    const source = read(`snippets/${file}.liquid`);
    const form = { name: malicious, author: malicious, email: malicious, phone: malicious, body: malicious };
    const fields = [...source.matchAll(/value="[^"]*\bform\.[^\n]+?"|<textarea[\s\S]*?<\/textarea>/g)];
    assert.ok(fields.length >= 3);
    for (const [field] of fields) {
      const html = await liquid.parseAndRender(field, { form });
      assert.ok(!html.includes(malicious), `${file}: unsafe customer value`);
      assert.ok(html.includes('&lt;'), `${file}: fixture was not rendered`);
    }
  }
  const context = { shop: { permanent_domain: 'store.myshopify.com' }, request: { host: 'store.invalid' } };
  // LiquidJS does not implement Shopify's documentation-only `doc` tag.
  const propertyTemplate = read('snippets/apgo-cart-property.liquid').replace(/\{%-?\s*doc\s*-?%\}[\s\S]*?\{%-?\s*enddoc\s*-?%\}/g, '');
  const renderProperty = (name, value) => liquid.parseAndRender(propertyTemplate, { ...context, name, value });
  const prop = await renderProperty('<svg onload=alert(1)>', malicious);
  assert.ok(!prop.includes('<img') && !prop.includes('<svg'));
  const allowed = await renderProperty('Upload', 'https://cdn.shopify.com/s/files/1/uploads/photo.png');
  assert.ok(allowed.includes('<a href="https://cdn.shopify.com/'));
  for (const url of ['javascript:alert(1)//uploads/x', '//evil.invalid/uploads/x', 'https://cdn.shopify.com.evil.invalid/uploads/x', 'https://cdn.shopify.com@evil.invalid/uploads/x', 'https://evil.invalid/uploads/x', 'https://evil.invalid/#https://cdn.shopify.com/uploads/x']) {
    assert.ok(!(await renderProperty('Upload', url)).includes('<a '), `Unsafe link accepted: ${url}`);
  }
  const cartSource = read('snippets/cart-products.liquid');
  const imageStart = cartSource.indexOf('{%- liquid', cartSource.indexOf('class="cart-items__media"'));
  const imageEnd = cartSource.indexOf('-%}', imageStart) + 3;
  const imageTemplate = cartSource.slice(imageStart, imageEnd) + '{{ apgo_offer_img }}';
  const renderImage = url => liquid.parseAndRender(imageTemplate, { ...context, localization: { country: { iso_code: 'MY' } }, item: { properties: { _apgo_offer_image: url } } });
  assert.equal((await renderImage('//store.invalid/cdn/shop/files/pwp.jpg')).trim(), 'https://store.invalid/cdn/shop/files/pwp.jpg');
  assert.equal((await renderImage('https://evil.invalid/cdn/shop/files/pwp.jpg')).trim(), '');
  assert.equal((await renderImage('https://store.invalid@evil.invalid/cdn/shop/files/pwp.jpg')).trim(), '');
  for (const file of ['Store-Pickup-Modal', 'invoice-selector', 'cvs-selector']) assert.ok(!fs.existsSync(path.join(ROOT, 'sections', file + '.liquid')));
  console.log('PASS: telemetry privacy, error reports, campaign analytics, cart output encoding, upload URL validation, and legacy section removal.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
