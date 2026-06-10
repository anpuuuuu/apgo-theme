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
  var pendingCart = null; /* cart from latest event, reused to skip a fetch */

  // #region agent log
  function __dbg(message, data) {
    try {
      fetch('http://127.0.0.1:7664/ingest/6d6da4c4-6868-481c-8830-6f610c9dd71e', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '0c453c' },
        body: JSON.stringify({ sessionId: '0c453c', location: 'apgo-gift-reconciler.js', message: message, data: data, timestamp: Date.now() })
      }).catch(function () {});
    } catch (e) {}
  }
  // #endregion

  function reconcile(eventCart) {
    if (running) return Promise.resolve();
    if (!window.APGO_GIFT_MAP || Object.keys(window.APGO_GIFT_MAP).length === 0) {
      return Promise.resolve();
    }
    running = true;
    /* Fast path: use cart from the triggering cart:update event when
       available (Horizon passes it in event.detail.resource). Saves one
       ~200ms round-trip. Fall back to fetching when not provided. */
    var cartPromise = eventCart && eventCart.items
      ? Promise.resolve(eventCart)
      : fetch('/cart.js?_=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); });
    return cartPromise
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

        /* Find all existing gift lines (lines carrying our _free_gift property). */
        var existingGifts = [];
        cart.items.forEach(function (item) {
          if (item.properties && item.properties._free_gift === 'true') existingGifts.push(item);
        });

        /* Diagnostic snapshot — visible in browser console so users hitting
           "Y qty doesn't match X" issues can share what the reconciler saw. */
        console.info('[apgo-gift] reconcile snapshot', {
          xQtyInCart: currentXQty,
          desiredY: Object.keys(desired).reduce(function (acc, k) {
            acc[k] = desired[k].qty; return acc;
          }, {}),
          existingYLines: existingGifts.map(function (g) {
            return { variant_id: g.variant_id, qty: g.quantity, key: g.key };
          })
        });

        /*
          Build a SINGLE /cart/update.js payload that batches:
            - dedupe duplicates (set qty 0)
            - update existing Y qty
            - remove stale gifts
          /cart/update.js returns the full updated cart in one round-trip,
          replacing the previous fetch → multiple POSTs → re-fetch chain.

          Only one operation can't be batched: ADD a new gift line that
          doesn't exist yet (need /cart/add.js). Rare on the cart page —
          most flows already have the gift line from the PDP atomic add.
        */
        var updates = {}; /* { line_key: qty } */
        var newAdds = []; /* gift lines that need /cart/add.js */

        /* Dedupe pass — same variant in multiple gift lines: keep first, rest → 0 */
        var seenGiftVariants = {};
        existingGifts.forEach(function (g) {
          if (seenGiftVariants[g.variant_id]) {
            updates[g.key] = 0; /* dup */
          } else {
            seenGiftVariants[g.variant_id] = g;
          }
        });
        var canonicalGifts = Object.keys(seenGiftVariants).map(function (k) { return seenGiftVariants[k]; });

        Object.keys(desired).forEach(function (giftIdStr) {
          var giftId = parseInt(giftIdStr, 10);
          var spec = desired[giftIdStr];
          var existing = canonicalGifts.find(function (e) { return e.variant_id === giftId; });
          if (!existing) {
            newAdds.push({ giftId: giftId, spec: spec });
          } else if (existing.quantity !== spec.qty) {
            console.info('[apgo-gift] queue CHANGE Y qty', { from: existing.quantity, to: spec.qty, key: existing.key });
            updates[existing.key] = spec.qty;
          }
        });

        /* Prune: existing gift with no triggering X → set qty 0 */
        canonicalGifts.forEach(function (g) {
          if (!desired[g.variant_id]) {
            updates[g.key] = 0;
          }
        });

        var hasUpdates = Object.keys(updates).length > 0;
        var hasAdds = newAdds.length > 0;
        // #region agent log
        __dbg('reconcile-plan', {
          hyp: 'H-A/H-B',
          xQty: currentXQty,
          desiredY: Object.keys(desired).reduce(function (a, k) { a[k] = desired[k].qty; return a; }, {}),
          existingYLines: existingGifts.map(function (g) { return { vid: g.variant_id, qty: g.quantity, key: g.key }; }),
          updates: updates,
          newAdds: newAdds.map(function (a) { return { giftId: a.giftId, qty: a.spec.qty }; }),
          willActUpdate: hasUpdates, willActAdd: hasAdds, itemCount: cart.item_count
        });
        // #endregion
        if (!hasUpdates && !hasAdds) {
          return cart; /* nothing to do — cart already in sync */
        }
        // #region agent log
        var __t0 = Date.now();
        // #endregion

        /* Step 1: batch updates in single /cart/update.js call. */
        var batchUpdate = hasUpdates
          ? fetch('/cart/update.js', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ updates: updates })
            }).then(function (r) {
              if (!r.ok) {
                return r.json().then(function (j) {
                  console.warn('[apgo-gift] /cart/update.js FAILED', r.status, j);
                  return null;
                });
              }
              return r.json();
            }).catch(function (e) {
              console.warn('[apgo-gift] /cart/update.js NETWORK ERROR', e);
              return null;
            })
          : Promise.resolve(cart);

        /* Step 2: add any new gift lines (rare). Sequential to keep Shopify
           cart state predictable. */
        return batchUpdate.then(function (batchCart) {
          var newCart = batchCart || cart;
          if (!hasAdds) return newCart;
          var addChain = Promise.resolve(newCart);
          newAdds.forEach(function (a) {
            addChain = addChain.then(function () {
              console.info('[apgo-gift] ADD Y', { giftId: a.giftId, qty: a.spec.qty });
              var fd = new FormData();
              fd.append('id', String(a.giftId));
              fd.append('quantity', String(a.spec.qty));
              fd.append('properties[_free_gift]', 'true');
              fd.append('properties[_gift_for]', String(a.spec.xVariantId));
              if (a.spec.xTitle) fd.append('properties[_gift_from_product]', a.spec.xTitle);
              return fetch('/cart/add.js', {
                method: 'POST', headers: { Accept: 'application/json' }, body: fd
              }).then(function (r) {
                if (!r.ok) {
                  return r.json().then(function (j) {
                    console.warn('[apgo-gift] ADD Y FAILED', r.status, j);
                    return null;
                  });
                }
                return r.json();
              }).then(function () {
                /* Only re-fetch after the LAST add so we have authoritative cart */
                if (a === newAdds[newAdds.length - 1]) {
                  return fetch('/cart.js?_=' + Date.now(), { cache: 'no-store' })
                    .then(function (r) { return r.json(); });
                }
                return newCart;
              }).catch(function () { return newCart; });
            });
          });
          return addChain;
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
          // #region agent log
          __dbg('reconcile-done', {
            hyp: 'H-A/H-D',
            finalItemCount: newCart && newCart.item_count,
            finalGiftLines: (newCart && newCart.items || []).filter(function (i) {
              return i.properties && i.properties._free_gift === 'true';
            }).map(function (i) { return { vid: i.variant_id, qty: i.quantity }; }),
            msSincePlan: Date.now() - __t0
          });
          // #endregion
          return newCart;
        });
      })
      .catch(function (err) { console.warn('[apgo-gift] reconcile failed', err); })
      .then(function (result) { running = false; return result; });
  }

  /* Public entry — debounced through requestAnimationFrame. Stashes the
     most recent cart from event.detail.resource so the actual reconcile
     can skip the initial fetch and start with that data. */
  function schedule(cartFromEvent) {
    if (cartFromEvent) pendingCart = cartFromEvent;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      var cart = pendingCart;
      pendingCart = null;
      reconcile(cart);
    });
  }
  window.apgoReconcileFreeGifts = function () {
    /* Bypass debounce on direct call — caller awaits the promise */
    return reconcile();
  };

  /* ------------------------------------------------------------------
     Atomic gift merge — eliminates the two-stage render flicker.

     Horizon's <cart-items-component> changes an X line with a single
     POST /cart/change ({line, quantity, sections, sections_url}) and then
     morphs the returned section HTML. Because the free gift Y lives on a
     SEPARATE line, the gift only gets corrected by the async reconcile that
     runs AFTER that render — so the user briefly sees X updated but Y stale
     (wrong qty / wrong BXGY price) and, on decrease, a transient duplicate
     gift row before dedupe.

     Fix: intercept that /cart/change for an X line and rewrite it into ONE
     /cart/update.js that sets BOTH the X line and its gift line(s) at once
     (forwarding `sections` so the native morph still works). The cart then
     renders a single time already in sync; the later reconcile sees nothing
     to do and never triggers a second render.

     Only the common case (gift line already present, not dismissed) is
     merged; first-time gift creation still falls through to the reconciler's
     /cart/add.js path. */
  (function installAtomicGiftMerge() {
    var CHANGE_RE = /\/cart\/change(\.js)?(\?|$)/i;
    var UPDATE_URL = (window.Theme && Theme.routes && Theme.routes.cart_update_url) || '/cart/update.js';
    var _origFetch = window.fetch;

    function planMergedUpdate(parsed) {
      return _origFetch.call(window, '/cart.js', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (cart) {
          var items = cart.items || [];
          var changed = items[parsed.line - 1];
          if (!changed) return null;
          if (changed.properties && changed.properties._free_gift === 'true') return null;
          if (!window.APGO_GIFT_MAP[changed.variant_id]) return null; /* not an X line */
          var giftId = parseInt(window.APGO_GIFT_MAP[changed.variant_id], 10);

          /* qty going up re-arms a dismissed gift (matches reconcile logic) */
          if (parsed.quantity > changed.quantity) clearGiftDismissed(changed.variant_id);
          if (isGiftDismissed(changed.variant_id)) return null; /* let normal flow handle */

          /* desired Y = total qty of all non-gift lines mapping to this gift,
             using the NEW quantity for the changed line (1:1 X→Y). */
          var desiredY = 0;
          items.forEach(function (it, i) {
            if (it.properties && it.properties._free_gift === 'true') return;
            if (parseInt(window.APGO_GIFT_MAP[it.variant_id], 10) !== giftId) return;
            desiredY += (i === parsed.line - 1) ? parsed.quantity : it.quantity;
          });

          var giftLines = items.filter(function (it) {
            return it.properties && it.properties._free_gift === 'true' && it.variant_id === giftId;
          });
          if (giftLines.length === 0) return null; /* need ADD → reconciler handles it */

          var updates = {};
          updates[changed.key] = parsed.quantity;
          updates[giftLines[0].key] = desiredY;
          for (var j = 1; j < giftLines.length; j++) updates[giftLines[j].key] = 0; /* dedupe dups */

          // #region agent log
          __dbg('atomic-merge', { hyp: 'FIX', line: parsed.line, newX: parsed.quantity, desiredY: desiredY, updates: updates });
          // #endregion

          return {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              updates: updates,
              sections: parsed.sections,
              sections_url: parsed.sections_url
            })
          };
        })
        .catch(function () { return null; });
    }

    window.fetch = function (input, init) {
      try {
        var url = String((input && input.url) || input || '');
        var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (method === 'POST' && CHANGE_RE.test(url) &&
            window.APGO_GIFT_MAP && Object.keys(window.APGO_GIFT_MAP).length &&
            init && typeof init.body === 'string') {
          var parsed = null;
          try { parsed = JSON.parse(init.body); } catch (_) {}
          if (parsed && typeof parsed.line === 'number' && typeof parsed.quantity === 'number') {
            var self = this;
            return planMergedUpdate(parsed).then(function (mergedInit) {
              if (!mergedInit) return _origFetch.call(self, input, init);
              return _origFetch.call(self, UPDATE_URL, mergedInit);
            });
          }
        }
      } catch (e) {}
      return _origFetch.apply(this, arguments);
    };
  })();

  /* Listen for cart updates from anywhere (quick-add, cart drawer, PDP,
     apps that dispatch the standard event). Skip our own events. */
  document.addEventListener('cart:update', function (ev) {
    if (selfDispatching) return;
    if (ev && ev.detail && ev.detail.data && ev.detail.data.source === 'apgo-gift-reconciler') return;
    /* Pass through event.detail.resource (Horizon's contract) so the
       reconciler can skip the initial cart fetch. */
    var resourceCart = ev && ev.detail && ev.detail.resource;
    schedule(resourceCart);
  });
  document.addEventListener('cart:updated', function (ev) {
    if (selfDispatching) return;
    var resourceCart = ev && ev.detail && (ev.detail.resource || ev.detail.cart);
    schedule(resourceCart);
  });
})();
