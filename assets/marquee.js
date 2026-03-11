import { Component } from '@theme/component';
import { debounce } from '@theme/utilities';

const ANIMATION_OPTIONS = {
  duration: 500,
};

/**
 * A custom element that displays a marquee.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} wrapper - The wrapper element.
 * @property {HTMLElement} content - The content element.
 *
 * @extends Component<Refs>
 */
class MarqueeComponent extends Component {
  requiredRefs = ['wrapper', 'content'];

  connectedCallback() {
    super.connectedCallback();

    const { content } = this.refs;
    if (content.firstElementChild?.children.length === 0) return;

    // #region agent log
    const promoItemPre = content.querySelector('.marquee__promo-item');
    const promoFlagSvgPre = content.querySelector('.marquee__promo-flag svg');
    fetch('http://127.0.0.1:7569/ingest/af330cb5-58ca-4b18-a766-23106eb80d3d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b4045b'},body:JSON.stringify({sessionId:'b4045b',runId:'run1',hypothesisId:'H1',location:'assets/marquee.js:connectedCallback.beforeOps',message:'Promo DOM before marquee operations',data:{promoItemExists:!!promoItemPre,promoSvgExists:!!promoFlagSvgPre,promoText:promoItemPre?.textContent?.trim()?.slice(0,120)||'',promoHtmlSnippet:promoItemPre?.innerHTML?.slice(0,200)||''},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    this.#addRepeatedItems();
    this.#duplicateContent();
    this.#setSpeed();

    // #region agent log
    const promoItemPost = this.refs.content.querySelector('.marquee__promo-item');
    const promoFlagSvgPost = this.refs.content.querySelector('.marquee__promo-flag svg');
    const promoFlagElPost = this.refs.content.querySelector('.marquee__promo-flag');
    const flagRect = promoFlagElPost?.getBoundingClientRect?.();
    const flagStyle = promoFlagElPost ? window.getComputedStyle(promoFlagElPost) : null;
    fetch('http://127.0.0.1:7569/ingest/af330cb5-58ca-4b18-a766-23106eb80d3d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b4045b'},body:JSON.stringify({sessionId:'b4045b',runId:'run1',hypothesisId:'H2',location:'assets/marquee.js:connectedCallback.afterOps',message:'Promo DOM after add/duplicate/speed',data:{promoItemExists:!!promoItemPost,promoSvgExists:!!promoFlagSvgPost,promoFlagsCount:this.refs.content.querySelectorAll('.marquee__promo-flag').length,flagDisplay:flagStyle?.display||'',flagVisibility:flagStyle?.visibility||'',flagWidth:flagStyle?.width||'',flagHeight:flagStyle?.height||'',flagRectWidth:flagRect?.width||0,flagRectHeight:flagRect?.height||0},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    window.addEventListener('resize', this.#handleResize);
    this.addEventListener('pointerenter', this.#slowDown);
    this.addEventListener('pointerleave', this.#speedUp);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.#handleResize);
    this.removeEventListener('pointerenter', this.#slowDown);
    this.removeEventListener('pointerleave', this.#speedUp);
  }

  /**
   * @type {{ cancel: () => void, current: number } | null}
   */
  #animation = null;

  #slowDown = debounce(() => {
    if (this.#animation) return;

    const animation = this.refs.wrapper.getAnimations()[0];

    if (!animation) return;

    this.#animation = animateValue({
      ...ANIMATION_OPTIONS,
      from: 1,
      to: 0,
      onUpdate: (value) => animation.updatePlaybackRate(value),
      onComplete: () => {
        this.#animation = null;
      },
    });
  }, ANIMATION_OPTIONS.duration);

  #speedUp() {
    this.#slowDown.cancel();

    const animation = this.refs.wrapper.getAnimations()[0];

    if (!animation || animation.playbackRate === 1) return;

    const from = this.#animation?.current ?? 0;
    this.#animation?.cancel();

    this.#animation = animateValue({
      ...ANIMATION_OPTIONS,
      from,
      to: 1,
      onUpdate: (value) => animation.updatePlaybackRate(value),
      onComplete: () => {
        this.#animation = null;
      },
    });
  }

  get clonedContent() {
    const { content, wrapper } = this.refs;
    const lastChild = wrapper.lastElementChild;

    return content !== lastChild ? lastChild : null;
  }

  #setSpeed(value = this.#calculateSpeed()) {
    this.style.setProperty('--marquee-speed', `${value}s`);
  }

  #calculateSpeed() {
    const speedFactor = Number(this.getAttribute('data-speed-factor'));
    const marqueeWidth = this.offsetWidth;
    const speed = Math.ceil(marqueeWidth / speedFactor / 2);
    return speed;
  }

  #handleResize = debounce(() => {
    const { content } = this.refs;
    const newNumberOfCopies = this.#calculateNumberOfCopies();
    const currentNumberOfCopies = content.children.length;

    if (newNumberOfCopies > currentNumberOfCopies) {
      this.#addRepeatedItems(newNumberOfCopies - currentNumberOfCopies);
    } else if (newNumberOfCopies < currentNumberOfCopies) {
      this.#removeRepeatedItems(currentNumberOfCopies - newNumberOfCopies);
    }

    this.#duplicateContent();
    this.#setSpeed();
    this.#restartAnimation();
  }, 250);

  #restartAnimation() {
    const animations = this.refs.wrapper.getAnimations();

    requestAnimationFrame(() => {
      for (const animation of animations) {
        animation.currentTime = 0;
      }
    });
  }

  #duplicateContent() {
    this.clonedContent?.remove();

    const clone = /** @type {HTMLElement} */ (this.refs.content.cloneNode(true));

    clone.setAttribute('aria-hidden', 'true');
    clone.removeAttribute('ref');

    this.refs.wrapper.appendChild(clone);

    // #region agent log
    const clonePromoSvg = clone.querySelector('.marquee__promo-flag svg');
    const clonePromoText = clone.querySelector('.marquee__promo-item')?.textContent?.trim()?.slice(0,120) || '';
    fetch('http://127.0.0.1:7569/ingest/af330cb5-58ca-4b18-a766-23106eb80d3d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b4045b'},body:JSON.stringify({sessionId:'b4045b',runId:'run1',hypothesisId:'H3',location:'assets/marquee.js:duplicateContent',message:'Cloned content promo snapshot',data:{clonePromoSvgExists:!!clonePromoSvg,clonePromoText},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }

  #addRepeatedItems(numberOfCopies = this.#calculateNumberOfCopies()) {
    const { content } = this.refs;
    const wrapper = content.firstElementChild;

    if (!wrapper) return;

    for (let i = 0; i < numberOfCopies - 1; i++) {
      const clone = wrapper.cloneNode(true);
      content.appendChild(clone);
    }
  }

  #removeRepeatedItems(numberOfCopies = this.#calculateNumberOfCopies()) {
    const { content } = this.refs;

    for (let i = 0; i < numberOfCopies; i++) {
      content.lastElementChild?.remove();
    }
  }

  #calculateNumberOfCopies() {
    const { content } = this.refs;
    const marqueeWidth = this.offsetWidth;
    const marqueeRepeatedItemWidth =
      content.firstElementChild instanceof HTMLElement ? content.firstElementChild.offsetWidth : 1;

    return marqueeRepeatedItemWidth === 0 ? 1 : Math.ceil(marqueeWidth / marqueeRepeatedItemWidth);
  }
}

// Define the animateValue function
/**
 * Animate a numeric property smoothly.
 * @param {Object} params - The parameters for the animation.
 * @param {number} params.from - The starting value.
 * @param {number} params.to - The ending value.
 * @param {number} params.duration - The duration of the animation in milliseconds.
 * @param {function(number): void} params.onUpdate - The function to call on each update.
 * @param {function(number): number} [params.easing] - The easing function.
 * @param {function(): void} [params.onComplete] - The function to call when the animation completes.
 */
function animateValue({ from, to, duration, onUpdate, easing = (t) => t * t * (3 - 2 * t), onComplete }) {
  const startTime = performance.now();
  let cancelled = false;
  let currentValue = from;

  /**
   * @param {number} currentTime - The current time in milliseconds.
   */
  function animate(currentTime) {
    if (cancelled) return;

    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easedProgress = easing(progress);
    currentValue = from + (to - from) * easedProgress;

    onUpdate(currentValue);

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else if (typeof onComplete === 'function') {
      onComplete();
    }
  }

  requestAnimationFrame(animate);

  return {
    get current() {
      return currentValue;
    },
    cancel() {
      cancelled = true;
    },
  };
}

if (!customElements.get('marquee-component')) {
  customElements.define('marquee-component', MarqueeComponent);
}
