/**
 * Free-gift promo popup + draggable reminder bubble (v3 PDP).
 *
 * Countdown model — EVERGREEN, per device:
 *   The deadline is written to localStorage on the visitor's first view and
 *   reused on every later visit, so the timer continues rather than
 *   restarting. When it lapses, the popup, bubble and timer stop appearing
 *   for good. We deliberately do NOT restart it: a countdown that resets
 *   forever while the gift is always granted is a false-urgency claim
 *   (regulators and ad platforms both act on those). The discount app keeps
 *   giving the gift — we just stop shouting about the clock.
 *
 * Storage keys (scoped per product via data-promo-key):
 *   <key>:deadline  epoch ms the offer ends for this device
 *   <key>:seen      popup has auto-opened once
 *   <key>:bubble    bubble dismissed via its ×
 *   <key>:pos       remembered bubble position {x, y}
 */
(function () {
  'use strict';

  var popup = document.querySelector('[data-apgo-promo-popup]');
  var bubble = document.querySelector('[data-apgo-promo-bubble]');
  if (!popup) return;

  var KEY = popup.getAttribute('data-promo-key') || 'apgo-promo';
  var HOURS = parseInt(popup.getAttribute('data-promo-hours'), 10) || 12;
  var clockEl = popup.querySelector('[data-apgo-promo-clock]');
  var bubbleClockEl = bubble ? bubble.querySelector('[data-apgo-promo-bubble-clock]') : null;

  /* localStorage can throw (private mode, storage full) — never let that
     take the page down; fall back to a memory-only session. */
  var mem = {};
  function get(k) {
    try { return window.localStorage.getItem(KEY + ':' + k); }
    catch (e) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; }
  }
  function set(k, v) {
    try { window.localStorage.setItem(KEY + ':' + k, v); }
    catch (e) { mem[k] = v; }
  }

  /* ---------- deadline ---------- */
  function resolveDeadline() {
    var stored = parseInt(get('deadline'), 10);
    if (stored && !isNaN(stored)) return stored;
    var fresh = Date.now() + HOURS * 3600 * 1000;
    set('deadline', String(fresh));
    return fresh;
  }

  var deadline = resolveDeadline();
  if (Date.now() >= deadline) return; // lapsed → no popup, no bubble, no timer

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function tick() {
    var left = deadline - Date.now();
    if (left <= 0) {
      closePopup();
      if (bubble) bubble.hidden = true;
      window.clearInterval(timerId);
      return;
    }
    var totalSec = Math.floor(left / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (clockEl) clockEl.textContent = pad(h) + ':' + pad(m) + ':' + pad(s);
    if (bubbleClockEl) bubbleClockEl.textContent = pad(h) + ':' + pad(m);
    /* Final hour → urgent styling */
    if (left < 3600 * 1000) {
      popup.classList.add('is-urgent');
      if (bubble) bubble.classList.add('is-urgent');
    }
  }

  var timerId = window.setInterval(tick, 1000);
  tick();

  /* ---------- popup ---------- */
  function openPopup() {
    popup.removeAttribute('hidden');
    popup.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('apgo-promo-lock');
    /* Forced reflow rather than rAF: rAF never fires in a background tab,
       which would leave the popup stuck invisible. */
    void popup.offsetWidth;
    popup.classList.add('is-open');
  }

  function closePopup() {
    if (!popup.classList.contains('is-open')) return;
    popup.classList.remove('is-open');
    popup.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('apgo-promo-lock');
    window.setTimeout(function () {
      if (!popup.classList.contains('is-open')) popup.setAttribute('hidden', '');
    }, 280);
    showBubble();
  }

  popup.addEventListener('click', function (e) {
    if (e.target.closest('[data-apgo-promo-close]')) { closePopup(); return; }
    if (e.target.closest('[data-apgo-promo-cta]')) {
      closePopup();
      var target = document.querySelector('.apgo-cc-pdp__cta-row') ||
                   document.querySelector('[data-apgo-cc-add]');
      if (target) { try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (err) {} }
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && popup.classList.contains('is-open')) closePopup();
  });

  /* Auto-open once per device, after a short delay so the page paints first. */
  if (!get('seen')) {
    window.setTimeout(function () {
      set('seen', '1');
      openPopup();
    }, 2000);
  } else {
    showBubble();
  }

  /* ---------- bubble ---------- */
  function showBubble() {
    if (!bubble || get('bubble') === 'dismissed') return;
    bubble.hidden = false;
    restorePosition();
  }

  function clampToViewport(x, y) {
    var w = bubble.offsetWidth || 64;
    var h = bubble.offsetHeight || 64;
    var maxX = Math.max(0, window.innerWidth - w - 8);
    var maxY = Math.max(0, window.innerHeight - h - 8);
    return {
      x: Math.min(Math.max(8, x), maxX),
      y: Math.min(Math.max(8, y), maxY)
    };
  }

  function applyPosition(x, y) {
    var p = clampToViewport(x, y);
    bubble.style.left = p.x + 'px';
    bubble.style.top = p.y + 'px';
    bubble.style.right = 'auto';
    bubble.style.bottom = 'auto';
  }

  function restorePosition() {
    var raw = get('pos');
    if (!raw) return; // keep the CSS default (bottom-left, clear of chat + buy bar)
    try {
      var p = JSON.parse(raw);
      if (typeof p.x === 'number' && typeof p.y === 'number') applyPosition(p.x, p.y);
    } catch (e) {}
  }

  if (bubble) {
    var dragging = false;
    var moved = false;
    var startX = 0, startY = 0, originX = 0, originY = 0;

    function onDown(e) {
      if (e.target.closest('[data-apgo-promo-bubble-dismiss]')) return;
      var pt = e.touches ? e.touches[0] : e;
      dragging = true;
      moved = false;
      startX = pt.clientX;
      startY = pt.clientY;
      var r = bubble.getBoundingClientRect();
      originX = r.left;
      originY = r.top;
      bubble.classList.add('is-dragging');
    }

    function onMove(e) {
      if (!dragging) return;
      var pt = e.touches ? e.touches[0] : e;
      var dx = pt.clientX - startX;
      var dy = pt.clientY - startY;
      /* Only treat it as a drag past a small threshold, so a normal tap
         still registers as a click that reopens the popup. */
      if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      moved = true;
      if (e.cancelable) e.preventDefault();
      applyPosition(originX + dx, originY + dy);
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      bubble.classList.remove('is-dragging');
      if (moved) {
        var r = bubble.getBoundingClientRect();
        set('pos', JSON.stringify({ x: r.left, y: r.top }));
      }
    }

    bubble.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    bubble.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);

    bubble.addEventListener('click', function (e) {
      if (e.target.closest('[data-apgo-promo-bubble-dismiss]')) {
        set('bubble', 'dismissed');
        bubble.hidden = true;
        return;
      }
      if (moved) { moved = false; return; } // finished a drag, not a tap
      openPopup();
    });

    /* Keep it on screen when the viewport changes (rotate / resize). */
    window.addEventListener('resize', function () {
      if (bubble.hidden) return;
      var r = bubble.getBoundingClientRect();
      applyPosition(r.left, r.top);
    });
  }
})();
