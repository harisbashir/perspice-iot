CREATE TABLE "firmware" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"version" text NOT NULL,
	"file_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size" bigint NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "firmware" ADD CONSTRAINT "firmware_profile_id_device_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."device_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmware" ADD CONSTRAINT "firmware_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_profile_version_idx" ON "firmware" USING btree ("profile_id","version");--> statement-breakpoint
CREATE INDEX "firmware_profile_idx" ON "firmware" USING btree ("profile_id");