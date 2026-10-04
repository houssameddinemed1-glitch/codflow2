CREATE TYPE "public"."landing_pages_kind" AS ENUM('single', 'multi');--> statement-breakpoint
CREATE TABLE "landing_page_products" (
	"id" text PRIMARY KEY NOT NULL,
	"landing_page_id" text NOT NULL,
	"product_id" text NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "landing_pages" ADD COLUMN "kind" "landing_pages_kind" DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "landing_page_products" ADD CONSTRAINT "landing_page_products_landing_page_id_landing_pages_id_fk" FOREIGN KEY ("landing_page_id") REFERENCES "public"."landing_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_page_products" ADD CONSTRAINT "landing_page_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_landing_page_products_lp" ON "landing_page_products" USING btree ("landing_page_id","position");--> statement-breakpoint
CREATE INDEX "idx_landing_page_products_product" ON "landing_page_products" USING btree ("product_id");
