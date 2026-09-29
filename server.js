/**
 * server.js
 * TinDARhan POS backend: serves the static frontend and exposes a
 * REST API backed by PostgreSQL for items, sales, and login.
 */

require('dotenv').config(); // no-op in production if there's no .env file — Railway sets real env vars directly

const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { pool, initSchema, nextItemId, nextSaleId } = require('./server/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' })); // item photos travel as base64 JSON

// Only serve the actual frontend assets — never the server source or env files.
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const asyncRoute = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: 'Server error', detail: err.message });
});

function rowToItem(r) {
  return {
    id: r.id,
    name: r.name,
    farm: r.farm || '',
    image: r.image || '',
    price: Number(r.price),
    stock: r.stock,
    lowStockThreshold: r.low_stock_threshold,
    dateAdded: r.date_added,
  };
}

function rowToSale(saleRow, lineRows) {
  return {
    id: saleRow.id,
    datetime: saleRow.datetime,
    cashier: saleRow.cashier,
    paymentMethod: saleRow.payment_method,
    customerName: saleRow.customer_name || '',
    total: Number(saleRow.total),
    amountPaid: Number(saleRow.amount_paid),
    change: Number(saleRow.change),
    isSettled: !!saleRow.is_settled,
    settledAt: saleRow.settled_at,
    settledMethod: saleRow.settled_method || null,
    items: lineRows.map((l) => ({
      id: l.item_id,
      name: l.name,
      price: Number(l.price),
      qty: l.qty,
      subtotal: Number(l.subtotal),
    })),
  };
}

// ---------- health check ----------
app.get('/api/health', asyncRoute(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
}));

// ---------- auth ----------
app.post('/api/login', asyncRoute(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });

  const { rows } = await pool.query(
    'SELECT username, password_hash FROM users WHERE UPPER(username) = UPPER($1)',
    [username.trim()]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid username or password.' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password.' });

  res.json({ ok: true, username: user.username });
}));

// ---------- items ----------
app.get('/api/items', asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM items ORDER BY date_added ASC');
  res.json(rows.map(rowToItem));
}));

app.post('/api/items', asyncRoute(async (req, res) => {
  const { name, farm, image, price, stock, lowStockThreshold } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Item name is required.' });

  const id = await allocateItemId();

  const { rows } = await pool.query(
    `INSERT INTO items (id, name, farm, image, price, stock, low_stock_threshold, date_added)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     RETURNING *`,
    [id, String(name).trim(), (farm || '').trim(), image || '', Number(price) || 0, parseInt(stock, 10) || 0, parseInt(lowStockThreshold, 10) || 5]
  );
  res.status(201).json(rowToItem(rows[0]));
}));

app.put('/api/items/:id', asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { name, farm, image, price, stock, lowStockThreshold } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Item name is required.' });

  const { rows } = await pool.query(
    `UPDATE items
     SET name = $1, farm = $2, image = $3, price = $4, stock = $5, low_stock_threshold = $6
     WHERE id = $7
     RETURNING *`,
    [String(name).trim(), (farm || '').trim(), image || '', Number(price) || 0, parseInt(stock, 10) || 0, parseInt(lowStockThreshold, 10) || 5, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Item not found.' });
  res.json(rowToItem(rows[0]));
}));

app.delete('/api/items/:id', asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Item not found.' });
  res.json({ ok: true });
}));

// ---------- sales ----------
app.get('/api/sales', asyncRoute(async (req, res) => {
  const { from, to } = req.query;
  const clauses = [];
  const params = [];
  if (from) { params.push(from); clauses.push(`datetime >= $${params.length}`); }
  if (to) { params.push(to); clauses.push(`datetime <= $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows: saleRows } = await pool.query(
    `SELECT * FROM sales ${where} ORDER BY datetime DESC`,
    params
  );
  if (saleRows.length === 0) return res.json([]);

  const ids = saleRows.map((s) => s.id);
  const { rows: lineRows } = await pool.query(
    'SELECT * FROM sale_items WHERE sale_id = ANY($1) ORDER BY id ASC',
    [ids]
  );
  const linesBySale = {};
  lineRows.forEach((l) => {
    (linesBySale[l.sale_id] = linesBySale[l.sale_id] || []).push(l);
  });

  res.json(saleRows.map((s) => rowToSale(s, linesBySale[s.id] || [])));
}));

// Deletes EVERY sale (and cascades to sale_items). Inventory items/stock
// are untouched — this only clears transaction history, never products.
// Requires an exact confirmation phrase as defense-in-depth beyond the
// client's typed "DELETE" confirmation, in case this is ever called by
// something other than the confirmed UI flow.
app.delete('/api/sales', asyncRoute(async (req, res) => {
  const { confirm } = req.body || {};
  if (confirm !== 'DELETE') {
    return res.status(400).json({ error: 'Confirmation phrase does not match. Nothing was deleted.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query('DELETE FROM sales');
    // Reset the sale-id counter so the next sale starts fresh at SALE00001.
    await client.query(`DELETE FROM settings WHERE key = 'sale_seq'`);
    await client.query('COMMIT');
    res.json({ ok: true, deleted: rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

app.post('/api/sales', asyncRoute(async (req, res) => {
  const { cashier, paymentMethod, customerName, items, total, amountPaid, change } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Sale must include at least one item.' });
  }
  if (paymentMethod === 'Pay Later' && !(customerName || '').trim()) {
    return res.status(400).json({ error: 'Customer name is required for Pay Later sales.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const id = await allocateSaleId(client);
    const isSettled = (paymentMethod || 'Cash') !== 'Pay Later';
    const settledAt = isSettled ? new Date().toISOString() : null;
    await client.query(
      `INSERT INTO sales (id, datetime, cashier, payment_method, customer_name, total, amount_paid, change, is_settled, settled_at)
       VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, cashier || 'Unassigned', paymentMethod || 'Cash', (customerName || '').trim(), total || 0, amountPaid || 0, change || 0, isSettled, settledAt]
    );

    for (const line of items) {
      await client.query(
        `INSERT INTO sale_items (sale_id, item_id, name, price, qty, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, line.id, line.name, line.price, line.qty, line.subtotal]
      );
      // Deduct stock, never going below zero.
      await client.query(
        `UPDATE items SET stock = GREATEST(0, stock - $1) WHERE id = $2`,
        [line.qty, line.id]
      );
    }

    await client.query('COMMIT');

    const { rows: saleRows } = await pool.query('SELECT * FROM sales WHERE id = $1', [id]);
    const { rows: lineRows } = await pool.query('SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY id ASC', [id]);
    res.status(201).json(rowToSale(saleRows[0], lineRows));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// ---------- settle / un-settle a Pay Later sale ("mark as paid") ----------
app.post('/api/sales/:id/settle', asyncRoute(async (req, res) => {
  const rawMethod = (req.body && req.body.paymentMethod) || 'Cash';
  const settledMethod = rawMethod === 'GCash' ? 'GCash' : 'Cash'; // whitelist: anything else falls back to Cash
  const { rows } = await pool.query(
    `UPDATE sales
     SET is_settled = true, settled_at = now(), amount_paid = total, change = 0, settled_method = $2
     WHERE id = $1 AND payment_method = 'Pay Later'
     RETURNING *`,
    [req.params.id, settledMethod]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Pay Later sale not found.' });
  const { rows: lineRows } = await pool.query('SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY id ASC', [req.params.id]);
  res.json(rowToSale(rows[0], lineRows));
}));

app.post('/api/sales/:id/unsettle', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE sales
     SET is_settled = false, settled_at = NULL, amount_paid = 0, change = 0, settled_method = NULL
     WHERE id = $1 AND payment_method = 'Pay Later'
     RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Pay Later sale not found.' });
  const { rows: lineRows } = await pool.query('SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY id ASC', [req.params.id]);
  res.json(rowToSale(rows[0], lineRows));
}));

// ---------- shared settings (key/value, e.g. GCash QR code) ----------
app.get('/api/settings/:key', asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [req.params.key]);
  res.json({ key: req.params.key, value: rows[0] ? rows[0].value : null });
}));

app.put('/api/settings/:key', asyncRoute(async (req, res) => {
  const { value } = req.body || {};
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [req.params.key, value == null ? '' : String(value)]
  );
  res.json({ ok: true });
}));

// ---------- id allocation (avoids collisions across concurrent requests) ----------
async function allocateItemId() {
  const { rows } = await pool.query(
    `INSERT INTO settings (key, value)
     VALUES ('item_seq', '1')
     ON CONFLICT (key) DO UPDATE SET value = (settings.value::int + 1)::text
     RETURNING value`
  );
  return nextItemId(parseInt(rows[0].value, 10));
}

async function allocateSaleId(client) {
  const { rows } = await client.query(
    `INSERT INTO settings (key, value)
     VALUES ('sale_seq', '1')
     ON CONFLICT (key) DO UPDATE SET value = (settings.value::int + 1)::text
     RETURNING value`
  );
  return nextSaleId(parseInt(rows[0].value, 10));
}

// ---------- fallback to index.html for any other GET (e.g. a hard refresh) ----------
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`TinDARhan POS server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });
