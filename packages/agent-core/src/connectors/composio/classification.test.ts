import { describe, expect, it } from "bun:test"
import { classifyAction, COMPOSIO_RISK_MAP, isReadAction } from "./classification.js"

describe("Composio risk classification", () => {
  describe("GitHub actions", () => {
    it("classifies representative GitHub read actions as read", () => {
      expect(classifyAction("github", "GITHUB_LIST_REPOSITORY_ISSUES")).toBe("read")
      expect(classifyAction("github", "GITHUB_GET_A_PULL_REQUEST")).toBe("read")
      expect(classifyAction("github", "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER")).toBe("read")
      expect(classifyAction("github", "GITHUB_LIST_COMMITS")).toBe("read")
      expect(classifyAction("github", "GITHUB_GET_REPOSITORY_CONTENT")).toBe("read")
      expect(classifyAction("github", "GITHUB_SEARCH_CODE")).toBe("read")
    })

    it("classifies representative GitHub write actions as write", () => {
      expect(classifyAction("github", "GITHUB_CREATE_AN_ISSUE")).toBe("write")
      expect(classifyAction("github", "GITHUB_UPDATE_AN_ISSUE")).toBe("write")
      expect(classifyAction("github", "GITHUB_CREATE_AN_ISSUE_COMMENT")).toBe("write")
      expect(classifyAction("github", "GITHUB_CREATE_A_PULL_REQUEST")).toBe("write")
      expect(classifyAction("github", "GITHUB_ADD_LABELS_TO_AN_ISSUE")).toBe("write")
    })

    it("classifies GitHub irreversible actions as irreversible", () => {
      expect(classifyAction("github", "GITHUB_MERGE_A_PULL_REQUEST")).toBe("irreversible")
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
    expect(classifyAction("GITHUB", "GITHUB_LIST_REPOSITORY_ISSUES")).toBe("read")
  })

  it("exposes isReadAction as a convenience over classifyAction", () => {
    expect(isReadAction("linear", "LINEAR_LIST_LINEAR_ISSUES")).toBe(true)
    expect(isReadAction("linear", "LINEAR_CREATE_LINEAR_ISSUE")).toBe(false)
    expect(isReadAction("linear", "UNKNOWN")).toBe(false)
  })

  it("keeps the map as plain data keyed by lowercase toolkit", () => {
    expect(COMPOSIO_RISK_MAP["linear"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["github"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["gmail"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googlecalendar"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googledrive"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["google_classroom"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googletasks"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googlemeet"]).toBeDefined()
    for (const bySlug of Object.values(COMPOSIO_RISK_MAP)) {
      for (const risk of Object.values(bySlug)) {
        expect(["read", "write", "send", "paid", "irreversible"]).toContain(risk)
      }
    }
  })
  })

  describe("Google actions", () => {
    it("classifies Gmail read actions as read", () => {
      expect(classifyAction("gmail", "GMAIL_FETCH_EMAILS")).toBe("read")
      expect(classifyAction("gmail", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID")).toBe("read")
    })

    it("classifies Gmail send actions as send", () => {
      expect(classifyAction("gmail", "GMAIL_SEND_EMAIL")).toBe("send")
    })

    it("classifies Gmail irreversible actions as irreversible", () => {
      expect(classifyAction("gmail", "GMAIL_DELETE_MESSAGE")).toBe("irreversible")
    })

    it("classifies Calendar read actions as read", () => {
      expect(classifyAction("googlecalendar", "GOOGLECALENDAR_LIST_EVENTS")).toBe("read")
      expect(classifyAction("googlecalendar", "GOOGLECALENDAR_GET_EVENT")).toBe("read")
    })

    it("classifies Calendar write actions as write", () => {
      expect(classifyAction("googlecalendar", "GOOGLECALENDAR_CREATE_EVENT")).toBe("write")
      expect(classifyAction("googlecalendar", "GOOGLECALENDAR_UPDATE_EVENT")).toBe("write")
    })

    it("classifies Calendar irreversible actions as irreversible", () => {
      expect(classifyAction("googlecalendar", "GOOGLECALENDAR_DELETE_EVENT")).toBe("irreversible")
    })

    it("classifies Drive read actions as read", () => {
      expect(classifyAction("googledrive", "GOOGLEDRIVE_LIST_FILES")).toBe("read")
      expect(classifyAction("googledrive", "GOOGLEDRIVE_FIND_FILE")).toBe("read")
      expect(classifyAction("googledrive", "GOOGLEDRIVE_GET_FILE_METADATA")).toBe("read")
    })

    it("classifies Drive write actions as write", () => {
      expect(classifyAction("googledrive", "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT")).toBe("write")
      expect(classifyAction("googledrive", "GOOGLEDRIVE_UPDATE_FILE_PUT")).toBe("write")
    })

    it("classifies Drive irreversible actions as irreversible", () => {
      expect(classifyAction("googledrive", "GOOGLEDRIVE_GOOGLE_DRIVE_DELETE_FOLDER_OR_FILE_ACTION")).toBe("irreversible")
    })

    it("classifies Classroom read actions as read", () => {
      expect(classifyAction("google_classroom", "GOOGLE_CLASSROOM_COURSES_LIST")).toBe("read")
    })

    it("defaults an unclassified Classroom action to write (Composio has no write actions here)", () => {
      expect(classifyAction("google_classroom", "GOOGLE_CLASSROOM_SOME_NEW_ACTION")).toBe("write")
    })

    it("classifies Tasks read actions as read", () => {
      expect(classifyAction("googletasks", "GOOGLETASKS_LIST_TASKS")).toBe("read")
      expect(classifyAction("googletasks", "GOOGLETASKS_GET_TASK")).toBe("read")
    })

    it("classifies Tasks write actions as write", () => {
      expect(classifyAction("googletasks", "GOOGLETASKS_CREATE_TASK")).toBe("write")
      expect(classifyAction("googletasks", "GOOGLETASKS_UPDATE_TASK")).toBe("write")
    })

    it("classifies Tasks irreversible actions as irreversible", () => {
      expect(classifyAction("googletasks", "GOOGLETASKS_DELETE_TASK")).toBe("irreversible")
    })

    it("classifies Meet read actions as read", () => {
      expect(classifyAction("googlemeet", "GOOGLEMEET_GET_SPACE")).toBe("read")
    })

    it("classifies Meet write actions as write", () => {
      expect(classifyAction("googlemeet", "GOOGLEMEET_CREATE_SPACE")).toBe("write")
    })
  })
})
