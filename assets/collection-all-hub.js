/**
 * All-catalog hub: smooth in-page nav + IntersectionObserver scrollspy
 * for headings `h2.apgo-catalog-heading[id^="collection-"]` and
 * `.collection-links--catalog-hub .collection-links__link[href*="#collection-"]`.
 */
(() => {
  const hubRoot = document.querySelector('.apgo-all-catalog-root');
  const navSection = document.querySelector('.collection-links--catalog-hub');
  if (!hubRoot || !navSection) return;

  document.documentElement.classList.add('apgo-catalog-hub-smooth-scroll');

  const links = [...navSection.querySelectorAll('.collection-links__link[href*="#collection-"]')];
  const headings = [...document.querySelectorAll('h2.apgo-catalog-heading[id^="collection-"]')];
  if (!links.length || !headings.length) return;

  /** @param {string | null} headingId */
  function setActiveHeading(headingId) {
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const hash = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
      const match = hash === headingId;
      a.classList.toggle('collection-links__link--scroll-active', match);
      if (match) {
        a.setAttribute('aria-current', 'true');
      } else {
        a.removeAttribute('aria-current');
      }
    }
  }

  /** Sticky bar height for rootMargin */
  function stickyInsetPx() {
    const navEl = navSection.closest('.section') || navSection;
    const h = Math.ceil(navEl.getBoundingClientRect().height);
    return Math.min(Math.max(h + 24, 96), 220);
  }

  let observer;

  function bindObserver() {
    if (observer) observer.disconnect();
    const inset = stickyInsetPx();
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
