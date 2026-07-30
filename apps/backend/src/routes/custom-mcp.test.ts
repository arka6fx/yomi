import { describe, expect, it } from "bun:test"
import { validateCustomMcpServerInput, isDuplicateUrlError } from "./custom-mcp.js"

describe("validateCustomMcpServerInput", () => {
  it("rejects a missing name", () => {
    expect(validateCustomMcpServerInput({ url: "https://mcp.example.com" })).toBe(
      "name and url are required",
    )
  })

  it("rejects a missing url", () => {
    expect(validateCustomMcpServerInput({ name: "My Server" })).toBe("name and url are required")
  })

  it("rejects a malformed url", () => {
    expect(validateCustomMcpServerInput({ name: "My Server", url: "not a url" })).toBe(
      "url must be a valid URL",
    )
  })

  it("rejects a non-https url", () => {
    expect(validateCustomMcpServerInput({ name: "My Server", url: "http://mcp.example.com" })).toBe(
      "url must use https",
    )
  })

  it("accepts a valid https url with a name", () => {
    expect(
      validateCustomMcpServerInput({ name: "My Server", url: "https://mcp.example.com" }),
    ).toBeNull()
  })
})

describe("isDuplicateUrlError", () => {
  it("recognizes the unique constraint violation", () => {
    const err = new Error(
      'duplicate key value violates unique constraint "custom_mcp_servers_user_url_unique"',
    )
    expect(isDuplicateUrlError(err)).toBe(true)
  })

  it("does not flag unrelated errors", () => {
    expect(isDuplicateUrlError(new Error("connection timeout"))).toBe(false)
  })
})
