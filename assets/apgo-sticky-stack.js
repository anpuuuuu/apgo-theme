/**
 * 供跑馬燈等「黏在 header 下方的 sticky」使用：量測 .collection-links__sticky-wrap 高度，
 * 寫入 --apgo-sticky-stack-subnav，讓下一段 sticky 的 top 可疊在次選單底下。
 */
(() => {
  if (window.__apgoStickyStackInit) return;
  window.__apgoStickyStackInit = true;

  const VAR = '--apgo-sticky-stack-subnav';

  function sync() {
    const el = document.querySelector('.collection-links__sticky-wrap');
    const h = el ? Math.ceil(el.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty(VAR, `${h}px`);
  }

  function debounce(fn, ms) {
    let t;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function start() {
    sync();
    window.addEventListener('resize', debounce(sync, 120));
    const el = document.querySelector('.collection-links__sticky-wrap');
    if (el && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => sync()).observe(el);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
