-- Batch A store capabilities: cart opt-in, delivery pricing, legal pages,
-- per-landing-page tracking, rich-text descriptions, basket abandonment.
-- (Upstream D1 migrations 0025_product_description_format,
-- 0026_store_delivery_pricing_settings, 0027_stores_cart_enabled,
-- 0028_abandoned_orders_items, 0029_landing_page_pixel_config,
-- 0030_store_pages — ported to Postgres.)
--
-- All additive. Existing stores keep today's behaviour: cart off, no
-- thresholds, text descriptions, single-product abandonment, store pixel.
ALTER TABLE "products" ADD COLUMN "description_format" text DEFAULT 'text' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "cart_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "free_shipping_threshold" integer;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "cart_shipping_mode" text DEFAULT 'highest' NOT NULL;
--> statement-breakpoint
ALTER TYPE "stores_lang" ADD VALUE 'fr';
--> statement-breakpoint
ALTER TABLE "store_pixel_config" ADD COLUMN "per_page_tracking_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "landing_page_pixel_config" (
  "id" text PRIMARY KEY NOT NULL,
  "landing_page_id" text NOT NULL UNIQUE REFERENCES "landing_pages"("id") ON DELETE CASCADE,
  "pixel_id" text NOT NULL,
  "ad_account_name" text,
  "access_token" text NOT NULL,
  "test_event_code" text,
  "conversion_event" "conversion_event" NOT NULL DEFAULT 'Purchase',
  "test_mode" boolean DEFAULT false NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_pages" (
  "id" text PRIMARY KEY NOT NULL,
  "store_id" text NOT NULL REFERENCES "stores"("id"),
  "kind" text NOT NULL,
  "slug" text NOT NULL,
  "status" text NOT NULL DEFAULT 'published',
  "show_in_footer" boolean DEFAULT true NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "template_version" integer,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_store_pages_slug" ON "store_pages" ("store_id","slug");
--> statement-breakpoint
CREATE INDEX "idx_store_pages_footer" ON "store_pages" ("store_id","status","position");
--> statement-breakpoint
CREATE TABLE "store_page_translations" (
  "page_id" text NOT NULL REFERENCES "store_pages"("id") ON DELETE CASCADE,
  "locale" text NOT NULL,
  "title" text NOT NULL,
  "body_html" text NOT NULL,
  "body_plain" text NOT NULL,
  "meta_title" text,
  "meta_description" text,
  "source" text DEFAULT 'template' NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "store_page_translations_pkey" PRIMARY KEY("page_id","locale")
);
--> statement-breakpoint
CREATE TABLE "store_legal_profile" (
  "store_id" text PRIMARY KEY NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "legal_name" text,
  "rc_number" text,
  "nif" text,
  "address" text,
  "contact_email" text,
  "contact_phone" text,
  "return_window_days" integer DEFAULT 0 NOT NULL,
  "delivery_min_days" integer DEFAULT 2 NOT NULL,
  "delivery_max_days" integer DEFAULT 7 NOT NULL,
  "updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capi_event_log" ADD COLUMN "pixel_id" text;
--> statement-breakpoint
ALTER TABLE "abandoned_orders" ADD COLUMN "items_json" text;
--> statement-breakpoint
ALTER TABLE "abandoned_orders" ADD COLUMN "item_count" integer;
