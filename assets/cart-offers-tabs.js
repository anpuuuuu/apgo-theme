/**
 * Cart add-on offers.
 *
 * Groups are stacked, not tabbed: eligibility already hides a group whose
 * trigger product is absent, so most carts show exactly one — and a tab
 * bar with one tab is pure chrome. When two do qualify, stacking shows
 * every add-on rather than hiding half behind a click.
 *
 * The element name is historical; the section, stylesheet and saved
 * merchant blocks all still key off "tabs".
 */
class CartOffersTabs extends HTMLElement {
  constructor() {
    super();
    this.cart = null;
    this.fetchTimer = null;
    this.fetchController = null;
    this.isAdding = false;

    this.handleClick = this.handleClick.bind(this);
    this.handleCartEvent = this.handleCartEvent.bind(this);
    this.handleResize = this.handleResize.bind(this);
  }

  connectedCallback() {
    this.addEventListener('click', this.handleClick);
    document.addEventListener('cart:update', this.handleCartEvent);
    document.addEventListener('cart:updated', this.handleCartEvent);
    document.addEventListener('cart:refresh', this.handleCartEvent);
    window.addEventListener('resize', this.handleResize, { passive: true });

    this.querySelectorAll('[data-carousel-track]').forEach((track) => {
      track.addEventListener('scroll', () => this.updateCarouselButtons(track), { passive: true });
    });

    requestAnimationFrame(() => this.handleResize());
    this.fetchCart(0);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.handleClick);
    document.removeEventListener('cart:update', this.handleCartEvent);
    document.removeEventListener('cart:updated', this.handleCartEvent);
    document.removeEventListener('cart:refresh', this.handleCartEvent);
    window.removeEventListener('resize', this.handleResize);
    window.clearTimeout(this.fetchTimer);
    this.fetchController?.abort();
  }

  get groups() {
    return Array.from(this.querySelectorAll('[data-offer-group]'));
  }

  get isDesignMode() {
    return this.dataset.designMode === 'true';
  }

  handleClick(event) {
    const addButton = event.target.closest('[data-offer-add]');
    if (addButton && this.contains(addButton)) {
      this.addOffer(addButton);
      return;
    }

    const previousButton = event.target.closest('[data-carousel-prev]');
    const nextButton = event.target.closest('[data-carousel-next]');
    const scrollButton = previousButton || nextButton;
    if (!scrollButton || !this.contains(scrollButton)) return;

    const track = scrollButton.parentElement?.querySelector('[data-carousel-track]');
    if (!track) return;
    const firstCard = track.querySelector('[data-offer-card]');
    const gap = Number.parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 0;
    const distance = firstCard ? firstCard.getBoundingClientRect().width + gap : track.clientWidth * 0.8;
    track.scrollBy({ left: previousButton ? -distance : distance, behavior: 'smooth' });
  }

  handleCartEvent(event) {
    if (event.target === this) return;
    const detail = event.detail || {};
    const cart = detail.resource || detail.cart || detail.data?.cart || (Array.isArray(detail.items) ? detail : null);
    if (cart && Array.isArray(cart.items)) {
      this.syncCart(cart);
      return;
    }
    this.fetchCart(120);
  }

  handleResize() {
    this.querySelectorAll('[data-carousel-track]').forEach((track) => this.updateCarouselButtons(track));
  }

  fetchCart(delay = 120) {
    window.clearTimeout(this.fetchTimer);
    this.fetchTimer = window.setTimeout(async () => {
      this.fetchController?.abort();
      this.fetchController = new AbortController();
      try {
        const root = window.Shopify?.routes?.root || '/';
        const response = await fetch(`${root}cart.js`, {
          headers: { Accept: 'application/json' },
          signal: this.fetchController.signal,
        });
        if (!response.ok) throw new Error('Unable to read the cart.');
        this.syncCart(await response.json());
      } catch (error) {
        if (error?.name !== 'AbortError') this.showStatus(error?.message || 'Unable to update offers.');
      }
    }, delay);
  }

  syncCart(cart) {
    if (!cart || !Array.isArray(cart.items)) return;
    this.cart = cart;
    const quantities = new Map();

    cart.items.forEach((item) => {
      const productId = String(item.product_id || item.product?.id || '');
      if (!productId) return;
      quantities.set(productId, (quantities.get(productId) || 0) + Number(item.quantity || 0));
    });

    let visibleGroups = 0;
    this.groups.forEach((group) => {
      const eligible = this.isDesignMode || this.groupIsEligible(group, quantities);
      group.hidden = !eligible;
      if (eligible) visibleGroups += 1;
    });

    this.hidden = visibleGroups === 0;
    if (!visibleGroups) return;

    this.querySelectorAll('[data-offer-card]').forEach((card) => {
      const productQuantity = quantities.get(String(card.dataset.productId)) || 0;
      const maximum = Number(card.dataset.maxQuantity || 0);
      const button = card.querySelector('[data-offer-add]');
      if (!button) return;

      const reachedLimit = maximum > 0 && productQuantity >= maximum;
      button.disabled = reachedLimit;
      button.classList.toggle('is-added', reachedLimit);
      button.classList.remove('is-loading');
      button.textContent = reachedLimit ? button.dataset.addedLabel : button.dataset.defaultLabel;
    });

    this.showStatus('');
    requestAnimationFrame(() => this.handleResize());
  }

  groupIsEligible(group, quantities) {
    if (group.dataset.audience === 'all') return true;
    const triggerIds = (group.dataset.triggerProductIds || '').split(',').map((id) => id.trim()).filter(Boolean);
    if (!triggerIds.length) return false;
    const minimum = Math.max(1, Number(group.dataset.triggerMin || 1));
    const total = triggerIds.reduce((sum, productId) => sum + (quantities.get(productId) || 0), 0);
    return total >= minimum;
  }

  updateCarouselButtons(track) {
    const carousel = track.closest('.cart-offers-tabs__carousel');
    const previousButton = carousel?.querySelector('[data-carousel-prev]');
    const nextButton = carousel?.querySelector('[data-carousel-next]');
    if (!previousButton || !nextButton) return;

    const maximumScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const hasOverflow = maximumScroll > 2;
    previousButton.hidden = !hasOverflow;
    nextButton.hidden = !hasOverflow;
    previousButton.disabled = !hasOverflow || track.scrollLeft <= 2;
    nextButton.disabled = !hasOverflow || track.scrollLeft >= maximumScroll - 2;
  }

  async addOffer(button) {
    if (this.isAdding || button.disabled) return;
    const variantId = Number(button.dataset.variantId || 0);
    if (!variantId) return;

    this.isAdding = true;
    button.disabled = true;
    button.classList.add('is-loading');
    button.textContent = '…';
    this.showStatus('');

    const sectionIds = new Set([this.dataset.sectionId]);
    document.querySelectorAll('cart-items-component[data-section-id]').forEach((component) => {
      if (component.dataset.sectionId) sectionIds.add(component.dataset.sectionId);
    });

    try {
      const root = window.Shopify?.routes?.root || '/';
      const addResponse = await fetch(`${root}cart/add.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          items: [{ id: variantId, quantity: 1 }],
          sections: Array.from(sectionIds).slice(0, 5),
          sections_url: window.location.pathname,
        }),
      });
      const addResult = await addResponse.json();
      if (!addResponse.ok || addResult.status) {
        throw new Error(addResult.description || addResult.message || 'Unable to add this product.');
      }

      const cartResponse = await fetch(`${root}cart.js`, { headers: { Accept: 'application/json' } });
      if (!cartResponse.ok) throw new Error('Product was added, but the cart could not be refreshed.');
      const cart = await cartResponse.json();
      this.syncCart(cart);

      this.dispatchEvent(new CustomEvent('cart:update', {
        bubbles: true,
        detail: {
          resource: cart,
          sourceId: this.dataset.sectionId,
          data: {
            itemCount: Number(cart.item_count) || 0,
            source: 'cart-offers-tabs',
            sections: addResult.sections || {},
          },
        },
      }));
    } catch (error) {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.textContent = button.dataset.defaultLabel;
      this.showStatus(error?.message || 'Unable to add this product. Please try again.');
    } finally {
      this.isAdding = false;
    }
  }

  showStatus(message) {
    const status = this.querySelector('[data-offer-status]');
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
  }
}

if (!customElements.get('cart-offers-tabs')) {
  customElements.define('cart-offers-tabs', CartOffersTabs);
}
