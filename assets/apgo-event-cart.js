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
    '.apgo-event-featured-banner__btn--add';
  var BUY_SELECTOR =
    '.apgo-event-listing-card__btn--buy,' +
    '.apgo-event-featured-banner__btn--buy';

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

  /* Best-effort cart UI refresh. The theme listens on several event
     names depending on which component (drawer, header bubble, sticky
     buy bar) is mounted; firing all of them is cheap and keeps each
     component in sync without us knowing which is present. */
  function refreshCartUi() {
    var events = ['cart:updated', 'cart:update', 'cart:refresh', 'cart:added'];
    events.forEach(function (name) {
      try {
        document.dispatchEvent(new CustomEvent(name, { bubbles: true }));
      } catch (e) { /* IE-safe no-op */ }
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

    /* Position the gift element at the button center using fixed +
       translate(-50%, -50%) so its center sits on the start point.
       The center-anchored transform also makes the end scale shrink
       toward the cart icon rather than collapsing toward the
       top-left of its bounding box. */
    var styles = gift.style;
    styles.position = 'fixed';
    styles.left = startX + 'px';
    styles.top = startY + 'px';
    styles.width = '52px';
    styles.height = '52px';
    styles.zIndex = '99999';
    styles.pointerEvents = 'none';
    styles.transform = 'translate(-50%, -50%) scale(1) rotate(-10deg)';
    styles.transformOrigin = 'center';
    styles.filter = 'drop-shadow(0 10px 22px rgba(248, 168, 73, 0.55))';
    styles.transition =
      'left 0.75s cubic-bezier(.22,.61,.36,1),' +
      'top 0.75s cubic-bezier(.55,.06,.68,.19),' +
      'transform 0.75s cubic-bezier(.22,.61,.36,1),' +
      'opacity 0.3s ease 0.5s';
    styles.willChange = 'left, top, transform, opacity';

    document.body.appendChild(gift);

    /* Double rAF — first paints the gift at the start point, second
       triggers the transition to the cart icon. Without the double,
       browsers sometimes batch the styles and we get a jump. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        gift.style.left = endX + 'px';
        gift.style.top = endY + 'px';
        gift.style.transform =
          'translate(-50%, -50%) scale(0.22) rotate(25deg)';
        gift.style.opacity = '0';
      });
    });

    /* Tear down + pulse the cart icon once the gift has "landed". */
    setTimeout(function () {
      if (gift.parentNode) gift.parentNode.removeChild(gift);
      target.classList.add('apgo-event-cart-pulse');
      setTimeout(function () {
        target.classList.remove('apgo-event-cart-pulse');
      }, 600);
    }, 850);
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
      window.alert(msg);
    });
  }

  document.addEventListener('click', handleClick);
})();
