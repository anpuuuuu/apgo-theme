import { Component } from '@theme/component';
import { fetchConfig, debounce, onAnimationEnd, prefersReducedMotion, resetShimmer } from '@theme/utilities';
import { morphSection, sectionRenderer } from '@theme/section-renderer';
import {
  ThemeEvents,
  CartUpdateEvent,
  QuantitySelectorUpdateEvent,
  CartAddEvent,
  DiscountUpdateEvent,
} from '@theme/events';
import { cartPerformance } from '@theme/performance';

/** @typedef {import('./utilities').TextComponent} TextComponent */

/**
 * A custom element that displays a cart items component.
 *
 * @typedef {object} Refs
 * @property {HTMLElement[]} quantitySelectors - The quantity selector elements.
 * @property {HTMLTableRowElement[]} cartItemRows - The cart item rows.
 * @property {TextComponent} cartTotal - The cart total.
 *
 * @extends {Component<Refs>}
 */
class CartItemsComponent extends Component {
  #debouncedOnChange = debounce(this.#onQuantityChange, 300).bind(this);

  /*
   * Per-line update queue. Allows optimistic UI (user can click +/-
   * multiple times and the DOM qty updates immediately) but only ONE
   * /cart/change.js in flight per line at a time. If a newer target
   * quantity arrives while a request is in flight, we stash it in
   * `pending` and flush ONCE MORE on completion — so the final server
   * quantity always matches the last click ("last-wins").
   *
   * Key: line number (1-indexed, as Shopify's Ajax API expects).
   * Value: { pending: number|null, pendingAction: string|null, inflight: boolean }
   */
  #lineState = new Map();

  connectedCallback() {
    super.connectedCallback();

    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.addEventListener(ThemeEvents.discountUpdate, this.handleDiscountUpdate);
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#debouncedOnChange);
    this.addEventListener('change', this.#handleBulkSelection);
    this.addEventListener('click', this.#handleBulkAction);
    this.#syncBulkControls();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.removeEventListener(ThemeEvents.discountUpdate, this.handleDiscountUpdate);
    document.removeEventListener(ThemeEvents.quantitySelectorUpdate, this.#debouncedOnChange);
    this.removeEventListener('change', this.#handleBulkSelection);
    this.removeEventListener('click', this.#handleBulkAction);
  }

  /**
   * Keeps row state and bulk-action controls in sync with a real user
   * checkbox change. Deliberately event-driven: observing DOM mutations here
   * can create a self-triggering loop when count text is updated.
   * @param {Event} event
   */
  #handleBulkSelection = (event) => {
    const checkbox = event.target instanceof Element ? event.target.closest('[data-cart-item-select]') : null;
    if (!(checkbox instanceof HTMLInputElement) || !this.contains(checkbox)) return;

    const row = checkbox.closest('.cart-items__table-row');
    if (row?.hasAttribute('data-apgo-gift-line') || checkbox.disabled) {
      checkbox.checked = false;
      row?.setAttribute('aria-selected', 'false');
    } else {
      row?.setAttribute('aria-selected', checkbox.checked ? 'true' : 'false');
    }

    this.#syncBulkControls();
  };

  /**
   * Handles Remove selected and Clear cart without inline handlers.
   * @param {Event} event
   */
  #handleBulkAction = (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-cart-bulk-action]') : null;
    if (!(button instanceof HTMLButtonElement) || !this.contains(button) || button.disabled) return;

    const action = button.dataset.cartBulkAction;
    const removableRows = this.#getRemovableRows();
    const rows =
      action === 'remove-selected'
        ? removableRows.filter((row) => {
            const checkbox = row.querySelector('[data-cart-item-select]');
            return checkbox instanceof HTMLInputElement && checkbox.checked;
          })
        : action === 'clear'
          ? removableRows
          : [];

    if (!rows.length) return;

    const message =
      action === 'clear'
        ? 'Remove all regular items from your cart? Free gifts will be adjusted automatically.'
        : `Remove ${rows.length} selected ${rows.length === 1 ? 'item' : 'items'} from your cart?`;

    if (!window.confirm(message)) return;
    void this.#removeCartRows(rows, action);
  };

  /** @returns {HTMLTableRowElement[]} */
  #getRemovableRows() {
    return Array.from(
      this.querySelectorAll('.cart-items__table-row[data-line-key]:not([data-apgo-gift-line])')
    ).filter((row) => {
      const checkbox = row.querySelector('[data-cart-item-select]');
      return row instanceof HTMLTableRowElement && checkbox instanceof HTMLInputElement && !checkbox.disabled;
    });
  }

  #syncBulkControls = () => {
    const removableRows = this.#getRemovableRows();
    const selectedCount = removableRows.filter((row) => {
      const checkbox = row.querySelector('[data-cart-item-select]');
      return checkbox instanceof HTMLInputElement && checkbox.checked;
    }).length;
    const removeSelectedButton = this.querySelector('[data-cart-bulk-action="remove-selected"]');
    const clearButton = this.querySelector('[data-cart-bulk-action="clear"]');
    const count = this.querySelector('[data-cart-selected-count]');

    if (removeSelectedButton instanceof HTMLButtonElement) {
      const shouldDisable = selectedCount === 0;
      if (removeSelectedButton.disabled !== shouldDisable) removeSelectedButton.disabled = shouldDisable;
    }
    if (clearButton instanceof HTMLButtonElement) {
      const shouldDisable = removableRows.length === 0;
      if (clearButton.disabled !== shouldDisable) clearButton.disabled = shouldDisable;
    }
    if (count instanceof HTMLElement) {
      const text = selectedCount ? `(${selectedCount})` : '';
      if (count.textContent !== text) count.textContent = text;
      const shouldHide = selectedCount === 0;
      if (count.hidden !== shouldHide) count.hidden = shouldHide;
    }
  };

  /** @param {string} message */
  #setBulkStatus(message) {
    const status = this.querySelector('[data-cart-bulk-status]');
    if (status instanceof HTMLElement && status.textContent !== message) status.textContent = message;
  }

  /**
   * Removes line-item keys in one Shopify Cart API request. Gift rows are
   * excluded before this method is called and are reconciled by the gift app.
   * @param {HTMLTableRowElement[]} rows
   * @param {string} action
   */
  async #removeCartRows(rows, action) {
    const updates = {};
    rows.forEach((row) => {
      const key = row.dataset.lineKey;
      if (key) updates[key] = 0;
    });
    if (!Object.keys(updates).length) return;

    const marker = cartPerformance.createStartingMarker(`bulk-${action}:user-action`);
    const sectionsToUpdate = new Set([this.sectionId]);
    document.querySelectorAll('cart-items-component[data-section-id]').forEach((item) => {
      if (item instanceof HTMLElement && item.dataset.sectionId) sectionsToUpdate.add(item.dataset.sectionId);
    });

    this.#disableCartItems();
    this.setAttribute('aria-busy', 'true');
    this.#setBulkStatus(action === 'clear' ? 'Clearing cart…' : 'Removing selected items…');

    try {
      const body = JSON.stringify({
        updates,
        sections: Array.from(sectionsToUpdate).join(','),
        sections_url: window.location.pathname,
      });
      const response = await fetch(Theme.routes.cart_update_url, fetchConfig('json', { body }));
      const parsedResponse = await response.json();

      if (!response.ok || parsedResponse.errors) {
        throw new Error(parsedResponse.errors || parsedResponse.description || 'Unable to update the cart.');
      }

      const sectionHTML = parsedResponse.sections?.[this.sectionId];
      if (!sectionHTML) throw new Error('Cart section response is missing.');

      resetShimmer(this);
      this.dispatchEvent(
        new CartUpdateEvent(parsedResponse, this.sectionId, {
          itemCount: Number(parsedResponse.item_count) || 0,
          source: 'cart-bulk-actions',
          sections: parsedResponse.sections,
        })
      );
      morphSection(this.sectionId, sectionHTML);
    } catch (error) {
      console.error(error);
      this.#setBulkStatus(error instanceof Error ? error.message : 'Unable to update the cart. Please try again.');
    } finally {
      this.#enableCartItems();
      this.removeAttribute('aria-busy');
      this.#syncBulkControls();
      cartPerformance.measureFromMarker(marker);
    }
  }

  /**
   * Handles QuantitySelectorUpdateEvent change event.
   * @param {QuantitySelectorUpdateEvent} event - The event.
   */
  #onQuantityChange(event) {
    const { quantity, cartLine: line } = event.detail;

    if (!line) return;

    /* Cart-page gift lock (belt-and-braces): CSS pointer-events: none
       already blocks the +/- buttons and qty input, but a keyboard
       tab + type or a DOM-tamper can still fire a QuantitySelector
       change event. Refuse to route those into the network layer.
       Server-rendered `data-apgo-gift-line` covers both APGO and
       AIOD gift lines. */
    const guardRow = this.refs.cartItemRows[line - 1];
    if (guardRow?.hasAttribute('data-apgo-gift-line')) return;

    if (quantity === 0) {
      return this.onLineItemRemove(line);
    }

    this.updateQuantity({
      line,
      quantity,
      action: 'change',
    });
    const lineItemRow = this.refs.cartItemRows[line - 1];

    if (!lineItemRow) return;

    const textComponent = /** @type {TextComponent | undefined} */ (lineItemRow.querySelector('text-component'));
    textComponent?.shimmer();
  }

  /**
   * Handles the line item removal.
   * @param {number} line - The line item index.
   */
  onLineItemRemove(line) {
    /* Same gift lock as #onQuantityChange — refuse to delete a locked
       gift line even if something bypassed the CSS `display: none` on
       the trash button. */
    const guardRow = this.refs.cartItemRows[line - 1];
    if (guardRow?.hasAttribute('data-apgo-gift-line')) return;

    this.updateQuantity({
      line,
      quantity: 0,
      action: 'clear',
    });

    const cartItemRowToRemove = this.refs.cartItemRows[line - 1];

    if (!cartItemRowToRemove) return;

    const remove = () => cartItemRowToRemove.remove();

    if (prefersReducedMotion()) return remove();

    // Add class to the row to trigger the animation
    cartItemRowToRemove.style.setProperty('--row-height', `${cartItemRowToRemove.clientHeight}px`);
    cartItemRowToRemove.classList.add('removing');

    // Remove the row after the animation ends
    onAnimationEnd(cartItemRowToRemove, remove);
  }

  /**
   * Updates the quantity.
   * @param {Object} config - The config.
   * @param {number} config.line - The line.
   * @param {number} config.quantity - The quantity.
   * @param {string} config.action - The action.
   */
  updateQuantity(config) {
    const { line, quantity, action } = config;
    if (line == null) return;

    /* Register the target — last write wins. */
    const state = this.#lineState.get(line) || { pending: null, pendingAction: null, inflight: false };
    state.pending = quantity;
    state.pendingAction = action;
    this.#lineState.set(line, state);

    /* If a request for this line is already in flight, the .finally()
       block will pick up the newer pending value and re-flush; nothing
       more to do here. */
    if (state.inflight) return;

    this.#flushLine(line);
  }

  /*
   * Fires the actual /cart/change.js POST for a single line. Reads
   * (and clears) the pending target from #lineState, marks the line
   * as in-flight, and on completion re-fires itself if a newer
   * target has arrived in the meantime.
   */
  #flushLine(line) {
    const state = this.#lineState.get(line);
    if (!state || state.pending == null) return;

    const quantity = state.pending;
    const action = state.pendingAction;
    state.pending = null;
    state.pendingAction = null;
    state.inflight = true;

    const cartPerformaceUpdateMarker = cartPerformance.createStartingMarker(`${action}:user-action`);

    this.#disableCartItems();

    const { cartTotal } = this.refs;

    const cartItemsComponents = document.querySelectorAll('cart-items-component');
    const sectionsToUpdate = new Set([this.sectionId]);
    cartItemsComponents.forEach((item) => {
      if (item instanceof HTMLElement && item.dataset.sectionId) {
        sectionsToUpdate.add(item.dataset.sectionId);
      }
    });

    const body = JSON.stringify({
      line: line,
      quantity: quantity,
      sections: Array.from(sectionsToUpdate).join(','),
      sections_url: window.location.pathname,
    });

    cartTotal?.shimmer();

    fetch(`${Theme.routes.cart_change_url}`, fetchConfig('json', { body }))
      .then((response) => {
        return response.text();
      })
      .then((responseText) => {
        const parsedResponseText = JSON.parse(responseText);

        resetShimmer(this);

        if (parsedResponseText.errors) {
          this.#handleCartError(line, parsedResponseText);
          return;
        }

        const newSectionHTML = new DOMParser().parseFromString(
          parsedResponseText.sections[this.sectionId],
          'text/html'
        );

        // Grab the new cart item count from a hidden element
        const newCartHiddenItemCount = newSectionHTML.querySelector('[ref="cartItemCount"]')?.textContent;
        const newCartItemCount = newCartHiddenItemCount ? parseInt(newCartHiddenItemCount, 10) : 0;

        this.dispatchEvent(
          new CartUpdateEvent({}, this.sectionId, {
            itemCount: newCartItemCount,
            source: 'cart-items-component',
            sections: parsedResponseText.sections,
          })
        );

        morphSection(this.sectionId, parsedResponseText.sections[this.sectionId]);
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        this.#enableCartItems();
        cartPerformance.measureFromMarker(cartPerformaceUpdateMarker);
        state.inflight = false;
        /* If a newer target arrived while this request was in flight,
           flush again with the latest value. */
        if (state.pending != null) this.#flushLine(line);
      });
  }

  /**
   * Handles the discount update.
   * @param {DiscountUpdateEvent} event - The event.
   */
  handleDiscountUpdate = (event) => {
    this.#handleCartUpdate(event);
  };

  /**
   * Handles the cart error.
   * @param {number} line - The line.
   * @param {Object} parsedResponseText - The parsed response text.
   * @param {string} parsedResponseText.errors - The errors.
   */
  #handleCartError = (line, parsedResponseText) => {
    const quantitySelector = this.refs.quantitySelectors[line - 1];
    const quantityInput = quantitySelector?.querySelector('input');

    if (!quantityInput) throw new Error('Quantity input not found');

    quantityInput.value = quantityInput.defaultValue;

    const cartItemError = this.refs[`cartItemError-${line}`];
    const cartItemErrorContainer = this.refs[`cartItemErrorContainer-${line}`];

    if (!(cartItemError instanceof HTMLElement)) throw new Error('Cart item error not found');
    if (!(cartItemErrorContainer instanceof HTMLElement)) throw new Error('Cart item error container not found');

    cartItemError.textContent = parsedResponseText.errors;
    cartItemErrorContainer.classList.remove('hidden');
  };

  /**
   * Handles the cart update.
   *
   * @param {DiscountUpdateEvent | CartUpdateEvent | CartAddEvent} event
   */
  #handleCartUpdate = (event) => {
    if (event instanceof DiscountUpdateEvent) {
      sectionRenderer.renderSection(this.sectionId, { cache: false });
      return;
    }
    if (event.target === this) return;

    const cartItemsHtml = event.detail.data.sections?.[this.sectionId];
    if (cartItemsHtml) {
      morphSection(this.sectionId, cartItemsHtml);
    } else {
      sectionRenderer.renderSection(this.sectionId, { cache: false });
    }
  };

  /**
   * Disables the cart items.
   */
  #disableCartItems() {
    this.classList.add('cart-items-disabled');
  }

  /**
   * Enables the cart items.
   */
  #enableCartItems() {
    this.classList.remove('cart-items-disabled');
  }

  /**
   * Gets the section id.
   * @returns {string} The section id.
   */
  get sectionId() {
    const { sectionId } = this.dataset;

    if (!sectionId) throw new Error('Section id missing');

    return sectionId;
  }
}

if (!customElements.get('cart-items-component')) {
  customElements.define('cart-items-component', CartItemsComponent);
}
