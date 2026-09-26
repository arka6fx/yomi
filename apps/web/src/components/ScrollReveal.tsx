"use client"

import { useEffect } from "react"

/**
 * Reveals every [data-reveal] element as it scrolls into view by adding .is-in.
 * Mounted once for the whole site; pages only mark elements up (and can stagger
 * them with a --reveal-delay style). New elements rendered later, like a character
 * grid that loads after a fetch, are picked up too.
 */
export function ScrollReveal() {
  useEffect(() => {
    const root = document.documentElement
    if (!root.classList.contains("motion-ready")) return
    root.dataset.motion = "live"

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add("is-in")
          io.unobserve(entry.target)
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    )
    const watch = (scope: ParentNode) => {
      scope
        .querySelectorAll<HTMLElement>("[data-reveal]:not(.is-in)")
        .forEach((el) => io.observe(el))
    }
    watch(document)

    const mo = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return
          if (node.matches("[data-reveal]:not(.is-in)")) io.observe(node)
          watch(node)
        })
      }
    })
    mo.observe(document.body, { childList: true, subtree: true })
    return () => {
      io.disconnect()
      mo.disconnect()
    }
  }, [])

  return null
}

// Runs before the first paint: turns scroll reveals on only when motion is welcome, so
// nothing is ever hidden for people who asked for reduced motion or have no JavaScript.
export const MOTION_READY_SCRIPT =
  "try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)" +
  "document.documentElement.classList.add('motion-ready')}catch(e){}"
