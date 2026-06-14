import { CartAddEvent } from '@theme/events';

/**
 * @typedef {{ id: number; title: string; price_cents: number; available: boolean; inventory_quantity: number; show_inventory: boolean; featured_image: string | null; featured_image_high: string | null; is_bundle: boolean }} ApgoCollVariant
 * @typedef {{ product_id: number; handle: string; title: string; subtitle: string; currency: string; featured_image: string | null; featured_image_high: string | null; variants: ApgoCollVariant[] }} ApgoCollProduct
 */

const state = {
  /** @type {ApgoCollProduct | null} */
  product: null,
  currentVariantId: /** @type {number | null} */ (null),
  currentPriceCents: 0,
  currentQuantity: 1,
};

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getShell() {
  return document.getElementById('apgoCollectionVariantShell');
}

function strFromShell(shell, key) {
  const v = shell?.dataset?.[key];
  return typeof v === 'string' ? v : '';
}

function formatMoney(cents, currency) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'TWD',
    }).format(cents / 100);
  } catch {
    return String(cents / 100);
  }
}

/**
 * @param {string} productTitle
 * @param {string} successLine
 * @param {string} viewCartLabel
 */
function showSuccessNotification(productTitle, successLine, viewCartLabel) {
  document.querySelectorAll('.apgo-cart-success-toast').forEach((el) => el.remove());

  const notification = document.createElement('div');
  notification.className = 'apgo-cart-success-toast';
  notification.setAttribute('role', 'status');
  notification.setAttribute('aria-live', 'polite');
  notification.innerHTML = `
    <span class="apgo-cart-success-toast__check" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.25 4.75L6.5 12.25L2.75 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </span>
    <div class="apgo-cart-success-toast__body">
      <span class="apgo-cart-success-toast__title">${escapeHtml(productTitle)}</span>
      <span class="apgo-cart-success-toast__sub">${escapeHtml(successLine)}</span>
    </div>
    <a href="/cart" class="apgo-cart-success-toast__cta">${escapeHtml(viewCartLabel)}</a>
    <button type="button" class="apgo-cart-success-toast__close" aria-label="Close">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1L11 11M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </button>
  `;
  notification.querySelector('.apgo-cart-success-toast__close')?.addEventListener('click', () => notification.remove());

  document.body.appendChild(notification);
  requestAnimationFrame(() => notification.classList.add('apgo-cart-success-toast--visible'));
  window.setTimeout(() => {
    notification.classList.remove('apgo-cart-success-toast--visible');
    window.setTimeout(() => notification.remove(), 380);
  }, 4200);
}

function updateAllCartCounts(count) {
  const cartBubbleCount = document.querySelector('.cart-bubble__text-count, [ref="cartBubbleCount"]');
  if (cartBubbleCount) cartBubbleCount.textContent = String(count);

  const visuallyHidden = document.querySelector('.cart-bubble__text .visually-hidden');
  if (visuallyHidden) visuallyHidden.textContent = `購物車內品項總數: ${count}`;

  const cartLink = document.querySelector('.action__cart');
  if (cartLink) cartLink.setAttribute('aria-label', `購物車 購物車內品項總數: ${count}`);

  const cartIcon = document.querySelector('cart-icon');
  if (cartIcon) {
    if (count > 0) {
      cartIcon.classList.add('header-actions__cart-icon--has-cart');
      const bubble = cartIcon.querySelector('.cart-bubble');
      if (bubble) bubble.style.display = '';
    } else {
      cartIcon.classList.remove('header-actions__cart-icon--has-cart');
      const bubble = cartIcon.querySelector('.cart-bubble');
      if (bubble) bubble.style.display = 'none';
    }
  }

  window.dispatchEvent(new CustomEvent('cart:updated', { detail: { count } }));
}

function updatePriceDisplay(shell) {
  if (!state.product || state.currentVariantId == null) return;
  const lineCents = state.currentPriceCents * state.currentQuantity;
  const el = document.getElementById('apgoCollTotalPrice');
  if (el) el.textContent = formatMoney(lineCents, state.product.currency);
}

function updateModalButtonState() {
  const selected = document.querySelector('#apgoCollectionVariantShell .apgo-variant-option.selected');
  const addBtn = document.getElementById('apgoCollAddBtn');
  const buyBtn = document.getElementById('apgoCollBuyBtn');
  if (!addBtn || !buyBtn) return;
  const ok = !!selected;
  addBtn.disabled = !ok;
  buyBtn.disabled = !ok;
}

/**
 * @param {HTMLElement} el
 * @param {ApgoCollProduct} data
 */
function selectVariantElement(el, data) {
  if (el.classList.contains('disabled')) return;

  const shell = getShell();
  if (!shell) return;

  shell.querySelectorAll('.apgo-variant-option').forEach((o) => o.classList.remove('selected'));
  el.classList.add('selected');

  state.currentVariantId = Number(el.dataset.apgoVid);
  state.currentPriceCents = Number(el.dataset.apgoPriceCents || 0);
  state.currentQuantity = 1;
  const qtyEl = document.getElementById('apgoCollQtyValue');
  if (qtyEl) qtyEl.textContent = '1';

  const img = el.dataset.apgoImg;
  const modalImg = /** @type {HTMLImageElement | null} */ (document.getElementById('apgoCollModalImg'));
  if (modalImg) {
    if (img && img !== 'null' && img !== '') {
      modalImg.src = img;
      const hi = el.dataset.apgoImgHi || img.replace(/width=(200|800)/g, 'width=1200');
      modalImg.dataset.currentHighRes = hi;
    } else if (data.featured_image) {
      modalImg.src = data.featured_image;
      modalImg.dataset.currentHighRes = data.featured_image_high || data.featured_image;
    }
  }

  updatePriceDisplay(shell);
  updateModalButtonState();
  if (navigator.vibrate) navigator.vibrate(30);
}

/**
 * @param {ApgoCollProduct} data
 * @param {number} initialVariantId
 */
function buildModalMarkup(data, initialVariantId) {
  const shell = getShell();
  if (!shell) return '';

  const singles = data.variants.filter((v) => !v.is_bundle);
  const bundles = data.variants.filter((v) => v.is_bundle);
  const firstAvail = data.variants.find((v) => v.available) || data.variants[0];
  let selected = data.variants.find((v) => v.id === initialVariantId && v.available) || firstAvail;
  if (!selected) selected = data.variants[0];

  const selectedInSingles = singles.some((v) => v.id === selected.id);
  const selectedInBundles = bundles.some((v) => v.id === selected.id);

  const optHtml = (/** @type {ApgoCollVariant} */ v, isSelected) => {
    const dis = !v.available ? 'disabled' : '';
    const sel = isSelected ? 'selected' : '';
    const inv =
      v.available && v.show_inventory
        ? `<div class="apgo-variant-quantity">${escapeHtml(strFromShell(shell, 'i18nInv'))}: ${v.inventory_quantity}</div>`
        : !v.available
          ? `<div class="apgo-variant-quantity">${escapeHtml(strFromShell(shell, 'i18nSoldOut'))}</div>`
          : '';
    const img = v.featured_image || '';
    const imgHi = v.featured_image_high || '';
    const click = v.available
      ? `data-apgo-coll-opt="1" data-apgo-vid="${v.id}" data-apgo-price-cents="${v.price_cents}" data-apgo-img="${escapeHtml(img)}" data-apgo-img-hi="${escapeHtml(imgHi)}"`
      : '';
    return `<div class="apgo-variant-option ${sel} ${dis}" role="button" tabindex="0" ${click}>
      <div class="apgo-variant-name">${escapeHtml(v.title)}</div>
      <div class="apgo-variant-price">${formatMoney(v.price_cents, data.currency)}</div>
      ${inv}
    </div>`;
  };

  let singlesBlock = '';
  if (singles.length) {
    const opts = singles.map((v) => optHtml(v, selectedInSingles && v.id === selected.id)).join('');
    singlesBlock = `<div class="apgo-variant-section"><div class="apgo-variant-label">${escapeHtml(strFromShell(shell, 'i18nSingle'))}</div><div class="apgo-variant-options">${opts}</div></div>`;
  }

  let bundlesBlock = '';
  if (bundles.length) {
    const opts = bundles.map((v) => optHtml(v, selectedInBundles && v.id === selected.id)).join('');
    bundlesBlock = `<div class="apgo-variant-section"><div class="apgo-variant-label">${escapeHtml(strFromShell(shell, 'i18nBundle'))}</div><div class="apgo-variant-options">${opts}</div></div>`;
  }

  const subtitle = data.subtitle ? `<div class="apgo-modal-product-desc">${escapeHtml(data.subtitle)}</div>` : '';
  const feat = data.featured_image || '';
  const featHi = data.featured_image_high || feat;

  state.product = data;
  state.currentVariantId = selected.id;
  state.currentPriceCents = selected.price_cents;
  state.currentQuantity = 1;

  const imgSrc = selected.featured_image || data.featured_image || '';
  const imgHi = selected.featured_image_high || data.featured_image_high || imgSrc;

  return `
    <div class="apgo-variant-modal-scroll">
      <div class="apgo-modal-header">
        <h3 class="apgo-modal-title">${escapeHtml(strFromShell(shell, 'i18nSelect'))}</h3>
        <button type="button" class="apgo-close-modal" data-apgo-collection-drawer-close aria-label="Close">✕</button>
      </div>
      <div class="apgo-modal-product-preview">
        <img src="${escapeHtml(imgSrc || feat)}" alt="" class="apgo-modal-product-image" id="apgoCollModalImg" width="200" height="200" loading="lazy"
          data-default-src="${escapeHtml(feat)}" data-default-high-res="${escapeHtml(featHi)}" data-current-high-res="${escapeHtml(imgHi)}" />
        <div class="apgo-modal-product-info">
          <div class="apgo-modal-product-name">${escapeHtml(data.title)}</div>
          ${subtitle}
        </div>
      </div>
      ${singlesBlock}
      ${bundlesBlock}
      <div class="apgo-quantity-selector">
        <div class="apgo-quantity-label">${escapeHtml(strFromShell(shell, 'i18nQty'))}</div>
        <div class="apgo-quantity-controls">
          <button type="button" class="apgo-quantity-btn" data-apgo-qty="-1">−</button>
          <span class="apgo-quantity-value" id="apgoCollQtyValue">1</span>
          <button type="button" class="apgo-quantity-btn" data-apgo-qty="1">+</button>
        </div>
      </div>
      <p class="apgo-modal-total-line">
        <span>${escapeHtml(strFromShell(shell, 'i18nTotal'))}</span>
        <span class="apgo-modal-total-amount" id="apgoCollTotalPrice">${formatMoney(state.currentPriceCents, data.currency)}</span>
      </p>
    </div>
    <div class="apgo-variant-modal-footer">
      <div class="apgo-modal-buttons">
        <button type="button" class="apgo-modal-btn apgo-modal-btn-secondary" id="apgoCollAddBtn">${escapeHtml(strFromShell(shell, 'i18nAdd'))}</button>
        <button type="button" class="apgo-modal-btn apgo-modal-btn-primary" id="apgoCollBuyBtn">${escapeHtml(strFromShell(shell, 'i18nBuy'))}</button>
      </div>
    </div>
  `;
}

function openDrawer(data, initialVariantId) {
  const shell = getShell();
  const modal = document.getElementById('apgoCollectionVariantModal');
  const overlay = document.getElementById('apgoCollectionModalOverlay');
  const inner = document.getElementById('apgoCollectionVariantModalInner');
  if (!shell || !modal || !overlay || !inner) return;

  inner.innerHTML = buildModalMarkup(data, initialVariantId);
  shell.classList.add('active');
  shell.setAttribute('aria-hidden', 'false');
  document.body.classList.add('apgo-collection-variant-open');

  /*
    鎖住背景捲動。iOS Safari 對 body{overflow:hidden} 不生效，需要 position:fixed
    並把目前 scrollY 寫入 body.style.top；關閉時還原 scroll 位置。
  */
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS) {
    state._lockedScrollY = window.scrollY;
    document.body.style.top = `-${state._lockedScrollY}px`;
    document.body.classList.add('apgo-collection-variant-ios-lock');
  }

  requestAnimationFrame(() => {
    overlay.classList.add('active');
    modal.classList.add('active');
  });

  const addBtn = document.getElementById('apgoCollAddBtn');
  const buyBtn = document.getElementById('apgoCollBuyBtn');
  addBtn?.addEventListener('click', () => addToCart(shell));
  buyBtn?.addEventListener('click', () => buyNow(shell));

  updatePriceDisplay(shell);
  updateModalButtonState();
}

function closeDrawer() {
  const shell = getShell();
  const modal = document.getElementById('apgoCollectionVariantModal');
  const overlay = document.getElementById('apgoCollectionModalOverlay');
  if (!shell || !modal || !overlay) return;

  modal.classList.remove('active');
  overlay.classList.remove('active');
  shell.classList.remove('active');
  shell.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('apgo-collection-variant-open');

  /* 還原 iOS scroll 鎖（記得在移除 position:fixed 之後 scrollTo 還原 Y）。
     base.css 對 <html> 設了 scroll-behavior: smooth，全域 scrollTo 會被瀏覽器
     用 ~0.5s 動畫滑回去——關閉彈窗的場景需要瞬間定位，因此暫時改成 'auto'
     做一次跳轉，再還原使用者原本的捲動模式。 */
  if (document.body.classList.contains('apgo-collection-variant-ios-lock')) {
    document.body.classList.remove('apgo-collection-variant-ios-lock');
    document.body.style.top = '';
    const restoreY = state._lockedScrollY || 0;
    state._lockedScrollY = null;

    const htmlEl = document.documentElement;
    const prevBehavior = htmlEl.style.scrollBehavior;
    htmlEl.style.scrollBehavior = 'auto';
    requestAnimationFrame(() => {
      window.scrollTo({ top: restoreY, left: 0, behavior: 'instant' });
      htmlEl.style.scrollBehavior = prevBehavior;
    });
  }

  window.setTimeout(() => {
    const inner = document.getElementById('apgoCollectionVariantModalInner');
    if (inner) inner.innerHTML = '';
  }, 350);

  state.product = null;
  state.currentVariantId = null;
  state.currentPriceCents = 0;
  state.currentQuantity = 1;
}

async function addToCart(shell) {
  const btn = document.getElementById('apgoCollAddBtn');
  if (!btn || btn.disabled || state.currentVariantId == null) return;

  const original = btn.innerHTML;
  btn.innerHTML = `<span class="apgo-loading-spinner"></span> ${escapeHtml(strFromShell(shell, 'i18nAdding'))}`;
  btn.disabled = true;

  try {
    const res = await fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: state.currentVariantId, quantity: state.currentQuantity }),
    });
    if (!res.ok) throw new Error('add failed');
    await res.json();

    const cartRes = await fetch('/cart.js');
    const cart = await cartRes.json();

    updateAllCartCounts(cart.item_count);

    const shellEl = getShell();
    shellEl?.dispatchEvent(
      new CartAddEvent({}, String(state.currentVariantId), {
        didError: false,
        source: 'apgo-collection-variant-drawer',
        itemCount: cart.item_count,
        productId: state.product ? String(state.product.product_id) : undefined,
      })
    );

    const name = state.product?.title || '';
    showSuccessNotification(name, strFromShell(shell, 'i18nAddedToast'), strFromShell(shell, 'i18nViewCart'));

    /* GWP: trigger gift reconciler so any auto-add gifts come along.
       Fire-and-forget here is OK since we're not navigating away —
       the global reconciler also listens to cart:update so it would
       run anyway; explicit call ensures it runs immediately rather
       than waiting for the next event tick. */
    if (typeof window.apgoReconcileFreeGifts === 'function') {
      try { window.apgoReconcileFreeGifts(); } catch (_) {}
    }

    window.setTimeout(() => {
      btn.innerHTML = original;
      btn.disabled = false;
      closeDrawer();
    }, 600);
  } catch {
    btn.innerHTML = original;
    btn.disabled = false;
    window.alert(strFromShell(shell, 'i18nAtcErr'));
  }
}

async function buyNow(shell) {
  const btn = document.getElementById('apgoCollBuyBtn');
  if (!btn || btn.disabled || state.currentVariantId == null) return;

  const original = btn.innerHTML;
  btn.innerHTML = `<span class="apgo-loading-spinner"></span> ${escapeHtml(strFromShell(shell, 'i18nProcessing'))}`;
  btn.disabled = true;

  try {
    await fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: state.currentVariantId, quantity: state.currentQuantity }),
    });
    /* GWP: let the global reconciler add any free gifts BEFORE we navigate
       away. Without this await the /cart redirect happens before the gift
       POST settles, so the customer lands in checkout without Y. */
    if (typeof window.apgoReconcileFreeGifts === 'function') {
      try { await window.apgoReconcileFreeGifts(); } catch (_) {}
    }
    window.location.href = '/cart';
  } catch {
    btn.innerHTML = original;
    btn.disabled = false;
    window.alert(strFromShell(shell, 'i18nAtcErr'));
  }
}

function bindShellDelegation() {
  const shell = getShell();
  if (!shell || shell.dataset.apgoCollDeleg === '1') return;
  shell.dataset.apgoCollDeleg = '1';

  shell.addEventListener('keydown', (e) => {
    if (!shell.classList.contains('active')) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const opt = /** @type {HTMLElement | null} */ (e.target instanceof HTMLElement ? e.target.closest('[data-apgo-coll-opt]') : null);
    if (opt && state.product) {
      e.preventDefault();
      selectVariantElement(opt, state.product);
    }
  });

  shell.addEventListener('click', (e) => {
    if (!shell.classList.contains('active')) return;
    const t = /** @type {HTMLElement} */ (e.target);

    const opt = t.closest('[data-apgo-coll-opt]');
    if (opt && state.product) {
      selectVariantElement(opt, state.product);
      return;
    }

    const dq = t.closest('[data-apgo-qty]');
    if (dq) {
      const ch = Number(dq.getAttribute('data-apgo-qty'));
      const nq = state.currentQuantity + ch;
      if (nq >= 1 && nq <= 10) {
        state.currentQuantity = nq;
        const qel = document.getElementById('apgoCollQtyValue');
        if (qel) qel.textContent = String(nq);
        updatePriceDisplay(shell);
        if (navigator.vibrate) navigator.vibrate(20);
      }
    }
  });
}

bindShellDelegation();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && getShell()?.classList.contains('active')) {
    closeDrawer();
  }
});

document.addEventListener('click', (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  const openBtn = t.closest('[data-apgo-collection-drawer-open]');
  if (openBtn) {
    const pack = openBtn.closest('.apgo-coll-drawer-pack');
    const jsonEl = pack?.querySelector('script.apgo-coll-drawer-json');
    if (!jsonEl?.textContent) return;
    let data;
    try {
      data = /** @type {ApgoCollProduct} */ (JSON.parse(jsonEl.textContent));
    } catch {
      return;
    }
    const vid = Number(openBtn.getAttribute('data-initial-variant-id') || '0');
    openDrawer(data, vid);
    return;
  }

  if (t.closest('[data-apgo-collection-drawer-close]')) {
    closeDrawer();
  }
});
