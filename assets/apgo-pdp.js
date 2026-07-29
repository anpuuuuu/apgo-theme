/* APGO · PDP interactions
 * Scope: any element inside [data-section-id] on apgo-v1s-plus template
 * Handles: variant selection, price updates, qty stepper, mobile tabs,
 * mobile carousel counter, desktop thumbnail → main image swap, buy-now.
 */
(function () {
  'use strict';

  // ---------- helpers ----------
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  // Lightweight toast (one global container; messages stack briefly)
  function ensureApgoToastRoot() {
    var root = document.querySelector('[data-apgo-toast-root]');
    if (root) return root;
    root = document.createElement('div');
    root.setAttribute('data-apgo-toast-root', '');
    root.className = 'apgo-toast-root';
    document.body.appendChild(root);
    return root;
  }
  function showApgoCartToast(text, isError) {
    var root = ensureApgoToastRoot();
    var t = document.createElement('div');
    t.className = 'apgo-toast' + (isError ? ' apgo-toast--error' : '');
    t.textContent = text;
    root.appendChild(t);
    // animate in
    requestAnimationFrame(function () { t.classList.add('is-visible'); });
    // animate out + remove
    setTimeout(function () { t.classList.remove('is-visible'); }, 2200);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }
  // Expose in case other PDP modules want it
  window.apgoCartToast = showApgoCartToast;

  function apgoFindCartIcon() {
    return document.querySelector('[data-testid="cart-icon"]')
      || document.querySelector('cart-icon')
      || document.querySelector('.header-actions__cart-icon');
  }

  // Fly a clone of the product image from the tapped button up to the
  // header cart icon, then bump the icon. Mirrors the v3 PDP animation.
  function apgoFlyToCart(srcEl) {
    var cartIcon = apgoFindCartIcon();
    if (!cartIcon) return;
    var img = document.querySelector('[data-apgo-carousel] img, .apgo-mpdp-slide img, .apgo-gallery img, .apgo-hero-visual img, .apgo-mpdp-main img');
    var imgSrc = img && (img.currentSrc || img.src);
    if (!imgSrc) return;
    // Resolve a VISIBLE source rect. The passed button may be the hidden
    // desktop variant of the CTA (0x0 on mobile) — that made the clone
    // fly from the top-left corner. Prefer srcEl, else the first add/buy
    // button that's actually on screen, else the product image.
    function visRect(el) {
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return (r.width > 0 && r.height > 0) ? r : null;
    }
    var from = visRect(srcEl);
    if (!from) {
      var btns = Array.prototype.slice.call(document.querySelectorAll('[data-apgo-add], [data-apgo-buy-now]'));
      for (var i = 0; i < btns.length; i++) { from = visRect(btns[i]); if (from) break; }
    }
    if (!from) from = visRect(img);
    if (!from) return;
    var to = cartIcon.getBoundingClientRect();
    var sx = from.left + from.width / 2, sy = from.top + from.height / 2;
    var ex = to.left + to.width / 2, ey = to.top + to.height / 2;

    var ghost = document.createElement('div');
    ghost.className = 'apgo-fly-to-cart';
    var base =
      'position:fixed;width:56px;height:56px;border-radius:12px;' +
      'background:#fff center/cover no-repeat url("' + imgSrc + '");' +
      'box-shadow:0 8px 24px rgba(94,111,93,0.4),0 0 0 2px rgba(94,111,93,0.5);' +
      'z-index:100050;pointer-events:none;';

    function landAndBump(delay) {
      setTimeout(function () {
        if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
        cartIcon.classList.add('apgo-cart-icon-bump');
        setTimeout(function () { cartIcon.classList.remove('apgo-cart-icon-bump'); }, 480);
      }, delay);
    }

    var supportsOffsetPath = (window.CSS && CSS.supports && CSS.supports('offset-path', 'path("M0 0")'));

    if (supportsOffsetPath) {
      // True bezier ARC (same technique as the birthday page): a quadratic
      // curve whose control point is lifted ABOVE the midpoint, so the clone
      // arcs upward on its way to the cart instead of cutting a straight
      // diagonal. Peak lift scales with trip distance (clamped) so both
      // short and long flights look graceful.
      var midX = (sx + ex) / 2, midY = (sy + ey) / 2;
      var dist = Math.sqrt((ex - sx) * (ex - sx) + (ey - sy) * (ey - sy));
      var lift = Math.min(240, Math.max(70, dist * 0.28));
      var ctrlX = midX, ctrlY = midY - lift;
      ghost.style.cssText = base +
        'left:0;top:0;offset-anchor:center;offset-rotate:0deg;offset-distance:0%;' +
        'offset-path:path("M ' + sx + ' ' + sy + ' Q ' + ctrlX + ' ' + ctrlY + ' ' + ex + ' ' + ey + '");';
      document.body.appendChild(ghost);
      ghost.animate([
        { offsetDistance: '0%',   transform: 'scale(1) rotate(-10deg)',  opacity: 1,    offset: 0 },
        { offsetDistance: '45%',  transform: 'scale(0.8) rotate(10deg)', opacity: 1,    offset: 0.45 },
        { offsetDistance: '85%',  transform: 'scale(0.4) rotate(30deg)', opacity: 0.9,  offset: 0.85 },
        { offsetDistance: '100%', transform: 'scale(0.18) rotate(45deg)', opacity: 0,   offset: 1 }
      ], { duration: 850, easing: 'cubic-bezier(.42, 0, .58, 1)', fill: 'forwards' });
      landAndBump(880);
    } else {
      // Fallback for browsers without CSS offset-path: straight-line
      // transition with a springy easing (the previous behaviour).
      ghost.style.cssText = base +
        'left:' + (sx - 28) + 'px;top:' + (sy - 28) + 'px;' +
        'transition:transform .7s cubic-bezier(.55,-0.05,.3,1.4),opacity .25s ease .55s;' +
        'transform:translate(0,0) scale(1);opacity:1;';
      document.body.appendChild(ghost);
      void ghost.offsetWidth;
      ghost.style.transform = 'translate(' + (ex - sx) + 'px,' + (ey - sy) + 'px) scale(0.18) rotate(8deg)';
      ghost.style.opacity = '0';
      landAndBump(760);
    }
  }

  // Notify Horizon's <cart-icon> (which reads detail.data.itemCount) plus
  // the rest of the cart UI. Without the itemCount payload the header
  // bubble count never updates.
  function apgoBroadcastCart(cart) {
    var itemCount = (cart && typeof cart.item_count === 'number') ? cart.item_count : 0;
    var detail = { data: { itemCount: itemCount, source: 'apgo-pdp' }, resource: cart, cart: cart };
    ['cart:update', 'cart:updated', 'cart:refresh', 'cart:added'].forEach(function (name) {
      try { document.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail })); } catch (e) {}
    });
  }

  function formatMoney(cents) {
    // Follow the active Shopify Markets currency (MY → MYR "RM", SG → SGD
    // "S$"), matching the cart-totals.liquid convention. Currency is seeded
    // from Liquid (window.APGO_ACTIVE_CURRENCY); never hardcode TWD here or
    // MY/SG prices come out as NT$.
    var cur = window.APGO_ACTIVE_CURRENCY
      || (window.Shopify && window.Shopify.currency && window.Shopify.currency.active)
      || 'MYR';
    var amount = (Number(cents) || 0) / 100;
    var n = amount.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (cur === 'MYR') return 'RM ' + n;
    if (cur === 'SGD') return 'S$ ' + n;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2
      }).format(amount);
    } catch (e) {
      return cur + ' ' + n;
    }
  }

  // ---------- per-form init ----------
  function initForm(form) {
    if (!form || form._apgoInitialized) return;
    form._apgoInitialized = true;

    var variantsEl = $('[data-apgo-variants]', form);
    var variants = [];
    if (variantsEl) {
      try { variants = JSON.parse(variantsEl.textContent); } catch (e) { variants = []; }
    }

    // Current selected option values — read from checked radios.
    // The form may contain duplicate option groups (one in the desktop
    // shell + one in the mobile shell on the unified PDP section), so
    // dedupe by data-option-position before assembling the value array.
    function readSelectedOptions() {
      var byPos = {};
      $$('[data-apgo-option-group]', form).forEach(function (group) {
        var pos = parseInt(group.getAttribute('data-option-position'), 10);
        if (!pos || byPos.hasOwnProperty(pos)) return;
        var checked = $('input[data-apgo-option-input]:checked', group);
        byPos[pos] = checked ? checked.value : null;
      });
      var positions = Object.keys(byPos).map(Number).sort(function (a, b) { return a - b; });
      return positions.map(function (p) { return byPos[p]; });
    }

    function findVariant(values) {
      for (var i = 0; i < variants.length; i++) {
        var v = variants[i];
        var vOpts = [v.option1, v.option2, v.option3];
        var ok = true;
        for (var j = 0; j < values.length; j++) {
          if (values[j] != null && vOpts[j] !== values[j]) { ok = false; break; }
        }
        if (ok) return v;
      }
      return null;
    }

    function qty() {
      var q = parseInt(($('[data-apgo-qty-input]', form) || {}).value, 10);
      return isNaN(q) || q < 1 ? 1 : q;
    }

    function updatePriceUI(variant) {
      if (!variant) return;
      // Variant id hidden input
      var idInput = $('[data-apgo-variant-id]', form);
      if (idInput) idInput.value = variant.id;

      var price = Number(variant.price);
      var compare = Number(variant.compare_at_price || 0);
      var q = qty();
      var total = price * q;

      $$('[data-apgo-price]', form).forEach(function (n) { n.textContent = formatMoney(price); });
      $$('[data-apgo-total]', form).forEach(function (n) { n.textContent = formatMoney(total); });
      $$('[data-apgo-compare]', form).forEach(function (n) {
        if (compare > price) { n.textContent = formatMoney(compare); n.style.display = ''; }
        else { n.style.display = 'none'; }
      });
      $$('[data-apgo-installment]', form).forEach(function (n) {
        n.textContent = '3 interest-free payments of ' + formatMoney(Math.round(price / 3));
      });

      // Availability → disable add button
      $$('[data-apgo-add]', form).forEach(function (btn) {
        if (variant.available) {
          btn.removeAttribute('disabled');
          btn.classList.remove('is-soldout');
        } else {
          btn.setAttribute('disabled', 'disabled');
          btn.classList.add('is-soldout');
        }
      });
    }

    function updateCurrentValueLabels() {
      $$('[data-apgo-option-group]', form).forEach(function (group) {
        var checked = $('input[data-apgo-option-input]:checked', group);
        var label = $('[data-apgo-current-value]', group);
        if (checked && label) label.textContent = checked.value;

        // Toggle .active on parent chip / scentbtn
        $$('label', group).forEach(function (lbl) {
          var input = $('input[data-apgo-option-input]', lbl);
          if (!input) return;
          if (input.checked) lbl.classList.add('active');
          else lbl.classList.remove('active');
        });
      });
    }

    // Extract the filename portion of a Shopify CDN URL (strip query + path).
    // Used to match variant.featured_image.src against thumb/slide <img src>
    // because the two ID systems (variant image id vs product media image id)
    // don't share numeric IDs in Shopify, but the filename in src does match.
    function srcFilename(url) {
      if (!url) return '';
      var noQuery = url.split('?')[0];
      return noQuery.substring(noQuery.lastIndexOf('/') + 1).toLowerCase();
    }

    // Swap the main media (desktop main img + thumb activation, mobile carousel scroll)
    // to the variant's featured image. No-op if the variant has no featured image set.
    function syncMediaToVariant(variant) {
      if (!variant || !variant.featured_image || !variant.featured_image.src) return;
      var targetFile = srcFilename(variant.featured_image.src);
      if (!targetFile) return;

      // Desktop: find matching thumb, activate it, push its image into main slot.
      var mainImg = $('[data-apgo-main-img]', form);
      var matchedThumb = null;
      $$('[data-apgo-thumb-idx]', form).forEach(function (t) {
        var img = $('img', t);
        if (!img) return;
        if (srcFilename(img.currentSrc || img.src) === targetFile) matchedThumb = t;
      });
      if (matchedThumb) {
        $$('[data-apgo-thumb-idx]', form).forEach(function (t) { t.classList.remove('active'); });
        matchedThumb.classList.add('active');
        if (mainImg) {
          var thumbImg = $('img', matchedThumb);
          if (thumbImg) {
            var src = thumbImg.currentSrc || thumbImg.src;
            mainImg.src = src.replace(/(\?|&)width=\d+/, '$1width=1400');
          }
        }
        if (matchedThumb.scrollIntoView) {
          try { matchedThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); } catch (e) {}
        }
      } else if (mainImg) {
        // No matching thumb (image only attached to variant, not in product.media gallery).
        // Still swap the main img directly to the variant featured image.
        mainImg.src = variant.featured_image.src.replace(/(\?|&)width=\d+/, '$1width=1400');
      }

      // Mobile: scroll the carousel track to the matching slide.
      var track = $('[data-apgo-carousel-track]', form);
      if (track) {
        var slides = $$('.apgo-mpdp-slide', track);
        for (var i = 0; i < slides.length; i++) {
          var simg = $('img', slides[i]);
          if (!simg) continue;
          if (srcFilename(simg.currentSrc || simg.src) === targetFile) {
            try { track.scrollTo({ left: slides[i].offsetLeft, behavior: 'smooth' }); }
            catch (e) { track.scrollLeft = slides[i].offsetLeft; }
            break;
          }
        }
      }
    }

    function onOptionChange() {
      updateCurrentValueLabels();
      var values = readSelectedOptions();
      var variant = findVariant(values);
      updatePriceUI(variant);
      syncMediaToVariant(variant);
    }

    // Wire radio inputs. When the user changes a radio in one layout,
    // mirror the selection into all radios with the same name+value
    // across the form so the desktop ↔ mobile shells stay in sync (e.g.,
    // active class for styling, browser back/forward state).
    $$('input[data-apgo-option-input]', form).forEach(function (input) {
      input.addEventListener('change', function () {
        var name = input.name;
        var val = input.value;
        $$('input[data-apgo-option-input][name="' + CSS.escape(name) + '"]', form).forEach(function (mirror) {
          if (mirror === input) return;
          mirror.checked = (mirror.value === val);
          // Also reflect on the wrapping label for active-class styling
          var labelMirror = mirror.closest('label');
          if (labelMirror) labelMirror.classList.toggle('active', mirror.checked);
        });
        var ownLabel = input.closest('label');
        if (ownLabel) {
          var sib = ownLabel.parentNode ? ownLabel.parentNode.children : [];
          for (var k = 0; k < sib.length; k++) sib[k].classList && sib[k].classList.remove('active');
          ownLabel.classList.add('active');
        }
        onOptionChange();
      });
    });

    // Qty stepper. The form may contain two qty inputs (one in each
    // shell on the unified PDP), so always sync ALL qty inputs to the
    // same value on +/- click and on direct keyboard edit.
    function syncQtyInputs(q) {
      $$('[data-apgo-qty-input]', form).forEach(function (inp) { inp.value = q; });
    }
    $$('[data-apgo-qty]', form).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var dir = btn.getAttribute('data-apgo-qty');
        var inputs = $$('[data-apgo-qty-input]', form);
        if (!inputs.length) return;
        var q = parseInt(inputs[0].value, 10);
        if (isNaN(q) || q < 1) q = 1;
        if (dir === 'up') q += 1;
        if (dir === 'down') q = Math.max(1, q - 1);
        syncQtyInputs(q);
        onOptionChange();
      });
    });
    $$('[data-apgo-qty-input]', form).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var q = parseInt(inp.value, 10);
        if (isNaN(q) || q < 1) q = 1;
        syncQtyInputs(q);
        onOptionChange();
      });
    });

    // Viewport gate — the confirm sheet is a MOBILE-ONLY step (matches
    // apgo-v3). On desktop (≥1024px) the CTA buttons commit directly; on
    // mobile they first open the cream confirm sheet.
    function apgoIsMobileVP() {
      return !(window.matchMedia && window.matchMedia('(min-width: 1024px)').matches);
    }

    // Buy now commit — POST to /cart/add then redirect to the CART page
    // (not checkout) so the customer can review the order + any discounts.
    function apgoCommitBuy() {
      var fd = new FormData(form);
      return fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: fd
      }).then(function (r) { return r.json(); })
        .then(function () { window.location.href = '/cart'; })
        .catch(function () { form.submit(); });
    }

    // Add-to-cart commit — POST to /cart/add.js (no page nav), refresh the
    // cart, fly the product image up to the header cart icon, and dispatch
    // the cart events the rest of the theme (drawer, header count, offers)
    // listens for. `srcBtn` is the element the fly animation originates
    // from (the tapped button, or the sheet's Add button). Returns a
    // promise that REJECTS on failure so the sheet can stay open.
    function apgoCommitAdd(srcBtn) {
      var addBtns = $$('[data-apgo-add]', form);
      addBtns.forEach(function (b) { b.setAttribute('disabled', 'disabled'); b.classList.add('is-loading'); });
      function reenable() {
        addBtns.forEach(function (b) {
          b.classList.remove('is-loading');
          // Re-enable only if the variant is currently available
          var current = findVariant(readSelectedOptions());
          if (current && current.available) b.removeAttribute('disabled');
        });
      }

      var fd = new FormData(form);
      return fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: fd
      })
        .then(function (r) {
          return r.json().then(function (json) { return r.ok ? json : Promise.reject(json); });
        })
        .then(function (added) {
          // Refetch the live cart so header / drawer / offers can sync
          return fetch('/cart.js?_=' + Date.now(), { cache: 'no-store', headers: { 'Accept': 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (cart) { return { added: added, cart: cart }; });
        })
        .then(function (result) {
          // No success toast — the fly-to-cart animation + header bubble
          // bump are the confirmation. (Error toast on failure is kept.)
          apgoFlyToCart(srcBtn || addBtns[0]);
          apgoBroadcastCart(result.cart);

          // Also fire Horizon's typed events when @theme/events ships, so
          // any native cart component stays in sync. Optional; ignore the
          // dynamic-import error on themes without it.
          try {
            import('@theme/events').then(function (mod) {
              if (mod && mod.CartUpdateEvent) {
                document.dispatchEvent(new mod.CartUpdateEvent(result.cart, 'apgo-pdp', {
                  itemCount: result.cart.item_count, source: 'apgo-pdp', sections: {}
                }));
              }
              if (mod && mod.CartAddEvent) {
                document.dispatchEvent(new mod.CartAddEvent({}, 'apgo-pdp', { source: 'apgo-pdp' }));
              }
            }).catch(function () { /* theme without @theme/events — fine */ });
          } catch (_) { /* older browsers without dynamic import */ }
          reenable();
        })
        .catch(function (err) {
          // Surface Shopify's error message if any, otherwise generic
          var msg = (err && err.description) || (err && err.message) || 'Failed to add to cart. Please try again.';
          showApgoCartToast(msg, true);
          reenable();
          throw err; // propagate so the sheet stays open on failure
        });
    }

    // Buy now — mobile opens the confirm sheet; desktop commits directly.
    $$('[data-apgo-buy-now]', form).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (apgoIsMobileVP()) { apgoOpenConfirm('buy'); return; }
        apgoCommitBuy();
      });
    });

    // Add to cart — intercept native form submit so the browser doesn't
    // do a full page navigation. Mobile opens the confirm sheet; desktop
    // commits directly via /cart/add.js.
    form.addEventListener('submit', function (e) {
      // Don't intercept if user explicitly opted out (rare, e.g. legacy gift form)
      if (form.hasAttribute('data-apgo-no-ajax')) return;
      e.preventDefault();
      if (apgoIsMobileVP()) { apgoOpenConfirm('add'); return; }
      apgoCommitAdd(null);
    });

    // ── Mobile confirm sheet ──────────────────────────────────────────
    // Mirrors apgo-v3: on mobile the sticky Add/Buy first open a cream
    // confirm sheet (product image, price, qty stepper, one action). The
    // sheet's own button runs the real commit. Single-variant products →
    // no variant chips, just qty.
    var confirmEl     = $('[data-apgo-confirm]', document);
    var confirmQtyIn  = confirmEl ? $('[data-apgo-confirm-qty-input]', confirmEl) : null;
    var confirmAddBtn = confirmEl ? $('[data-apgo-confirm-add]', confirmEl) : null;
    var confirmBuyBtn = confirmEl ? $('[data-apgo-confirm-buy]', confirmEl) : null;

    function apgoOpenConfirm(intent) {
      // No sheet in DOM (e.g. bundle mode) → fall back to direct commit
      if (!confirmEl) {
        if (intent === 'buy') apgoCommitBuy(); else apgoCommitAdd(null);
        return;
      }
      // Seed the sheet qty from the form's current qty
      var formQty = $('[data-apgo-qty-input]', form);
      if (confirmQtyIn) confirmQtyIn.value = (formQty && parseInt(formQty.value, 10)) || 1;
      confirmEl.setAttribute('data-intent', intent); // add | buy → CSS filters the button
      confirmEl.removeAttribute('hidden');
      confirmEl.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(function () { confirmEl.classList.add('is-open'); });
      document.documentElement.classList.add('apgo-confirm-lock');
    }

    function apgoCloseConfirm() {
      if (!confirmEl) return;
      confirmEl.classList.remove('is-open');
      confirmEl.setAttribute('aria-hidden', 'true');
      document.documentElement.classList.remove('apgo-confirm-lock');
      window.setTimeout(function () {
        if (!confirmEl.classList.contains('is-open')) confirmEl.setAttribute('hidden', '');
      }, 280);
    }

    if (confirmEl) {
      // Close via X / backdrop / Esc
      $$('[data-apgo-confirm-close]', confirmEl).forEach(function (el) {
        el.addEventListener('click', apgoCloseConfirm);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && confirmEl.classList.contains('is-open')) apgoCloseConfirm();
      });

      // Sheet qty stepper — writes back into the form qty inputs so the
      // committed quantity matches what the customer sees in the sheet.
      $$('[data-apgo-confirm-qty]', confirmEl).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var q = parseInt(confirmQtyIn ? confirmQtyIn.value : '1', 10);
          if (isNaN(q) || q < 1) q = 1;
          if (btn.getAttribute('data-apgo-confirm-qty') === 'up') q += 1;
          else q = Math.max(1, q - 1);
          if (confirmQtyIn) confirmQtyIn.value = q;
          syncQtyInputs(q);
          onOptionChange();
        });
      });
      if (confirmQtyIn) {
        confirmQtyIn.addEventListener('change', function () {
          var q = parseInt(confirmQtyIn.value, 10);
          if (isNaN(q) || q < 1) q = 1;
          confirmQtyIn.value = q;
          syncQtyInputs(q);
          onOptionChange();
        });
      }

      // Sheet Add → commit, fly from the sheet button, then close (stay on page)
      if (confirmAddBtn) confirmAddBtn.addEventListener('click', function () {
        apgoCommitAdd(confirmAddBtn).then(apgoCloseConfirm).catch(function () { /* keep sheet open */ });
      });
      // Sheet Buy → commit (redirects to /cart)
      if (confirmBuyBtn) confirmBuyBtn.addEventListener('click', function () {
        apgoCommitBuy();
      });
    }

    // Desktop thumb rail → main image swap
    var mainImg = $('[data-apgo-main-img]', form);
    $$('[data-apgo-thumb-idx]', form).forEach(function (thumb) {
      thumb.addEventListener('click', function () {
        var img = $('img', thumb);
        if (!img || !mainImg) return;
        // Swap the main image src; use 1400px variant if we can derive it
        var src = img.currentSrc || img.src;
        // Replace &width=200 with &width=1400 where possible
        var big = src.replace(/(\?|&)width=\d+/, '$1width=1400');
        mainImg.src = big;
        $$('[data-apgo-thumb-idx]', form).forEach(function (t) { t.classList.remove('active'); });
        thumb.classList.add('active');
      });
    });

    // Thumb rail prev/next nav — scroll by 5 tiles at a time
    (function () {
      var rail = $('[data-apgo-thumb-rail]', form);
      if (!rail) return;
      var prevBtn = $('[data-apgo-thumb-nav="prev"]', form);
      var nextBtn = $('[data-apgo-thumb-nav="next"]', form);

      function stepSize() {
        var firstThumb = rail.querySelector('.apgo-thumb');
        if (!firstThumb) return rail.clientWidth;
        var gap = 10; // must match CSS .apgo-thumb-rail gap
        // Scroll by one full "page" of 5 thumbs
        return (firstThumb.offsetWidth + gap) * 5;
      }

      function updateNav() {
        if (!prevBtn || !nextBtn) return;
        var overflow = rail.scrollWidth - rail.clientWidth > 1;
        if (!overflow) {
          prevBtn.setAttribute('disabled', 'disabled');
          nextBtn.setAttribute('disabled', 'disabled');
          return;
        }
        if (rail.scrollLeft <= 1) prevBtn.setAttribute('disabled', 'disabled');
        else prevBtn.removeAttribute('disabled');
        if (rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1) nextBtn.setAttribute('disabled', 'disabled');
        else nextBtn.removeAttribute('disabled');
      }

      if (prevBtn) prevBtn.addEventListener('click', function () { rail.scrollBy({ left: -stepSize(), behavior: 'smooth' }); });
      if (nextBtn) nextBtn.addEventListener('click', function () { rail.scrollBy({ left: stepSize(), behavior: 'smooth' }); });
      rail.addEventListener('scroll', updateNav, { passive: true });
      window.addEventListener('resize', updateNav);
      // Initial state (after a tick so layout is settled)
      setTimeout(updateNav, 50);
    })();

    // Initial sync
    updateCurrentValueLabels();
    var v0 = findVariant(readSelectedOptions());
    if (v0) updatePriceUI(v0);
  }

  // ---------- mobile tabs ----------
  function initTabs(root) {
    var tabs = $$('[data-apgo-mtab]', root);
    var panels = $$('[data-apgo-mpanel]', root);
    var tabsBar = $('[data-apgo-mtabs]', root);
    var stickyBar = $('[data-apgo-mtabs-sticky]', root) || tabsBar;
    if (!tabs.length || !panels.length) return;

    function alignPanel(panel) {
      if (!panel || !stickyBar) return;
      var stickyTop = parseFloat(window.getComputedStyle(stickyBar).top) || 0;
      var targetTop = stickyTop + stickyBar.offsetHeight;
      var panelPageTop = window.scrollY + panel.getBoundingClientRect().top;
      var nextScrollTop = Math.max(0, panelPageTop - targetTop);
      if (Math.abs(window.scrollY - nextScrollTop) > 1) {
        window.scrollTo({ top: nextScrollTop, behavior: 'auto' });
      }
    }

    function activate(key, shouldAlign) {
      var activeTab = null;
      var activePanel = null;
      tabs.forEach(function (t) {
        var selected = t.getAttribute('data-apgo-mtab') === key;
        t.classList.toggle('active', selected);
        t.setAttribute('aria-selected', selected ? 'true' : 'false');
        t.tabIndex = selected ? 0 : -1;
        if (selected) activeTab = t;
      });
      panels.forEach(function (p) {
        var selected = p.getAttribute('data-apgo-mpanel') === key;
        p.classList.toggle('active', selected);
        p.setAttribute('aria-hidden', selected ? 'false' : 'true');
        if (selected) activePanel = p;
      });

      if (activeTab && tabsBar) {
        var left = activeTab.offsetLeft - ((tabsBar.clientWidth - activeTab.offsetWidth) / 2);
        tabsBar.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
      }

      if (shouldAlign && activePanel) {
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            alignPanel(activePanel);
            window.setTimeout(function () { alignPanel(activePanel); }, 320);
          });
        });
      }
    }

    tabs.forEach(function (t) {
      if (t.getAttribute('data-apgo-tab-bound') === 'true') return;
      t.setAttribute('data-apgo-tab-bound', 'true');
      t.addEventListener('click', function () { activate(t.getAttribute('data-apgo-mtab'), true); });
    });

    // Default → first tab active if none is
    if (!$$('[data-apgo-mtab].active', root).length) {
      activate(tabs[0].getAttribute('data-apgo-mtab'), false);
    } else {
      activate($('[data-apgo-mtab].active', root).getAttribute('data-apgo-mtab'), false);
    }
  }

  // ---------- mobile carousel counter + thumb rail ----------
  function initCarousel(root) {
    var track = $('[data-apgo-carousel-track]', root);
    if (!track) return;
    var idxEl = $('[data-apgo-carousel-idx]', root);
    var totalEl = $('[data-apgo-carousel-total]', root);
    var slides = Array.prototype.slice.call(track.children);
    if (totalEl) totalEl.textContent = slides.length;

    var thumbs = $$('[data-apgo-mthumb-idx]', root);

    function setActiveIndex(i) {
      // Clamp
      if (i < 0) i = 0;
      if (i >= slides.length) i = slides.length - 1;
      // Counter
      if (idxEl) idxEl.textContent = i + 1;
      // Thumbs
      thumbs.forEach(function (t, j) {
        if (j === i) t.classList.add('active');
        else t.classList.remove('active');
      });
      // Scroll active thumb into view
      if (thumbs[i] && thumbs[i].scrollIntoView) {
        try { thumbs[i].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); } catch (e) {}
      }
    }

    function onScroll() {
      if (!slides.length) return;
      var w = track.clientWidth || 1;
      var i = Math.round(track.scrollLeft / w);
      setActiveIndex(i);
    }

    track.addEventListener('scroll', onScroll, { passive: true });

    // Wire thumb clicks → scroll carousel to that slide
    thumbs.forEach(function (t) {
      t.addEventListener('click', function () {
        var i = parseInt(t.getAttribute('data-apgo-mthumb-idx'), 10);
        var slide = slides[i];
        if (!slide) return;
        try { track.scrollTo({ left: slide.offsetLeft, behavior: 'smooth' }); }
        catch (e) { track.scrollLeft = slide.offsetLeft; }
      });
    });

    // Mobile thumb-rail prev/next nav — scroll thumb rail by 5 thumbs at a time
    (function () {
      var rail = $('[data-apgo-mthumb-rail]', root);
      if (!rail) return;
      var prevBtn = $('[data-apgo-mthumb-nav="prev"]', root);
      var nextBtn = $('[data-apgo-mthumb-nav="next"]', root);

      function stepSize() {
        var firstThumb = rail.querySelector('.apgo-mpdp-thumb');
        if (!firstThumb) return rail.clientWidth;
        var gap = 8; // matches CSS .apgo-mpdp-thumb-rail gap
        return (firstThumb.offsetWidth + gap) * 5;
      }

      function updateNav() {
        if (!prevBtn || !nextBtn) return;
        var overflow = rail.scrollWidth - rail.clientWidth > 1;
        if (!overflow) {
          prevBtn.setAttribute('disabled', 'disabled');
          nextBtn.setAttribute('disabled', 'disabled');
          return;
        }
        if (rail.scrollLeft <= 1) prevBtn.setAttribute('disabled', 'disabled');
        else prevBtn.removeAttribute('disabled');
        if (rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1) nextBtn.setAttribute('disabled', 'disabled');
        else nextBtn.removeAttribute('disabled');
      }

      if (prevBtn) prevBtn.addEventListener('click', function () { rail.scrollBy({ left: -stepSize(), behavior: 'smooth' }); });
      if (nextBtn) nextBtn.addEventListener('click', function () { rail.scrollBy({ left: stepSize(), behavior: 'smooth' }); });
      rail.addEventListener('scroll', updateNav, { passive: true });
      window.addEventListener('resize', updateNav);
      setTimeout(updateNav, 50);
    })();

    onScroll();
  }

  // ---------- boot ----------
  function boot() {
    $$('form.apgo-product-form').forEach(initForm);
    $$('[data-section-id]').forEach(function (section) {
      initTabs(section);
      initCarousel(section);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Re-init on Shopify section editor events
  if (window.Shopify && Shopify.designMode) {
    document.addEventListener('shopify:section:load', boot);
    document.addEventListener('shopify:section:select', boot);
  }
})();
