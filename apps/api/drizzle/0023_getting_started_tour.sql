ALTER TABLE "user" ADD COLUMN "tour_completed_at" timestamp with time zone;--> statement-breakpoint
-- People who already use the app have found their way around: only new accounts see the tour.
UPDATE "user" SET "tour_completed_at" = now();
