CREATE TABLE "device_claim" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_claim_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "device_claim" ADD CONSTRAINT "device_claim_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_claim" ADD CONSTRAINT "device_claim_claimed_by_user_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;