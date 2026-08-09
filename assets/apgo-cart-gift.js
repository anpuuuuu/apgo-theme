/**
 * Cart follow-up for the Glaze promo's customer-choice free gifts.
 *
 * The PDP gift picker adds exactly (bundle qty × per) gift lines tagged
 * properties[_gift_pick]='true'; the AIOD "Glaze FreeGift" discount
 * zeroes up to that many pool items. This script keeps the entitlement
 * in sync when the CART quantity of the bundle changes afterwards:
 *
 *   entitled = (cart qty of trigger products) × per
 *   picked   = total qty across _gift_pick-tagged lines
 *
 *   picked < entitled  → open the picker modal so the customer chooses
 *                        the missing gifts (added with _gift_pick).
 *   picked > entitled  → TRIM the excess gift units automatically —
 *                        AIOD only frees `entitled`; extras would be
 *                        charged at full price.
 *
 * Config from window.APGO_CART_GIFT (layout/theme.liquid):
 *   { triggers: [productId…], per: 2 }
 * Modal markup: snippets/apgo-cart-gift-modal.liquid (global).
 *
 * Convergence-safe: every write ends in a state where desired == current,
 * so the re-dispatched cart events / cart-page reload can't loop.
 */
(function () {
  'use strict';
  var cfg = window.APGO_CART_GIFT;
  if (!cfg || !Array.isArray(cfg.triggers) || !cfg.triggers.length) return;
  var per = parseInt(cfg.per, 10) || 2;

  var modal = document.querySelector('[data-apgo-cart-gift-modal]');
  var picker = modal ? modal.querySelector('[data-apgo-cc-gift-picker]') : null;
  if (!modal || !picker) return;

  var addCta = modal.querySelector('[data-apgo-cart-gift-add]');
  var leadEl = modal.querySelector('[data-apgo-cart-gift-lead]');

  var running = false;
  var selfDispatching = false;
  var missing = 0;        // how many gifts the customer still has to pick
  var qtyMap = {};        // { variantId: qty } — same gift may be taken more than once
  var lastOfferKey = '';  // avoid re-opening after a manual close for the SAME state

  function isCartPage() { return /^\/cart\/?$/.test(window.location.pathname); }

  /* ---------- modal ---------- */
  function pickedTotal() {
    var n = 0;
    for (var k in qtyMap) { if (Object.prototype.hasOwnProperty.call(qtyMap, k)) n += qtyMap[k]; }
    return n;
  }
  function renderPicker() {
    var total = pickedTotal();
    var atMax = total >= missing;
    var opts = picker.querySelectorAll('[data-apgo-cc-gift-option]');
    Array.prototype.forEach.call(opts, function (card) {
      var id = card.getAttribute('data-gift-variant');
      var soldout = card.classList.contains('is-soldout');
      var qty = qtyMap[id] || 0;
      card.classList.toggle('is-selected', qty > 0);
      var valueEl = card.querySelector('[data-apgo-cc-gift-qty-value]');
      if (valueEl) valueEl.textContent = String(qty);
      var minus = card.querySelector('[data-apgo-cc-gift-step="down"]');
      var plus = card.querySelector('[data-apgo-cc-gift-step="up"]');
      if (minus) minus.disabled = soldout || qty < 1;
      if (plus) plus.disabled = soldout || atMax;
    });
    var counter = picker.querySelector('[data-apgo-cc-gift-counter]');
    if (counter) counter.textContent = total + '/' + missing;
    picker.classList.toggle('is-complete', total === missing && missing > 0);
    if (addCta) addCta.disabled = total !== missing || missing === 0;
  }

  function openModal(n) {
    missing = n;
    qtyMap = {};
    if (leadEl) {
      leadEl.textContent = n === 1
        ? 'You’ve unlocked 1 more free gift — choose it below.'
        : 'You’ve unlocked ' + n + ' more free gifts — choose them below.';
    }
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('apgo-cart-gift-lock');
    /* Forced reflow instead of requestAnimationFrame: rAF never fires in
       background tabs, which would leave the modal invisible when the
       cart loads in an unfocused tab. The reflow commits the un-hidden
       state so the transition still animates. */
    void modal.offsetWidth;
    modal.classList.add('is-open');
    renderPicker();
  }

  function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('apgo-cart-gift-lock');
    window.setTimeout(function () {
      if (!modal.classList.contains('is-open')) modal.setAttribute('hidden', '');
    }, 280);
  }

  modal.addEventListener('click', function (e) {
    if (e.target.closest('[data-apgo-cart-gift-close]')) { closeModal(); return; }
    var step = e.target.closest('[data-apgo-cc-gift-step]');
    if (step && !step.disabled) {
      var card = step.closest('[data-apgo-cc-gift-option]');
      if (card && !card.classList.contains('is-soldout')) {
        var id = card.getAttribute('data-gift-variant');
        var qty = qtyMap[id] || 0;
        if (step.getAttribute('data-apgo-cc-gift-step') === 'up') {
          if (pickedTotal() < missing) qtyMap[id] = qty + 1;
        } else if (qty <= 1) {
          delete qtyMap[id];
        } else {
          qtyMap[id] = qty - 1;
        }
        renderPicker();
      }
      return;
    }
    var cta = e.target.closest('[data-apgo-cart-gift-add]');
    if (cta && !cta.disabled) commitChosen(cta);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
  });

  function commitChosen(cta) {
    if (!pickedTotal()) return;
    cta.disabled = true;
    cta.setAttribute('aria-busy', 'true');
    var items = [];
    for (var gid in qtyMap) {
      if (!Object.prototype.hasOwnProperty.call(qtyMap, gid)) continue;
      if (qtyMap[gid] < 1) continue;
      items.push({ id: parseInt(gid, 10), quantity: qtyMap[gid], properties: { _gift_pick: 'true' } });
    }
    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: items })
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw j; });
      return r.json();
    }).then(function () {
      closeModal();
      return afterWrite();
    }).catch(function (err) {
      cta.disabled = false;
      cta.removeAttribute('aria-busy');
      window.alert((err && (err.description || err.message)) || 'Could not add the gifts. Please try again.');
    });
  }

  /* ---------- reconcile ---------- */
  function afterWrite() {
    return fetch('/cart.js?_=' + Date.now(), { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        selfDispatching = true;
        try {
          var detail = {
            data: { itemCount: cart.item_count || 0, source: 'apgo-cart-gift' },
            resource: cart,
            cart: cart
          };
          ['cart:update', 'cart:updated', 'cart:refresh'].forEach(function (name) {
            try { document.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail })); } catch (e) {}
          });
        } finally {
          setTimeout(function () { selfDispatching = false; }, 50);
        }
        if (isCartPage()) window.location.reload();
      });
  }

  function reconcile() {
    if (running) return;
    running = true;
    fetch('/cart.js?_=' + Date.now(), { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var triggerUnits = 0;
        var pickedUnits = 0;
        var giftLines = []; // { key, quantity } newest-last (cart.js lists newest first)
        (cart.items || []).forEach(function (it) {
          if (cfg.triggers.indexOf(it.product_id) !== -1) triggerUnits += it.quantity;
          if (it.properties && it.properties._gift_pick === 'true') {
            pickedUnits += it.quantity;
            giftLines.unshift({ key: it.key, quantity: it.quantity });
          }
        });
        var entitled = triggerUnits * per;

        if (pickedUnits > entitled) {
          /* Trim the excess (protects the customer from being charged). */
          var excess = pickedUnits - entitled;
          var plan = [];
          for (var i = 0; i < giftLines.length && excess > 0; i++) {
            var line = giftLines[i];
            var cut = Math.min(line.quantity, excess);
            plan.push({ key: line.key, quantity: line.quantity - cut });
            excess -= cut;
          }
          var chain = Promise.resolve();
          plan.forEach(function (step) {
            chain = chain.then(function () {
              return fetch('/cart/change.js', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ id: step.key, quantity: step.quantity })
              });
            });
          });
          return chain.then(afterWrite);
        }

        if (pickedUnits < entitled && triggerUnits > 0) {
          var key = entitled + ':' + pickedUnits;
          if (key !== lastOfferKey && !modal.classList.contains('is-open')) {
            lastOfferKey = key;
            openModal(entitled - pickedUnits);
          }
          return null;
        }

        lastOfferKey = '';
        return null;
      })
      .catch(function (err) { console.warn('[apgo-cart-gift] reconcile failed', err); })
      .then(function () { running = false; });
  }

  var timer = null;
  function schedule() {
    if (selfDispatching) return;
    clearTimeout(timer);
    timer = setTimeout(reconcile, 250);
  }

  ['cart:update', 'cart:updated', 'cart:refresh', 'cart:added'].forEach(function (name) {
    document.addEventListener(name, schedule);
  });
  window.addEventListener('pageshow', function (ev) { if (ev.persisted) schedule(); });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
})();
