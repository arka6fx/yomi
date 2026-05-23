-- Extend Better Auth user table: role, plan, subscription, trial, daily limits
ALTER TABLE "user" ADD COLUMN "role" text NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "plan" text NOT NULL DEFAULT 'explore';
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "subscription_status" text NOT NULL DEFAULT 'inactive';
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "trial_start_date" timestamp;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "trial_end_date" timestamp;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "current_period_end" timestamp;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "razorpay_customer_id" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "razorpay_sub_id" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "daily_chat_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "daily_voice_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "daily_image_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "agent_usage_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "daily_reset_date" text;
