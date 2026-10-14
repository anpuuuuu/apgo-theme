// Description video that plays by itself while on screen (cb6e059,
// snippets/apgo-inview-video.liquid). Puts a Shopify-hosted video far down a
// page that loads the snippet scripts (the cart page), marked up the way the
// snippet renders it, and checks: nothing downloads before it is on screen,
// it plays muted once there, pauses when scrolled away, resumes on return,
// stays paused after the shopper pauses it, and starts over at the end.
//   THEME_ID=188964503706 node inview-video.js
const { url, open, sleep } = require('./lib');

const VID = '541938d8b01041669ab075ec30abb1c6'; // a looping video already on the store
const BASE_V = `//apgo.my/cdn/shop/videos/c/vp/${VID}/${VID}`;

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '：' + detail : ''}`); };

(async () => {
  for (const device of ['iphone15-safari', 'desktop-chrome']) {
    console.log(`\n${device}`);
    const { browser, context, page } = await open(device);
    // Shopify only runs a snippet's {% javascript %} on pages that render the
    // snippet (the #snippets-script data-snippets list); add ours to the cart.
    await context.route(/\/cart(\?|$)/, async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const resp = await route.fetch();
      route.fulfill({ response: resp, body: (await resp.text()).replace('data-snippets="', 'data-snippets="apgo-inview-video,') });
    });
    let videoRequests = 0;
    page.on('request', (r) => { if (r.url().includes('/videos/c/vp/')) videoRequests++; });
    await page.goto(url('/cart'), { waitUntil: 'load', timeout: 60000 });
    await sleep(1500);
    await page.evaluate((base) => {
      const spacer = document.createElement('div');
      spacer.style.height = '3000px';
      const wrap = document.createElement('div');
      wrap.className = 'apgo-inview-video';
      wrap.setAttribute('data-apgo-inview-video', '');
      // The store's test video is portrait (9:16): at full width it is far
      // taller than the screen, the case the snippet caps at 85% of it.
      wrap.style.setProperty('--apgo-video-ratio', '0.5625');
      wrap.innerHTML = `<video controls muted playsinline preload="none" style="width:100%">
        <source src="${base}.m3u8?v=0" type="application/x-mpegURL">
        <source src="${base}.HD-1080p-7.2Mbps-89377407.mp4?v=0" type="video/mp4"></video>`;
      const after = document.createElement('div');
      after.style.height = '3000px';
      document.body.append(spacer, wrap, after);
      document.dispatchEvent(new Event('shopify:section:load'));
    }, BASE_V);
    const state = () => page.evaluate(() => {
      const v = document.querySelector('[data-apgo-inview-video] video');
      return { paused: v.paused, t: Math.round(v.currentTime * 10) / 10, muted: v.muted, watched: v.dataset.apgoInview === '1', src: (v.currentSrc || '').split('/').pop().split('?')[0] };
    });
    const scrollTo = (where) => page.evaluate((w) => {
      const v = document.querySelector('[data-apgo-inview-video] video');
      if (w === 'video') v.scrollIntoView({ block: 'center' });
      else window.scrollTo(0, 0);
    }, where);

    await sleep(2000);
    let s = await state();
    check('JS 有接手这支影片', s.watched);
    check('不在画面上时不播、不下载', s.paused && videoRequests === 0, `paused=${s.paused}，影片请求 ${videoRequests} 次`);

    await scrollTo('video');
    await sleep(4000);
    s = await state();
    check('捲到画面上自动播（静音）', !s.paused && s.t > 0 && s.muted, `播到 ${s.t}s，muted=${s.muted}，来源 ${s.src}`);

    await scrollTo('top');
    await sleep(1200);
    s = await state();
    check('捲走就暂停', s.paused, `paused=${s.paused}`);

    await scrollTo('video');
    await sleep(2000);
    s = await state();
    check('捲回来继续播', !s.paused, `播到 ${s.t}s`);

    await page.evaluate(() => document.querySelector('[data-apgo-inview-video] video').pause());
    await scrollTo('top');
    await sleep(800);
    await scrollTo('video');
    await sleep(2000);
    s = await state();
    check('顾客自己按暂停后，捲回来仍然暂停', s.paused, `paused=${s.paused}`);

    await page.evaluate(async () => {
      const v = document.querySelector('[data-apgo-inview-video] video');
      await v.play();
      v.currentTime = Math.max(0, v.duration - 0.6);
    });
    await sleep(3000);
    s = await state();
    check('播完自动从头开始', !s.paused && s.t < 3, `现在 ${s.t}s`);
    await browser.close();
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})();
