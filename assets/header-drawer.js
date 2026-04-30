import { Component } from '@theme/component';
import { trapFocus, removeTrapFocus } from '@theme/focus';
import { onAnimationEnd } from '@theme/utilities';

/**
 * @param {Element} drawerHost - <header-drawer> root
 */
function resetAllOpenDrawerDetails(drawerHost) {
  if (!(drawerHost instanceof Element)) return;
  drawerHost.querySelectorAll('details[open]').forEach(reset);
}

let apgoHeaderDrawerPageshowHooked = false;
function hookPageshowForceCloseMenus() {
  if (apgoHeaderDrawerPageshowHooked) return;
  apgoHeaderDrawerPageshowHooked = true;
  window.addEventListener(
    'pageshow',
    () => {
      document.querySelectorAll('header-drawer').forEach(resetAllOpenDrawerDetails);
      removeTrapFocus();
      document.documentElement.removeAttribute('scroll-lock');
    },
    false
  );
}

/**
 * A custom element that manages the main menu drawer.
 *
 * @typedef {object} Refs
 * @property {HTMLDetailsElement} details - The details element.
 *
 * @extends {Component<Refs>}
 */
class HeaderDrawer extends Component {
  requiredRefs = ['details'];

  connectedCallback() {
    super.connectedCallback();

    hookPageshowForceCloseMenus();

    this.addEventListener('keyup', this.#onKeyUp);
    this.addEventListener('click', this.#onCapturedLinkClick, true);
    this.#setupAnimatedElementListeners();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('keyup', this.#onKeyUp);
    this.removeEventListener('click', this.#onCapturedLinkClick, true);
  }

  /**
   * 離開／換頁前立即關閉（不依賴 onAnimationEnd；避免 View Transitions / BFCache 帶著 open 到新頁看起來像自動彈出）
   */
  forceCloseImmediately() {
    resetAllOpenDrawerDetails(this);
    removeTrapFocus();
    document.documentElement.removeAttribute('scroll-lock');
  }

  /** @param {MouseEvent} e */
  #onCapturedLinkClick = (e) => {
    const t = /** @type {Element | null} */ (e.target instanceof Element ? e.target : null);
    if (!t) return;
    const anchor = /** @type {HTMLAnchorElement | null} */ (t.closest('a'));
    if (!anchor || !this.contains(anchor)) return;

    if (anchor.getAttribute('role') === 'button') return;
    const hrefRaw = anchor.getAttribute('href');
    if (!hrefRaw || hrefRaw.startsWith('#') || hrefRaw === '#' || /^javascript\s*:/i.test(hrefRaw)) return;

    const hasModifier =
      e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
    if (hasModifier) return;
    if ((anchor.target && anchor.target !== '') || anchor.download) return;

    this.forceCloseImmediately();
  };

  /**
   * Close the main menu drawer when the Escape key is pressed
   * @param {KeyboardEvent} event
   */
  #onKeyUp = (event) => {
    if (event.key !== 'Escape') return;

    this.#close(this.#getDetailsElement(event));
  };

  /**
   * @returns {boolean} Whether the main menu drawer is open
   */
  get isOpen() {
    return this.refs.details.hasAttribute('open');
  }

  /**
   * Get the closest details element to the event target
   * @param {Event | undefined} event
   * @returns {HTMLDetailsElement}
   */
  #getDetailsElement(event) {
    if (!(event?.target instanceof Element)) return this.refs.details;

    return event.target.closest('details') ?? this.refs.details;
  }

  /**
   * Toggle the main menu drawer
   */
  toggle() {
    return this.isOpen ? this.close() : this.open();
  }

  /**
   * Open the closest drawer or the main menu drawer
   * @param {Event} [event]
   */
  open(event) {
    const details = this.#getDetailsElement(event);
    const summary = details.querySelector('summary');

    if (!summary) return;

    summary.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => details.classList.add('menu-open'));

    this.#injectApgoFooterStripOnce();

    trapFocus(details);
  }

  /**
   * 將 APGO-footer 輸出的 template（品牌＋付款條）克隆到手機選單底部（Liquid 無法跨 section 讀設定）。
   */
  #injectApgoFooterStripOnce() {
    const root = this.querySelector('[data-apgo-drawer-footer-mount]');
    if (!root || root.dataset.apgoInjected === '1') return;

    const tpl = document.querySelector('template[id^="apgo-footer-drawer-strip--"]');
    if (!tpl?.content?.firstElementChild) return;

    root.appendChild(tpl.content.cloneNode(true));
    root.dataset.apgoInjected = '1';
  }

  /**
   * Go back or close the main menu drawer
   * @param {Event} [event]
   */
  back(event) {
    this.#close(this.#getDetailsElement(event));
  }

  /**
   * Close the main menu drawer
   */
  close() {
    this.#close(this.refs.details);
  }

  /**
   * Close the closest menu or submenu that is open
   *
   * @param {HTMLDetailsElement} details
   */
  #close(details) {
    const summary = details.querySelector('summary');

    if (!summary) return;

    summary.setAttribute('aria-expanded', 'false');
    details.classList.remove('menu-open');

    onAnimationEnd(details, () => {
      reset(details);

      if (details === this.refs.details) {
        removeTrapFocus();
        const openDetails = this.querySelectorAll('details[open]');
        openDetails.forEach(reset);
      } else {
        trapFocus(this.refs.details);
      }
    });
  }

  /**
   * Attach animationend event listeners to all animated elements to remove will-change after animation
   * to remove the stacking context and allow submenus to be positioned correctly
   */
  #setupAnimatedElementListeners() {
    /**
     * @param {AnimationEvent} event
     */
    function removeWillChangeOnAnimationEnd(event) {
      const target = event.target;
      if (target && target instanceof HTMLElement) {
        target.style.setProperty('will-change', 'unset');
        target.removeEventListener('animationend', removeWillChangeOnAnimationEnd);
      }
    }
    const allAnimated = this.querySelectorAll('.menu-drawer__animated-element');
    allAnimated.forEach((element) => {
      element.addEventListener('animationend', removeWillChangeOnAnimationEnd);
    });
  }
}

if (!customElements.get('header-drawer')) {
  customElements.define('header-drawer', HeaderDrawer);
}

/**
 * Reset an open details element to its original state
 *
 * @param {HTMLDetailsElement} element
 */
function reset(element) {
  element.classList.remove('menu-open');
  element.removeAttribute('open');
  element.querySelector('summary')?.setAttribute('aria-expanded', 'false');
}
