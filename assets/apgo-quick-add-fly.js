/*
 * APGO Quick-Add → Fly-to-Cart animation
 * ---------------------------------------------------------------
 * Same visual language as the PDP add-to-cart (apgo-cc-pdp-picker
 * playFlyToCart): a thumbnail-sized clone of the product image
 * arcs from the quick-add button to the header cart icon, then
 * pulses the icon on landing.
 *
 * Trigger: cart:update event where
 *   - detail.data.source === 'product-form-component'
 *   - event.target is inside <quick-add-component> or
 *     <quick-add-dialog> (the collection-card quick-add UI).
 *
 * This intentionally REPLACES the 'Added to cart' toast that
 * apgo-cart-toast.js used to show on the same trigger — only one
 * piece of feedback so the UI isn't cluttered.
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';

  /* Inject the cart-icon pulse keyframes once. Lives next to PDP's
     identical rule (which only loads on the PDP) — adding here makes
     the same animation available wherever quick-add fires. */
  function ensurePulseStyles() {
    if (document.getElementById('apgo-fly-to-cart-styles')) return;
    var style = document.createElement('style');
    style.id = 'apgo-fly-to-cart-styles';
    style.textContent =
      'cart-icon.apgo-cart-icon-bump,' +
      '.header-actions__cart-icon.apgo-cart-icon-bump {' +
      '  animation: apgoCartIconBump .42s cubic-bezier(.34, 1.56, .64, 1);' +
      '  transform-origin: center;' +
      '}' +
      '@keyframes apgoCartIconBump {' +
      '  0%   { transform: scale(1);    }' +
      '  35%  { transform: scale(1.28); }' +
      '  65%  { transform: scale(0.94); }' +
      '  100% { transform: scale(1);    }' +
      '}' +
      '@media (prefers-reduced-motion: reduce) {' +
      '  cart-icon.apgo-cart-icon-bump,' +
      '  .header-actions__cart-icon.apgo-cart-icon-bump { animation: none; }' +
      '}';
    document.head.appendChild(style);
  }

  function findCartIcon() {
    return document.querySelector('cart-icon, .header-actions__cart-icon, [data-testid="cart-icon"]');
  }

  /* Walk up from the quick-add origin to the product card, then grab
     the first image. Tries a few wrapper selectors so this works on
     stock Horizon product cards AND on any APGO custom card variant. */
  function findProductImage(origin) {
    var card = origin.closest(
      'product-card,' +
      '.product-card,' +
      '.product-grid__card,' +
      '.apgo-event-listing-card,' +
      'li.product-grid__item'
    );
    if (!card) return null;
    var img = card.querySelector('img');
    if (!img) return null;
    if (!(img.currentSrc || img.src)) return null;
    return img;
  }

  function playFly(originEl) {
    var cartIcon = findCartIcon();
    var img = findProductImage(originEl);
    if (!cartIcon || !img) return;

    ensurePulseStyles();

    var imgSrc = img.currentSrc || img.src;

    /* Source point = center of the originating element (the quick-add
       button itself). Falls back to the product image if the button
       rect comes back as 0x0 (rare, but happens when the button is
       hidden behind a modal). */
    var srcRect = originEl.getBoundingClientRect();
    if (srcRect.width === 0 && srcRect.height === 0) {
      srcRect = img.getBoundingClientRect();
    }
    var iconRect = cartIcon.getBoundingClientRect();
    var startX = srcRect.left + srcRect.width / 2;
    var startY = srcRect.top + srcRect.height / 2;
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

    /* Force a layout flush so the browser commits the start position
       before the transition kicks in — without it, some browsers
       batch the styles and the ghost just teleports. */
    void ghost.offsetWidth;
    var dx = endX - startX;
    var dy = endY - startY;
    ghost.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(0.18) rotate(8deg)';
    ghost.style.opacity = '0';

    setTimeout(function () {
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
      cartIcon.classList.add('apgo-cart-icon-bump');
      setTimeout(function () {
        cartIcon.classList.remove('apgo-cart-icon-bump');
      }, 480);
    }, 760);
  }

  document.addEventListener('cart:update', function (event) {
    var data = event.detail && event.detail.data;
    if (!data || data.didError) return;
    if (data.source !== 'product-form-component') return;

    var origin = event.target;
    if (!(origin instanceof HTMLElement)) return;
    if (!origin.closest('quick-add-component') &&
        !origin.closest('quick-add-dialog')) {
      return;
    }
    playFly(origin);
  });
})();
