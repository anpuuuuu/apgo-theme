/* APGO · 限時優惠組合 (Bundle Picker) — Phase B logic + Phase C cart
 *
 * Scope: only loaded when product.metafields.apgo.bundle_enabled == true
 *        (gated in layout/theme.liquid).
 *
 * Single shared state across desktop + mobile shells. Any interaction in
 * either shell updates state, then a render() pass syncs every widget
 * instance + the sticky bottom bar.
 *
 * Phase C: 加入購物車 / 立即購買 POST /cart/add.js with multi line items
 * (one per scent qty). Bundle metadata attached as line item properties.
 * Discount is applied at cart stage by Shopify Automatic Discount rules
 * — admin must configure these (see docs/V1S_PLUS_BUNDLE_PLAN.md §8).
 * 立即購買 redirects to /cart so user can verify discount before checkout.
 */
(function () {
  'use strict';

  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }

  var widgets = $$('[data-apgo-bundle]');
  if (!widgets.length) return;

  // ---------- State ----------
  var state = {
    tier: null,         // { buy, gift, total, unit, totalPrice, label }
    scents: {},         // { name: count }
    pulse: false        // for counter animation hooks (Phase D)
  };

  function totalSelected() {
    var sum = 0;
    for (var k in state.scents) sum += state.scents[k] || 0;
    return sum;
  }

  function readTier(el) {
    if (!el) return null;
    return {
      buy: parseInt(el.dataset.buy, 10) || 0,
      gift: parseInt(el.dataset.gift, 10) || 0,
      total: parseInt(el.dataset.total, 10) || 0,
      // *Cents* — Shopify standard. Always integer to avoid float math.
      unitCents: parseInt(el.dataset.unitCents, 10) || 0,
      totalPriceCents: parseInt(el.dataset.tierTotalCents, 10) || 0,
      label: el.dataset.tierLabel || ''
    };
  }

  // Format cents → 'NT$ 1,596' style. Mirrors apgo-pdp.js / apgo-cc-quick-add.js
  // approach: prefer Shopify.formatMoney with the theme's money_format, fall
  // back to a sensible TWD default. The .money Liquid filter would have done
  // this server-side; we need it client-side because tier prices are dynamic.
  function formatMoney(cents) {
    if (window.Shopify && typeof window.Shopify.formatMoney === 'function') {
      var fmt = (window.theme && window.theme.moneyFormat) || 'NT${{amount}}';
      try { return window.Shopify.formatMoney(cents, fmt); } catch (e) {}
    }
    var n = Number(cents) / 100;
    return 'NT$ ' + n.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function isSingleMode() {
    return state.tier && state.tier.total === 1;
  }

  function init() {
    // Adopt the first .is-active tier as the starting state.
    var defaultTier = $('[data-apgo-bundle-tier].is-active');
    state.tier = readTier(defaultTier) || readTier($('[data-apgo-bundle-tier]'));

    // All scents start at 0.
    $$('[data-apgo-bundle-scent]').forEach(function (row) {
      var name = row.getAttribute('data-apgo-bundle-scent');
      if (name && state.scents[name] == null) state.scents[name] = 0;
    });
  }

  // ---------- Render ----------
  function render() {
    if (!state.tier) return;
    var sel = totalSelected();
    var maxN = state.tier.total;
    var giftN = state.tier.gift;
    var remaining = Math.max(0, maxN - sel);
    var single = isSingleMode();
    var isComplete = single ? sel === 1 : (sel >= maxN && maxN > 0);

    // Toggle widget data-mode attribute so CSS shows/hides the right pickers
    widgets.forEach(function (w) {
      w.setAttribute('data-mode', single ? 'single' : 'multi');
    });

    // Single-chip active state + out-of-stock dimming
    // Class name is .active (not .is-active) to match the original
    // .apgo-scentbtn picker styles we're reusing.
    $$('[data-apgo-bundle-single-scent]').forEach(function (chip) {
      var name = chip.getAttribute('data-apgo-bundle-single-scent');
      var active = single && (state.scents[name] || 0) > 0;
      var avail = isAvailable(name);
      chip.classList.toggle('active', active);
      chip.classList.toggle('is-out-of-stock', !avail);
      var input = chip.querySelector('input[type="radio"]');
      if (input) {
        input.checked = active;
        input.disabled = !avail;
      }
    });

    // 1) Tier active state — sync across all widgets
    $$('[data-apgo-bundle-tier]').forEach(function (t) {
      var d = readTier(t);
      var active = d.label === state.tier.label;
      t.classList.toggle('is-active', active);
      var input = t.querySelector('.apgo-bundle__tier-input');
      if (input) input.checked = active;
    });

    // 2) Counter X / max + note max + gift count
    $$('[data-apgo-bundle-current]').forEach(function (el) { el.textContent = sel; });
    $$('[data-apgo-bundle-max]').forEach(function (el) { el.textContent = maxN; });
    $$('[data-apgo-bundle-max-note]').forEach(function (el) { el.textContent = maxN; });
    $$('[data-apgo-bundle-gift-note]').forEach(function (el) { el.textContent = giftN; });

    // 3) Per-row qty num + disabled buttons + out-of-stock state
    $$('[data-apgo-bundle-scent]').forEach(function (row) {
      var name = row.getAttribute('data-apgo-bundle-scent');
      var n = state.scents[name] || 0;
      var avail = isAvailable(name);

      var numEl = row.querySelector('[data-apgo-bundle-qty-num]');
      if (numEl) numEl.textContent = n;
      var minusBtn = row.querySelector('[data-apgo-bundle-qty="-1"]');
      var plusBtn  = row.querySelector('[data-apgo-bundle-qty="1"]');
      if (minusBtn) minusBtn.disabled = n <= 0;
      // + disabled when at max OR out of stock
      if (plusBtn)  plusBtn.disabled  = sel >= maxN || !avail;

      // Out-of-stock visual: dim row + insert 缺貨 chip
      row.classList.toggle('is-out-of-stock', !avail);
      var chip = row.querySelector('[data-apgo-bundle-stock-chip]');
      if (!avail) {
        if (!chip) {
          var info = row.querySelector('.apgo-bundle__scent-info');
          if (info) {
            chip = document.createElement('span');
            chip.className = 'apgo-bundle__scent-out';
            chip.setAttribute('data-apgo-bundle-stock-chip', '');
            chip.textContent = '缺貨';
            info.appendChild(chip);
          }
        }
      } else if (chip) {
        chip.remove();
      }
    });

    // 4) CTA dual state — both inside widgets and inside the mobile sticky bar
    $$('[data-apgo-bundle-cta-disabled]').forEach(function (el) {
      el.style.display = isComplete ? 'none' : '';
      var rem = el.querySelector('[data-apgo-bundle-remaining]');
      if (rem) rem.textContent = remaining;
    });
    $$('[data-apgo-bundle-cta-enabled]').forEach(function (el) {
      el.style.display = isComplete ? '' : 'none';
    });
    $$('[data-apgo-bundle-total]').forEach(function (el) {
      el.textContent = formatMoney(state.tier.totalPriceCents);
    });
  }

  // ---------- Wire interactions ----------
  function wire() {
    // Tier click — switch active, trim scents if over new max
    $$('[data-apgo-bundle-tier]').forEach(function (t) {
      t.addEventListener('click', function (e) {
        // Prevent label's default radio toggle from interfering
        if (e.target && e.target.matches('input.apgo-bundle__tier-input')) {
          // let the radio change happen, then re-render
        }
        var newTier = readTier(t);
        if (!newTier || newTier.label === state.tier.label) {
          // Same tier → just re-render to be safe
          state.tier = newTier;
          render();
          return;
        }
        state.tier = newTier;
        // Switching INTO single mode (max=1): clear all so user picks fresh.
        // Switching OUT of single mode: same — multi mode starts fresh.
        // (Switching between multi tiers we still trim.)
        var wasSingle = state.tier && state.tier.total === 1;
        var goingSingle = newTier.total === 1;
        if (goingSingle || wasSingle) {
          Object.keys(state.scents).forEach(function (n) { state.scents[n] = 0; });
        } else {
          // Multi → multi: trim from highest-qty first if over new max
          var sel = totalSelected();
          if (sel > newTier.total) {
            var entries = Object.keys(state.scents).map(function (k) {
              return [k, state.scents[k]];
            }).sort(function (a, b) { return b[1] - a[1]; });
            var i = 0;
            while (sel > newTier.total && i < entries.length * 100) {
              var nm = entries[i % entries.length][0];
              if (state.scents[nm] > 0) { state.scents[nm]--; sel--; }
              i++;
            }
          }
        }
        render();
      });
    });

    // Single-mode chip click → set state.scents[name] = 1, all others = 0
    document.addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('[data-apgo-bundle-single-scent]');
      if (!chip) return;
      if (!isSingleMode()) return;
      var name = chip.getAttribute('data-apgo-bundle-single-scent');
      if (!isAvailable(name)) return;
      Object.keys(state.scents).forEach(function (n) { state.scents[n] = 0; });
      state.scents[name] = 1;
      render();
    });

    // Qty +/- (delegated so dynamically-added rows also work)
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-apgo-bundle-qty]');
      if (!btn) return;
      var row = btn.closest('[data-apgo-bundle-scent]');
      if (!row) return;
      var name = row.getAttribute('data-apgo-bundle-scent');
      var delta = parseInt(btn.dataset.apgoBundleQty, 10) || 0;
      var cur = state.scents[name] || 0;
      var newVal = cur + delta;
      if (newVal < 0) return;
      if (delta > 0 && totalSelected() >= state.tier.total) return; // hit max
      state.scents[name] = newVal;
      render();
    });

    // Quick actions: 全部都同款 / 隨機驚喜 / 清除.
    // Out-of-stock scents are NEVER assigned to by quick actions; only the
    // available pool is used. Clear still wipes everything (including any
    // legacy qty on a now-out-of-stock scent so the counter stays clean).
    $$('[data-apgo-bundle-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.dataset.apgoBundleAction;
        var allNames = Object.keys(state.scents);
        if (!allNames.length) return;
        var pool = availableScentNames();

        if (action === 'clear') {
          allNames.forEach(function (n) { state.scents[n] = 0; });
        } else if (!pool.length) {
          // Edge: every scent is out of stock. Quick actions become no-op
          // except clear (handled above). Toast once for clarity.
          toast('所有香氛暫時缺貨', true);
          return;
        } else if (action === 'all-same') {
          // Pick the user's currently most-selected AVAILABLE scent;
          // tie / no selection → first available.
          var topName = pool[0];
          var topQty = state.scents[topName] || 0;
          pool.forEach(function (n) {
            if ((state.scents[n] || 0) > topQty) { topQty = state.scents[n]; topName = n; }
          });
          allNames.forEach(function (n) { state.scents[n] = 0; });
          state.scents[topName] = state.tier.total;
        } else if (action === 'random') {
          allNames.forEach(function (n) { state.scents[n] = 0; });
          for (var i = 0; i < state.tier.total; i++) {
            var pick = pool[Math.floor(Math.random() * pool.length)];
            state.scents[pick]++;
          }
        }
        render();
      });
    });

    // Add-to-cart / Buy-now — Phase C real cart submission
    $$('[data-apgo-bundle-add]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        submitToCart(btn, false);
      });
    });
    $$('[data-apgo-bundle-buy-now]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        submitToCart(btn, true);
      });
    });
  }

  // ---------- Cart submission (Phase C) ----------
  function submitToCart(triggerBtn, redirectToCart) {
    var payload = buildPayload();
    if (!payload.items.length) {
      toast('請先選滿香氛', true);
      return;
    }

    // Disable all bundle CTA buttons during the request to prevent double-submit
    var allBtns = $$('[data-apgo-bundle-add], [data-apgo-bundle-buy-now]');
    allBtns.forEach(function (b) { b.disabled = true; b.classList.add('is-loading'); });
    var origText = triggerBtn.innerHTML;
    triggerBtn.textContent = '加入中…';

    fetch('/cart/add.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({ items: payload.items })
    })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) return Promise.reject(data);
          return data;
        });
      })
      .then(function () {
        // Refetch live cart so any cart drawer / header counter listening picks
        // up the new items. Mirrors apgo-pdp.js behaviour.
        return fetch('/cart.js?_=' + Date.now(), {
          cache: 'no-store',
          headers: { 'Accept': 'application/json' }
        }).then(function (r) { return r.json(); });
      })
      .then(function (cart) {
        // Dispatch the same cart events apgo-pdp.js dispatches so the rest
        // of the theme stays in sync.
        document.dispatchEvent(new CustomEvent('cart:update', { detail: { cart: cart } }));
        document.documentElement.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true, detail: { cart: cart } }));
        document.dispatchEvent(new CustomEvent('cart:updated'));

        // Optional: try to fire Horizon's @theme/events. Ignore if absent.
        try {
          import('@theme/events').then(function (mod) {
            if (mod && mod.CartUpdateEvent) {
              document.dispatchEvent(new mod.CartUpdateEvent(cart, 'apgo-bundle', {
                itemCount: cart.item_count, source: 'apgo-bundle', sections: {}
              }));
            }
            if (mod && mod.CartAddEvent) {
              document.dispatchEvent(new mod.CartAddEvent({}, 'apgo-bundle', { source: 'apgo-bundle' }));
            }
          }).catch(function () {});
        } catch (_) {}

        if (redirectToCart) {
          // 立即購買 → land on /cart so user can verify the bundle discount
          // applied before checkout. This is the user-confirmed UX (see
          // docs/V1S_PLUS_BUNDLE_PLAN.md Phase C, decision 2026-04-29).
          window.location.href = '/cart';
          return;
        }

        toast('✓ 已加入購物車');

        // Reset CTA UI back to enabled state for another round of selection
        allBtns.forEach(function (b) { b.disabled = false; b.classList.remove('is-loading'); });
        triggerBtn.innerHTML = origText;

        // Clear scent selections so the user can build another bundle
        Object.keys(state.scents).forEach(function (n) { state.scents[n] = 0; });
        render();
      })
      .catch(function (err) {
        console.error('[apgo-bundle] cart add failed:', err);
        var msg = (err && err.description) || (err && err.message) || '加入失敗，請稍後再試';
        toast(msg, true);
        allBtns.forEach(function (b) { b.disabled = false; b.classList.remove('is-loading'); });
        triggerBtn.innerHTML = origText;
      });
  }

  // Reuse PDP's existing toast component (apgoCartToast) when present;
  // fall back to alert so we never silently fail.
  function toast(text, isError) {
    if (typeof window.apgoCartToast === 'function') {
      window.apgoCartToast(text, isError);
      return;
    }
    if (isError) {
      console.warn('[apgo-bundle] ' + text);
    }
    // Soft fallback — no DOM toast available (PDP JS not loaded?). Avoid
    // alert in production but log so we know.
    console.log('[apgo-bundle toast]', text);
  }

  // ---------- Payload (Phase C will use this) ----------
  // Read product variants once (already inlined by the PDP section as
  // <script type="application/json" data-apgo-variants>{{ product.variants | json }}</script>)
  // and build a {scentName: variantId} map so each scent row can be turned
  // into a /cart/add line item.
  var variantsByScent = {};
  var availableByScent = {};
  (function () {
    var el = document.querySelector('[data-apgo-variants]');
    if (!el) return;
    var arr;
    try { arr = JSON.parse(el.textContent); } catch (e) { return; }
    if (!Array.isArray(arr)) return;
    arr.forEach(function (v) {
      // The laundry detergent option layout is option1 = 香氛, option2 = 容量
      // (with one capacity variant 1L). If a future product flips this, the
      // map will still be populated — we just may need a more explicit
      // option-name lookup. For now option1 is scent.
      if (!v.option1) return;
      variantsByScent[v.option1] = v.id;
      // variant.available is Shopify's authoritative truth: tracks inventory
      // > 0 OR 'continue selling when out of stock' is on. False when the
      // scent should be disabled in the picker.
      availableByScent[v.option1] = v.available !== false;
    });
  })();

  function isAvailable(name) {
    // Default true so unknown scents (custom UI tests) still work
    return availableByScent[name] !== false;
  }
  function availableScentNames() {
    return Object.keys(state.scents).filter(isAvailable);
  }

  // Build Shopify cart payload (items[] for POST /cart/add.js).
  // Each scent quantity becomes one line item with quantity = N. Bundle
  // metadata is attached as line item properties so the order admin can
  // see which line items belong together. Discount is applied separately
  // via Shopify Automatic Discount (admin-side), see
  // docs/V1S_PLUS_BUNDLE_PLAN.md Phase C.
  function buildPayload() {
    // Single-pack tier: behave like a normal product add. No bundle metadata,
    // no Automatic Discount needed (since min-qty rules require ≥3 packs).
    if (isSingleMode()) {
      var pickedName = null;
      Object.keys(state.scents).forEach(function (name) {
        if ((state.scents[name] || 0) > 0) pickedName = name;
      });
      if (!pickedName) return { bundle_id: null, items: [] };
      var vid = variantsByScent[pickedName];
      if (!vid) {
        console.warn('[apgo-bundle] No variant_id for scent "' + pickedName + '"; skipping');
        return { bundle_id: null, items: [] };
      }
      return {
        bundle_id: null,
        items: [{ id: vid, quantity: 1 }]
      };
    }

    // Multi-pack bundle: tag each line with bundle metadata + buy/gift role.
    var bundleId = 'apgo-bundle-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    var items = [];
    var packsAssigned = 0;
    var buyN = state.tier.buy;

    Object.keys(state.scents).forEach(function (name) {
      var q = state.scents[name];
      if (q <= 0) return;
      var vid = variantsByScent[name];
      if (!vid) {
        console.warn('[apgo-bundle] No variant_id for scent "' + name + '"; skipping');
        return;
      }
      // Split this scent's qty between buy/gift roles based on the running
      // packsAssigned counter. First buyN packs across all scents = 'buy',
      // the rest = 'gift'. Since cart line items can only have one set of
      // properties per line, we may need to split a single scent across
      // two line items if it straddles the buy/gift boundary.
      var remainingHere = q;
      while (remainingHere > 0) {
        var stillToReachBuy = Math.max(0, buyN - packsAssigned);
        var role, take;
        if (stillToReachBuy > 0) {
          take = Math.min(remainingHere, stillToReachBuy);
          role = 'buy';
        } else {
          take = remainingHere;
          role = 'gift';
        }
        items.push({
          id: vid,
          quantity: take,
          properties: {
            _bundle_id: bundleId,
            _bundle_tier: state.tier.label,
            _bundle_role: role,
            _bundle_total_packs: String(state.tier.total),
            _bundle_quoted_total: formatMoney(state.tier.totalPriceCents)
          }
        });
        packsAssigned += take;
        remainingHere -= take;
      }
    });

    return { bundle_id: bundleId, items: items };
  }

  // ---------- Boot ----------
  init();
  wire();
  render();

  // Re-init on Shopify theme editor section reload
  if (window.Shopify && Shopify.designMode) {
    document.addEventListener('shopify:section:load', function () {
      widgets = $$('[data-apgo-bundle]');
      init();
      wire();
      render();
    });
  }
})();
