# Google Classroom Connector

Runtime definition: Python port in progress (`apps/api/src/yomi/connectors/`)

Runtime id: `google-classroom`

Auth: OAuth 2.0 with course read, announcement read, coursework read/write,
student submission read/write, and user email scopes.

## Tools

| Tool                            | Type  | Purpose                                                    |
| ------------------------------- | ----- | ---------------------------------------------------------- |
| `classroom-listCourses`         | Read  | List active Classroom courses.                             |
| `classroom-listAssignments`     | Read  | List coursework for a course.                              |
| `classroom-getAssignment`       | Read  | Full assignment detail: description, materials, deep link. |
| `classroom-listAnnouncements`   | Read  | List course announcements.                                 |
| `classroom-getSubmissionStatus` | Read  | Check the connected student's submission state and grade.  |
| `classroom-modifyAttachments`   | Write | Attach a Drive file to a Yomi-created assignment.          |
| `classroom-turnIn`              | Write | Turn in (submit) a Yomi-created assignment.                |

## Solution flow (teacher-created assignments)

The Classroom API only lets the developer project that created a coursework item
modify or turn in its submissions, so `classroom-modifyAttachments` /
`classroom-turnIn` return a guided error on teacher-created assignments.
Standard flow:

1. `classroom-listCourses` → find courseId
2. `classroom-listAssignments` → find courseWorkId
3. `classroom-getAssignment` → full question, materials (question PDFs are
   readable via `drive-readFile`), and the assignment's `alternateLink`
4. `drive-createFile` → generate the solution (Doc/Slides/Sheet from Markdown)
5. Reply with the Drive link + the assignment link so the user attaches and
   turns it in with one click

Write tools use `gateWrite` and require user confirmation.
