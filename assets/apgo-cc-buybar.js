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
  /* Market-aware: prefer the cart's currency (set after fetch), then the
     PDP section's data-apgo-currency attribute, then Shopify.currency.active.
     Fall back to TWD only as a last resort. Format via Intl.NumberFormat. */
  var currentCartCurrency = null;
  function getActiveCurrency() {
    if (currentCartCurrency) return currentCartCurrency;
    var sec = document.querySelector('[data-apgo-currency]');
    if (sec && sec.dataset.apgoCurrency) return sec.dataset.apgoCurrency;
    if (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) {
      return window.Shopify.currency.active;
    }
    return 'TWD';
  }
  function formatMoney(cents, currency) {
    var ccy = currency || getActiveCurrency();
    var noDecimal = ccy === 'TWD' || ccy === 'JPY' || ccy === 'KRW' || ccy === 'VND';
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: ccy,
        minimumFractionDigits: noDecimal ? 0 : 2,
        maximumFractionDigits: noDecimal ? 0 : 2
      }).format(Number(cents) / 100);
    } catch (e) {
      return ccy + ' ' + (Number(cents) / 100).toFixed(noDecimal ? 0 : 2);
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Rich success toast: checkmark + product title + sub line + View Cart pill + close button.
     Visual: snippets/apgo-cart-toast.liquid (.apgo-cart-success-toast*).
     Same component the collection-page quick-add uses, so PDP buybar feedback
     looks identical across the storefront. */
  function showSuccessToast(title, sub) {
    /* Tear down any previous instance so re-triggers don't stack */
    document.querySelectorAll('.apgo-cart-success-toast').forEach(function (n) { n.remove(); });

    var el = document.createElement('div');
    el.className = 'apgo-cart-success-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = ''
      + '<span class="apgo-cart-success-toast__check" aria-hidden="true">'
      + '  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.25 4.75L6.5 12.25L2.75 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + '</span>'
      + '<div class="apgo-cart-success-toast__body">'
      + '  <span class="apgo-cart-success-toast__title">' + escapeHtml(title) + '</span>'
      + '  <span class="apgo-cart-success-toast__sub">' + escapeHtml(sub) + '</span>'
      + '</div>'
      + '<a href="/cart" class="apgo-cart-success-toast__cta">View Cart</a>'
      + '<button type="button" class="apgo-cart-success-toast__close" aria-label="Close">'
      + '  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1L11 11M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
      + '</button>';

    el.querySelector('.apgo-cart-success-toast__close').addEventListener('click', function () { el.remove(); });
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('apgo-cart-success-toast--visible'); });
    setTimeout(function () {
      el.classList.remove('apgo-cart-success-toast--visible');
      setTimeout(function () { el.remove(); }, 380);
    }, 4200);
  }

  /* Back-compat shim: existing call sites used showToast(msg). When called
     with a single string we treat it as the title row and leave the sub blank.
     For the success path we now prefer showSuccessToast(productTitle, sub). */
  function showToast(msg) { showSuccessToast(msg, ''); }

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
    /* Cache the cart's currency (e.g. "MYR", "SGD", "TWD") so subsequent
       formatMoney() calls render with the right symbol/decimals. */
    if (cart.currency) currentCartCurrency = cart.currency;
    var count = cart.item_count || 0;
    var total = cart.total_price || 0;
    var subtotal = cart.items_subtotal_price != null ? cart.items_subtotal_price : total;

    Array.prototype.forEach.call(countEls,     function (el) { el.textContent = count; });
    Array.prototype.forEach.call(chipTotalEls, function (el) { el.textContent = formatMoney(total, cart.currency); });
    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal, cart.currency);

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
      price.textContent = formatMoney(item.final_line_price != null ? item.final_line_price : item.line_price, cart.currency);
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

  /* ---------- Add / Buy buttons ----------
     New flow (May 2026 refactor): the buybar's Add and Buy buttons no longer
     commit the cart directly. Instead they open the confirm modal exposed by
     the PDP (window.apgoOpenConfirmModal) so the customer re-confirms variant,
     quantity, and sees the active variation contents before final commit. The
     modal handles the actual /cart/add.js call, toast, redirect, etc. */
  function openConfirm(intent, sourceBtn) {
    if (typeof window.apgoOpenConfirmModal === 'function') {
      window.apgoOpenConfirmModal(intent);
      return;
    }
    /* Fallback: if the PDP modal isn't present on this page (shouldn't happen
       on PDP, but be defensive), fall back to the legacy direct-add path. */
    var fd = buildAddPayload();
    if (!fd) { showToast('Please select a variant first', false); return; }
    /* Button-level lock so a fast double-click on the buybar Add/Buy
       button in this fallback path can't fire two /cart/add.js POSTs
       in parallel. Matches the pattern used by apgo-cc-pdp-picker. */
    if (sourceBtn) sourceBtn.disabled = true;
    fetch('/cart/add.js', { method: 'POST', headers: { 'Accept': 'application/json' }, body: fd })
      .then(function (r) { return r.json(); })
      .then(function () {
        if (intent === 'buy') { window.location.href = '/cart'; return; }
        return fetchCart().then(function (cart) {
          renderCart(cart);
          document.dispatchEvent(new CustomEvent('cart:updated'));
          var t = document.querySelector('.apgo-product-name');
          showSuccessToast((t && t.textContent.trim()) || 'Item added', 'Added to cart');
        });
      })
      .catch(function (err) {
        showToast((err && err.description) || 'Failed to add. Please try again.', false);
      })
      .finally(function () {
        /* Buy-now navigates away in the .then() above, so this .finally()
           only meaningfully runs for the 'add' path — but calling it in
           both cases is harmless. */
        if (sourceBtn) sourceBtn.disabled = false;
      });
  }

  if (addBtn) {
    addBtn.addEventListener('click', function () {
      if (addBtn.disabled) return;
      openConfirm('add', addBtn);
    });
  }
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', function () {
      if (checkoutBtn.disabled) return;
      openConfirm('buy', checkoutBtn);
    });
  }
})();
