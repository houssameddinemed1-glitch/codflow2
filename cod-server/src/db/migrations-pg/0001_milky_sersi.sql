CREATE TYPE "public"."lp_image_upload_job_status" AS ENUM('processing', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "lp_image_upload_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"landing_page_id" text NOT NULL,
	"r2_key" text NOT NULL,
	"status" "lp_image_upload_job_status" DEFAULT 'processing' NOT NULL,
	"error" text,
	"image_id" text,
	"src" text,
	"position" integer,
	"width" integer,
	"height" integer,
	"alt_text" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lp_image_upload_jobs" ADD CONSTRAINT "lp_image_upload_jobs_landing_page_id_landing_pages_id_fk" FOREIGN KEY ("landing_page_id") REFERENCES "public"."landing_pages"("id") ON DELETE cascade ON UPDATE no action;