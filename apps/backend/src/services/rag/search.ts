import { sql } from "drizzle-orm"
import { db, ragSources } from "@yomi/db"

export type RagSearchResult = { sourceName: string; title: string; content: string }

// Same FTS query fetchRagContext (apps/backend/src/agent/run.ts) uses for passive
// injection, factored out so it can also back the actively-callable rag_search tool.
export async function searchRagDocuments(
  userId: string,
  query: string,
  limit: number,
): Promise<RagSearchResult[]> {
  try {
    const safe = query.trim().slice(0, 500)
    if (!safe) return []
    const result = await db.execute(sql`
      select s.name as "sourceName", d.title as "title", c.content as "content"
      from rag_chunks c
      join rag_documents d on d.id = c.document_id
      join ${ragSources} s on s.id = d.source_id
      where c.user_id = ${userId}
        and s.status in ('ready', 'active', 'backfilling')
        and c.content_tsv @@ websearch_to_tsquery('english', ${safe})
      order by ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', ${safe})) desc
      limit ${limit}
    `)
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as RagSearchResult[]
    return rows.map((row) => ({
      ...row,
      content: row.content.length > 1200 ? `${row.content.slice(0, 1200)}...` : row.content,
    }))
  } catch {
    return []
  }
}
