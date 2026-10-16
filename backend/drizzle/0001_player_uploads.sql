ALTER TABLE "players" ADD COLUMN "photo_type" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "photo_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "birth_cert_type" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "birth_cert_uploaded_at" timestamp with time zone;