import { describe, expect, it } from "bun:test"
import { classifyAction, COMPOSIO_RISK_MAP, isReadAction } from "./classification.js"

describe("Composio risk classification", () => {
  describe("GitHub actions", () => {
    it("classifies representative GitHub read actions as read", () => {
      expect(classifyAction("github", "GITHUB_LIST_ISSUES")).toBe("read")
      expect(classifyAction("github", "GITHUB_GET_PULL_REQUEST")).toBe("read")
      expect(classifyAction("github", "GITHUB_LIST_REPOSITORIES")).toBe("read")
      expect(classifyAction("github", "GITHUB_LIST_COMMITS")).toBe("read")
      expect(classifyAction("github", "GITHUB_GET_FILE_CONTENTS")).toBe("read")
      expect(classifyAction("github", "GITHUB_SEARCH_CODE")).toBe("read")
    })

    it("classifies representative GitHub write actions as write", () => {
      expect(classifyAction("github", "GITHUB_CREATE_ISSUE")).toBe("write")
      expect(classifyAction("github", "GITHUB_UPDATE_ISSUE")).toBe("write")
      expect(classifyAction("github", "GITHUB_COMMENT_ON_ISSUE")).toBe("write")
      expect(classifyAction("github", "GITHUB_CREATE_PULL_REQUEST")).toBe("write")
      expect(classifyAction("github", "GITHUB_ADD_LABELS_TO_ISSUE")).toBe("write")
    })

    it("classifies GitHub irreversible actions as irreversible", () => {
      expect(classifyAction("github", "GITHUB_MERGE_PULL_REQUEST")).toBe("irreversible")
    })

    it("defaults unknown GitHub actions to write (default-deny)", () => {
      expect(classifyAction("github", "GITHUB_SOME_NEW_ACTION")).toBe("write")
    })
  })

  describe("Linear actions", () => {
  it("classifies representative Linear read actions as read", () => {
    expect(classifyAction("linear", "LINEAR_LIST_LINEAR_ISSUES")).toBe("read")
    expect(classifyAction("linear", "LINEAR_GET_LINEAR_ISSUE")).toBe("read")
    expect(classifyAction("linear", "LINEAR_LIST_LINEAR_TEAMS")).toBe("read")
  })

  it("classifies representative Linear write/send actions to the right risk", () => {
    expect(classifyAction("linear", "LINEAR_CREATE_LINEAR_ISSUE")).toBe("write")
    expect(classifyAction("linear", "LINEAR_UPDATE_ISSUE")).toBe("write")
    expect(classifyAction("linear", "LINEAR_CREATE_LINEAR_COMMENT")).toBe("write")
  })

  it("classifies irreversible Linear actions as irreversible", () => {
    expect(classifyAction("linear", "LINEAR_DELETE_LINEAR_ISSUE")).toBe("irreversible")
  })

  it("gates the arbitrary-GraphQL action (it can run mutations)", () => {
    expect(classifyAction("linear", "LINEAR_RUN_QUERY_OR_MUTATION")).not.toBe("read")
  })

  it("defaults any unclassified action to a write (default-deny)", () => {
    expect(classifyAction("linear", "LINEAR_SOME_BRAND_NEW_ACTION")).toBe("write")
    expect(classifyAction("linear", "TOTALLY_UNKNOWN")).toBe("write")
  })

  it("defaults actions in an unknown toolkit to a write (default-deny)", () => {
    expect(classifyAction("no_such_toolkit", "ANYTHING")).toBe("write")
  })

  it("is case-insensitive on the toolkit key", () => {
    expect(classifyAction("LINEAR", "LINEAR_LIST_LINEAR_ISSUES")).toBe("read")
    expect(classifyAction("GITHUB", "GITHUB_LIST_ISSUES")).toBe("read")
  })

  it("exposes isReadAction as a convenience over classifyAction", () => {
    expect(isReadAction("linear", "LINEAR_LIST_LINEAR_ISSUES")).toBe(true)
    expect(isReadAction("linear", "LINEAR_CREATE_LINEAR_ISSUE")).toBe(false)
    expect(isReadAction("linear", "UNKNOWN")).toBe(false)
  })

  it("keeps the map as plain data keyed by lowercase toolkit", () => {
    expect(COMPOSIO_RISK_MAP["linear"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["github"]).toBeDefined()
    // every value is a valid risk class
    for (const bySlug of Object.values(COMPOSIO_RISK_MAP)) {
      for (const risk of Object.values(bySlug)) {
        expect(["read", "write", "send", "paid", "irreversible"]).toContain(risk)
      }
    }
  })
  })
})
