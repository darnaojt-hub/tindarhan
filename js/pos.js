/**
 * pos.js
 * The "TinDARhan Shop" tab: item grid + cart + checkout, including the
 * Cash / GCash / Pay Later (Utang) payment flows.
 */
const POS = (() => {
  let cart = []; // [{id, name, price, qty, stock}]
  let allItems = [];
  let searchTerm = '';
  let hasLoadedOnce = false;

  function init() {
    const searchInput = document.getElementById('posSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value.trim().toLowerCase();
        // Silent: re-filtering on every keystroke shouldn't replay the
        // grid's entrance animation, or it would feel jittery while typing.
        renderItemGrid({ silent: true });
      });
    }
    const methodSelect = document.getElementById('paymentMethod');
    if (methodSelect) methodSelect.addEventListener('change', updatePaymentFieldsVisibility);
    document.querySelectorAll('.payment-method-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.paymentValue;
        const select = document.getElementById('paymentMethod');
        if (select && select.value !== value) {
          select.value = value;
          select.dispatchEvent(new Event('change'));
        }
      });
    });
    const amountPaidInput = document.getElementById('amountPaid');
    if (amountPaidInput) amountPaidInput.addEventListener('input', renderCartSummary);
    const clearBtn = document.getElementById('clearCartBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearCart);
    const checkoutBtn = document.getElementById('checkoutBtn');
    if (checkoutBtn) checkoutBtn.addEventListener('click', checkout);

    updatePaymentFieldsVisibility();
    renderCart();
    renderItemGrid();
  }

  async function renderItemGrid(opts) {
    opts = opts || {};
    const grid = document.getElementById('itemGrid');
    if (!grid) return;

    // First-ever load: show a shimmer skeleton instead of a blank panel
    // while the initial fetch is in flight. Never shown for the silent
    // background sync, since the grid already has real content by then.
    if (!hasLoadedOnce && !opts.silent) {
      grid.classList.remove('entrance-anim');
      grid.innerHTML = Array.from({ length: 8 }).map(() => '<div class="item-card-skeleton"></div>').join('');
    }

    try {
      allItems = await DB.getItems();
    } catch (err) {
      grid.innerHTML = '<p class="empty-state">Could not load items: ' + UI.escapeHtml(err.message) + '</p>';
      return;
    }
    hasLoadedOnce = true;

    const chipEl = document.getElementById('itemCountChip');
    if (chipEl) chipEl.textContent = 'All · ' + allItems.length + (allItems.length === 1 ? ' Item' : ' Items');

    const filtered = allItems.filter((it) => !searchTerm || it.name.toLowerCase().includes(searchTerm));

    if (filtered.length === 0) {
      grid.classList.remove('entrance-anim');
      grid.innerHTML = '<p class="empty-state">No items found.</p>';
      return;
    }

    // Only play the staggered entrance on a meaningful, user-visible
    // moment (first load, switching to this tab, after checkout) — never
    // on the 6s silent background sync, or it would flicker constantly.
    grid.classList.toggle('entrance-anim', !opts.silent);

    grid.innerHTML = filtered.map((it, idx) => {
      const outOfStock = it.stock <= 0;
      const photo = it.image
        ? '<img src="' + it.image + '" alt="" loading="lazy">'
        : Icon('box', 'icon-lg');
      const delay = opts.silent ? '' : ' style="animation-delay:' + Math.min(idx * 25, 300) + 'ms"';
      return (
        '<button type="button" class="item-card' + (outOfStock ? ' is-out' : '') + '" ' +
        'data-id="' + UI.escapeHtml(it.id) + '" ' + (outOfStock ? 'disabled' : '') + delay + ' ' +
        'aria-label="Add ' + UI.escapeHtml(it.name) + ' to cart">' +
        '<span class="item-card-photo">' + photo + '</span>' +
        '<span class="item-card-name">' + UI.escapeHtml(it.name) + '</span>' +
        '<span class="item-card-price">' + UI.peso(it.price) + '</span>' +
        '<span class="item-card-stock">' + (outOfStock ? 'Out of stock' : it.stock + ' in stock') + '</span>' +
        '</button>'
      );
    }).join('');

    grid.querySelectorAll('.item-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!btn.disabled) {
          // Quick pop feedback on the tapped card, restarted cleanly even
          // if the previous pop hasn't finished (fast repeat taps).
          btn.classList.remove('item-card-pop');
          void btn.offsetWidth;
          btn.classList.add('item-card-pop');
        }
        addToCart(btn.dataset.id);
      });
    });
  }

  function addToCart(itemId) {
    const item = allItems.find((it) => it.id === itemId);
    if (!item || item.stock <= 0) return;
    const existing = cart.find((c) => c.id === itemId);
    const currentQty = existing ? existing.qty : 0;
    if (currentQty + 1 > item.stock) {
      UI.toast('Only ' + item.stock + ' left in stock.');
      return;
    }
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ id: item.id, name: item.name, price: Number(item.price), qty: 1, stock: item.stock });
    }
    renderCart();
  }

  function changeQty(itemId, delta) {
    const line = cart.find((c) => c.id === itemId);
    if (!line) return;
    const newQty = line.qty + delta;
    if (newQty <= 0) {
      removeFromCart(itemId);
      return;
    }
    if (newQty > line.stock) {
      UI.toast('Only ' + line.stock + ' left in stock.');
      return;
    }
    line.qty = newQty;
    renderCart();
  }

  function removeFromCart(itemId) {
    cart = cart.filter((c) => c.id !== itemId);
    renderCart();
  }

  function clearCart() {
    cart = [];
    const paymentSelect = document.getElementById('paymentMethod');
    if (paymentSelect) paymentSelect.value = 'Cash';
    const amountPaidInput = document.getElementById('amountPaid');
    if (amountPaidInput) amountPaidInput.value = '';
    const customerNameInput = document.getElementById('payLaterCustomerName');
    if (customerNameInput) customerNameInput.value = '';
    updatePaymentFieldsVisibility();
    renderCart();
  }

  function getTotal() {
    return cart.reduce((sum, c) => sum + c.price * c.qty, 0);
  }

  function renderCart() {
    const cartList = document.getElementById('cartList');
    if (!cartList) return;

    if (cart.length === 0) {
      cartList.innerHTML = '<p class="empty-state">Cart is empty. Tap an item to add it.</p>';
    } else {
      cartList.innerHTML = cart.map((c) => (
        '<div class="cart-line" data-id="' + UI.escapeHtml(c.id) + '">' +
        '<div class="cart-line-info">' +
        '<span class="cart-line-name">' + UI.escapeHtml(c.name) + '</span>' +
        '<span class="cart-line-price">' + UI.peso(c.price) + ' each</span>' +
        '</div>' +
        '<div class="cart-line-qty">' +
        '<button type="button" class="qty-btn" data-action="dec" aria-label="Decrease quantity of ' + UI.escapeHtml(c.name) + '">' + Icon('minus') + '</button>' +
        '<span class="qty-value">' + c.qty + '</span>' +
        '<button type="button" class="qty-btn" data-action="inc" aria-label="Increase quantity of ' + UI.escapeHtml(c.name) + '">' + Icon('plus') + '</button>' +
        '</div>' +
        '<span class="cart-line-subtotal">' + UI.peso(c.price * c.qty) + '</span>' +
        '<button type="button" class="icon-btn cart-line-remove" data-action="remove" aria-label="Remove ' + UI.escapeHtml(c.name) + ' from cart">' + Icon('x') + '</button>' +
        '</div>'
      )).join('');

      cartList.querySelectorAll('.cart-line').forEach((row) => {
        const id = row.dataset.id;
        row.querySelector('[data-action="dec"]').addEventListener('click', () => changeQty(id, -1));
        row.querySelector('[data-action="inc"]').addEventListener('click', () => changeQty(id, 1));
        row.querySelector('[data-action="remove"]').addEventListener('click', () => removeFromCart(id));
      });
    }

    renderCartSummary();
  }

  function renderCartSummary() {
    const total = getTotal();
    const totalEl = document.getElementById('cartTotal');
    if (totalEl) totalEl.textContent = UI.peso(total);

    const amountPaidInput = document.getElementById('amountPaid');
    const changeEl = document.getElementById('cartChange');
    if (amountPaidInput && changeEl) {
      const paid = parseFloat(amountPaidInput.value) || 0;
      const change = Math.max(0, paid - total);
      changeEl.textContent = UI.peso(change);
    }

    const checkoutBtn = document.getElementById('checkoutBtn');
    if (checkoutBtn) checkoutBtn.disabled = cart.length === 0;
  }

  function isPayLater() {
    const select = document.getElementById('paymentMethod');
    return select && select.value === 'Pay Later';
  }

  function updatePaymentFieldsVisibility() {
    const payLater = isPayLater();
    const amountPaidRow = document.getElementById('amountPaidRow');
    const changeRow = document.getElementById('changeRow');
    const payLaterBox = document.getElementById('payLaterBox');

    if (amountPaidRow) amountPaidRow.classList.toggle('hidden', payLater);
    if (changeRow) changeRow.classList.toggle('hidden', payLater);
    if (payLaterBox) payLaterBox.classList.toggle('hidden', !payLater);

    const select = document.getElementById('paymentMethod');
    const currentValue = select ? select.value : 'Cash';
    document.querySelectorAll('.payment-method-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.paymentValue === currentValue);
    });

    if (window.GCash) GCash.updatePaymentQrVisibility();
  }

  async function checkout() {
    if (cart.length === 0) return;
    const total = getTotal();
    const methodSelect = document.getElementById('paymentMethod');
    const method = methodSelect ? methodSelect.value : 'Cash';
    const cashierInput = document.getElementById('cashierName');
    const cashier = (cashierInput && cashierInput.value.trim()) || 'Unassigned';

    let amountPaid = total;
    let change = 0;
    let customerName = '';

    if (method === 'Pay Later') {
      const nameInput = document.getElementById('payLaterCustomerName');
      customerName = nameInput ? nameInput.value.trim() : '';
      if (!customerName) {
        UI.toast('Please enter the customer name for Pay Later.');
        if (nameInput) nameInput.focus();
        return;
      }
      amountPaid = 0;
      change = 0;
    } else {
      const amountPaidInput = document.getElementById('amountPaid');
      amountPaid = parseFloat(amountPaidInput.value) || 0;
      if (amountPaid < total) {
        UI.toast('Amount paid is less than the total.');
        if (amountPaidInput) amountPaidInput.focus();
        return;
      }
      change = amountPaid - total;
    }

    const sale = {
      cashier,
      paymentMethod: method,
      customerName,
      total,
      amountPaid,
      change,
      isSettled: method !== 'Pay Later',
      items: cart.map((c) => ({ itemId: c.id, name: c.name, price: c.price, qty: c.qty, subtotal: c.price * c.qty })),
    };

    const checkoutBtn = document.getElementById('checkoutBtn');
    if (checkoutBtn) checkoutBtn.disabled = true;

    try {
      const saved = await DB.addSale(sale);
      Receipt.show(saved);
      clearCart();
      renderItemGrid();
      UI.toast('Sale recorded.');
    } catch (err) {
      UI.toast('Checkout failed: ' + err.message);
    } finally {
      if (checkoutBtn) checkoutBtn.disabled = cart.length === 0;
    }
  }

  return {
    init, renderItemGrid, addToCart, changeQty, removeFromCart, clearCart,
    getTotal, renderCart, renderCartSummary, isPayLater, updatePaymentFieldsVisibility, checkout,
  };
})();
