import { describe, expect, it } from "bun:test"
import { isApproval, isRejection, isApprovalOrRejection } from "./types.js"

describe("isApproval", () => {
  it("returns true for yes", () => {
    expect(isApproval("yes")).toBe(true)
  })

  it("returns true for approve", () => {
    expect(isApproval("/approve")).toBe(true)
  })

  it("returns true for do it", () => {
    expect(isApproval("do it")).toBe(true)
  })

  it("returns false for cancel", () => {
    expect(isApproval("cancel")).toBe(false)
  })

  it("returns false for unknown text", () => {
    expect(isApproval("create a file")).toBe(false)
  })
})

describe("isRejection", () => {
  it("returns true for no", () => {
    expect(isRejection("no")).toBe(true)
  })

  it("returns true for cancel", () => {
    expect(isRejection("cancel")).toBe(true)
  })

  it("returns false for yes", () => {
    expect(isRejection("yes")).toBe(false)
  })
})

describe("isApprovalOrRejection", () => {
  it("returns approve for yes", () => {
    expect(isApprovalOrRejection("yes")).toBe("approve")
  })

  it("returns approve for okay", () => {
    expect(isApprovalOrRejection("okay")).toBe("approve")
  })

  it("returns reject for no", () => {
    expect(isApprovalOrRejection("no")).toBe("reject")
  })

  it("returns reject for cancel", () => {
    expect(isApprovalOrRejection("cancel")).toBe("reject")
  })

  it("returns null for neutral text", () => {
    expect(isApprovalOrRejection("hello there")).toBeNull()
  })

  it("is case insensitive", () => {
    expect(isApprovalOrRejection("YES")).toBe("approve")
    expect(isApprovalOrRejection("Cancel")).toBe("reject")
  })
})
