CREATE TABLE "ota_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firmware_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"target" jsonb NOT NULL,
	"batch_size" integer NOT NULL,
	"max_failure_pct" integer NOT NULL,
	"timeout_min" integer NOT NULL,
	"halt_reason" text,
	"created_by" uuid,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ota_job_device" (
	"job_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"state" text NOT NULL,
	"pct" double precision,
	"error" text,
	"first_sent_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ota_job_device_job_id_device_id_pk" PRIMARY KEY("job_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "ota_job" ADD CONSTRAINT "ota_job_firmware_id_firmware_id_fk" FOREIGN KEY ("firmware_id") REFERENCES "public"."firmware"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ota_job" ADD CONSTRAINT "ota_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ota_job_device" ADD CONSTRAINT "ota_job_device_job_id_ota_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ota_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ota_job_device" ADD CONSTRAINT "ota_job_device_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ota_job_device_device_idx" ON "ota_job_device" USING btree ("device_id");