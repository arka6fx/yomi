import { describe, expect, it } from "bun:test"
import { googlePhotosComposioSpecs } from "./google-photos.js"

describe("googlePhotosComposioSpecs", () => {
  // Confirmed live: the granted OAuth scope is photoslibrary.readonly.appcreateddata /
  // .edit.appcreateddata, not the full photoslibrary.readonly — Google restricted
  // broad library read access in 2025 to apps with a verification tier Composio's
  // auth config doesn't have. Every read/list action can only ever see media Yomi
  // itself uploaded, never the user's existing library — the model must be told
  // this directly, or it promises "arrange your photos" and then can't deliver.
  it.each([
    "GOOGLEPHOTOS_LIST_ALBUMS",
    "GOOGLEPHOTOS_LIST_MEDIA_ITEMS",
    "GOOGLEPHOTOS_SEARCH_MEDIA_ITEMS",
    "GOOGLEPHOTOS_GET_ALBUM",
    "GOOGLEPHOTOS_BATCH_GET_MEDIA_ITEMS",
  ])("documents the app-created-only scope limitation for %s", (slug) => {
    const spec = googlePhotosComposioSpecs.find((s) => s.slug === slug)
    expect(spec?.description).toContain("only see photos/albums Yomi itself uploaded")
  })
})
