(function () {
  'use strict';

  if (window.apgoCampaignTrackingLoaded) return;
  window.apgoCampaignTrackingLoaded = true;

  var campaignId = 'golden_bull_award';
  var entryStorageKey = 'apgo_campaign_entry';
  var publishQueue = [];
  var publishAttempts = 0;
  var publishTimer = null;
  var gaQueue = [];
  var gaAttempts = 0;
  var gaTimer = null;

  function compact(payload) {
    var result = {};
    Object.keys(payload || {}).forEach(function (key) {
      var value = payload[key];
      if (value !== undefined && value !== null && value !== '') {
        result[key] = value;
      }
    });
    return result;
  }

  function flushQueue() {
    var analytics = window.Shopify && window.Shopify.analytics;
    if (analytics && typeof analytics.publish === 'function') {
      var queued = publishQueue.splice(0);
      queued.forEach(function (item) {
        try {
          var published = analytics.publish(item.name, item.data);
          if (published && typeof published.catch === 'function') {
            published.catch(function () {});
          }
        } catch (error) {}
      });
      publishAttempts = 0;
      publishTimer = null;
      return;
    }

    publishAttempts += 1;
    if (publishAttempts < 30 && publishQueue.length > 0) {
      publishTimer = window.setTimeout(flushQueue, 200);
    } else {
      publishQueue.length = 0;
      publishTimer = null;
    }
  }

  function publish(name, data) {
    var payload = compact(Object.assign({
      campaign_id: campaignId,
      page_path: window.location.pathname,
      page_location: window.location.href
    }, data || {}));

    publishQueue.push({ name: name, data: payload });
    if (!publishTimer) flushQueue();
    queueGaEvent(name, payload);

    try {
      window.dispatchEvent(new CustomEvent('apgo:campaign-event', {
        detail: { name: name, data: payload }
      }));
    } catch (error) {}
  }

  function gaEvent(name, payload) {
    var params = Object.assign({}, payload);
    var eventName = name;

    if (name === 'apgo_promotion_view') {
      eventName = 'view_promotion';
      params.creative_name = payload.promotion_name;
      params.creative_slot = payload.section_id;
    } else if (name === 'apgo_promotion_click') {
      eventName = 'select_promotion';
      params.creative_name = payload.promotion_name;
      params.creative_slot = payload.section_id || 'hero';
    } else if (name === 'apgo_product_click') {
      eventName = 'select_item';
      params.item_list_id = payload.section_id;
      params.item_list_name = payload.section_name;
      params.items = [{
        item_id: payload.product_id,
        item_name: payload.product_name,
        item_variant: payload.variant_id,
        index: payload.card_position
      }];
    }

    return { name: eventName, params: compact(params) };
  }

  function flushGaQueue() {
    if (typeof window.gtag === 'function') {
      var queued = gaQueue.splice(0);
      queued.forEach(function (item) {
        try {
          window.gtag('event', item.name, item.params);
        } catch (error) {}
      });
      gaAttempts = 0;
      gaTimer = null;
      return;
    }

    gaAttempts += 1;
    if (gaAttempts < 50 && gaQueue.length > 0) {
      gaTimer = window.setTimeout(flushGaQueue, 200);
    } else {
      gaQueue.length = 0;
      gaTimer = null;
    }
  }

  function queueGaEvent(name, payload) {
    gaQueue.push(gaEvent(name, payload));
    if (!gaTimer) flushGaQueue();
  }

  function writeEntrySource(source, placement) {
    try {
      window.sessionStorage.setItem(entryStorageKey, JSON.stringify({
        source: source,
        placement: placement,
        timestamp: Date.now()
      }));
    } catch (error) {}
  }

  function readEntrySource() {
    try {
      var raw = window.sessionStorage.getItem(entryStorageKey);
      if (!raw) return {};
      window.sessionStorage.removeItem(entryStorageKey);
      var stored = JSON.parse(raw);
      if (!stored || Date.now() - stored.timestamp > 30 * 60 * 1000) return {};
      return {
        entry_source: stored.source,
        entry_placement: stored.placement
      };
    } catch (error) {
      return {};
    }
  }

  function getCampaignContext(root) {
    return {
      market: root.getAttribute('data-market'),
      currency: root.getAttribute('data-currency')
    };
  }

  function getSectionContext(element) {
    var section = element && element.closest
      ? element.closest('[data-apgo-campaign-section]')
      : null;
    return {
      section_id: section && section.getAttribute('data-section-id'),
      section_name: section && section.getAttribute('data-section-name'),
      section_position: section && Number(section.getAttribute('data-section-position'))
    };
  }

  function getProductContext(element) {
    var card = element && element.closest
      ? element.closest('.apgo-event-listing-card')
      : null;
    if (!card) {
      var linkedZone = element && element.closest
        ? element.closest('.apgo-event-linked-banner-zone')
        : null;
      return {
        product_id: linkedZone && linkedZone.getAttribute('data-product-id'),
        product_name: linkedZone && linkedZone.getAttribute('data-product-name'),
        product_handle: linkedZone && linkedZone.getAttribute('data-product-handle'),
        variant_id: element && element.getAttribute
          ? element.getAttribute('data-variant-id')
          : null
      };
    }
    return {
      product_id: card.getAttribute('data-product-id'),
      product_name: card.getAttribute('data-product-name'),
      product_handle: card.getAttribute('data-product-handle'),
      variant_id: card.getAttribute('data-variant-id'),
      card_position: Number(card.getAttribute('data-card-position'))
    };
  }

  function initHomepageLinks(scope) {
    var links = scope.querySelectorAll('[data-apgo-homepage-campaign-link]');
    Array.prototype.forEach.call(links, function (link) {
      if (link.getAttribute('data-apgo-tracking-ready') === 'true') return;
      link.setAttribute('data-apgo-tracking-ready', 'true');
      link.addEventListener('click', function () {
        var placement = link.getAttribute('data-campaign-placement') || 'homepage_carousel';
        writeEntrySource('homepage_carousel', placement);
        publish('apgo_homepage_campaign_click', {
          source: 'homepage',
          placement: placement,
          slide_position: Number(link.getAttribute('data-slide-position')),
          destination_path: link.getAttribute('href')
        });
      });
    });
  }

  function initSectionViews(root, context) {
    var sections = root.querySelectorAll('[data-apgo-campaign-section]');
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(sections, function (section) {
        publish('apgo_promotion_view', Object.assign({}, context, getSectionContext(section), {
          promotion_id: section.getAttribute('data-promotion-id'),
          promotion_name: section.getAttribute('data-section-name')
        }));
      });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.5) return;
        var section = entry.target;
        if (section.getAttribute('data-apgo-view-recorded') === 'true') return;
        section.setAttribute('data-apgo-view-recorded', 'true');
        publish('apgo_promotion_view', Object.assign({}, context, getSectionContext(section), {
          promotion_id: section.getAttribute('data-promotion-id'),
          promotion_name: section.getAttribute('data-section-name')
        }));
        observer.unobserve(section);
      });
    }, { threshold: [0.5] });

    Array.prototype.forEach.call(sections, function (section) {
      observer.observe(section);
    });
  }

  function initCarouselTracking(root, context) {
    var viewports = root.querySelectorAll('[data-apgo-scroll-viewport]');
    Array.prototype.forEach.call(viewports, function (viewport) {
      if (viewport.getAttribute('data-apgo-campaign-ready') === 'true') return;
      var track = viewport.querySelector('[data-apgo-scroll-track]');
      if (!track) return;

      viewport.setAttribute('data-apgo-campaign-ready', 'true');
      var sectionContext = getSectionContext(viewport);
      var cardsTotal = track.querySelectorAll('.apgo-event-scroll-zone__card').length;
      var milestones = [25, 50, 75, 100];
      var recorded = {};
      var started = false;
      var inputMethod = '';
      var initialScrollLeft = track.scrollLeft;
      var frame = 0;

      function recordStart(method) {
        if (started) return;
        started = true;
        publish('apgo_carousel_start', Object.assign({}, context, sectionContext, {
          input_method: method || 'scroll',
          cards_total: cardsTotal
        }));
      }

      function recordProgress() {
        frame = 0;
        var maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
        if (maxScroll <= 8) return;
        var distance = Math.abs(track.scrollLeft - initialScrollLeft);
        if (distance > 4) recordStart(inputMethod || 'scroll');
        var percent = Math.min(100, Math.max(0, Math.round((track.scrollLeft / maxScroll) * 100)));

        milestones.forEach(function (milestone) {
          if (percent < milestone || recorded[milestone]) return;
          recorded[milestone] = true;
          publish('apgo_carousel_progress', Object.assign({}, context, sectionContext, {
            progress_percent: milestone,
            input_method: inputMethod || 'scroll',
            cards_total: cardsTotal
          }));
          if (milestone === 100) {
            publish('apgo_carousel_complete', Object.assign({}, context, sectionContext, {
              input_method: inputMethod || 'scroll',
              cards_total: cardsTotal
            }));
          }
        });
      }

      track.addEventListener('pointerdown', function (event) {
        inputMethod = event.pointerType === 'touch' ? 'swipe' : 'drag';
        initialScrollLeft = track.scrollLeft;
      }, { passive: true });
      track.addEventListener('touchstart', function () {
        inputMethod = 'swipe';
        initialScrollLeft = track.scrollLeft;
      }, { passive: true });
      track.addEventListener('wheel', function () {
        inputMethod = 'wheel';
        initialScrollLeft = track.scrollLeft;
      }, { passive: true });
      track.addEventListener('scroll', function () {
        if (!frame) frame = window.requestAnimationFrame(recordProgress);
      }, { passive: true });

      var previousButton = viewport.querySelector('[data-apgo-scroll-previous]');
      var nextButton = viewport.querySelector('[data-apgo-scroll-next]');
      [
        { button: previousButton, direction: 'previous' },
        { button: nextButton, direction: 'next' }
      ].forEach(function (control) {
        if (!control.button) return;
        control.button.addEventListener('click', function () {
          inputMethod = control.direction + '_arrow';
          initialScrollLeft = track.scrollLeft;
          recordStart(inputMethod);
          publish('apgo_carousel_arrow_click', Object.assign({}, context, sectionContext, {
            direction: control.direction,
            cards_total: cardsTotal
          }));
        });
      });
    });
  }

  function initCampaignClicks(root, context) {
    document.addEventListener('click', function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;

      var promotionLink = target.closest('[data-apgo-campaign-promotion-link]');
      if (promotionLink) {
        publish('apgo_promotion_click', Object.assign(
          {},
          context,
          getSectionContext(promotionLink),
          getProductContext(promotionLink),
          {
            promotion_id: promotionLink.getAttribute('data-promotion-id'),
            promotion_name: promotionLink.getAttribute('data-promotion-name'),
            destination_path: promotionLink.getAttribute('href')
          }
        ));
        return;
      }

      var cta = target.closest(
        '.apgo-event-listing-card__btn--add,' +
        '.apgo-event-listing-card__btn--buy,' +
        '.apgo-event-featured-banner__btn--add,' +
        '.apgo-event-featured-banner__btn--buy,' +
        '.apgo-event-linked-banner-zone__button--add,' +
        '.apgo-event-linked-banner-zone__button--buy'
      );
      if (cta) {
        var ctaType = cta.className.indexOf('--buy') !== -1 ? 'buy_now' : 'add_to_cart';
        publish('apgo_campaign_cta_click', Object.assign(
          {},
          context,
          getSectionContext(cta),
          getProductContext(cta),
          { cta_type: ctaType }
        ));
        return;
      }

      var productLink = target.closest('.apgo-event-listing-card a');
      if (productLink) {
        publish('apgo_product_click', Object.assign(
          {},
          context,
          getSectionContext(productLink),
          getProductContext(productLink),
          { destination_path: productLink.getAttribute('href') }
        ));
      }
    });

    window.addEventListener('apgo:cart-error', function (event) {
      publish('apgo_cart_error', Object.assign({}, context, event.detail || {}));
    });
  }

  function initCampaignPage(scope) {
    var root = scope.querySelector('[data-apgo-campaign-root]');
    if (!root || root.getAttribute('data-apgo-campaign-initialized') === 'true') return;
    root.setAttribute('data-apgo-campaign-initialized', 'true');

    var context = getCampaignContext(root);
    publish('apgo_campaign_view', Object.assign(
      {},
      context,
      readEntrySource(),
      { page_referrer: document.referrer }
    ));
    initSectionViews(root, context);
    initCarouselTracking(root, context);
    initCampaignClicks(root, context);
  }

  function init(scope) {
    var target = scope && scope.querySelectorAll ? scope : document;
    initHomepageLinks(target);
    initCampaignPage(target);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init(document);
    });
  } else {
    init(document);
  }

  document.addEventListener('shopify:section:load', function (event) {
    init(event.target);
  });
})();
