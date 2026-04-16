/**
 * 測量 collection-links 與 marquee 的 .shopify-section 高度，
 * 寫入 CSS 變數供後續 sticky 的 top 與 scroll-margin-top 使用。
 *
 *   --apgo-subnav-h   : collection-links section 高度（給 marquee 的 top 用）
 *   --apgo-marquee-h  : marquee section 高度（給 scroll-margin-top 用）
 */
(() => {
  if (window.__apgoStickyStack) return;
  window.__apgoStickyStack = true;

  const SUBNAV_VAR  = '--apgo-subnav-h';
  const MARQUEE_VAR = '--apgo-marquee-h';

  function sync() {
    const root = document.documentElement;

    const subnav  = document.querySelector('.shopify-section:has(collection-links-component)');
    const marquee = document.querySelector('.shopify-section:has(marquee-component)');

    root.style.setProperty(SUBNAV_VAR,  subnav  ? `${Math.ceil(subnav.getBoundingClientRect().height)}px`  : '0px');
    root.style.setProperty(MARQUEE_VAR, marquee ? `${Math.ceil(marquee.getBoundingClientRect().height)}px` : '0px');
  }

  function debounce(fn, ms) {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function start() {
    sync();
    window.addEventListener('resize', debounce(sync, 120));

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => sync());
      document.querySelectorAll(
        '.shopify-section:has(collection-links-component), .shopify-section:has(marquee-component)'
      ).forEach(el => ro.observe(el));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
