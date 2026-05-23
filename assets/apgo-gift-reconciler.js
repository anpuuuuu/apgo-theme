/*
 * APGO Gift-with-Purchase reconciler — global edition.
 *
 * Loads on every page (not just the PDP). Listens for cart:update events
 * (Shopify Horizon dispatches one after every quick-add / cart edit) and
 * keeps the cart's "free gift Y" lines in sync with the X products that
 * trigger them.
 *
 * Input:
 *   window.APGO_GIFT_MAP            — { xVariantId: yVariantId } (numbers)
 *   window.APGO_GIFT_PRODUCT_TITLES — { xVariantId: 'Product title' } (optional)
 *
 * Behaviour:
 *   - For each non-gift item in cart, if its variant_id has an entry in
 *     APGO_GIFT_MAP, add that many Y units (qty(X) === qty(Y), 1:1).
 *   - Gift lines (`properties._free_gift === 'true'`) skip the lookup.
 *   - Dismissed gifts (localStorage `apgo_gift_dismissed_<xVariantId>` = '1')
 *     are not re-added that day; manual /cart UI exposes a way to clear it
 *     by closing the gift line and visiting again next day.
 *   - Stale gifts (Y in cart but their triggering X is gone) are removed.
 *
 * Recursion guard:
 *   - Reconciler dispatches a synthetic cart:update once it finishes; that
 *     event would normally re-trigger reconcile. We set an internal flag
 *     during dispatch so listeners that originated from us are skipped.
 *
 * Debounce: queued through requestAnimationFrame so back-to-back quick-add
 *   clicks merge into a single reconcile run.
 */
(function () {
  'use strict';

  /*
    Dismissal state — kept in sessionStorage so it resets when the tab
    closes. Combined with the "qty went up = clear dismiss" logic below,
    this gives the expected UX:
      - Remove Y from cart → dismiss flag set, Y won't auto-add back
        on passive cart reloads (page nav, drawer open, etc.)
      - User actively adds MORE X → dismiss cleared, Y re-added
      - New tab / new session → dismiss cleared, Y back on next add
  */
  function isGiftDismissed(xVariantId) {
    try {
      return sessionStorage.getItem('apgo_gift_dismissed_' + xVariantId) === '1';
    } catch (_) { return false; }
  }
  function markGiftDismissed(xVariantId) {
    try { sessionStorage.setItem('apgo_gift_dismissed_' + xVariantId, '1'); } catch (_) {}
  }
  function clearGiftDismissed(xVariantId) {
    try { sessionStorage.removeItem('apgo_gift_dismissed_' + xVariantId); } catch (_) {}
  }

  /* Track previously-seen X quantities so we can detect "user added more X"
     and re-arm the gift. Stored in sessionStorage so a page navigation
     within the same tab preserves the baseline (otherwise a reload would
     compare current X to 0 and always clear dismiss). */
  function getLastXQty() {
    try { return JSON.parse(sessionStorage.getItem('apgo_gift_last_x_qty') || '{}') || {}; }
    catch (_) { return {}; }
  }
  function setLastXQty(map) {
    try { sessionStorage.setItem('apgo_gift_last_x_qty', JSON.stringify(map)); } catch (_) {}
  }
  window.apgoDismissGift = function (id) { markGiftDismissed(id); };
  window.apgoUndismissGift = clearGiftDismissed;

  var running = false; /* prevent overlapping runs */
  var scheduled = false; /* request-frame coalescing */
  var selfDispatching = false; /* skip our own cart:update events */

  function reconcile() {
    if (running) return Promise.resolve();
    if (!window.APGO_GIFT_MAP || Object.keys(window.APGO_GIFT_MAP).length === 0) {
      return Promise.resolve();
    }
    running = true;
    return fetch('/cart.js?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        /* First pass: compute current X quantities (across all lines) per
           X variant id. Used both to (a) detect qty-increase → clear
           dismiss, and (b) populate the desired-gift map. */
        var currentXQty = {};
        cart.items.forEach(function (item) {
          if (item.properties && item.properties._free_gift === 'true') return;
          if (!window.APGO_GIFT_MAP[item.variant_id]) return;
          currentXQty[item.variant_id] = (currentXQty[item.variant_id] || 0) + item.quantity;
        });

        /* Detect "user added more X since last reconcile" → user clearly
           wants the gift back, so clear the dismiss flag. */
        var lastXQty = getLastXQty();
        Object.keys(currentXQty).forEach(function (xVariantId) {
          var prev = lastXQty[xVariantId] || 0;
          if (currentXQty[xVariantId] > prev) {
            clearGiftDismissed(xVariantId);
          }
        });
        setLastXQty(currentXQty);

        var desired = {};
        cart.items.forEach(function (item) {
          if (item.properties && item.properties._free_gift === 'true') return;
          var giftId = window.APGO_GIFT_MAP[item.variant_id];
          if (!giftId) return;
          if (isGiftDismissed(item.variant_id)) return;
          if (!desired[giftId]) {
            desired[giftId] = {
              qty: 0,
              xVariantId: item.variant_id,
              xTitle: (window.APGO_GIFT_PRODUCT_TITLES || {})[item.variant_id] || item.product_title || ''
            };
          }
          desired[giftId].qty += item.quantity; /* sum quantities, not lines */
        });

        var existingGifts = [];
        cart.items.forEach(function (item) {
          if (item.properties && item.properties._free_gift === 'true') existingGifts.push(item);
        });

        var ops = [];

        Object.keys(desired).forEach(function (giftIdStr) {
          var giftId = parseInt(giftIdStr, 10);
          var spec = desired[giftIdStr];
          var existing = existingGifts.find(function (e) { return e.variant_id === giftId; });
          if (!existing) {
            var fd = new FormData();
            fd.append('id', String(giftId));
            fd.append('quantity', String(spec.qty));
            fd.append('properties[_free_gift]', 'true');
            fd.append('properties[_gift_for]', String(spec.xVariantId));
            if (spec.xTitle) fd.append('properties[_gift_from_product]', spec.xTitle);
            ops.push(fetch('/cart/add.js', {
              method: 'POST', headers: { Accept: 'application/json' }, body: fd
            }).catch(function () {}));
          } else if (existing.quantity !== spec.qty) {
            var fd2 = new FormData();
            fd2.append('id', existing.key);
            fd2.append('quantity', String(spec.qty));
            ops.push(fetch('/cart/change.js', {
              method: 'POST', headers: { Accept: 'application/json' }, body: fd2
            }).catch(function () {}));
          }
        });

        /* Prune gift lines whose triggering X is gone or dismissed */
        existingGifts.forEach(function (g) {
          if (!desired[g.variant_id]) {
            var fd3 = new FormData();
            fd3.append('id', g.key);
            fd3.append('quantity', '0');
            ops.push(fetch('/cart/change.js', {
              method: 'POST', headers: { Accept: 'application/json' }, body: fd3
            }).catch(function () {}));
          }
        });

        if (!ops.length) return cart;
        return Promise.all(ops).then(function () {
          return fetch('/cart.js?_=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); });
        }).then(function (newCart) {
          /* Re-dispatch so cart-icon, drawer, etc. pick up the new totals.
             selfDispatching guards against the recursive cart:update we
             trigger here re-entering reconcile in the listener below. */
          selfDispatching = true;
          try {
            document.dispatchEvent(new CustomEvent('cart:update', {
              bubbles: true,
              detail: {
                resource: newCart,
                sourceId: 'apgo-gift-reconciler',
                data: { itemCount: newCart.item_count, source: 'apgo-gift-reconciler', sections: {} }
              }
            }));
            /* Also bump cart-icon directly in case events are flaky */
            var cartIconEls = document.querySelectorAll('cart-icon, .header-actions__cart-icon');
            cartIconEls.forEach(function (icon) {
              var countEl = icon.querySelector('[ref="cartBubbleCount"], .cart-bubble__text-count');
              var bubbleEl = icon.querySelector('[ref="cartBubble"], .cart-bubble');
              var n = newCart.item_count || 0;
              if (countEl) {
                countEl.textContent = n < 100 ? String(n) : '';
                countEl.classList.toggle('hidden', n === 0);
              }
              if (bubbleEl) bubbleEl.classList.toggle('visually-hidden', n === 0);
              icon.classList.toggle('header-actions__cart-icon--has-cart', n > 0);
            });
          } finally {
            setTimeout(function () { selfDispatching = false; }, 50);
          }
          return newCart;
        });
      })
      .catch(function (err) { console.warn('[apgo-gift] reconcile failed', err); })
      .then(function (result) { running = false; return result; });
  }

  /* Public entry — debounced through requestAnimationFrame */
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      reconcile();
    });
  }
  window.apgoReconcileFreeGifts = function () {
    /* Bypass debounce on direct call — caller awaits the promise */
    return reconcile();
  };

  /* Listen for cart updates from anywhere (quick-add, cart drawer, PDP,
     apps that dispatch the standard event). Skip our own events. */
  document.addEventListener('cart:update', function (ev) {
    if (selfDispatching) return;
    /* Also skip events tagged as coming from our own reconciler in case
       another script re-broadcasts them */
    if (ev && ev.detail && ev.detail.data && ev.detail.data.source === 'apgo-gift-reconciler') return;
    schedule();
  });
  document.addEventListener('cart:updated', function () {
    if (selfDispatching) return;
    schedule();
  });
})();
