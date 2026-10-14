// Warehouse clearance bundles' description videos, on the real product pages
// (snippets/apgo-inview-video.liquid): HLS first then the 720p mp4, nothing
// downloads before the video is on screen, it then plays muted, and every
// tracking step fires once and marks the cart (attribute apgo_video_watched).
// Read-only for the store: a test cart in a throwaway session.
//   THEME_ID=188964503706 node bundle-video.js
const { url, open, sleep, cart } = require('./lib');

const PAGES = [
  { handle: 'warehouse-clearance-sale-bundle', country: 'MY' },
  { handle: 'warehouse-clearance-sale-bundle-sg', country: 'SG' },
];

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '：' + detail : ''}`); };

const video = (page, fn, arg) => page.evaluate(([f, a]) => {
  const v = document.querySelector('[data-apgo-inview-video] video');
  return new Function('v', 'a', f)(v, a);
}, [fn, arg]);

(async () => {
  for (const p of PAGES) {
    for (const device of ['iphone15-safari', 'desktop-chrome']) {
      console.log(`\n${p.country} ${p.handle} · ${device}`);
      const { browser, page } = await open(device);
      const fetched = [];
      page.on('request', (r) => { if (r.url().includes('/videos/c/vp/')) fetched.push(r.url().split('/').pop().split('?')[0]); });
      await page.goto(url('/', { country: p.country }), { waitUntil: 'load', timeout: 60000 });
      await page.goto(url(`/products/${p.handle}`, { country: p.country }), { waitUntil: 'load', timeout: 60000 });
      await sleep(4000);

      const markup = await video(page, `
        const box = v && v.closest('[data-apgo-inview-video]');
        return v && {
          sources: [...v.querySelectorAll('source')].map((s) => s.type + ' ' + (s.dataset.src || s.src).split('/').pop().split('?')[0]),
          poster: ((v.getAttribute('poster') || '').match(/width=(\\d+)/) || [])[1],
          handle: box.dataset.productHandle,
        };`);
      if (!markup) { check('页面上有影片', false); await browser.close(); continue; }
      check('来源：HLS 在前、720p mp4 备用', /x-mpegURL/i.test(markup.sources[0] || '') && /720p/.test(markup.sources[1] || ''), markup.sources.join(' | '));
      check('封面图 1280 宽', markup.poster === '1280', markup.poster);
      check('没捲到之前不下载影片', fetched.length === 0, fetched.length ? fetched.join(', ') : '0 次');

      await video(page, `
        window.__apgoPub = [];
        const a = window.Shopify && Shopify.analytics;
        if (a && a.publish) {
          const orig = a.publish.bind(a);
          a.publish = (name, data) => { window.__apgoPub.push(name + (data && data.watched_seconds !== undefined ? '(' + data.watched_seconds + 's)' : '')); return orig(name, data); };
        }
        v.scrollIntoView({ block: 'center' });`);
      await sleep(13000);
      let s = await video(page, `return { paused: v.paused, t: Math.round(v.currentTime), src: v.currentSrc.split('/').pop().split('?')[0], pub: window.__apgoPub };`);
      check('捲到后自动播', !s.paused && s.t >= 8, `播到 ${s.t}s，用 ${s.src}`);
      check('3 秒、10 秒事件', s.pub.some((e) => e.startsWith('apgo_video_view')) && s.pub.some((e) => e.startsWith('apgo_video_10s')), s.pub.join(' ') || '没有事件');
      check('自动播放不算「自己按播放」', !s.pub.includes('apgo_video_play_click'), '');

      await video(page, `v.currentTime = v.duration * 0.55;`);
      await sleep(3000);
      await video(page, `v.currentTime = Math.max(0, v.duration - 1);`);
      let done = false;
      for (let i = 0; i < 10 && !done; i++) {
        await sleep(1000);
        done = (await video(page, `return window.__apgoPub;`)).includes('apgo_video_complete');
      }
      s = await video(page, `return { pub: window.__apgoPub, t: Math.round(v.currentTime), paused: v.paused };`);
      check('看到一半、看完事件', s.pub.includes('apgo_video_half') && s.pub.includes('apgo_video_complete'), s.pub.join(' '));
      check('看完自动从头播', !s.paused && s.t < 8, `现在 ${s.t}s`);

      await video(page, `v.muted = false; v.volume = 1;`);
      await video(page, `v.pause();`);
      await sleep(500);
      await video(page, `v.play();`);
      await sleep(1000);
      s = await video(page, `return { pub: window.__apgoPub };`);
      check('开声音、自己按播放事件', s.pub.includes('apgo_video_sound_on') && s.pub.includes('apgo_video_play_click'), '');
      const counts = s.pub.reduce((m, e) => { const k = e.replace(/\(.*/, ''); m[k] = (m[k] || 0) + 1; return m; }, {});
      check('每个事件只送一次', Object.values(counts).every((n) => n === 1), JSON.stringify(counts));

      await sleep(1500);
      const c = await cart(page);
      const watched = (c.attributes || {}).apgo_video_watched || '';
      check('购物车记下看到最远的一步', watched.split(',').includes(`${markup.handle}=complete`), watched || '（没有）');
      await browser.close();
    }
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})();
