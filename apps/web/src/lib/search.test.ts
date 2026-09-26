import { describe, expect, it } from "vitest"
import { matchesSearch } from "./search"

const fangYuan = [
  "Fang Yuan",
  "cold, patient, always calculating.",
  "Fang Yuan (Reverend Insanity)",
]
const goll = ["Göll", "youngest valkyrie.", "Göll (Record of Ragnarok)"]
const gojo = ["Satoru Gojo", "the strongest.", "Satoru Gojo (Jujutsu Kaisen)"]
const ghost = ["Ghost", "quiet on comms.", "Simon 'Ghost' Riley (Call of Duty)"]

describe("matchesSearch", () => {
  it("ignores case", () => {
    expect(matchesSearch("fang yuan", fangYuan)).toBe(true)
    expect(matchesSearch("FANG YUAN", fangYuan)).toBe(true)
  })

  it("accepts any word order and missing spaces", () => {
    expect(matchesSearch("yuan fang", fangYuan)).toBe(true)
    expect(matchesSearch("fangyuan", fangYuan)).toBe(true)
  })

  it("ignores accents and punctuation", () => {
    expect(matchesSearch("goll", goll)).toBe(true)
    expect(matchesSearch("ghost riley", ghost)).toBe(true)
  })

  it("forgives long-vowel romanisation", () => {
    expect(matchesSearch("gojou", gojo)).toBe(true)
    expect(matchesSearch("satoru gojou", gojo)).toBe(true)
  })

  it("searches the series too", () => {
    expect(matchesSearch("reverend insanity", fangYuan)).toBe(true)
    expect(matchesSearch("jujutsu", gojo)).toBe(true)
  })

  it("still rejects things that don't match", () => {
    expect(matchesSearch("naruto", fangYuan)).toBe(false)
    expect(matchesSearch("fang zhou", fangYuan)).toBe(false)
  })

  it("an empty query matches everything", () => {
    expect(matchesSearch("   ", gojo)).toBe(true)
  })
})
