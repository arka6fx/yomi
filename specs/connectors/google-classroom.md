# Google Classroom Connector

Runtime definition: `packages/agent-core/src/connectors/google-classroom-def.ts`

Runtime id: `google-classroom`

Auth: OAuth 2.0 with read-only Classroom course, coursework, announcement, and
user email scopes.

## Tools

| Tool                            | Type | Purpose                                                   |
| ------------------------------- | ---- | --------------------------------------------------------- |
| `classroom-listCourses`         | Read | List active Classroom courses.                            |
| `classroom-listAssignments`     | Read | List coursework for a course.                             |
| `classroom-listAnnouncements`   | Read | List course announcements.                                |
| `classroom-getSubmissionStatus` | Read | Check the connected student's submission state and grade. |

## Notes

This connector is intentionally read-only. Third-party apps cannot submit
assignments on a student's behalf through the Classroom API.
