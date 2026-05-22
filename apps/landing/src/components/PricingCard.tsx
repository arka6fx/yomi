import Link from "next/link"

interface PricingCardProps {
  name: string
  price: string
  period?: string
  features: string[]
  cta: string
  ctaHref: string
  popular?: boolean
}

export default function PricingCard({
  name,
  price,
  period = "/mo",
  features,
  cta,
  ctaHref,
  popular = false,
}: PricingCardProps) {
  return (
    <div
      className={`relative flex flex-col gap-6 rounded-2xl p-6 border transition-all ${
        popular
          ? "bg-panel border-accent/30 shadow-xl"
          : "bg-panel border-edge hover:border-edge/60"
      }`}
    >
      {popular && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-accent text-canvas font-mono tracking-wide">
            Most popular
          </span>
        </div>
      )}

      <div>
        <h3 className="font-display font-semibold text-label">{name}</h3>
        <div className="mt-2 flex items-baseline gap-1">
          <span className="font-display text-3xl font-extrabold text-label">
            {price}
          </span>
          {price !== "Free" && (
            <span className="text-sm text-caption">{period}</span>
          )}
        </div>
      </div>

      <ul className="flex-1 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm text-label/80">
            <span className="text-accent mt-0.5 flex-shrink-0 text-xs">▸</span>
            {f}
          </li>
        ))}
      </ul>

      <Link
        href={ctaHref}
        className={`block text-center py-3 rounded-xl text-sm font-semibold transition-all ${
          popular
            ? "bg-accent text-canvas hover:bg-accent/90"
            : "bg-panel-2 text-label border border-edge hover:border-accent/30 hover:text-accent"
        }`}
      >
        {cta}
      </Link>
    </div>
  )
}
