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
  qr_code_id TEXT UNIQUE,
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
('news',''),('upi_vpa','Q127502433@ybl'),('upi_name','PhonePeMerchant')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings(key,value) VALUES
('price_per_id','1'),('package_1','1'),('package_2','2'),('package_5','5'),
('package_10','10'),('package_15','15'),('package_20','20')
ON CONFLICT (key) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS orders_utr_unique ON orders(LOWER(utr)) WHERE utr IS NOT NULL;


-- Anonymous website visitor analytics. No IP address or personal identity is stored.
CREATE TABLE IF NOT EXISTS site_visits (
  id BIGSERIAL PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  path TEXT NOT NULL,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS site_unique_visits (
  visitor_id TEXT NOT NULL,
  visit_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(visitor_id, visit_date)
);
CREATE INDEX IF NOT EXISTS site_visits_visited_at_idx ON site_visits(visited_at);
CREATE INDEX IF NOT EXISTS site_unique_visits_date_idx ON site_unique_visits(visit_date);
