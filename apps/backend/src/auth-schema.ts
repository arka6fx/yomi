import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"

// Better Auth core tables — text PKs to match Better Auth's default ID generation
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  // Role: "user" | "owner"
  role: text("role").notNull().default("user"),
  // Plan: "explore" | "pro" | "max"
  plan: text("plan").notNull().default("explore"),
  subscriptionStatus: text("subscription_status").notNull().default("inactive"),
  trialStartDate: timestamp("trial_start_date"),
  trialEndDate: timestamp("trial_end_date"),
  currentPeriodEnd: timestamp("current_period_end"),
  dodoCustomerId: text("dodo_customer_id"),
  dodoSubscriptionId: text("dodo_subscription_id"),
  // Explore interaction pool — shared across Type A/B/C for the free plan
  trialInteractionUsed: integer("trial_interaction_used").notNull().default(0),
  trialInteractionLimit: integer("trial_interaction_limit").notNull().default(100),
  // Daily usage counters — reset each UTC day via dailyResetDate (Pro/Max plans)
  dailyChatCount: integer("daily_chat_count").notNull().default(0),
  dailyVoiceCount: integer("daily_voice_count").notNull().default(0),
  dailyImageCount: integer("daily_image_count").notNull().default(0),
  agentUsageCount: integer("agent_usage_count").notNull().default(0),
  dailyResetDate: text("daily_reset_date"), // YYYY-MM-DD
  // Per-user agent personality ("soul"), captured via first-contact onboarding on
  // off-device platforms. null = use the built-in default soul.
  agentSoul: text("agent_soul"),
  // Onboarding state machine: "unprompted" -> "awaiting" -> "done".
  soulOnboarding: text("soul_onboarding").notNull().default("unprompted"),
  // Debounced Telegram nudge after a new connector connects. Shape when set:
  // { connectorIds: string[]; dueAt: string (ISO) }. Null when no nudge is
  // pending — cleared once services/connector-nudge.ts sends or skips it.
  pendingConnectorNudge: jsonb("pending_connector_nudge"),
  deletedAt: timestamp("deleted_at"),
  privacyPreferences: jsonb("privacy_preferences").notNull().default({}),
  consentVersion: text("consent_version"),
  consentTimestamp: timestamp("consent_timestamp"),
  privacyPolicyVersion: text("privacy_policy_version"),
  termsVersion: text("terms_version"),
  lastExportAt: timestamp("last_export_at"),
  exportCount: integer("export_count").notNull().default(0),
})

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
})

// Organization plugin tables
export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").notNull(),
  metadata: text("metadata"),
})

export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  createdAt: timestamp("created_at").notNull(),
})

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
})
