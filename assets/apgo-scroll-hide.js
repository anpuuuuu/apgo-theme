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
    /*
      #header-group is `display: contents` when the header is sticky, so its
      own getBoundingClientRect returns 0×0 (no box). Sum the heights of its
      direct .shopify-section children (the actual header shell + the
      optional _blocks/secondary-menu shell), then add the marquee.
    */
    var hgH = 0;
    document.querySelectorAll('#header-group > .shopify-section').forEach(function (el) {
      hgH += el.getBoundingClientRect().height;
    });
    var marquee = document.getElementById('shopify-section-free-shipping-popup');
    var marqueeH = marquee ? marquee.getBoundingClientRect().height : 0;
    document.body.style.setProperty('--apgo-stack-h', (hgH + marqueeH) + 'px');
  }
  updateStackH();
  window.addEventListener('resize', updateStackH);
  /*
    Marquee + secondary-menu shells can change height when a market promo
    blurb appears/hides, the user switches locale, or the page navigates to
    /collections/all (secondary menu becomes visible). Observe everything.
  */
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(updateStackH);
    document.querySelectorAll('#header-group > .shopify-section').forEach(function (el) {
      ro.observe(el);
    });
    var marquee = document.getElementById('shopify-section-free-shipping-popup');
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

  /*
    Aurora campaign reconciliation:
    the campaign page applies the additional 14-set adjustment in Liquid.
    This shared asset is already loaded by the v3 product page, so mirror
    that adjustment in the compact product counter without touching stock.
  */
  function adjustAuroraCampaignCounter() {
    var normalizedPath = window.location.pathname.replace(/\/+$/, '');
    if (normalizedPath !== '/products/golden-bull-celebration-apgo-aurora-car-nano-coating-premium') return;

    var counter = document.querySelector('.apgo-aurora-mini-counter[data-aurora-stock-counter]');
    if (!counter || counter.getAttribute('data-manual-adjustment-applied') === 'true') return;

    var remaining = parseInt(counter.getAttribute('data-remaining'), 10);
    var total = parseInt(counter.getAttribute('data-total'), 10);
    if (!Number.isFinite(remaining) || !Number.isFinite(total) || total <= 0) return;

    var adjusted = Math.max(0, remaining - 14);
    var number = counter.querySelector('[data-aurora-stock-number]');
    var fill = counter.querySelector('.apgo-aurora-mini-counter__fill');
    var label = counter.getAttribute('aria-label');

    counter.setAttribute('data-manual-adjustment-applied', 'true');
    counter.setAttribute('data-remaining', String(adjusted));
    counter.setAttribute('data-claimed', String(total - adjusted));
    if (number) number.textContent = String(adjusted);
    if (fill) fill.style.setProperty('--apgo-stock-progress', String((adjusted / total) * 100) + '%');
    if (label) counter.setAttribute('aria-label', label.replace(String(remaining), String(adjusted)));
  }

  adjustAuroraCampaignCounter();
})();
