-- Migration: batch-A backfill — columns and tables the schema declares
-- (cod-shared/db/schema.ts) but no sqlite migration ever created.
-- Mirrors PG migrations 0003 (tiktok/utm, partially) + 0004 (checkout form,
-- whatsapp) + 0005 (batch A). All additive; existing rows keep working.
-- The live Neon database received the same objects via 0003-0006 + reconcile.

-- ── 0004: checkout form + whatsapp ─────────────────────────────────────
ALTER TABLE stores ADD COLUMN checkout_form_json TEXT;
ALTER TABLE orders ADD COLUMN customer_email TEXT;
ALTER TABLE orders ADD COLUMN custom_fields_json TEXT;
ALTER TABLE stores ADD COLUMN whatsapp_widget_json TEXT;

-- ── TikTok / UTM attribution (PG 0003) ─────────────────────────────────
ALTER TABLE orders ADD COLUMN ttclid TEXT;
ALTER TABLE orders ADD COLUMN ttp TEXT;
ALTER TABLE orders ADD COLUMN utm_source TEXT;
ALTER TABLE orders ADD COLUMN utm_medium TEXT;
ALTER TABLE orders ADD COLUMN utm_campaign TEXT;

-- ── 0005: batch A ──────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN description_format TEXT NOT NULL DEFAULT 'text';
ALTER TABLE stores ADD COLUMN cart_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stores ADD COLUMN free_shipping_threshold INTEGER;
ALTER TABLE stores ADD COLUMN cart_shipping_mode TEXT NOT NULL DEFAULT 'highest';
ALTER TABLE store_pixel_config ADD COLUMN per_page_tracking_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE capi_event_log ADD COLUMN pixel_id TEXT;
ALTER TABLE abandoned_orders ADD COLUMN items_json TEXT;
ALTER TABLE abandoned_orders ADD COLUMN item_count INTEGER;

CREATE TABLE IF NOT EXISTS landing_page_pixel_config (
  id TEXT PRIMARY KEY,
  landing_page_id TEXT NOT NULL UNIQUE REFERENCES landing_pages(id) ON DELETE CASCADE,
  pixel_id TEXT NOT NULL,
  ad_account_name TEXT,
  access_token TEXT NOT NULL,
  test_event_code TEXT,
  conversion_event TEXT NOT NULL DEFAULT 'Purchase',
  test_mode INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS store_pages (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  kind TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  show_in_footer INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  template_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_pages_slug ON store_pages(store_id, slug);
CREATE INDEX IF NOT EXISTS idx_store_pages_footer ON store_pages(store_id, status, position);

CREATE TABLE IF NOT EXISTS store_page_translations (
  page_id TEXT NOT NULL REFERENCES store_pages(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  title TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_plain TEXT NOT NULL,
  meta_title TEXT,
  meta_description TEXT,
  source TEXT NOT NULL DEFAULT 'template',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (page_id, locale)
);

CREATE TABLE IF NOT EXISTS store_legal_profile (
  store_id TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  legal_name TEXT,
  rc_number TEXT,
  nif TEXT,
  address TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  return_window_days INTEGER NOT NULL DEFAULT 0,
  delivery_min_days INTEGER NOT NULL DEFAULT 2,
  delivery_max_days INTEGER NOT NULL DEFAULT 7,
  updated_at TEXT NOT NULL
);
