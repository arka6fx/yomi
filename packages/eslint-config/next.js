import base from "./index.js"

// Next.js apps use `next lint` which has built-in ESLint config.
// This export exists for manual ESLint invocations; it extends base rules only.
/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  ...base,
  {
    rules: {
      // Next.js uses the Image component — suppress the vanilla <img> warning
      "@next/next/no-img-element": "warn",
    },
  },
]
