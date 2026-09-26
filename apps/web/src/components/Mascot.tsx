import { cn } from "@/lib/utils"

// The crocheted yomi mascot. Sources live in /assets/mascot; the webp copies in
// public/mascot come from scripts/optimize-mascots.mjs.
const POSES = {
  astronaut: [387, 400],
  celebrate: [395, 344],
  cool: [360, 382],
  heart: [350, 347],
  laptop: [332, 397],
  reading: [298, 388],
  thinking: [332, 352],
  waving: [342, 388],
} as const

export type MascotPose = keyof typeof POSES

export function Mascot({
  pose,
  className,
  float = false,
  priority = false,
}: {
  pose: MascotPose
  className?: string
  float?: boolean
  priority?: boolean
}) {
  const [width, height] = POSES[pose]
  return (
    <img
      src={`/mascot/${pose}.webp`}
      alt=""
      aria-hidden
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      className={cn(
        "pointer-events-none h-auto select-none drop-shadow-[0_18px_24px_rgba(16,24,40,0.18)]",
        float && "animate-float motion-reduce:animate-none",
        className,
      )}
    />
  )
}
