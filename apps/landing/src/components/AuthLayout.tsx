import { BrandMark } from "@/components/BrandMark"

const STEPS = [
  { label: "Sign in with Google or GitHub", caption: "One tap. No password to remember." },
  { label: "Connect your apps", caption: "Gmail, Calendar, Drive, GitHub, and more." },
  { label: "Chat from desktop or Telegram", caption: "Ask Yomi anything, anywhere." },
]

// Split-screen auth shell: a sky-blue brand panel on the left, the form on the
// right. Left panel is hidden on small screens so the form takes the full width.
export default function AuthLayout({
  mode,
  children,
}: {
  mode: "signin" | "signup"
  children: React.ReactNode
}) {
  return (
    <main className="min-h-dvh w-full bg-background lg:grid lg:grid-cols-[1fr_1.05fr]">
      {/* Left — brand / onboarding */}
      <aside
        className="relative hidden overflow-hidden p-10 lg:flex lg:flex-col lg:justify-between xl:p-14"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 120%, rgba(255,255,255,0.20), transparent 60%)," +
            "radial-gradient(80% 60% at 75% 0%, rgba(120,180,255,0.38), transparent 60%)," +
            "linear-gradient(165deg, #0b1e44 0%, #134a8e 55%, #1f6fc4 100%)",
        }}
      >
        {/* soft cloud highlights */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
          style={{
            background:
              "radial-gradient(60% 100% at 30% 100%, rgba(255,255,255,0.18), transparent 70%)," +
              "radial-gradient(50% 100% at 80% 100%, rgba(255,255,255,0.12), transparent 70%)",
          }}
        />

        <div className="relative">
          <BrandMark withText size="md" className="[&_span]:text-white" />
        </div>

        <div className="relative max-w-md">
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-white/55">
            Sign in to Yomi
          </p>
          <h2 className="mt-4 font-serif text-5xl leading-[1.03] text-white xl:text-6xl">
            Your apps,
            <br />
            one <span className="italic">conversation.</span>
          </h2>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/70">
            Connect your tools once, then ask Yomi anything. From your desktop, or right inside
            Telegram.
          </p>

          {/* Editorial stepper: serif italic figures carry the real sequence */}
          <ol className="mt-10 space-y-5">
            {STEPS.map((step, i) => (
              <li key={step.label} className="flex items-baseline gap-4">
                <span className="w-6 shrink-0 font-serif text-3xl italic leading-none text-white/30 tabular-nums">
                  {i + 1}
                </span>
                <span>
                  <span className="block text-sm font-medium text-white/90">{step.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-white/55">
                    {step.caption}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <p className="relative text-xs text-white/45">
          {mode === "signup"
            ? "Free to start. Upgrade anytime, cancel whenever."
            : "Secure OAuth sign-in. We never see your password."}
        </p>
      </aside>

      {/* Right — form */}
      <section className="relative flex min-h-dvh items-center justify-center px-6 py-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 lg:hidden"
          style={{
            background:
              "radial-gradient(ellipse 700px 500px at 50% 0%, rgba(96,165,250,0.12), transparent 70%)",
          }}
        />
        <div className="relative w-full max-w-sm">{children}</div>
      </section>
    </main>
  )
}
