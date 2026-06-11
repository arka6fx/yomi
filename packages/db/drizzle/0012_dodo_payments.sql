ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "dodo_customer_id" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "dodo_subscription_id" text;
--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN IF EXISTS "razorpay_customer_id";
--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN IF EXISTS "razorpay_sub_id";
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'razorpay_customer_id'
 ) AND NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'provider_customer_id'
 ) THEN
  ALTER TABLE "subscriptions" RENAME COLUMN "razorpay_customer_id" TO "provider_customer_id";
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'razorpay_sub_id'
 ) AND NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'provider_subscription_id'
 ) THEN
  ALTER TABLE "subscriptions" RENAME COLUMN "razorpay_sub_id" TO "provider_subscription_id";
 END IF;
END $$;
