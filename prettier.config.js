/** @type {import("prettier").Config} */
export default {
  semi: false,
  singleQuote: false,
  printWidth: 100,
  tabWidth: 2,
  trailingComma: "all",
  arrowParens: "always",
  endOfLine: "lf",
  overrides: [
    {
      files: ["*.json", "*.jsonc"],
      options: { printWidth: 80 },
    },
    {
      files: ["*.md"],
      options: { proseWrap: "always", printWidth: 80 },
    },
  ],
}
