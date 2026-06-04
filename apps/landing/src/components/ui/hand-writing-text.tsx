"use client"

import { motion } from "framer-motion"
import type { Variants } from "framer-motion"
import { cn } from "@/lib/utils"

interface HandWrittenTitleProps {
  title?: string
  subtitle?: string
  className?: string
  strokeClassName?: string
}

function HandWrittenTitle({
  title = "Hand Written",
  subtitle,
  className,
  strokeClassName = "text-primary",
}: HandWrittenTitleProps) {
  const draw: Variants = {
    hidden: { pathLength: 0, opacity: 0 },
    visible: {
      pathLength: 1,
      opacity: 1,
      transition: {
        pathLength: { duration: 2.5, ease: [0.43, 0.13, 0.23, 0.96] as const },
        opacity: { duration: 0.5 },
      },
    },
  }

  return (
    <div className={cn("relative w-full max-w-4xl mx-auto", className)}>
      <div className="absolute inset-0">
        <motion.svg
          width="100%"
          height="100%"
          viewBox="0 0 1200 600"
          initial="hidden"
          animate="visible"
          className="w-full h-full"
        >
          <motion.path
            d="M 950 90
               C 1250 300, 1050 480, 600 520
               C 250 520, 150 480, 150 300
               C 150 120, 350 80, 600 80
               C 850 80, 950 180, 950 180"
            fill="none"
            strokeWidth="10"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            variants={draw}
            className={cn("opacity-70", strokeClassName)}
          />
        </motion.svg>
      </div>
      <div className="relative text-center z-10 flex flex-col items-center justify-center py-16">
        <motion.p
          className="font-display text-3xl md:text-4xl text-foreground/90"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.8 }}
        >
          {title}
        </motion.p>
        {subtitle && (
          <motion.p
            className="text-base text-muted-foreground mt-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 0.8 }}
          >
            {subtitle}
          </motion.p>
        )}
      </div>
    </div>
  )
}

export { HandWrittenTitle }
