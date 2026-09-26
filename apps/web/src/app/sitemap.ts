import type { MetadataRoute } from "next"
import { CHARACTERS, CHARACTER_TAGS } from "@/lib/characters"
import { SKILL_CATALOG } from "@/lib/skills-catalog"

const BASE = "https://getyomi.in"

// Only canonical, indexable URLs belong here. /features redirects to a homepage
// anchor; /contact canonicalises to /support.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    {
      url: BASE,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${BASE}/skills`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    ...SKILL_CATALOG.map((skill) => ({
      url: `${BASE}/skills/${skill.id}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
    {
      url: `${BASE}/characters`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    ...CHARACTER_TAGS.map((tag) => ({
      url: `${BASE}/characters/tags/${tag.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...CHARACTERS.map((character) => ({
      url: `${BASE}/characters/${character.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
    {
      url: `${BASE}/pricing`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE}/faq`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${BASE}/docs`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${BASE}/support`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ]
}
