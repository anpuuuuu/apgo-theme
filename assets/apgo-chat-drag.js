/* APGO — Draggable chat-button via standalone drag handle
 *
 * Previous attempt bound drag listeners directly on the chat element. That
 * doesn't work reliably because:
 *   1. The chat button is usually inside a cross-origin iframe — pointer
 *      events fired inside the iframe never bubble out to the parent page.
 *   2. Chat widgets often capture clicks aggressively (z-index + their own
 *      JS listeners) so a parent-page mousedown never fires.
 *
 * New approach: render a tiny visible "grip" handle next to the chat button.
 * The user drags the handle, NOT the chat button. The chat button stays
 * untouched (clicks still open the chat). We track the chat element's
 * position so the handle follows it; on drag we recompute and apply the new
 * position to both the chat element (via !important inline style) and the
 * handle (so they stay glued together). LocalStorage remembers the
 * preferred position across sessions.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'apgoChatPos';
  var HANDLE_SIZE = 26;     // px — circle handle
  var HANDLE_GAP  = 6;      // px — gap between handle and chat element

  /* Common selectors for various chat widgets — add more here if a particular
     chat app uses a different DOM marker. First match wins per page. */
  var CHAT_SELECTORS = [
    '#shopify-chat',
    'iframe#shopify-chat',
    'div#shopify-chat',
    '.shopify-chat-bubble',
    'iframe[name="shopify-chat-iframe"]',
    'iframe[src*="shopifychat"]',
    'iframe[src*="inbox.shopify"]',
    'iframe[src*="chat.shopify"]',
    'iframe[title*="chat" i]',
    'iframe[src*="tidio"]',
    'iframe[src*="crisp"]',
    'iframe[src*="tawk"]',
    'iframe[src*="intercom"]'
  ];

  /* Heuristic fallback: when none of the explicit selectors match, scan every
     iframe on the page and pick whichever is small + positioned fixed at the
     bottom of the viewport (typical chat-launcher shape). */
  function heuristicChatEl() {
    var nodes = document.querySelectorAll('iframe');
    for (var i = 0; i < nodes.length; i++) {
      var f = nodes[i];
      var cs = window.getComputedStyle(f);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      var r = f.getBoundingClientRect();
      if (r.width <= 0 || r.width > 120 || r.height <= 0 || r.height > 120) continue;
      /* Reasonably close to the viewport bottom edge */
      if (window.innerHeight - r.bottom > 200) continue;
      return f;
    }
    return null;
  }

  function findChatEl() {
    for (var i = 0; i < CHAT_SELECTORS.length; i++) {
      var el = document.querySelector(CHAT_SELECTORS[i]);
      if (el) return el;
    }
    return heuristicChatEl();
  }

  function readSavedPos() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function writeSavedPos(p) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (e) {}
  }

  function applyChatPos(el, left, top) {
    el.style.setProperty('left',   left + 'px', 'important');
    el.style.setProperty('top',    top  + 'px', 'important');
    el.style.setProperty('right',  'auto',      'important');
    el.style.setProperty('bottom', 'auto',      'important');
    el.style.setProperty('position', 'fixed',   'important');
  }

  function clamp(left, top, w, h) {
    var maxL = Math.max(0, window.innerWidth  - w);
    var maxT = Math.max(0, window.innerHeight - h);
    return {
      left: Math.max(0, Math.min(maxL, left)),
      top:  Math.max(0, Math.min(maxT, top))
    };
  }

  /* Apply persisted position on first sight + on every reload */
  function applySaved(el) {
    var p = readSavedPos();
    if (!p) return;
    var r = el.getBoundingClientRect();
    var c = clamp(p.left, p.top, r.width || 60, r.height || 60);
    applyChatPos(el, c.left, c.top);
  }

  /* The handle is a tiny circle pinned to the upper-left of the chat element.
     Stays in sync with the chat element's getBoundingClientRect via a
     ResizeObserver + scroll listener + a slow rAF tick (chat widgets often
     re-write their own inline style during animations / on visibility toggle). */
  function createHandle() {
    var h = document.createElement('div');
    h.id = 'apgo-chat-drag-handle';
    h.setAttribute('role', 'button');
    h.setAttribute('aria-label', 'Drag chat button');
    h.title = 'Drag to move';
    h.style.cssText = [
      'position:fixed',
      'width:' + HANDLE_SIZE + 'px',
      'height:' + HANDLE_SIZE + 'px',
      'border-radius:50%',
      'background:rgba(20,20,20,0.95)',
      'border:1px solid rgba(240,132,24,0.5)',
      'box-shadow:0 2px 8px rgba(0,0,0,0.4)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'color:#f08418',
      'cursor:grab',
      'z-index:2147483647',
      'user-select:none',
      '-webkit-user-select:none',
      'touch-action:none',
      'transition:transform .15s ease'
    ].join(';');
    /* Tiny 4-dot grip icon */
    h.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.3"/><circle cx="9" cy="3" r="1.3"/><circle cx="3" cy="9" r="1.3"/><circle cx="9" cy="9" r="1.3"/></svg>';
    document.body.appendChild(h);
    return h;
  }

  /* Place handle adjacent to (left of) the chat button so it never overlaps
     the click target. */
  function positionHandle(handle, chatEl) {
    var r = chatEl.getBoundingClientRect();
    var top  = r.top + (r.height - HANDLE_SIZE) / 2;
    var left = r.left - HANDLE_SIZE - HANDLE_GAP;
    /* If the handle would render off-screen left, flip to the right side. */
    if (left < 4) left = r.right + HANDLE_GAP;
    handle.style.left = left + 'px';
    handle.style.top  = top + 'px';
  }

  function attach(chatEl, handle) {
    if (chatEl.dataset.apgoChatDragBound) return;
    chatEl.dataset.apgoChatDragBound = '1';

    applySaved(chatEl);
    positionHandle(handle, chatEl);

    /* Keep the handle glued to the chat button whenever the chat widget moves
       or resizes itself. Three signals together cover practically every case:
         - ResizeObserver: chat changes size on hover/open/close
         - scroll: chat is fixed but the viewport edge moves on iOS rubber-band
         - rAF tick at 5fps: catches widgets that imperatively rewrite top/left
           in their own animation loop without dispatching events
    */
    if (window.ResizeObserver) {
      new ResizeObserver(function () { positionHandle(handle, chatEl); }).observe(chatEl);
    }
    window.addEventListener('scroll', function () { positionHandle(handle, chatEl); }, { passive: true });
    (function tick() {
      positionHandle(handle, chatEl);
      setTimeout(function () { requestAnimationFrame(tick); }, 200);
    })();

    /* Drag handlers — bound to the HANDLE (parent-page element), so no
       cross-iframe event-swallowing issues. */
    var startX = 0, startY = 0, origLeft = 0, origTop = 0, dragging = false;

    function onStart(e) {
      var t = e.touches ? e.touches[0] : e;
      var r = chatEl.getBoundingClientRect();
      startX = t.clientX; startY = t.clientY;
      origLeft = r.left; origTop = r.top;
      dragging = true;
      handle.style.cursor = 'grabbing';
      if (e.cancelable) e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      var t = e.touches ? e.touches[0] : e;
      if (e.cancelable) e.preventDefault();
      var r = chatEl.getBoundingClientRect();
      var c = clamp(origLeft + (t.clientX - startX), origTop + (t.clientY - startY), r.width, r.height);
      applyChatPos(chatEl, c.left, c.top);
      positionHandle(handle, chatEl);
    }
    function onEnd() {
      if (!dragging) return;
      dragging = false;
      handle.style.cursor = 'grab';
      var r = chatEl.getBoundingClientRect();
      writeSavedPos({ left: r.left, top: r.top });
    }

    handle.addEventListener('mousedown',  onStart);
    handle.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup',   onEnd);
    document.addEventListener('touchend',  onEnd);
    document.addEventListener('touchcancel', onEnd);
  }

  /* Find chat → create handle once → attach. Re-runs as the DOM mutates so
     late-mounted chat widgets are picked up. */
  var handleEl = null;
  function tryBind() {
    var chatEl = findChatEl();
    if (!chatEl) return;
    if (!handleEl) handleEl = createHandle();
    attach(chatEl, handleEl);
  }
  tryBind();

  if (typeof MutationObserver === 'function') {
    new MutationObserver(tryBind).observe(document.body, { childList: true, subtree: true });
  }

  /* Re-clamp + re-place on viewport resize / orientation change */
  window.addEventListener('resize', function () {
    var chatEl = findChatEl();
    if (!chatEl) return;
    applySaved(chatEl);
    if (handleEl) positionHandle(handleEl, chatEl);
  });
})();
