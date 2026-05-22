import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full rounded-xl border border-edge bg-panel px-3 py-1 text-sm text-label transition-colors placeholder:text-caption focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
