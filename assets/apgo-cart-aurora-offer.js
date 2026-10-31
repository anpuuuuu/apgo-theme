(() => {
  const element = document.getElementById('apgo-aurora-config');
  if (!element || window.apgoAuroraOffer) return;
  const config = JSON.parse(element.textContent);

  class AuroraOfferController {
    constructor() {
      this.cart = null;
      this.queue = Promise.resolve();
      this.status = '';
      this.deadline = 0;
      this.storageKey = '';
      ['cart:update', 'cart:updated', 'cart:refresh', 'cart:added'].forEach(name => {
        document.addEventListener(name, event => {
          if (event.detail?.data?.source !== 'apgo-aurora-offer') this.schedule();
        });
      });
      window.addEventListener('pageshow', () => this.schedule());
      window.addEventListener('focus', () => this.schedule());
      window.addEventListener('storage', event => {
        if (event.key?.startsWith('apgo:aurora-pwp:')) this.schedule();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.schedule();
      });
      document.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        if (target.closest('button[name="checkout"], a[href="/checkout"]') && this.isBusy()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (this.marked(this.cart).length && target.closest('.cart-items__remove, [data-cart-bulk-action], quantity-selector-component button')) this.waitForCartEdit();
      }, true);
      document.addEventListener('change', event => {
        if (this.marked(this.cart).length && event.target instanceof Element && event.target.closest('quantity-selector-component')) this.waitForCartEdit();
      }, true);
      document.addEventListener('submit', event => {
        if (event.submitter?.name === 'checkout' && this.isBusy()) event.preventDefault();
      }, true);
      this.schedule();
    }

    isBusy() { return this.busy || this.writing || this.editing || this.cleanupFailed; }
    items(cart) { return Array.isArray(cart?.items) ? cart.items : []; }

    eligible(cart) {
      return config.country === 'MY' && cart?.currency === 'MYR' && this.items(cart).some(item => Number(item.variant_id) === config.triggerVariant && item.quantity > 0);
    }

    marked(cart) {
      return this.items(cart).filter(item => Number(item.variant_id) === config.offerVariant && item.properties?.[config.property] === config.propertyValue);
    }

    offerQuantity(cart) {
      return this.items(cart).reduce((sum, item) => sum + (Number(item.variant_id) === config.offerVariant ? Number(item.quantity) || 0 : 0), 0);
    }

    enqueue(operation) {
      const task = this.queue.catch(() => {}).then(() => navigator.locks?.request
        ? navigator.locks.request('apgo-aurora-pwp', operation)
        : operation());
      this.queue = task.catch(() => {});
      return task;
    }

    async request(path, body) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch((window.Shopify?.routes?.root || '/') + path, {
          method: body ? 'POST' : 'GET',
          headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
          cache: 'no-store', signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok || data.errors || data.status >= 400) throw new Error(data.description || data.message || config.messages.error);
        return data;
      } catch (error) {
        if (error instanceof TypeError || error instanceof SyntaxError || error.name === 'AbortError') throw new Error(config.messages.error);
        throw error;
      } finally {
        window.clearTimeout(timeout);
      }
    }

    sectionParameters() {
      const sections = [...new Set([...document.querySelectorAll('cart-items-component[data-section-id]')].map(node => node.dataset.sectionId))].slice(0, 5);
      return sections.length ? { sections, sections_url: window.location.pathname } : {};
    }

    async reconcile(cart) {
      const marked = this.marked(cart);
      const normalQuantity = this.offerQuantity(cart) - marked.reduce((sum, item) => sum + item.quantity, 0);
      let remaining = this.eligible(cart) ? Math.max(0, 1 - normalQuantity) : 0;
      const updates = {};
      marked.forEach(item => {
        const keep = Math.min(item.quantity, remaining);
        remaining -= keep;
        if (keep !== item.quantity) updates[item.key] = keep;
      });
      if (!Object.keys(updates).length) {
        this.cleanupFailed = false;
        return { cart, changed: false };
      }
      this.accept(cart);
      this.writing = true;
      this.render();
      try {
        const updated = await this.request('cart/update.js', { updates, ...this.sectionParameters() });
        this.cleanupFailed = false;
        return { cart: updated, sections: updated.sections, changed: true };
      } catch (error) {
        this.cleanupFailed = true;
        const toast = window.apgoCartToastEnsure?.();
        if (toast) {
          toast.textContent = config.messages.error;
          toast.setAttribute('role', 'alert');
          toast.setAttribute('data-visible', '');
          window.setTimeout(() => toast.removeAttribute('data-visible'), 5200);
        }
        throw error;
      } finally {
        this.writing = false;
        this.render();
      }
    }

    accept(cart) {
      this.cart = cart;
      if (cart?.token) {
        const key = 'apgo:aurora-pwp:v1:' + cart.token;
        let saved = this.storageKey === key ? this.timerState : null;
        this.storageKey = key;
        try { saved = JSON.parse(localStorage.getItem(this.storageKey)); } catch {}
        const active = this.eligible(cart);
        const deadline = active ? (saved?.active && Number.isFinite(saved.deadline) && saved.deadline > 0 ? saved.deadline : Date.now() + config.duration) : 0;
        this.deadline = deadline;
        this.timerState = { active, deadline };
        if (saved?.active !== active || saved?.deadline !== deadline) {
          try { localStorage.setItem(this.storageKey, JSON.stringify({ active, deadline })); } catch {}
        }
      } else if (!this.eligible(cart)) this.deadline = 0;
      else if (!this.deadline) this.deadline = Date.now() + config.duration;
      this.render();
    }

    publish(cart, sections) {
      this.accept(cart);
      document.dispatchEvent(new CustomEvent('cart:update', {
        bubbles: true,
        detail: { resource: cart, sourceId: 'apgo-aurora-offer', data: { itemCount: Number(cart.item_count) || 0, source: 'apgo-aurora-offer', sections: sections || {} } },
      }));
      try { localStorage.setItem('apgo:aurora-pwp:sync', String(Date.now())); } catch {}
    }

    schedule() {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => this.refresh(), 120);
    }

    refresh() {
      if (this.refreshPending) { this.refreshAgain = true; return this.queue; }
      this.refreshPending = true;
      return this.enqueue(async () => {
        const result = await this.reconcile(await this.request('cart.js?_=' + Date.now()));
        this.accept(result.cart);
        if (result.changed) this.publish(result.cart, result.sections);
      }).catch(() => {
        if (document.querySelector('apgo-aurora-offer')) this.status = config.messages.error;
      }).finally(() => {
        this.refreshPending = false;
        this.render();
        if (this.refreshAgain) { this.refreshAgain = false; this.schedule(); }
      });
    }

    waitForCartEdit() {
      this.editing = true;
      this.render();
      window.clearTimeout(this.editTimer);
      this.editTimer = window.setTimeout(async () => {
        const started = Date.now();
        while (document.querySelector('cart-items-component.cart-items-disabled, cart-items-component[aria-busy="true"]') && Date.now() - started < 12000) {
          await new Promise(resolve => window.setTimeout(resolve, 80));
        }
        try { await this.refresh(); } finally { this.editing = false; this.render(); }
      }, 450);
    }

    async add() {
      if (this.isBusy()) return;
      this.busy = true;
      this.status = '';
      this.render();
      try {
        await this.enqueue(async () => {
          const initial = await this.reconcile(await this.request('cart.js?_=' + Date.now()));
          this.accept(initial.cart);
          if (initial.changed) this.publish(initial.cart, initial.sections);
          if (!this.eligible(initial.cart)) throw new Error(config.messages.error);
          if (this.offerQuantity(initial.cart) > 0) { this.status = config.messages.limit; return; }
          let added;
          try {
            added = await this.request('cart/add.js', { items: [{ id: config.offerVariant, quantity: 1, properties: { [config.property]: config.propertyValue } }], ...this.sectionParameters() });
          } catch (error) {
            const recovered = await this.request('cart.js?_=' + Date.now());
            if (!this.marked(recovered).length) throw error;
            added = {};
          }
          const result = await this.reconcile(await this.request('cart.js?_=' + Date.now()));
          this.publish(result.cart, result.sections || added.sections);
        });
      } catch (error) {
        this.status = error.message || config.messages.error;
      } finally {
        this.busy = false;
        this.render();
      }
    }

    render() {
      document.querySelectorAll('apgo-aurora-offer').forEach(card => card.update(this));
      document.querySelectorAll('button[name="checkout"]').forEach(button => {
        if (this.isBusy() && !button.hasAttribute('data-aurora-lock')) {
          button.setAttribute('data-aurora-lock', button.disabled ? '1' : '0');
          button.disabled = true;
        } else if (!this.isBusy() && button.hasAttribute('data-aurora-lock')) {
          button.disabled = button.getAttribute('data-aurora-lock') === '1';
          button.removeAttribute('data-aurora-lock');
        }
      });
    }
  }

  class ApgoAuroraOffer extends HTMLElement {
    connectedCallback() {
      this.onclick = event => { if (event.target.closest('.aurora-offer__button')) window.apgoAuroraOffer?.add(); };
      window.apgoAuroraOffer?.render();
      window.clearInterval(this.timer);
      this.timer = window.setInterval(() => this.updateTimer(), 1000);
      this.updateTimer();
    }

    disconnectedCallback() { window.clearInterval(this.timer); }

    update(controller) {
      this.hidden = controller.cart ? !controller.eligible(controller.cart) : false;
      const added = controller.offerQuantity(controller.cart) > 0;
      const unavailable = this.dataset.available !== 'true';
      this.dataset.state = added ? 'added' : controller.busy ? 'loading' : 'available';
      const button = this.querySelector('.aurora-offer__button');
      button.disabled = Boolean(controller.isBusy() || added || unavailable);
      button.setAttribute('aria-busy', String(Boolean(controller.busy)));
      const label = this.querySelector('[data-offer-button-label]');
      if (!this.addLabel) this.addLabel = label.textContent;
      label.textContent = controller.busy ? config.messages.adding : added ? config.messages.added : unavailable ? config.messages.soldOut : this.addLabel;
      this.querySelector('[data-offer-button-icon]').textContent = controller.busy ? '…' : added ? '✓' : '＋';
      const status = this.querySelector('[data-offer-status]');
      status.textContent = controller.status;
      status.hidden = !controller.status;
      this.updateTimer();
    }

    updateTimer() {
      const deadline = window.apgoAuroraOffer?.deadline;
      const remaining = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 600;
      this.querySelector('[data-offer-minutes]').textContent = String(Math.floor(remaining / 60)).padStart(2, '0');
      this.querySelector('[data-offer-seconds]').textContent = String(remaining % 60).padStart(2, '0');
      this.toggleAttribute('data-expired', remaining === 0);
    }
  }

  if (!customElements.get('apgo-aurora-offer')) customElements.define('apgo-aurora-offer', ApgoAuroraOffer);
  window.apgoAuroraOffer = new AuroraOfferController();
})();
