/* APGO — Pin chat button to the top-left corner
 *
 * Shopify Inbox / third-party chat apps only let admins pick 4 corner presets
 * via their own UI. We want it pinned at top-left always.
 *
 * Strategy: find the chat element (any of several common selectors, plus a
 * heuristic fallback for small fixed iframes near the viewport edges), then
 * pin its position with !important inline styles so the widget's own JS can't
 * override. A MutationObserver watches for late mounts / re-renders and
 * re-applies on every mutation. A 5fps rAF tick is a backup for widgets that
 * imperatively rewrite top/left in their own animation loop.
 *
 * Offsets are deliberately conservative so the button doesn't clash with the
 * header sticky strip or the safe-area inset on notched phones.
 */
(function () {
  'use strict';

  var POS = {
    /* px offsets from the top-left corner; respects iOS safe-area-inset-top */
    top: 12,
    left: 12
  };

  /* Common selectors for various chat widgets — first match wins per page. */
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

  /* Heuristic: small fixed/absolute iframe (≤120px) near a viewport edge. */
  function heuristicChatEl() {
    var nodes = document.querySelectorAll('iframe');
    for (var i = 0; i < nodes.length; i++) {
      var f = nodes[i];
      var cs = window.getComputedStyle(f);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      var r = f.getBoundingClientRect();
      if (r.width <= 0 || r.width > 120 || r.height <= 0 || r.height > 120) continue;
      /* Within 200px of any viewport edge (chat typically lives at a corner) */
      var nearBottom = window.innerHeight - r.bottom < 200;
      var nearTop    = r.top < 200;
      var nearRight  = window.innerWidth  - r.right  < 200;
      var nearLeft   = r.left < 200;
      if (nearBottom || nearTop || nearRight || nearLeft) return f;
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

  /*
    Pin to top-left with !important so widget JS can't override.
    Honour env(safe-area-inset-top) via a calc() string so notched phones
    push the button below the status bar.
  */
  function pinTopLeft(el) {
    el.style.setProperty('top',    'calc(' + POS.top + 'px + env(safe-area-inset-top, 0px))', 'important');
    el.style.setProperty('left',   POS.left + 'px', 'important');
    el.style.setProperty('right',  'auto', 'important');
    el.style.setProperty('bottom', 'auto', 'important');
    el.style.setProperty('position', 'fixed', 'important');
  }

  function tryPin() {
    var el = findChatEl();
    if (!el) return;
    pinTopLeft(el);
  }

  /* Initial pass */
  tryPin();

  /* Keep watching for late mounts / re-renders */
  if (typeof MutationObserver === 'function') {
    new MutationObserver(tryPin).observe(document.body, { childList: true, subtree: true });
  }

  /* Backup tick — some widgets rewrite their own top/left every animation
     frame. Re-applying at 5fps is cheap and guarantees the position holds. */
  (function tick() {
    tryPin();
    setTimeout(function () { requestAnimationFrame(tick); }, 200);
  })();

  /* Re-pin on resize / orientation change */
  window.addEventListener('resize', tryPin);
})();
