import { describe, expect, it } from "bun:test"
import { instagramComposioSpecs } from "./instagram.js"

describe("instagramComposioSpecs", () => {
  it.each(["INSTAGRAM_CREATE_MEDIA_CONTAINER", "INSTAGRAM_CREATE_CAROUSEL_CONTAINER", "INSTAGRAM_CREATE_POST"])(
    "auto-resolves ig_user_id via INSTAGRAM_GET_USER_INFO for %s instead of trusting the model's guess",
    (slug) => {
      const spec = instagramComposioSpecs.find((s) => s.slug === slug)
      expect(spec?.resolvedParams).toEqual({ ig_user_id: { viaSlug: "INSTAGRAM_GET_USER_INFO" } })
    },
  )
})
