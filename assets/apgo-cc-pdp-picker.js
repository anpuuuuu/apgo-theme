(function () {
  'use strict';
  var form = document.querySelector('.apgo-cc-pdp__form');
  if (!form) return;

  var dataEl = document.querySelector('[data-apgo-cc-variants]');
  var variants = [];
  try { variants = JSON.parse((dataEl && dataEl.textContent) || '[]'); } catch (e) {}

  /* Server-emitted inventory map { variant_id: qty | null }.
     Used to enrich the variants array with inventory_quantity (which
     Shopify strips from the public variants JSON for privacy). */
  var invEl = document.querySelector('[data-apgo-cc-inventory]');
  var inventoryMap = {};
  try { inventoryMap = JSON.parse((invEl && invEl.textContent) || '{}'); } catch (e) {}
  /* Merge inventory into the variants array so curV.inventory_quantity
     works downstream without callers needing to know about the map. */
  variants.forEach(function (vv) {
    var key = String(vv.id);
    if (Object.prototype.hasOwnProperty.call(inventoryMap, key)) {
      vv.inventory_quantity = inventoryMap[key];
    }
  });
  var APGO_LOW_STOCK_THRESHOLD = 10;

  var idInput   = form.querySelector('[data-apgo-cc-variant-id]');
  var priceEl   = document.querySelector('[data-apgo-cc-price]');
  var compareEl = document.querySelector('[data-apgo-cc-compare]');
  var saveEl    = document.querySelector('[data-apgo-cc-save]');
  var addBtn    = form.querySelector('[data-apgo-cc-add]');
  var buyBtn    = form.querySelector('[data-apgo-cc-buy-now]');
  var qtyInput  = form.querySelector('[data-apgo-cc-qty-input]');

  /* Market-aware money formatter: read currency code from .apgo-product-section[data-apgo-currency]
     (Shopify sets this from {{ cart.currency.iso_code }}), then format via Intl.NumberFormat.
     Falls back to TWD only if both the data attribute and Shopify global are unavailable. */
  function getActiveCurrency() {
    var sec = document.querySelector('[data-apgo-currency]');
    if (sec && sec.dataset.apgoCurrency) return sec.dataset.apgoCurrency;
    if (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) {
      return window.Shopify.currency.active;
    }
    return 'TWD';
  }
  function fmtMoney(cents, currency) {
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

  function currentOptionValues() {
    var out = [];
    form.querySelectorAll('[data-apgo-cc-option-group]').forEach(function (g) {
      var checked = g.querySelector('input[type="radio"]:checked');
      out.push(checked ? checked.value : null);
    });
    return out;
  }

  function findVariant(opts) {
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      if (!v.options) continue;
      var match = true;
      for (var j = 0; j < opts.length; j++) {
        if (v.options[j] !== opts[j]) { match = false; break; }
      }
      if (match) return v;
    }
    return null;
  }

  function syncChipsActive() {
    form.querySelectorAll('[data-apgo-cc-option-group]').forEach(function (g) {
      var checked = g.querySelector('input[type="radio"]:checked');
      g.querySelectorAll('.apgo-cc-pdp__chip').forEach(function (chip) {
        var input = chip.querySelector('input[type="radio"]');
        chip.classList.toggle('is-active', !!input && input === checked);
      });
      var cur = g.querySelector('[data-apgo-cc-option-current]');
      if (cur && checked) cur.textContent = checked.value;
    });
  }

  /*
    Build per-variant sections from the raw metafield text emitted as JSON
    in a <script type="application/json" data-apgo-cc-variation-source>.
    Splitting in JS (regex /\n\s*\n/) is more forgiving than Liquid's exact
    `split: '<br /><br />'`, which can miss blank-line separators that have
    trailing whitespace or use CRLF line endings.
    Runs once at boot, before the first refreshVariant() call.
  */
  function escapeHtmlText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function buildVariationSections() {
    var sourceEl = document.querySelector('[data-apgo-cc-variation-source]');
    var sectionsRoot = document.querySelector('[data-apgo-cc-variation-sections]');
    if (!sourceEl || !sectionsRoot) return;
    if (sectionsRoot.children.length > 0) return; /* already built */
    var raw;
    try { raw = JSON.parse(sourceEl.textContent); } catch (e) { return; }
    if (typeof raw !== 'string' || !raw.trim()) return;

    /* Normalise line endings, split on blank lines (any whitespace allowed) */
    var normalised = raw.replace(/\r\n?/g, '\n').trim();
    var rawSections = normalised.split(/\n\s*\n/);

    rawSections.forEach(function (sec) {
      var trimmed = sec.trim();
      if (!trimmed) return;
      var firstLine = trimmed.split('\n')[0].trim();
      var div = document.createElement('div');
      div.className = 'apgo-cc-pdp__variation-section apgo-cc-pdp__variation-body';
      div.setAttribute('data-variant-key', firstLine.toLowerCase());
      /* No longer hidden: every section is always visible. Active state is
         a class toggle that bumps text colour up to white. */
      /* HTML-escape, then convert \n → <br/> for visual line breaks */
      div.innerHTML = escapeHtmlText(trimmed).replace(/\n/g, '<br/>');
      sectionsRoot.appendChild(div);
    });
  }
  buildVariationSections();

  function refreshVariant() {
    var opts = currentOptionValues();
    var v = findVariant(opts);
    syncChipsActive();
    if (!v) return;

    if (idInput) idInput.value = v.id;
    window.currentVariantId = v.id;
    if (priceEl) priceEl.textContent = fmtMoney(v.price);

    /* Compare-at + save badge — only shown when compare > price */
    if (compareEl) {
      if (v.compare_at_price && v.compare_at_price > v.price) {
        compareEl.textContent = fmtMoney(v.compare_at_price);
        compareEl.style.display = '';
      } else {
        compareEl.style.display = 'none';
      }
    }
    if (saveEl) {
      if (v.compare_at_price && v.compare_at_price > v.price) {
        saveEl.textContent = 'Save ' + fmtMoney(v.compare_at_price - v.price);
        saveEl.style.display = '';
      } else {
        saveEl.style.display = 'none';
      }
    }

    /* Disable add button if variant not available */
    if (addBtn) {
      addBtn.disabled = !v.available;
      addBtn.textContent = v.available ? 'Add to cart' : 'Sold out';
    }
    if (buyBtn) buyBtn.disabled = !v.available;

    /*
      Inline shipping-row stock indicator (right of "2–3 business days").
      Variant-aware — uses the per-variant available + inventory_quantity
      we merged from the server-emitted inventory map. Three states:
        > APGO_LOW_STOCK_THRESHOLD → "● In stock"          (green)
        1..threshold                → "● Only N left"      (orange)
        ≤0 or !available            → "● Out of stock"     (red)
      Untracked variants fall back to "● In stock" (no count to show).
    */
    var inlineStockEl = document.querySelector('[data-apgo-cc-inline-stock]');
    if (inlineStockEl) {
      var iqty = v.inventory_quantity;
      var hasQty = typeof iqty === 'number';
      inlineStockEl.classList.remove(
        'apgo-cc-pdp__shipping-stock--out',
        'apgo-cc-pdp__shipping-stock--low'
      );
      if (!v.available || (hasQty && iqty <= 0)) {
        inlineStockEl.textContent = '● Out of stock';
        inlineStockEl.classList.add('apgo-cc-pdp__shipping-stock--out');
      } else if (hasQty && iqty <= APGO_LOW_STOCK_THRESHOLD) {
        inlineStockEl.textContent = '● Only ' + iqty + ' left';
        inlineStockEl.classList.add('apgo-cc-pdp__shipping-stock--low');
      } else {
        inlineStockEl.textContent = '● In stock';
      }
    }

    /*
      Swap the main gallery image to the variant's featured image.
      Shopify exposes variant.featured_image with .position (1-indexed,
      matching its place in product.images). The carousel slides are
      rendered in that same order, so goToSlide(position - 1) lands on it.
      Also sync the thumbnail strip's active highlight so it visually
      follows the variant switch.
    */
    var fimg = v.featured_image || v.featured_media || null;
    var pos = fimg && (fimg.position || (fimg.preview_image && fimg.preview_image.position));
    if (pos && window.apgoCarousel && typeof window.apgoCarousel.goToSlide === 'function') {
      var slideIdx = pos - 1;
      window.apgoCarousel.goToSlide(slideIdx);
      document.querySelectorAll('.apgo-thumbnail-item').forEach(function (t, i) {
        t.classList.toggle('active', i === slideIdx);
      });
    }

    /*
      Variant-aware Variation block.
      Strict positional mapping: variant N → section N.
      Token-overlap matching was tried earlier but produced surprising
      results when section names share many words with variants other than
      their own (e.g. "Atomic Coating Bundle" variant scoring higher against
      "Atomic Coating 360° Bundle" section than against its real match).
      Positional is deterministic and easy for admin to reason about:
      write the metafield sections in the SAME ORDER as the variants in
      the Shopify product editor, separated by blank lines.
      Clamps to the first section if variants outnumber sections.
    */
    var sectionsRoot = document.querySelector('[data-apgo-cc-variation-sections]');
    if (sectionsRoot) {
      var sections = Array.prototype.slice.call(
        sectionsRoot.querySelectorAll('.apgo-cc-pdp__variation-section')
      );
      var variantIdx = variants.indexOf(v);
      var targetIdx = (variantIdx >= 0 && variantIdx < sections.length) ? variantIdx : 0;
      sections.forEach(function (s, i) { s.classList.toggle('is-active', i === targetIdx); });
    }
  }

  form.querySelectorAll('input[type="radio"][data-apgo-cc-option-input]').forEach(function (r) {
    r.addEventListener('change', refreshVariant);
  });
  /*
    Backup: bind click directly on the chip <label> too. Some browsers/CSS
    combinations (pointer-events:none on the wrapped radio + opacity:0) can
    fail to fire `change` on the input when the label is tapped, especially
    on iOS. Catching the click here, manually flipping the radio's checked
    state, then calling refreshVariant() guarantees the section actually
    switches.
  */
  form.querySelectorAll('.apgo-cc-pdp__chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var input = chip.querySelector('input[type="radio"][data-apgo-cc-option-input]');
      if (!input || input.checked) return;
      /* Uncheck siblings in the same option group first */
      var group = chip.closest('[data-apgo-cc-option-group]');
      if (group) {
        group.querySelectorAll('input[type="radio"][data-apgo-cc-option-input]').forEach(function (r) {
          r.checked = false;
        });
      }
      input.checked = true;
      refreshVariant();
    });
  });

  /*
    Mobile-only: tapping anywhere inside the inline option-group (label or any
    chip) opens the confirm modal with intent='both' so the user picks variant +
    qty + commits via Add/Buy from the modal. Capture-phase + preventDefault to
    swallow the click before the chip's own click handler / the radio's change
    event fires, so the inline radio doesn't flip behind the user's back.
    Desktop is untouched — the inline chips remain the direct selection control.
  */
  form.querySelectorAll('[data-apgo-cc-option-group]').forEach(function (g) {
    g.addEventListener('click', function (e) {
      if (!window.matchMedia || !window.matchMedia('(max-width: 1023px)').matches) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof window.apgoOpenConfirmModal === 'function') window.apgoOpenConfirmModal('both');
    }, true /* capture */);
  });

  /* Qty stepper */
  form.querySelectorAll('[data-apgo-cc-qty]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!qtyInput) return;
      var n = parseInt(qtyInput.value, 10) || 1;
      n += (btn.getAttribute('data-apgo-cc-qty') === 'up' ? 1 : -1);
      if (n < 1) n = 1;
      qtyInput.value = n;
    });
  });

  /* Shared add-to-cart logic for both buttons */
  /*
    Rich success toast — same visual as the buybar / collection quick-add
    (.apgo-cart-success-toast, defined in snippets/apgo-cart-toast.liquid).
    Mounted at the top of the page so the user gets immediate confirmation
    after Add to cart on the PDP. Replaces any previous instance so rapid
    re-clicks don't stack.
  */
  function showAddedToCartToast(title, sub) {
    document.querySelectorAll('.apgo-cart-success-toast').forEach(function (n) { n.remove(); });
    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    var el = document.createElement('div');
    el.className = 'apgo-cart-success-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = ''
      + '<span class="apgo-cart-success-toast__check" aria-hidden="true">'
      + '  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.25 4.75L6.5 12.25L2.75 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + '</span>'
      + '<div class="apgo-cart-success-toast__body">'
      + '  <span class="apgo-cart-success-toast__title">' + esc(title) + '</span>'
      + '  <span class="apgo-cart-success-toast__sub">' + esc(sub) + '</span>'
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

  /*
    Fly-to-cart — animate a small thumbnail of the active variant image
    from the source button to the header cart icon. Pure CSS transition,
    no library. Bails out gracefully when targets are missing.
  */
  /*
    GIFT-WITH-PURCHASE reconciler
    ------------------------------
    When a product configured with `custom.free_gift_variant` is in the
    cart, ensure the corresponding gift Y variant is also there with
    line-item properties marking it as a free gift. Lifecycle handled:
      - X just added                → add Y at qty matching qty(X)
      - X qty changes               → adjust Y qty to match
      - X removed                   → remove Y (separate listener path)
      - User manually removed Y     → localStorage dismiss flag, don't re-add
      - Y already in cart from prior session (not as gift) → leave it alone
    Properties stored on the gift line:
      _free_gift  = 'true'
      _gift_for   = <X variant id>
      _gift_from_product = <X product title>  (for the "Free with <name>"
                                                sub-label on the cart UI)
    Shopify's automatic Buy-X-get-Y discount handles the actual pricing;
    this JS only manages presence + visual marking.
  */
  function isGiftDismissed(xVariantId) {
    try { return localStorage.getItem('apgo_gift_dismissed_' + xVariantId) === '1'; }
    catch (_) { return false; }
  }
  function markGiftDismissed(xVariantId) {
    try { localStorage.setItem('apgo_gift_dismissed_' + xVariantId, '1'); } catch (_) {}
  }
  function clearGiftDismissed(xVariantId) {
    try { localStorage.removeItem('apgo_gift_dismissed_' + xVariantId); } catch (_) {}
  }
  /* Expose remove + dismiss path so cart UI can call from a "remove gift" button */
  window.apgoDismissGift = function (xVariantId) { markGiftDismissed(xVariantId); };
  window.apgoUndismissGift = clearGiftDismissed;

  function reconcileFreeGifts() {
    if (!window.APGO_GIFT_MAP || Object.keys(window.APGO_GIFT_MAP).length === 0) {
      /* No gift mappings registered for any product visited so far → nothing to do.
         (We still want to clean up stale gifts on X-removal, but without a map
         we don't know what's a gift. That cleanup runs from the cart page only.) */
      return Promise.resolve();
    }
    return fetch('/cart.js?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        /* Build desired-gifts map: { giftVariantId: { qty, xVariantId, xTitle } }.
           A gift line stays at qty equal to the sum of all X qtys that map to it
           (if two different X products share the same Y, we still only need 1 Y
           per X "trigger" — collapse to max). For now: 1 gift per unique X. */
        var desired = {};
        cart.items.forEach(function (item) {
          /* Skip lines that are themselves gifts to avoid recursive triggering */
          if (item.properties && item.properties._free_gift === 'true') return;
          var giftId = window.APGO_GIFT_MAP[item.variant_id];
          if (!giftId) return;
          if (isGiftDismissed(item.variant_id)) return;
          if (!desired[giftId]) desired[giftId] = { qty: 0, xVariantId: item.variant_id, xTitle: (window.APGO_GIFT_PRODUCT_TITLES || {})[item.variant_id] || item.product_title || '' };
          /* 1:1 mapping — gift qty matches the SUM of X quantities, not the
             number of X lines. Shopify can split the same variant into
             multiple lines (e.g. when properties differ across adds), and
             counting +1 per line would under-count when each line carries
             qty > 1. */
          desired[giftId].qty += item.quantity;
        });

        /* What gift lines currently exist? */
        var existingGifts = []; /* [{ key, variant_id, quantity, properties }] */
        cart.items.forEach(function (item) {
          if (item.properties && item.properties._free_gift === 'true') {
            existingGifts.push(item);
          }
        });

        var ops = [];

        /* Add / update each desired gift */
        Object.keys(desired).forEach(function (giftIdStr) {
          var giftId = parseInt(giftIdStr, 10);
          var spec = desired[giftIdStr];
          var existing = existingGifts.find(function (e) { return e.variant_id === giftId; });
          if (!existing) {
            /* Need to add the gift line */
            var fd = new FormData();
            fd.append('id', String(giftId));
            fd.append('quantity', String(spec.qty));
            fd.append('properties[_free_gift]', 'true');
            fd.append('properties[_gift_for]', String(spec.xVariantId));
            if (spec.xTitle) fd.append('properties[_gift_from_product]', spec.xTitle);
            ops.push(fetch('/cart/add.js', { method: 'POST', headers: { Accept: 'application/json' }, body: fd }).catch(function () {}));
          } else if (existing.quantity !== spec.qty) {
            /* Adjust quantity to match expected */
            var fd2 = new FormData();
            fd2.append('id', existing.key);
            fd2.append('quantity', String(spec.qty));
            ops.push(fetch('/cart/change.js', { method: 'POST', headers: { Accept: 'application/json' }, body: fd2 }).catch(function () {}));
          }
        });

        /* Remove gift lines whose triggering X is no longer in cart (or dismissed) */
        existingGifts.forEach(function (g) {
          if (!desired[g.variant_id]) {
            var fd3 = new FormData();
            fd3.append('id', g.key);
            fd3.append('quantity', '0');
            ops.push(fetch('/cart/change.js', { method: 'POST', headers: { Accept: 'application/json' }, body: fd3 }).catch(function () {}));
          }
        });

        if (!ops.length) return cart;
        return Promise.all(ops).then(function () {
          /* Re-fetch + dispatch update so the bubble + UI reflect the new state */
          return fetch('/cart.js?_=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); });
        }).then(function (newCart) {
          var ev = new CustomEvent('cart:update', {
            bubbles: true,
            detail: {
              resource: newCart,
              sourceId: 'apgo-cc-pdp-gift',
              data: { itemCount: newCart.item_count, source: 'apgo-cc-pdp-gift', sections: {} }
            }
          });
          document.dispatchEvent(ev);
          return newCart;
        });
      })
      .catch(function (err) { console.warn('[apgo-gift] reconcile failed', err); });
  }
  /* Expose so the buybar / cart drawer can also trigger after their own adds */
  window.apgoReconcileFreeGifts = reconcileFreeGifts;

  function playFlyToCart(srcBtn) {
    var cartIcon = document.querySelector('cart-icon, .header-actions__cart-icon, [data-testid="cart-icon"]');
    if (!cartIcon || !srcBtn) return;
    var thumbEl = document.querySelector('.apgo-hero-visual img, .apgo-product-image-main, [data-apgo-cc-confirm-image]');
    var imgSrc = thumbEl && (thumbEl.src || thumbEl.getAttribute('src'));
    if (!imgSrc) return;

    var btnRect = srcBtn.getBoundingClientRect();
    var iconRect = cartIcon.getBoundingClientRect();
    var startX = btnRect.left + btnRect.width / 2;
    var startY = btnRect.top + btnRect.height / 2;
    var endX = iconRect.left + iconRect.width / 2;
    var endY = iconRect.top + iconRect.height / 2;

    var ghost = document.createElement('div');
    ghost.className = 'apgo-fly-to-cart';
    ghost.style.cssText =
      'position:fixed;' +
      'left:' + (startX - 28) + 'px;' +
      'top:' + (startY - 28) + 'px;' +
      'width:56px;height:56px;' +
      'border-radius:12px;' +
      'background:#fff center/cover no-repeat url("' + imgSrc + '");' +
      'box-shadow:0 8px 24px rgba(240,132,24,0.45),0 0 0 2px rgba(240,132,24,0.6);' +
      'z-index:100050;pointer-events:none;' +
      'transition:transform .7s cubic-bezier(.55,-0.05,.3,1.4),opacity .25s ease .55s;' +
      'transform:translate(0,0) scale(1);' +
      'opacity:1;';
    document.body.appendChild(ghost);

    /* Force layout flush, then animate to the cart icon */
    void ghost.offsetWidth;
    var dx = endX - startX;
    var dy = endY - startY;
    ghost.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(0.18) rotate(8deg)';
    ghost.style.opacity = '0';

    /* On arrival → pulse the cart icon for extra feedback */
    setTimeout(function () {
      ghost.remove();
      cartIcon.classList.add('apgo-cart-icon-bump');
      setTimeout(function () { cartIcon.classList.remove('apgo-cart-icon-bump'); }, 480);
    }, 760);
  }

  function addToCart(opts) {
    opts = opts || {};
    var btn = opts.btn;
    var fd = new FormData(form);
    var orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }

    return fetch('/cart/add.js', {
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
      .then(function () {
        return fetch('/cart.js?_=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); });
      })
      .then(function (cart) {
        /*
          Cart update event — ONE properly-shaped CustomEvent matching
          Horizon's <cart-icon> contract.
            event.detail.data.itemCount  → number of items
            event.detail.data.source     → 'apgo-cc-pdp' (NOT 'product-form-component',
                                            so cart-icon treats itemCount as the
                                            absolute new total, not a delta to add)
          ⚠️ DO NOT dispatch a parallel `{ detail: { cart } }` shape on the
          same event name — cart-icon reads `detail.data?.itemCount`, gets
          undefined ?? 0, and HIDES the badge.
          ⚠️ DO NOT `import('@theme/events')` — bare specifier, browsers can't
          resolve it without a registered importmap; the dynamic import
          rejects silently and the supposed "fallback" never fires.
        */
        document.dispatchEvent(new CustomEvent('cart:update', {
          bubbles: true,
          detail: {
            resource: cart,
            sourceId: 'apgo-cc-pdp',
            data: {
              itemCount: cart.item_count,
              source: 'apgo-cc-pdp',
              sections: {}
            }
          }
        }));
        /* Legacy event names for any app/theme code still listening to them */
        document.documentElement.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true, detail: { cart: cart } }));
        document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart: cart } }));

        /* Direct DOM update — belt-and-braces in case the custom-element
           upgrade is still pending or any other listener overrides things. */
        try {
          var count = cart.item_count || 0;
          var cartIconEls = document.querySelectorAll('cart-icon, .header-actions__cart-icon');
          cartIconEls.forEach(function (icon) {
            var countEl = icon.querySelector('[ref="cartBubbleCount"], .cart-bubble__text-count');
            var bubbleEl = icon.querySelector('[ref="cartBubble"], .cart-bubble');
            if (countEl) {
              countEl.textContent = count < 100 ? String(count) : '';
              countEl.classList.toggle('hidden', count === 0);
            }
            if (bubbleEl) bubbleEl.classList.toggle('visually-hidden', count === 0);
            icon.classList.toggle('header-actions__cart-icon--has-cart', count > 0);
          });
        } catch (_) {}

        /* Persist for cart-icon's ensureCartBubbleIsCorrect on next nav (<10s). */
        try {
          sessionStorage.setItem('cart-count', JSON.stringify({
            value: String(cart.item_count || 0),
            timestamp: Date.now()
          }));
        } catch (_) {}
        if (btn) { btn.disabled = false; btn.textContent = orig; }
        /* Fly-to-cart animation — animates a tiny "ghost" of the product
           thumbnail from the clicked button to the header cart icon for
           visual confirmation. No-op on mobile or if either DOM target
           is missing. */
        if (!opts.silent) {
          try { playFlyToCart(opts.btn); } catch (_) {}
        }
        /* Success toast at the top of the page. Skipped when opts.silent is
           true so Buy-now (which immediately redirects to /cart) doesn't
           flash a toast just before navigation. */
        if (!opts.silent) {
          var titleEl = document.querySelector('.apgo-product-name')
                       || document.querySelector('.apgo-cc-pdp__title');
          var name = (titleEl && titleEl.textContent.trim()) || 'Item';
          showAddedToCartToast(name, 'Added to cart');
        }
        /* Gift-with-purchase: auto-add the configured free gift Y if X
           (the just-added product) has one mapped. Re-dispatches cart
           events after settling so the badge + cart UI reflect both X+Y.
           IMPORTANT: chain the promise so Buy-now waits for Y to be added
           before navigating to /cart. Previously we fire-and-forgot,
           which meant the /cart redirect could race ahead of the gift
           POST and the customer would land in checkout without Y. */
        var giftPromise;
        try { giftPromise = reconcileFreeGifts(); } catch (_) {}
        if (!giftPromise || typeof giftPromise.then !== 'function') {
          giftPromise = Promise.resolve();
        }
        return giftPromise.then(function () { return cart; });
      })
      .catch(function (err) {
        console.error('[apgo-cc-pdp] add failed:', err);
        if (btn) { btn.disabled = false; btn.textContent = orig; }
        throw err;
      });
  }

  if (addBtn) {
    addBtn.addEventListener('click', function (e) {
      e.preventDefault();
      addToCart({ btn: addBtn });
    });
  }
  if (buyBtn) {
    buyBtn.addEventListener('click', function () {
      addToCart({ btn: buyBtn, silent: true }).then(function () {
        window.location.href = '/cart';
      }).catch(function () {});
    });
  }

  /*
    Bidirectional sync — swiping the main carousel triggers the matching
    variant chip (reverse of the existing chip → image flow in refreshVariant).
    Mechanism: monkey-patch window.apgoCarousel.goToSlide so every slide
    change (touch swipe / dot tap / thumbnail tap / programmatic) also runs
    syncVariantToSlide(idx) which looks up the variant whose featured_image
    sits at that position and selects it.

    Only triggers when the destination slide IS a variant's featured image.
    Sliding through gallery-only images (no variant linkage) is a no-op,
    so navigation feels natural.

    Loop protection: refreshVariant() itself calls goToSlide at the end.
    That re-enters the wrapped goToSlide, which calls syncVariantToSlide,
    which sees v.id === window.currentVariantId (already set by the same
    refreshVariant cycle) and bails out before re-firing.
  */
  function findVariantBySlide(idx) {
    var pos = idx + 1; /* Shopify featured_image.position is 1-indexed */
    for (var i = 0; i < variants.length; i++) {
      var vv = variants[i];
      var fimg = vv.featured_image || vv.featured_media;
      var p = fimg && (fimg.position || (fimg.preview_image && fimg.preview_image.position));
      if (p === pos) return vv;
    }
    return null;
  }
  function syncVariantToSlide(idx) {
    var v = findVariantBySlide(idx);
    if (!v) return; /* slide isn't tied to any variant → leave chip as-is */
    if (v.id === window.currentVariantId) return; /* already on this variant */
    /* Flip radios across every option group so all options end up matching v */
    form.querySelectorAll('[data-apgo-cc-option-group]').forEach(function (g, gi) {
      var targetValue = (v.options || [])[gi];
      g.querySelectorAll('input[type="radio"][data-apgo-cc-option-input]').forEach(function (r) {
        r.checked = false;
      });
      if (targetValue == null) return;
      /* CSS.escape isn't in older browsers — use attribute selector with literal value (escaped via a small helper) */
      var radios = g.querySelectorAll('input[type="radio"][data-apgo-cc-option-input]');
      for (var i = 0; i < radios.length; i++) {
        if (radios[i].value === targetValue) {
          radios[i].checked = true;
          break;
        }
      }
    });
    refreshVariant();
  }

  /*
    Patch carousel.goToSlide once it's mounted. Carousel boots after
    DOMContentLoaded in v3; poll briefly until window.apgoCarousel exists.
    Bail after ~3 seconds if it never appears (e.g. product with no images).
  */
  var carouselPatchTries = 0;
  function patchCarouselGoToSlide() {
    if (window.apgoCarousel && typeof window.apgoCarousel.goToSlide === 'function' && !window.apgoCarousel._apgoCcSyncPatched) {
      var orig = window.apgoCarousel.goToSlide.bind(window.apgoCarousel);
      window.apgoCarousel.goToSlide = function (idx) {
        orig(idx);
        try { syncVariantToSlide(idx); } catch (_) {}
      };
      window.apgoCarousel._apgoCcSyncPatched = true;
      return;
    }
    if (++carouselPatchTries > 30) return; /* give up after 30 × 100ms = 3s */
    setTimeout(patchCarouselGoToSlide, 100);
  }
  patchCarouselGoToSlide();

  /*
    Purchase-confirm modal — opens when bottom buybar Add/Buy is clicked.
    The modal mirrors the picker state (variant chips, quantity, active
    Variation section) and provides the final Add to cart / Buy now commit.
    The page-level inline picker no longer renders quantity or CTAs; this is
    the single commit step for both mobile and desktop.

    Architecture:
      - Modal markup is rendered server-side with chips for each option value
        (so labels survive view-source / no-JS bots), but everything else
        (active state, current value, variation content) is JS-driven at
        open time and on variant change.
      - refreshVariant() (defined above) already syncs the inline picker.
        We wrap its tail so the modal mirrors the same updates without
        rerunning the full logic.
      - Modal Add/Buy fetches /cart/add.js with the hidden form's variant id
        + the modal's qty input value (also written back into the hidden
        `quantity` input so subsequent buybar paths read the right qty).
  */
  var confirmModal      = document.querySelector('[data-apgo-cc-confirm-modal]');
  var confirmCloseEls   = confirmModal ? confirmModal.querySelectorAll('[data-apgo-cc-confirm-close]') : [];
  var confirmQtyInput   = confirmModal ? confirmModal.querySelector('[data-apgo-cc-confirm-qty-input]') : null;
  var confirmQtyBtns    = confirmModal ? confirmModal.querySelectorAll('[data-apgo-cc-confirm-qty]') : [];
  var confirmAddBtn     = confirmModal ? confirmModal.querySelector('[data-apgo-cc-confirm-add]') : null;
  var confirmBuyBtn     = confirmModal ? confirmModal.querySelector('[data-apgo-cc-confirm-buy]') : null;
  var confirmVariationEl= confirmModal ? confirmModal.querySelector('[data-apgo-cc-confirm-variation]') : null;
  var confirmGroups     = confirmModal ? confirmModal.querySelectorAll('[data-apgo-cc-confirm-option-group]') : [];
  var confirmImageEl    = confirmModal ? confirmModal.querySelector('[data-apgo-cc-confirm-image]') : null;
  var confirmPriceEl    = confirmModal ? confirmModal.querySelector('[data-apgo-cc-confirm-price]') : null;
  var confirmStockEl    = confirmModal ? confirmModal.querySelector('[data-apgo-cc-confirm-stock]') : null;
  var confirmStockTxtEl = confirmModal ? confirmModal.querySelector('[data-apgo-cc-confirm-stock-text]') : null;
  /* APGO_LOW_STOCK_THRESHOLD already defined at the top of this IIFE next
     to the inventory map parse — re-declaration was redundant. */

  function syncConfirmModal() {
    if (!confirmModal) return;
    /* Sync chip active state + current-value label per option group from inline radios */
    confirmGroups.forEach(function (g, gi) {
      var sourceGroup = form.querySelectorAll('[data-apgo-cc-option-group]')[gi];
      if (!sourceGroup) return;
      var checked = sourceGroup.querySelector('input[type="radio"]:checked');
      var currentVal = checked ? checked.value : '';
      var curEl = g.querySelector('[data-apgo-cc-confirm-option-current]');
      if (curEl) curEl.textContent = currentVal;
      g.querySelectorAll('[data-apgo-cc-confirm-chip]').forEach(function (chip) {
        var val = chip.getAttribute('data-option-value');
        chip.classList.toggle('is-active', val === currentVal);
      });
    });
    /* Mirror image + price from the current variant. Reads cents/img from the
       same `variants` array + the inline price element so it always tracks the
       live selection regardless of which input (chip click / swipe) drove it. */
    var curOpts = currentOptionValues();
    var curV = findVariant(curOpts);
    if (curV) {
      if (confirmPriceEl) {
        confirmPriceEl.setAttribute('data-cents', curV.price);
        confirmPriceEl.textContent = fmtMoney(curV.price);
      }
      if (confirmImageEl) {
        var fimg = curV.featured_image || (curV.featured_media && curV.featured_media.preview_image);
        var src = (fimg && fimg.src)
                  || (priceEl && priceEl.closest('.apgo-product-section') && (priceEl.closest('.apgo-product-section').querySelector('.apgo-hero-visual img') || {}).src)
                  || confirmImageEl.getAttribute('src');
        if (src) {
          /* Request a small width to keep payload tiny on mobile */
          var sized = src.replace(/(\.[a-z]+)(\?|$)/i, '_200x$1$2');
          if (confirmImageEl.getAttribute('src') !== sized) confirmImageEl.setAttribute('src', sized);
        }
      }
      /* Stock indicator. Variants without tracked inventory have
         inventory_management === null; we hide the line in that case to
         avoid showing misleading "0 in stock". */
      if (confirmStockEl) {
        var tracked = curV.inventory_management != null;
        var qty = curV.inventory_quantity;
        function setStock(state, txt) {
          confirmStockEl.removeAttribute('hidden');
          confirmStockEl.setAttribute('data-stock-state', state);
          if (confirmStockTxtEl) confirmStockTxtEl.textContent = txt;
        }
        /* Order matters: check `available` first. A variant where Shopify
           reports available=false should ALWAYS read as Sold out — even if
           inventory_management isn't set (untracked) or qty isn't numeric. */
        if (!curV.available) {
          setStock('out', 'Sold out');
        } else if (!tracked || typeof qty !== 'number') {
          /* Tracked-but-unknown qty (or fully untracked) → safe default */
          setStock('in', 'In stock');
        } else if (qty <= 0) {
          setStock('out', 'Sold out');
        } else if (qty <= APGO_LOW_STOCK_THRESHOLD) {
          setStock('low', 'Only ' + qty + ' left in stock');
        } else {
          setStock('in', 'In stock');
        }
      }
    }
    /* Mirror the inline picker's currently-visible Variation section */
    if (confirmVariationEl) {
      var activeSection = document.querySelector('[data-apgo-cc-variation-sections] .apgo-cc-pdp__variation-section.is-active');
      if (activeSection) {
        confirmVariationEl.innerHTML = activeSection.innerHTML;
      } else {
        confirmVariationEl.innerHTML = '';
      }
    }

    /*
      Out-of-stock state for the modal's Add / Buy buttons. When the
      active variant is unavailable, both CTAs collapse to a single
      disabled "Out of stock" pill so the customer can't try to commit
      to a variant that Shopify will reject anyway.
    */
    if (confirmAddBtn || confirmBuyBtn) {
      var soldOut = curV && !curV.available;
      [confirmAddBtn, confirmBuyBtn].forEach(function (b) {
        if (!b) return;
        if (soldOut) {
          b.disabled = true;
          b.dataset.apgoOrigLabel = b.dataset.apgoOrigLabel || b.textContent.trim();
          b.textContent = 'Out of stock';
          b.classList.add('apgo-cc-pdp__cta--out');
        } else if (b.dataset.apgoOrigLabel) {
          b.disabled = false;
          b.textContent = b.dataset.apgoOrigLabel;
          b.classList.remove('apgo-cc-pdp__cta--out');
        }
      });
      if (confirmModal) confirmModal.setAttribute('data-out-of-stock', soldOut ? 'true' : 'false');
    }
  }

  /*
    Lock the variation block to the height of the TALLEST variant's section so
    switching variants doesn't cause the modal to grow/shrink. Measures once
    when the modal first opens (DOM has been laid out + fonts are ready) by
    temporarily swapping each section's HTML into the variation slot off-screen.
    Cached to a module-level flag so we only do this once.
  */
  var confirmVariationHeightLocked = false;
  function lockConfirmVariationHeight() {
    if (confirmVariationHeightLocked || !confirmVariationEl) return;
    var sections = document.querySelectorAll('[data-apgo-cc-variation-sections] .apgo-cc-pdp__variation-section');
    if (!sections.length) return;
    /* Save original content + styles so we can restore after measuring */
    var origHTML = confirmVariationEl.innerHTML;
    var origVisibility = confirmVariationEl.style.visibility;
    var maxH = 0;
    /* Measure each section by mounting it in the live slot (preserves the
       slot's actual width/font/padding) but hidden via visibility. */
    confirmVariationEl.style.visibility = 'hidden';
    sections.forEach(function (sec) {
      confirmVariationEl.innerHTML = sec.innerHTML;
      var h = confirmVariationEl.getBoundingClientRect().height;
      if (h > maxH) maxH = h;
    });
    confirmVariationEl.innerHTML = origHTML;
    confirmVariationEl.style.visibility = origVisibility;
    if (maxH > 0) {
      confirmVariationEl.style.minHeight = Math.ceil(maxH) + 'px';
      confirmVariationHeightLocked = true;
    }
  }

  function openConfirmModal(intent) {
    if (!confirmModal) return;
    /* Desktop uses inline CTA buttons in the form, not the modal. Guard here
       so any accidental call from buybar / API consumers no-ops on desktop. */
    if (window.matchMedia && window.matchMedia('(min-width: 1024px)').matches) return;
    /* Intent values:
         'add'  → show only Add to cart
         'buy'  → show only Buy now
         'both' → show both buttons (used when the user taps the variant area)
       The CSS rule hides the non-matching button via data-intent. */
    var resolvedIntent = 'add';
    if (intent === 'buy') resolvedIntent = 'buy';
    else if (intent === 'both') resolvedIntent = 'both';
    confirmModal.setAttribute('data-intent', resolvedIntent);
    syncConfirmModal();
    /* Seed modal qty from the hidden form qty (default 1) so it isn't a fresh value each time */
    if (confirmQtyInput && qtyInput) confirmQtyInput.value = parseInt(qtyInput.value, 10) || 1;
    confirmModal.classList.add('is-open');
    confirmModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('apgo-cc-confirm-open');
    /* Lock variation block height to the tallest variant's section so switching
       variants doesn't bounce the modal layout. Done after open so the slot has
       its final laid-out width. requestAnimationFrame ensures we measure after
       the show transition has applied. */
    requestAnimationFrame(function () { lockConfirmVariationHeight(); });
  }
  function closeConfirmModal() {
    if (!confirmModal) return;
    confirmModal.classList.remove('is-open');
    confirmModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('apgo-cc-confirm-open');
  }
  /* Expose so the buybar JS (a separate file) can trigger the open */
  window.apgoOpenConfirmModal = openConfirmModal;
  window.apgoCloseConfirmModal = closeConfirmModal;

  /* Close interactions: X button, backdrop, Esc */
  confirmCloseEls.forEach(function (el) { el.addEventListener('click', closeConfirmModal); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && confirmModal && confirmModal.classList.contains('is-open')) closeConfirmModal();
  });

  /* Modal chip click → set the matching inline radio + run refreshVariant + re-sync modal */
  confirmGroups.forEach(function (g, gi) {
    g.querySelectorAll('[data-apgo-cc-confirm-chip]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var val = chip.getAttribute('data-option-value');
        var sourceGroup = form.querySelectorAll('[data-apgo-cc-option-group]')[gi];
        if (!sourceGroup) return;
        sourceGroup.querySelectorAll('input[type="radio"][data-apgo-cc-option-input]').forEach(function (r) {
          r.checked = (r.value === val);
        });
        refreshVariant(); /* propagates to chip is-active, price, image, Variation, etc. */
        syncConfirmModal();
      });
    });
  });

  /* Modal qty stepper */
  confirmQtyBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!confirmQtyInput) return;
      var n = parseInt(confirmQtyInput.value, 10) || 1;
      n += (btn.getAttribute('data-apgo-cc-confirm-qty') === 'up' ? 1 : -1);
      if (n < 1) n = 1;
      confirmQtyInput.value = n;
    });
  });

  /* Modal Add / Buy — write the modal qty back into the hidden form qty, then commit */
  function commitFromConfirm(intent, triggerBtn) {
    if (qtyInput && confirmQtyInput) qtyInput.value = parseInt(confirmQtyInput.value, 10) || 1;
    addToCart({ btn: triggerBtn, silent: intent === 'buy' }).then(function () {
      closeConfirmModal();
      if (intent === 'buy') window.location.href = '/cart';
    }).catch(function () {});
  }
  if (confirmAddBtn) confirmAddBtn.addEventListener('click', function () { commitFromConfirm('add', confirmAddBtn); });
  if (confirmBuyBtn) confirmBuyBtn.addEventListener('click', function () { commitFromConfirm('buy', confirmBuyBtn); });

  /* Whenever the inline picker refreshes (variant change from any source —
     chip click, image swipe, etc.) keep the modal mirrored. We wrap the
     existing refreshVariant so callers don't need to know about the modal. */
  var _origRefreshVariant = refreshVariant;
  refreshVariant = function () {
    _origRefreshVariant.apply(this, arguments);
    syncConfirmModal();
  };

  /* Initial sync (covers SSR-checked state) */
  refreshVariant();
})();

/*
  Deal countdown — drives .apgo-cc-pdp__deal-timer
  Source:
    1) data-deal-end="<ISO>" → fixed end date/time. When reached, the badge hides.
    2) data-deal-evergreen-hours="<N>" → per-visitor evergreen countdown,
       restarts when localStorage entry first set; persists across reloads
       until N hours after first visit. Scoped per product id so different
       products have independent timers.
  Updates once per second; switches to "urgent" pulse animation in the
  final 60 minutes.
*/
(function () {
  'use strict';
  var timerEl = document.querySelector('[data-apgo-deal-timer]');
  if (!timerEl) return;
  var textEl = timerEl.querySelector('[data-apgo-deal-timer-text]') || timerEl;

  /*
    Resolve countdown end timestamp in Malaysia time (GMT+8).
    Weekly recurring mode only. Inputs (data-*):
      - data-deal-weekday   → 0–6 (Sun=0…Sat=6)
      - data-deal-end-time  → "HH:MM" (24h, MY local)
      - data-deal-tz-offset → "+08:00"
    Counts down to the next occurrence of that weekday at HH:MM MY;
    when it passes, re-resolves to the following week.
    Returns 0 if no weekday configured.
  */
  function resolveEndMs() {
    var tz = timerEl.getAttribute('data-deal-tz-offset') || '+08:00';
    var time = timerEl.getAttribute('data-deal-end-time') || '12:00';
    var weekdayAttr = timerEl.getAttribute('data-deal-weekday');
    if (weekdayAttr === null || weekdayAttr === '') return 0;
    var targetDow = parseInt(weekdayAttr, 10);
    if (isNaN(targetDow) || targetDow < 0 || targetDow > 6) return 0;

    /* Today's date components describing MY local date */
    var nowMs = Date.now();
    var myNow = new Date(nowMs + 8 * 3600 * 1000);
    var y = myNow.getUTCFullYear();
    var m = myNow.getUTCMonth();
    var d = myNow.getUTCDate();
    var dow = myNow.getUTCDay(); /* 0=Sun … 6=Sat */

    function fmtDate(yr, mn, dy) {
      var t = new Date(Date.UTC(yr, mn, dy));
      return t.getUTCFullYear() + '-' +
             String(t.getUTCMonth() + 1).padStart(2, '0') + '-' +
             String(t.getUTCDate()).padStart(2, '0');
    }

    var addDays = (targetDow - dow + 7) % 7;
    /* Same weekday today → check if HH:MM already passed; if so skip a week */
    if (addDays === 0) {
      var todayISO = fmtDate(y, m, d) + 'T' + time + ':00' + tz;
      if (Date.parse(todayISO) <= Date.now()) addDays = 7;
    }
    var iso = fmtDate(y, m, d + addDays) + 'T' + time + ':00' + tz;
    var t = Date.parse(iso);
    return isNaN(t) ? 0 : t;
  }

  var endMs = resolveEndMs();
  if (!endMs) { timerEl.setAttribute('hidden', ''); return; }

  /* Weekly mode is always recurring — re-resolves to next week on expiry. */
  var isRecurring = true;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function render() {
    var diff = endMs - Date.now();
    if (diff <= 0) {
      if (isRecurring) {
        /* Weekly / rolling mode — roll forward to the next cycle and keep ticking */
        endMs = resolveEndMs();
        if (!endMs) { timerEl.setAttribute('hidden', ''); return false; }
        diff = endMs - Date.now();
        if (diff <= 0) { timerEl.setAttribute('hidden', ''); return false; }
      } else {
        /* Fixed-date deal that has ended — hide the badge */
        timerEl.setAttribute('hidden', '');
        return false;
      }
    }
    var totalSec = Math.floor(diff / 1000);
    var days = Math.floor(totalSec / 86400);
    var hours = Math.floor((totalSec % 86400) / 3600);
    var mins  = Math.floor((totalSec % 3600) / 60);
    var secs  = totalSec % 60;
    var str;
    if (days > 0) {
      str = days + 'd ' + pad(hours) + ':' + pad(mins) + ':' + pad(secs);
    } else {
      str = pad(hours) + ':' + pad(mins) + ':' + pad(secs);
    }
    textEl.textContent = str;
    /* Final hour → pulsing urgent animation */
    timerEl.setAttribute('data-urgent', diff < 3600 * 1000 ? 'true' : 'false');
    return true;
  }

  if (render()) {
    setInterval(render, 1000);
  }
})();
