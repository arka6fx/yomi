ALTER TABLE "subscriptions" RENAME COLUMN "stripe_customer_id" TO "razorpay_customer_id";
--> statement-breakpoint
ALTER TABLE "subscriptions" RENAME COLUMN "stripe_sub_id" TO "razorpay_sub_id";
