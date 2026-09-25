import { TelegramSignIn } from "@/components/auth/TelegramSignIn"

export const metadata = { title: "Sign up", robots: { index: false, follow: false } }

export const dynamic = "force-static"

export default function Page() {
  return <TelegramSignIn mode="signup" />
}
