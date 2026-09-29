-- Merchant-configurable storefront order form + WhatsApp widget
-- (upstream migrations 0031_checkout_form / 0032_whatsapp_widget, ported to Postgres).
--
-- Four additive nullable columns, all inert until a merchant opens the new
-- Checkout Form / WhatsApp pages. Applying this migration changes no behaviour
-- for any store that exists today.
--
-- Rollback for either feature is UPDATE ... SET <col> = NULL.
ALTER TABLE "stores" ADD COLUMN "checkout_form_json" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_email" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "custom_fields_json" text;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "whatsapp_widget_json" text;
