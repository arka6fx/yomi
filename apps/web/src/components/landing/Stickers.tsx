// Die-cut vinyl stickers scattered around the hero: flat art here, and the thick white
// border plus soft shadow come from the .sticker-cut class in globals.css.
import type { CSSProperties, ReactNode } from "react"

const INK = "#1d2330"

function GetItDone() {
  return (
    <svg viewBox="0 0 150 120" aria-hidden>
      <g
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight={900}
        fill="#1f7cf2"
        stroke="#fff"
        strokeWidth={10}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        <text x="8" y="48" fontSize="44" letterSpacing="-2">
          GET IT
        </text>
        <text x="4" y="104" fontSize="58" letterSpacing="-3">
          DONE
        </text>
      </g>
    </svg>
  )
}

function ChatBubble() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden>
      <path
        d="M50 10c24 0 42 16 42 37S74 84 50 84c-6 0-12-1-17-3L13 90l6-17C12 66 8 57 8 47 8 26 26 10 50 10z"
        fill="#5fd068"
      />
      <circle cx="33" cy="48" r="6" fill={INK} />
      <circle cx="50" cy="45" r="6" fill={INK} />
      <circle cx="67" cy="42" r="6" fill={INK} />
    </svg>
  )
}

function Smiley() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="42" fill="#f6dd5b" />
      <circle cx="36" cy="42" r="6" fill={INK} />
      <circle cx="64" cy="38" r="6" fill={INK} />
      <path
        d="M30 60c9 12 30 12 40-3"
        fill="none"
        stroke={INK}
        strokeWidth={7}
        strokeLinecap="round"
      />
    </svg>
  )
}

function Heart() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden>
      <path
        d="M50 86S10 62 10 36c0-13 10-23 22-23 8 0 14 4 18 10 4-6 10-10 18-10 12 0 22 10 22 23 0 26-40 50-40 50z"
        fill="#ef5f57"
      />
      <path
        d="M28 30c3-5 8-7 13-6"
        fill="none"
        stroke="#fff"
        strokeOpacity={0.55}
        strokeWidth={6}
        strokeLinecap="round"
      />
    </svg>
  )
}

function Notepad() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden>
      <rect x="16" y="14" width="68" height="78" rx="12" fill="#f2b84b" />
      {[32, 47, 62].map((x) => (
        <rect key={x} x={x} y="8" width="7" height="16" rx="3.5" fill="#fff" />
      ))}
      {[46, 60, 74].map((y, i) => (
        <rect
          key={y}
          x="30"
          y={y}
          width={i === 2 ? 26 : 40}
          height="7"
          rx="3.5"
          fill="#fff"
          fillOpacity={0.85}
        />
      ))}
    </svg>
  )
}

function Padlock() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden>
      <path
        d="M32 46V32a18 18 0 0 1 36 0v14"
        fill="none"
        stroke="#e9e3da"
        strokeWidth={10}
        strokeLinecap="round"
      />
      <rect x="18" y="42" width="64" height="50" rx="14" fill="#ee8a4f" />
      <circle cx="50" cy="62" r="7" fill="#fff" />
      <rect x="47" y="64" width="6" height="14" rx="3" fill="#fff" />
    </svg>
  )
}

function Calendar() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden>
      <rect x="12" y="16" width="76" height="74" rx="14" fill="#fff" />
      <path d="M12 30a14 14 0 0 1 14-14h48a14 14 0 0 1 14 14v8H12z" fill="#ef5f57" />
      <text
        x="50"
        y="78"
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight={800}
        fontSize="38"
        fill={INK}
      >
        17
      </text>
    </svg>
  )
}

function PaperPlane() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden>
      <path d="M10 46 88 14 70 86 48 66z" fill="#39a8ee" />
      <path d="M48 66 88 14 38 58z" fill="#1f86d0" />
      <path d="M38 58 44 82 48 66z" fill="#1766a8" />
    </svg>
  )
}

type Spot = {
  art: () => ReactNode
  className: string
  tilt: string
  delay: string
}

// Positions are percentages of the hero box; sizes are the sticker's width.
const SPOTS: Spot[] = [
  { art: GetItDone, className: "left-[8%] top-[13%] w-36", tilt: "-10deg", delay: "0s" },
  { art: ChatBubble, className: "right-[10%] top-[12%] w-28", tilt: "8deg", delay: "1.2s" },
  { art: Smiley, className: "-left-6 top-[38%] w-32", tilt: "-8deg", delay: "0.6s" },
  { art: Heart, className: "left-[22%] top-[30%] w-20", tilt: "-14deg", delay: "1.8s" },
  { art: Calendar, className: "right-[5%] top-[36%] w-24", tilt: "10deg", delay: "2s" },
  { art: Notepad, className: "right-[3%] top-[60%] w-24", tilt: "-6deg", delay: "0.9s" },
  { art: Padlock, className: "right-[8%] top-[80%] w-28", tilt: "12deg", delay: "2.4s" },
  { art: PaperPlane, className: "left-[5%] top-[82%] w-24", tilt: "-10deg", delay: "1.4s" },
]

export function HeroStickers() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden md:block">
      {SPOTS.map(({ art: Art, className, tilt }, i) => (
        <span
          key={i}
          className={`sticker sticker-cut sticker-pop absolute ${className}`}
          // pop in one after another, then settle into the bob
          style={{ "--tilt": tilt, "--pop-delay": `${0.1 + i * 0.09}s` } as CSSProperties}
        >
          <Art />
        </span>
      ))}
    </div>
  )
}
