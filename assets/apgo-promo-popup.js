/**
 * Free-gift promo popup + draggable reminder bubble (v3 PDP).
 *
 * The gift itself is always granted by the discount app, so the MESSAGE is
 * true at any time — only the countdown is a nudge. The two are therefore
 * decoupled:
 *
 *   First visit (within the evergreen window)
 *       → popup + live countdown (urgency)
 *   After the window lapses
 *       → popup still shows, countdown is REMOVED; it just states the free
 *         gift. Keeps the offer in front of returning customers without
 *         ever showing a deadline that resets — repeat visitors are exactly
 *         the people who would notice a restarting timer, and once they do,
 *         every other urgency cue on the site loses its credibility.
 *
 * Optional hard deadline (data-promo-end-ts): a REAL campaign end shared by
 * everyone. When set it caps the evergreen window, and once it passes the
 * promo is over — popup and bubble stop entirely.
 *
 * Storage keys (scoped per product via data-promo-key):
 *   <key>:deadline  epoch ms the evergreen window ends on this device
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
  var HOURS = parseInt(popup.getAttribute('data-promo-hours'), 10) || 2;
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

  /* ---------- deadlines ---------- */
  /* Real campaign end shared by everyone (optional). */
  var hardEnd = parseInt(popup.getAttribute('data-promo-end-ts'), 10);
  if (isNaN(hardEnd) || hardEnd <= 0) hardEnd = 0;

  /* Campaign is genuinely over → show nothing at all. */
  if (hardEnd && Date.now() >= hardEnd) return;

  function resolveDeadline() {
    var stored = parseInt(get('deadline'), 10);
    if (stored && !isNaN(stored)) return stored;
    var fresh = Date.now() + HOURS * 3600 * 1000;
    set('deadline', String(fresh));
    return fresh;
  }

  var deadline = resolveDeadline();
  /* Never promise time beyond the real campaign end. */
  if (hardEnd && deadline > hardEnd) deadline = hardEnd;

  /* Countdown only runs inside the window; past it the popup still shows,
     just without any clock. */
  var timerLive = Date.now() < deadline;
  var timerId = null;

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function stopTimer() {
    timerLive = false;
    if (timerId) { window.clearInterval(timerId); timerId = null; }
    popup.classList.add('is-timerless');
    popup.classList.remove('is-urgent');
    if (bubble) bubble.classList.remove('is-urgent');
    if (bubbleClockEl) bubbleClockEl.textContent = '';
  }

  function tick() {
    var left = deadline - Date.now();
    if (left <= 0) { stopTimer(); return; }
    var totalSec = Math.floor(left / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (clockEl) clockEl.textContent = pad(h) + ':' + pad(m) + ':' + pad(s);
    if (bubbleClockEl) bubbleClockEl.textContent = pad(h) + ':' + pad(m);
    /* Final 30 minutes → urgent styling */
    if (left < 1800 * 1000) {
      popup.classList.add('is-urgent');
      if (bubble) bubble.classList.add('is-urgent');
    }
  }

  if (timerLive) {
    timerId = window.setInterval(tick, 1000);
    tick();
  } else {
    stopTimer();
  }

  /* ---------- card ----------
     Non-modal on purpose: no scroll lock, no backdrop. Ad traffic lands
     directly on this page, so the page has to stay readable and
     clickable while the offer sits docked below the header. */
  function openPopup() {
    popup.removeAttribute('hidden');
    popup.setAttribute('aria-hidden', 'false');
    /* Forced reflow rather than rAF: rAF never fires in a background tab,
       which would leave the card stuck invisible. */
    void popup.offsetWidth;
    popup.classList.add('is-open');
  }

  function closePopup() {
    if (!popup.classList.contains('is-open')) return;
    popup.classList.remove('is-open');
    popup.setAttribute('aria-hidden', 'true');
    window.setTimeout(function () {
      if (!popup.classList.contains('is-open')) popup.setAttribute('hidden', '');
    }, 280);
    showBubble();
  }

  popup.addEventListener('click', function (e) {
    if (e.target.closest('[data-apgo-promo-close]')) { closePopup(); return; }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && popup.classList.contains('is-open')) closePopup();
  });

  /* Auto-open once per SESSION, after a short delay so the page paints
     first. Per-session rather than once-ever so a customer returning on a
     later day still learns about the free gift (by then it opens without a
     countdown) — while never re-nagging during the same visit. */
  var seenThisSession = false;
  try { seenThisSession = window.sessionStorage.getItem(KEY + ':seen') === '1'; }
  catch (e) { seenThisSession = mem.seenSession === '1'; }

  if (!seenThisSession) {
    window.setTimeout(function () {
      try { window.sessionStorage.setItem(KEY + ':seen', '1'); }
      catch (e) { mem.seenSession = '1'; }
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

  /* Horizontal travel is clamped to 0..(width - bubble) so the bubble can
     sit FLUSH against either side; only the vertical axis keeps a margin. */
  function clampToViewport(x, y) {
    var w = bubble.offsetWidth || 56;
    var h = bubble.offsetHeight || 56;
    var maxX = Math.max(0, window.innerWidth - w);
    var maxY = Math.max(0, window.innerHeight - h - 8);
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(8, y), maxY)
    };
  }

  function applyPosition(x, y) {
    var p = clampToViewport(x, y);
    bubble.style.left = p.x + 'px';
    bubble.style.top = p.y + 'px';
    bubble.style.right = 'auto';
    bubble.style.bottom = 'auto';
    /* The dismiss × lives inside the circle, so it has to move to the
       inward side once the bubble is against the right edge. */
    bubble.classList.toggle('is-edge-right', p.x + (bubble.offsetWidth || 56) / 2 > window.innerWidth / 2);
  }

  /* Released mid-screen → slide to whichever side edge is nearer, so the
     bubble always ends up hugging the screen. */
  function snapToEdge() {
    var r = bubble.getBoundingClientRect();
    var toLeft = r.left + r.width / 2 < window.innerWidth / 2;
    applyPosition(toLeft ? 0 : window.innerWidth - r.width, r.top);
  }

  function restorePosition() {
    var raw = get('pos');
    if (!raw) return; // keep the CSS default (left edge, clear of chat + buy bar)
    try {
      var p = JSON.parse(raw);
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        applyPosition(p.x, p.y);
        snapToEdge(); // a narrower screen than last time must not leave it adrift
      }
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
        snapToEdge();
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

    /* Keep it on screen — and still edge-hugging — when the viewport
       changes (rotate / resize). */
    window.addEventListener('resize', function () {
      if (bubble.hidden) return;
      var r = bubble.getBoundingClientRect();
      applyPosition(r.left, r.top);
      snapToEdge();
    });
  }
})();
