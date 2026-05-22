import React, { useEffect, useRef, useMemo } from "react"
import { createRoot } from "react-dom/client"
import { useYomiStore } from "./store"
import type { HotkeyState, ChatEntry } from "./store"

// ── Global styles ─────────────────────────────────────────────────────────────

const styleEl = document.createElement("style")
styleEl.textContent = `
  @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:.2} }
  @keyframes spin   { to{transform:rotate(360deg)} }
  @keyframes blink  { 0%,100%{opacity:1} 50%{opacity:0} }
  @keyframes slideUp{ from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes shrink { from{width:100%} to{width:0%} }
  @keyframes ripple { from{transform:scaleX(0);opacity:1} to{transform:scaleX(1);opacity:0} }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:        rgba(9,9,15,0.97);
    --surface:   rgba(15,15,24,0.98);
    --border:    rgba(255,255,255,0.12);
    --text:      rgba(255,255,255,1);
    --dim:       rgba(230,230,245,0.88);
    --accent:    #9d9dff;
    --accent-d:  rgba(157,157,255,0.15);
    --error:     #ff8080;
    --code-bg:   rgba(6,6,10,1);
    --kw:        #d4a0ff;
    --str:       #89ddff;
    --num:       #ffaa6c;
    --cmt:       #5a6a7a;
    --fn:        #90c0ff;
    --code-text: #c0cad8;
  }
  html, body { background: transparent !important; }
  .drag    { -webkit-app-region: drag;    app-region: drag;    }
  .no-drag { -webkit-app-region: no-drag; app-region: no-drag; }
  ::-webkit-scrollbar { width: 2px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
  button { cursor: pointer; font-family: inherit; }
  kbd { font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; }
`
document.head.appendChild(styleEl)

// ── Constants ─────────────────────────────────────────────────────────────────

const UI_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', sans-serif"
const CODE_FONT = "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace"

// ── Syntax Highlighting ───────────────────────────────────────────────────────

const KW = new Set([
  "def","class","return","if","else","elif","for","while","in","not","and","or",
  "import","from","as","with","try","except","finally","pass","break","continue",
  "lambda","yield","async","await","True","False","None","self","super",
  "const","let","var","function","new","this","typeof","instanceof","export",
  "default","type","interface","enum","extends","implements","public","private",
  "static","abstract","readonly","void","null","undefined","boolean","number","string",
])

type TK = "keyword"|"string"|"number"|"comment"|"fn"|"plain"

function tokenizeLine(line: string): { text: string; kind: TK }[] {
  const out: { text: string; kind: TK }[] = []
  let i = 0
  while (i < line.length) {
    const ch = line[i]!
    // Comment
    if (ch === "#" || (ch === "/" && line[i+1] === "/")) {
      out.push({ text: line.slice(i), kind: "comment" }); break
    }
    // String
    if (ch === '"' || ch === "'") {
      const q = ch; let j = i + 1
      if (line[j] === q && line[j+1] === q) {
        j = i + 3
        while (j < line.length - 2 && !(line[j]===q&&line[j+1]===q&&line[j+2]===q)) j++
        j += 3
      } else {
        while (j < line.length && line[j] !== q) { if (line[j]==="\\") j++; j++ }
        j++
      }
      out.push({ text: line.slice(i, j), kind: "string" }); i = j; continue
    }
    // Backtick template
    if (ch === "`") {
      let j = i + 1
      while (j < line.length && line[j] !== "`") j++
      out.push({ text: line.slice(i, j+1), kind: "string" }); i = j+1; continue
    }
    // Number
    if (/\d/.test(ch) || (ch==="." && /\d/.test(line[i+1]??""))) {
      let j = i
      while (j < line.length && /[\d._xXoObBa-fA-F]/.test(line[j]!)) j++
      out.push({ text: line.slice(i, j), kind: "number" }); i = j; continue
    }
    // Word
    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i
      while (j < line.length && /[\w$]/.test(line[j]!)) j++
      const w = line.slice(i, j)
      out.push({ text: w, kind: KW.has(w) ? "keyword" : line[j]==="(" ? "fn" : "plain" })
      i = j; continue
    }
    out.push({ text: ch, kind: "plain" }); i++
  }
  return out
}

const TK_COLOR: Record<TK, string> = {
  keyword:"var(--kw)", string:"var(--str)", number:"var(--num)",
  comment:"var(--cmt)", fn:"var(--fn)", plain:"var(--code-text)",
}

// ── CodeBlock ─────────────────────────────────────────────────────────────────

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const lines = code.split("\n")
  if (lines.at(-1) === "") lines.pop()
  const numW = String(lines.length).length * 8 + 12
  const [copied, setCopied] = React.useState(false)

  const copyCode = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{
      background: "var(--code-bg)",
      borderRadius: 8,
      overflow: "hidden",
      margin: "6px 0",
      border: "1px solid rgba(255,255,255,0.05)",
      fontSize: 12,
      fontFamily: CODE_FONT,
    }} className="no-drag">
      {/* Header: language label + copy button */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 8px 4px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        background: "rgba(255,255,255,0.02)",
      }}>
        <span style={{ fontSize: 9, color: "rgba(160,160,200,0.4)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {lang || "code"}
        </span>
        <button
          onClick={copyCode}
          style={{
            background: copied ? "rgba(157,157,255,0.15)" : "none",
            border: `1px solid ${copied ? "rgba(157,157,255,0.3)" : "rgba(255,255,255,0.08)"}`,
            borderRadius: 3, padding: "1px 7px",
            fontSize: 9, color: copied ? "rgba(200,200,255,0.85)" : "rgba(180,180,220,0.4)",
            cursor: "pointer", fontFamily: UI_FONT, transition: "all .2s",
          }}
          onMouseEnter={e => { if (!copied) { e.currentTarget.style.color="rgba(255,255,255,0.75)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.2)" }}}
          onMouseLeave={e => { if (!copied) { e.currentTarget.style.color="rgba(180,180,220,0.4)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.08)" }}}
        >
          {copied ? "✓ copied" : "copy"}
        </button>
      </div>
      <div style={{ overflowX: "auto", padding: "8px 0" }}>
        {lines.map((line, idx) => (
          <div key={idx} style={{ display: "flex", alignItems: "flex-start", padding: "1.5px 14px 1.5px 10px", minHeight: 18 }}>
            <span style={{
              color: "rgba(255,255,255,0.12)",
              userSelect: "none",
              minWidth: numW,
              textAlign: "right",
              marginRight: 14,
              flexShrink: 0,
              lineHeight: "18px",
            }}>
              {idx + 1}
            </span>
            <span style={{ color: "var(--code-text)", whiteSpace: "pre", lineHeight: "18px" }}>
              {tokenizeLine(line).map((t, ti) => (
                <span key={ti} style={{ color: TK_COLOR[t.kind] }}>{t.text}</span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Inline Markdown ───────────────────────────────────────────────────────────

function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g
  let last = 0, m: RegExpExecArray | null, k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[2]) parts.push(<strong key={k++} style={{ fontWeight:600, color:"rgba(235,235,255,1)" }}>{m[2]}</strong>)
    else if (m[3]) parts.push(<code key={k++} style={{ fontFamily:CODE_FONT, fontSize:"0.88em", background:"rgba(255,255,255,0.07)", borderRadius:3, padding:"1px 5px", color:"var(--str)" }}>{m[3]}</code>)
    else if (m[4]) parts.push(<em key={k++} style={{ fontStyle:"italic", color:"rgba(200,200,235,0.8)" }}>{m[4]}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

// ── Content Renderer ──────────────────────────────────────────────────────────

type Block =
  | { kind:"h"; level:1|2|3; text:string }
  | { kind:"p"; text:string }
  | { kind:"ul"; items:string[] }
  | { kind:"ol"; items:string[] }
  | { kind:"code"; lang:string; code:string }

function parseBlocks(raw: string): Block[] {
  const lines = raw.split("\n")
  const out: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) { i++; continue }

    // Heading
    const hm = line.match(/^(#{1,3}) (.+)$/)
    if (hm) { out.push({ kind:"h", level:hm[1]!.length as 1|2|3, text:hm[2]! }); i++; continue }

    // Fenced code
    const cm = line.match(/^```(\w*)/)
    if (cm) {
      const lang = cm[1]??""
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith("```")) { body.push(lines[i]!); i++ }
      i++
      out.push({ kind:"code", lang, code:body.join("\n") }); continue
    }

    // Bullet list
    if (/^[-*•] /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*•] /.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^[-*•] /, "")); i++
      }
      out.push({ kind:"ul", items }); continue
    }

    // Numbered list
    if (/^\d+[.)]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\d+[.)]\s+/, "")); i++
      }
      out.push({ kind:"ol", items }); continue
    }

    // Paragraph
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() &&
      !/^#{1,3} /.test(lines[i]!) && !/^```/.test(lines[i]!) &&
      !/^[-*•] /.test(lines[i]!) && !/^\d+[.)]\s/.test(lines[i]!)) {
      para.push(lines[i]!); i++
    }
    if (para.length) out.push({ kind:"p", text:para.join(" ") })
  }
  return out
}

function Blocks({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const blocks = useMemo(() => parseBlocks(text), [text])

  return (
    <div>
      {blocks.map((b, idx) => {
        if (b.kind === "h") {
          const sz = [14, 12.5, 12][b.level - 1]!
          return (
            <div key={idx} style={{
              fontSize: sz, fontWeight: 600, fontFamily: UI_FONT,
              color: "rgba(228,228,248,0.95)", letterSpacing: "-0.01em",
              margin: idx===0 ? "0 0 8px" : "12px 0 5px",
              paddingBottom: b.level===1 ? 5 : 0,
              borderBottom: b.level===1 ? "1px solid rgba(255,255,255,0.05)" : "none",
            }}>
              {b.text}
            </div>
          )
        }
        if (b.kind === "p") {
          return (
            <p key={idx} style={{
              fontSize: 12.5, lineHeight: 1.65, fontFamily: UI_FONT,
              color: "var(--text)", margin: "0 0 7px",
            }}>
              <Inline text={b.text} />
            </p>
          )
        }
        if (b.kind === "ul") {
          return (
            <ul key={idx} style={{ listStyle:"none", padding:0, margin:"0 0 7px" }}>
              {b.items.map((item, i) => (
                <li key={i} style={{ display:"flex", alignItems:"flex-start", gap:7, fontSize:12.5, lineHeight:1.65, fontFamily:UI_FONT, color:"var(--text)", marginBottom:2 }}>
                  <span style={{ color:"var(--accent)", flexShrink:0, marginTop:2, fontSize:9 }}>▸</span>
                  <span><Inline text={item} /></span>
                </li>
              ))}
            </ul>
          )
        }
        if (b.kind === "ol") {
          return (
            <ol key={idx} style={{ listStyle:"none", padding:0, margin:"0 0 7px" }}>
              {b.items.map((item, i) => (
                <li key={i} style={{ display:"flex", alignItems:"flex-start", gap:7, fontSize:12.5, lineHeight:1.65, fontFamily:UI_FONT, color:"var(--text)", marginBottom:2 }}>
                  <span style={{ color:"var(--accent)", flexShrink:0, fontSize:10, fontWeight:600, minWidth:14 }}>{i+1}.</span>
                  <span><Inline text={item} /></span>
                </li>
              ))}
            </ol>
          )
        }
        if (b.kind === "code") {
          return <CodeBlock key={idx} code={b.code} lang={b.lang} />
        }
        return null
      })}
      {isStreaming && (
        <span style={{
          display:"inline-block", width:2, height:"0.85em",
          background:"var(--accent)", marginLeft:2, verticalAlign:"text-bottom",
          animation:"blink 1s step-end infinite", borderRadius:1, opacity:0.8,
        }} />
      )}
    </div>
  )
}

// ── Copy Button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={copy}
      style={{
        display: "flex", alignItems: "center", gap: 4,
        background: copied ? "rgba(157,157,255,0.15)" : "rgba(255,255,255,0.05)",
        border: `1px solid ${copied ? "rgba(157,157,255,0.35)" : "rgba(255,255,255,0.1)"}`,
        borderRadius: 5, padding: "3px 9px",
        fontSize: 10, fontFamily: UI_FONT, letterSpacing: "0.03em",
        color: copied ? "rgba(200,200,255,0.9)" : "rgba(200,200,235,0.55)",
        cursor: "pointer", transition: "all .2s",
      }}
      onMouseEnter={e => { if (!copied) { e.currentTarget.style.background="rgba(255,255,255,0.09)"; e.currentTarget.style.color="rgba(255,255,255,0.85)" }}}
      onMouseLeave={e => { if (!copied) { e.currentTarget.style.background="rgba(255,255,255,0.05)"; e.currentTarget.style.color="rgba(200,200,235,0.55)" }}}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  )
}

// ── Text Input ────────────────────────────────────────────────────────────────

const SCREEN_PROMPT = "Look at my screen and comprehend what's happening. Understand the context — what I'm working on, reading, or doing. If there's a problem, solve it. If there's a question, answer it. If there's code, explain it. Just give me a clear understanding of what's on screen."

function TextInputPanel() {
  const [value, setValue] = React.useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const valueRef = useRef("")

  // Keep ref in sync so document-level listener always sees latest value
  useEffect(() => { valueRef.current = value }, [value])

  // Focus on mount and re-focus on click anywhere in the panel
  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = React.useCallback(() => {
    const text = valueRef.current.trim() || SCREEN_PROMPT
    window.yomi.submitTextQuery(text)
    setValue("")
    valueRef.current = ""
  }, [])

  // Document-level Enter listener — works even when input loses focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        submit()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [submit])

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, overflow: "hidden",
      boxShadow: "0 8px 40px rgba(0,0,0,0.55)",
      animation: "slideUp 0.22s cubic-bezier(0.16,1,0.3,1)",
    }} className="drag">
      <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 9, color: "rgba(157,157,255,0.6)", letterSpacing: "0.12em", fontFamily: UI_FONT, fontWeight: 600, flexShrink: 0 }}>
          ASK
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); submit() }
          }}
          placeholder="Type your question…"
          className="no-drag"
          style={{
            flex: 1, background: "none", border: "none", outline: "none",
            fontSize: 12.5, fontFamily: UI_FONT,
            color: "var(--text)", caretColor: "var(--accent)",
            "::placeholder": { color: "var(--dim)" } as any,
          }}
        />
        <button
          onClick={submit}
          className="no-drag"
          style={{
            background: "rgba(157,157,255,0.15)", border: "1px solid rgba(157,157,255,0.3)",
            borderRadius: 4, padding: "2px 9px", fontSize: 10,
            color: "rgba(200,200,255,0.85)", fontFamily: UI_FONT,
            cursor: "pointer", flexShrink: 0,
          }}
        >
          Send ↵
        </button>
      </div>
      <div style={{ height: 1, background: "rgba(255,255,255,0.04)" }} />
      <div style={{ padding: "4px 12px 5px", fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: UI_FONT }}>
        Takes screenshot automatically · Esc to cancel
      </div>
    </div>
  )
}

// ── Response Panel ────────────────────────────────────────────────────────────

function ResponsePanel({ entry, onDismiss }: { entry: ChatEntry; onDismiss: () => void }) {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      overflow: "hidden",
      animation: "slideUp 0.22s cubic-bezier(0.16,1,0.3,1)",
      boxShadow: "0 8px 40px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.03)",
      position: "relative",
    }} className="drag">

      {/* Transcript strip */}
      {(entry.transcript || entry.error) && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px 6px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(255,255,255,0.02)",
        }}>
          <span style={{
            fontSize: 9, letterSpacing: "0.12em", color: "rgba(139,139,255,0.45)",
            fontFamily: UI_FONT, fontWeight: 600, flexShrink: 0,
          }}>
            {entry.error ? "ERR" : "YOU"}
          </span>
          <span style={{
            fontSize: 11.5, color: entry.error ? "var(--error)" : "var(--dim)",
            fontFamily: UI_FONT, fontStyle: entry.error ? "normal" : "italic",
            flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {entry.error ? `⚠ ${entry.error}` : entry.transcript}
          </span>
          <button
            onClick={onDismiss}
            className="no-drag"
            style={{
              background: "none", border: "none", color: "rgba(255,255,255,0.2)",
              fontSize: 15, lineHeight: 1, padding: "1px 3px", flexShrink: 0,
              borderRadius: 3, transition: "color .15s, background .15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color="#fff"; e.currentTarget.style.background="rgba(255,255,255,0.07)" }}
            onMouseLeave={e => { e.currentTarget.style.color="rgba(255,255,255,0.2)"; e.currentTarget.style.background="none" }}
          >
            ×
          </button>
        </div>
      )}

      {/* Body */}
      {!entry.error && entry.text !== "" && (
        <div style={{ padding: "10px 12px 4px", maxHeight: 340, overflowY: "auto" }} className="no-drag">
          <Blocks text={entry.text} isStreaming={entry.isStreaming} />
        </div>
      )}

      {/* Copy button */}
      {!entry.error && !entry.isStreaming && entry.text && (
        <div style={{ padding: "0 12px 8px", display: "flex", justifyContent: "flex-end" }} className="no-drag">
          <CopyButton text={entry.text} />
        </div>
      )}

    </div>
  )
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function Key({ label }: { label: string }) {
  return (
    <kbd style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
      borderBottom: "2px solid rgba(255,255,255,0.12)",
      borderRadius: 4, padding: "0 4px", fontSize: 9,
      color: "rgba(180,180,220,0.5)", minWidth: 14, height: 15,
    }}>{label}</kbd>
  )
}

function Chip({ label, keys, hot }: { label: string; keys: string[]; hot: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 5,
      background: hot ? "var(--accent-d)" : "rgba(255,255,255,0.03)",
      border: `1px solid ${hot ? "rgba(139,139,255,0.3)" : "rgba(255,255,255,0.07)"}`,
      borderRadius: 5, padding: "2px 7px 2px 6px",
      transition: "all .2s",
    }}>
      <span style={{
        fontSize: 10, fontFamily: UI_FONT,
        color: hot ? "rgba(190,190,255,0.9)" : "rgba(150,150,200,0.5)",
        letterSpacing: "0.01em",
      }}>{label}</span>
      <div style={{ display:"flex", gap:2 }}>
        {keys.map((k, i) => <Key key={i} label={k} />)}
      </div>
    </div>
  )
}

function Toolbar({ state }: { state: HotkeyState }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "7px 10px",
      background: "var(--bg)",
      borderBottom: "1px solid rgba(255,255,255,0.055)",
      borderRadius: "10px 10px 0 0",
      gap: 10,
    }} className="drag">

      {/* Left: brand + state */}
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        {state === "listening" ? (
          <div style={{
            width:7, height:7, borderRadius:"50%", flexShrink:0,
            background:"#f87171", boxShadow:"0 0 8px rgba(248,113,113,0.55)",
            animation:"pulse 1.1s ease-in-out infinite",
          }} />
        ) : state === "processing" ? (
          <div style={{
            width:10, height:10, borderRadius:"50%", flexShrink:0,
            border:"1.5px solid rgba(255,255,255,0.08)", borderTopColor:"var(--accent)",
            animation:"spin .7s linear infinite",
          }} />
        ) : (
          <div style={{ width:7, height:7, borderRadius:"50%", background:"rgba(139,139,255,0.3)", flexShrink:0 }} />
        )}
        <span style={{
          fontSize: 12, fontWeight: 600, fontFamily: UI_FONT,
          letterSpacing: "-0.015em",
          color: state==="idle" ? "rgba(190,190,225,0.5)" : "rgba(225,225,248,0.92)",
          transition: "color .2s",
        }}>
          {state==="listening" ? "Listening…" : state==="processing" ? "Thinking…" : "Yomi"}
        </span>
      </div>

      {/* Right: shortcuts */}
      <div style={{ display:"flex", gap:4 }} className="no-drag">
        {state === "idle" && <>
          <Chip label="Voice" keys={["⌃⇧", "Spc"]} hot={false} />
          <Chip label="Type"  keys={["⌃⇧", "↵"]}  hot={false} />
          <Chip label="Hide"  keys={["⌃⇧", "H"]}  hot={false} />
        </>}
        {state === "listening"   && <><Chip label="Stop"   keys={["⌃⇧","Spc"]} hot={true}  /><Chip label="Cancel" keys={["Esc"]} hot={false} /></>}
        {state === "text-input"  && <Chip label="Cancel" keys={["Esc"]} hot={false} />}
        {state === "processing"  && <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", fontFamily:UI_FONT }}>processing…</span>}
      </div>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const {
    hotkeyState, entries, audioQueue,
    handleSseEvent, setHotkeyState, dismissEntry,
  } = useYomiStore()

  const rootRef         = useRef<HTMLDivElement>(null)
  const streamRef       = useRef<MediaStream | null>(null)
  const processorRef    = useRef<AudioWorkletNode | null>(null)
  const ctxRef          = useRef<AudioContext | null>(null)
  const workletReadyRef = useRef<Promise<void> | null>(null)
  const audioPlayingRef = useRef(false)
  const audioQueueRef   = useRef<string[]>([])
  const audioSourceRef  = useRef<AudioBufferSourceNode | null>(null)
  const draggingRef     = useRef(false)

  // Auto-resize window to fit content.
  // ResizeObserver won't work here — the window constrains the div to 46px so its
  // size never changes even as content grows. scrollHeight includes overflowed content.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const h = el.scrollHeight
    window.yomi.resize(520, Math.max(46, Math.min(h, 540)))
  }, [entries, hotkeyState])

  // Manual drag
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest(".drag") || t.closest(".no-drag")) return
      draggingRef.current = true
      window.yomi.startDrag(e.screenX, e.screenY)
    }
    const onMove = (e: MouseEvent) => { if (draggingRef.current) window.yomi.moveDrag(e.screenX, e.screenY) }
    const onUp   = () => { draggingRef.current = false }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
  }, [])

  // IPC wiring
  useEffect(() => {
    const c1 = window.yomi.onEvent(handleSseEvent)
    const c2 = window.yomi.onStateChange(setHotkeyState)
    return () => { c1(); c2() }
  }, [handleSseEvent, setHotkeyState])

  // AudioContext + worklet
  useEffect(() => {
    const ctx = new AudioContext({ sampleRate: 16000 })
    ctxRef.current = ctx
    const code = `
      class PCMProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const inp = inputs[0]?.[0]
          if (inp?.length) { const c=new Float32Array(inp); this.port.postMessage(c.buffer,[c.buffer]) }
          return true
        }
      }
      registerProcessor('pcm-processor', PCMProcessor)
    `
    const blob = new Blob([code], { type: "application/javascript" })
    const url  = URL.createObjectURL(blob)
    workletReadyRef.current = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url))
    return () => { ctx.close().catch(()=>{}); ctxRef.current = null; workletReadyRef.current = null }
  }, [])

  // Audio playback
  useEffect(() => {
    audioQueueRef.current = audioQueue
    if (!audioQueue.length || audioPlayingRef.current) return
    const ctx = ctxRef.current
    if (!ctx) return
    audioPlayingRef.current = true
    const playNext = async () => {
      while (audioQueueRef.current.length > 0) {
        const b64  = audioQueueRef.current.shift()!
        const bin  = atob(b64)
        const buf  = new Uint8Array(bin.length)
        for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i)
        try {
          const ab  = await ctx.decodeAudioData(buf.buffer)
          const src = ctx.createBufferSource()
          audioSourceRef.current = src
          src.buffer = ab
          src.connect(ctx.destination)
          src.start()
          await new Promise<void>(r => { src.onended = () => { if (audioSourceRef.current===src) audioSourceRef.current=null; r() } })
        } catch {}
      }
      audioPlayingRef.current = false
    }
    playNext()
  }, [audioQueue])

  // Mic acquisition
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(s => { streamRef.current = s })
      .catch(() => {})
    return () => { streamRef.current?.getTracks().forEach(t=>t.stop()) }
  }, [])

  // PCM streaming (listening state)
  useEffect(() => {
    if (hotkeyState !== "listening") {
      processorRef.current?.disconnect()
      processorRef.current = null
      return
    }
    let cancelled = false
    let src: MediaStreamAudioSourceNode | null = null
    let proc: AudioWorkletNode | null = null
    ;(async () => {
      await workletReadyRef.current
      if (cancelled) return
      const stream = streamRef.current, ctx = ctxRef.current
      if (!stream || !ctx) return
      if (ctx.state === "suspended") await ctx.resume()
      if (cancelled) return
      src  = ctx.createMediaStreamSource(stream)
      proc = new AudioWorkletNode(ctx, "pcm-processor")
      proc.port.onmessage = e => window.yomi.sendAudioChunk(e.data as ArrayBuffer, 16000)
      src.connect(proc)
      proc.connect(ctx.destination)
      processorRef.current = proc
    })()
    return () => { cancelled=true; src?.disconnect(); proc?.disconnect(); processorRef.current=null }
  }, [hotkeyState])

  // Entries persist until manually dismissed (× button)

  // Escape: stop audio + dismiss latest
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      audioSourceRef.current?.stop()
      audioSourceRef.current = null
      audioPlayingRef.current = false
      audioQueueRef.current = []
      if (entries.length) dismissEntry(entries.at(-1)!.id)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [entries, dismissEntry])

  const hasContent = entries.length > 0 || hotkeyState === "text-input"

  return (
    <div
      ref={rootRef}
      style={{
        display: "flex",
        flexDirection: "column",
        background: hasContent ? "var(--bg)" : "transparent",
        borderRadius: 10,
        overflow: "hidden",
        border: hasContent ? "1px solid var(--border)" : "none",
        boxShadow: hasContent ? "0 16px 60px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.04)" : "none",
        backdropFilter: hasContent ? "blur(24px) saturate(160%)" : "none",
        WebkitBackdropFilter: hasContent ? "blur(24px) saturate(160%)" : "none",
        transition: "box-shadow .2s",
        minWidth: 520,
      }}
    >
      {/* Toolbar — always visible */}
      <Toolbar state={hotkeyState} />

      {/* Text input panel */}
      {hotkeyState === "text-input" && (
        <div style={{ padding: "6px 7px 7px" }}>
          <TextInputPanel />
        </div>
      )}

      {/* Response stack — newest first, scrollable */}
      {entries.length > 0 && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 5,
          padding: "6px 7px 7px",
          maxHeight: 480, overflowY: "auto",
        }}>
          {[...entries].reverse().map(e => (
            <ResponsePanel key={e.id} entry={e} onDismiss={() => dismissEntry(e.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Mount ─────────────────────────────────────────────────────────────────────

const root = document.getElementById("root")
if (root) createRoot(root).render(<App />)
