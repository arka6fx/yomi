# Notion Connector

Runtime definition: Python port in progress (`apps/backend/src/yomi/connectors/`)

Runtime id: `notion`

Auth: OAuth 2.0 Notion public integration. Users must explicitly share
pages/databases with the integration.

## Tools

| Tool                         | Type  | Purpose                                             |
| ---------------------------- | ----- | --------------------------------------------------- |
| `notion-search`              | Read  | Search shared pages and databases.                  |
| `notion-listPages`           | Read  | List shared pages/databases by recent edit.         |
| `notion-getPage`             | Read  | Read page properties and block text.                |
| `notion-queryDatabase`       | Read  | Query database rows, optionally filtering by title. |
| `notion-listDatabases`       | Read  | List databases shared with the integration.         |
| `notion-getDatabaseSchema`   | Read  | Return property names and types for a database.     |
| `notion-listUsers`           | Read  | List workspace users.                               |
| `notion-createPage`          | Write | Create a page under a database or page.             |
| `notion-updatePage`          | Write | Update title, simple properties, or archive state.  |
| `notion-appendContent`       | Write | Append text blocks to a page.                       |
| `notion-createDatabaseEntry` | Write | Create a database row.                              |
| `notion-createDatabase`      | Write | Create a database.                                  |

## Notes

Write tools use the `requireConfirmed` pattern — they require `confirmed=true`
after explicit user confirmation. The implementation discovers database title
properties instead of assuming `Name`.
