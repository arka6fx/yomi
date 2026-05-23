import AuthCard from "@/components/AuthCard"

export const metadata = {
  title: "Sign in",
}

export default function SignInPage() {
  return (
    <main className="min-h-dvh bg-background flex flex-col items-center justify-center px-6">
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 800px 600px at 50% 30%, rgba(255,224,194,0.08) 0%, transparent 70%)",
        }}
      />
      <AuthCard defaultMode="signin" />
    </main>
  )
}
