import AuthCard from "@/components/AuthCard"
import AuthLayout from "@/components/AuthLayout"

export const metadata = { title: "Sign in", robots: { index: false, follow: false } }

// static prerender — AuthCard reads ?error= client-side
export const dynamic = "force-static"

export default function SignInPage() {
  return (
    <AuthLayout mode="signin">
      <AuthCard defaultMode="signin" />
    </AuthLayout>
  )
}
