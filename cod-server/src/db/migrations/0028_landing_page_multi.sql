-- Migration: multi-product ("smart") landing pages — picker grid of product cards.
-- Additive: kind defaults 'single' so every existing page keeps rendering;
-- picks live in landing_page_products ordered by position. product_id stays
-- the cover product (first pick) so list/compare/attribution keep working.

ALTER TABLE landing_pages ADD COLUMN kind TEXT NOT NULL DEFAULT 'single';

CREATE TABLE IF NOT EXISTS landing_page_products (
  id TEXT PRIMARY KEY,
  landing_page_id TEXT NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  position INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_landing_page_products_lp ON landing_page_products(landing_page_id, position);
CREATE INDEX IF NOT EXISTS idx_landing_page_products_product ON landing_page_products(product_id);
