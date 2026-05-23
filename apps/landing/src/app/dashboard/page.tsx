"use client"

import { useEffect, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { LogOut, Check, Zap, Crown, Loader2, Download } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

type Sub = {
  plan: string
  status: string
  tokensUsedThisPeriod: number
  currentPeriodEnd: string | null
}

const PLANS = [
  { key: "free",     name: "Free",     price: "$0",  desc: "10 LLM calls / day" },
  { key: "basic",    name: "Basic",    price: "$4",  desc: "500 LLM calls / day" },
  { key: "standard", name: "Standard", price: "$9",  desc: "2,000 LLM calls / day" },
  { key: "genesis",  name: "Genesis",  price: "$19", desc: "10,000 LLM calls / day" },
]

function DashboardContent() {
  const { data: session, isPending } = authClient.useSession()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [sub, setSub] = useState<Sub | null>(null)
  const [subPending, setSubPending] = useState(true)
  const [billingLoading, setBillingLoading] = useState<string | null>(null)
  const [billingError, setBillingError] = useState("")

  useEffect(() => {
    if (!isPending && !session) router.push("/signin")
  }, [session, isPending, router])

  useEffect(() => {
    if (!session) return
    fetch("/api/billing")
      .then(r => r.json())
      .then((d: Sub) => setSub(d))
      .catch(() => setSub({ plan: "free", status: "active", tokensUsedThisPeriod: 0, currentPeriodEnd: null }))
      .finally(() => setSubPending(false))
  }, [session])

  // If ?plan= arrives after auth (e.g. from /signup?plan=standard), auto-upgrade
  useEffect(() => {
    const plan = searchParams.get("plan")
    if (!plan || !session || subPending || !sub) return
    if (plan !== sub.plan && plan !== "free") handleUpgrade(plan)
  }, [session, subPending, sub]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpgrade(planKey: string) {
    if (planKey === "free") return
    setBillingError("")
    setBillingLoading(planKey)
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Billing failed")
      window.location.href = data.short_url
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : "Failed to start billing")
      setBillingLoading(null)
    }
  }

  async function handleSignOut() {
    await authClient.signOut()
    router.push("/")
  }

  if (isPending || !session) return null

  const currentIdx = PLANS.findIndex(p => p.key === (sub?.plan ?? "free"))

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full blur-[160px]"
          style={{ background: "radial-gradient(circle, rgba(255,175,80,0.05), transparent 65%)" }}
        />
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="font-display text-xl font-bold text-foreground select-none">
            Yomi
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:block truncate max-w-[200px]">
              {session.user.email}
            </span>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12 space-y-10 relative z-10">
        {/* Welcome */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1
            className="text-3xl font-light text-foreground"
            style={{ letterSpacing: "-0.03em" }}
          >
            Hey, {session.user.name?.split(" ")[0] ?? "there"}.
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Your Yomi account overview.</p>
        </motion.div>

        {/* Plan card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08 }}
        >
          <div className="rounded-2xl border border-border bg-card p-6 flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
                Current plan
              </p>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-2xl font-light text-foreground capitalize"
                  style={{ letterSpacing: "-0.02em" }}
                >
                  {subPending ? "—" : (sub?.plan ?? "free")}
                </span>
                {!subPending && sub && (
                  <span
                    className={cn(
                      "text-xs px-2 py-0.5 rounded-full font-medium",
                      sub.status === "active"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-amber-500/10 text-amber-400",
                    )}
                  >
                    {sub.status}
                  </span>
                )}
              </div>
              {sub?.currentPeriodEnd && (
                <p className="text-xs text-muted-foreground">
                  Renews{" "}
                  {new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>

            {!subPending && sub && (
              <div className="text-right">
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
                  Usage this period
                </p>
                <div className="flex items-center gap-1.5 justify-end">
                  <Zap size={14} className="text-primary" />
                  <span className="text-2xl font-light text-foreground">
                    {sub.tokensUsedThisPeriod.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground self-end pb-0.5">tokens</span>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Plans */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.16 }}
        >
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-4">
            Plans
          </p>
          {billingError && (
            <p className="text-xs text-destructive mb-4">{billingError}</p>
          )}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {PLANS.map((plan, i) => {
              const isCurrent = plan.key === (sub?.plan ?? "free")
              const isUpgrade = i > currentIdx
              return (
                <div
                  key={plan.key}
                  className={cn(
                    "rounded-xl border p-4 flex flex-col gap-3 transition-colors",
                    isCurrent
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card",
                  )}
                >
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm font-medium text-foreground">{plan.name}</span>
                      {isCurrent && <Check size={13} className="text-primary" />}
                    </div>
                    <div className="flex items-baseline gap-0.5">
                      <span className="text-xl font-light text-foreground">{plan.price}</span>
                      <span className="text-xs text-muted-foreground">/mo</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{plan.desc}</p>
                  </div>

                  {isCurrent ? (
                    <span className="text-xs text-primary font-medium">Current plan</span>
                  ) : isUpgrade ? (
                    <button
                      onClick={() => handleUpgrade(plan.key)}
                      disabled={billingLoading !== null}
                      className="flex items-center justify-center gap-1.5 bg-primary text-primary-foreground rounded-lg py-2 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {billingLoading === plan.key ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Crown size={12} />
                      )}
                      Upgrade
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Lower tier</span>
                  )}
                </div>
              )
            })}
          </div>
        </motion.div>

        {/* Download CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.24 }}
        >
          <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Download Yomi</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Get the desktop app for Mac or Windows.
              </p>
            </div>
            <Link
              href="/download"
              className="flex items-center gap-2 bg-primary text-primary-foreground rounded-xl font-medium px-4 py-2 text-sm hover:bg-primary/90 transition-colors whitespace-nowrap"
            >
              <Download size={14} />
              Download
            </Link>
          </div>
        </motion.div>
      </main>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  )
}
