/**
 * APGO Tactical Collection — Grid Switcher
 * Runs only on pages that have .apgo-tac-grid-switcher present.
 */
(function () {
  const init = () => {
    const switcher = document.getElementById('apgo-tac-switcher');
    if (!switcher) return;

    // Target the live product-grid; re-query after AJAX pagination updates it.
    const getGrid = () =>
      document.querySelector('.main-collection-zgrid ul.product-grid');

    const applyLayout = (cols) => {
      const grid = getGrid();
      if (!grid) return;
      if (cols === '2') {
        grid.removeAttribute('data-tac-cols');
      } else {
        grid.setAttribute('data-tac-cols', cols);
      }
    };

    switcher.querySelectorAll('.apgo-tac-sw-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cols = btn.dataset.cols;

        // Update button active state
        switcher
          .querySelectorAll('.apgo-tac-sw-btn')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        applyLayout(cols);

        // Persist across AJAX page loads
        try {
          sessionStorage.setItem('apgo-tac-cols', cols);
        } catch (_) {}

        if (navigator.vibrate) navigator.vibrate(12);
      });
    });

    // Restore saved layout on load
    try {
      const saved = sessionStorage.getItem('apgo-tac-cols');
      if (saved && saved !== '2') {
        const btn = switcher.querySelector(`[data-cols="${saved}"]`);
        if (btn) {
          switcher
            .querySelectorAll('.apgo-tac-sw-btn')
            .forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          applyLayout(saved);
        }
      }
    } catch (_) {}

    // Re-apply grid cols after Shopify AJAX pagination replaces the grid DOM
    document.addEventListener('results-list:updated', () => {
      try {
        const saved = sessionStorage.getItem('apgo-tac-cols');
        if (saved && saved !== '2') applyLayout(saved);
      } catch (_) {}
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
