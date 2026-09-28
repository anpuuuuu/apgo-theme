/* APGO clearance page (page.clearance-sale) — mouse drag-to-scroll for
 * the product rows. Touch already swipes natively and the arrow buttons
 * are wired by apgo-event-cart.js; this lets desktop shoppers grab a row
 * and drag it sideways. A drag longer than a few pixels swallows the
 * click that follows, so letting go over a card doesn't open it.
 * Loaded from layout/theme.liquid for this template only. */
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

  function init(scope) {
    var tracks = (scope || document).querySelectorAll('.apgo-crate-zone__track');
    Array.prototype.forEach.call(tracks, enableDrag);
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
