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
  address TEXT,
  lat REAL,
  lng REAL,
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
  locked INTEGER DEFAULT 0,
  warned INTEGER DEFAULT 0,
  FOREIGN KEY (cook_id) REFERENCES cooks(id)
);
CREATE TABLE IF NOT EXISTS owner_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT,
  attempted_role TEXT,
  existing_roles TEXT,
  name TEXT,
  cleared INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cook_id INTEGER NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  customer_lat REAL,
  customer_lng REAL,
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
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  email TEXT,
  addresses_json TEXT DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS riders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  email TEXT,
  area TEXT,
  vehicle TEXT,
  license_number TEXT,
  license_doc TEXT,
  pan_number TEXT,
  pan_doc TEXT,
  bank_account TEXT,
  bank_ifsc TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_menu_cook ON menu_items(cook_id);
CREATE INDEX IF NOT EXISTS idx_orders_cook ON orders(cook_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_rider ON orders(rider_phone);
`);

// --- migrations for older databases (ignore error if column already exists) ---
const addCol = (sql) => { try { db.exec(sql); } catch (e) { /* column exists */ } };
addCol('ALTER TABLE cooks ADD COLUMN address TEXT');
addCol('ALTER TABLE cooks ADD COLUMN lat REAL');
addCol('ALTER TABLE cooks ADD COLUMN lng REAL');
addCol('ALTER TABLE orders ADD COLUMN customer_address TEXT');
addCol('ALTER TABLE orders ADD COLUMN customer_lat REAL');
addCol('ALTER TABLE orders ADD COLUMN customer_lng REAL');
// cook profile fields for signup + approval
addCol('ALTER TABLE cooks ADD COLUMN email TEXT');
addCol('ALTER TABLE cooks ADD COLUMN experience TEXT');
addCol('ALTER TABLE cooks ADD COLUMN fssai_doc TEXT');
addCol('ALTER TABLE cooks ADD COLUMN id_doc TEXT');
addCol("ALTER TABLE cooks ADD COLUMN status TEXT DEFAULT 'pending'");
// menu item quality flags (owner can warn / lock a dish)
addCol('ALTER TABLE menu_items ADD COLUMN locked INTEGER DEFAULT 0');
addCol('ALTER TABLE menu_items ADD COLUMN warned INTEGER DEFAULT 0');

const count = db.prepare('SELECT COUNT(*) AS c FROM cooks').get().c;
if (count === 0) {
  const insCook = db.prepare('INSERT INTO cooks (name, area, phone, fssai, veg, rating, approved, address, lat, lng) VALUES (?,?,?,?,?,?,1,?,?,?)');
  const insItem = db.prepare('INSERT INTO menu_items (cook_id, name, description, price, veg) VALUES (?,?,?,?,?)');
  const c1 = insCook.run('Lakshmi Amma', 'Thiruvottiyur', '9000000001', '12345678901234', 1, 4.8,
    'TH Road, Thiruvottiyur, Chennai 600019', 13.1612, 80.3010).lastInsertRowid;
  insItem.run(c1, 'Sambar sadam + poriyal', 'Toor dal, karamani poriyal', 60, 1);
  insItem.run(c1, 'Curd rice + pickle', 'Coconut, mango pickle', 45, 1);
  insItem.run(c1, 'Chapathi (3) + kurma', 'Mixed veg kurma', 70, 1);
  const c2 = insCook.run('Fathima Kitchen', 'Thiruvottiyur', '9000000002', '98765432109876', 0, 4.9,
    'Ennore High Road, Thiruvottiyur, Chennai 600019', 13.1555, 80.3045).lastInsertRowid;
  insItem.run(c2, 'Chicken biryani', 'Seeraga samba, raita free', 120, 0);
  insItem.run(c2, 'Egg curry + chapathi', '2 egg, 3 chapathi', 90, 0);
}

// seed a couple of approved delivery partners so delivery can be tested
const rcount = db.prepare('SELECT COUNT(*) AS c FROM riders').get().c;
if (rcount === 0) {
  const insR = db.prepare("INSERT INTO riders (name, phone, email, area, vehicle, license_number, pan_number, status) VALUES (?,?,?,?,?,?,?,'approved')");
  insR.run('Murugan', '9000011111', 'murugan@example.com', 'Thiruvottiyur', 'TN01 AB 1234', 'TN0120210001234', 'ABCDE1234F');
  insR.run('Karthik', '9000022222', 'karthik@example.com', 'Thiruvottiyur', 'TN01 CD 5678', 'TN0120210005678', 'ZYXWV9876E');
}

// keep cook status in sync with approved flag (approved demo cooks -> 'approved')
try { db.exec("UPDATE cooks SET status='approved' WHERE approved=1"); } catch (e) {}
try { db.exec("UPDATE cooks SET status='pending' WHERE approved=0 AND (status IS NULL OR status='')"); } catch (e) {}

module.exports = db;
