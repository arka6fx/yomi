# Connector Tool Audit And Roadmap

Last updated: 2026-07-04

## Implementation status

All registered connectors in `packages/agent-core/src/connectors/all-defs.ts`
have concrete tool factories and execute handlers. No registered connector is
only a placeholder.

| Connector        | Implemented tool count | Runtime notes                                                                |
| ---------------- | ---------------------: | ---------------------------------------------------------------------------- |
| Google Gmail     |                     14 | Real Gmail API-backed tools through `GoogleGmailConnector`.                  |
| Google Calendar  |                      8 | Real Calendar API-backed tools, including Google Meet creation.              |
| Google Drive     |                     10 | Real Drive API-backed tools, including file export/read and folder creation. |
| Google Classroom |                      4 | Real Classroom API-backed read-only tools.                                   |
| GitHub           |                     20 | Real GitHub REST API-backed tools, including account notifications.          |
| Notion           |                     10 | Real Notion API-backed tools with database schema discovery.                 |
| Slack            |                      7 | Real Slack API-backed tools including channel history threads.               |
| Linear OAuth     |                     10 | Real Linear GraphQL API-backed tools with states and cycles.                 |
| Linear API Key   |                     10 | Same tool surface as Linear OAuth.                                           |

## Safety — all write/irreversible tools gated

Every mutable tool across all connectors now uses `gateWrite` (or Notion's
equivalent `requireConfirmed` pattern) to block execution until the user
confirms the action. The following were fixed in this update:

| Connector       | Tools gated                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| Google Gmail    | `gmail-markAsRead`, `gmail-markAsUnread`, `gmail-archiveEmail`, `gmail-trashEmail`, `gmail-deletePermanently` |
| Google Calendar | `calendar-createEvent`, `calendar-updateEvent`, `calendar-deleteEvent`                                        |
| Google Drive    | `drive-createFile`, `drive-updateFile`, `drive-deleteFile`                                                    |
| GitHub          | `github-updateIssue`, `github-addLabels`, `github-createBranch`                                               |
| Slack           | `slack-sendMessage`                                                                                           |
| Linear          | `linear-updateIssue`                                                                                          |

## New tools added

### P0 (completed)

| Tool                              | Connector | Type  | Notes                                                              |
| --------------------------------- | --------- | ----- | ------------------------------------------------------------------ |
| `gmail-createDraft`               | Gmail     | Write | Create a draft with recipients, subject, body, optional thread ID. |
| `gmail-listLabels`                | Gmail     | Read  | Return user labels and system labels.                              |
| `gmail-applyLabels`               | Gmail     | Write | Add/remove labels on a message.                                    |
| `calendar-listCalendars`          | Calendar  | Read  | Returns calendar IDs, names, descriptions, and primary status.     |
| `calendar-createEventWithMeet`    | Calendar  | Write | Creates event with Google Meet link via conferenceData.            |
| `github-getNotificationSubject`   | GitHub    | Read  | Resolves notification subject API URLs to readable details.        |
| `github-markNotificationRead`     | GitHub    | Write | Mark one notification thread as read.                              |
| `github-markAllNotificationsRead` | GitHub    | Write | Mark all notifications read.                                       |

### P1 (completed)

| Tool                       | Connector | Type  | Notes                                            |
| -------------------------- | --------- | ----- | ------------------------------------------------ |
| `drive-shareFile`          | Drive     | Write | Share with user/group or create link with role.  |
| `drive-createFolder`       | Drive     | Write | Create folder with optional parent.              |
| `slack-getChannelHistory`  | Slack     | Read  | Fetch recent messages from a channel.            |
| `slack-getThread`          | Slack     | Read  | Fetch replies in a thread by timestamp.          |
| `slack-replyInThread`      | Slack     | Write | Send a threaded reply.                           |
| `notion-listDatabases`     | Notion    | Read  | Return databases shared with integration.        |
| `notion-getDatabaseSchema` | Notion    | Read  | Return property names and types for a database.  |
| `linear-listStates`        | Linear    | Read  | Return valid workflow states per team.           |
| `linear-listCycles`        | Linear    | Read  | Return cycles with start/end dates and progress. |

## Future opportunities

These were identified in the audit but are not yet implemented. They are
lower-urgency or require additional scopes.

### Gmail

| Tool                          | Type  | Notes                                                                  |
| ----------------------------- | ----- | ---------------------------------------------------------------------- |
| `gmail-searchThreads`         | Read  | Search threads and return thread-level summaries.                      |
| `gmail-getAttachments`        | Read  | List attachments for a message with metadata.                          |
| `gmail-saveAttachmentToDrive` | Write | Save an attachment into Drive when both Gmail and Drive are connected. |

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
| `drive-copyFile`          | Write        | Duplicate files into optional folder.                    |
| `drive-updateFileContent` | Write        | Replace/upload content for non-Google binary/text files. |
| `drive-emptyTrash`        | Irreversible | Only with explicit confirmation.                         |
| `drive-listPermissions`   | Read         | Show who has access before changing sharing.             |

### Google Classroom

| Tool                                  | Type | Notes                                       |
| ------------------------------------- | ---- | ------------------------------------------- |
| `classroom-getCourse`                 | Read | Read full course details.                   |
| `classroom-getAssignment`             | Read | Read full coursework details and materials. |
| `classroom-listTeachers`              | Read | Useful for "who teaches this class?".       |
| `classroom-listClassmates`            | Read | Only if scopes and school policy allow it.  |
| `classroom-listSubmissionAttachments` | Read | Helps users inspect what submitted.         |

Do not add turn-in or attach-submission tools unless Google API policy and
scopes clearly allow the action for the target account type.

### GitHub

| Tool                       | Type | Notes                                                         |
| -------------------------- | ---- | ------------------------------------------------------------- |
| `github-listPRFiles`       | Read | Needed for review/summarization workflows.                    |
| `github-getFileContent`    | Read | Read repository file content before editing.                  |
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

Add:

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
