/**
 * Mobile cart page — swipe-left on a line item to reveal Delete.
 * Works on native <tr> rows (no table→div conversion) so Horizon section
 * morphs stay compatible.
 */
(function () {
  'use strict';

  var MQ = '(max-width: 749px)';
  var DELETE_W = 76;
  var OPEN_THRESHOLD = 38;
  var openRow = null;
  var INITED = 'data-apgo-swipe-inited';

  function isMobileCart() {
    return (
      window.matchMedia(MQ).matches &&
      !!document.querySelector('cart-items-component .cart-page .cart-items__table tbody')
    );
  }

  function getLine(row) {
    var btn = row.querySelector('.cart-items__remove');
    if (btn) {
      var m = (btn.getAttribute('on:click') || '').match(/onLineItemRemove\/(\d+)/);
      if (m) return parseInt(m[1], 10);
    }
    var input = row.querySelector('.cart-items__quantity input[type="number"]');
    if (input) {
      var line = parseInt(input.getAttribute('data-cart-line'), 10);
      if (!isNaN(line)) return line;
    }
    return 0;
  }

  function swipeCells(row) {
    return row.querySelectorAll('.cart-items__media, .cart-items__details, .cart-items__quantity');
  }

  function triggerRemove(line) {
    if (!line) return;
    var comp = document.querySelector('cart-items-component');
    if (comp && typeof comp.onLineItemRemove === 'function') {
      comp.onLineItemRemove(line);
      return;
    }
    var hidden = document.querySelector(
      '.cart-items__table [on\\:click="/onLineItemRemove/' + line + '"]'
    );
    if (hidden) hidden.click();
  }

  function setTranslate(row, px) {
    var cells = swipeCells(row);
    var val = px ? 'translateX(' + px + 'px)' : '';
    cells.forEach(function (cell) {
      cell.style.transform = val;
    });
  }

  function closeRow(row) {
    if (!row) return;
    setTranslate(row, 0);
    row.classList.remove('is-swipe-open');
    if (openRow === row) openRow = null;
  }

  function openRowSwipe(row) {
    if (openRow && openRow !== row) closeRow(openRow);
    setTranslate(row, -DELETE_W);
    row.classList.add('is-swipe-open');
    openRow = row;
  }

  function bindRow(row) {
    if (row.getAttribute(INITED) === 'true') return;
    if (row.classList.contains('apgo-cart-item--gift')) return;

    var line = getLine(row);
    if (!line) return;

    row.setAttribute(INITED, 'true');
    row.classList.add('apgo-cart-swipe-row');

    var label = (window.apgoCartSwipe && window.apgoCartSwipe.removeLabel) || 'Remove';
    var del = document.createElement('td');
    del.className = 'apgo-cart-swipe-delete';
    del.setAttribute('role', 'cell');
    del.innerHTML =
      '<button type="button" class="apgo-cart-swipe-delete__btn" aria-label="' + label + '">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>' +
      '<path d="M10 11v6M14 11v6"/>' +
      '</svg><span>' + label + '</span></button>';
    row.appendChild(del);

    del.querySelector('.apgo-cart-swipe-delete__btn').addEventListener('click', function () {
      triggerRemove(line);
    });

    var startX = 0;
    var baseX = 0;
    var dragging = false;

    function onTouchStart(e) {
      if (!isMobileCart()) return;
      if (e.target.closest('button, input, a, quantity-selector-component')) return;
      dragging = true;
      startX = e.touches[0].clientX;
      baseX = row.classList.contains('is-swipe-open') ? -DELETE_W : 0;
      swipeCells(row).forEach(function (c) {
        c.style.transition = 'none';
      });
    }

    function onTouchMove(e) {
      if (!dragging) return;
      var dx = e.touches[0].clientX - startX;
      var tx = baseX + dx;
      if (tx > 0) tx = 0;
      if (tx < -DELETE_W) tx = -DELETE_W;
      setTranslate(row, tx);
    }

    function onTouchEnd() {
      if (!dragging) return;
      dragging = false;
      swipeCells(row).forEach(function (c) {
        c.style.transition = '';
      });
      var first = row.querySelector('.cart-items__media');
      var tx = 0;
      if (first && first.style.transform) {
        var m = first.style.transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
        if (m) tx = parseFloat(m[1]);
      }
      if (tx <= -OPEN_THRESHOLD) openRowSwipe(row);
      else closeRow(row);
    }

    row.addEventListener('touchstart', onTouchStart, { passive: true });
    row.addEventListener('touchmove', onTouchMove, { passive: true });
    row.addEventListener('touchend', onTouchEnd);
    row.addEventListener('touchcancel', onTouchEnd);
  }

  function resetRow(row) {
    row.removeAttribute(INITED);
    row.classList.remove('apgo-cart-swipe-row', 'is-swipe-open');
    var del = row.querySelector('.apgo-cart-swipe-delete');
    if (del) del.remove();
    setTranslate(row, 0);
    swipeCells(row).forEach(function (c) {
      c.style.transition = '';
      c.style.transform = '';
    });
  }

  function teardown() {
    document
      .querySelectorAll('cart-items-component .cart-page .cart-items__table tbody tr.cart-items__table-row')
      .forEach(resetRow);
    openRow = null;
  }

  function init() {
    if (!isMobileCart()) {
      teardown();
      return;
    }

    var rows = document.querySelectorAll(
      'cart-items-component .cart-page .cart-items__table tbody tr.cart-items__table-row'
    );
    rows.forEach(bindRow);
  }

  function scheduleInit() {
    teardown();
    setTimeout(init, 80);
  }

  window.apgoCartSwipeInit = scheduleInit;

  document.addEventListener('touchstart', function (e) {
    if (!openRow) return;
    if (openRow.contains(e.target)) return;
    closeRow(openRow);
  }, { passive: true });

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();

  ['cart:update', 'cart:updated', 'cart:refresh', 'quantity-selector:update'].forEach(function (ev) {
    document.addEventListener(ev, scheduleInit);
  });

  window.addEventListener('resize', function () {
    if (!window.matchMedia(MQ).matches) teardown();
    else scheduleInit();
  });
})();
