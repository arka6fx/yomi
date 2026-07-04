# Google Calendar Connector

Runtime definition: `packages/agent-core/src/connectors/google-calendar-def.ts`

Runtime id: `google-calendar`

Auth: OAuth 2.0 with `https://www.googleapis.com/auth/calendar` and
`userinfo.email`.

## Tools

| Tool                    | Type         | Purpose                                            |
| ----------------------- | ------------ | -------------------------------------------------- |
| `calendar-listEvents`   | Read         | List upcoming primary-calendar events.             |
| `calendar-getEvent`     | Read         | Read one event by ID.                              |
| `calendar-findFreeTime` | Read         | Query busy periods for a date.                     |
| `calendar-createEvent`  | Write        | Create an event.                                   |
| `calendar-updateEvent`  | Write        | Patch event title, time, description, or location. |
| `calendar-deleteEvent`  | Irreversible | Delete an event.                                   |

## Notes

Create, update, and delete operations require user confirmation before
execution.
