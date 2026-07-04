import { describe, expect, test } from "bun:test"
import { sanitizeAuditMetadata } from "./audit.js"

describe("sanitizeAuditMetadata", () => {
  test("removes content and secret-like keys", () => {
    expect(
      sanitizeAuditMetadata({
        purposes: ["memory"],
        token: "secret",
        promptText: "private prompt",
        email: "user@example.com",
        source: "dashboard",
      }),
    ).toEqual({ purposes: ["memory"], source: "dashboard" })
  })
})
