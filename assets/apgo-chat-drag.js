/* APGO — Draggable chat-button overlay
 *
 * The Shopify Inbox (or any third-party chat) widget injects a `position: fixed`
 * launcher onto every page. Its built-in placement options are only a few
 * presets (corner + low/high). This script lets the visitor drag the launcher
 * anywhere on screen and remembers the location in localStorage for next visit.
 *
 * Approach
 * --------
 * 1. MutationObserver watches the DOM; once the chat element appears (it's
 *    injected async after page load), bind drag handlers.
 * 2. Drag handlers track pointer/touch movement. Distance < DRAG_THRESHOLD is
 *    treated as a click and falls through to the chat widget (so the user can
 *    still open the chat normally).
 * 3. On drag end, clamp to viewport and save {left, top} to localStorage.
 * 4. Position is re-applied with !important to defeat any inline style the
 *    chat app re-asserts on re-render.
 *
 * Loaded from layout/theme.liquid right before </body>.
 *
 * Selector strategy
 * -----------------
 * Different chat apps use different DOM markers. We try a list of common
 * selectors in priority order. If none match, the script is a no-op.
 * Inspect the chat element on the live storefront and add its exact selector
 * to CHAT_SELECTORS for best reliability.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'apgoChatPos';
  var DRAG_THRESHOLD = 5; // px — anything below counts as a click

  /* Common selectors for various chat widgets.
     Add more if your store uses a different chat app. Order matters: the first
     match wins per page. */
  var CHAT_SELECTORS = [
    /* Shopify Inbox — recent versions */
    '#shopify-chat',
    'iframe#shopify-chat',
    'div#shopify-chat',
    /* Shopify Inbox — older / variants */
    '.shopify-chat-bubble',
    'iframe[name="shopify-chat-iframe"]',
    'iframe[src*="shopifychat"]',
    'iframe[src*="inbox.shopify"]',
    'iframe[src*="chat.shopify"]',
    /* Generic chat apps (Tidio / Crisp / Tawk / Intercom — covers many) */
    'iframe[title*="chat" i]',
    'iframe[title*="Chat" i]',
    'iframe[src*="tidio"]',
    'iframe[src*="crisp"]',
    'iframe[src*="tawk"]',
    'iframe[src*="intercom"]'
  ];

  function findChatEl() {
    for (var i = 0; i < CHAT_SELECTORS.length; i++) {
      var el = document.querySelector(CHAT_SELECTORS[i]);
      if (el) return el;
    }
    return null;
  }

  function readSavedPos() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (e) { return null; }
  }
  function writeSavedPos(p) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (e) {}
  }

  /* Force pin to {left, top} using !important so the chat widget can't override
     us with its own inline style on re-render. */
  function applyPos(el, left, top) {
    el.style.setProperty('left',   left + 'px', 'important');
    el.style.setProperty('top',    top  + 'px', 'important');
    el.style.setProperty('right',  'auto',      'important');
    el.style.setProperty('bottom', 'auto',      'important');
    el.style.setProperty('position', 'fixed',   'important');
  }

  function clampToViewport(left, top, w, h) {
    var maxLeft = Math.max(0, window.innerWidth  - w);
    var maxTop  = Math.max(0, window.innerHeight - h);
    return {
      left: Math.max(0, Math.min(maxLeft, left)),
      top:  Math.max(0, Math.min(maxTop,  top))
    };
  }

  function applySavedPos(el) {
    var p = readSavedPos();
    if (!p) return;
    var rect = el.getBoundingClientRect();
    var clamped = clampToViewport(p.left, p.top, rect.width || 60, rect.height || 60);
    applyPos(el, clamped.left, clamped.top);
  }

  function makeDraggable(el) {
    if (el.dataset.apgoChatDraggable) return;
    el.dataset.apgoChatDraggable = '1';

    /* Subtle UX: change cursor over the launcher so it's clear it can be dragged */
    el.style.setProperty('cursor', 'grab', 'important');

    applySavedPos(el);

    var startX = 0, startY = 0, origLeft = 0, origTop = 0;
    var dragging = false, pointerActive = false;

    function onStart(e) {
      pointerActive = true;
      dragging = false;
      var t = e.touches ? e.touches[0] : e;
      var rect = el.getBoundingClientRect();
      startX = t.clientX; startY = t.clientY;
      origLeft = rect.left; origTop = rect.top;
    }
    function onMove(e) {
      if (!pointerActive) return;
      var t = e.touches ? e.touches[0] : e;
      var dx = t.clientX - startX, dy = t.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      dragging = true;
      if (e.cancelable) e.preventDefault();
      el.style.setProperty('cursor', 'grabbing', 'important');
      var rect = el.getBoundingClientRect();
      var clamped = clampToViewport(origLeft + dx, origTop + dy, rect.width, rect.height);
      applyPos(el, clamped.left, clamped.top);
    }
    function onEnd() {
      if (!pointerActive) return;
      pointerActive = false;
      el.style.setProperty('cursor', 'grab', 'important');
      if (!dragging) return; /* a click — let the widget handle it, don't save */
      var rect = el.getBoundingClientRect();
      writeSavedPos({ left: rect.left, top: rect.top });
    }

    /* Bind on the launcher itself for start; move/end on document so a fast
       drag that briefly leaves the launcher bounds still tracks correctly. */
    el.addEventListener('mousedown',  onStart);
    el.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup',   onEnd);
    document.addEventListener('touchend',  onEnd);
    document.addEventListener('touchcancel', onEnd);
  }

  /* Try once now (in case the chat is already mounted by the time this script
     runs), then keep watching the DOM for re-mounts / late injection. */
  function tryBind() {
    var el = findChatEl();
    if (el) makeDraggable(el);
  }
  tryBind();

  if (typeof MutationObserver === 'function') {
    var mo = new MutationObserver(function () {
      tryBind();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* Re-clamp on viewport resize / orientation change so the launcher doesn't
     get stranded off-screen. */
  window.addEventListener('resize', function () {
    var el = findChatEl();
    if (!el) return;
    applySavedPos(el);
  });
})();
