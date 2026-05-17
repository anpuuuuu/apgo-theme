/* APGO Car Care PDP — Mobile Sticky Buy Bar
 *
 * Behaviour:
 *  - Collapsed: hint text + count/total chip + add/buy buttons
 *  - Expanded: backdrop + sheet with cart items + subtotal
 *  - Tap handle / chip → toggle. Tap backdrop / 下拉收起 / Esc → close.
 *  - Swipe up on top row ≥40px (closed) → open; swipe down ≥60px (open) → close.
 *  - On boot: fetch /cart.js → render. Listens to cart:updated / cart:update.
 *  - On add: POST /cart/add.js with FormData from .apgo-cc-pdp__form,
 *           refetch /cart.js, render, dispatch (cart:update, cart:updated,
 *           cart:refresh + try Horizon CartUpdateEvent / CartAddEvent),
 *           auto-open the sheet.
 *  - 立即購買 → window.location = '/cart' (lets user verify discounts).
 */
(function () {
  'use strict';

  var bar = document.querySelector('[data-apgo-cc-buybar]');
  if (!bar) return;

  /* The inline picker form on the PDP — wraps variant chips, qty, hidden id input.
     Required for add-to-cart to know which variant. If missing, add button is no-op. */
  var form = document.querySelector('.apgo-cc-pdp__form');

  // ---------- Element refs ----------
  var backdrop     = bar.querySelector('[data-apgo-cc-buybar-backdrop]');
  var sheet        = bar.querySelector('[data-apgo-cc-buybar-sheet]');
  var handle       = bar.querySelector('[data-apgo-cc-buybar-handle]');
  var closeBtn     = bar.querySelector('[data-apgo-cc-buybar-close]');
  var chipEls      = bar.querySelectorAll('[data-apgo-cc-buybar-chip]');
  var countEls     = bar.querySelectorAll('[data-apgo-cc-buybar-count]');
  var chipTotalEls = bar.querySelectorAll('[data-apgo-cc-buybar-chip-total]');
  var itemsEl      = bar.querySelector('[data-apgo-cc-buybar-items]');
  var emptyEl      = bar.querySelector('[data-apgo-cc-buybar-empty]');
  var subtotalEl   = bar.querySelector('[data-apgo-cc-buybar-subtotal]');
  var addBtn       = bar.querySelector('[data-apgo-cc-buybar-add]');
  var checkoutBtn  = bar.querySelector('[data-apgo-cc-buybar-checkout]');

  // ---------- Money formatter ----------
  function formatMoney(cents) {
    if (window.Shopify && typeof window.Shopify.formatMoney === 'function') {
      var fmt = (window.theme && window.theme.moneyFormat) || 'NT${{amount}}';
      try { return window.Shopify.formatMoney(cents, fmt); } catch (e) {}
    }
    var n = Number(cents) / 100;
    return 'NT$ ' + n.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  // ---------- Toast (reuse if .apgo-cc-toast styled; otherwise minimal) ----------
  var toastEl = null;
  function showToast(msg, ok) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'apgo-cc-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.toggle('apgo-cc-toast--err', ok === false);
    toastEl.classList.add('is-visible');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () {
      toastEl.classList.remove('is-visible');
    }, 2200);
  }

  // ---------- Open / close sheet ----------
  function open() {
    bar.classList.add('is-open');
    if (sheet) sheet.setAttribute('aria-hidden', 'false');
    if (backdrop) backdrop.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
  }
  function close() {
    bar.classList.remove('is-open');
    if (sheet) sheet.setAttribute('aria-hidden', 'true');
    if (backdrop) backdrop.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
  }
  function toggle() {
    if (bar.classList.contains('is-open')) close();
    else open();
  }

  if (handle)   handle.addEventListener('click', toggle);
  Array.prototype.forEach.call(chipEls, function (c) {
    c.addEventListener('click', function (e) {
      /* The chip inside the top row is already inside `handle`, so its click
         bubbles → handle's listener also fires. stopPropagation prevents
         double-toggle. The sheet-head chip needs its own toggle. */
      if (handle && handle.contains(c)) { e.stopPropagation(); }
      toggle();
    });
  });
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (backdrop) backdrop.addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && bar.classList.contains('is-open')) close();
  });

  // ---------- Touch drag ----------
  (function wireDrag() {
    if (!handle) return;
    var startY = 0;
    var moved = false;

    function onStart(e) {
      var t = e.touches ? e.touches[0] : e;
      startY = t.clientY;
      moved = false;
    }
    function onMove(e) {
      var t = e.touches ? e.touches[0] : e;
      var dy = t.clientY - startY;
      if (Math.abs(dy) > 10) moved = true;
    }
    function onEnd(e) {
      if (!moved) return;
      var t = (e.changedTouches && e.changedTouches[0]) || e;
      var dy = t.clientY - startY;
      if (dy <= -40 && !bar.classList.contains('is-open')) open();
      else if (dy >=  60 &&  bar.classList.contains('is-open')) close();
    }

    handle.addEventListener('touchstart', onStart, { passive: true });
    handle.addEventListener('touchmove',  onMove,  { passive: true });
    handle.addEventListener('touchend',   onEnd);

    var sheetHead = bar.querySelector('.apgo-cc-buybar__sheet-head');
    if (sheetHead) {
      sheetHead.addEventListener('touchstart', onStart, { passive: true });
      sheetHead.addEventListener('touchmove',  onMove,  { passive: true });
      sheetHead.addEventListener('touchend',   onEnd);
    }
  })();

  // ---------- Cart fetch + render ----------
  function fetchCart() {
    return fetch('/cart.js?_=' + Date.now(), {
      cache: 'no-store',
      headers: { 'Accept': 'application/json' }
    }).then(function (r) { return r.json(); });
  }

  function renderCart(cart) {
    if (!cart) return;
    var count = cart.item_count || 0;
    var total = cart.total_price || 0;
    var subtotal = cart.items_subtotal_price != null ? cart.items_subtotal_price : total;

    Array.prototype.forEach.call(countEls,     function (el) { el.textContent = count; });
    Array.prototype.forEach.call(chipTotalEls, function (el) { el.textContent = formatMoney(total); });
    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal);

    if (!cart.items || cart.items.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      Array.prototype.slice.call(itemsEl.children).forEach(function (c) {
        if (c !== emptyEl) c.remove();
      });
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    Array.prototype.slice.call(itemsEl.children).forEach(function (c) {
      if (c !== emptyEl) c.remove();
    });

    cart.items.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'apgo-cc-buybar__item';

      var thumb = document.createElement('div');
      thumb.className = 'apgo-cc-buybar__item-thumb';
      if (item.image) {
        var img = document.createElement('img');
        img.src = item.image.replace(/(\.[a-z]+)(\?|$)/i, '_80x$1$2');
        img.alt = item.product_title || '';
        img.loading = 'lazy';
        thumb.appendChild(img);
      }
      row.appendChild(thumb);

      var info = document.createElement('div');
      info.className = 'apgo-cc-buybar__item-info';
      var name = document.createElement('div');
      name.className = 'apgo-cc-buybar__item-name';
      var title = item.product_title || item.title || '';
      if (item.variant_title && item.variant_title !== 'Default Title') {
        title += ' ' + item.variant_title;
      }
      name.textContent = title;
      var qty = document.createElement('div');
      qty.className = 'apgo-cc-buybar__item-qty';
      qty.textContent = '×' + item.quantity;
      info.appendChild(name);
      info.appendChild(qty);
      row.appendChild(info);

      var price = document.createElement('div');
      price.className = 'apgo-cc-buybar__item-price';
      price.textContent = formatMoney(item.final_line_price != null ? item.final_line_price : item.line_price);
      row.appendChild(price);

      itemsEl.appendChild(row);
    });
  }

  function refreshCart() {
    fetchCart().then(renderCart).catch(function (err) {
      console.warn('[apgo-cc-buybar] cart fetch failed:', err);
    });
  }

  // Initial cart load
  refreshCart();

  // Sync when other code updates the cart
  document.addEventListener('cart:updated', refreshCart);
  document.addEventListener('cart:update', function (e) {
    if (e && e.detail && e.detail.cart) renderCart(e.detail.cart);
    else refreshCart();
  });

  /* Build payload from .apgo-cc-pdp__form when present (Phase 2). Otherwise
     fall back to APGO v3's existing globals (window.currentVariantId set by
     apgoSelectVariant() in apgo_product_page_v3.liquid) + the modal's qty value. */
  function buildAddPayload() {
    if (form) return new FormData(form);
    var variantId = window.currentVariantId;
    if (!variantId) {
      /* Last-ditch fallback: read from .apgo-variant-option.selected dataset */
      var sel = document.querySelector('.apgo-variant-option.selected');
      if (sel && sel.dataset && sel.dataset.variantId) variantId = sel.dataset.variantId;
    }
    if (!variantId) return null;
    var qtyEl = document.querySelector('.apgo-quantity-value');
    var qty = qtyEl ? parseInt(qtyEl.textContent, 10) || 1 : 1;
    var fd = new FormData();
    fd.append('id', String(variantId));
    fd.append('quantity', String(qty));
    return fd;
  }

  // ---------- Add to cart ----------
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      if (addBtn.disabled) return;
      var fd = buildAddPayload();
      if (!fd) {
        showToast('請先選擇商品規格', false);
        return;
      }

      var orig = addBtn.textContent;
      addBtn.disabled = true;
      addBtn.textContent = '加入中…';

      fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: fd
      })
        .then(function (r) {
          return r.json().then(function (data) {
            if (!r.ok) return Promise.reject(data);
            return data;
          });
        })
        .then(function () { return fetchCart(); })
        .then(function (cart) {
          renderCart(cart);

          /* Three flavours of cart-update events for cross-theme compatibility */
          document.dispatchEvent(new CustomEvent('cart:update', { detail: { cart: cart } }));
          document.documentElement.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true, detail: { cart: cart } }));
          document.dispatchEvent(new CustomEvent('cart:updated'));

          /* Horizon themes ship a typed event module; try to dispatch its events too */
          try {
            import('@theme/events').then(function (mod) {
              if (mod && mod.CartUpdateEvent) {
                document.dispatchEvent(new mod.CartUpdateEvent(cart, 'apgo-cc-buybar', {
                  itemCount: cart.item_count, source: 'apgo-cc-buybar', sections: {}
                }));
              }
              if (mod && mod.CartAddEvent) {
                document.dispatchEvent(new mod.CartAddEvent({}, 'apgo-cc-buybar', { source: 'apgo-cc-buybar' }));
              }
            }).catch(function () {});
          } catch (_) {}

          showToast('✓ 已加入購物車');
          addBtn.disabled = false;
          addBtn.textContent = orig;

          if (!bar.classList.contains('is-open')) open();
        })
        .catch(function (err) {
          console.error('[apgo-cc-buybar] add failed:', err);
          var msg = (err && err.description) || (err && err.message) || '加入失敗，請稍後再試';
          showToast(msg, false);
          addBtn.disabled = false;
          addBtn.textContent = orig;
        });
    });
  }

  // ---------- 立即購買 → /cart (not /checkout) ----------
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', function () {
      window.location.href = '/cart';
    });
  }
})();
