CREATE TABLE "tariff" (
	"scope" text PRIMARY KEY NOT NULL,
	"customer_id" uuid,
	"currency" text NOT NULL,
	"default_rate" double precision NOT NULL,
	"periods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tariff" ADD CONSTRAINT "tariff_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;