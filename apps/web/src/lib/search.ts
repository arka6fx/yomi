// Forgiving search for names people type from memory: any case, any word order,
// missing spaces ("fangyuan"), no accents ("goll" → Göll), punctuation ignored, and
// common romanisation variants ("gojou" ~ "gojo", "yuuji" ~ "yuji").

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // strip accents
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

// Long vowels are spelt both ways in romanised Japanese; spaces are optional.
function loose(text: string): string {
  return normalize(text)
    .replace(/ou/g, "o")
    .replace(/uu/g, "u")
    .replace(/oo/g, "o")
    .replace(/ /g, "")
}

export function matchesSearch(query: string, fields: string[]): boolean {
  const q = normalize(query)
  if (!q) return true
  const haystack = normalize(fields.join(" "))
  const looseHaystack = loose(haystack)
  if (looseHaystack.includes(loose(q))) return true
  return q
    .split(" ")
    .every((word) => haystack.includes(word) || looseHaystack.includes(loose(word)))
}
