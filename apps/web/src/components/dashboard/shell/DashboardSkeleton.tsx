import { SURFACE } from "@/components/dashboard/shell/ui"
import { cn } from "@/lib/utils"

// Shown while the session loads, instead of a blank page: the home layout drawn as
// soft placeholders inside real cards, pulsing together until the dashboard arrives.
const BLOCK = "rounded-full bg-foreground/[0.05]"
const PILL =
  "bg-card/85 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_6px_20px_rgba(20,60,120,0.08)] backdrop-blur-xl"

export function DashboardSkeleton() {
  return (
    <div
      className="relative min-h-dvh bg-background"
      aria-busy="true"
      aria-label="loading your dashboard"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-[#3aa6e8] via-sky-300/50 to-transparent dark:from-sky-900/40 dark:via-sky-950/20"
      />
      <div className="skel-group relative">
        <header className="px-3 pt-3 sm:px-5">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
            <div className={cn("h-11 w-24 rounded-full", PILL)} />
            <div className={cn("hidden h-11 w-80 rounded-full md:block", PILL)} />
            <div className={cn("h-11 w-36 rounded-full", PILL)} />
          </div>
        </header>

        <main className="relative z-10 mx-auto max-w-4xl space-y-8 px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
          <div className="flex items-end justify-between gap-4 pt-6">
            <div>
              <div className="h-12 w-64 rounded-full bg-white/60 sm:h-14 sm:w-80" />
              <div className="mt-3 h-3 w-48 rounded-full bg-white/50" />
            </div>
            <div className="h-8 w-28 rounded-full bg-white/60" />
          </div>

          <div className={cn(SURFACE, "flex items-center gap-4 p-5")}>
            <div className="size-14 shrink-0 rounded-2xl bg-foreground/[0.05]" />
            <div className="flex-1 space-y-2">
              <div className={cn(BLOCK, "h-3 w-24")} />
              <div className={cn(BLOCK, "h-5 w-40")} />
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className={cn(BLOCK, "h-5 w-40")} />
              <div className={cn(BLOCK, "h-3 w-16")} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[0, 1, 2].map((n) => (
                <div key={n} className={cn(SURFACE, "p-3")}>
                  <div className="aspect-[4/5] w-full rounded-[18px] bg-foreground/[0.05]" />
                  <div className={cn(BLOCK, "mt-3 h-3.5 w-20")} />
                  <div className={cn(BLOCK, "mt-2 h-3 w-full")} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className={cn(BLOCK, "h-5 w-28")} />
              <div className={cn(BLOCK, "h-3 w-16")} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1].map((n) => (
                <div key={n} className={cn(SURFACE, "flex gap-3 p-4")}>
                  <div className="size-11 shrink-0 rounded-2xl bg-foreground/[0.05]" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className={cn(BLOCK, "h-3.5 w-24")} />
                    <div className={cn(BLOCK, "h-3 w-full")} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((n) => (
              <div key={n} className={cn(SURFACE, "min-h-[140px] p-4")}>
                <div className={cn(BLOCK, "h-4 w-20")} />
                <div className={cn(BLOCK, "mt-14 h-5 w-12")} />
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}
