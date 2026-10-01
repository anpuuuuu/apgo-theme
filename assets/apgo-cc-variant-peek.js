/*
  APGO PDP (v3) — "selected item" peek above the mobile buy bar.

  Products with many variants push the option chips far below the gallery,
  so on phones the photo is gone while shoppers choose. Once the gallery has
  scrolled off the top, a small card floats above the buy bar with the
  selected variant's photo, name and price; tapping it opens the large photo
  in the page's lightbox.

  Markup + CSS: snippets/apgo-cc-mobile-buybar.liquid (only rendered for
  eligible products, see the Liquid check there). Variant changes come from
  the 'apgo:variantchange' event dispatched at the end of refreshVariant()
  in assets/apgo-cc-pdp-picker.js; a MutationObserver on the price's
  data-cents attribute is the fallback.
*/
(function () {
  'use strict';

  var peek = document.querySelector('[data-apgo-cc-peek]');
  if (!peek) return;

  var btn = peek.querySelector('[data-apgo-cc-peek-open]');
  var img = peek.querySelector('[data-apgo-cc-peek-img]');
  var nameEl = peek.querySelector('[data-apgo-cc-peek-name]');
  var priceEl = peek.querySelector('[data-apgo-cc-peek-price]');
  var compareEl = peek.querySelector('[data-apgo-cc-peek-compare]');
  var buybar = peek.closest('[data-apgo-cc-buybar]');
  var defaultLabel = peek.getAttribute('data-default-label') || 'Standard';

  var byId = {};
  try {
    var json = document.querySelector('script[data-apgo-cc-variants]');
    JSON.parse(json ? json.textContent : '[]').forEach(function (v) { byId[v.id] = v; });
  } catch (e) { return; }

  var current = null;
  var galleryGone = false;
  var openedByPeek = false;

  function withWidth(src, w) {
    if (!src) return '';
    if (src.indexOf('//') === 0) src = 'https:' + src;
    if (/[?&]width=\d+/.test(src)) return src.replace(/([?&])width=\d+/, '$1width=' + w);
    return src + (src.indexOf('?') > -1 ? '&' : '?') + 'width=' + w;
  }

  function imageOf(v) {
    if (v.featured_image && v.featured_image.src) return v.featured_image.src;
    if (v.featured_media && v.featured_media.preview_image && v.featured_media.preview_image.src) {
      return v.featured_media.preview_image.src;
    }
    var first = document.querySelector('#apgoCarouselTrack .apgo-carousel-slide img');
    return first ? (first.currentSrc || first.src) : '';
  }

  function nameOf(v) {
    var n = v.public_title || (v.options || []).join(' / ') || v.title || '';
    return n === 'Default Title' ? defaultLabel : n;
  }

  function money(cents) {
    return window.apgoFormatMoney ? window.apgoFormatMoney(cents) : null;
  }

  function update(v) {
    if (!v) return;
    if (current && current.id === v.id && current.price === v.price) return;

    var name = nameOf(v);
    nameEl.textContent = name;
    btn.setAttribute('aria-label', 'View larger photo: ' + name);

    var thumb = withWidth(imageOf(v), 160);
    if (thumb && img.getAttribute('src') !== thumb) img.setAttribute('src', thumb);

    /* Prices need the page's own formatter (picker.js, RM36.90 / $36.90).
       Before it exists, keep the server-rendered prices and do not mark
       this variant as done, so the picker's first event fills them in. */
    if (!window.apgoFormatMoney) return;
    current = v;
    priceEl.textContent = money(v.price);
    if (v.compare_at_price && v.compare_at_price > v.price) {
      compareEl.textContent = money(v.compare_at_price);
      compareEl.hidden = false;
    } else {
      compareEl.hidden = true;
    }
  }

  function isOpen(el, cls) { return !!(el && el.classList.contains(cls)); }

  function render() {
    var lightbox = document.getElementById('apgoImageLightbox');
    var show = galleryGone &&
      !isOpen(buybar, 'is-open') &&
      !isOpen(document.body, 'apgo-cc-confirm-open') &&
      !isOpen(lightbox, 'active');
    peek.classList.toggle('is-visible', show);
    peek.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (show) peek.removeAttribute('inert'); else peek.setAttribute('inert', '');
    btn.tabIndex = show ? 0 : -1;
    document.body.classList.toggle('apgo-cc-peek-on', show);
  }

  function selectedFromPage() {
    var idInput = document.querySelector('[data-apgo-cc-variant-id]');
    var id = (window.currentVariantId) || (idInput && Number(idInput.value));
    return byId[id];
  }

  /* Variant changes */
  document.addEventListener('apgo:variantchange', function (e) {
    update(e.detail && e.detail.variant ? byId[e.detail.variant.id] || e.detail.variant : selectedFromPage());
  });
  var priceNode = document.querySelector('[data-apgo-cc-price]');
  if (priceNode && 'MutationObserver' in window) {
    new MutationObserver(function () { update(selectedFromPage()); })
      .observe(priceNode, { attributes: true, attributeFilter: ['data-cents'] });
  }

  /* Open / close states that should hide the peek */
  if ('MutationObserver' in window) {
    var stateObserver = new MutationObserver(render);
    if (buybar) stateObserver.observe(buybar, { attributes: true, attributeFilter: ['class'] });
    stateObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    var lightbox = document.getElementById('apgoImageLightbox');
    if (lightbox) {
      new MutationObserver(function () {
        render();
        if (openedByPeek && !lightbox.classList.contains('active')) {
          openedByPeek = false;
          try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); }
        }
      }).observe(lightbox, { attributes: true, attributeFilter: ['class'] });
    }
  }

  /* Tap: large photo */
  btn.addEventListener('click', function () {
    var v = current || selectedFromPage();
    if (!v) return;
    var lightbox = document.getElementById('apgoImageLightbox');
    var large = withWidth(imageOf(v), 1200);
    if (large && lightbox && typeof window.apgoOpenImageLightbox === 'function') {
      var lbImg = document.getElementById('apgoLightboxImage');
      if (lbImg) lbImg.alt = nameOf(v);
      openedByPeek = true;
      window.apgoOpenImageLightbox(large, nameOf(v));
      var close = lightbox.querySelector('.apgo-lightbox-close');
      if (close) { try { close.focus({ preventScroll: true }); } catch (e) { close.focus(); } }
      return;
    }
    var hero = document.querySelector('.apgo-product-section .apgo-hero-visual');
    if (hero) hero.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !openedByPeek) return;
    var lightbox = document.getElementById('apgoImageLightbox');
    if (lightbox && lightbox.classList.contains('active') && typeof window.apgoCloseLightbox === 'function') {
      window.apgoCloseLightbox();
    }
  });

  function start() {
    peek.removeAttribute('hidden');
    update(selectedFromPage());
    var hero = document.querySelector('.apgo-product-section .apgo-hero-visual');
    if (!hero || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      galleryGone = e.boundingClientRect.top < 0 && (!e.isIntersecting || e.intersectionRatio < 0.35);
      render();
    }, { threshold: [0, 0.35] }).observe(hero);
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
