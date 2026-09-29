/**
 * storage.js
 * Thin async API client wrapping fetch() calls to the Express/PostgreSQL
 * backend. Every method returns a Promise; UI code awaits these instead
 * of touching localStorage directly.
 */
const DB = (() => {
  async function _json(res) {
    let body = null;
    try { body = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const msg = (body && body.error) ? body.error : ('Request failed (' + res.status + ')');
      throw new Error(msg);
    }
    return body;
  }

  return {
    // ---- Items ----
    async getItems() {
      const res = await fetch('/api/items');
      return _json(res);
    },
    async addItem(item) {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      return _json(res);
    },
    async updateItem(id, item) {
      const res = await fetch('/api/items/' + encodeURIComponent(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      return _json(res);
    },
    async deleteItem(id) {
      const res = await fetch('/api/items/' + encodeURIComponent(id), { method: 'DELETE' });
      return _json(res);
    },

    // ---- Sales ----
    async getSales(range) {
      let url = '/api/sales';
      if (range && (range.from || range.to)) {
        const params = new URLSearchParams();
        if (range.from) params.set('from', range.from);
        if (range.to) params.set('to', range.to);
        url += '?' + params.toString();
      }
      const res = await fetch(url);
      return _json(res);
    },
    async addSale(sale) {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sale),
      });
      return _json(res);
    },
    async settleSale(id, paymentMethod) {
      const res = await fetch('/api/sales/' + encodeURIComponent(id) + '/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentMethod: paymentMethod || 'Cash' }),
      });
      return _json(res);
    },
    async unsettleSale(id) {
      const res = await fetch('/api/sales/' + encodeURIComponent(id) + '/unsettle', { method: 'POST' });
      return _json(res);
    },
    async deleteAllSales() {
      const res = await fetch('/api/sales', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      return _json(res);
    },

    // ---- Settings ----
    async getSetting(key) {
      const res = await fetch('/api/settings/' + encodeURIComponent(key));
      const data = await _json(res);
      return data ? data.value : null;
    },
    async setSetting(key, value) {
      const res = await fetch('/api/settings/' + encodeURIComponent(key), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      return _json(res);
    },

    // ---- Auth ----
    async login(username, password) {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      return _json(res);
    },
  };
})();
