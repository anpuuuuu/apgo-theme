/** UI preview only: no cart writes, price changes, or discount application. */
class ApgoAuroraOffer extends HTMLElement {
  connectedCallback() {
    this.stopTimer();
    const now = Date.now();
    const duration = Number(this.dataset.duration) * 1000;
    let deadline = 0;
    try {
      deadline = Number(sessionStorage.getItem(this.dataset.timerKey));
      if (!Number.isFinite(deadline) || deadline <= 0 || deadline > now + duration) {
        deadline = now + duration;
        sessionStorage.setItem(this.dataset.timerKey, String(deadline));
      }
    } catch {
      deadline = this.deadline || now + duration;
    }
    this.deadline = deadline;
    this.tick = () => {
      const remaining = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
      const minutes = this.querySelector('[data-offer-minutes]');
      const seconds = this.querySelector('[data-offer-seconds]');
      if (minutes) minutes.textContent = String(Math.floor(remaining / 60)).padStart(2, '0');
      if (seconds) seconds.textContent = String(remaining % 60).padStart(2, '0');
      this.toggleAttribute('data-expired', remaining === 0);
      if (remaining === 0) {
        const label = this.querySelector('[data-offer-button-label]');
        if (label) label.textContent = 'Offer expired';
        const timerLabel = this.querySelector('.aurora-offer__timer-label');
        if (timerLabel) timerLabel.textContent = 'Time is up';
        this.stopTimer();
      }
    };
    this.tick();
    if (this.deadline > now) this.timer = window.setInterval(this.tick, 1000);
  }

  disconnectedCallback() {
    this.stopTimer();
  }

  stopTimer() {
    window.clearInterval(this.timer);
  }
}

if (!customElements.get('apgo-aurora-offer')) customElements.define('apgo-aurora-offer', ApgoAuroraOffer);
