/*
  APGO Event Banner carousel (sections/apgo-event-banner.liquid, 2026-10).

  The track is a native horizontal scroller with snap points (CSS in
  assets/apgo-event-page.css), so a swipe is the browser's own. This adds
  the dots and arrows, keyboard arrows, auto-rotate and theme-editor block
  selection. Auto-rotate pauses while a mouse is over the carousel, a
  finger is on it or keyboard focus is inside, while it is off screen or
  the tab is hidden, and never runs with reduced motion. Each
  [data-apgo-ebc] on the page runs on its own.
*/
(function () {
  'use strict';

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function isKeyboardFocus(el) {
    try { return el.matches(':focus-visible'); } catch (e) { return true; }
  }

  function init(root) {
    if (!root || root.hasAttribute('data-apgo-ebc-ready')) return;
    var track = root.querySelector('[data-apgo-ebc-track]');
    if (!track) return;
    var slides = Array.prototype.slice.call(track.querySelectorAll('[data-apgo-ebc-slide]'));
    var n = slides.length;
    if (n < 2) return;
    root.setAttribute('data-apgo-ebc-ready', '');

    var dots = Array.prototype.slice.call(root.querySelectorAll('[data-apgo-ebc-dot]'));
    var prev = root.querySelector('[data-apgo-ebc-prev]');
    var next = root.querySelector('[data-apgo-ebc-next]');
    var autoplay = root.getAttribute('data-autoplay') === 'true' && !reduceMotion;
    var interval = Math.max(3000, parseInt(root.getAttribute('data-interval'), 10) || 5000);

    var current = 0;
    var timer = null;
    var hold = false;       /* mouse over, keyboard focus inside, or editor block selected */
    var onScreen = true;
    var ignoreScrollUntil = 0;
    var settleTimer = null;

    function indexFromScroll() {
      var w = track.clientWidth || 1;
      return Math.max(0, Math.min(n - 1, Math.round(track.scrollLeft / w)));
    }

    function markActive(i) {
      current = i;
      dots.forEach(function (d, k) {
        var on = k === i;
        d.classList.toggle('is-active', on);
        if (on) d.setAttribute('aria-current', 'true');
        else d.removeAttribute('aria-current');
      });
      slides.forEach(function (s, k) {
        var on = k === i;
        s.setAttribute('aria-hidden', on ? 'false' : 'true');
        var link = s.querySelector('a');
        if (link) link.tabIndex = on ? 0 : -1;
      });
    }

    function jumpTo(left) {
      var prevBehavior = track.style.scrollBehavior;
      track.style.scrollBehavior = 'auto';
      track.scrollLeft = left;
      track.style.scrollBehavior = prevBehavior;
    }

    /* Programmatic moves glide through the slides in between; the scroll
       handler leaves the dots alone until the move has settled. */
    function go(i, instant) {
      i = ((i % n) + n) % n;
      var left = i * track.clientWidth;
      markActive(i);
      if (instant || reduceMotion) {
        jumpTo(left);
        return;
      }
      ignoreScrollUntil = Date.now() + 700;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(function () { markActive(indexFromScroll()); }, 750);
      try {
        track.scrollTo({ left: left, behavior: 'smooth' });
      } catch (e) {
        track.scrollLeft = left;
      }
    }

    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function start() {
      stop();
      if (!autoplay || hold || !onScreen || document.visibilityState === 'hidden') return;
      timer = setInterval(function () { go(current + 1); }, interval);
    }

    /* Swipes and trackpad scrolls: follow which slide is showing, checked
       at most every 80ms while the track moves. */
    var syncTimer = 0;
    track.addEventListener('scroll', function () {
      if (Date.now() < ignoreScrollUntil || syncTimer) return;
      syncTimer = setTimeout(function () {
        syncTimer = 0;
        var i = indexFromScroll();
        if (i !== current) markActive(i);
      }, 80);
    }, { passive: true });

    dots.forEach(function (d) {
      d.addEventListener('click', function () {
        go(parseInt(d.getAttribute('data-apgo-ebc-dot'), 10) || 0);
        start();
      });
    });
    if (prev) prev.addEventListener('click', function () { go(current - 1); start(); });
    if (next) next.addEventListener('click', function () { go(current + 1); start(); });

    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(current - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(current + 1);
      }
    });

    /* Pauses. A swipe restarts the countdown when the finger lifts. */
    root.addEventListener('pointerenter', function (e) {
      if (e.pointerType === 'mouse') { hold = true; stop(); }
    });
    root.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'mouse') { hold = false; start(); }
    });
    track.addEventListener('touchstart', stop, { passive: true });
    track.addEventListener('touchend', start, { passive: true });
    root.addEventListener('focusin', function (e) {
      if (isKeyboardFocus(e.target)) { hold = true; stop(); }
    });
    root.addEventListener('focusout', function (e) {
      if (!root.contains(e.relatedTarget)) { hold = false; start(); }
    });
    document.addEventListener('visibilitychange', start);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[entries.length - 1].isIntersecting;
        start();
      }, { threshold: 0.25 }).observe(root);
    }

    /* Keep the current slide in place when the width changes. */
    var lastWidth = track.clientWidth;
    window.addEventListener('resize', function () {
      if (track.clientWidth === lastWidth) return;
      lastWidth = track.clientWidth;
      jumpTo(current * track.clientWidth);
    });

    /* Theme editor: selecting a 輪播圖 block shows that slide and holds it. */
    root.__apgoEbc = {
      show: function (el) {
        var i = slides.indexOf(el.closest('[data-apgo-ebc-slide]'));
        if (i < 0) return;
        hold = true;
        stop();
        go(i, true);
      },
      release: function () {
        hold = false;
        start();
      }
    };

    markActive(indexFromScroll());
    start();
  }

  function initAll(scope) {
    Array.prototype.forEach.call((scope || document).querySelectorAll('[data-apgo-ebc]'), init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initAll(); });
  } else {
    initAll();
  }

  document.addEventListener('shopify:section:load', function (e) { initAll(e.target); });
  document.addEventListener('shopify:block:select', function (e) {
    var root = e.target.closest && e.target.closest('[data-apgo-ebc]');
    if (root && root.__apgoEbc) root.__apgoEbc.show(e.target);
  });
  document.addEventListener('shopify:block:deselect', function (e) {
    var root = e.target.closest && e.target.closest('[data-apgo-ebc]');
    if (root && root.__apgoEbc) root.__apgoEbc.release();
  });
})();
