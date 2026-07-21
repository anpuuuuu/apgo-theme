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

  /* Run-once guard: the file is loaded from layout/theme.liquid, but this
     keeps a stray duplicate include from setting up a second set of
     observers and listeners. */
  if (window.__apgoHomeBooted) return;
  window.__apgoHomeBooted = true;

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
    if (el.dataset.apgoCounted) return;
    var to = parseFloat(el.dataset.apgoCountTo || '0');
    if (reducedMotion || !to) {
      el.dataset.apgoCounted = '1';
      el.textContent = formatCount(to);
      return;
    }
    var duration = 1400;
    var start = null;
    function step(ts) {
      if (el.dataset.apgoCounted) return;
      if (start === null) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = formatCount(to * eased);
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.dataset.apgoCounted = '1';
      }
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

  /* ── Live proof videos ──
     Autoplay muted + looping while in view (the only autoplay browsers
     allow); sound stays off until the viewer taps the speaker button. */
  var liveAutoplay = !reducedMotion && !saveData;

  function loadLiveSrc(video) {
    if (video.src || !video.dataset.src) return;
    video.preload = 'auto';
    video.src = video.dataset.src + '#t=0.1';
    /* Chrome won't decode a poster frame from metadata alone — nudge a
       seek once metadata arrives so a frame paints even if autoplay is off. */
    video.addEventListener('loadedmetadata', function primeFrame() {
      video.removeEventListener('loadedmetadata', primeFrame);
      if (video.paused) {
        try {
          video.currentTime = 0.101;
        } catch (e) {}
      }
    });
  }

  function playLive(video) {
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
  }

  function setLiveSound(card, unmuted) {
    var video = card.querySelector('video');
    var button = card.querySelector('[data-apgo-live-sound]');
    if (!video) return;
    video.muted = !unmuted;
    card.classList.toggle('is-unmuted', unmuted);
    if (button) {
      button.setAttribute('aria-pressed', unmuted ? 'true' : 'false');
      button.setAttribute('aria-label', unmuted ? 'Turn sound off' : 'Turn sound on');
    }
  }

  /* Bound-node tracking uses a WeakSet, not a data attribute: the theme's
     DOM morphing clones attributes onto fresh nodes, so an attribute flag
     would mark a brand-new (unbound) node as already initialized. */
  var liveBound = typeof WeakSet === 'function' ? new WeakSet() : null;
  var liveObserver = null;

  function getLiveObserver() {
    if (liveObserver || !('IntersectionObserver' in window)) return liveObserver;
    /* One shared, persistent observer: play on enter, pause on leave, every time. */
    liveObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var v = entry.target.querySelector('video');
        if (!v) return;
        if (entry.isIntersecting) {
          loadLiveSrc(v);
          if (liveAutoplay) playLive(v);
        } else if (!v.paused) {
          v.pause();
        }
      });
    }, { threshold: 0.25 });
    return liveObserver;
  }

  function initLiveVideos(root) {
    root.querySelectorAll('[data-apgo-live-video]').forEach(function (card) {
      if (liveBound) {
        if (liveBound.has(card)) return;
        liveBound.add(card);
      } else if (card.dataset.apgoBound) {
        return;
      } else {
        card.dataset.apgoBound = '1';
      }

      var video = card.querySelector('video');
      if (!video) return;

      video.muted = true;
      video.loop = true;
      video.playsInline = true;

      var observer = getLiveObserver();
      if (observer) {
        observer.observe(card);
      } else {
        loadLiveSrc(video);
        if (liveAutoplay) playLive(video);
      }
    });
  }

  /* Clicks are DELEGATED at document level: the theme's page transitions can
     morph #MainContent after init, which keeps attributes (apgoBound survives)
     but strips per-node listeners. Same defense apgo-collection-variant-drawer.js
     uses for its + button. */
  if (!window.__apgoHomeLiveDelegated) {
    window.__apgoHomeLiveDelegated = true;

    /* Media events don't bubble, so these are capture-phase listeners on
       document — same reason as the delegated clicks, they survive DOM
       morphing that would strip per-element listeners. */
    document.addEventListener(
      'playing',
      function (e) {
        var card = e.target && e.target.closest ? e.target.closest('[data-apgo-live-video]') : null;
        if (card) card.classList.add('is-playing');
      },
      true
    );
    document.addEventListener(
      'pause',
      function (e) {
        var card = e.target && e.target.closest ? e.target.closest('[data-apgo-live-video]') : null;
        if (card) card.classList.remove('is-playing');
      },
      true
    );

    document.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;

      var soundButton = e.target.closest('[data-apgo-live-sound]');
      if (soundButton) {
        e.preventDefault();
        var soundCard = soundButton.closest('[data-apgo-live-video]');
        var soundVideo = soundCard && soundCard.querySelector('video');
        if (!soundVideo) return;
        var unmute = soundVideo.muted;
        if (unmute) {
          /* Only one clip may play out loud at a time. */
          document.querySelectorAll('[data-apgo-live-video]').forEach(function (other) {
            if (other !== soundCard) setLiveSound(other, false);
          });
        }
        setLiveSound(soundCard, unmute);
        loadLiveSrc(soundVideo);
        if (soundVideo.paused) playLive(soundVideo);
        return;
      }

      /* Tapping the clip itself is the fallback play control when autoplay
         is unavailable (reduced motion, Save-Data, blocked by the browser). */
      var card = e.target.closest('[data-apgo-live-video]');
      if (!card) return;
      var video = card.querySelector('video');
      if (!video) return;
      loadLiveSrc(video);
      if (video.paused) {
        playLive(video);
      } else {
        video.pause();
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
    document.documentElement.classList.add('apgo-home-js');
    (scope || document).querySelectorAll('[data-apgo-home-section]').forEach(initSection);
    scheduleFailsafe();
  }

  /* Failsafe: if IntersectionObserver / rAF never fire (broken embedder,
     ancient browser), force-reveal everything and finalize counters so the
     page is never left invisible. */
  var failsafeTimer = null;
  function scheduleFailsafe() {
    if (failsafeTimer) clearTimeout(failsafeTimer);
    failsafeTimer = setTimeout(function () {
      document.querySelectorAll('.apgo-home [data-apgo-reveal]:not(.is-revealed)').forEach(function (el) {
        el.classList.add('is-revealed');
      });
      document.querySelectorAll('.apgo-home [data-apgo-count]').forEach(function (el) {
        if (!el.dataset.apgoCounted) {
          el.dataset.apgoCounted = '1';
          el.textContent = formatCount(parseFloat(el.dataset.apgoCountTo || '0'));
        }
      });
    }, 2200);
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

  /* Self-heal after the theme's view transitions swap #MainContent: the
     replacement nodes are new objects, so initAll re-observes them (the
     WeakSet guard keeps already-live cards from being bound twice). */
  if (typeof MutationObserver === 'function' && !window.__apgoHomeMutationBound) {
    window.__apgoHomeMutationBound = true;
    var reinitTimer = null;
    new MutationObserver(function () {
      if (reinitTimer) clearTimeout(reinitTimer);
      reinitTimer = setTimeout(function () {
        initAll(document);
      }, 120);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
