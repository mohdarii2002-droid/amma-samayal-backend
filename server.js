// server.js — Amma Samayal REST API
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const h = (fn) => (req, res) => {
  try { fn(req, res); }
  catch (e) { console.error(e); res.status(500).json({ error: 'server_error', message: e.message }); }
};

// ---------- COOKS ----------
app.get('/api/cooks', h((req, res) => {
  const cooks = db.prepare('SELECT id, name, area, veg, rating FROM cooks WHERE approved = 1').all();
  res.json(cooks);
}));

app.get('/api/cooks/:id/menu', h((req, res) => {
  const items = db.prepare('SELECT id, name, description, price, veg, available FROM menu_items WHERE cook_id = ?').all(req.params.id);
  res.json(items);
}));

app.post('/api/cooks/:id/menu', h((req, res) => {
  const { name, description = '', price, veg = 1 } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'name and price required' });
  const info = db.prepare('INSERT INTO menu_items (cook_id, name, description, price, veg) VALUES (?,?,?,?,?)')
                 .run(req.params.id, name, description, price, veg ? 1 : 0);
  res.status(201).json({ id: info.lastInsertRowid });
}));

app.patch('/api/menu/:id', h((req, res) => {
  const { available, price, name, description } = req.body;
  const cur = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE menu_items SET available=?, price=?, name=?, description=? WHERE id=?')
    .run(available ?? cur.available, price ?? cur.price, name ?? cur.name, description ?? cur.description, req.params.id);
  res.json({ ok: true });
}));

app.delete('/api/menu/:id', h((req, res) => {
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- ORDERS ----------
app.post('/api/orders', h((req, res) => {
  const { cookId, customerName = 'Customer', customerPhone = '', items, total, plan = 'One day' } = req.body;
  if (!cookId || !items || !total) return res.status(400).json({ error: 'cookId, items, total required' });
  const info = db.prepare('INSERT INTO orders (cook_id, customer_name, customer_phone, items_json, total, plan) VALUES (?,?,?,?,?,?)')
                 .run(cookId, customerName, customerPhone, JSON.stringify(items), total, plan);
  res.status(201).json({ id: info.lastInsertRowid, status: 'new' });
}));

app.get('/api/orders', h((req, res) => {
  let rows;
  if (req.query.cookId) rows = db.prepare('SELECT * FROM orders WHERE cook_id = ? ORDER BY id DESC').all(req.query.cookId);
  else if (req.query.customerPhone) rows = db.prepare('SELECT * FROM orders WHERE customer_phone = ? ORDER BY id DESC').all(req.query.customerPhone);
  else rows = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items_json) })));
}));

app.patch('/api/orders/:id/status', h((req, res) => {
  const { status } = req.body;
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  if (o.locked) return res.status(409).json({ error: 'order locked by admin' });
  if (status === 'out') {
    const riders = [['Murugan', '+919000011111'], ['Karthik', '+919000022222']];
    const r = riders[Math.floor(Math.random() * riders.length)];
    db.prepare('UPDATE orders SET status=?, rider_name=?, rider_phone=? WHERE id=?').run(status, r[0], r[1], req.params.id);
  } else {
    db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, req.params.id);
  }
  res.json({ ok: true, status });
}));

app.post('/api/orders/:id/rating', h((req, res) => {
  const { stars, remark = '' } = req.body;
  db.prepare('UPDATE orders SET stars=?, remark=? WHERE id=?').run(stars, remark, req.params.id);
  const o = db.prepare('SELECT cook_id FROM orders WHERE id=?').get(req.params.id);
  const avg = db.prepare('SELECT AVG(stars) AS a FROM orders WHERE cook_id=? AND stars IS NOT NULL').get(o.cook_id).a;
  db.prepare('UPDATE cooks SET rating=? WHERE id=?').run(Math.round(avg * 10) / 10, o.cook_id);
  res.json({ ok: true });
}));

// ---------- ADMIN ----------
app.patch('/api/orders/:id/lock', h((req, res) => {
  const { locked } = req.body;
  db.prepare('UPDATE orders SET locked=? WHERE id=?').run(locked ? 1 : 0, req.params.id);
  res.json({ ok: true });
}));

app.get('/api/reviews', h((req, res) => {
  const rows = db.prepare('SELECT id, cook_id, stars, remark, review_state FROM orders WHERE stars IS NOT NULL ORDER BY id DESC').all();
  res.json(rows);
}));

app.patch('/api/orders/:id/review-state', h((req, res) => {
  const { state } = req.body;
  db.prepare('UPDATE orders SET review_state=? WHERE id=?').run(state, req.params.id);
  res.json({ ok: true });
}));

app.patch('/api/cooks/:id/approve', h((req, res) => {
  const c = db.prepare('SELECT fssai FROM cooks WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  if (!c.fssai) return res.status(400).json({ error: 'FSSAI required before approval' });
  db.prepare('UPDATE cooks SET approved=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

app.get('/', (req, res) => res.json({ app: 'Amma Samayal API', status: 'running' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Amma Samayal API running on port ${PORT}`));
