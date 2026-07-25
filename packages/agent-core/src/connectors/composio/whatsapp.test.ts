import { describe, expect, it } from "bun:test"
import { whatsappComposioSpecs } from "./whatsapp.js"

const SLUGS_NEEDING_PHONE_NUMBER_ID = [
  "WHATSAPP_SEND_MESSAGE",
  "WHATSAPP_SEND_REPLY",
  "WHATSAPP_SEND_MEDIA",
  "WHATSAPP_SEND_MEDIA_BY_ID",
  "WHATSAPP_SEND_LOCATION",
  "WHATSAPP_SEND_CONTACTS",
  "WHATSAPP_SEND_INTERACTIVE_BUTTONS",
  "WHATSAPP_SEND_INTERACTIVE_LIST",
  "WHATSAPP_SEND_TEMPLATE_MESSAGE",
  "WHATSAPP_UPLOAD_MEDIA",
]

describe("whatsappComposioSpecs", () => {
  it.each(SLUGS_NEEDING_PHONE_NUMBER_ID)(
    "auto-resolves phone_number_id via WHATSAPP_GET_PHONE_NUMBERS (singleton-only) for %s",
    (slug) => {
      const spec = whatsappComposioSpecs.find((s) => s.slug === slug)
      expect(spec?.resolvedParams).toEqual({
        phone_number_id: { viaSlug: "WHATSAPP_GET_PHONE_NUMBERS", list: true },
      })
    },
  )
})
