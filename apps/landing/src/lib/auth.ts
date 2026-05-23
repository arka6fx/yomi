import { betterAuth } from "better-auth"
import { Pool } from "@neondatabase/serverless"

export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL! }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
})
