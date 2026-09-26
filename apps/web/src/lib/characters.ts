import gallery from "@/data/character-gallery.json"
import { TELEGRAM_BOT_URL } from "@/lib/site"

// The public character gallery for the prerendered /characters pages. The data is
// exported from the backend (apps/api/scripts/export_character_gallery.py) so the
// pages stay static; a backend test fails when it drifts.
export type GalleryCharacter = {
  slug: string
  name: string
  emoji: string
  color: string
  tagline: string
  description: string
  firstLines: string[]
  starters: string[]
  tags: string[]
  basedOn: string
  featured: boolean
  imageUrl: string
  imageCredit: string
}

export const CHARACTERS: GalleryCharacter[] = gallery.characters

const BY_SLUG = new Map(CHARACTERS.map((c) => [c.slug, c]))

export function getCharacter(slug: string): GalleryCharacter | undefined {
  return BY_SLUG.get(slug)
}

export function characterTelegramLink(slug: string): string {
  return `${TELEGRAM_BOT_URL}?start=char_${slug}`
}

// "Satoru Gojo (Jujutsu Kaisen)" -> "Jujutsu Kaisen"; a bare name stays as is.
export function seriesOf(character: Pick<GalleryCharacter, "basedOn">): string {
  const match = character.basedOn.match(/\(([^)]+)\)\s*$/)
  return match?.[1] ?? character.basedOn
}

export type CharacterTag = {
  tag: string
  slug: string
  label: string
  // copy for /characters/tags/<slug>
  title: string
  hook: string
}

const TAG_COPY: Record<string, { label: string; title: string; hook: string }> = {
  companion: {
    label: "companions",
    title: "AI companions you can text",
    hook: "Check-ins, late-night talks, and someone who remembers what you said yesterday.",
  },
  helper: {
    label: "helpers",
    title: "Helper characters that get things done",
    hook: "Reminders, plans and research, handled in a voice you actually like.",
  },
  roleplay: {
    label: "roleplay",
    title: "Roleplay characters you can text",
    hook: "Start a scene on Telegram and let the story run.",
  },
  anime: {
    label: "anime",
    title: "Anime characters you can text",
    hook: "Fan-made takes on your favourite anime characters, with Yomi's tools underneath.",
  },
  coach: {
    label: "coaches",
    title: "Coach characters that keep you going",
    hook: "Someone in your corner who checks in and won't let you slide.",
  },
  learning: {
    label: "learning",
    title: "Study buddy characters",
    hook: "Explanations, quizzes and study sprints from a character who makes it stick.",
  },
  "language practice": {
    label: "language practice",
    title: "Characters to practise a language with",
    hook: "Text in the language you're learning and get gentle corrections back.",
  },
  fitness: {
    label: "fitness",
    title: "Fitness coach characters",
    hook: "Characters who will not accept the snooze button.",
  },
  wellness: {
    label: "wellness",
    title: "Wellness characters for calmer days",
    hook: "Gentle check-ins, wind-downs and a kind word when you need one.",
  },
  comedy: {
    label: "comedy",
    title: "Funny characters you can text",
    hook: "Get your reminders with a side of chaos.",
  },
  fantasy: {
    label: "fantasy",
    title: "Fantasy characters you can text",
    hook: "Knights, mages and legends who still remember your dentist appointment.",
  },
  "sci-fi": {
    label: "sci-fi",
    title: "Sci-fi characters you can text",
    hook: "Futuristic minds for present-day errands.",
  },
  cooking: {
    label: "cooking",
    title: "Cooking characters for your kitchen",
    hook: "Recipes, meal plans and grocery lists from a character who loves food.",
  },
  work: {
    label: "work",
    title: "Work characters that keep you on track",
    hook: "Inbox triage, meeting prep and deadlines, with some personality.",
  },
  games: {
    label: "games",
    title: "Video game characters you can text",
    hook: "Characters from the games you love, now in your Telegram.",
  },
  "movies & tv": {
    label: "movies & tv",
    title: "Movie and TV characters you can text",
    hook: "Fan-made takes on characters from the screen.",
  },
  horror: {
    label: "horror",
    title: "Horror characters you can text",
    hook: "Spooky voices, harmless help.",
  },
  genshin: {
    label: "genshin",
    title: "Genshin Impact characters you can text",
    hook: "Fan-made takes on Teyvat's finest, ready to help with your day.",
  },
}

function tagSlug(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/&/g, " ")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
}

// Tags that at least one character uses, most used first.
export const CHARACTER_TAGS: (CharacterTag & { count: number })[] = gallery.tags
  .map((tag) => {
    const copy = TAG_COPY[tag] ?? {
      label: tag,
      title: `${tag} characters you can text`,
      hook: `Fan-made ${tag} characters, with Yomi's tools underneath.`,
    }
    return {
      tag,
      slug: tagSlug(tag),
      ...copy,
      count: CHARACTERS.filter((c) => c.tags.includes(tag)).length,
    }
  })
  .filter((t) => t.count > 0)
  .sort((a, b) => b.count - a.count)

export function getTag(slug: string) {
  return CHARACTER_TAGS.find((t) => t.slug === slug)
}

export function tagForName(tag: string) {
  return CHARACTER_TAGS.find((t) => t.tag === tag)
}

// Characters sharing the most tags (then the same series), best first.
export function relatedCharacters(character: GalleryCharacter, limit = 6): GalleryCharacter[] {
  const series = seriesOf(character)
  return CHARACTERS.filter((c) => c.slug !== character.slug)
    .map((c) => ({
      c,
      score:
        c.tags.filter((t) => character.tags.includes(t)).length * 2 +
        (seriesOf(c) === series ? 3 : 0) +
        (c.featured ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ c }) => c)
}
