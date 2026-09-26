"use client"

import { useEffect, useState } from "react"

// Fisher–Yates on a copy; the input is left alone.
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

// A fresh random order on every visit for statically rendered lists. The first render
// keeps the given order so it matches the server HTML; `ready` flips once the shuffle
// lands, so callers can keep the list hidden until then instead of visibly swapping.
export function useShuffled<T>(items: readonly T[]): { items: readonly T[]; ready: boolean } {
  const [state, setState] = useState<{ items: readonly T[]; ready: boolean }>({
    items,
    ready: false,
  })
  useEffect(() => {
    setState({ items: shuffled(items), ready: true })
  }, [items])
  return state
}
