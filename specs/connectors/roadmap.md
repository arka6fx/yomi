# Connector Tool Audit And Roadmap

Last updated: 2026-07-07

## Implementation status

All registered connectors (cataloged in `packages/ui-connectors/src/catalog.ts`,
runtime port in progress at `apps/backend/src/yomi/connectors/`) have concrete
tool factories and execute handlers. No registered connector is only a
placeholder.

| Connector        | Implemented tool count | Runtime notes                                                                |
| ---------------- | ---------------------: | ---------------------------------------------------------------------------- |
| Google Gmail     |                     20 | Real Gmail API-backed tools through `GoogleGmailConnector`.                  |
| Google Calendar  |                     10 | Real Calendar API-backed tools, including Google Meet creation.              |
| Google Drive     |                     19 | Real Drive API-backed tools, including file export/read/convert and folders. |
| Google Classroom |                      7 | Real Classroom API-backed tools; gated writes for attach + turn-in.          |
| Google Tasks     |                      6 | Real Tasks API-backed tools, including subtasks.                             |
| Google Meet      |                      7 | Real Meet API-backed tools for spaces, conference records, and transcripts.  |
| GitHub           |                     23 | Real GitHub REST API-backed tools, including account notifications.          |
| Notion           |                     12 | Real Notion API-backed tools with database schema discovery.                 |
| Slack            |                      9 | Real Slack API-backed tools including channel history threads.               |
| Linear           |                     12 | Real Linear GraphQL API-backed tools with states and cycles.                 |

**Total: 125 unique tools across 10 connector defs.**

## Safety — all write/irreversible tools gated

Every mutable tool across all connectors uses `gateWrite` (or Notion's
equivalent `requireConfirmed` pattern) to block execution until the user
confirms the action.

## Future opportunities

These were identified in the audit but are not yet implemented. They are
lower-urgency or require additional scopes.

### Gmail

| Tool                   | Type | Notes                                               |
| ---------------------- | ---- | ---------------------------------------------------- |
| `gmail-searchThreads`  | Read | Search threads and return thread-level summaries.    |
| `gmail-getAttachments` | Read | List attachments for a message with metadata.        |

### Google Calendar

| Tool                                 | Type  | Notes                                                         |
| ------------------------------------ | ----- | ------------------------------------------------------------- |
| `calendar-listEventsByCalendar`      | Read  | Same as list events, but accepts a calendar ID.               |
| `calendar-findFreeTimeWithAttendees` | Read  | Use FreeBusy for user and attendee calendars where available. |
| `calendar-respondToEvent`            | Write | Accept, decline, or tentative RSVP.                           |
| `calendar-searchEvents`              | Read  | Use Calendar `q` search across a range.                       |

### Google Drive

| Tool                      | Type         | Notes                                                    |
| ------------------------- | ------------ | -------------------------------------------------------- |
| `drive-updateFileContent` | Write        | Replace/upload content for non-Google binary/text files. |
| `drive-emptyTrash`        | Irreversible | Only with explicit confirmation.                         |

### Google Classroom

| Tool                                  | Type | Notes                                       |
| ------------------------------------- | ---- | ------------------------------------------- |
| `classroom-getCourse`                 | Read | Read full course details.                   |
| `classroom-listTeachers`              | Read | Useful for "who teaches this class?".       |
| `classroom-listClassmates`            | Read | Only if scopes and school policy allow it.  |
| `classroom-listSubmissionAttachments` | Read | Helps users inspect what submitted.         |

### GitHub

| Tool                       | Type | Notes                                                         |
| -------------------------- | ---- | ------------------------------------------------------------- |
| `github-listPRFiles`       | Read | Needed for review/summarization workflows.                    |
| `github-listIssueComments` | Read | Current issue detail only returns comment count, not content. |
| `github-listPRReviews`     | Read | Show review state and reviewer feedback.                      |
| `github-listWorkflowRuns`  | Read | Answer "did CI pass?" without browsing GitHub.                |

### Notion

| Tool                            | Type  | Notes                                                   |
| ------------------------------- | ----- | ------------------------------------------------------- |
| `notion-updateDatabaseEntry`    | Write | Safer entry-specific update wrapper.                    |
| `notion-addTodo`                | Write | Common page append operation with checkbox blocks.      |
| `notion-createPageFromMarkdown` | Write | Better structured document creation than one paragraph. |

### Slack

| Tool                | Type  | Notes                                           |
| ------------------- | ----- | ----------------------------------------------- |
| `slack-listDMs`     | Read  | Let users pick a DM target without knowing IDs. |
| `slack-setStatus`   | Write | Common personal productivity action.            |
| `slack-addReaction` | Write | Lightweight acknowledgement workflow.           |

### Linear

| Tool                   | Type  | Notes                                            |
| ---------------------- | ----- | ------------------------------------------------ |
| `linear-listMyIssues`  | Read  | Convenience wrapper for assigned issues.         |
| `linear-createProject` | Write | Common planning workflow.                        |
| `linear-updateProject` | Write | Change project status or target dates.           |
| `linear-linkIssue`     | Write | Add related, blocks, or duplicate relationships. |
