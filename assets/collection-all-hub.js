/**
 * All-catalog hub: smooth in-page nav + IntersectionObserver scrollspy
 * for headings `h2.apgo-catalog-heading[id^="collection-"]` and
 * `.collection-links--catalog-hub` 或 `[data-apgo-hub-nav]` 內的 `a[href*="#collection-"]`。
 */
(() => {
  const hubRoot = document.querySelector('.apgo-all-catalog-root');
  /** 舊版：collection-links 區塊；新版：header 內 AI Secondary menu（data-apgo-hub-nav） */
  const hubNavRoot =
    document.querySelector('.collection-links--catalog-hub') || document.querySelector('[data-apgo-hub-nav]');
  if (!hubRoot || !hubNavRoot) return;

  document.documentElement.classList.add('apgo-catalog-hub-smooth-scroll');

  const links = [...hubNavRoot.querySelectorAll('a[href*="#collection-"]')];
  const headings = [...document.querySelectorAll('h2.apgo-catalog-heading[id^="collection-"]')];
  if (!links.length || !headings.length) return;

  let lastActiveHeadingId = null;

  /** 次選單區 + header 高度，供 IntersectionObserver rootMargin */
  function anchorZoneTopPx() {
    const header = document.querySelector('#header-group');
    const navEl = hubNavRoot.closest('.section') || hubNavRoot;
    const headerH = header ? Math.ceil(header.getBoundingClientRect().height) : 60;
    const navH = Math.ceil(navEl.getBoundingClientRect().height) || 48;
    return Math.min(headerH + navH + 16, 280);
  }

  /**
   * 將目前高亮項捲進橫向選單可視區。
   * 手機 (<=749px)：將當前項固定貼齊左緣，讓使用者一眼看到正在瀏覽的分類名稱（類似區塊標題）。
   * 桌機：維持「僅當超出可視區才捲動」。
   * 用 getBoundingClientRect 相對於捲動容器換算 scrollLeft，避免 <a> 的 offsetLeft 相對錯誤父層導致手機不捲動。
   */
  function scrollActiveLinkIntoMenu(/** @type {HTMLAnchorElement | null} */ activeLink) {
    if (!activeLink) return;
    const scroller =
      activeLink.closest('.collection-links__container') || activeLink.closest('[data-apgo-hub-nav-scroll]');
    if (!scroller) {
      activeLink.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      return;
    }
    const pad = 8;
    const linkRect = activeLink.getBoundingClientRect();
    const scrRect = scroller.getBoundingClientRect();
    const linkLeft = linkRect.left - scrRect.left + scroller.scrollLeft;
    const linkRight = linkLeft + linkRect.width;
    const vL = scroller.scrollLeft;
    const vR = vL + scroller.clientWidth;
    const isMobile = window.matchMedia('(max-width: 749px)').matches;
    if (isMobile) {
      const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const target = Math.min(Math.max(0, linkLeft - pad), maxScroll);
      if (Math.abs(scroller.scrollLeft - target) > 1) {
        scroller.scrollTo({ left: target, behavior: 'smooth' });
      }
      return;
    }
    if (linkLeft < vL + pad) {
      scroller.scrollTo({ left: Math.max(0, linkLeft - pad), behavior: 'smooth' });
    } else if (linkRight > vR - pad) {
      scroller.scrollTo({ left: linkRight - scroller.clientWidth + pad, behavior: 'smooth' });
    }
  }

  /** @param {string | null} headingId */
  function setActiveHeading(headingId) {
    /* null 仍須清除高亮，不可與 last null 一律略過 */
    if (headingId != null && headingId === lastActiveHeadingId) return;
    lastActiveHeadingId = headingId;

    /** @type {HTMLAnchorElement | null} */
    let activeLink = null;
    for (const a of links) {
      const el = /** @type {HTMLAnchorElement} */ (a);
      const href = el.getAttribute('href') || '';
      const hash = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
      const match = hash === headingId;
      el.classList.toggle('apgo-catalog-hub-link--active', match);
      if (match) {
        el.setAttribute('aria-current', 'true');
        activeLink = el;
      } else {
        el.removeAttribute('aria-current');
      }
    }
    if (activeLink) {
      requestAnimationFrame(() => scrollActiveLinkIntoMenu(activeLink));
    }
  }

  let observer;

  function bindObserver() {
    if (observer) observer.disconnect();
    const inset = anchorZoneTopPx();
    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (!visible.length) return;
        visible.sort((a, b) => a.target.getBoundingClientRect().top - b.target.getBoundingClientRect().top);
        const id = visible[0].target.id;
        if (id) setActiveHeading(id);
      },
      {
        root: null,
        rootMargin: `-${inset}px 0px -55% 0px`,
        threshold: [0, 0.01, 0.05, 0.1],
      }
    );
    for (const h of headings) observer.observe(h);
  }

  bindObserver();
  window.addEventListener('resize', () => {
    clearTimeout(window.__apgoHubNavResizeT);
    window.__apgoHubNavResizeT = setTimeout(bindObserver, 150);
  });

  const hash = window.location.hash?.slice(1);
  if (hash && document.getElementById(hash)) {
    requestAnimationFrame(() => setActiveHeading(hash));
  } else {
    setActiveHeading(headings[0]?.id || null);
  }

  window.addEventListener('hashchange', () => {
    const id = window.location.hash?.slice(1);
    if (id && document.getElementById(id)) setActiveHeading(id);
  });
})();
