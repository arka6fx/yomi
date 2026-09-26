// The small slice of Markdown Yomi writes in chat (bold, lists, links, code),
// parsed into plain data so the page renders it without injecting HTML.

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string }

export type Block =
  | { type: "paragraph"; lines: Inline[][] }
  | { type: "heading"; inline: Inline[] }
  | { type: "list"; ordered: boolean; items: { marker: string; inline: Inline[] }[] }
  | { type: "code"; text: string }

const INLINE =
  /\*\*([^*]+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,!?;:'"])|(?<![\w*])[*_]([^*_\s][^*_]*?)[*_](?![\w*])/g

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ type: "text", text: text.slice(last, at) })
    if (m[1] !== undefined) out.push({ type: "bold", text: m[1] })
    else if (m[2] !== undefined) out.push({ type: "code", text: m[2] })
    else if (m[3] !== undefined) out.push({ type: "link", text: m[3], href: m[4] ?? m[3] })
    else if (m[5] !== undefined) out.push({ type: "link", text: m[5], href: m[5] })
    else out.push({ type: "italic", text: m[6] ?? "" })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) })
  return out
}

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/
const HEADING = /^\s*#{1,6}\s+(.*)$/

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = []
  const lines = source.replace(/\r\n?/g, "\n").trim().split("\n")
  let paragraph: Inline[][] = []
  let list: Extract<Block, { type: "list" }> | null = null

  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", lines: paragraph })
    if (list) blocks.push(list)
    paragraph = []
    list = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (line.trim().startsWith("```")) {
      flush()
      const code: string[] = []
      while (++i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        code.push(lines[i] ?? "")
      }
      blocks.push({ type: "code", text: code.join("\n") })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const heading = HEADING.exec(line)
    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)
    if (heading) {
      flush()
      blocks.push({ type: "heading", inline: parseInline(heading[1] ?? "") })
    } else if (bullet || numbered) {
      const ordered = Boolean(numbered)
      if (paragraph.length || (list && list.ordered !== ordered)) flush()
      list ??= { type: "list", ordered, items: [] }
      list.items.push({
        marker: numbered ? `${numbered[1] ?? ""}.` : "•",
        inline: parseInline((numbered ? numbered[2] : bullet?.[1]) ?? ""),
      })
    } else if (list && /^\s+\S/.test(line)) {
      // An indented line continues the item above it.
      list.items.at(-1)?.inline.push({ type: "text", text: "\n" }, ...parseInline(line.trim()))
    } else {
      if (list) flush()
      paragraph.push(parseInline(line))
    }
  }
  flush()
  return blocks
}
