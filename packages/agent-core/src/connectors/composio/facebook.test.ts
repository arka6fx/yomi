import { describe, expect, it } from "bun:test"
import { facebookComposioSpecs } from "./facebook.js"

const SLUGS_NEEDING_PAGE_ID = [
  "FACEBOOK_GET_PAGE_DETAILS",
  "FACEBOOK_GET_PAGE_POSTS",
  "FACEBOOK_GET_PAGE_INSIGHTS",
  "FACEBOOK_GET_PAGE_PHOTOS",
  "FACEBOOK_GET_PAGE_VIDEOS",
  "FACEBOOK_GET_PAGE_ROLES",
  "FACEBOOK_GET_SCHEDULED_POSTS",
  "FACEBOOK_GET_PAGE_CONVERSATIONS",
  "FACEBOOK_CREATE_POST",
  "FACEBOOK_CREATE_PHOTO_POST",
  "FACEBOOK_CREATE_VIDEO_POST",
  "FACEBOOK_SEND_MESSAGE",
  "FACEBOOK_UPDATE_PAGE_SETTINGS",
  "FACEBOOK_ASSIGN_PAGE_TASK",
  "FACEBOOK_REMOVE_PAGE_TASK",
]

describe("facebookComposioSpecs", () => {
  it.each(SLUGS_NEEDING_PAGE_ID)(
    "auto-resolves page_id via FACEBOOK_GET_USER_PAGES (singleton-only) for %s",
    (slug) => {
      const spec = facebookComposioSpecs.find((s) => s.slug === slug)
      expect(spec?.resolvedParams).toEqual({
        page_id: { viaSlug: "FACEBOOK_GET_USER_PAGES", list: true },
      })
    },
  )

  it("does not attach resolvedParams to actions scoped by post/comment/message id instead of page_id", () => {
    for (const slug of ["FACEBOOK_GET_POST", "FACEBOOK_UPDATE_POST", "FACEBOOK_DELETE_POST", "FACEBOOK_CREATE_COMMENT"]) {
      const spec = facebookComposioSpecs.find((s) => s.slug === slug)
      expect(spec?.resolvedParams).toBeUndefined()
    }
  })
})
