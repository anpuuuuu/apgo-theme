// Warehouse clearance bundles' description videos, on the real product pages
// (snippets/apgo-inview-video.liquid): HLS first then the 720p mp4, nothing
// downloads before the page has loaded or while the video is off screen, it
// then plays muted, and every tracking step fires once and marks the cart
// (attribute apgo_video_watched). Read-only for the store: a test cart in a
// throwaway session.
//   THEME_ID=188964503706 node bundle-video.js
const { url, open, sleep, cart } = require('./lib');

const PAGES = [
  { handle: 'warehouse-clearance-sale-bundle', country: 'MY' },
  { handle: 'warehouse-clearance-sale-bundle-sg', country: 'SG' },
];

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '：' + detail : ''}`); };

const video = (page, fn) => page.evaluate((f) => {
  const v = document.querySelector('[data-apgo-inview-video] video');
  return new Function('v', f)(v);
}, fn);

(async () => {
  for (const p of PAGES) {
    for (const device of ['iphone15-safari', 'desktop-chrome']) {
      console.log(`\n${p.country} ${p.handle} · ${device}`);
      const { browser, page } = await open(device);
      // Every event the snippet publishes, from the start.
      await page.addInitScript(() => {
        window.__apgoPub = [];
        const hook = setInterval(() => {
          const an = window.Shopify && Shopify.analytics;
          if (!an || !an.publish || an.__apgoHooked) return;
          const orig = an.publish.bind(an);
          an.publish = (name, data) => {
            if (String(name).startsWith('apgo_video')) window.__apgoPub.push(name);
            return orig(name, data);
          };
          an.__apgoHooked = true;
          clearInterval(hook);
        }, 20);
      });
      await page.goto(url('/', { country: p.country }), { waitUntil: 'load', timeout: 60000 });

      let loadedAt = null;
      let firstVideoAt = null;
      page.on('request', (r) => { if (r.url().includes('/videos/c/vp/') && firstVideoAt === null) firstVideoAt = Date.now(); });
      page.once('load', () => { loadedAt = Date.now(); });
      await page.goto(url(`/products/${p.handle}`, { country: p.country }), { waitUntil: 'load', timeout: 60000 });
      await sleep(3000);

      const first = await video(page, `
        const box = v && v.closest('[data-apgo-inview-video]');
        if (!v) return null;
        const r = v.getBoundingClientRect();
        return {
          sources: [...v.querySelectorAll('source')].map((s) => s.type + ' ' + (s.dataset.src || s.src).split('/').pop().split('?')[0]),
          poster: ((v.getAttribute('poster') || '').match(/width=(\\d+)/) || [])[1],
          handle: box.dataset.productHandle,
          inFirstScreen: Math.min(r.bottom, innerHeight) - Math.max(r.top, 0) >= Math.min(r.height, innerHeight) / 2,
          paused: v.paused,
        };`);
      if (!first) { check('页面上有影片', false); await browser.close(); continue; }
      check('来源：HLS、720p、1080p 依序', /x-mpegURL/i.test(first.sources[0] || '') && /720p/.test(first.sources[1] || '') && /1080p/.test(first.sources[2] || ''), first.sources.map((s) => s.split(' ')[1].replace(/^\w+\./, '')).join(' → '));
      check('封面图 1280 宽', first.poster === '1280', first.poster);
      check('页面载入完成前不下载影片', firstVideoAt === null || (loadedAt !== null && firstVideoAt >= loadedAt), firstVideoAt === null ? '还没下载' : `载入完成后 ${firstVideoAt - loadedAt}ms 才开始`);
      if (first.inFirstScreen) {
        check('影片在第一屏：载入后自动播', !first.paused, '第一屏就看得到一半以上');
      } else {
        check('影片不在第一屏：捲到之前不下载', firstVideoAt === null, firstVideoAt === null ? '0 次' : '有下载');
        await video(page, `v.scrollIntoView({ block: 'center' });`);
      }

      // Play on until 10 seconds have been watched.
      let pub = [];
      for (let i = 0; i < 25 && !pub.includes('apgo_video_10s'); i++) {
        await sleep(1000);
        pub = await page.evaluate(() => window.__apgoPub);
      }
      let s = await video(page, `return { paused: v.paused, t: Math.round(v.currentTime), src: v.currentSrc.split('/').pop().split('?')[0] };`);
      check('自动播放（静音）', !s.paused, `用 ${s.src}`);
      check('3 秒、10 秒事件', pub.includes('apgo_video_view') && pub.includes('apgo_video_10s'), pub.join(' ') || '没有事件');
      check('自动播放不算「自己按播放」', !pub.includes('apgo_video_play_click'), '');

      await video(page, `v.currentTime = v.duration * 0.55;`);
      await sleep(3000);
      await video(page, `v.currentTime = Math.max(0, v.duration - 1);`);
      for (let i = 0; i < 12 && !pub.includes('apgo_video_complete'); i++) {
        await sleep(1000);
        pub = await page.evaluate(() => window.__apgoPub);
      }
      await sleep(2000);
      s = await video(page, `return { t: Math.round(v.currentTime), paused: v.paused };`);
      check('看到一半、看完事件', pub.includes('apgo_video_half') && pub.includes('apgo_video_complete'), pub.join(' '));
      check('看完自动从头播', !s.paused && s.t < 15, `现在 ${s.t}s`);

      await video(page, `v.muted = false; v.volume = 1;`);
      await video(page, `v.pause();`);
      await sleep(500);
      await video(page, `v.play();`);
      await sleep(1000);
      pub = await page.evaluate(() => window.__apgoPub);
      check('开声音、自己按播放事件', pub.includes('apgo_video_sound_on') && pub.includes('apgo_video_play_click'), '');
      const counts = pub.reduce((m, e) => { m[e] = (m[e] || 0) + 1; return m; }, {});
      check('每个事件只送一次', Object.values(counts).every((n) => n === 1), JSON.stringify(counts));

      await sleep(1500);
      const c = await cart(page);
      const watched = (c.attributes || {}).apgo_video_watched || '';
      check('购物车记下看到最远的一步', watched.split(',').includes(`${first.handle}=complete`), watched || '（没有）');
      await browser.close();
    }
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})();
