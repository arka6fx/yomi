"""Generate the initial D1 schema from the canonical SQLAlchemy metadata.

Postgres-only vector tables move to Vectorize. Generated tsvector columns move
to application-owned search in a later migration and are not copied as data.
"""

from __future__ import annotations

import re
from pathlib import Path

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR, UUID

from yomi.db import Base

SKIP_TABLES = {"memory_embeddings", "rag_embeddings"}
OUTPUT = Path(__file__).parents[1] / "migrations-d1" / "0001_initial.sql"


def quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def column_type(column) -> str:
    type_ = column.type
    if isinstance(type_, (Integer, Boolean)):
        return "INTEGER"
    if isinstance(type_, (String, DateTime, UUID, JSONB, ARRAY, TSVECTOR, Vector)):
        return "TEXT"
    message = f"Unsupported D1 type: {type(type_).__name__} ({column.table.name}.{column.name})"
    raise TypeError(message)


def default_sql(column) -> str | None:
    default = column.server_default
    if default is None:
        return None
    raw = str(default.arg).strip()
    lowered = raw.lower()
    if "gen_random_uuid" in lowered:
        return "(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || " \
            "substr(lower(hex(randomblob(2))), 2) || '-' || " \
            "substr('89ab', abs(random()) % 4 + 1, 1) || " \
            "substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))"
    if lowered in {"now()", "current_timestamp"}:
        return "CURRENT_TIMESTAMP"
    if lowered in {"true", "false"}:
        return "1" if lowered == "true" else "0"
    raw = re.sub(r"::[a-zA-Z0-9_\[\]]+$", "", raw)
    if isinstance(column.type, ARRAY) and raw == "'{}'":
        return "'[]'"
    return raw


def included_columns(table):
    return [column for column in table.columns if not isinstance(column.type, TSVECTOR)]


def create_table(table) -> str:
    columns = included_columns(table)
    definitions: list[str] = []
    composite_pk = len(table.primary_key.columns) > 1
    for column in columns:
        parts = [quote(column.name), column_type(column)]
        if column.primary_key and not composite_pk:
            parts.append("PRIMARY KEY")
        if not column.nullable:
            parts.append("NOT NULL")
        default = default_sql(column)
        if default is not None:
            parts.extend(("DEFAULT", default))
        definitions.append(" ".join(parts))

    if composite_pk:
        names = ", ".join(quote(column.name) for column in table.primary_key.columns)
        definitions.append(
            "PRIMARY KEY (" + names + ")"
        )
    included = {column.name for column in columns}
    for constraint in table.constraints:
        name = type(constraint).__name__
        constrained = [column.name for column in getattr(constraint, "columns", ())]
        if name == "UniqueConstraint" and constrained and set(constrained) <= included:
            definitions.append("UNIQUE (" + ", ".join(quote(value) for value in constrained) + ")")
        elif name == "ForeignKeyConstraint" and constrained and set(constrained) <= included:
            elements = list(constraint.elements)
            if elements[0].column.table.name in SKIP_TABLES:
                continue
            targets = [quote(element.column.name) for element in elements]
            clause = (
                "FOREIGN KEY (" + ", ".join(quote(value) for value in constrained) + ") "
                f"REFERENCES {quote(elements[0].column.table.name)} (" + ", ".join(targets) + ")"
            )
            if constraint.ondelete:
                clause += f" ON DELETE {constraint.ondelete}"
            definitions.append(clause)
    body = ",\n  ".join(definitions)
    return f"CREATE TABLE IF NOT EXISTS {quote(table.name)} (\n  {body}\n);"


def indexes(table) -> list[str]:
    included = {column.name for column in included_columns(table)}
    output: list[str] = []
    for index in sorted(table.indexes, key=lambda item: item.name or ""):
        names = [getattr(expression, "name", None) for expression in index.expressions]
        if not index.name or not names or any(name not in included for name in names):
            continue
        unique = "UNIQUE " if index.unique else ""
        output.append(
            f"CREATE {unique}INDEX IF NOT EXISTS {quote(index.name)} ON {quote(table.name)} "
            "(" + ", ".join(quote(name) for name in names) + ");"
        )
    return output


def generate() -> str:
    tables = [table for table in Base.metadata.sorted_tables if table.name not in SKIP_TABLES]
    statements = ["PRAGMA foreign_keys = ON;", ""]
    for table in tables:
        statements.extend((create_table(table), *indexes(table), ""))
    statements.extend(
        (
            "CREATE TABLE IF NOT EXISTS vector_sync_outbox (\n"
            "  id TEXT PRIMARY KEY NOT NULL,\n"
            "  user_id TEXT NOT NULL,\n"
            "  kind TEXT NOT NULL CHECK (kind IN ('memory', 'rag')),\n"
            "  record_id TEXT NOT NULL,\n"
            "  revision TEXT NOT NULL,\n"
            "  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),\n"
            "  payload TEXT,\n"
            "  attempts INTEGER NOT NULL DEFAULT 0,\n"
            "  last_error TEXT,\n"
            "  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n"
            "  processed_at TEXT,\n"
            "  UNIQUE (kind, record_id, revision, operation)\n"
            ");",
            "CREATE INDEX IF NOT EXISTS vector_sync_pending_idx "
            "ON vector_sync_outbox (processed_at, created_at);",
            "",
        )
    )
    return "\n".join(statements)


if __name__ == "__main__":
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(generate(), encoding="utf-8", newline="\n")
    print(f"generated {OUTPUT}")
