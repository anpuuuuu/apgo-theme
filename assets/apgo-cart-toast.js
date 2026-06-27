/*
 * Quick-add 'Added to cart' toast — disabled.
 *
 * The auto-toast on quick-add success has been replaced by the
 * fly-to-cart animation in apgo-quick-add-fly.js (matches the
 * product page UX). This file is kept as a no-op so the buybar
 * + any other component that creates the global #apgo-cart-toast
 * element on demand (via getElementById / its own helpers) still
 * has the element available.
 */
function ensureToastEl() {
  let el = document.getElementById('apgo-cart-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'apgo-cart-toast';
    el.className = 'apgo-cart-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
}
/* Expose so legacy callers (buybar etc.) that previously imported
   this module still get the DOM helper. No global listener. */
window.apgoCartToastEnsure = ensureToastEl;
