CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"group_id" uuid,
	"type_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"location" jsonb,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_device" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"asset_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT 'building' NOT NULL,
	"attributes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_dashboard_template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_group_id_customer_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."customer_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_type_id_asset_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."asset_type"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_parent_id_asset_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_device" ADD CONSTRAINT "asset_device_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_device" ADD CONSTRAINT "asset_device_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_type" ADD CONSTRAINT "asset_type_default_dashboard_template_id_dashboard_template_id_fk" FOREIGN KEY ("default_dashboard_template_id") REFERENCES "public"."dashboard_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_customer_idx" ON "asset" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "asset_parent_idx" ON "asset" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "asset_device_asset_idx" ON "asset_device" USING btree ("asset_id");