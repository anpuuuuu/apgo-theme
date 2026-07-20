/*
  APGO Homepage — shared behavior for all apgo-home-* sections.

  One file, per-section opt-in via data attributes:
    [data-apgo-home-section]                 section root
    [data-apgo-reveal]                       scroll-in reveal (adds .is-revealed)
    [data-apgo-count][data-apgo-count-to]    animated counter (starts on reveal)
    [data-apgo-hero-video][data-src]         lazy background video, fades in when playing
    [data-apgo-live-video]                   tap-to-play live clip, src injected near viewport

  Re-initializes on shopify:section:load so the Theme Editor stays live.
*/
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var saveData = !!(navigator.connection && navigator.connection.saveData);

  function onIntersect(el, options, callback) {
    if (!('IntersectionObserver' in window)) {
      callback(el);
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          observer.unobserve(entry.target);
          callback(entry.target);
        }
      });
    }, options);
    observer.observe(el);
  }

  /* ── Reveal ── */
  function initReveal(root) {
    root.querySelectorAll('[data-apgo-reveal]').forEach(function (el) {
      if (el.dataset.apgoBound) return;
      el.dataset.apgoBound = '1';
      if (reducedMotion) {
        el.classList.add('is-revealed');
        return;
      }
      onIntersect(el, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }, function (target) {
        target.classList.add('is-revealed');
      });
    });
  }

  /* ── Counters ── */
  function formatCount(value) {
    return Math.round(value).toLocaleString('en-US');
  }

  function animateCount(el) {
    var to = parseFloat(el.dataset.apgoCountTo || '0');
    if (reducedMotion || !to) {
      el.textContent = formatCount(to);
      return;
    }
    var duration = 1400;
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = formatCount(to * eased);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function initCounters(root) {
    root.querySelectorAll('[data-apgo-count]').forEach(function (el) {
      if (el.dataset.apgoBound) return;
      el.dataset.apgoBound = '1';
      onIntersect(el, { threshold: 0.4 }, animateCount);
    });
  }

  /* ── Hero background video ── */
  function initHeroVideo(root) {
    var video = root.querySelector('[data-apgo-hero-video]');
    if (!video || video.dataset.apgoBound) return;
    video.dataset.apgoBound = '1';

    if (reducedMotion || saveData || !video.dataset.src) return;

    var stage = video.closest('.apgo-home-hero__stage');

    function load() {
      if (video.src) return;
      video.src = video.dataset.src;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.addEventListener('playing', function () {
        if (stage) stage.classList.add('is-playing');
      });
      var playPromise = video.play();
      if (playPromise && playPromise.catch) playPromise.catch(function () {});
    }

    if (document.readyState === 'complete') {
      setTimeout(load, 150);
    } else {
      window.addEventListener('load', function () {
        setTimeout(load, 150);
      });
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!video.src) return;
          if (entry.isIntersecting) {
            var p = video.play();
            if (p && p.catch) p.catch(function () {});
          } else {
            video.pause();
          }
        });
      }, { threshold: 0.05 }).observe(video);
    }
  }

  /* ── Live proof videos ── */
  function initLiveVideos(root) {
    root.querySelectorAll('[data-apgo-live-video]').forEach(function (card) {
      if (card.dataset.apgoBound) return;
      card.dataset.apgoBound = '1';

      var video = card.querySelector('video');
      var playButton = card.querySelector('.apgo-home-live__play');
      if (!video) return;

      onIntersect(card, { rootMargin: '200px 0px' }, function () {
        if (!video.src && video.dataset.src) {
          video.preload = 'metadata';
          video.src = video.dataset.src;
        }
      });

      if (playButton) {
        playButton.addEventListener('click', function () {
          if (!video.src && video.dataset.src) video.src = video.dataset.src;
          card.classList.add('is-started');
          video.controls = true;
          video.playsInline = true;
          var p = video.play();
          if (p && p.catch) p.catch(function () {});
        });
      }

      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting && !video.paused) video.pause();
          });
        }, { threshold: 0.1 }).observe(card);
      }
    });
  }

  /* ── Boot ── */
  var initializers = {
    reveal: initReveal,
    counters: initCounters,
    herovideo: initHeroVideo,
    livevideo: initLiveVideos
  };

  function initSection(root) {
    var keys = (root.dataset.apgoHomeInit || '').split(/\s+/);
    keys.forEach(function (key) {
      if (initializers[key]) initializers[key](root);
    });
  }

  function initAll(scope) {
    (scope || document).querySelectorAll('[data-apgo-home-section]').forEach(initSection);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initAll(document);
    });
  } else {
    initAll(document);
  }

  document.addEventListener('shopify:section:load', function (event) {
    initAll(event.target);
  });
})();
