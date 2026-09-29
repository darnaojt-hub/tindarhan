/**
 * receipt.js
 * Post-checkout receipt modal, including the conditional Pay Later
 * (utang) block: shows a pending balance-due notice, or a paid
 * confirmation once settled.
 */
const Receipt = (() => {
  let printing = false;

  function init() {
    const closeBtn = document.getElementById('receiptCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => UI.closeModal('receiptModal'));
    const modalCloseBtn = document.getElementById('receiptModalClose');
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', () => UI.closeModal('receiptModal'));
    const printBtn = document.getElementById('receiptPrintBtn');
    if (printBtn) printBtn.addEventListener('click', print);
  }

  function show(sale) {
    const body = document.getElementById('receiptBody');
    if (!body) return;

    const itemRows = (sale.items || []).map((it) => (
      '<div class="receipt-line">' +
      '<span>' + UI.escapeHtml(it.name) + ' x' + it.qty + '</span>' +
      '<span>' + UI.peso(it.subtotal) + '</span>' +
      '</div>'
    )).join('');

    let paymentBlock;
    if (sale.paymentMethod === 'Pay Later') {
      if (sale.isSettled) {
        paymentBlock = (
          '<div class="receipt-line receipt-total"><span>Total</span><span>' + UI.peso(sale.total) + '</span></div>' +
          '<div class="receipt-status receipt-status-paid">' + Icon('check', 'icon-sm') + ' PAID' +
          ' via ' + UI.escapeHtml(sale.settledMethod || 'Cash') +
          (sale.settledAt ? ' — ' + UI.formatDateTime(sale.settledAt) : '') +
          ' <span class="brand-bow receipt-paid-bow">' + Icon('bow', 'icon-xs') + '</span></div>' +
          '<div class="receipt-line"><span>Customer</span><span>' + UI.escapeHtml(sale.customerName || '') + '</span></div>'
        );
      } else {
        paymentBlock = (
          '<div class="receipt-line receipt-total"><span>Total</span><span>' + UI.peso(sale.total) + '</span></div>' +
          '<div class="receipt-status receipt-status-due">' + Icon('alertTriangle', 'icon-sm') + ' BALANCE DUE</div>' +
          '<div class="receipt-line"><span>Customer (Pay Later)</span><span>' + UI.escapeHtml(sale.customerName || '') + '</span></div>'
        );
      }
    } else {
      paymentBlock = (
        '<div class="receipt-line receipt-total"><span>Total</span><span>' + UI.peso(sale.total) + '</span></div>' +
        '<div class="receipt-line"><span>Amount Paid</span><span>' + UI.peso(sale.amountPaid) + '</span></div>' +
        '<div class="receipt-line"><span>Change</span><span>' + UI.peso(sale.change) + '</span></div>'
      );
    }

    body.innerHTML =
      '<div class="receipt-header">' +
      '<img src="assets/dar-logo.png" alt="" class="receipt-logo">' +
      '<h3>TinDARhan</h3>' +
      '<p>DAR Batangas ARBO Shop</p>' +
      '</div>' +
      '<div class="receipt-meta">' +
      '<div class="receipt-line"><span>Receipt No.</span><span>' + UI.escapeHtml(sale.id) + '</span></div>' +
      '<div class="receipt-line"><span>Date</span><span>' + UI.formatDateTime(sale.datetime) + '</span></div>' +
      '<div class="receipt-line"><span>Cashier</span><span>' + UI.escapeHtml(sale.cashier) + '</span></div>' +
      '<div class="receipt-line"><span>Payment Method</span><span>' + UI.escapeHtml(sale.paymentMethod) + '</span></div>' +
      '</div>' +
      '<div class="receipt-items">' + itemRows + '</div>' +
      '<div class="receipt-summary">' + paymentBlock + '</div>';

    UI.openModal('receiptModal');
  }

  function print() {
    printing = true;
    document.body.classList.add('printing');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing');
      printing = false;
    }, 300);
  }

  return { init, show, print };
})();
