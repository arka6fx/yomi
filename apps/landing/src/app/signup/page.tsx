import AuthCard from "@/components/AuthCard"
import AuthLayout from "@/components/AuthLayout"

export const metadata = { title: "Sign up", robots: { index: false, follow: false } }

// static prerender — AuthCard reads ?error= client-side
export const dynamic = "force-static"

export default function SignUpPage() {
  return (
    <AuthLayout mode="signup">
      <AuthCard defaultMode="signup" callbackURL="/dashboard?welcome=1" />
    </AuthLayout>
  )
}
