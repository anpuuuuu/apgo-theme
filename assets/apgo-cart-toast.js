import { ThemeEvents } from '@theme/events';

function toastMessage() {
  if (typeof Theme !== 'undefined' && Theme.translations?.added) {
    return Theme.translations.added;
  }
  return 'Added to cart';
}

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

document.addEventListener(ThemeEvents.cartUpdate, (event) => {
  const data = event.detail?.data;
  if (!data || data.didError) return;
  if (data.source !== 'product-form-component') return;

  const origin = event.target;
  if (
    !(origin instanceof HTMLElement) ||
    (!origin.closest('quick-add-component') && !origin.closest('quick-add-dialog'))
  ) {
    return;
  }

  const el = ensureToastEl();
  el.textContent = toastMessage();
  el.dataset.visible = 'true';
  window.clearTimeout(el._apgoCartToastHide);
  el._apgoCartToastHide = window.setTimeout(() => {
    delete el.dataset.visible;
  }, 2800);
});
