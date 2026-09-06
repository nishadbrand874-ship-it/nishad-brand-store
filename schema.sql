CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
  id BIGSERIAL PRIMARY KEY,
  login_id TEXT NOT NULL,
  login_password TEXT,
  extra_data TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','sold')),
  reserved_order_id TEXT,
  sold_order_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT UNIQUE NOT NULL,
  package_qty INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  payment_id TEXT,
  utr TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  fulfilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  inventory_id BIGINT NOT NULL REFERENCES inventory(id),
  UNIQUE(order_id, inventory_id)
);

INSERT INTO settings(key,value) VALUES
('site_name','NISHAD BRAND'),
('whatsapp_number','9296271001'),
('logo_data',''),
('qr_data',''),
('news','')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings(key,value) VALUES
('price_per_id','180'),('package_1','180'),('package_2','360'),('package_5','900'),
('package_10','1800'),('package_15','2700'),('package_20','3600')
ON CONFLICT (key) DO NOTHING;
