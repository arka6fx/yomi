import type { Config } from "tailwindcss"

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: "rgb(9 9 15 / <alpha-value>)",
        panel: "rgb(17 17 30 / <alpha-value>)",
        "panel-2": "rgb(24 24 40 / <alpha-value>)",
        accent: "rgb(45 212 191 / <alpha-value>)",
        "accent-warm": "rgb(245 158 11 / <alpha-value>)",
        label: "rgb(238 238 248 / <alpha-value>)",
        caption: "rgb(95 95 144 / <alpha-value>)",
        edge: "rgb(30 30 56 / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-syne)", "sans-serif"],
        sans: ["var(--font-jakarta)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(18px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "blink-cursor": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-8px)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.55s ease-out both",
        "blink-cursor": "blink-cursor 1.2s step-end infinite",
        float: "float 5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
}

export default config
