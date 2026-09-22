-- Per-store TikTok Pixel + Events API configuration.
-- One row per store. No row = TikTok tracking disabled (safe default).
-- Fully separate from `store_pixel_config` — TikTok data never mixes with Meta.
CREATE TABLE IF NOT EXISTS `store_tiktok_config` (
  `id`                text PRIMARY KEY NOT NULL,
  `store_id`          text NOT NULL UNIQUE REFERENCES `stores`(`id`) ON DELETE CASCADE,
  `pixel_id`          text NOT NULL,
  `ad_account_name`   text,
  `access_token`      text NOT NULL,
  `test_event_code`   text,
  `conversion_event`  text NOT NULL DEFAULT 'Purchase',
  `test_mode`         integer NOT NULL DEFAULT 0,
  `enabled`           integer NOT NULL DEFAULT 1,
  `created_at`        text NOT NULL,
  `updated_at`        text NOT NULL
);--> statement-breakpoint
-- Audit log for every TikTok Events API attempt (sent, failed, or skipped).
-- Separate from `capi_event_log` — TikTok outcomes never mix with Meta's.
CREATE TABLE IF NOT EXISTS `tiktok_event_log` (
  `id`               text PRIMARY KEY NOT NULL,
  `order_id`         text NOT NULL REFERENCES `orders`(`id`),
  `event_name`       text NOT NULL,
  `stage`            text NOT NULL DEFAULT 'delivered',
  `status`           text NOT NULL,
  `tiktok_event_id`  text,
  `error`            text,
  `sent_at`          text NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tiktok_event_log_order` ON `tiktok_event_log`(`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_tiktok_event_log_claim` ON `tiktok_event_log` (`order_id`, `stage`, `event_name`);
