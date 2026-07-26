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
    expect(COMPOSIO_RISK_MAP["googledocs"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googlesheets"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googleslides"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["google_classroom"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googletasks"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googlemeet"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["google_maps"]).toBeDefined()
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
      expect(classifyAction("googlecalendar", "GOOGLECALENDAR_EVENTS_LIST")).toBe("read")
      expect(classifyAction("googlecalendar", "GOOGLECALENDAR_FIND_EVENT")).toBe("read")
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

    it("classifies Docs read actions as read, including cross-connector Sheets chart reads", () => {
      expect(classifyAction("googledocs", "GOOGLEDOCS_GET_DOCUMENT_BY_ID")).toBe("read")
      expect(classifyAction("googledocs", "GOOGLEDOCS_GET_CHARTS_FROM_SPREADSHEET")).toBe("read")
    })

    it("classifies Docs write actions as write", () => {
      expect(classifyAction("googledocs", "GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN")).toBe("write")
      expect(classifyAction("googledocs", "GOOGLEDOCS_UPDATE_DOCUMENT_MARKDOWN")).toBe("write")
    })

    it("classifies Sheets read actions as read", () => {
      expect(classifyAction("googlesheets", "GOOGLESHEETS_GET_SPREADSHEET_INFO")).toBe("read")
      expect(classifyAction("googlesheets", "GOOGLESHEETS_BATCH_GET")).toBe("read")
    })

    it("classifies Sheets write actions as write", () => {
      expect(classifyAction("googlesheets", "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND")).toBe("write")
      expect(classifyAction("googlesheets", "GOOGLESHEETS_CREATE_CHART")).toBe("write")
    })

    it("classifies Sheets irreversible actions as irreversible", () => {
      expect(classifyAction("googlesheets", "GOOGLESHEETS_DELETE_SHEET")).toBe("irreversible")
    })

    it("classifies Slides read actions as read", () => {
      expect(classifyAction("googleslides", "GOOGLESLIDES_PRESENTATIONS_GET")).toBe("read")
    })

    it("classifies Slides write actions as write", () => {
      expect(classifyAction("googleslides", "GOOGLESLIDES_CREATE_SLIDES_MARKDOWN")).toBe("write")
      expect(classifyAction("googleslides", "GOOGLESLIDES_PRESENTATIONS_CREATE")).toBe("write")
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
      expect(classifyAction("googletasks", "GOOGLETASKS_INSERT_TASK")).toBe("write")
      expect(classifyAction("googletasks", "GOOGLETASKS_PATCH_TASK")).toBe("write")
    })

    it("classifies Tasks irreversible actions as irreversible", () => {
      expect(classifyAction("googletasks", "GOOGLETASKS_DELETE_TASK")).toBe("irreversible")
    })

    it("classifies Meet read actions as read", () => {
      expect(classifyAction("googlemeet", "GOOGLEMEET_GET_MEET")).toBe("read")
    })

    it("classifies Meet write actions as write", () => {
      expect(classifyAction("googlemeet", "GOOGLEMEET_CREATE_MEET")).toBe("write")
    })

    it("classifies Maps read actions as read", () => {
      expect(classifyAction("google_maps", "GOOGLE_MAPS_NEARBY_SEARCH")).toBe("read")
      expect(classifyAction("google_maps", "GOOGLE_MAPS_TEXT_SEARCH")).toBe("read")
    })

    it("defaults an unclassified Maps action to write (covers the excluded GEOCODING_API/GET_DIRECTION tools)", () => {
      expect(classifyAction("google_maps", "GOOGLE_MAPS_GEOCODING_API")).toBe("write")
    })
  })

  describe("Stripe actions", () => {
    // Confirmed by the connector audit: money-movement writes sat at the same
    // "write" tier as trivial writes, and 4 real reads Yomi implements were
    // missing from the map entirely (defaulting to "write" — safe direction,
    // but needless approval friction for a plain read).
    it("classifies money-movement writes as paid, not plain write", () => {
      expect(classifyAction("stripe", "STRIPE_CREATE_PAYMENT_INTENT")).toBe("paid")
      expect(classifyAction("stripe", "STRIPE_CONFIRM_PAYMENT_INTENT")).toBe("paid")
      expect(classifyAction("stripe", "STRIPE_CREATE_REFUND")).toBe("paid")
    })

    it("classifies cancelling a subscription as irreversible — its own description says 'cannot be undone'", () => {
      expect(classifyAction("stripe", "STRIPE_CANCEL_SUBSCRIPTION")).toBe("irreversible")
    })

    it("classifies the 4 reads that were falling through to the write default", () => {
      expect(classifyAction("stripe", "STRIPE_LIST_CUSTOMER_PAYMENT_METHODS")).toBe("read")
      expect(classifyAction("stripe", "STRIPE_RETRIEVE_SUBSCRIPTION")).toBe("read")
      expect(classifyAction("stripe", "STRIPE_RETRIEVE_REFUND")).toBe("read")
      expect(classifyAction("stripe", "STRIPE_LIST_SHIPPING_RATES")).toBe("read")
    })
  })

  describe("HubSpot actions", () => {
    // Confirmed by the connector audit: the map used single-prefixed slugs
    // (HUBSPOT_LIST_CONTACTS) while HubSpot's real Composio catalog double-prefixes
    // most of them (HUBSPOT_HUBSPOT_LIST_CONTACTS) — 10 of 11 reads Yomi actually
    // implements fell through to the "write" default.
    it("classifies the real (double-prefixed) HubSpot read slugs as read", () => {
      expect(classifyAction("hubspot", "HUBSPOT_HUBSPOT_GET_COMPANY")).toBe("read")
      expect(classifyAction("hubspot", "HUBSPOT_HUBSPOT_LIST_COMPANIES")).toBe("read")
      expect(classifyAction("hubspot", "HUBSPOT_HUBSPOT_SEARCH_COMPANIES")).toBe("read")
      expect(classifyAction("hubspot", "HUBSPOT_HUBSPOT_LIST_CONTACTS")).toBe("read")
      expect(classifyAction("hubspot", "HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA")).toBe("read")
      expect(classifyAction("hubspot", "HUBSPOT_HUBSPOT_GET_DEAL")).toBe("read")
      expect(classifyAction("hubspot", "HUBSPOT_HUBSPOT_LIST_DEALS")).toBe("read")
      expect(classifyAction("hubspot", "HUBSPOT_HUBSPOT_SEARCH_DEALS")).toBe("read")
      expect(classifyAction("hubspot", "HUBSPOT_GET_TICKET")).toBe("read")
      expect(classifyAction("hubspot", "HUBSPOT_LIST_TICKETS")).toBe("read")
    })

    it("classifies the real archive slugs as irreversible, not the write default", () => {
      expect(classifyAction("hubspot", "HUBSPOT_ARCHIVE_CONTACT_BY_ID")).toBe("irreversible")
      expect(classifyAction("hubspot", "HUBSPOT_HUBSPOT_ARCHIVE_DEALS")).toBe("irreversible")
    })
  })

  describe("Dynamics 365 actions", () => {
    // Confirmed by the connector audit: the whole block was keyed "dynamics_365"
    // (underscore) while the real toolkit slug is "dynamics365" (none) — so the
    // lookup always missed regardless of slug content. The slugs themselves were
    // also fictional (DYNAMICS_365_GET_ACCOUNT, DYNAMICS_365_LIST_ACCOUNTS, ...);
    // dynamics-365.ts's own comment documents the real catalog has no delete/
    // list-accounts/search actions at all — real slugs are double-prefixed
    // (DYNAMICS365_DYNAMICSCRM_*).
    it("classifies real Dynamics 365 reads under the correct toolkit key", () => {
      expect(classifyAction("dynamics365", "DYNAMICS365_DYNAMICSCRM_GET_A_LEAD")).toBe("read")
      expect(classifyAction("dynamics365", "DYNAMICS365_DYNAMICSCRM_GET_ALL_LEADS")).toBe("read")
      expect(classifyAction("dynamics365", "DYNAMICS365_DYNAMICSCRM_GET_A_INVOICE")).toBe("read")
      expect(classifyAction("dynamics365", "DYNAMICS365_DYNAMICS365_GET_ALL_INVOICES_ACTION")).toBe("read")
    })

    it("classifies real Dynamics 365 create/update actions as write", () => {
      expect(classifyAction("dynamics365", "DYNAMICS365_DYNAMICSCRM_CREATE_ACCOUNT")).toBe("write")
      expect(classifyAction("dynamics365", "DYNAMICS365_DYNAMICSCRM_CREATE_INVOICE")).toBe("write")
      expect(classifyAction("dynamics365", "DYNAMICS365_DYNAMICSCRM_UPDATE_LEAD")).toBe("write")
      expect(classifyAction("dynamics365", "DYNAMICS365_DYNAMICSCRM_UPDATE_SALES_ORDER")).toBe("write")
    })
  })

  describe("Zoho Invoice actions", () => {
    // Confirmed by the connector audit: the map was keyed "zoho-invoice" (hyphen)
    // while the real toolkit slug is "zoho_invoice" (underscore), so the lookup
    // always missed. zoho-invoice.ts implements 6 real actions, all read-only.
    it("classifies the real Zoho Invoice read slugs under the correct (underscore) toolkit key", () => {
      expect(classifyAction("zoho_invoice", "ZOHO_INVOICE_LIST_INVOICES")).toBe("read")
      expect(classifyAction("zoho_invoice", "ZOHO_INVOICE_LIST_CONTACTS")).toBe("read")
      expect(classifyAction("zoho_invoice", "ZOHO_INVOICE_LIST_ITEMS")).toBe("read")
      expect(classifyAction("zoho_invoice", "ZOHO_INVOICE_GET_ITEM")).toBe("read")
      expect(classifyAction("zoho_invoice", "ZOHO_INVOICE_LIST_EXPENSES")).toBe("read")
      expect(classifyAction("zoho_invoice", "ZOHO_INVOICE_LIST_PAYMENTS")).toBe("read")
    })
  })
})
