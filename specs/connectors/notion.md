# Notion Connector

Runtime definition: `packages/agent-core/src/connectors/notion-def.ts`

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
| `notion-createPage`          | Write | Create a page under a database or page.             |
| `notion-updatePage`          | Write | Update title, simple properties, or archive state.  |
| `notion-appendContent`       | Write | Append text blocks to a page.                       |
| `notion-createDatabaseEntry` | Write | Create a database row.                              |

## Notes

Write tools require `confirmed=true` after explicit user confirmation. The
implementation discovers database title properties instead of assuming `Name`.
