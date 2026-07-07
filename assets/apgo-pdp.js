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

  function formatMoney(cents) {
    // Try Shopify's global formatter if present; otherwise a sensible TWD default.
    if (window.Shopify && typeof window.Shopify.formatMoney === 'function') {
      var fmt = (window.theme && window.theme.moneyFormat) || '{{amount}}';
      try { return window.Shopify.formatMoney(cents, fmt); } catch (e) { /* fall through */ }
    }
    var n = Number(cents) / 100;
    // NT$ 1,234 — matches the rest of the theme's default
    return 'NT$ ' + n.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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
        n.textContent = '分 3 期 0 利率 · 每期 ' + formatMoney(Math.round(price / 3));
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

    // Buy now — submit to /cart/add then redirect /checkout
    $$('[data-apgo-buy-now]', form).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var fd = new FormData(form);
        fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: fd
        }).then(function (r) { return r.json(); })
          .then(function () { window.location.href = '/checkout'; })
          .catch(function () { form.submit(); });
      });
    });

    // Add to cart — intercept native form submit so the browser doesn't
    // do a full page navigation to /cart. POST to /cart/add.js instead,
    // then refresh the cart, dispatch the events the rest of the theme
    // (cart drawer, header count, conditional offers) already listens
    // for, and pop a success toast. Falls back to a normal submit if the
    // network fails.
    form.addEventListener('submit', function (e) {
      // Don't intercept if user explicitly opted out (rare, e.g. legacy gift form)
      if (form.hasAttribute('data-apgo-no-ajax')) return;
      e.preventDefault();

      var addBtns = $$('[data-apgo-add]', form);
      addBtns.forEach(function (b) { b.setAttribute('disabled', 'disabled'); b.classList.add('is-loading'); });

      var fd = new FormData(form);
      fetch('/cart/add.js', {
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
          showApgoCartToast('✓ 已加入購物車');

          // Legacy + Horizon-style cart events. The Horizon CartUpdateEvent
          // module is optional; ignore the dynamic-import error on themes
          // that don't ship @theme/events.
          document.dispatchEvent(new CustomEvent('cart:update', { detail: { cart: result.cart } }));
          document.documentElement.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true, detail: { cart: result.cart } }));
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
            }).catch(function () { /* theme without @theme/events — toast alone is fine */ });
          } catch (_) { /* older browsers without dynamic import */ }

          // If a cart drawer is in the DOM, ask it to open
          var drawer = document.querySelector('cart-drawer-component, cart-drawer, [data-apgo-cart-drawer]');
          if (drawer && typeof drawer.open === 'function') {
            try { drawer.open(); } catch (_) { /* swallow */ }
          }
        })
        .catch(function (err) {
          // Surface Shopify's error message if any, otherwise generic
          var msg = (err && err.description) || (err && err.message) || '加入購物車失敗，請再試一次';
          showApgoCartToast(msg, true);
        })
        .then(function () {
          addBtns.forEach(function (b) {
            b.classList.remove('is-loading');
            // Re-enable only if the variant is currently available
            var values = readSelectedOptions();
            var current = findVariant(values);
            if (current && current.available) b.removeAttribute('disabled');
          });
        });
    });

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
    if (!tabs.length || !panels.length) return;

    function activate(key) {
      tabs.forEach(function (t) {
        if (t.getAttribute('data-apgo-mtab') === key) t.classList.add('active');
        else t.classList.remove('active');
      });
      panels.forEach(function (p) {
        if (p.getAttribute('data-apgo-mpanel') === key) p.classList.add('active');
        else p.classList.remove('active');
      });
    }

    tabs.forEach(function (t) {
      t.addEventListener('click', function () { activate(t.getAttribute('data-apgo-mtab')); });
    });

    // Default → first tab active if none is
    if (!$$('[data-apgo-mtab].active', root).length) {
      activate(tabs[0].getAttribute('data-apgo-mtab'));
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
