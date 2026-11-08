// server.js — Amma Samayal REST API
// Run: npm install  &&  npm start   (server on http://localhost:4000)
// Customer / Cook / Admin apps call these endpoints over the network.

const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());            // allow the apps (different origin) to call this API
app.use(express.json());    // parse JSON bodies
app.use(express.static('public')); // serve the app (public/index.html) from the SAME origin as the API

// tiny helper: wrap each route so one error never crashes the server
const h = (fn) => (req, res) => {
  try { fn(req, res); }
  catch (e) { console.error(e); res.status(500).json({ error: 'server_error', message: e.message }); }
};

// ---------- EMAIL (Resend) ----------
// Sends an approval email. No-op (logged) if RESEND_API_KEY is not set.
async function sendApprovalEmail(to, name, role, approved) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) { console.log('[email] skipped (no key or no recipient):', to); return; }
  const from = process.env.RESEND_FROM || 'Amma Samayal <onboarding@resend.dev>';
  const roleName = role === 'cook' ? 'Cook Partner' : 'Delivery Partner';
  const subject = approved
    ? `Amma Samayal — Your ${roleName} account is approved ✅`
    : `Amma Samayal — ${roleName} application update`;
  const html = approved
    ? `<div style="font-family:sans-serif"><h2>Vanakkam ${name || ''} 🙏</h2><p>Your <b>${roleName}</b> account on <b>Amma Samayal</b> has been <b style="color:#17794a">approved</b>. You can now log in with your phone number and OTP and start ${role === 'cook' ? 'receiving orders' : 'delivering orders'}.</p><p>Open the app: <a href="https://amma-samayal-backend.onrender.com">amma-samayal-backend.onrender.com</a></p><p>— Team Amma Samayal</p></div>`
    : `<div style="font-family:sans-serif"><h2>Vanakkam ${name || ''}</h2><p>Thank you for applying as a <b>${roleName}</b> on Amma Samayal. Unfortunately your application was not approved at this time. Please contact support for details.</p><p>— Team Amma Samayal</p></div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html })
    });
    const j = await r.json().catch(() => ({}));
    console.log('[email]', r.status, j.id || j.message || '');
  } catch (e) { console.error('[email] error', e.message); }
}

// ---------- COOKS ----------
// List approved cooks (customer app home)
app.get('/api/cooks', h((req, res) => {
  const cooks = db.prepare('SELECT id, name, area, veg, rating, phone, address, lat, lng FROM cooks WHERE approved = 1').all();
  res.json(cooks);
}));

// One cook's available menu (customer app)
app.get('/api/cooks/:id/menu', h((req, res) => {
  const items = db.prepare('SELECT id, name, description, price, veg, available FROM menu_items WHERE cook_id = ?').all(req.params.id);
  res.json(items);
}));

// Cook adds a new dish  ->  instantly visible to customers
app.post('/api/cooks/:id/menu', h((req, res) => {
  const { name, description = '', price, veg = 1 } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'name and price required' });
  const info = db.prepare('INSERT INTO menu_items (cook_id, name, description, price, veg) VALUES (?,?,?,?,?)')
                 .run(req.params.id, name, description, price, veg ? 1 : 0);
  res.status(201).json({ id: info.lastInsertRowid });
}));

// Cook toggles availability / edits a dish
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
// Customer places an order
app.post('/api/orders', h((req, res) => {
  const { cookId, customerName = 'Customer', customerPhone = '', customerAddress = '', customerLat = null, customerLng = null, items, total, plan = 'One day' } = req.body;
  if (!cookId || !items || !total) return res.status(400).json({ error: 'cookId, items, total required' });
  const info = db.prepare('INSERT INTO orders (cook_id, customer_name, customer_phone, customer_address, customer_lat, customer_lng, items_json, total, plan) VALUES (?,?,?,?,?,?,?,?,?)')
                 .run(cookId, customerName, customerPhone, customerAddress, customerLat, customerLng, JSON.stringify(items), total, plan);
  res.status(201).json({ id: info.lastInsertRowid, status: 'new' });
}));

// List orders (admin = all; cook app = ?cookId=; customer = ?customerPhone=)
app.get('/api/orders', h((req, res) => {
  let rows;
  if (req.query.cookId) rows = db.prepare('SELECT * FROM orders WHERE cook_id = ? ORDER BY id DESC').all(req.query.cookId);
  else if (req.query.customerPhone) rows = db.prepare('SELECT * FROM orders WHERE customer_phone = ? ORDER BY id DESC').all(req.query.customerPhone);
  else if (req.query.available) rows = db.prepare("SELECT * FROM orders WHERE status = 'ready' AND (rider_phone IS NULL OR rider_phone = '') ORDER BY id ASC").all();
  else if (req.query.riderPhone) rows = db.prepare("SELECT * FROM orders WHERE rider_phone = ? AND status IN ('assigned','out','arrived') ORDER BY id ASC").all(req.query.riderPhone);
  else rows = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items_json) })));
}));

// Status flow: new -> cooking -> ready -> assigned -> out -> arrived -> delivered (rejected)
// Cook sets: cooking, ready, rejected.  Delivery sets: out, arrived.  Customer sets: delivered.
app.patch('/api/orders/:id/status', h((req, res) => {
  const { status } = req.body;
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  if (o.locked) return res.status(409).json({ error: 'order locked by admin' });
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ ok: true, status });
}));

// Delivery partner accepts a ready order (assigns themselves). 409 if already taken.
app.patch('/api/orders/:id/accept-delivery', h((req, res) => {
  const { riderName, riderPhone } = req.body;
  if (!riderName || !riderPhone) return res.status(400).json({ error: 'riderName and riderPhone required' });
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  if (o.status !== 'ready' || (o.rider_phone && o.rider_phone !== '')) {
    return res.status(409).json({ error: 'already taken' });
  }
  db.prepare("UPDATE orders SET rider_name=?, rider_phone=?, status='assigned' WHERE id=?").run(riderName, riderPhone, req.params.id);
  res.json({ ok: true, status: 'assigned' });
}));

// Customer rates a delivered order
app.post('/api/orders/:id/rating', h((req, res) => {
  const { stars, remark = '' } = req.body;
  db.prepare('UPDATE orders SET stars=?, remark=? WHERE id=?').run(stars, remark, req.params.id);
  // recompute cook average rating
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

// Bad reviews (stars <= 2) for the admin quality screen
app.get('/api/reviews', h((req, res) => {
  const rows = db.prepare('SELECT id, cook_id, stars, remark, review_state FROM orders WHERE stars IS NOT NULL ORDER BY id DESC').all();
  res.json(rows);
}));

app.patch('/api/orders/:id/review-state', h((req, res) => {
  const { state } = req.body; // warned | complaint
  db.prepare('UPDATE orders SET review_state=? WHERE id=?').run(state, req.params.id);
  res.json({ ok: true });
}));

// Admin approves / rejects a cook  (body: { decision: 'approve' | 'reject' })
app.patch('/api/cooks/:id/approve', h((req, res) => {
  const decision = (req.body && req.body.decision) || 'approve';
  const c = db.prepare('SELECT * FROM cooks WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  if (decision === 'approve') {
    db.prepare("UPDATE cooks SET approved=1, status='approved' WHERE id=?").run(req.params.id);
    sendApprovalEmail(c.email, c.name, 'cook', true);
  } else {
    db.prepare("UPDATE cooks SET approved=0, status='rejected' WHERE id=?").run(req.params.id);
    sendApprovalEmail(c.email, c.name, 'cook', false);
  }
  res.json({ ok: true, status: decision === 'approve' ? 'approved' : 'rejected' });
}));

// ---------- ACCOUNTS (signup / login lookup) ----------
// Does this phone already have an account for this role? + status
app.get('/api/account', h((req, res) => {
  const { role, phone } = req.query;
  if (!role || !phone) return res.status(400).json({ error: 'role and phone required' });
  if (role === 'customer') {
    const c = db.prepare('SELECT phone, name, email, addresses_json FROM customers WHERE phone=?').get(phone);
    return res.json({ exists: !!c, profile: c ? { ...c, addresses: JSON.parse(c.addresses_json || '[]') } : null });
  }
  if (role === 'cook') {
    const c = db.prepare('SELECT id, name, phone, email, status, approved FROM cooks WHERE phone=?').get(phone);
    return res.json({ exists: !!c, status: c ? c.status : null, cook: c || null });
  }
  if (role === 'rider') {
    const r = db.prepare('SELECT id, name, phone, email, status FROM riders WHERE phone=?').get(phone);
    return res.json({ exists: !!r, status: r ? r.status : null, rider: r || null });
  }
  res.status(400).json({ error: 'bad role' });
}));

// Customer signup / upsert
app.post('/api/customers', h((req, res) => {
  const { phone, name = '', email = '', addresses = [] } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const addrJson = JSON.stringify(Array.isArray(addresses) ? addresses : []);
  const existing = db.prepare('SELECT phone FROM customers WHERE phone=?').get(phone);
  if (existing) {
    db.prepare('UPDATE customers SET name=?, email=?, addresses_json=? WHERE phone=?').run(name, email, addrJson, phone);
  } else {
    db.prepare('INSERT INTO customers (phone, name, email, addresses_json) VALUES (?,?,?,?)').run(phone, name, email, addrJson);
  }
  res.status(201).json({ ok: true });
}));

app.get('/api/customers/:phone', h((req, res) => {
  const c = db.prepare('SELECT phone, name, email, addresses_json FROM customers WHERE phone=?').get(req.params.phone);
  if (!c) return res.status(404).json({ error: 'not found' });
  res.json({ ...c, addresses: JSON.parse(c.addresses_json || '[]') });
}));

// Replace a customer's saved addresses (array of {label,text,lat,lng})
app.put('/api/customers/:phone/addresses', h((req, res) => {
  const { addresses = [] } = req.body;
  const c = db.prepare('SELECT phone FROM customers WHERE phone=?').get(req.params.phone);
  if (!c) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE customers SET addresses_json=? WHERE phone=?').run(JSON.stringify(addresses), req.params.phone);
  res.json({ ok: true });
}));

// Cook signup -> pending approval
app.post('/api/cook-signup', h((req, res) => {
  const { name, phone, email = '', experience = '', fssai = '', fssai_doc = '', id_doc = '',
          area = 'Thiruvottiyur', veg = 1, address = '', lat = null, lng = null } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
  if (db.prepare('SELECT id FROM cooks WHERE phone=?').get(phone)) return res.status(409).json({ error: 'phone already registered' });
  const info = db.prepare(`INSERT INTO cooks (name, area, phone, fssai, veg, rating, approved, address, lat, lng, email, experience, fssai_doc, id_doc, status)
    VALUES (?,?,?,?,?,0,0,?,?,?,?,?,?,?,'pending')`)
    .run(name, area, phone, fssai, veg ? 1 : 0, address, lat, lng, email, experience, fssai_doc, id_doc);
  res.status(201).json({ id: info.lastInsertRowid, status: 'pending' });
}));

// Rider signup -> pending approval
app.post('/api/riders', h((req, res) => {
  const { name, phone, email = '', area = 'Thiruvottiyur', vehicle = '', license_number = '', license_doc = '',
          pan_number = '', pan_doc = '', bank_account = '', bank_ifsc = '' } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
  if (db.prepare('SELECT id FROM riders WHERE phone=?').get(phone)) return res.status(409).json({ error: 'phone already registered' });
  const info = db.prepare(`INSERT INTO riders (name, phone, email, area, vehicle, license_number, license_doc, pan_number, pan_doc, bank_account, bank_ifsc, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending')`)
    .run(name, phone, email, area, vehicle, license_number, license_doc, pan_number, pan_doc, bank_account, bank_ifsc);
  res.status(201).json({ id: info.lastInsertRowid, status: 'pending' });
}));

// Admin: list of pending cooks + riders (with full details for verification)
app.get('/api/admin/pending', h((req, res) => {
  const cooks = db.prepare("SELECT * FROM cooks WHERE status='pending' ORDER BY id DESC").all();
  const riders = db.prepare("SELECT * FROM riders WHERE status='pending' ORDER BY id DESC").all();
  res.json({ cooks, riders });
}));

// Admin: all riders (for admin view)
app.get('/api/riders', h((req, res) => {
  res.json(db.prepare('SELECT * FROM riders ORDER BY id DESC').all());
}));

// Admin approves / rejects a rider  (body: { decision })
app.patch('/api/riders/:id/approve', h((req, res) => {
  const decision = (req.body && req.body.decision) || 'approve';
  const r = db.prepare('SELECT * FROM riders WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const status = decision === 'approve' ? 'approved' : 'rejected';
  db.prepare('UPDATE riders SET status=? WHERE id=?').run(status, req.params.id);
  sendApprovalEmail(r.email, r.name, 'rider', decision === 'approve');
  res.json({ ok: true, status });
}));

app.get('/', (req, res) => res.json({ app: 'Amma Samayal API', status: 'running' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Amma Samayal API running on http://localhost:${PORT}`));
