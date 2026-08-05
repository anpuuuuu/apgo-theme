/* APGO Special Event page — cart wiring
 * ---------------------------------------------------------------
 * Behaviour:
 *  - "Add cart" (.apgo-event-listing-card__btn--add,
 *               .apgo-event-featured-banner__btn--add):
 *      POST /cart/add.js with data-variant-id, then animate a
 *      gift-box SVG flying from the button to the header cart icon
 *      and refresh the theme's cart UI.
 *  - "Buy now" (.apgo-event-listing-card__btn--buy,
 *              .apgo-event-featured-banner__btn--buy):
 *      POST /cart/add.js, then window.location = '/cart' (cart page,
 *      NOT /checkout — user verifies discounts/items first).
 *
 * Scoped to body.apgo-special-event-page so the click delegation
 * doesn't accidentally hijack buttons anywhere else.
 * --------------------------------------------------------------- */
(function () {
  'use strict';

  if (!document.body || !document.body.classList.contains('apgo-special-event-page')) {
    return;
  }

  var ADD_SELECTOR =
    '.apgo-event-listing-card__btn--add,' +
    '.apgo-event-featured-banner__btn--add,' +
    '.apgo-event-linked-banner-zone__button--add';
  var BUY_SELECTOR =
    '.apgo-event-listing-card__btn--buy,' +
    '.apgo-event-featured-banner__btn--buy,' +
    '.apgo-event-linked-banner-zone__button--buy';

  /* Header cart icon — used as the target of the fly-to animation
     and the element we pulse after a successful add. The Horizon
     theme renders a <cart-icon> custom element tagged
     data-testid="cart-icon". */
  function findCartIcon() {
    return document.querySelector('[data-testid="cart-icon"]') ||
           document.querySelector('cart-icon');
  }

  function postAdd(variantId) {
    var fd = new FormData();
    fd.append('id', String(variantId));
    fd.append('quantity', '1');
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: fd
    }).then(function (r) {
      if (!r.ok) {
        return r.json().then(function (err) { throw err; });
      }
      return r.json();
    });
  }

  /* Cart UI refresh. Horizon's <cart-icon> listens on 'cart:update'
     and REQUIRES event.detail.data.itemCount to repaint the bubble
     count — without it the badge stays frozen. So we fetch /cart.js
     once after the add, read the authoritative item_count, then fire
     the event with that payload. Also fires the legacy event names
     for any custom drawer/sidebar components that might be present. */
  function refreshCartUi() {
    return fetch('/cart.js', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var itemCount = (cart && typeof cart.item_count === 'number') ? cart.item_count : 0;
        var detail = {
          data: {
            itemCount: itemCount,
            source: 'apgo-event-cart'
          },
          resource: cart
        };
        ['cart:update', 'cart:updated', 'cart:refresh', 'cart:added'].forEach(function (name) {
          try {
            document.dispatchEvent(new CustomEvent(name, {
              bubbles: true,
              detail: detail
            }));
          } catch (e) { /* IE-safe no-op */ }
        });
      })
      .catch(function (err) {
        console.warn('[apgo-event] cart refresh fetch failed', err);
      });
  }

  /* The flying gift box itself. Inline SVG kept small + recolored to
     the page's brand palette so it reads as part of the event design
     rather than a generic emoji. */
  var GIFT_SVG =
    '<svg viewBox="0 0 48 48" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="apgo-gift-body" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#ff9b3a"/>' +
          '<stop offset="1" stop-color="#d96d10"/>' +
        '</linearGradient>' +
        '<linearGradient id="apgo-gift-ribbon" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#f8e3a8"/>' +
          '<stop offset="1" stop-color="#e6b04a"/>' +
        '</linearGradient>' +
      '</defs>' +
      /* Box body */
      '<rect x="6" y="20" width="36" height="22" rx="2" fill="url(#apgo-gift-body)"/>' +
      /* Lid */
      '<rect x="4" y="15" width="40" height="8" rx="2" fill="#b8580a"/>' +
      /* Vertical ribbon */
      '<rect x="21.5" y="15" width="5" height="27" fill="url(#apgo-gift-ribbon)"/>' +
      /* Horizontal ribbon across the lid */
      '<rect x="4" y="17.5" width="40" height="3.5" fill="url(#apgo-gift-ribbon)"/>' +
      /* Bow loops */
      '<ellipse cx="18" cy="12" rx="6" ry="4.5" fill="#f4c66b"/>' +
      '<ellipse cx="30" cy="12" rx="6" ry="4.5" fill="#f4c66b"/>' +
      /* Bow knot */
      '<circle cx="24" cy="12" r="3" fill="#c8961f"/>' +
    '</svg>';

  /* Feature-detect CSS offset-path. Supported in every evergreen
     browser since ~2022 (Chrome, Edge, Firefox, Safari 16+); the
     fallback further down handles the rare ancient WebView. */
  var SUPPORTS_OFFSET_PATH =
    (window.CSS && CSS.supports && CSS.supports('offset-path', 'path("M0 0")'));

  function flyGiftBox(fromEl) {
    var target = findCartIcon();
    if (!target || !fromEl) return;

    var fromRect = fromEl.getBoundingClientRect();
    var toRect = target.getBoundingClientRect();

    var startX = fromRect.left + fromRect.width / 2;
    var startY = fromRect.top + fromRect.height / 2;
    var endX = toRect.left + toRect.width / 2;
    var endY = toRect.top + toRect.height / 2;

    var gift = document.createElement('div');
    gift.className = 'apgo-event-fly-gift';
    gift.innerHTML = GIFT_SVG;
    var styles = gift.style;
    styles.position = 'fixed';
    styles.width = '52px';
    styles.height = '52px';
    styles.zIndex = '99999';
    styles.pointerEvents = 'none';
    styles.filter = 'drop-shadow(0 10px 22px rgba(248, 168, 73, 0.55))';
    styles.willChange = 'transform, opacity, offset-distance';

    if (SUPPORTS_OFFSET_PATH) {
      /* True bezier path. The control point is placed ABOVE the line
         between start and end (lower Y in viewport coords = higher
         on screen) so the gift arcs upward over its trip. Peak
         height scales with horizontal distance — long trips peak
         higher, short trips stay flatter so the curve always reads
         as graceful. */
      var midX = (startX + endX) / 2;
      var midY = (startY + endY) / 2;
      var distX = Math.abs(endX - startX);
      var distY = Math.abs(endY - startY);
      var dist = Math.sqrt(distX * distX + distY * distY);
      /* Peak height: ~25% of trip distance, clamped 60-220px so even
         tiny trips look like an arc and giant trips don't fly off
         the top of the viewport. */
      var peakLift = Math.min(220, Math.max(60, dist * 0.25));
      var ctrlX = midX;
      var ctrlY = midY - peakLift;

      /* offset-anchor: center makes the path position the element's
         CENTER (not top-left), so we don't need translate(-50%, -50%)
         in the transform. The transform is then free for scale +
         rotate effects layered on top of the path motion. */
      styles.offsetPath =
        'path("M ' + startX + ' ' + startY +
        ' Q ' + ctrlX + ' ' + ctrlY + ' ' +
        endX + ' ' + endY + '")';
      styles.offsetAnchor = 'center';
      styles.offsetRotate = '0deg'; /* don't auto-rotate with path tangent — we handle rotation in transform */
      styles.offsetDistance = '0%';

      document.body.appendChild(gift);

      /* Web Animations API: 4 keyframes — start, peak (smaller arc
         feel), late descent, landing. Combined motion: rotates
         playfully through the flight and shrinks into the cart. */
      gift.animate([
        { offsetDistance: '0%',   transform: 'scale(1) rotate(-12deg)',  opacity: 1, offset: 0 },
        { offsetDistance: '45%',  transform: 'scale(0.85) rotate(8deg)', opacity: 1, offset: 0.45 },
        { offsetDistance: '85%',  transform: 'scale(0.45) rotate(28deg)', opacity: 0.92, offset: 0.85 },
        { offsetDistance: '100%', transform: 'scale(0.18) rotate(48deg)', opacity: 0, offset: 1 }
      ], {
        duration: 900,
        easing: 'cubic-bezier(.42, 0, .58, 1)',
        fill: 'forwards'
      });
    } else {
      /* Fallback for ancient browsers without offset-path. Two-axis
         CSS transition — not a real arc but graceful enough. */
      styles.left = startX + 'px';
      styles.top = startY + 'px';
      styles.transform = 'translate(-50%, -50%) scale(1) rotate(-10deg)';
      styles.transition =
        'left 0.75s cubic-bezier(.22,.61,.36,1),' +
        'top 0.75s cubic-bezier(.55,.06,.68,.19),' +
        'transform 0.75s cubic-bezier(.22,.61,.36,1),' +
        'opacity 0.3s ease 0.5s';
      document.body.appendChild(gift);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          gift.style.left = endX + 'px';
          gift.style.top = endY + 'px';
          gift.style.transform =
            'translate(-50%, -50%) scale(0.22) rotate(25deg)';
          gift.style.opacity = '0';
        });
      });
    }

    /* Tear down + pulse the cart icon once the gift has "landed". */
    setTimeout(function () {
      if (gift.parentNode) gift.parentNode.removeChild(gift);
      target.classList.add('apgo-event-cart-pulse');
      setTimeout(function () {
        target.classList.remove('apgo-event-cart-pulse');
      }, 600);
    }, 920);
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.originalLabel) {
        btn.dataset.originalLabel = btn.textContent.trim();
      }
      btn.textContent = 'Adding…';
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    } else {
      if (btn.dataset.originalLabel) {
        btn.textContent = btn.dataset.originalLabel;
        delete btn.dataset.originalLabel;
      }
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }

  /* ── 🎁 Glaze gift-picker modal ────────────────────────────────────
     Rendered by the event grid section when the Glaze promo carries a
     "choose N free gifts" step. The Glaze zone's Add/Buy open this modal
     (mobile bottom sheet / desktop centered dialog via CSS) instead of
     adding directly; the modal CTA commits main + chosen gifts in one
     /cart/add.js items[] call (gifts tagged _gift_pick; AIOD prices $0). */
  var giftModal = document.querySelector('[data-apgo-event-gift-modal]');
  var giftPickerEl = giftModal ? giftModal.querySelector('[data-apgo-cc-gift-picker]') : null;
  var giftRequired = giftPickerEl ? (parseInt(giftPickerEl.getAttribute('data-gift-count'), 10) || 2) : 2;
  var giftProperty = giftPickerEl ? (giftPickerEl.getAttribute('data-gift-property') || '_gift_pick') : '_gift_pick';
  var giftChosen = [];      // chosen gift variant ids (strings)
  var giftMainVariant = null; // pending main-product variant id
  var giftTriggerBtn = null;  // banner button that opened the modal (fly origin)

  function giftModalReady() { return giftChosen.length === giftRequired; }

  function renderGiftModal() {
    if (!giftModal) return;
    var atMax = giftChosen.length >= giftRequired;
    var opts = giftModal.querySelectorAll('[data-apgo-cc-gift-option]');
    Array.prototype.forEach.call(opts, function (btn) {
      var id = btn.getAttribute('data-gift-variant');
      var soldout = btn.classList.contains('is-soldout');
      var chosen = giftChosen.indexOf(id) !== -1;
      btn.classList.toggle('is-selected', chosen);
      btn.setAttribute('aria-pressed', chosen ? 'true' : 'false');
      btn.classList.toggle('is-disabled', !chosen && atMax && !soldout);
      btn.disabled = soldout || (!chosen && atMax);
    });
    var counter = giftModal.querySelector('[data-apgo-cc-gift-counter]');
    if (counter) counter.textContent = giftChosen.length + '/' + giftRequired;
    if (giftPickerEl) giftPickerEl.classList.toggle('is-complete', giftModalReady());
    var addCta = giftModal.querySelector('[data-apgo-event-gift-add]');
    var buyCta = giftModal.querySelector('[data-apgo-event-gift-buy]');
    if (addCta) addCta.disabled = !giftModalReady();
    if (buyCta) buyCta.disabled = !giftModalReady();
  }

  function openGiftModal(intent, variantId, triggerBtn) {
    if (!giftModal) return;
    giftMainVariant = variantId;
    giftTriggerBtn = triggerBtn || null;
    giftModal.setAttribute('data-intent', intent);
    giftModal.removeAttribute('hidden');
    giftModal.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('apgo-event-gift-lock');
    requestAnimationFrame(function () { giftModal.classList.add('is-open'); });
    renderGiftModal();
  }

  function closeGiftModal() {
    if (!giftModal) return;
    giftModal.classList.remove('is-open');
    giftModal.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('apgo-event-gift-lock');
    window.setTimeout(function () {
      if (!giftModal.classList.contains('is-open')) giftModal.setAttribute('hidden', '');
    }, 280);
  }

  function commitGiftModal(intent, ctaBtn) {
    if (!giftModal || !giftMainVariant || !giftModalReady()) return;
    if (ctaBtn) { ctaBtn.disabled = true; ctaBtn.setAttribute('aria-busy', 'true'); }
    var items = [{ id: parseInt(giftMainVariant, 10), quantity: 1 }];
    giftChosen.forEach(function (id) {
      var props = {};
      props[giftProperty] = 'true';
      items.push({ id: parseInt(id, 10), quantity: 1, properties: props });
    });
    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: items })
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (err) { throw err; });
      return r.json();
    }).then(function () {
      if (intent === 'buy') {
        window.location.href = '/cart';
        return;
      }
      closeGiftModal();
      if (giftTriggerBtn) flyGiftBox(giftTriggerBtn);
      refreshCartUi();
      if (ctaBtn) { ctaBtn.disabled = false; ctaBtn.removeAttribute('aria-busy'); }
    }).catch(function (err) {
      if (ctaBtn) { ctaBtn.disabled = false; ctaBtn.removeAttribute('aria-busy'); }
      var msg = (err && (err.description || err.message)) ||
                'Could not add to cart. Please try again.';
      window.alert(msg);
    });
  }

  if (giftModal) {
    giftModal.addEventListener('click', function (e) {
      if (e.target.closest('[data-apgo-event-gift-close]')) { closeGiftModal(); return; }
      var opt = e.target.closest('[data-apgo-cc-gift-option]');
      if (opt && !opt.disabled && !opt.classList.contains('is-soldout')) {
        var id = opt.getAttribute('data-gift-variant');
        var idx = giftChosen.indexOf(id);
        if (idx !== -1) giftChosen.splice(idx, 1);
        else if (giftChosen.length < giftRequired) giftChosen.push(id);
        renderGiftModal();
        return;
      }
      var addCta = e.target.closest('[data-apgo-event-gift-add]');
      if (addCta) { commitGiftModal('add', addCta); return; }
      var buyCta = e.target.closest('[data-apgo-event-gift-buy]');
      if (buyCta) { commitGiftModal('buy', buyCta); return; }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && giftModal.classList.contains('is-open')) closeGiftModal();
    });
  }

  function handleClick(e) {
    var addBtn = e.target.closest(ADD_SELECTOR);
    var buyBtn = e.target.closest(BUY_SELECTOR);
    var btn = addBtn || buyBtn;
    if (!btn) return;

    var variantId = btn.getAttribute('data-variant-id');
    if (!variantId) return;

    e.preventDefault();
    e.stopPropagation();
    if (btn.disabled) return;

    /* Glaze zone with gift picker → open the modal instead of adding. */
    if (giftModal && btn.closest('.apgo-event-linked-banner-zone--glaze')) {
      openGiftModal(buyBtn ? 'buy' : 'add', variantId, btn);
      return;
    }

    setBusy(btn, true);

    postAdd(variantId).then(function () {
      if (buyBtn) {
        /* Buy now: jump straight to the cart page (NOT /checkout, so
           the customer can still see / verify discounts before
           committing). No need to un-busy — we're navigating away. */
        window.location.href = '/cart';
        return;
      }
      /* Add to cart: animate the gift, refresh whatever cart UI the
         theme has mounted, restore the button. */
      flyGiftBox(btn);
      refreshCartUi();
      setBusy(btn, false);
    }).catch(function (err) {
      console.error('[apgo-event] add to cart failed', err);
      setBusy(btn, false);
      var msg = (err && (err.description || err.message)) ||
                'Could not add to cart. Please try again.';
      try {
        window.dispatchEvent(new CustomEvent('apgo:cart-error', {
          detail: {
            variant_id: variantId,
            cta_type: buyBtn ? 'buy_now' : 'add_to_cart',
            error_type: 'cart_add_failed'
          }
        }));
      } catch (eventError) {}
      window.alert(msg);
    });
  }

  function initScrollCues(root) {
    var scope = root || document;
    if (!scope.querySelectorAll) return;

    var viewports = scope.querySelectorAll('[data-apgo-scroll-viewport]');
    Array.prototype.forEach.call(viewports, function (viewport) {
      if (viewport.getAttribute('data-apgo-scroll-ready') === 'true') return;

      var track = viewport.querySelector('[data-apgo-scroll-track]');
      var previousButton = viewport.querySelector('[data-apgo-scroll-previous]');
      var nextButton = viewport.querySelector('[data-apgo-scroll-next]');
      if (!track || !previousButton || !nextButton) return;

      var zone = viewport.closest('.apgo-event-scroll-zone');
      var hint = zone ? zone.querySelector('[data-apgo-scroll-hint]') : null;
      var dismissed = false;
      var reducedMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      viewport.setAttribute('data-apgo-scroll-ready', 'true');

      function updateScrollCue() {
        var maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
        var hasOverflow = maxScroll > 8;

        if (track.scrollLeft > 16) dismissed = true;
        previousButton.hidden = !hasOverflow;
        previousButton.disabled = !hasOverflow || track.scrollLeft <= 8;
        nextButton.hidden = !hasOverflow;
        nextButton.disabled = !hasOverflow || track.scrollLeft >= maxScroll - 8;

        if (hint) {
          hint.hidden = !hasOverflow;
          hint.classList.toggle('is-dismissed', dismissed);
        }
      }

      function dismissHint() {
        dismissed = true;
        if (hint) hint.classList.add('is-dismissed');
      }

      previousButton.addEventListener('click', function () {
        var distance = Math.max(track.clientWidth * 0.8, 240);
        dismissHint();
        track.scrollTo({
          left: Math.max(0, track.scrollLeft - distance),
          behavior: reducedMotion ? 'auto' : 'smooth'
        });
      });

      nextButton.addEventListener('click', function () {
        var maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
        var distance = Math.max(track.clientWidth * 0.8, 240);
        dismissHint();
        track.scrollTo({
          left: Math.min(maxScroll, track.scrollLeft + distance),
          behavior: reducedMotion ? 'auto' : 'smooth'
        });
      });

      track.addEventListener('scroll', updateScrollCue, { passive: true });
      track.addEventListener('pointerdown', dismissHint, { passive: true });
      track.addEventListener('touchstart', dismissHint, { passive: true });

      if ('ResizeObserver' in window) {
        var resizeObserver = new ResizeObserver(updateScrollCue);
        resizeObserver.observe(track);
      } else {
        window.addEventListener('resize', updateScrollCue, { passive: true });
      }

      updateScrollCue();
    });
  }

  function initStockCounters(root) {
    var scope = root || document;
    if (!scope.querySelectorAll) return;

    var counters = scope.querySelectorAll('[data-aurora-stock-counter]');
    Array.prototype.forEach.call(counters, function (counter) {
      if (counter.getAttribute('data-counter-ready') === 'true') return;

      var number = counter.querySelector('[data-aurora-stock-number]');
      var total = parseInt(counter.getAttribute('data-total'), 10);
      var remaining = parseInt(counter.getAttribute('data-remaining'), 10);
      if (!number || !Number.isFinite(total) || !Number.isFinite(remaining)) return;

      counter.setAttribute('data-counter-ready', 'true');
      number.textContent = String(remaining);

      var reducedMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion || total <= remaining) return;

      counter.classList.add('is-counting');

      function startCounter() {
        var startedAt = null;
        var duration = Math.min(1400, Math.max(800, (total - remaining) * 8));

        requestAnimationFrame(function () {
          counter.classList.add('is-counting-ready');
        });

        function updateNumber(timestamp) {
          if (startedAt === null) startedAt = timestamp;
          var progress = Math.min(1, (timestamp - startedAt) / duration);
          var eased = 1 - Math.pow(1 - progress, 3);
          var current = Math.round(total + ((remaining - total) * eased));
          number.textContent = String(current);

          if (progress < 1) {
            requestAnimationFrame(updateNumber);
          } else {
            number.textContent = String(remaining);
            counter.classList.remove('is-counting', 'is-counting-ready');
          }
        }

        requestAnimationFrame(updateNumber);
      }

      if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function (entries) {
          if (!entries[0] || !entries[0].isIntersecting) return;
          observer.disconnect();
          startCounter();
        }, { threshold: 0.35 });
        observer.observe(counter);
      } else {
        startCounter();
      }
    });
  }

  document.addEventListener('click', handleClick);
  initScrollCues(document);
  initStockCounters(document);
  document.addEventListener('shopify:section:load', function (event) {
    initScrollCues(event.target);
    initStockCounters(event.target);
  });
})();
