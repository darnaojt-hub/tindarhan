/**
 * ui.js
 * Shared small helpers used across modules: currency formatting, date
 * formatting, HTML escaping, modal open/close, toast notifications, and
 * a promise-based confirm() replacement for the native browser popup.
 */
const UI = (() => {
  function peso(n) {
    const num = Number(n) || 0;
    // Plain "P" instead of the ₱ Unicode sign: the character itself is
    // correct, but it isn't in every font's set, so a browser/OS can fall
    // back to an unfamiliar-looking glyph for just that one symbol. A plain
    // ASCII "P" renders identically everywhere, no font fallback involved.
    return 'P' + num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('en-PH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('hidden');
    if (!document.querySelector('.modal-backdrop:not(.hidden)')) {
      document.body.classList.remove('modal-open');
    }
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // Promise-based confirm() that uses the styled #confirmModal markup
  // instead of the native browser confirm() popup.
  function confirm(message, opts) {
    opts = opts || {};
    const title = opts.title || 'Please confirm';
    const okText = opts.okText || 'Confirm';
    const okClass = opts.okClass || 'btn-primary';

    return new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      if (!modal) { resolve(window.confirm(message)); return; }

      const titleEl = document.getElementById('confirmModalTitle');
      const msgEl = document.getElementById('confirmModalMessage');
      const okBtn = document.getElementById('confirmModalOk');
      const cancelBtn = document.getElementById('confirmModalCancel');

      if (titleEl) titleEl.textContent = title;
      if (msgEl) msgEl.textContent = message;
      if (okBtn) {
        okBtn.textContent = okText;
        okBtn.className = 'btn ' + okClass;
      }

      function cleanup(result) {
        openModal.lastFocused && openModal.lastFocused.focus && openModal.lastFocused.focus();
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        closeModal('confirmModal');
        resolve(result);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onBackdrop(e) { if (e.target === modal) cleanup(false); }
      function onKey(e) { if (e.key === 'Escape') cleanup(false); }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);

      openModal('confirmModal');
      okBtn.focus();
    });
  }

  // Promise-based "which payment method" prompt, used by Mark Paid. Shows
  // #markPaidModal and resolves with 'Cash' / 'GCash', or null if the
  // person backs out (Cancel, backdrop click, or Escape).
  function choosePaymentMethod(message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('markPaidModal');
      if (!modal) { resolve(null); return; }

      const msgEl = document.getElementById('markPaidModalMessage');
      const cashBtn = document.getElementById('markPaidCashBtn');
      const gcashBtn = document.getElementById('markPaidGcashBtn');
      const cancelBtn = document.getElementById('markPaidCancelBtn');

      if (msgEl) msgEl.textContent = message;

      function cleanup(result) {
        cashBtn.removeEventListener('click', onCash);
        gcashBtn.removeEventListener('click', onGcash);
        cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        closeModal('markPaidModal');
        resolve(result);
      }
      function onCash() { cleanup('Cash'); }
      function onGcash() { cleanup('GCash'); }
      function onCancel() { cleanup(null); }
      function onBackdrop(e) { if (e.target === modal) cleanup(null); }
      function onKey(e) { if (e.key === 'Escape') cleanup(null); }

      cashBtn.addEventListener('click', onCash);
      gcashBtn.addEventListener('click', onGcash);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);

      openModal('markPaidModal');
      cashBtn.focus();
    });
  }

  return { peso, escapeHtml, formatDateTime, formatDate, openModal, closeModal, toast, confirm, choosePaymentMethod };
})();
