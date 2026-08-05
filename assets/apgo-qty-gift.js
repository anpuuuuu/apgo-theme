/**
 * APGO quantity-threshold free gift auto-add.
 *
 * Companion to a NATIVE Shopify "Buy X get Y" automatic discount
 * (e.g. "buy any 6 packs of the Laundry Detergent Promotion → 1 free
 * APGO Floor Cleaner 30ml"). Native BXGY discounts only zero the gift
 * if it is ALREADY in the cart — they never add it. This script keeps
 * the gift line in sync so the discount always has something to zero:
 *
 *   eligible = floor(total qty of trigger product across all its
 *              variants / minQty)          ← matches uncapped BXGY
 *   → add / adjust / remove the gift line to exactly that quantity.
 *
 * Config from window.APGO_QTY_GIFT (emitted by layout/theme.liquid from
 * theme settings): { triggerProductId, minQty, giftVariantId }.
 *
 * The gift line is tagged properties[_free_gift]='true' so the cart UI
 * applies the existing gift lockdown (qty frozen, no remove button) and
 * the free-shipping bar excludes it. _gift_reason='qty-threshold'
 * distinguishes it from the legacy 1:1 GWP reconciler's lines (that
 * reconciler is gated on apgo_gwp_enabled and keys strictly off its own
 * APGO_GIFT_MAP — keep that setting OFF while this promo runs, or it may
 * prune lines it doesn't recognise).
 *
 * Convergence-safe: after our own add/change we re-check and no-op when
 * desired == current, so the cart-page reload and re-dispatched events
 * can't loop.
 */
(function () {
  'use strict';
  var cfg = window.APGO_QTY_GIFT;
  if (!cfg || !cfg.giftVariantId || !cfg.triggerProductId) return;
  var minQty = parseInt(cfg.minQty, 10) || 6;

  var running = false;
  var selfDispatching = false;

  function reconcile() {
    if (running) return;
    running = true;
    fetch('/cart.js?_=' + Date.now(), { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var triggerQty = 0;
        var giftQty = 0;
        var giftKey = null;
        (cart.items || []).forEach(function (it) {
          if (it.product_id === cfg.triggerProductId) triggerQty += it.quantity;
          if (it.variant_id === cfg.giftVariantId &&
              it.properties && it.properties._free_gift === 'true') {
            giftQty += it.quantity;
            giftKey = it.key;
          }
        });

        var desired = Math.floor(triggerQty / minQty);
        if (desired === giftQty) { running = false; return null; }

        var op;
        if (giftKey) {
          /* Line exists → set it to the desired qty (0 removes it). */
          op = fetch('/cart/change.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ id: giftKey, quantity: desired })
          });
        } else {
          /* No line yet → add it. */
          var fd = new FormData();
          fd.append('id', String(cfg.giftVariantId));
          fd.append('quantity', String(desired));
          fd.append('properties[_free_gift]', 'true');
          fd.append('properties[_gift_reason]', 'qty-threshold');
          op = fetch('/cart/add.js', {
            method: 'POST', headers: { Accept: 'application/json' }, body: fd
          });
        }

        return op
          .then(function (r) {
            if (!r.ok) {
              return r.json().then(function (j) {
                console.warn('[apgo-qty-gift] cart write failed', r.status, j);
                return null;
              });
            }
            return r.json();
          })
          .then(function () {
            return fetch('/cart.js?_=' + Date.now(), { cache: 'no-store', headers: { Accept: 'application/json' } })
              .then(function (r) { return r.json(); });
          })
          .then(function (newCart) {
            /* Canonical cart events — Horizon's <cart-icon> needs
               detail.data.itemCount to repaint the header badge. */
            selfDispatching = true;
            try {
              var detail = {
                data: { itemCount: newCart.item_count || 0, source: 'apgo-qty-gift' },
                resource: newCart,
                cart: newCart
              };
              ['cart:update', 'cart:updated', 'cart:refresh'].forEach(function (name) {
                try {
                  document.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail }));
                } catch (e) { /* no-op */ }
              });
            } finally {
              setTimeout(function () { selfDispatching = false; }, 50);
            }
            /* On the cart PAGE the rows are server-rendered; a new/changed
               gift line won't appear without a re-render. Reload once —
               after reload desired == current, so this can't loop. */
            if (/^\/cart\/?$/.test(window.location.pathname)) {
              window.location.reload();
            }
            return newCart;
          });
      })
      .catch(function (err) { console.warn('[apgo-qty-gift] reconcile failed', err); })
      .then(function () { running = false; });
  }

  var timer = null;
  function schedule() {
    if (selfDispatching) return;
    clearTimeout(timer);
    timer = setTimeout(reconcile, 150);
  }

  ['cart:update', 'cart:updated', 'cart:refresh', 'cart:added'].forEach(function (name) {
    document.addEventListener(name, schedule);
  });
  window.addEventListener('pageshow', function (ev) { if (ev.persisted) schedule(); });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
})();
