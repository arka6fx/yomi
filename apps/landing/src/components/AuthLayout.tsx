import { Star } from "lucide-react"
import { BrandMark } from "@/components/BrandMark"

const STEPS = [
  { label: "Sign in with Google or GitHub", caption: "One tap — no password to remember." },
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
        className="relative hidden overflow-hidden p-10 lg:flex lg:flex-col lg:justify-between"
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
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-white/80 ring-1 ring-white/15 backdrop-blur">
            <Star size={11} className="fill-white/80 text-white/80" />
            AI assistant
          </span>
          <h2 className="mt-5 font-serif text-4xl font-medium leading-[1.1] text-white">
            Your apps, one{" "}
            <span className="font-serif italic">conversation.</span>
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            Sign in to connect your tools, then ask Yomi anything — from your desktop or right inside Telegram.
          </p>

          <ol className="mt-9 space-y-2.5">
            {STEPS.map((step, i) => {
              const active = i === 0
              return (
                <li
                  key={step.label}
                  className={
                    active
                      ? "flex items-start gap-3 rounded-xl bg-white px-4 py-3 shadow-lg shadow-black/10"
                      : "flex items-start gap-3 rounded-xl px-4 py-3 ring-1 ring-white/10"
                  }
                >
                  <span
                    className={
                      active
                        ? "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#1f6fc4] text-[11px] font-semibold text-white"
                        : "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold text-white/80"
                    }
                  >
                    {i + 1}
                  </span>
                  <span>
                    <span className={active ? "block text-sm font-medium text-[#0b1e44]" : "block text-sm font-medium text-white/90"}>
                      {step.label}
                    </span>
                    <span className={active ? "block text-xs text-[#0b1e44]/60" : "block text-xs text-white/55"}>
                      {step.caption}
                    </span>
                  </span>
                </li>
              )
            })}
          </ol>
        </div>

        <p className="relative text-xs text-white/50">
          {mode === "signup"
            ? "Free to start · upgrade anytime · cancel whenever."
            : "Secure OAuth sign-in · we never see your password."}
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
