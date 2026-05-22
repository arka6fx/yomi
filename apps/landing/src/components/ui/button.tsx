import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-xl text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97]",
  {
    variants: {
      variant: {
        default: "bg-accent text-canvas hover:bg-accent/90",
        outline: "border border-edge bg-panel text-label hover:border-accent/30 hover:text-accent",
        ghost: "text-caption hover:text-label hover:bg-panel/50",
      },
      size: {
        default: "h-9 gap-2 px-4",
        sm: "h-8 gap-1.5 px-3 text-xs",
        lg: "h-10 gap-2.5 px-6",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

interface ButtonProps extends VariantProps<typeof buttonVariants> {
  className?: string
  children?: any
  disabled?: boolean
  type?: "button" | "submit" | "reset"
  onClick?: (e: any) => void
}

export function Button({ className, variant, size, children, ...props }: ButtonProps) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </button>
  )
}
