CREATE TABLE "dashboard_instance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"customer_id" uuid,
	"override_definition" jsonb,
	"override_base_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_instance_template_customer_uq" UNIQUE NULLS NOT DISTINCT("template_id","customer_id")
);
--> statement-breakpoint
CREATE TABLE "dashboard_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"profile_id" uuid,
	"definition" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"customer_id" uuid,
	"kind" text NOT NULL,
	"format" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"row_count" integer,
	"file_key" text,
	"error" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_profile" ADD COLUMN "default_dashboard_template_id" uuid;--> statement-breakpoint
ALTER TABLE "dashboard_instance" ADD CONSTRAINT "dashboard_instance_template_id_dashboard_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."dashboard_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_instance" ADD CONSTRAINT "dashboard_instance_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_template" ADD CONSTRAINT "dashboard_template_profile_id_device_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."device_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dashboard_instance_customer_idx" ON "dashboard_instance" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "dashboard_template_profile_idx" ON "dashboard_template" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "export_job_user_idx" ON "export_job" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "export_job_expires_idx" ON "export_job" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "device_profile" ADD CONSTRAINT "device_profile_default_dashboard_template_id_dashboard_template_id_fk" FOREIGN KEY ("default_dashboard_template_id") REFERENCES "public"."dashboard_template"("id") ON DELETE set null ON UPDATE no action;