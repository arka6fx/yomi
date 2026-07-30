"use client"

import Link from "next/link"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { TelegramIcon } from "@/components/TelegramIcon"
import { cn } from "@/lib/utils"

export type PlatformLink = { platform: string; connectedAt: string }

const PLATFORM_META: Record<string, { name: string }> = {
  telegram: { name: "Telegram" },
}

// Shared between the Home and Profile tabs — Telegram is Yomi's only chat
// surface, so both the at-a-glance dashboard and the account page need it.
export function TelegramCard({
  platformLinks,
  platformsLoading,
  unlinking,
  onUnlink,
}: {
  platformLinks: PlatformLink[]
  platformsLoading: boolean
  unlinking: string | null
  onUnlink: (platform: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 sm:gap-4 border-b border-border/60 p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <TelegramIcon
            size={44}
            className="shrink-0 drop-shadow-[0_4px_14px_rgba(34,158,217,0.35)]"
          />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Telegram</h3>
              {!platformsLoading && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    platformLinks.length > 0
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      platformLinks.length > 0 ? "bg-emerald-400" : "bg-muted-foreground/50",
                    )}
                  />
                  {platformLinks.length > 0 ? "Active" : "Not connected"}
                </span>
              )}
            </div>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Chat with Yomi from any device, right inside Telegram.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              {["Text chat", "Voice notes", "Image analysis"].map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center rounded-md bg-muted/60 px-1.5 py-0.5"
                >
                  {label}
                </span>
              ))}
              <span className="text-muted-foreground/60">
                · usage draws from your credit balance
              </span>
            </div>
          </div>
        </div>
        {platformLinks.length > 0 && (
          <Link
            href="/link"
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
          >
            <Plus size={12} />
            Link new
          </Link>
        )}
      </div>

      <div className="p-5 pt-4 sm:p-6 sm:pt-5">
        {platformsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : platformLinks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-5 py-7 text-center">
            <TelegramIcon size={48} className="mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">Connect Telegram to chat anywhere</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
              Link your account with a secure one-time code. Takes a few seconds.
            </p>
            <Link
              href="/link"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <TelegramIcon size={15} />
              Connect Telegram
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {platformLinks.map((link) => {
              const meta = PLATFORM_META[link.platform] ?? { name: link.platform }
              return (
                <div
                  key={link.platform}
                  className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-4 py-3 transition-colors hover:border-border/80"
                >
                  <div className="flex items-center gap-3">
                    <TelegramIcon size={32} className="shrink-0" />
                    <div className="leading-tight">
                      <p className="text-sm font-medium capitalize text-foreground">{meta.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Linked{" "}
                        {new Date(link.connectedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link
                      href="/link"
                      className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Manage
                    </Link>
                    <button
                      onClick={() => onUnlink(link.platform)}
                      disabled={unlinking === link.platform}
                      className="flex items-center gap-1 text-xs text-destructive/70 transition-colors hover:text-destructive disabled:opacity-50"
                    >
                      {unlinking === link.platform ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Trash2 size={12} />
                      )}
                      Unlink
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
