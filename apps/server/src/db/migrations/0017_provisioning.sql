CREATE TABLE "provisioning_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text NOT NULL,
	"mode" text NOT NULL,
	"customer_id" uuid,
	"group_id" uuid,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"issue_claim_codes" boolean DEFAULT false NOT NULL,
	"allow_reprovision" boolean DEFAULT false NOT NULL,
	"max_devices" integer,
	"provisioned_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provisioning_key_secret_hash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "serial" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "provisioned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provisioning_key" ADD CONSTRAINT "provisioning_key_profile_id_device_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."device_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_key" ADD CONSTRAINT "provisioning_key_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_key" ADD CONSTRAINT "provisioning_key_group_id_customer_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."customer_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_key" ADD CONSTRAINT "provisioning_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provisioning_key_profile_idx" ON "provisioning_key" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_profile_serial_idx" ON "device" USING btree ("profile_id","serial") WHERE "device"."serial" IS NOT NULL;