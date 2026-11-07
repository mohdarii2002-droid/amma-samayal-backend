// db.js — SQLite database setup + seed data for Amma Samayal
const Database = require('better-sqlite3');
const db = new Database('data.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS cooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  area TEXT,
  phone TEXT,
  fssai TEXT,
  veg INTEGER DEFAULT 1,
  rating REAL DEFAULT 0,
  approved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cook_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  veg INTEGER DEFAULT 1,
  available INTEGER DEFAULT 1,
  FOREIGN KEY (cook_id) REFERENCES cooks(id)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cook_id INTEGER NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  items_json TEXT NOT NULL,
  total INTEGER NOT NULL,
  plan TEXT,
  status TEXT DEFAULT 'new',
  locked INTEGER DEFAULT 0,
  rider_name TEXT,
  rider_phone TEXT,
  stars INTEGER,
  remark TEXT,
  review_state TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_menu_cook ON menu_items(cook_id);
CREATE INDEX IF NOT EXISTS idx_orders_cook ON orders(cook_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
`);

const count = db.prepare('SELECT COUNT(*) AS c FROM cooks').get().c;
if (count === 0) {
  const insCook = db.prepare('INSERT INTO cooks (name, area, phone, fssai, veg, rating, approved) VALUES (?,?,?,?,?,?,1)');
  const insItem = db.prepare('INSERT INTO menu_items (cook_id, name, description, price, veg) VALUES (?,?,?,?,?)');
  const c1 = insCook.run('Lakshmi Amma', 'Thiruvottiyur', '+919000000001', '12345678901234', 1, 4.8).lastInsertRowid;
  insItem.run(c1, 'Sambar sadam + poriyal', 'Toor dal, karamani poriyal', 60, 1);
  insItem.run(c1, 'Curd rice + pickle', 'Coconut, mango pickle', 45, 1);
  insItem.run(c1, 'Chapathi (3) + kurma', 'Mixed veg kurma', 70, 1);
  const c2 = insCook.run('Fathima Kitchen', 'Thiruvottiyur', '+919000000002', '98765432109876', 0, 4.9).lastInsertRowid;
  insItem.run(c2, 'Chicken biryani', 'Seeraga samba, raita free', 120, 0);
  insItem.run(c2, 'Egg curry + chapathi', '2 egg, 3 chapathi', 90, 0);
}

module.exports = db;
