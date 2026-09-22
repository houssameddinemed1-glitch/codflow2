-- Per-store order form variation selection.
-- One row per store. No row = Default form (safe default, existing behavior).
-- Stores only the active variant key; the designs live in the theme layer
-- (cod-astro/theme01/src/theme/components/order/variants/).
CREATE TABLE IF NOT EXISTS `store_form_config` (
  `id`          text PRIMARY KEY NOT NULL,
  `store_id`    text NOT NULL UNIQUE REFERENCES `stores`(`id`) ON DELETE CASCADE,
  `variant`     text NOT NULL DEFAULT 'default',
  `created_at`  text NOT NULL,
  `updated_at`  text NOT NULL
);
