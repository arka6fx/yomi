import { TelegramSignIn } from "@/components/auth/TelegramSignIn"

export const metadata = { title: "Sign in", robots: { index: false, follow: false } }

export const dynamic = "force-static"

export default function Page() {
  return <TelegramSignIn mode="signin" />
}
