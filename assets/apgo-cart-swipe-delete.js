/**
 * Mobile cart page — swipe-left on a line item to reveal Delete (Shopee/Taobao style).
 * Converts table rows to swipe surfaces on ≤749px; re-inits after Horizon section morph.
 */
(function () {
  'use strict';

  var MQ = '(max-width: 749px)';
  var DELETE_W = 76;
  var OPEN_THRESHOLD = 38;
  var openItem = null;

  function isActive() {
    return window.matchMedia(MQ).matches && !!document.querySelector('.cart-page .cart-items__table');
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

  function cellToDiv(td) {
    var div = document.createElement('div');
    Array.prototype.forEach.call(td.attributes, function (attr) {
      div.setAttribute(attr.name, attr.value);
    });
    div.innerHTML = td.innerHTML;
    return div;
  }

  function buildSwipeItem(row) {
    var line = getLine(row);
    var isGift = row.classList.contains('apgo-cart-item--gift');
    var label = (window.apgoCartSwipe && window.apgoCartSwipe.removeLabel) || 'Remove';

    var wrap = document.createElement('div');
    wrap.className = 'apgo-cart-swipe-item' + (isGift ? ' apgo-cart-swipe-item--gift' : '');
    wrap.setAttribute('role', 'listitem');
    if (line) wrap.dataset.line = String(line);

    var deleteBtn = null;
    if (!isGift) {
      deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'apgo-cart-swipe-item__delete';
      deleteBtn.setAttribute('aria-label', label);
      deleteBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
        '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>' +
        '<path d="M10 11v6M14 11v6"/>' +
        '</svg><span>' + label + '</span>';
      wrap.appendChild(deleteBtn);
    }

    var surface = document.createElement('div');
    surface.className = row.className + ' apgo-cart-swipe-item__surface';
    while (row.firstChild) {
      surface.appendChild(cellToDiv(row.firstChild));
    }
    wrap.appendChild(surface);
    row.remove();

    if (!isGift && deleteBtn) {
      bindSwipe(wrap, surface, deleteBtn, line);
    }
    return wrap;
  }

  function closeItem(wrap, surface) {
    if (!surface) surface = wrap.querySelector('.apgo-cart-swipe-item__surface');
    surface.style.transform = '';
    wrap.classList.remove('is-open');
    if (openItem === wrap) openItem = null;
  }

  function openItemRow(wrap, surface) {
    if (openItem && openItem !== wrap) {
      closeItem(openItem);
    }
    surface.style.transform = 'translateX(-' + DELETE_W + 'px)';
    wrap.classList.add('is-open');
    openItem = wrap;
  }

  function bindSwipe(wrap, surface, deleteBtn, line) {
    var startX = 0;
    var baseX = 0;
    var dragging = false;

    deleteBtn.addEventListener('click', function () {
      triggerRemove(line);
    });

    surface.addEventListener('touchstart', function (e) {
      if (e.target.closest('button, input, a, quantity-selector-component')) return;
      dragging = true;
      startX = e.touches[0].clientX;
      baseX = wrap.classList.contains('is-open') ? -DELETE_W : 0;
      surface.style.transition = 'none';
    }, { passive: true });

    surface.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      var dx = e.touches[0].clientX - startX;
      var tx = baseX + dx;
      if (tx > 0) tx = 0;
      if (tx < -DELETE_W) tx = -DELETE_W;
      surface.style.transform = 'translateX(' + tx + 'px)';
    }, { passive: true });

    function endSwipe() {
      if (!dragging) return;
      dragging = false;
      surface.style.transition = '';
      var match = surface.style.transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
      var tx = match ? parseFloat(match[1]) : 0;
      if (tx <= -OPEN_THRESHOLD) {
        openItemRow(wrap, surface);
      } else {
        closeItem(wrap, surface);
      }
    }

    surface.addEventListener('touchend', endSwipe);
    surface.addEventListener('touchcancel', endSwipe);

    /* Tap elsewhere closes an open row */
    document.addEventListener(
      'touchstart',
      function (e) {
        if (!wrap.classList.contains('is-open')) return;
        if (wrap.contains(e.target)) return;
        closeItem(wrap, surface);
      },
      { passive: true }
    );
  }

  function teardown() {
    document.querySelectorAll('.apgo-cart-swipe-list').forEach(function (el) {
      el.remove();
    });
    var table = document.querySelector('.cart-page .cart-items__table[data-swipe-hidden]');
    if (table) {
      table.style.display = '';
      delete table.dataset.swipeHidden;
    }
    openItem = null;
  }

  function init() {
    if (!isActive()) {
      teardown();
      return;
    }
    if (document.querySelector('.apgo-cart-swipe-list')) return;

    var table = document.querySelector('.cart-page .cart-items__table');
    var tbody = table && table.querySelector('tbody');
    if (!tbody) return;

    var rows = Array.prototype.slice.call(
      tbody.querySelectorAll(':scope > tr.cart-items__table-row')
    );
    if (!rows.length) return;

    var list = document.createElement('div');
    list.className = 'apgo-cart-swipe-list';
    list.setAttribute('role', 'list');

    rows.forEach(function (row) {
      list.appendChild(buildSwipeItem(row));
    });

    table.parentNode.insertBefore(list, table);
    table.style.display = 'none';
    table.dataset.swipeHidden = '1';
  }

  function scheduleInit() {
    teardown();
    setTimeout(init, 60);
  }

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();

  ['cart:update', 'cart:updated', 'cart:refresh', 'quantity-selector:update'].forEach(function (ev) {
    document.addEventListener(ev, scheduleInit);
  });

  var target = document.querySelector('.cart-items__wrapper, cart-items-component');
  if (target && 'MutationObserver' in window) {
    var pending = null;
    new MutationObserver(function () {
      if (!isActive()) return;
      if (pending) clearTimeout(pending);
      pending = setTimeout(function () {
        pending = null;
        if (document.querySelector('.apgo-cart-swipe-list') && !document.querySelector('.cart-page .cart-items__table[data-swipe-hidden]')) {
          scheduleInit();
        } else if (!document.querySelector('.apgo-cart-swipe-list') && document.querySelector('.cart-page .cart-items__table tbody tr.cart-items__table-row')) {
          init();
        }
      }, 90);
    }).observe(target, { childList: true, subtree: true });
  }

  window.addEventListener('resize', function () {
    if (!window.matchMedia(MQ).matches) teardown();
    else scheduleInit();
  });
})();
