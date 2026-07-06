# Google Classroom Connector

Runtime definition: `packages/agent-core/src/connectors/google-classroom-def.ts`

Runtime id: `google-classroom`

Auth: OAuth 2.0 with course read, announcement read, coursework read/write,
student submission read/write, and user email scopes.

## Tools

| Tool                            | Type  | Purpose                                                   |
| ------------------------------- | ----- | --------------------------------------------------------- |
| `classroom-listCourses`         | Read  | List active Classroom courses.                            |
| `classroom-listAssignments`     | Read  | List coursework for a course.                             |
| `classroom-listAnnouncements`   | Read  | List course announcements.                                |
| `classroom-getSubmissionStatus` | Read  | Check the connected student's submission state and grade. |
| `classroom-modifyAttachments`   | Write | Attach a Drive file to an assignment submission.          |
| `classroom-turnIn`              | Write | Turn in (submit) an assignment.                           |

## Write flow

1. `classroom-listCourses` → find courseId
2. `classroom-listAssignments` → find courseWorkId, read the question
3. `drive-createFile` → create content as Google Doc → get fileId + link
4. `drive-shareFile` → share with teacher so they can see it
5. `classroom-modifyAttachments` → attach the Drive file
6. `classroom-turnIn` → submit

Write tools use `gateWrite` and require user confirmation.
