import AuthCard from "@/components/AuthCard"

export const metadata = { title: "Sign up", robots: { index: false, follow: false } }

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; [key: string]: string | string[] | undefined }>
}) {
  const { error } = await searchParams
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-6">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse 800px 600px at 50% 30%, rgba(96,165,250,0.1) 0%, transparent 70%)",
        }}
      />
      <AuthCard defaultMode="signup" callbackURL="/dashboard?welcome=1" initialError={error} />
    </main>
  )
}
