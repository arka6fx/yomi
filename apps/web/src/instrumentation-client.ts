// Product analytics (PostHog free tier). Off unless NEXT_PUBLIC_POSTHOG_KEY is set at
// build time; the SDK is only downloaded when it is. Private by default: no session
// recording, no text from the page, and Do Not Track is honoured.
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY

if (key) {
  import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
        capture_pageview: "history_change",
        person_profiles: "identified_only",
        respect_dnt: true,
        disable_session_recording: true,
        mask_all_text: true,
        mask_all_element_attributes: true,
      })
    })
    .catch(() => {
      // analytics must never break the page
    })
}
