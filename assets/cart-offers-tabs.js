/**
 * Cart add-on offers.
 *
 * The tab bar only exists when there is something to switch between.
 * Eligibility already hides a group whose trigger product is absent, so
 * most carts qualify for exactly one group — and a tab bar with one tab
 * is pure chrome. One eligible group renders bare; two or more bring the
 * tabs back.
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
    this.isTabbed = this.classList.contains('is-tabbed');
    this.activeGroupId = '';
    this.eligibleGroupIds = new Set();

    this.handleClick = this.handleClick.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handleCartEvent = this.handleCartEvent.bind(this);
    this.handleResize = this.handleResize.bind(this);
  }

  connectedCallback() {
    this.addEventListener('click', this.handleClick);
    this.addEventListener('keydown', this.handleKeydown);
    document.addEventListener('cart:update', this.handleCartEvent);
    document.addEventListener('cart:updated', this.handleCartEvent);
    document.addEventListener('cart:refresh', this.handleCartEvent);
    window.addEventListener('resize', this.handleResize, { passive: true });

    this.querySelectorAll('[data-carousel-track]').forEach((track) => {
      track.addEventListener('scroll', () => this.updateCarouselButtons(track), { passive: true });
    });

    /* Seed from what the server rendered so a tab clicked before the
       first cart fetch lands still switches. */
    this.eligibleGroupIds = new Set(this.visibleTabs.map((tab) => tab.dataset.groupId));
    const initialGroup = this.groups.find((group) => !group.hidden);
    if (initialGroup) this.activateGroup(initialGroup.dataset.groupId);

    requestAnimationFrame(() => this.handleResize());
    this.fetchCart(0);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('keydown', this.handleKeydown);
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

  get tabs() {
    return Array.from(this.querySelectorAll('[data-offer-tab]'));
  }

  get visibleTabs() {
    return this.tabs.filter((tab) => !tab.hidden);
  }

  get isDesignMode() {
    return this.dataset.designMode === 'true';
  }

  handleClick(event) {
    const tab = event.target.closest('[data-offer-tab]');
    if (tab && this.contains(tab)) {
      this.activateGroup(tab.dataset.groupId);
      return;
    }

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

  handleKeydown(event) {
    const currentTab = event.target.closest('[data-offer-tab]');
    if (!currentTab || !this.contains(currentTab)) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

    const tabs = this.visibleTabs;
    if (tabs.length < 2) return;
    event.preventDefault();

    const currentIndex = Math.max(0, tabs.indexOf(currentTab));
    let nextIndex = currentIndex;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;

    this.activateGroup(tabs[nextIndex].dataset.groupId, { focus: true });
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

    const eligibleGroups = this.groups.filter((group) => this.isDesignMode || this.groupIsEligible(group, quantities));
    this.eligibleGroupIds = new Set(eligibleGroups.map((group) => group.dataset.groupId));

    this.hidden = eligibleGroups.length === 0;
    if (!eligibleGroups.length) return;

    /* Tabs only earn their place from the second eligible group onward. */
    this.isTabbed = eligibleGroups.length > 1;
    this.classList.toggle('is-tabbed', this.isTabbed);

    const tablist = this.querySelector('[data-offer-tablist]');
    if (tablist) tablist.hidden = !this.isTabbed;
    this.tabs.forEach((tab) => {
      tab.hidden = !this.eligibleGroupIds.has(tab.dataset.groupId);
    });

    /* Keep whatever the shopper picked, as long as it still qualifies. */
    const stillActive = eligibleGroups.some((group) => group.dataset.groupId === this.activeGroupId);
    this.activateGroup(stillActive ? this.activeGroupId : eligibleGroups[0].dataset.groupId);

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

  activateGroup(groupId, { focus = false } = {}) {
    if (!this.eligibleGroupIds.has(groupId)) return;
    this.activeGroupId = groupId;

    this.groups.forEach((group) => {
      const eligible = this.eligibleGroupIds.has(group.dataset.groupId);
      /* Untabbed, every eligible group stays on screen; tabbed, only the
         active one does. */
      group.hidden = !eligible || (this.isTabbed && group.dataset.groupId !== groupId);
      group.setAttribute('role', this.isTabbed ? 'tabpanel' : 'region');
    });

    this.tabs.forEach((tab) => {
      const isActive = tab.dataset.groupId === groupId;
      tab.setAttribute('aria-selected', String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
      if (isActive && focus) tab.focus({ preventScroll: true });
    });

    const track = this.groups
      .find((group) => group.dataset.groupId === groupId)
      ?.querySelector('[data-carousel-track]');
    if (track) requestAnimationFrame(() => this.updateCarouselButtons(track));
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
