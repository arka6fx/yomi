# Google Meet Connector

Runtime definition: Python port in progress (`apps/api/src/yomi/connectors/`)

Runtime id: `google-meet`

Auth: OAuth 2.0 — `meetings.space.created`, `meetings.space.readonly`,
`meetings.space.settings`, user email. The first two are sensitive; `.settings`
is non-sensitive. No CASA.

Requires the **Google Meet API** enabled in the Cloud project.

## Tools

| Tool                         | Type  | Purpose                                                                                                   |
| ---------------------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| `meet-createSpace`           | Write | Create a shareable Meet link.                                                                             |
| `meet-updateSpaceSettings`   | Write | Change who can join an EXISTING space (OPEN/TRUSTED/RESTRICTED) — keeps the link the user already shared. |
| `meet-getSpace`              | Read  | Link, code, access settings, whether a call is live.                                                      |
| `meet-endActiveConference`   | Write | End a live call (risk `irreversible`).                                                                    |
| `meet-listConferenceRecords` | Read  | Past calls, newest first. Entry point for "my last meeting".                                              |
| `meet-getConferenceRecord`   | Read  | One call's detail + who attended and for how long.                                                        |
| `meet-getTranscript`         | Read  | What each person said, in order.                                                                          |

## Two hard limits — both surfaced as guidance, not raw errors

**1. Yomi can only mutate spaces Yomi created.** Google restricts space mutation
to the developer project that created the space — the same rule that blocks
Classroom's `turnIn` on teacher-created work. Ending or reconfiguring a meeting
a human started from the Meet or Calendar UI returns 403 no matter what scopes
are held. `meetWriteError()` translates that 403 into the workflow that does
work: read it afterwards with `meet-listConferenceRecords`, or create a
Yomi-owned space with `meet-createSpace` / `calendar-createEventWithMeet`.

_Reading_ is not restricted this way — conference records, participants, and
transcripts work for any of the user's meetings.

**2. Transcripts require a paid Workspace plan.** Meet only produces a
transcript if transcription was switched on during the call, which is a paid
Google Workspace feature. On a personal `@gmail.com` there will never be one.
This is **not an error** — `meet-getTranscript` returns an empty result with an
explanation, so the agent tells the user why instead of retrying or claiming a
failure.

## Relationship to Calendar

For a meeting with a time and guests, `calendar-createEventWithMeet` is the
right tool — it books the slot _and_ mints the link in one call.
`meet-createSpace` is for an ad-hoc "just give me a link" with no calendar
entry. Both tool descriptions say so, to keep the model from booking a Meet
space with no event.
