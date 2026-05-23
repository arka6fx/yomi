import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full rounded-xl border border-input bg-transparent px-3 py-1 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus:outline-none focus:border-ring/60 focus:ring-1 focus:ring-ring/20 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
