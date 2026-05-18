/* APGO — Scroll-up reveal for the header + marquee stack
 *
 * Replaces the always-pinned sticky behaviour with auto-hide:
 *  - Scrolling DOWN the page → header-group + marquee slide up out of view
 *  - Scrolling UP → they slide back down into view
 *  - Near the top of the page (< topZone) they always stay visible
 *
 * Mechanism: keeps position: sticky on both elements so they don't leave the
 * normal flow, then applies a CSS transform driven by a `apgo-scroll-hide`
 * class on <body>. CSS handles the transition + sliding distance via a
 * --apgo-stack-h variable computed from the live stack height.
 *
 * Side-effects we intentionally don't touch:
 *  - PDP tab bar's sticky top stays anchored at --apgo-pdp-tabs-sticky-top.
 *    When the header+marquee hide, a small gap appears above the tab bar.
 *    When they slide back in, the gap fills. Acceptable visual; no jump.
 *  - Anything that already reads --header-group-height for its own offsets
 *    continues to read the real (visual) stack height — transforms don't
 *    change getBoundingClientRect on the original sticky position.
 */
(function () {
  'use strict';

  var TOP_ZONE = 80;        // px from page top — always visible inside this
  var MOVE_THRESHOLD = 8;   // px — ignore micro scroll wiggles
  var lastY = window.scrollY;
  var ticking = false;

  function updateStackH() {
    var hg = document.getElementById('header-group');
    var marquee = document.getElementById('shopify-section-free-shipping-popup');
    /* getBoundingClientRect().height honours display:none (returns 0), and
       gives sub-pixel precision so the slide-out lands cleanly. */
    var h = (hg ? hg.getBoundingClientRect().height : 0) +
            (marquee ? marquee.getBoundingClientRect().height : 0);
    document.body.style.setProperty('--apgo-stack-h', h + 'px');
  }
  updateStackH();
  window.addEventListener('resize', updateStackH);
  /* Marquee can change height when a market promo blurb appears/hides, or
     when the user switches locale. Watch it. */
  if (window.ResizeObserver) {
    var hg = document.getElementById('header-group');
    var marquee = document.getElementById('shopify-section-free-shipping-popup');
    var ro = new ResizeObserver(updateStackH);
    if (hg) ro.observe(hg);
    if (marquee) ro.observe(marquee);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = window.scrollY < 0 ? 0 : window.scrollY;
      var dy = y - lastY;
      lastY = y;
      /* Top of the page → always reveal so the user doesn't land on a hidden header */
      if (y < TOP_ZONE) {
        document.body.classList.remove('apgo-scroll-hide');
        return;
      }
      /* Ignore micro / inertia wiggles below threshold */
      if (Math.abs(dy) < MOVE_THRESHOLD) return;
      /* dy > 0 → scrolling down (content moves up) → HIDE the stack
         dy < 0 → scrolling up → SHOW the stack */
      document.body.classList.toggle('apgo-scroll-hide', dy > 0);
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
})();
