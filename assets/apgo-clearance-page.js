/* APGO clearance page (page.clearance-sale) — mouse drag-to-scroll for
 * the product rows. Touch already swipes natively and the arrow buttons
 * are wired by apgo-event-cart.js; this lets desktop shoppers grab a row
 * and drag it sideways. A drag longer than a few pixels swallows the
 * click that follows, so letting go over a card doesn't open it.
 * The 11.11 page (same markup, ticket skin) also gets a scroll bar under
 * each row: its thumb follows the row, can be dragged, and a tap on the
 * bar scrolls the row there.
 * Loaded from layout/theme.liquid for these templates only. */
(function () {
  'use strict';

  var DRAG_THRESHOLD = 6;

  function enableDrag(track) {
    if (track.getAttribute('data-apgo-drag-ready') === 'true') return;
    track.setAttribute('data-apgo-drag-ready', 'true');

    var pointerId = null;
    var startX = 0;
    var startScroll = 0;
    var moved = false;
    var swallowClick = false;

    track.addEventListener('dragstart', function (event) {
      event.preventDefault();
    });

    track.addEventListener('pointerdown', function (event) {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      if (event.target.closest('button, input, select, textarea')) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startScroll = track.scrollLeft;
      moved = false;
    });

    track.addEventListener('pointermove', function (event) {
      if (pointerId === null || event.pointerId !== pointerId) return;
      var distance = event.clientX - startX;
      if (!moved) {
        if (Math.abs(distance) < DRAG_THRESHOLD) return;
        moved = true;
        track.classList.add('is-dragging');
        try { track.setPointerCapture(pointerId); } catch (error) {}
      }
      track.scrollLeft = startScroll - distance;
    });

    function endDrag(event) {
      if (pointerId === null || (event && event.pointerId !== pointerId)) return;
      pointerId = null;
      if (!moved) return;
      track.classList.remove('is-dragging');
      swallowClick = true;
      window.setTimeout(function () { swallowClick = false; }, 0);
    }

    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('lostpointercapture', endDrag);

    track.addEventListener('click', function (event) {
      if (!swallowClick) return;
      event.preventDefault();
      event.stopPropagation();
      swallowClick = false;
    }, true);
  }

  var MIN_THUMB = 32;

  function enableScrollbar(bar) {
    if (bar.getAttribute('data-apgo-scrollbar-ready') === 'true') return;
    var scroller = bar.closest('.apgo-crate-zone__scroller');
    var track = scroller && scroller.querySelector('[data-apgo-scroll-track]');
    var thumb = bar.querySelector('[data-apgo-scrollbar-thumb]');
    if (!track || !thumb) return;
    bar.setAttribute('data-apgo-scrollbar-ready', 'true');

    function maxScroll() {
      return Math.max(0, track.scrollWidth - track.clientWidth);
    }

    // Row pixels per pixel of thumb travel.
    function ratio() {
      var travel = bar.clientWidth - thumb.offsetWidth;
      return travel > 0 ? maxScroll() / travel : 0;
    }

    function update() {
      var max = maxScroll();
      bar.hidden = max <= 8;
      if (bar.hidden) return;
      var width = Math.max(MIN_THUMB, bar.clientWidth * (track.clientWidth / track.scrollWidth));
      var x = (track.scrollLeft / max) * (bar.clientWidth - width);
      thumb.style.width = width + 'px';
      thumb.style.transform = 'translateX(' + x + 'px)';
    }

    var pointerId = null;
    var startX = 0;
    var startScroll = 0;

    thumb.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      pointerId = event.pointerId;
      startX = event.clientX;
      startScroll = track.scrollLeft;
      track.classList.add('is-dragging');
      bar.classList.add('is-dragging');
      try { thumb.setPointerCapture(pointerId); } catch (error) {}
    });

    thumb.addEventListener('pointermove', function (event) {
      if (pointerId === null || event.pointerId !== pointerId) return;
      track.scrollLeft = startScroll + (event.clientX - startX) * ratio();
    });

    function endDrag(event) {
      if (pointerId === null || (event && event.pointerId !== pointerId)) return;
      pointerId = null;
      track.classList.remove('is-dragging');
      bar.classList.remove('is-dragging');
    }

    thumb.addEventListener('pointerup', endDrag);
    thumb.addEventListener('pointercancel', endDrag);
    thumb.addEventListener('lostpointercapture', endDrag);

    // A tap on the bar beside the thumb centres the thumb there.
    bar.addEventListener('pointerdown', function (event) {
      if (event.target === thumb || event.button !== 0) return;
      var rect = bar.getBoundingClientRect();
      var target = (event.clientX - rect.left - thumb.offsetWidth / 2) * ratio();
      track.scrollTo({ left: Math.max(0, Math.min(maxScroll(), target)), behavior: 'smooth' });
    });

    track.addEventListener('scroll', update, { passive: true });
    if ('ResizeObserver' in window) {
      new ResizeObserver(update).observe(track);
    } else {
      window.addEventListener('resize', update, { passive: true });
    }
    update();
  }

  function init(scope) {
    var tracks = (scope || document).querySelectorAll('.apgo-crate-zone__track');
    Array.prototype.forEach.call(tracks, enableDrag);
    var bars = (scope || document).querySelectorAll('[data-apgo-scrollbar]');
    Array.prototype.forEach.call(bars, enableScrollbar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(document); });
  } else {
    init(document);
  }

  document.addEventListener('shopify:section:load', function (event) {
    init(event.target);
  });
})();
