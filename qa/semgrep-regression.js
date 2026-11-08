// Offline checks for the boundaries reviewed in the 2026-11-08 Semgrep triage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');

async function run() {
  const registry = new Map();
  class HTMLElement {}
  class Component extends HTMLElement {
    refs = {};
    getAttribute() { return true; }
  }
  const context = {
    Component, HTMLElement, AbortController, URL,
    customElements: { get: name => registry.get(name), define: (name, component) => registry.set(name, component) },
  };
  const mediaSource = fs.readFileSync(path.join(ROOT, 'assets/media.js'), 'utf8').replace(/^import .+;\r?\n/gm, '');
  vm.runInNewContext(mediaSource, context);
  const Media = registry.get('deferred-media');
  assert.ok(Media);
  for (const [type, src, origin] of [
    ['youtube', 'https://www.youtube.com/embed/test?enablejsapi=1', 'https://www.youtube.com'],
    ['youtube', 'https://youtube.com/embed/test', 'https://youtube.com'],
    ['youtube', 'https://www.youtube-nocookie.com/embed/test', 'https://www.youtube-nocookie.com'],
    ['youtube', 'https://youtube-nocookie.com/embed/test', 'https://youtube-nocookie.com'],
    ['vimeo', 'https://player.vimeo.com/video/123?api=1', 'https://player.vimeo.com'],
  ]) {
    const calls = [];
    const frame = { src, dataset: { videoType: type }, contentWindow: { postMessage: (message, target) => calls.push([JSON.parse(message), target]) } };
    const media = new Media();
    media.querySelector = () => frame;
    media.playMedia();
    media.pauseMedia();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(call => call[1]), [origin, origin]);
    assert.deepEqual(calls.map(call => type === 'youtube' ? call[0].func : call[0].method), type === 'youtube' ? ['playVideo', 'pauseVideo'] : ['play', 'pause']);
  }
  for (const [type, src] of [
    ['youtube', 'https://www.youtube.com.evil.invalid/embed/test'],
    ['youtube', 'https://www.youtube.com@evil.invalid/embed/test'],
    ['youtube', 'https://evil.invalid@www.youtube.com/embed/test'],
    ['youtube', 'http://www.youtube.com/embed/test'],
    ['youtube', 'https://www.youtube.com:444/embed/test'],
    ['youtube', 'https://player.vimeo.com/video/123'],
    ['vimeo', 'https://www.youtube.com/embed/test'],
    ['other', 'https://player.vimeo.com/video/123'],
    ['youtube', 'javascript:alert(1)'],
    ['youtube', 'not a URL'],
  ]) {
    const media = new Media();
    media.querySelector = () => ({ src, dataset: { videoType: type }, contentWindow: { postMessage: () => assert.fail('Untrusted player received a message') } });
    media.playMedia();
    media.pauseMedia();
  }
  const media = new Media();
  let plays = 0, pauses = 0;
  media.querySelector = selector => selector === 'video' ? { play: () => plays++, pause: () => pauses++ } : null;
  media.playMedia();
  media.pauseMedia();
  assert.equal(plays, 1);
  assert.equal(pauses, 1);
  assert.equal(media.isPlaying, false);

  for (const file of ['aurora-pwp.js', 'cart-row-removal.js']) {
    const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const source = code.slice(code.indexOf('const source'), code.indexOf('\n};', code.indexOf('const source')) + 3);
    const read = vm.runInNewContext(source + '\nsource;', { fs, path, ROOT, baseline: false });
    assert.ok(read('qa/package.json').includes('apgo-my-qa'));
    for (const target of ['..', path.dirname(ROOT)]) assert.throws(() => read(target), /Fixture path escapes repository/);
  }

  const { cartPost } = require('./lib');
  let evaluations = 0;
  const page = { evaluate: async (fn, args) => {
    evaluations++;
    assert.equal(typeof fn, 'function');
    return vm.runInNewContext('(' + fn.toString() + ')(args)', {
      args: JSON.parse(JSON.stringify(args)),
      fetch: async (endpoint, init) => {
        assert.ok(['/cart/add.js', '/cart/change.js', '/cart/update.js'].includes(endpoint));
        assert.equal(init.method, 'POST');
        assert.equal(JSON.parse(init.body).note, '</script><script>throw 1</script>');
        return { status: 200 };
      },
    });
  } };
  for (const endpoint of ['/cart/add.js', '/cart/change.js', '/cart/update.js']) assert.equal(await cartPost(page, endpoint, { note: '</script><script>throw 1</script>' }), 200);
  for (const endpoint of ['https://evil.invalid', '//evil.invalid', '/cart/add.js?redirect=evil', '/cart/../account', 'javascript:alert(1)']) await assert.rejects(cartPost(page, endpoint, {}), /Unsupported cart endpoint/);
  assert.equal(evaluations, 3);
  console.log('PASS: exact video message origins, untrusted frame rejection, native video controls, fixture path confinement, and serialized cart requests.');
}

module.exports = run;
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
