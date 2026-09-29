/**
 * reports.js
 * Sales Reports tab: date-filtered stats, top products chart, sales
 * transaction table (with Pay Later Mark Paid / Undo actions), Excel
 * export matching the DAR Sales & Inventory Report template, and the
 * Danger Zone "delete all reports" action.
 */
const Reports = (() => {
  let filterFrom = null;
  let filterTo = null;
  let salesCache = [];
  let lastChartKey = '';

  function init() {
    const fromInput = document.getElementById('reportsFilterFrom');
    const toInput = document.getElementById('reportsFilterTo');
    const applyBtn = document.getElementById('reportsApplyFilterBtn');
    const resetBtn = document.getElementById('reportsResetFilterBtn');
    if (applyBtn) applyBtn.addEventListener('click', () => applyFilter(fromInput.value, toInput.value));
    if (resetBtn) resetBtn.addEventListener('click', resetFilter);

    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportXlsx);

    const deleteAllBtn = document.getElementById('deleteAllReportsBtn');
    if (deleteAllBtn) deleteAllBtn.addEventListener('click', openDeleteAllModal);
    const deleteAllModalClose = document.getElementById('deleteAllReportsModalClose');
    if (deleteAllModalClose) deleteAllModalClose.addEventListener('click', closeDeleteAllModal);
    const deleteAllCancelBtn = document.getElementById('cancelDeleteAllBtn');
    if (deleteAllCancelBtn) deleteAllCancelBtn.addEventListener('click', closeDeleteAllModal);
    const confirmInput = document.getElementById('deleteAllConfirmInput');
    if (confirmInput) {
      confirmInput.addEventListener('input', () => {
        const btn = document.getElementById('confirmDeleteAllBtn');
        if (btn) btn.disabled = confirmInput.value.trim() !== 'DELETE';
      });
    }
    const confirmBtn = document.getElementById('confirmDeleteAllBtn');
    if (confirmBtn) confirmBtn.addEventListener('click', deleteAllReports);

    render();
  }

  function applyFilter(from, to) {
    filterFrom = from || null;
    filterTo = to || null;
    render();
  }

  function resetFilter() {
    filterFrom = null;
    filterTo = null;
    const fromInput = document.getElementById('reportsFilterFrom');
    const toInput = document.getElementById('reportsFilterTo');
    if (fromInput) fromInput.value = '';
    if (toInput) toInput.value = '';
    render();
  }

  function getFilteredSales() {
    if (!filterFrom && !filterTo) return salesCache;
    return salesCache.filter((s) => {
      const d = new Date(s.datetime);
      if (filterFrom && d < new Date(filterFrom + 'T00:00:00')) return false;
      if (filterTo && d > new Date(filterTo + 'T23:59:59')) return false;
      return true;
    });
  }

  // Pay Later balances actually collected (settled) within the current
  // report range, regardless of which day the original sale happened on.
  // The Cash Flow section below reconciles the physical drawer for this
  // date range, so a utang collected today should count today even if it
  // was sold last week — and a utang sold today but not yet collected
  // shouldn't inflate today's cash total. Pulls from the unfiltered
  // salesCache and re-applies the same date-boundary rule as
  // getFilteredSales(), but against settledAt instead of datetime.
  function getSalesSettledInRange() {
    return salesCache.filter((s) => {
      if (s.paymentMethod !== 'Pay Later' || !s.isSettled || !s.settledAt) return false;
      if (!filterFrom && !filterTo) return true;
      const d = new Date(s.settledAt);
      if (filterFrom && d < new Date(filterFrom + 'T00:00:00')) return false;
      if (filterTo && d > new Date(filterTo + 'T23:59:59')) return false;
      return true;
    });
  }

  async function render() {
    try {
      salesCache = await DB.getSales();
    } catch (err) {
      UI.toast('Could not load sales: ' + err.message);
      salesCache = [];
    }

    const sales = getFilteredSales();

    let totalSales = 0, itemsSold = 0, payLaterPending = 0;
    sales.forEach((s) => {
      totalSales += Number(s.total) || 0;
      (s.items || []).forEach((it) => { itemsSold += Number(it.qty) || 0; });
      if (s.paymentMethod === 'Pay Later' && !s.isSettled) payLaterPending += Number(s.total) || 0;
    });
    const avgSale = sales.length ? totalSales / sales.length : 0;

    setStat('statTotalSales', totalSales, UI.peso);
    setStat('statTransactions', sales.length, String);
    setStat('statItemsSold', itemsSold, String);
    setStat('statAvgSale', avgSale, UI.peso);
    setStat('statPendingPayLater', payLaterPending, UI.peso);

    renderTopProducts(sales);
    renderSalesTable(sales);
  }

  function setStat(id, value, formatFn) {
    const el = document.getElementById(id);
    if (!el) return;
    const targetText = formatFn(value);
    // Only animate when the figure actually changed, so the 6s background
    // sync doesn't make the whole stats row count up/flash every poll.
    if (el.textContent === targetText) return;
    Motion.countUp(el, value, formatFn);
    el.classList.remove('stat-pulse');
    void el.offsetWidth;
    el.classList.add('stat-pulse');
  }

  function renderTopProducts(sales) {
    const container = document.getElementById('topProductsChart');
    if (!container) return;

    const totals = {};
    sales.forEach((s) => {
      (s.items || []).forEach((it) => {
        totals[it.name] = (totals[it.name] || 0) + Number(it.qty || 0);
      });
    });
    const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 8);

    if (ranked.length === 0) {
      container.innerHTML = '<p class="empty-state">No sales data yet.</p>';
      lastChartKey = '';
      return;
    }

    const max = ranked[0][1];

    // Only animate the bars growing in when the underlying data actually
    // changed. Without this, the 6s background sync would replay the
    // grow-in on every poll even though nothing new happened.
    const key = ranked.map(([name, qty]) => name + ':' + qty).join('|');
    const changed = key !== lastChartKey;
    lastChartKey = key;

    container.innerHTML = ranked.map(([name, qty]) => {
      const pct = Math.max(4, (qty / max) * 100);
      return (
        '<div class="chart-row">' +
        '<span class="chart-label">' + UI.escapeHtml(name) + '</span>' +
        '<div class="chart-bar-track"><div class="chart-bar" data-pct="' + pct + '" style="width:' + (changed ? '0' : pct) + '%"></div></div>' +
        '<span class="chart-value">' + qty + '</span>' +
        '</div>'
      );
    }).join('');

    if (changed) {
      requestAnimationFrame(() => {
        container.querySelectorAll('.chart-bar').forEach((bar) => {
          bar.style.width = bar.dataset.pct + '%';
        });
      });
    }
  }

  function renderSalesTable(sales) {
    const tbody = document.getElementById('reportsTableBody');
    if (!tbody) return;

    if (sales.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No transactions in this range.</td></tr>';
      return;
    }

    const sorted = [...sales].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

    tbody.innerHTML = sorted.map((s) => {
      let paymentCell;
      if (s.paymentMethod === 'Pay Later') {
        if (s.isSettled) {
          const settledVia = s.settledMethod || 'Cash'; // pre-existing settled sales predate this field
          const viaBadgeClass = settledVia === 'GCash' ? 'badge-teal' : 'badge-ok';
          paymentCell =
            '<span class="paid-tag">' + Icon('check', 'icon-xs') + ' Paid — ' + UI.escapeHtml(s.customerName || '') + '</span> ' +
            '<span class="badge ' + viaBadgeClass + '">' + UI.escapeHtml(settledVia) + '</span> ' +
            '<button type="button" class="icon-btn undo-settle-btn" data-id="' + UI.escapeHtml(s.id) + '" data-name="' + UI.escapeHtml(s.customerName || '') + '" aria-label="Undo payment for ' + UI.escapeHtml(s.customerName || '') + '">' + Icon('undo') + '</button>';
        } else {
          paymentCell =
            '<span class="badge badge-info">Pay Later — ' + UI.escapeHtml(s.customerName || '') + '</span> ' +
            '<button type="button" class="btn btn-sm btn-primary mark-paid-btn" data-id="' + UI.escapeHtml(s.id) + '" data-name="' + UI.escapeHtml(s.customerName || '') + '" data-total="' + s.total + '">' + Icon('check', 'icon-sm') + ' Mark Paid</button>';
        }
      } else {
        const methodBadgeClass = s.paymentMethod === 'GCash' ? 'badge-teal' : 'badge-ok';
        paymentCell = '<span class="badge ' + methodBadgeClass + '">' + UI.escapeHtml(s.paymentMethod) + '</span>';
      }

      return (
        '<tr>' +
        '<td>' + UI.formatDateTime(s.datetime) + '</td>' +
        '<td>' + UI.escapeHtml(s.cashier) + '</td>' +
        '<td>' + paymentCell + '</td>' +
        '<td class="peso-amt">' + UI.peso(s.total) + '</td>' +
        '<td>' + (s.items || []).reduce((n, it) => n + Number(it.qty || 0), 0) + '</td>' +
        '<td><button type="button" class="icon-btn view-receipt-btn" data-id="' + UI.escapeHtml(s.id) + '" aria-label="View receipt for sale ' + UI.escapeHtml(s.id) + '">' + Icon('receipt') + '</button></td>' +
        '</tr>'
      );
    }).join('');

    tbody.querySelectorAll('.mark-paid-btn').forEach((btn) => {
      btn.addEventListener('click', () => markAsPaid(btn.dataset.id, btn.dataset.name, parseFloat(btn.dataset.total)));
    });
    tbody.querySelectorAll('.undo-settle-btn').forEach((btn) => {
      btn.addEventListener('click', () => undoSettle(btn.dataset.id, btn.dataset.name));
    });
    tbody.querySelectorAll('.view-receipt-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sale = salesCache.find((s) => s.id === btn.dataset.id);
        if (sale) Receipt.show(sale);
      });
    });
  }

  async function markAsPaid(saleId, customerName, total) {
    const method = await UI.choosePaymentMethod(
      'Mark ' + (customerName || 'this customer') + '’s Pay Later balance of ' + UI.peso(total) + ' as paid. How did they pay?'
    );
    if (!method) return;
    try {
      await DB.settleSale(saleId, method);
      UI.toast('Marked as paid — ' + method + '.');
      render();
    } catch (err) {
      UI.toast('Could not update sale: ' + err.message);
    }
  }

  async function undoSettle(saleId, customerName) {
    const ok = await UI.confirm(
      'Undo payment confirmation for ' + (customerName || 'this customer') + '? This will mark the balance as pending again.',
      { title: 'Undo Payment', okText: 'Undo', okClass: 'btn-secondary' }
    );
    if (!ok) return;
    try {
      await DB.unsettleSale(saleId);
      UI.toast('Reverted to pending.');
      render();
    } catch (err) {
      UI.toast('Could not update sale: ' + err.message);
    }
  }

  // ---- Excel export (mirrors the DAR Sales & Inventory Report template
  // exactly: same sheet names, headings, merges, column widths and cell
  // borders, built with ExcelJS so real borders/fonts/fills are written,
  // not just values). ----
  const PESO_FMT = '"P"#,##0.00'; // plain "P", not the ₱ sign -- same reasoning as UI.peso() in ui.js
  const THIN = { style: 'thin' };
  const ALL_BORDERS = { top: THIN, left: THIN, bottom: THIN, right: THIN };

  function borderCell(cell) {
    cell.border = ALL_BORDERS;
    return cell;
  }
  function headerCell(cell, opts) {
    opts = opts || {};
    cell.font = { bold: true, size: 11 };
    cell.alignment = { horizontal: opts.align || 'center', vertical: 'center', wrapText: !!opts.wrap };
    return borderCell(cell);
  }
  function dataCell(cell, opts) {
    opts = opts || {};
    cell.font = { size: 11 };
    if (opts.wrap) cell.alignment = { wrapText: true, vertical: opts.valign || 'top' };
    return borderCell(cell);
  }
  function titleCell(cell, size) {
    cell.font = { bold: true, size: size || 16 };
    cell.alignment = { horizontal: 'center' };
    return cell;
  }
  function labelCell(cell, size) {
    cell.font = { size: size || 14 };
    return cell;
  }

  function buildProductInvSheet(workbook, items, sales) {
    const soldByItem = {};
    sales.forEach((s) => (s.items || []).forEach((it) => {
      const key = it.itemId || it.name;
      soldByItem[key] = (soldByItem[key] || 0) + Number(it.qty || 0);
    }));

    const ws = workbook.addWorksheet('Product Inv');
    ws.getColumn(2).width = 38;      // B
    ws.getColumn(3).width = 28.55;   // C
    ws.getColumn(4).width = 19.55;   // D
    ws.getColumn(5).width = 20.66;   // E
    ws.getColumn(6).width = 19.55;   // F - Total (D*E), currency: was unset, showed as ####
    ws.getColumn(7).width = 17.55;   // G
    ws.getColumn(8).width = 19.55;   // H - Total (D*G), currency: was unset, showed as ####
    ws.getColumn(9).width = 20;      // I

    // Column-level peso format as a safety net (in addition to the per-cell
    // numFmt set below), so every price/total in these columns always shows
    // two decimals ("P150.00", never "P150") -- including any row a person
    // adds by hand later in Excel itself.
    ws.getColumn(4).numFmt = PESO_FMT; // D - Unit Price
    ws.getColumn(6).numFmt = PESO_FMT; // F - Total (D*E)
    ws.getColumn(8).numFmt = PESO_FMT; // H - Total (D*G)

    ws.mergeCells('B6:I6');
    titleCell(ws.getCell('B6'), 16).value = 'PRODUCT INVENTORY REPORT';
    ws.getRow(6).height = 21;

    labelCell(ws.getCell('B8')).value = 'Name of In-charge: ____________________________';
    labelCell(ws.getCell('B9')).value = 'Date Prepared: ' + new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
    ws.getRow(8).height = 18;
    ws.getRow(9).height = 18;

    ws.getCell('B11').value = 'INVENTORY SUMMARY';
    ws.getCell('B11').font = { bold: true, size: 11 };

    const HEADER_ROW = 13;
    const headers = [
      ['B', 'ARBO Name', false],
      ['C', 'Product Name', false],
      ['D', 'Unit Price', false],
      ['E', 'AM - Beginning Inventory', true],
      ['F', 'Total', true],
      ['G', 'Units Sold', false],
      ['H', 'Total', false],
      ['I', 'PM - Ending Inventory', true],
    ];
    headers.forEach(([col, text, wrap]) => {
      const cell = ws.getCell(col + HEADER_ROW);
      cell.value = text;
      headerCell(cell, { wrap });
    });
    ws.getRow(HEADER_ROW).height = 27.75;

    // ARBO/organization names run long ("Bagong Silang San Juan Batangas
    // Irrigators Association") and this column wasn't wrapping, so the text
    // just got visually clipped by the next cell's border. Wrap it like the
    // Product Name column already does, and grow the row to fit however
    // many lines the longest cell in that row actually needs.
    function estimateWrapLines(text, colWidth) {
      const charsPerLine = Math.max(8, Math.round(colWidth * 0.95));
      return Math.max(1, Math.ceil(String(text || '').length / charsPerLine));
    }

    const DATA_START = HEADER_ROW + 1;
    items.forEach((it, idx) => {
      const row = DATA_START + idx;
      const sold = soldByItem[it.id] || 0;
      const beginning = Number(it.stock) + sold;

      dataCell(ws.getCell('B' + row), { wrap: true }).value = it.farm || '';
      dataCell(ws.getCell('C' + row), { wrap: true }).value = it.name;
      const priceCell = dataCell(ws.getCell('D' + row));
      priceCell.value = Number(it.price);
      priceCell.numFmt = PESO_FMT;
      dataCell(ws.getCell('E' + row)).value = beginning;
      const totalBeginCell = dataCell(ws.getCell('F' + row));
      totalBeginCell.value = { formula: 'D' + row + '*E' + row, result: Number(it.price) * beginning };
      totalBeginCell.numFmt = PESO_FMT;
      dataCell(ws.getCell('G' + row)).value = sold;
      const totalSoldCell = dataCell(ws.getCell('H' + row));
      totalSoldCell.value = { formula: 'D' + row + '*G' + row, result: Number(it.price) * sold };
      totalSoldCell.numFmt = PESO_FMT;
      dataCell(ws.getCell('I' + row)).value = Number(it.stock);
      const bLines = estimateWrapLines(it.farm || '', 38);
      const cLines = estimateWrapLines(it.name || '', 28.55);
      ws.getRow(row).height = Math.max(27.75, Math.max(bLines, cLines) * 15 + 8);
    });

    const lastDataRow = DATA_START + items.length - 1;
    const TOTAL_ROW = DATA_START + items.length;
    ws.mergeCells('B' + TOTAL_ROW + ':C' + TOTAL_ROW);
    const totalLabel = ws.getCell('B' + TOTAL_ROW);
    totalLabel.value = 'TOTAL';
    totalLabel.font = { bold: true, size: 12 };
    totalLabel.alignment = { horizontal: 'center', vertical: 'center' };
    borderCell(totalLabel);
    ['D', 'E', 'G', 'H', 'I'].forEach((col) => borderCell(ws.getCell(col + TOTAL_ROW)));
    const grandTotal = items.reduce((sum, it) => {
      const sold = soldByItem[it.id] || 0;
      const beginning = Number(it.stock) + sold;
      return sum + Number(it.price) * beginning;
    }, 0);
    const grandTotalCell = ws.getCell('F' + TOTAL_ROW);
    grandTotalCell.value = items.length ? { formula: 'SUM(F' + DATA_START + ':F' + lastDataRow + ')', result: grandTotal } : 0;
    grandTotalCell.numFmt = PESO_FMT;
    grandTotalCell.font = { bold: true, size: 11 };
    grandTotalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    borderCell(grandTotalCell);
    ws.getRow(TOTAL_ROW).height = 18;

    const PREPARED_ROW = TOTAL_ROW + 2;
    labelCell(ws.getCell('B' + PREPARED_ROW)).value = 'Prepared by:';
    const notedCell = labelCell(ws.getCell('E' + PREPARED_ROW));
    notedCell.value = 'Noted by:';
    notedCell.alignment = { horizontal: 'right' };
    ws.getRow(PREPARED_ROW).height = 18;

    const SIG_ROW = PREPARED_ROW + 3;
    ws.mergeCells('B' + SIG_ROW + ':C' + SIG_ROW);
    ws.mergeCells('G' + SIG_ROW + ':H' + SIG_ROW);
    const sigLine1 = labelCell(ws.getCell('B' + SIG_ROW));
    sigLine1.value = '____________________________';
    sigLine1.alignment = { horizontal: 'center' };
    const sigLine2 = labelCell(ws.getCell('G' + SIG_ROW));
    sigLine2.value = '____________________________';
    sigLine2.alignment = { horizontal: 'center' };
    ws.getRow(SIG_ROW).height = 18;
    ws.getRow(SIG_ROW + 1).height = 18;

    const CAPTION_ROW = SIG_ROW + 2;
    ws.mergeCells('B' + CAPTION_ROW + ':C' + CAPTION_ROW);
    ws.mergeCells('G' + CAPTION_ROW + ':H' + CAPTION_ROW);
    const cap1 = labelCell(ws.getCell('B' + CAPTION_ROW));
    cap1.value = 'Signature over Printed Name';
    cap1.alignment = { horizontal: 'center', vertical: 'top' };
    const cap2 = labelCell(ws.getCell('G' + CAPTION_ROW));
    cap2.value = 'Signature over Printed Name';
    cap2.alignment = { horizontal: 'center', vertical: 'top' };
    ws.getRow(CAPTION_ROW).height = 18;

    ws.views = [{ showGridLines: true }];
  }

  function buildDailySalesSheet(workbook, sales) {
    const ws = workbook.addWorksheet('Daily Sales');
    ws.getColumn(2).width = 33.22; // B Time
    ws.getColumn(3).width = 22;    // C Product
    ws.getColumn(5).width = 14.89; // E Price/Item
    ws.getColumn(6).width = 14;    // F Total
    ws.getColumn(7).width = 13;    // G Payment -- just "Cash" / "GCash" / "Pay Later" now
    ws.getColumn(8).width = 30;    // H Notes -- customer + settlement status, kept off the Payment column so it never overlaps

    // Column-level peso format as a safety net (numFmt has no effect on the
    // text cells sharing these columns -- Product in C above, labels in B --
    // so this only ever affects the numbers). C also holds "Amount" in the
    // Cash Flow section further down this sheet.
    ws.getColumn(3).numFmt = PESO_FMT; // C - Amount (Cash Flow section)
    ws.getColumn(5).numFmt = PESO_FMT; // E - Price/Item
    ws.getColumn(6).numFmt = PESO_FMT; // F - Total

    ws.mergeCells('B5:H5');
    titleCell(ws.getCell('B5'), 14).value = 'DAILY SALES RECORD';
    ws.getRow(5).height = 18;

    const dateLabel = filterFrom || filterTo
      ? (filterFrom ? UI.formatDate(filterFrom) : 'Start') + ' – ' + (filterTo ? UI.formatDate(filterTo) : 'Present')
      : 'All Dates';
    ws.getCell('B7').value = 'Date: ' + dateLabel;
    ws.getCell('B7').font = { size: 11 };
    ws.getCell('B8').value = 'Name of In-charge: ____________________';
    ws.getCell('B8').font = { size: 11 };

    const HEADER_ROW = 10;
    ['B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach((col, i) => {
      const cell = ws.getCell(col + HEADER_ROW);
      cell.value = ['Time', 'Product', 'Qty.', 'Price/Item', 'Total', 'Payment', 'Notes'][i];
      headerCell(cell);
    });

    // Flatten each sale into one row per line item, matching the
    // template's per-product row layout. Payment is kept to just the method
    // name (Cash / GCash / Pay Later) so the 3 types are always clearly
    // separate and the cell never needs to wrap; the customer name and
    // paid/pending status for Pay Later sales go in their own Notes column
    // instead of being crammed into the same cell, which was overflowing
    // into the row below.
    const lines = [];
    [...sales].sort((a, b) => new Date(a.datetime) - new Date(b.datetime)).forEach((s) => {
      const time = new Date(s.datetime).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
      const payment = s.paymentMethod;
      let notes = '';
      if (s.paymentMethod === 'Pay Later') {
        const who = s.customerName || 'Customer';
        notes = s.isSettled ? who + ' – Paid via ' + (s.settledMethod || 'Cash') : who + ' – Pending';
      }
      (s.items || []).forEach((it) => {
        lines.push({ time, product: it.name, qty: Number(it.qty) || 0, price: Number(it.price) || 0, total: Number(it.subtotal) || 0, payment, notes });
      });
    });

    const DATA_START = HEADER_ROW + 1;
    lines.forEach((line, idx) => {
      const row = DATA_START + idx;
      dataCell(ws.getCell('B' + row)).value = line.time;
      dataCell(ws.getCell('C' + row), { wrap: true }).value = line.product;
      dataCell(ws.getCell('D' + row)).value = line.qty;
      const priceCell = dataCell(ws.getCell('E' + row));
      priceCell.value = line.price;
      priceCell.numFmt = PESO_FMT;
      const totalCell = dataCell(ws.getCell('F' + row));
      totalCell.value = line.total;
      totalCell.numFmt = PESO_FMT;
      dataCell(ws.getCell('G' + row)).value = line.payment;
      dataCell(ws.getCell('H' + row), { wrap: true }).value = line.notes;
      ws.getRow(row).height = line.notes ? 30 : 19.5;
    });

    const lastDataRow = DATA_START + lines.length - 1;
    const TOTAL_ROW = DATA_START + lines.length;
    const totalLabel = ws.getCell('B' + TOTAL_ROW);
    totalLabel.value = 'Total';
    totalLabel.font = { bold: true, size: 11 };
    borderCell(totalLabel);
    ['C', 'D', 'E'].forEach((col) => borderCell(ws.getCell(col + TOTAL_ROW)));
    const lineTotalSum = lines.reduce((sum, l) => sum + l.total, 0);
    const totalCell = ws.getCell('F' + TOTAL_ROW);
    totalCell.value = lines.length ? { formula: 'SUM(F' + DATA_START + ':F' + lastDataRow + ')', result: lineTotalSum } : 0;
    totalCell.numFmt = PESO_FMT;
    totalCell.font = { bold: true, size: 11 };
    borderCell(totalCell);
    borderCell(ws.getCell('G' + TOTAL_ROW));
    borderCell(ws.getCell('H' + TOTAL_ROW));

    // ---- SALES BY PAYMENT TYPE: the simplest possible readout -- exactly
    // the 3 payment types visible in the Payment column above, each with one
    // computed total, using a live SUMIF so it's easy to trust (it's just
    // adding up the Payment column above) and easy to re-check by eye. ----
    const PAYTYPE_HEADER_ROW = TOTAL_ROW + 2;
    const ptHead = ws.getCell('B' + PAYTYPE_HEADER_ROW);
    ptHead.value = 'SALES BY PAYMENT TYPE';
    headerCell(ptHead, { wrap: true });
    const ptAmtHead = ws.getCell('C' + PAYTYPE_HEADER_ROW);
    ptAmtHead.value = 'Amount';
    headerCell(ptAmtHead, { align: 'right' });

    const payTypes = ['Cash', 'GCash', 'Pay Later'];
    payTypes.forEach((label, i) => {
      const row = PAYTYPE_HEADER_ROW + 1 + i;
      const labelC = ws.getCell('B' + row);
      labelC.value = label.toUpperCase();
      labelC.font = { bold: true, size: 11 };
      labelC.alignment = { vertical: 'center' };
      borderCell(labelC);
      const amount = lines.filter((l) => l.payment === label).reduce((sum, l) => sum + l.total, 0);
      const valC = ws.getCell('C' + row);
      valC.value = lines.length
        ? { formula: 'SUMIF(G' + DATA_START + ':G' + lastDataRow + ',"' + label + '",F' + DATA_START + ':F' + lastDataRow + ')', result: amount }
        : 0;
      valC.numFmt = PESO_FMT;
      valC.font = { bold: true, size: 11 };
      valC.alignment = { horizontal: 'right', vertical: 'center' };
      borderCell(valC);
    });
    const PAYTYPE_TOTAL_ROW = PAYTYPE_HEADER_ROW + 1 + payTypes.length;
    const ptTotalLabel = ws.getCell('B' + PAYTYPE_TOTAL_ROW);
    ptTotalLabel.value = 'TOTAL';
    ptTotalLabel.font = { bold: true, size: 11 };
    borderCell(ptTotalLabel);
    const ptTotalCell = ws.getCell('C' + PAYTYPE_TOTAL_ROW);
    ptTotalCell.value = { formula: 'SUM(C' + (PAYTYPE_HEADER_ROW + 1) + ':C' + (PAYTYPE_TOTAL_ROW - 1) + ')', result: lineTotalSum };
    ptTotalCell.numFmt = PESO_FMT;
    ptTotalCell.font = { bold: true, size: 11 };
    borderCell(ptTotalCell);

    // ---- END-OF-DAY SUMMARY: Cash Flow is now cash-drawer reconciliation
    // only -- GCash and the Pay Later face value are already shown above, so
    // this section only tracks what actually affects the physical cash
    // drawer (fewer rows than before, on purpose). ----
    const EOD_ROW = PAYTYPE_TOTAL_ROW + 2;
    ws.getCell('B' + EOD_ROW).value = 'END-OF-DAY SUMMARY';
    ws.getCell('B' + EOD_ROW).font = { bold: true, size: 11 };
    const NOTE_ROW = EOD_ROW + 1;
    ws.getCell('B' + NOTE_ROW).value = 'Yellow cells: type in your own count/amount. Cash Over/(Short) stays negative until "Actual Cash on Hand" is filled in.';
    ws.getCell('B' + NOTE_ROW).font = { italic: true, size: 10, color: { argb: 'FF6B6B6B' } };

    const CASHFLOW_HEADER_ROW = EOD_ROW + 2;
    const cfHead = ws.getCell('B' + CASHFLOW_HEADER_ROW);
    cfHead.value = 'Cash Flow (Cash Drawer Only)';
    headerCell(cfHead, { wrap: true });
    const amtHead = ws.getCell('C' + CASHFLOW_HEADER_ROW);
    amtHead.value = 'Amount';
    headerCell(amtHead, { align: 'right', wrap: true });
    const compHead = ws.getCell('E' + CASHFLOW_HEADER_ROW);
    compHead.value = 'Computation';
    compHead.font = { bold: true, size: 11 };

    // Only cash matters here -- GCash never touches the physical drawer, so
    // it isn't tracked in this section at all (see SALES BY PAYMENT TYPE
    // above for the GCash total). "Pay Later Collected" is utang settled in
    // cash today, which may have been sold on an earlier day, so it's kept
    // as its own line rather than silently merged into Cash Sales.
    let cashDirect = 0, cashFromPayLater = 0;
    sales.forEach((s) => {
      if (s.paymentMethod !== 'Cash') return;
      cashDirect += Number(s.total) || 0;
    });
    getSalesSettledInRange().forEach((s) => {
      if ((s.settledMethod || 'Cash') === 'Cash') cashFromPayLater += Number(s.total) || 0;
    });
    const cashTotalAll = cashDirect + cashFromPayLater;

    const R = CASHFLOW_HEADER_ROW; // shorthand base
    const ROW_OPENING = R + 1;
    const ROW_CASH_DIRECT = R + 2;
    const ROW_CASH_PAYLATER = R + 3;
    const ROW_CASH_TOTAL = R + 4;
    const ROW_OTHER_RECEIPTS = R + 5;
    const ROW_CASH_EXPENSES = R + 6;
    const ROW_EXPECTED_CLOSING = R + 7;
    const ROW_ACTUAL_CASH = R + 8;

    // "input: true" rows are the ones nobody but the cashier can know —
    // the app has no way to see cash physically in the drawer, so these
    // stay blank for someone to type into after opening the file in Excel.
    // They're shaded so it's obvious at a glance they're waiting for entry,
    // not a computed value that's stuck at zero.
    const rows = [
      { label: 'Opening Cash/Change Fund', value: '', bold: false, input: true, comp: 'Type the cash the drawer started the day with' },
      { label: 'Cash Sales (Walk-in)', value: cashDirect, bold: false, comp: 'Same as CASH above' },
      { label: 'Pay Later Collected – Cash', value: cashFromPayLater, bold: false, comp: 'Utang settled in cash today' },
      { label: 'TOTAL CASH IN', value: { formula: 'SUM(C' + ROW_CASH_DIRECT + ':C' + ROW_CASH_PAYLATER + ')', result: cashTotalAll }, bold: true, comp: '= Cash Sales (Walk-in) + Pay Later Collected – Cash' },
      { label: 'Add: Other Cash Receipts', value: '', bold: false, input: true, comp: 'Type any other cash received, not from a sale' },
      { label: 'Less: Cash Expenses/Payments', value: '', bold: false, input: true, comp: 'Type cash paid out (supplies, etc.)' },
      { label: 'Expected Closing Cash', value: { formula: 'C' + ROW_OPENING + '+C' + ROW_CASH_TOTAL + '+C' + ROW_OTHER_RECEIPTS + '-C' + ROW_CASH_EXPENSES, result: cashTotalAll }, bold: true, comp: '= Opening Cash + Total Cash In + Other Cash Receipts − Cash Expenses' },
      { label: 'Actual Cash on Hand', value: '', bold: false, input: true, comp: 'Count the drawer at closing and type the total here' },
      { label: 'Cash Over/(Short)', value: { formula: 'C' + ROW_ACTUAL_CASH + '-C' + ROW_EXPECTED_CLOSING, result: -cashTotalAll }, bold: true, comp: 'Negative until "Actual Cash on Hand" above is filled in – = Actual Cash on Hand − Expected Closing Cash' },
    ];
    const INPUT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    rows.forEach((r, i) => {
      const row = R + 1 + i;
      const labelC = ws.getCell('B' + row);
      labelC.value = r.label;
      labelC.font = { bold: r.bold, size: 11, italic: !!r.input };
      labelC.alignment = { vertical: 'center', wrapText: true };
      borderCell(labelC);
      const valC = ws.getCell('C' + row);
      valC.value = r.value;
      valC.numFmt = PESO_FMT;
      valC.font = { bold: r.bold, size: 11 };
      valC.alignment = { horizontal: 'right', vertical: 'center', wrapText: true };
      if (r.input) valC.fill = INPUT_FILL;
      borderCell(valC);
      if (r.comp) {
        const compC = ws.getCell('E' + row);
        compC.value = r.comp;
        compC.font = { size: 11 };
      }
    });

    ws.views = [{ showGridLines: true }];
  }

  function buildSalesSummarySheet(workbook, sales) {
    const ws = workbook.addWorksheet('Sales Summary');
    ws.getColumn(4).width = 22.89; // D
    ws.getColumn(5).width = 26;    // E - Date(s), was unset and never filled in
    ws.getColumn(6).width = 19.55; // F - Total Sales, currency: was unset, showed as ####
    ws.getColumn(6).numFmt = PESO_FMT; // column-level safety net, same reason as the other sheets

    const HEADER_ROW = 2;
    ['D', 'E', 'F', 'G'].forEach((col, i) => {
      const cell = ws.getCell(col + HEADER_ROW);
      cell.value = ['Day', 'Date', 'Total Sales', 'Remarks'][i];
      cell.font = { size: 11 };
      borderCell(cell);
    });

    // Total per actual calendar date (not per weekday name). Grouping by
    // weekday name alone mixed different weeks into the same row -- e.g. a
    // Wednesday from last week and a Monday from this week -- and always
    // printed the rows in a fixed Mon-Sun order, so the Date column came out
    // reading Sep 28 -> Sep 29 -> Sep 23: out of order. Keying by the real
    // date instead means one row is always exactly one real day, so sorting
    // the rows by date puts them in true chronological order.
    const totalsByDate = {}; // 'YYYY-MM-DD' -> total
    sales.forEach((s) => {
      const d = new Date(s.datetime);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      totalsByDate[key] = (totalsByDate[key] || 0) + (Number(s.total) || 0);
    });

    // With an explicit date-range filter applied, show every date in that
    // range (even ones with no sales) so the sheet still reads like a full
    // period at a glance; with no filter, just list the dates that actually
    // have sales, which avoids fabricating a fake "week" out of whatever
    // dates happen to exist in the data.
    let dateKeys;
    if (filterFrom && filterTo) {
      dateKeys = [];
      const cursor = new Date(filterFrom + 'T00:00:00');
      const end = new Date(filterTo + 'T00:00:00');
      while (cursor <= end) {
        dateKeys.push(cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0') + '-' + String(cursor.getDate()).padStart(2, '0'));
        cursor.setDate(cursor.getDate() + 1);
      }
    } else {
      dateKeys = Object.keys(totalsByDate).sort();
    }

    dateKeys.forEach((key, idx) => {
      const row = HEADER_ROW + 1 + idx;
      const d = new Date(key + 'T00:00:00');
      const dayCell = ws.getCell('D' + row);
      dayCell.value = d.toLocaleDateString('en-PH', { weekday: 'long' });
      dayCell.font = { size: 11 };
      borderCell(dayCell);
      const dateCell = ws.getCell('E' + row);
      dateCell.value = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
      dateCell.font = { size: 11 };
      dateCell.alignment = { wrapText: true, vertical: 'center' };
      borderCell(dateCell);
      const totalCell = ws.getCell('F' + row);
      totalCell.value = totalsByDate[key] || 0;
      totalCell.numFmt = PESO_FMT;
      totalCell.font = { size: 11 };
      borderCell(totalCell);
      borderCell(ws.getCell('G' + row));
      ws.getRow(row).height = 19.2;
    });

    const TOTAL_ROW = HEADER_ROW + 1 + dateKeys.length;
    const totalLabel = ws.getCell('D' + TOTAL_ROW);
    totalLabel.value = 'TOTAL SALES';
    totalLabel.font = { size: 11 };
    borderCell(totalLabel);
    borderCell(ws.getCell('E' + TOTAL_ROW));
    const grandTotal = dateKeys.reduce((sum, k) => sum + (totalsByDate[k] || 0), 0);
    const totalCell = ws.getCell('F' + TOTAL_ROW);
    totalCell.value = dateKeys.length
      ? { formula: 'SUM(F' + (HEADER_ROW + 1) + ':F' + (TOTAL_ROW - 1) + ')', result: grandTotal }
      : 0;
    totalCell.numFmt = PESO_FMT;
    totalCell.font = { size: 11 };
    borderCell(totalCell);
    borderCell(ws.getCell('G' + TOTAL_ROW));
    ws.getRow(TOTAL_ROW).height = 19.2;

    ws.views = [{ showGridLines: true }];
  }

  async function exportXlsx() {
    if (typeof ExcelJS === 'undefined') {
      UI.toast('Excel export library failed to load.');
      return;
    }
    let items;
    try {
      items = await DB.getItems();
    } catch (err) {
      UI.toast('Could not load items for export: ' + err.message);
      return;
    }
    const sales = getFilteredSales();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TinDARhan';
    workbook.created = new Date();
    buildProductInvSheet(workbook, items, sales);
    buildDailySalesSheet(workbook, sales);
    buildSalesSummarySheet(workbook, sales);

    const filename = 'TinDARhan_Sales_Report_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    try {
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      // When this page is running inside a Claude Artifact preview,
      // window.claude offers a "downloads" capability instead of a plain
      // browser download link. On the real deployed site window.claude
      // does not exist, so this simply falls through to the normal
      // anchor-click download below.
      if (window.claude && typeof window.claude.use === 'function') {
        try {
          const downloads = await window.claude.use('downloads');
          if (downloads) {
            await downloads.save({ filename, data: blob });
            UI.toast('Report exported.');
            return;
          }
        } catch (capErr) {
          // Fall through to the ordinary browser download.
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      UI.toast('Report exported.');
    } catch (err) {
      UI.toast('Could not build the report: ' + err.message);
    }
  }

  // ---- Danger Zone: delete all reports ----
  function openDeleteAllModal() {
    const input = document.getElementById('deleteAllConfirmInput');
    if (input) input.value = '';
    const btn = document.getElementById('confirmDeleteAllBtn');
    if (btn) btn.disabled = true;
    UI.openModal('deleteAllReportsModal');
  }

  function closeDeleteAllModal() {
    UI.closeModal('deleteAllReportsModal');
  }

  async function deleteAllReports() {
    const input = document.getElementById('deleteAllConfirmInput');
    if (!input || input.value.trim() !== 'DELETE') return;
    const btn = document.getElementById('confirmDeleteAllBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Deleting...'; }
    try {
      await DB.deleteAllSales();
      UI.toast('All sales reports have been deleted.');
      closeDeleteAllModal();
      render();
    } catch (err) {
      UI.toast('Could not delete reports: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Delete Everything'; }
    }
  }

  return {
    init, applyFilter, resetFilter, getFilteredSales, render,
    markAsPaid, undoSettle, exportXlsx,
    openDeleteAllModal, closeDeleteAllModal, deleteAllReports,
  };
})();
