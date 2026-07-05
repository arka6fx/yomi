// Script to locally test the Dodo webhook handler.
// Run with: bun run --env-file .env src/test-local-webhook.ts
import { db, creditAccounts } from "@yomi/db"
import { user } from "./auth-schema.js"
import { eq } from "drizzle-orm"
import { createHmac } from "node:crypto"

const TARGET_URL = "http://127.0.0.1:3001/api/billing/webhook"

function requiredEnv(name: string): string {
  const val = process.env[name]?.trim()
  if (!val) throw new Error(`Required environment variable ${name} is not set`)
  return val
}

async function sendWebhook(
  body: Record<string, any>,
  secret: string,
): Promise<{ status: number; text: string }> {
  const rawBody = JSON.stringify(body)
  const webhookId = `wh_test_${Math.random().toString(36).substring(2, 11)}`
  const timestamp = Math.floor(Date.now() / 1000).toString()

  const signedPayload = `${webhookId}.${timestamp}.${rawBody}`
  const cleanSecret = secret.replace(/^\uFEFF/, "")
  const normalizedSecret = cleanSecret.startsWith("whsec_")
    ? cleanSecret.slice("whsec_".length)
    : cleanSecret
  const key = cleanSecret.startsWith("whsec_")
    ? Buffer.from(normalizedSecret, "base64")
    : Buffer.from(normalizedSecret)

  const signature = createHmac("sha256", key).update(signedPayload).digest("base64")

  const response = await fetch(TARGET_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
    body: rawBody,
  })

  return {
    status: response.status,
    text: await response.text(),
  }
}

async function run() {
  console.log("=== Testing Webhooks Locally ===")

  // 1. Load config
  const dodoEnv = requiredEnv("DODO_ENV")
  console.log(`DODO_ENV: ${dodoEnv}`)
  if (dodoEnv !== "test") {
    console.warn(
      "WARNING: DODO_ENV is not set to 'test'. Local webhook tests should be run in test mode.",
    )
  }

  const webhookSecret = requiredEnv("DODO_TEST_WEBHOOK_SECRET")
  console.log("DODO_TEST_WEBHOOK_SECRET is loaded.")

  // 2. Fetch or create a test user
  console.log("Connecting to database...")

  let [testUser] = await db
    .select()
    .from(user)
    .where(eq(user.email, "arkagarai292@gmail.com"))
    .limit(1)

  if (!testUser) {
    const usersList = await db.select().from(user).limit(1)
    testUser = usersList[0]
  }

  if (!testUser) {
    console.log("No users found in database. Creating a test user...")
    const result = await db
      .insert(user)
      .values({
        id: `usr_test_${Math.random().toString(36).substring(2, 11)}`,
        email: "test_user_webhook@example.com",
        name: "Webhook Test User",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
    testUser = result[0]
  }

  if (!testUser) {
    throw new Error("Failed to find or create a test user in database.")
  }

  console.log(`Using test user: ID=${testUser.id}, Email=${testUser.email}, Name=${testUser.name}`)
  console.log(
    `Initial User Status: plan=${testUser.plan}, subscriptionStatus=${testUser.subscriptionStatus}`,
  )

  // 3. Test subscription.active event
  console.log("\nSending 'subscription.active' webhook event for 'pro' plan...")
  const subActiveEvent = {
    type: "subscription.active",
    data: {
      id: `sub_test_${Math.random().toString(36).substring(2, 11)}`,
      customer_id: `cus_test_${Math.random().toString(36).substring(2, 11)}`,
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: {
        userId: testUser.id,
        kind: "subscription",
        plan: "pro",
      },
    },
  }

  const subRes = await sendWebhook(subActiveEvent, webhookSecret)
  console.log(`Response Status: ${subRes.status}`)
  console.log(`Response Body: ${subRes.text}`)

  // Verify updates in database
  const [updatedUserRecord] = await db.select().from(user).where(eq(user.id, testUser.id)).limit(1)
  console.log(
    `Post-Webhook User Status: plan=${updatedUserRecord?.plan}, subscriptionStatus=${updatedUserRecord?.subscriptionStatus}, dodoSubscriptionId=${updatedUserRecord?.dodoSubscriptionId}`,
  )

  if (updatedUserRecord?.plan === "pro" && updatedUserRecord?.subscriptionStatus === "active") {
    console.log("✅ subscription.active webhook test PASSED!")
  } else {
    console.log("❌ subscription.active webhook test FAILED!")
  }

  // 4. Test payment.succeeded event (credit packs)
  console.log("\nSending 'payment.succeeded' webhook event for 'credits_500' pack...")
  const creditPackEvent = {
    type: "payment.succeeded",
    data: {
      id: `pay_test_${Math.random().toString(36).substring(2, 11)}`,
      checkout_id: `chk_test_${Math.random().toString(36).substring(2, 11)}`,
      customer_id: `cus_test_${Math.random().toString(36).substring(2, 11)}`,
      amount: 499, // cents
      currency: "USD",
      metadata: {
        userId: testUser.id,
        kind: "credit_pack",
        productKey: "credits_500",
      },
    },
  }

  const creditRes = await sendWebhook(creditPackEvent, webhookSecret)
  console.log(`Response Status: ${creditRes.status}`)
  console.log(`Response Body: ${creditRes.text}`)

  // Check user credits
  // Since user tables and credits tables exist, let's verify if payment_records or credit_grants was created
  // Wait, let's query credit account if any
  console.log("Checking if credits were updated/granted...")
  const [userCredits] = await db
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.userId, testUser!.id))
  console.log(`User Credits: ${JSON.stringify(userCredits ?? "No credit account found")}`)

  if (creditRes.status === 200) {
    console.log("✅ payment.succeeded webhook test PASSED!")
  } else {
    console.log("❌ payment.succeeded webhook test FAILED!")
  }

  // 5. Test subscription.cancelled event
  console.log("\nSending 'subscription.cancelled' webhook event...")
  const subCancelledEvent = {
    type: "subscription.cancelled",
    data: {
      id: updatedUserRecord?.dodoSubscriptionId || "sub_test_id",
      metadata: {
        userId: testUser.id,
      },
    },
  }

  const cancelRes = await sendWebhook(subCancelledEvent, webhookSecret)
  console.log(`Response Status: ${cancelRes.status}`)
  console.log(`Response Body: ${cancelRes.text}`)

  const [cancelledUserRecord] = await db
    .select()
    .from(user)
    .where(eq(user.id, testUser.id))
    .limit(1)
  console.log(
    `Post-Cancel User Status: plan=${cancelledUserRecord?.plan}, subscriptionStatus=${cancelledUserRecord?.subscriptionStatus}`,
  )

  if (
    cancelledUserRecord?.plan === "explore" &&
    cancelledUserRecord?.subscriptionStatus === "inactive"
  ) {
    console.log("✅ subscription.cancelled webhook test PASSED!")
  } else {
    console.log("❌ subscription.cancelled webhook test FAILED!")
  }
}

run()
  .catch((err) => {
    console.error("Test execution failed:", err)
    process.exit(1)
  })
  .then(() => {
    process.exit(0)
  })
