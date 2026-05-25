import React, { useEffect, useRef, useMemo, useCallback } from "react"
import { createRoot } from "react-dom/client"
import { useYomiStore } from "./store"
import type { HotkeyState, ChatEntry } from "./store"

// ── Global styles ──────────────────────────────────────────────────────────────

const styleEl = document.createElement("style")
styleEl.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&display=swap');

  @keyframes pulse  { 0%,100%{opacity:1;transform:scale(1)}   50%{opacity:.25;transform:scale(0.85)} }
  @keyframes glow   { 0%,100%{box-shadow:0 0 6px 1px rgba(255,210,150,0.5)} 50%{box-shadow:0 0 14px 3px rgba(255,210,150,0.15)} }
  @keyframes spin   { to{transform:rotate(360deg)} }
  @keyframes blink  { 0%,100%{opacity:1} 50%{opacity:0} }
  @keyframes slideUp  { from{opacity:0;transform:translateY(7px)} to{opacity:1;transform:translateY(0)} }
  @keyframes slideDown{ from{opacity:1;transform:translateY(0)} to{opacity:0;transform:translateY(6px)} }
  @keyframes fadeIn   { from{opacity:0} to{opacity:1} }

  * { box-sizing:border-box; margin:0; padding:0; }
  :root {
    --bg:        rgba(11,10,8,0.72);
    --surface:   rgba(20,18,13,0.78);
    --border:    rgba(255,224,194,0.09);
    --border-hi: rgba(255,224,194,0.18);
    --text:      rgba(238,233,224,1);
    --dim:       rgba(175,163,145,0.9);
    --accent:    #ffe0c2;
    --accent-d:  rgba(255,224,194,0.1);
    --accent-g:  rgba(255,200,130,0.22);
    --error:     #ff8c65;
    --error-d:   rgba(255,140,101,0.12);
    --code-bg:   rgba(9,8,6,1);
    --kw:        #ffd099;
    --str:       #a3c9a8;
    --num:       #ffb870;
    --cmt:       rgba(145,128,95,0.65);
    --fn:        #ffe0c2;
    --code-text: rgba(208,196,178,1);
  }
  html, body { background: transparent !important; height:100%; margin:0; overflow:hidden; }
  #root { height:100%; display:flex; flex-direction:column; }
  .drag    { -webkit-app-region:drag;    app-region:drag;    }
  .no-drag { -webkit-app-region:no-drag; app-region:no-drag; }
  ::-webkit-scrollbar { width:3px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:rgba(255,224,194,0.18); border-radius:3px; }
  ::-webkit-scrollbar-thumb:hover { background:rgba(255,224,194,0.35); }
  button { cursor:pointer; font-family:inherit; }
  kbd    { font-family:'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace; }
  ::selection { background:rgba(255,224,194,0.2); color:#fff; }
  input[type=range] { -webkit-appearance:none; appearance:none; background:transparent; cursor:pointer; }
  input[type=range]::-webkit-slider-runnable-track {
    height:3px; border-radius:2px; background:rgba(255,224,194,0.1);
  }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance:none; appearance:none;
    width:12px; height:12px; border-radius:50%; margin-top:-4.5px;
    background:rgba(255,224,194,0.75); border:1.5px solid rgba(255,200,130,0.4);
    box-shadow:0 0 4px rgba(255,200,130,0.3); transition:background .15s,box-shadow .15s;
  }
  input[type=range]:hover::-webkit-slider-thumb {
    background:rgba(255,224,194,1); box-shadow:0 0 8px rgba(255,200,130,0.55);
  }
  ::placeholder { color:rgba(200,185,160,0.45) !important; }
`
document.head.appendChild(styleEl)

// ── Constants ──────────────────────────────────────────────────────────────────

const UI_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', sans-serif"
const DISPLAY_FONT = "'Caveat', cursive"
const CODE_FONT = "'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace"

// ── Syntax Highlighting ────────────────────────────────────────────────────────

const KW = new Set([
  "def","class","return","if","else","elif","for","while","in","not","and","or",
  "import","from","as","with","try","except","finally","pass","break","continue",
  "lambda","yield","async","await","True","False","None","self","super",
  "const","let","var","function","new","this","typeof","instanceof","export",
  "default","type","interface","enum","extends","implements","public","private",
  "static","abstract","readonly","void","null","undefined","boolean","number","string",
])

type TK = "keyword"|"string"|"number"|"comment"|"fn"|"plain"

function tokenizeLine(line: string): { text:string; kind:TK }[] {
  const out: { text:string; kind:TK }[] = []
  let i = 0
  while (i < line.length) {
    const ch = line[i]!
    if (ch==="  #" || (ch==="/" && line[i+1]==="/")) {
      out.push({ text:line.slice(i), kind:"comment" }); break
    }
    if (ch==="#") { out.push({ text:line.slice(i), kind:"comment" }); break }
    if (ch==='"' || ch==="'") {
      const q=ch; let j=i+1
      if (line[j]===q && line[j+1]===q) {
        j=i+3; while (j<line.length-2 && !(line[j]===q&&line[j+1]===q&&line[j+2]===q)) j++; j+=3
      } else { while (j<line.length && line[j]!==q) { if (line[j]==="\\") j++; j++ }; j++ }
      out.push({ text:line.slice(i,j), kind:"string" }); i=j; continue
    }
    if (ch==="`") {
      let j=i+1; while (j<line.length && line[j]!=="`") j++
      out.push({ text:line.slice(i,j+1), kind:"string" }); i=j+1; continue
    }
    if (/\d/.test(ch)||(ch==="."&&/\d/.test(line[i+1]??""))) {
      let j=i; while (j<line.length && /[\d._xXoObBa-fA-F]/.test(line[j]!)) j++
      out.push({ text:line.slice(i,j), kind:"number" }); i=j; continue
    }
    if (/[a-zA-Z_$]/.test(ch)) {
      let j=i; while (j<line.length && /[\w$]/.test(line[j]!)) j++
      const w=line.slice(i,j)
      out.push({ text:w, kind:KW.has(w)?"keyword":line[j]==="("?"fn":"plain" }); i=j; continue
    }
    out.push({ text:ch, kind:"plain" }); i++
  }
  return out
}

const TK_COLOR: Record<TK,string> = {
  keyword:"var(--kw)", string:"var(--str)", number:"var(--num)",
  comment:"var(--cmt)", fn:"var(--fn)", plain:"var(--code-text)",
}

// ── Answer Block (MCQ / definite answer) ──────────────────────────────────────

function AnswerBlock({ answer }: { answer:string }) {
  const [copied, setCopied] = React.useState(false)
  const copy = () => {
    navigator.clipboard.writeText(answer).then(() => { setCopied(true); setTimeout(()=>setCopied(false),2000) })
  }
  return (
    <div style={{
      background:"var(--code-bg)",
      border:"1px solid rgba(255,224,194,0.08)",
      borderRadius:8, overflow:"hidden", margin:"6px 0",
      fontSize:12, fontFamily:UI_FONT,
    }} className="no-drag">
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"4px 8px 4px 12px",
        borderBottom:"1px solid rgba(255,224,194,0.05)",
        background:"rgba(255,224,194,0.025)",
      }}>
        <span style={{ fontSize:9, color:"rgba(255,200,140,0.34)", textTransform:"uppercase", letterSpacing:"0.12em" }}>
          answer
        </span>
        <button
          onClick={copy}
          style={{
            background: copied ? "rgba(255,224,194,0.12)" : "none",
            border:`1px solid ${copied ? "rgba(255,224,194,0.25)" : "rgba(255,224,194,0.08)"}`,
            borderRadius:3, padding:"1px 7px", fontSize:9,
            color: copied ? "rgba(255,224,194,0.85)" : "rgba(175,155,125,0.45)",
            cursor:"pointer", fontFamily:UI_FONT, transition:"all .2s",
          }}
          onMouseEnter={e=>{ if (!copied){ e.currentTarget.style.color="rgba(255,224,194,0.7)"; e.currentTarget.style.borderColor="rgba(255,224,194,0.2)" }}}
          onMouseLeave={e=>{ if (!copied){ e.currentTarget.style.color="rgba(175,155,125,0.45)"; e.currentTarget.style.borderColor="rgba(255,224,194,0.08)" }}}
        >
          {copied ? "✓ copied" : "copy"}
        </button>
      </div>
      <div style={{
        padding:"12px 16px 14px",
        fontSize:13.5,
        fontFamily:UI_FONT,
        fontWeight:450,
        lineHeight:1.58,
        color:"rgba(238,233,224,0.94)",
        textAlign:"left",
        letterSpacing:0,
        whiteSpace:"pre-wrap",
        overflowWrap:"anywhere",
      }}>
        {answer}
      </div>
    </div>
  )
}

// ── CodeBlock ──────────────────────────────────────────────────────────────────

function CodeBlock({ code, lang }: { code:string; lang:string }) {
  if (lang === "answer") return <AnswerBlock answer={code.trim()} />
  const lines = code.split("\n")
  if (lines.at(-1)==="") lines.pop()
  const numW = String(lines.length).length * 8 + 12
  const [copied, setCopied] = React.useState(false)

  const copyCode = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true); setTimeout(()=>setCopied(false), 2000)
    })
  }

  return (
    <div style={{
      background:"var(--code-bg)", borderRadius:8, overflow:"hidden",
      margin:"6px 0", border:"1px solid rgba(255,224,194,0.06)",
      fontSize:12, fontFamily:CODE_FONT,
    }} className="no-drag">
      {/* Header */}
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"4px 8px 4px 12px",
        borderBottom:"1px solid rgba(255,224,194,0.04)",
        background:"rgba(255,224,194,0.02)",
      }}>
        <span style={{ fontSize:9, color:"rgba(255,200,140,0.3)", textTransform:"uppercase", letterSpacing:"0.12em" }}>
          {lang || "code"}
        </span>
        <button
          onClick={copyCode}
          style={{
            background: copied ? "rgba(255,224,194,0.12)" : "none",
            border:`1px solid ${copied ? "rgba(255,224,194,0.25)" : "rgba(255,224,194,0.08)"}`,
            borderRadius:3, padding:"1px 7px", fontSize:9,
            color: copied ? "rgba(255,224,194,0.85)" : "rgba(175,155,125,0.45)",
            cursor:"pointer", fontFamily:UI_FONT, transition:"all .2s",
          }}
          onMouseEnter={e=>{ if (!copied){ e.currentTarget.style.color="rgba(255,224,194,0.7)"; e.currentTarget.style.borderColor="rgba(255,224,194,0.2)" }}}
          onMouseLeave={e=>{ if (!copied){ e.currentTarget.style.color="rgba(175,155,125,0.45)"; e.currentTarget.style.borderColor="rgba(255,224,194,0.08)" }}}
        >
          {copied ? "✓ copied" : "copy"}
        </button>
      </div>
      <div style={{ overflowX:"auto", padding:"8px 0" }}>
        {lines.map((line,idx) => (
          <div key={idx} style={{ display:"flex", alignItems:"flex-start", padding:"1.5px 14px 1.5px 10px", minHeight:18 }}>
            <span style={{
              color:"rgba(255,224,194,0.1)", userSelect:"none",
              minWidth:numW, textAlign:"right", marginRight:14, flexShrink:0, lineHeight:"18px",
            }}>
              {idx+1}
            </span>
            <span style={{ color:"var(--code-text)", whiteSpace:"pre", lineHeight:"18px" }}>
              {tokenizeLine(line).map((t,ti) => (
                <span key={ti} style={{ color:TK_COLOR[t.kind] }}>{t.text}</span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Inline Markdown ────────────────────────────────────────────────────────────

function Inline({ text }: { text:string }) {
  const parts: React.ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g
  let last=0, m: RegExpExecArray|null, k=0
  while ((m=re.exec(text)) !== null) {
    if (m.index>last) parts.push(text.slice(last,m.index))
    if (m[2])      parts.push(<strong key={k++} style={{ fontWeight:600, color:"rgba(238,233,224,1)" }}>{m[2]}</strong>)
    else if (m[3]) parts.push(<code key={k++} style={{ fontFamily:CODE_FONT, fontSize:"0.87em", background:"rgba(255,224,194,0.07)", borderRadius:3, padding:"1px 5px", color:"var(--str)" }}>{m[3]}</code>)
    else if (m[4]) parts.push(<em key={k++} style={{ fontStyle:"italic", color:"rgba(200,185,160,0.85)" }}>{m[4]}</em>)
    last=m.index+m[0].length
  }
  if (last<text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

// ── Content Renderer ───────────────────────────────────────────────────────────

type Block =
  | { kind:"h"; level:1|2|3; text:string }
  | { kind:"p"; text:string }
  | { kind:"ul"; items:string[] }
  | { kind:"ol"; items:string[] }
  | { kind:"code"; lang:string; code:string }

function parseBlocks(raw:string): Block[] {
  const lines=raw.split("\n")
  const out: Block[]=[]
  let i=0
  while (i<lines.length) {
    const line=lines[i]!
    if (!line.trim()) { i++; continue }
    const hm=line.match(/^(#{1,3}) (.+)$/)
    if (hm) { out.push({ kind:"h", level:hm[1]!.length as 1|2|3, text:hm[2]! }); i++; continue }
    const cm=line.match(/^```(\w*)/)
    if (cm) {
      const lang=cm[1]??""; const body:string[]=[]
      i++; while (i<lines.length && !lines[i]!.startsWith("```")) { body.push(lines[i]!); i++ }
      i++; out.push({ kind:"code", lang, code:body.join("\n") }); continue
    }
    if (/^[-*•] /.test(line)) {
      const items:string[]=[]
      while (i<lines.length && /^[-*•] /.test(lines[i]!)) { items.push(lines[i]!.replace(/^[-*•] /,"")); i++ }
      out.push({ kind:"ul", items }); continue
    }
    if (/^\d+[.)]\s/.test(line)) {
      const items:string[]=[]
      while (i<lines.length && /^\d+[.)]\s/.test(lines[i]!)) { items.push(lines[i]!.replace(/^\d+[.)]\s+/,"")); i++ }
      out.push({ kind:"ol", items }); continue
    }
    const para:string[]=[]
    while (i<lines.length && lines[i]!.trim() &&
      !/^#{1,3} /.test(lines[i]!) && !/^```/.test(lines[i]!) &&
      !/^[-*•] /.test(lines[i]!) && !/^\d+[.)]\s/.test(lines[i]!)) { para.push(lines[i]!); i++ }
    if (para.length) out.push({ kind:"p", text:para.join(" ") })
  }
  return out
}

// Renders pre-parsed blocks. Shared by Blocks and CodeAnswerLayout.
function RenderBlocks({ blocks, isStreaming }: { blocks:Block[]; isStreaming:boolean }) {
  return (
    <div>
      {blocks.map((b,idx) => {
        if (b.kind==="h") {
          const sz=[14,12.5,12][b.level-1]!
          return (
            <div key={idx} style={{
              fontSize:sz, fontWeight:600, fontFamily:UI_FONT,
              color:"rgba(238,228,210,0.95)", letterSpacing:"-0.01em",
              margin:idx===0?"0 0 8px":"12px 0 5px",
              paddingBottom:b.level===1?5:0,
              borderBottom:b.level===1?"1px solid rgba(255,224,194,0.07)":"none",
            }}>
              {b.text}
            </div>
          )
        }
        if (b.kind==="p") return (
          <p key={idx} style={{ fontSize:12.5, lineHeight:1.7, fontFamily:UI_FONT, color:"var(--text)", margin:"0 0 7px" }}>
            <Inline text={b.text} />
          </p>
        )
        if (b.kind==="ul") return (
          <ul key={idx} style={{ listStyle:"none", padding:0, margin:"0 0 7px" }}>
            {b.items.map((item,i) => (
              <li key={i} style={{ display:"flex", alignItems:"flex-start", gap:7, fontSize:12.5, lineHeight:1.65, fontFamily:UI_FONT, color:"var(--text)", marginBottom:3 }}>
                <span style={{ color:"var(--accent)", flexShrink:0, marginTop:3, fontSize:7, opacity:0.7 }}>◆</span>
                <span><Inline text={item} /></span>
              </li>
            ))}
          </ul>
        )
        if (b.kind==="ol") return (
          <ol key={idx} style={{ listStyle:"none", padding:0, margin:"0 0 7px" }}>
            {b.items.map((item,i) => (
              <li key={i} style={{ display:"flex", alignItems:"flex-start", gap:7, fontSize:12.5, lineHeight:1.65, fontFamily:UI_FONT, color:"var(--text)", marginBottom:3 }}>
                <span style={{ color:"var(--accent)", flexShrink:0, fontSize:10, fontWeight:600, minWidth:14, opacity:0.75 }}>{i+1}.</span>
                <span><Inline text={item} /></span>
              </li>
            ))}
          </ol>
        )
        if (b.kind==="code") return <CodeBlock key={idx} code={b.code} lang={b.lang} />
        return null
      })}
      {isStreaming && (
        <span style={{
          display:"inline-block", width:2, height:"0.85em",
          background:"var(--accent)", marginLeft:2, verticalAlign:"text-bottom",
          animation:"blink 1s step-end infinite", borderRadius:1, opacity:0.7,
        }} />
      )}
    </div>
  )
}

// When the response contains code blocks: reasoning (top) · code (middle) · complexity (bottom).
// All wrapped in an amber-tinted border, mirroring the code-block card aesthetic.
function ComplexityDisplay({ blocks, isStreaming }: { blocks:Block[]; isStreaming:boolean }) {
  const raw = blocks.filter(b => b.kind === "p").map(b => (b as Extract<Block,{kind:"p"}>).text).join(" ")
  if (!raw) return <RenderBlocks blocks={blocks} isStreaming={isStreaming} />

  const parseOne = (label: string, stopLabel: string) => {
    const idx = raw.search(new RegExp(label + "[:\\s]", "i"))
    if (idx < 0) return null
    const seg = raw.slice(idx)
    const m = seg.match(/O\([^)]+\)/)
    if (!m) return null
    const after = seg.slice(seg.indexOf(m[0]) + m[0].length)
    const stopRe = stopLabel ? new RegExp(stopLabel + "[:\\s]", "i") : null
    const stopIdx = stopRe ? after.search(stopRe) : -1
    const note = (stopIdx >= 0 ? after.slice(0, stopIdx) : after)
      .replace(/^\s*[—–\-|,]+\s*/, "").trim()
    return { notation: m[0], note }
  }

  const time  = parseOne("time",  "space")
  const space = parseOne("space", "")
  if (!time && !space) return <RenderBlocks blocks={blocks} isStreaming={isStreaming} />

  const Pill = ({ label, notation, note }: { label:string; notation:string; note:string }) => (
    <div style={{
      flex:1, minWidth:120,
      background:"rgba(255,200,130,0.04)",
      border:"1px solid rgba(255,200,130,0.14)",
      borderRadius:6, padding:"5px 9px",
    }}>
      <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
        <span style={{
          fontSize:8, fontWeight:700, letterSpacing:"0.14em",
          color:"rgba(255,200,130,0.35)", fontFamily:UI_FONT, userSelect:"none",
        }}>{label}</span>
        <span style={{ fontFamily:CODE_FONT, fontSize:12, color:"rgba(255,200,130,0.85)" }}>
          {notation}
        </span>
      </div>
      {note && (
        <div style={{
          fontSize:10.5, fontFamily:UI_FONT, marginTop:2, lineHeight:1.4,
          color:"rgba(200,180,155,0.55)",
        }}>{note}</div>
      )}
    </div>
  )

  return (
    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
      {time  && <Pill label="TIME"  notation={time.notation}  note={time.note}  />}
      {space && <Pill label="SPACE" notation={space.notation} note={space.note} />}
    </div>
  )
}

function CodeAnswerLayout({ blocks, isStreaming }: { blocks:Block[]; isStreaming:boolean }) {
  const codeIdxs = blocks.map((b,i) => b.kind==="code" ? i : -1).filter(i => i>=0)
  if (codeIdxs.length===0) return <RenderBlocks blocks={blocks} isStreaming={isStreaming} />

  const firstCode = codeIdxs[0]!
  const lastCode  = codeIdxs[codeIdxs.length-1]!

  const reasoningBlocks  = blocks.slice(0, firstCode)
  const codeBlocks       = blocks.slice(firstCode, lastCode+1)
  const complexityBlocks = blocks.slice(lastCode+1)

  const sectionLabel = (text: string) => (
    <div style={{
      fontSize:8.5, fontFamily:UI_FONT, fontWeight:700, letterSpacing:"0.14em",
      color:"rgba(255,200,130,0.35)", marginBottom:6, userSelect:"none",
    }}>{text}</div>
  )

  return (
    <div style={{
      border:"1px solid rgba(255,200,130,0.22)",
      borderRadius:9, overflow:"hidden",
      background:"rgba(255,200,130,0.015)",
    }}>
      {/* Reasoning */}
      {reasoningBlocks.length>0 && (
        <div style={{ padding:"8px 12px 6px", borderBottom:"1px solid rgba(255,200,130,0.08)" }}>
          {sectionLabel("REASONING")}
          <RenderBlocks blocks={reasoningBlocks} isStreaming={isStreaming && codeBlocks.length===0} />
        </div>
      )}

      {/* Code block(s) */}
      <div>
        {codeBlocks.map((b,i) =>
          b.kind==="code" ? <CodeBlock key={i} code={b.code} lang={b.lang} /> : null
        )}
        {isStreaming && codeBlocks.length===0 && reasoningBlocks.length===0 && (
          <div style={{ padding:"8px 12px" }}>
            <span style={{
              display:"inline-block", width:2, height:"0.85em",
              background:"var(--accent)", verticalAlign:"text-bottom",
              animation:"blink 1s step-end infinite", borderRadius:1, opacity:0.7,
            }} />
          </div>
        )}
      </div>

      {/* Complexity */}
      {complexityBlocks.length>0 && (
        <div style={{
          padding:"6px 12px 8px",
          borderTop:"1px solid rgba(255,200,130,0.08)",
          background:"rgba(255,200,130,0.02)",
        }}>
          {sectionLabel("COMPLEXITY")}
          <ComplexityDisplay blocks={complexityBlocks} isStreaming={isStreaming} />
        </div>
      )}
    </div>
  )
}

function Blocks({ text, isStreaming }: { text:string; isStreaming:boolean }) {
  const blocks = useMemo(()=>parseBlocks(text), [text])
  const hasCode = blocks.some(b => b.kind==="code")
  if (hasCode) return <CodeAnswerLayout blocks={blocks} isStreaming={isStreaming} />
  return <RenderBlocks blocks={blocks} isStreaming={isStreaming} />
}

// ── Copy Button ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text:string }) {
  const [copied, setCopied] = React.useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),2000) })
  }
  return (
    <button
      onClick={copy}
      style={{
        display:"flex", alignItems:"center", gap:4,
        background: copied ? "rgba(255,224,194,0.12)" : "rgba(255,224,194,0.05)",
        border:`1px solid ${copied ? "rgba(255,224,194,0.28)" : "rgba(255,224,194,0.1)"}`,
        borderRadius:5, padding:"3px 9px",
        fontSize:10, fontFamily:UI_FONT, letterSpacing:"0.02em",
        color: copied ? "rgba(255,224,194,0.9)" : "rgba(175,155,125,0.55)",
        cursor:"pointer", transition:"all .2s",
      }}
      onMouseEnter={e=>{ if(!copied){e.currentTarget.style.background="rgba(255,224,194,0.09)"; e.currentTarget.style.color="rgba(255,224,194,0.75)"}}}
      onMouseLeave={e=>{ if(!copied){e.currentTarget.style.background="rgba(255,224,194,0.05)"; e.currentTarget.style.color="rgba(175,155,125,0.55)"}}}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  )
}

// ── Text Input ─────────────────────────────────────────────────────────────────

const SCREEN_PROMPT = `Analyze what's on my screen and use the standard answer-block format.

If you see a CODING or ALGORITHM problem, respond in exactly this structure:

[short introduction to the problem and approach]

\`\`\`python
# complete solution — use Python unless the problem or visible code specifies another language
\`\`\`

Time: O(?) — one-line reason
Space: O(?) — one-line reason

Example: include useful examples from the screen when they are visible.

If you see a MULTIPLE CHOICE QUESTION (MCQ) or a question with a single definite answer, respond in exactly this structure:

[1-3 sentence explanation of why the answer is correct]

\`\`\`answer
[letter and answer text, e.g. "B. The mitochondria"]
\`\`\`

If you see a writing task, briefly state what you drafted, then put the exact copy-ready response in an answer block:

\`\`\`answer
[the actual written response]
\`\`\`

For applications and letters, use proper letter format: date, recipient, subject, salutation, body paragraphs, closing, and sender name when appropriate.
For biographies or long paragraph answers, use a clear title, sections, and readable paragraphs. Make it complete without padding.

If there is no question, describe what's on the screen concisely and put the main takeaway in an answer block.`

function TextInputPanel() {
  const [value, setValue] = React.useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const valueRef = useRef("")
  useEffect(()=>{ valueRef.current=value }, [value])
  // Use rAF so the OS-level window focus transfer completes before the DOM focus call.
  useEffect(()=>{ requestAnimationFrame(()=>{ inputRef.current?.focus() }) }, [])

  const submit = React.useCallback(()=>{
    const text = valueRef.current.trim() || SCREEN_PROMPT
    setValue(""); valueRef.current=""
    window.yomi.submitTextQuery(text)
  }, [])

  return (
    <div style={{
      background:"var(--surface)",
      border:"1px solid var(--border-hi)",
      borderRadius:9, overflow:"hidden",
      boxShadow:"0 8px 40px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,224,194,0.04)",
      animation:"slideUp 0.2s cubic-bezier(0.16,1,0.3,1)",
    }} className="drag">
      <div style={{ padding:"8px 10px", display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:10.5, color:"rgba(255,200,130,0.75)", letterSpacing:"0.12em", fontFamily:UI_FONT, fontWeight:700, flexShrink:0 }}>
          ASK
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={e=>setValue(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"){e.preventDefault();submit()} }}
          placeholder="Type your question…"
          className="no-drag"
          style={{
            flex:1, background:"none", border:"none", outline:"none",
            fontSize:12.5, fontFamily:UI_FONT,
            color:"var(--text)", caretColor:"var(--accent)",
          }}
        />
        <button
          onClick={submit}
          className="no-drag"
          style={{
            background:"rgba(255,224,194,0.1)",
            border:"1px solid rgba(255,224,194,0.22)",
            borderRadius:4, padding:"3px 10px", fontSize:11.5,
            color:"rgba(255,224,194,0.9)", fontFamily:UI_FONT,
            cursor:"pointer", flexShrink:0, transition:"all .15s",
          }}
          onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,224,194,0.17)"; e.currentTarget.style.color="rgba(255,224,194,1)"}}
          onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,224,194,0.1)"; e.currentTarget.style.color="rgba(255,224,194,0.8)"}}
        >
          Send ↵
        </button>
      </div>
      <div style={{ height:1, background:"rgba(255,224,194,0.05)" }} />
      <div style={{ padding:"5px 12px 6px", fontSize:11, color:"rgba(185,170,145,0.65)", fontFamily:UI_FONT }}>
        Empty → analyze screen · Esc to cancel · text only, no voice
      </div>
    </div>
  )
}

// ── Response Panel ─────────────────────────────────────────────────────────────

function ResponsePanel({ entry, onDismiss, isActive }: { entry:ChatEntry; onDismiss:()=>void; isActive:boolean }) {
  return (
    <div style={{
      background:"var(--surface)",
      border:"1px solid var(--border)",
      borderRadius:9,
      overflow:"hidden",
      animation:"slideUp 0.22s cubic-bezier(0.16,1,0.3,1)",
      boxShadow:"0 6px 30px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,224,194,0.03)",
      position:"relative",
      display:"flex", flexDirection:"column",
      flexShrink:0,
      maxHeight: isActive ? undefined : 300,
    }} className="drag">

      {/* Warm amber left accent bar */}
      <div style={{
        position:"absolute", left:0, top:0, bottom:0, width:2,
        background: entry.error
          ? "rgba(255,140,101,0.5)"
          : entry.isStreaming
            ? "linear-gradient(to bottom, rgba(255,224,194,0.6), rgba(255,180,90,0.3))"
            : "rgba(255,224,194,0.18)",
        transition:"background .3s",
      }} />

      {/* Transcript strip */}
      {(entry.transcript||entry.error) && (
        <div style={{
          display:"flex", alignItems:"center", gap:8,
          padding:"6px 10px 6px 14px",
          borderBottom:"1px solid rgba(255,224,194,0.05)",
          background:"rgba(255,224,194,0.025)",
          flexShrink:0,
        }}>
          <span style={{
            fontSize:10, letterSpacing:"0.12em", fontFamily:UI_FONT, fontWeight:700, flexShrink:0,
            color: entry.error ? "rgba(255,140,101,0.85)" : "rgba(255,200,130,0.7)",
          }}>
            {entry.error ? "ERR" : "YOU"}
          </span>
          <span style={{
            fontSize:13, fontFamily:UI_FONT,
            color: entry.error ? "var(--error)" : "rgba(200,190,175,0.9)",
            fontStyle:entry.error?"normal":"italic",
            flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          }}>
            {entry.error ? `⚠ ${entry.error}` : entry.transcript}
          </span>
          <button
            onClick={onDismiss}
            className="no-drag"
            style={{
              background:"none", border:"none",
              color:"rgba(255,224,194,0.18)",
              fontSize:15, lineHeight:1, padding:"1px 3px", flexShrink:0,
              borderRadius:3, transition:"color .15s, background .15s",
            }}
            onMouseEnter={e=>{e.currentTarget.style.color="rgba(255,224,194,0.8)"; e.currentTarget.style.background="rgba(255,224,194,0.06)"}}
            onMouseLeave={e=>{e.currentTarget.style.color="rgba(255,224,194,0.18)"; e.currentTarget.style.background="none"}}
          >
            ×
          </button>
        </div>
      )}

      {/* Body — active entry expands to full content height (outer list scrolls);
               older entries scroll individually within their 300px cap */}
      {!entry.error && entry.text !== "" && (
        <div
          className="no-drag"
          style={isActive
            ? { overflowX:"auto", overscrollBehavior:"contain", padding:"10px 12px 4px 14px" }
            : { flex:1, minHeight:0, overflowY:"auto", overflowX:"auto", overscrollBehavior:"contain", padding:"10px 12px 4px 14px" }
          }
        >
          <Blocks text={entry.text} isStreaming={entry.isStreaming} />
        </div>
      )}

      {/* Copy */}
      {!entry.error && !entry.isStreaming && entry.text && (
        <div style={{ padding:"0 12px 8px", display:"flex", justifyContent:"flex-end", flexShrink:0 }} className="no-drag">
          <CopyButton text={entry.text} />
        </div>
      )}
    </div>
  )
}

// ── Toolbar ────────────────────────────────────────────────────────────────────

function Key({ label }: { label:string }) {
  return (
    <kbd style={{
      display:"inline-flex", alignItems:"center", justifyContent:"center",
      background:"rgba(255,224,194,0.08)",
      border:"1px solid rgba(255,224,194,0.16)",
      borderBottom:"2px solid rgba(255,224,194,0.2)",
      borderRadius:4, padding:"0 6px", fontSize:10,
      color:"rgba(255,224,194,0.8)", minWidth:18, height:17,
      fontWeight:500,
    }}>{label}</kbd>
  )
}

const SpeakerOnSVG = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
  </svg>
)

const SpeakerOffSVG = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
  </svg>
)

const HamburgerIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor" aria-hidden>
    <rect y="1.5" width="13" height="1.5" rx="0.75" />
    <rect y="5.75" width="13" height="1.5" rx="0.75" />
    <rect y="10" width="13" height="1.5" rx="0.75" />
  </svg>
)

// ── Menu Card ──────────────────────────────────────────────────────────────────

function MenuCard({ plan, onSignOut, onClose, onHoverEnter, onHoverLeave, closing }: {
  plan?: string
  onSignOut: () => void
  onClose: () => void
  onHoverEnter: () => void
  onHoverLeave: () => void
  closing: boolean
}) {
  const [opacity, setOpacity] = React.useState(() => {
    const saved = localStorage.getItem("yomi:opacity")
    return saved ? parseFloat(saved) : 1.0
  })

  const handleOpacity = (val: number) => {
    setOpacity(val)
    localStorage.setItem("yomi:opacity", String(val))
    window.yomi.setOpacity(val)
  }



  const shortcuts = [
    { label: "Voice",  keys: ["Ctrl", "Shift", "Space"]  },
    { label: "Type",   keys: ["Ctrl", "Shift", "Enter"]  },
    { label: "Move",   keys: ["Ctrl", "Shift", "Arrows"] },
    { label: "Hide",   keys: ["Ctrl", "Shift", "H"]      },
    { label: "Quit",   keys: ["Ctrl", "Shift", "Q"]      },
  ]

  const upgradeLabel = plan === "explore" || plan === "pro" ? "Upgrade"
    : null

  const MenuBtn = ({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      className="no-drag"
      style={{
        width: "100%", textAlign: "left",
        background: "none", border: "none",
        padding: "7px 12px", borderRadius: 6,
        fontSize: 12, fontFamily: UI_FONT, cursor: "pointer",
        color: danger ? "rgba(255,120,90,0.85)" : "rgba(220,210,195,0.88)",
        transition: "background .12s, color .12s", fontWeight: 500,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = danger ? "rgba(255,100,70,0.1)" : "rgba(255,224,194,0.09)"
        e.currentTarget.style.color = danger ? "rgba(255,120,90,1)" : "rgba(255,240,220,1)"
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "none"
        e.currentTarget.style.color = danger ? "rgba(255,120,90,0.85)" : "rgba(220,210,195,0.88)"
      }}
    >
      {label}
    </button>
  )

  return (
    <>
    <div
      className="no-drag yomi-hit-area"
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      style={{
        position: "fixed", top: 34, right: 8, zIndex: 1000,
        width: 216, height: 16,
      }}
    />
    <div
      className="no-drag yomi-hit-area"
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      style={{
        position: "fixed", top: 46, right: 8, zIndex: 1000,
        width: 216,
        background: "rgba(13,11,8,0.94)",
        border: "1px solid rgba(255,224,194,0.1)",
        borderRadius: 10,
        boxShadow: "0 12px 40px rgba(0,0,0,0.65), 0 0 0 0.5px rgba(255,224,194,0.04)",
        backdropFilter: "blur(28px) saturate(160%)",
        WebkitBackdropFilter: "blur(28px) saturate(160%)",
        animation: closing
          ? "slideDown 0.2s cubic-bezier(0.4,0,1,1) forwards"
          : "slideUp 0.22s cubic-bezier(0.16,1,0.3,1)",
        overflow: "hidden",
      }}
    >
      {/* Shortcuts */}
      <div style={{ padding: "10px 14px 10px" }}>
        <div style={{
          fontSize: 10, fontFamily: UI_FONT, fontWeight: 700,
          letterSpacing: "0.1em", color: "rgba(255,200,130,0.6)",
          marginBottom: 10,
        }}>
          SHORTCUTS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {shortcuts.map(({ label, keys }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontFamily: UI_FONT, color: "rgba(210,200,185,0.9)", fontWeight:500 }}>
                {label}
              </span>
              <div style={{ display: "flex", gap: 3 }}>
                {keys.map((k, i) => <Key key={i} label={k} />)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ height: 1, background: "rgba(255,224,194,0.06)" }} />

      {/* Opacity slider */}
      <div style={{ padding: "10px 14px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontFamily: UI_FONT, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,200,130,0.6)" }}>
            OPACITY
          </span>
          <span style={{ fontSize: 11, fontFamily: UI_FONT, color: "rgba(200,185,155,0.8)", fontWeight: 500 }}>
            {Math.round(opacity * 100)}%
          </span>
        </div>
        <input
          type="range" min={20} max={100} step={1}
          value={Math.round(opacity * 100)}
          onChange={e => handleOpacity(parseInt(e.target.value) / 100)}
          className="no-drag"
          style={{ width: "100%", margin: 0 }}
        />
      </div>

      <div style={{ height: 1, background: "rgba(255,224,194,0.06)" }} />

      {/* Actions */}
      <div style={{ padding: "5px" }}>
        {upgradeLabel && (
          <button
            onClick={() => { window.yomi.openUpgrade(); onClose() }}
            className="no-drag"
            style={{
              width: "100%", textAlign: "left",
              background: "rgba(255,200,130,0.07)",
              border: "1px solid rgba(255,200,130,0.2)",
              padding: "8px 12px", borderRadius: 6, marginBottom: 4,
              fontSize: 13, fontFamily: UI_FONT, cursor: "pointer",
              color: "rgba(255,210,140,0.95)", fontWeight: 600,
              transition: "background .12s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,200,130,0.13)" }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,200,130,0.07)" }}
          >
            ✦ {upgradeLabel}
          </button>
        )}
        <MenuBtn label="Sign out" onClick={() => { onSignOut(); onClose() }} />
        <MenuBtn label="Quit" danger onClick={() => { window.yomi.quit(); onClose() }} />
      </div>
    </div>
    </>
  )
}

function Chip({ label, keys, hot }: { label:string; keys:string[]; hot:boolean }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:5,
      background: hot ? "rgba(255,224,194,0.08)" : "rgba(255,224,194,0.03)",
      border:`1px solid ${hot ? "rgba(255,200,130,0.28)" : "rgba(255,224,194,0.07)"}`,
      borderRadius:5, padding:"2px 7px 2px 6px", transition:"all .2s",
    }}>
      <span style={{
        fontSize:11.5, fontFamily:UI_FONT,
        color: hot ? "rgba(255,224,194,1)" : "rgba(220,210,195,0.8)",
        letterSpacing:"0.01em", fontWeight:500,
      }}>{label}</span>
      <div style={{ display:"flex", gap:2 }}>
        {keys.map((k,i)=><Key key={i} label={k} />)}
      </div>
    </div>
  )
}

function Toolbar({ state, plan, interactionInfo, onSignOut, menuOpen, menuClosing, onMenuToggle, onMenuClose, onMenuOpen, onMenuScheduleClose, onMenuCancelClose }: {
  state: HotkeyState; plan?: string; interactionInfo?: string; onSignOut: () => void
  menuOpen: boolean; menuClosing: boolean; onMenuToggle: () => void; onMenuClose: () => void
  onMenuOpen: () => void; onMenuScheduleClose: () => void; onMenuCancelClose: () => void
}) {
  const { ttsEnabled, toggleTts } = useYomiStore()

  return (
    <>
      {/* Backdrop — captures outside clicks to close the menu */}
      {menuOpen && (
        <div
          onClick={onMenuClose}
          style={{ position: "fixed", inset: 0, zIndex: 998 }}
        />
      )}

      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"0 10px",
        height:46,
        background:"rgba(13,11,8,0.94)",
        borderBottom: state!=="idle" ? "1px solid rgba(255,224,194,0.07)" : "1px solid rgba(255,224,194,0.04)",
        borderRadius: "10px 10px 0 0",
        gap:10,
        position: "relative",
        zIndex: 999,
      }} className="drag yomi-hit-area">

        {/* Left: brand + state indicator */}
        <div style={{ display:"flex", alignItems:"center", gap:9 }}>
          {/* Drag grip dots */}
          <div style={{ display:"flex", flexDirection:"column", gap:2.5, opacity:0.2, flexShrink:0 }}>
            {[0,1,2].map(i=>(
              <div key={i} style={{ display:"flex", gap:2.5 }}>
                <div style={{ width:2, height:2, borderRadius:"50%", background:"rgba(255,224,194,1)" }} />
                <div style={{ width:2, height:2, borderRadius:"50%", background:"rgba(255,224,194,1)" }} />
              </div>
            ))}
          </div>

          {/* State dot */}
          {state==="listening" ? (
            <div style={{
              width:7, height:7, borderRadius:"50%", flexShrink:0,
              background:"#ffe0c2",
              boxShadow:"0 0 8px 2px rgba(255,200,130,0.6)",
              animation:"pulse 1.2s ease-in-out infinite",
            }} />
          ) : state==="processing" ? (
            <div style={{
              width:10, height:10, borderRadius:"50%", flexShrink:0,
              border:"1.5px solid rgba(255,224,194,0.08)",
              borderTopColor:"rgba(255,200,130,0.8)",
              animation:"spin .75s linear infinite",
            }} />
          ) : (
            <div style={{
              width:6, height:6, borderRadius:"50%", flexShrink:0,
              background:"rgba(255,224,194,0.18)",
            }} />
          )}

          {/* Label */}
          <span style={{
            fontSize: state==="idle" ? 20 : 12,
            fontWeight: state==="idle" ? 700 : 600,
            fontFamily: state==="idle" ? DISPLAY_FONT : UI_FONT,
            letterSpacing: state==="idle" ? "-0.01em" : "-0.02em",
            lineHeight: 1,
            color: state==="idle"
              ? "rgba(255,224,194,0.55)"
              : state==="listening"
                ? "rgba(255,220,180,0.92)"
                : "rgba(225,210,185,0.85)",
            transition:"color .25s, font-size .25s, font-family .25s",
          }}>
            {state==="listening" ? "Listening…" : state==="processing" ? "Thinking…" : "Yomi"}
          </span>
          {/* Plan badge */}
          {plan && state==="idle" && (
            <span style={{
              fontSize:10.5, fontFamily:UI_FONT, letterSpacing:"0.05em",
              color:"rgba(200,185,155,0.65)",
              border:"1px solid rgba(255,224,194,0.15)",
              borderRadius:4, padding:"0 7px", lineHeight:"18px",
              textTransform:"capitalize", fontWeight:500,
            }}>
              {plan}
            </span>
          )}
          {/* Interaction usage for trial */}
          {interactionInfo && state==="idle" && (
            <span style={{
              fontSize:10.5, fontFamily:UI_FONT, letterSpacing:"0.02em",
              color:"rgba(255,200,130,0.6)",
            }}>
              {interactionInfo}
            </span>
          )}
        </div>

        {/* Right: controls */}
        <div style={{ display:"flex", gap:5, alignItems:"center" }} className="no-drag">
          {/* TTS toggle */}
          <button
            onClick={toggleTts}
            onMouseEnter={e => {
              e.currentTarget.style.color = "rgba(255,224,194,0.9)"
              e.currentTarget.style.background = "rgba(255,224,194,0.07)"
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = ttsEnabled ? "rgba(255,224,194,0.6)" : "rgba(175,155,115,0.35)"
              e.currentTarget.style.background = "none"
            }}
            style={{
              background: "none", border: "none",
              cursor: "pointer", padding: "2px 6px",
              color: ttsEnabled ? "rgba(255,224,194,0.6)" : "rgba(175,155,115,0.35)",
              transition: "color .15s, background .15s",
              display: "flex", alignItems: "center", gap: 4,
              flexShrink: 0, borderRadius: 4,
            }}
          >
            {ttsEnabled ? <SpeakerOnSVG /> : <SpeakerOffSVG />}
            <span style={{ fontSize: 11, fontFamily: UI_FONT, letterSpacing: "0.03em", fontWeight:500 }}>
              {ttsEnabled ? "Sound" : "Muted"}
            </span>
          </button>

          {/* State-specific chips */}
          {state==="listening" && <>
            <Chip label="Stop"   keys={["↵"]}        hot={true}  />
            <Chip label="Stop"   keys={["⌃⇧","Spc"]} hot={false} />
            <Chip label="Cancel" keys={["Esc"]}       hot={false} />
          </>}
          {state==="text-input" && (
            <Chip label="Cancel" keys={["Esc"]} hot={false} />
          )}
          {state==="processing" && (
            <span style={{ fontSize:11.5, color:"rgba(185,170,145,0.65)", fontFamily:UI_FONT }}>processing…</span>
          )}

          {/* Hamburger menu button — opens on hover */}
          <button
            onClick={onMenuToggle}
            onMouseEnter={e => {
              onMenuOpen()
              e.currentTarget.style.color = "rgba(255,224,194,1)"
              e.currentTarget.style.background = "rgba(255,224,194,0.12)"
              e.currentTarget.style.borderColor = "rgba(255,224,194,0.28)"
            }}
            onMouseLeave={e => {
              onMenuScheduleClose()
              if (!menuOpen) {
                e.currentTarget.style.color = "rgba(255,224,194,0.7)"
                e.currentTarget.style.background = "rgba(255,224,194,0.06)"
                e.currentTarget.style.borderColor = "rgba(255,224,194,0.18)"
              }
            }}
            style={{
              background: menuOpen ? "rgba(255,224,194,0.12)" : "rgba(255,224,194,0.06)",
              border: `1px solid ${menuOpen ? "rgba(255,224,194,0.28)" : "rgba(255,224,194,0.18)"}`,
              borderRadius: 5, cursor: "pointer",
              color: menuOpen ? "rgba(255,224,194,1)" : "rgba(255,224,194,0.7)",
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 22, flexShrink: 0,
              transition: "all .15s",
            }}
            title="Menu"
          >
            <HamburgerIcon />
          </button>

          {menuOpen && (
            <MenuCard
              plan={plan}
              onSignOut={onSignOut}
              onClose={onMenuClose}
              onHoverEnter={onMenuCancelClose}
              onHoverLeave={onMenuScheduleClose}
              closing={menuClosing}
            />
          )}
        </div>
      </div>
    </>
  )
}

// ── Sign-In Panel ──────────────────────────────────────────────────────────────

const GitHubIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
)

const GoogleIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
)

function OAuthButton({ icon, label, loading, disabled, onClick }: {
  icon: React.ReactNode
  label: string
  loading: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="no-drag"
      style={{
        display:"flex", alignItems:"center", justifyContent:"center", gap:10,
        width:"100%", padding:"13px 18px", borderRadius:10,
        background:"rgba(255,224,194,0.05)", border:"1px solid rgba(255,224,194,0.12)",
        fontSize:13.5, fontWeight:500, color:"var(--text)", fontFamily:UI_FONT,
        cursor: disabled ? "default" : "pointer",
        transition:"all .15s",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={e=>{ if (!disabled) { e.currentTarget.style.background="rgba(255,224,194,0.1)"; e.currentTarget.style.borderColor="rgba(255,200,130,0.35)" }}}
      onMouseLeave={e=>{ if (!disabled) { e.currentTarget.style.background="rgba(255,224,194,0.05)"; e.currentTarget.style.borderColor="rgba(255,224,194,0.12)" }}}
    >
      {loading ? (
        <div style={{
          width:17, height:17, borderRadius:"50%",
          border:"2px solid rgba(255,224,194,0.12)",
          borderTopColor:"rgba(255,200,130,0.8)",
          animation:"spin .75s linear infinite", flexShrink:0,
        }} />
      ) : icon}
      {label}
    </button>
  )
}

function SignInPanel({ isWaiting, loadingProvider, error, lastProvider, onSignIn }: {
  isWaiting: boolean
  loadingProvider: "github" | "google" | null
  error: string
  lastProvider: "github" | "google" | null
  onSignIn: (provider: "github" | "google") => void
}) {
  const busy = loadingProvider !== null

  return (
    <div style={{
      flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      padding:"0 28px",
    }}>
      {/* Accent glow at top */}
      <div style={{
        position:"absolute", top:0, left:0, right:0, height:1,
        background:"linear-gradient(90deg, transparent, rgba(255,200,130,0.3), transparent)",
      }} />

      {/* Yomi logo — bigger */}
      <div style={{
        fontFamily:DISPLAY_FONT, fontSize:44, fontWeight:700,
        color:"var(--accent)", letterSpacing:"-0.02em", marginBottom:6,
      }} className="drag">
        Yomi
      </div>

      <div style={{
        fontSize:11, color:"rgba(175,163,145,0.45)", textAlign:"center",
        marginBottom:20, letterSpacing:"0.03em", fontWeight:400,
      }}>
        your AI buddy
      </div>

      {isWaiting ? (
        <>
          <div style={{
            width:28, height:28, borderRadius:"50%",
            border:"2.5px solid rgba(255,224,194,0.1)",
            borderTopColor:"rgba(255,200,130,0.8)",
            animation:"spin .75s linear infinite",
            margin:"0 0 20px",
          }} />
          <div style={{ fontSize:14, color:"var(--dim)", textAlign:"center", lineHeight:1.7, marginBottom:18 }}>
            Opening your browser to sign in…
          </div>
          <button
            onClick={() => onSignIn(lastProvider ?? "github")}
            className="no-drag"
            style={{
              background:"rgba(255,175,80,0.08)", border:"1px solid rgba(255,175,80,0.3)",
              borderRadius:8, padding:"8px 22px",
              fontSize:12, color:"rgba(255,175,80,0.9)", fontFamily:UI_FONT,
              cursor:"pointer", transition:"background .15s",
            }}
            onMouseEnter={e=>{ e.currentTarget.style.background="rgba(255,175,80,0.15)" }}
            onMouseLeave={e=>{ e.currentTarget.style.background="rgba(255,175,80,0.08)" }}
          >
            Open browser again
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize:16, fontWeight:600, color:"var(--text)", marginBottom:3 }}>
            Welcome back
          </div>
          <div style={{
            fontSize:12.5, color:"rgba(175,163,145,0.7)", textAlign:"center",
            marginBottom:30, lineHeight:1.6,
          }}>
            Sign in to your Yomi account.
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:12, width:"100%", maxWidth:320 }}>
            <OAuthButton
              icon={<GitHubIcon />}
              label="Continue with GitHub"
              loading={loadingProvider === "github"}
              disabled={busy}
              onClick={() => onSignIn("github")}
            />
            <OAuthButton
              icon={<GoogleIcon />}
              label="Continue with Google"
              loading={loadingProvider === "google"}
              disabled={busy}
              onClick={() => onSignIn("google")}
            />
          </div>

          {error && (
            <div style={{
              fontSize:12, color:"var(--error)", textAlign:"center", marginTop:18, lineHeight:1.5,
            }}>
              {error}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── App ────────────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const {
    authState, authError, setAuthState,
    hotkeyState, entries, audioQueue, ttsEnabled, subscription,
    handleSseEvent, setHotkeyState, dismissEntry,
    setSubscription, setSubscriptionLoading,
  } = useYomiStore()

  const [loadingProvider, setLoadingProvider] = React.useState<"github" | "google" | null>(null)
  const [lastProvider, setLastProvider] = React.useState<"github" | "google" | null>(null)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [menuClosing, setMenuClosing] = React.useState(false)
  const menuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menuAnimTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openMenu = useCallback(() => {
    if (menuCloseTimerRef.current) { clearTimeout(menuCloseTimerRef.current); menuCloseTimerRef.current = null }
    if (menuAnimTimerRef.current)  { clearTimeout(menuAnimTimerRef.current);  menuAnimTimerRef.current  = null }
    setMenuClosing(false)
    setMenuOpen(open => open ? open : true)
  }, [])

  // Called when cursor leaves the button, bridge, or card.
  const scheduleMenuClose = useCallback(() => {
    if (menuCloseTimerRef.current) clearTimeout(menuCloseTimerRef.current)
    menuCloseTimerRef.current = setTimeout(() => {
      setMenuClosing(true)
      menuAnimTimerRef.current = setTimeout(() => {
        setMenuOpen(false)
        setMenuClosing(false)
      }, 200)
    }, 120)
  }, [])

  const cancelMenuClose = useCallback(() => {
    if (menuCloseTimerRef.current) { clearTimeout(menuCloseTimerRef.current); menuCloseTimerRef.current = null }
    if (menuAnimTimerRef.current)  { clearTimeout(menuAnimTimerRef.current);  menuAnimTimerRef.current  = null }
    setMenuClosing(false)
  }, [])

  // Immediate animated close (backdrop click, action buttons)
  const closeMenuNow = useCallback(() => {
    if (menuCloseTimerRef.current) { clearTimeout(menuCloseTimerRef.current); menuCloseTimerRef.current = null }
    if (menuAnimTimerRef.current)  { clearTimeout(menuAnimTimerRef.current);  menuAnimTimerRef.current  = null }
    setMenuClosing(true)
    menuAnimTimerRef.current = setTimeout(() => {
      setMenuOpen(false)
      setMenuClosing(false)
    }, 200)
  }, [])

  const rootRef         = useRef<HTMLDivElement>(null)
  const entriesRef      = useRef<HTMLDivElement>(null)
  const streamRef       = useRef<MediaStream|null>(null)
  const sysStreamRef    = useRef<MediaStream|null>(null)
  const processorRef    = useRef<AudioWorkletNode|null>(null)
  const ctxRef          = useRef<AudioContext|null>(null)
  const workletReadyRef = useRef<Promise<void>|null>(null)
  const audioPlayingRef    = useRef(false)
  const localAudioQueue    = useRef<string[]>([])  // Mutable queue; NOT a mirror of React state
  const audioConsumedRef   = useRef(0)             // How many items from audioQueue state we've enqueued
  const audioSourceRef  = useRef<AudioBufferSourceNode|null>(null)
  const draggingRef     = useRef(false)
  const mouseEventsIgnoredRef = useRef(false)

  // Restore saved window opacity on mount
  useEffect(()=>{
    const saved = localStorage.getItem("yomi:opacity")
    if (saved) window.yomi.setOpacity(parseFloat(saved))
  }, [])

  // Listen to auth status events from main process
  useEffect(()=>{
    return window.yomi.onAuthStatus((status, detail) => {
      if (status === "ok")           { setLoadingProvider(null); setAuthState("authenticated") }
      else if (status === "needed")  { setLoadingProvider(null); setAuthState("unauthenticated") }
      else if (status === "waiting") setAuthState("waiting")
      else if (status === "error")   { setLoadingProvider(null); setAuthState("unauthenticated", detail ?? "Sign-in failed — try again") }
    })
  }, [setAuthState])

  const handleSignIn = useCallback((provider: "github" | "google")=>{
    setLoadingProvider(provider)
    setLastProvider(provider)
    setAuthState("waiting")
    window.yomi.startAuth(provider)
  }, [setAuthState])

  // Fetch subscription info when authenticated
  useEffect(()=>{
    if (authState !== "authenticated") return
    setSubscriptionLoading(true)
    window.yomi.getSubscriptionInfo().then(info => {
      setSubscription(info)
      setSubscriptionLoading(false)
    }).catch(() => {
      setSubscriptionLoading(false)
    })
  }, [authState, setSubscription, setSubscriptionLoading])

  // Listen for subscription updates from main
  useEffect(()=>{
    return window.yomi.onSubscriptionUpdate(info => {
      setSubscription(info)
    })
  }, [setSubscription])

  // Resize window based on auth + content + menu state
  useEffect(()=>{
    if (authState === "checking") {
      window.yomi.resize(680, 46)
    } else if (authState === "unauthenticated") {
      window.yomi.resize(680, 390)
    } else if (authState === "waiting") {
      window.yomi.resize(680, 240)
    } else {
      const MAX_ENTRIES = 640
      const textInputH = hotkeyState === "text-input" ? 88 : 0
      const entriesH = entries.length > 0 ? MAX_ENTRIES : 0
      // Menu card starts at top:50px and is ~330px tall — window must be at least 380px
      const menuMin = menuOpen ? 380 : 0
      window.yomi.resize(680, Math.max(46, 46 + textInputH + entriesH, menuMin))
    }
  }, [authState, entries, hotkeyState, menuOpen])

  useEffect(()=>{
    const onDown=(e:MouseEvent)=>{
      const t=e.target as HTMLElement
      if (!t.closest(".drag")||t.closest(".no-drag")) return
      draggingRef.current=true; window.yomi.startDrag(e.screenX,e.screenY)
    }
    const onMove=(e:MouseEvent)=>{ if (draggingRef.current) window.yomi.moveDrag(e.screenX,e.screenY) }
    const onUp=()=>{ draggingRef.current=false }
    document.addEventListener("mousedown",onDown)
    document.addEventListener("mousemove",onMove)
    document.addEventListener("mouseup",onUp)
    return ()=>{
      document.removeEventListener("mousedown",onDown)
      document.removeEventListener("mousemove",onMove)
      document.removeEventListener("mouseup",onUp)
    }
  }, [])

  useEffect(()=>{
    const c1=window.yomi.onEvent(handleSseEvent)
    const c2=window.yomi.onStateChange(setHotkeyState)
    return ()=>{ c1(); c2() }
  }, [handleSseEvent, setHotkeyState])

  useEffect(()=>{
    const ctx=new AudioContext({ sampleRate:16000 }); ctxRef.current=ctx
    const code=`
      class PCMProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const inp=inputs[0]?.[0]
          if (inp?.length) { const c=new Float32Array(inp); this.port.postMessage(c.buffer,[c.buffer]) }
          return true
        }
      }
      registerProcessor('pcm-processor',PCMProcessor)
    `
    const blob=new Blob([code],{type:"application/javascript"})
    const url=URL.createObjectURL(blob)
    workletReadyRef.current=ctx.audioWorklet.addModule(url).finally(()=>URL.revokeObjectURL(url))
    return ()=>{ ctx.close().catch(()=>{}); ctxRef.current=null; workletReadyRef.current=null }
  }, [])

  useEffect(()=>{
    // Reset on new query (store sets audioQueue to [] on transcript)
    if (audioQueue.length === 0) {
      localAudioQueue.current = []
      audioConsumedRef.current = 0
      audioSourceRef.current?.stop(); audioSourceRef.current = null
      audioPlayingRef.current = false
      return
    }

    // Push only genuinely new chunks — avoid double-play when state ref is reassigned
    for (let i = audioConsumedRef.current; i < audioQueue.length; i++) {
      localAudioQueue.current.push(audioQueue[i]!)
    }
    audioConsumedRef.current = audioQueue.length

    if (audioPlayingRef.current) return  // playNext loop already running
    const ctx = ctxRef.current; if (!ctx) return
    audioPlayingRef.current = true
    const playNext = async () => {
      while (localAudioQueue.current.length > 0) {
        const b64 = localAudioQueue.current.shift()!
        const bin = atob(b64); const buf = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
        try {
          const ab = await ctx.decodeAudioData(buf.buffer)
          const src = ctx.createBufferSource()
          audioSourceRef.current = src; src.buffer = ab; src.connect(ctx.destination)
          if (ctx.state === "suspended") await ctx.resume()
          src.start()
          await new Promise<void>(r => { src.onended = () => { if (audioSourceRef.current === src) audioSourceRef.current = null; r() } })
        } catch (e) { console.warn("[yomi/audio] playback failed:", e) }
      }
      audioPlayingRef.current = false
    }
    playNext()
  }, [audioQueue])

  useEffect(()=>{
    navigator.mediaDevices.getUserMedia({audio:true})
      .then(s=>{ streamRef.current=s })
      .catch(()=>{})
    return ()=>{ streamRef.current?.getTracks().forEach(t=>t.stop()) }
  }, [])

  // Grab system audio (loopback) once on mount — works on Windows via desktopCapturer.
  // Fails gracefully on macOS without a virtual audio device; mic-only is the fallback.
  useEffect(()=>{
    let active=true
    ;(async()=>{
      try {
        const id = await window.yomi.getDesktopSourceId()
        if (!id || !active) return
        const s = await navigator.mediaDevices.getUserMedia({
          audio: { mandatory: { chromeMediaSource:"desktop", chromeMediaSourceId:id } } as MediaTrackConstraints,
          video: { mandatory: { chromeMediaSource:"desktop", chromeMediaSourceId:id } } as MediaTrackConstraints,
        })
        // Drop video tracks — we only want the audio loopback
        s.getVideoTracks().forEach(t=>t.stop())
        if (active) sysStreamRef.current=s
        else s.getAudioTracks().forEach(t=>t.stop())
      } catch { /* macOS/no-permission: silently fall back to mic-only */ }
    })()
    return ()=>{
      active=false
      sysStreamRef.current?.getTracks().forEach(t=>t.stop())
      sysStreamRef.current=null
    }
  }, [])

  useEffect(()=>{
    if (hotkeyState!=="listening") {
      processorRef.current?.disconnect(); processorRef.current=null; return
    }
    // Starting a new voice query: stop any in-progress TTS and always enable audio output
    audioSourceRef.current?.stop(); audioSourceRef.current=null
    audioPlayingRef.current=false; localAudioQueue.current=[]
    useYomiStore.setState({ ttsEnabled: true })
    let cancelled=false
    let micSrc: MediaStreamAudioSourceNode|null=null
    let sysSrc: MediaStreamAudioSourceNode|null=null
    let proc: AudioWorkletNode|null=null
    ;(async()=>{
      await workletReadyRef.current; if (cancelled) return
      const stream=streamRef.current, ctx=ctxRef.current
      if (!stream||!ctx) return
      if (ctx.state==="suspended") await ctx.resume()
      if (cancelled) return
      proc=new AudioWorkletNode(ctx,"pcm-processor")
      proc.port.onmessage=e=>window.yomi.sendAudioChunk(e.data as ArrayBuffer, 16000)
      // Mic input (always present)
      micSrc=ctx.createMediaStreamSource(stream)
      micSrc.connect(proc)
      // System audio input — mixed in automatically by Web Audio when connected to the same proc input
      if (sysStreamRef.current) {
        try {
          sysSrc=ctx.createMediaStreamSource(sysStreamRef.current)
          sysSrc.connect(proc)
        } catch { /* stream may have ended; ignore */ }
      }
      proc.connect(ctx.destination); processorRef.current=proc
    })()
    return ()=>{ cancelled=true; micSrc?.disconnect(); sysSrc?.disconnect(); proc?.disconnect(); processorRef.current=null }
  }, [hotkeyState])

  // Stop in-flight audio immediately when TTS is toggled off.
  useEffect(()=>{
    if (!ttsEnabled) {
      audioSourceRef.current?.stop(); audioSourceRef.current=null
      audioPlayingRef.current=false; localAudioQueue.current=[]
    }
  }, [ttsEnabled])

  // Global shortcuts consume Escape before the renderer sees it, so we get a
  // dedicated IPC instead.  Stop audio and dismiss the active streaming entry.
  useEffect(()=>{
    return window.yomi.onStopAudio(()=>{
      audioSourceRef.current?.stop(); audioSourceRef.current=null
      audioPlayingRef.current=false; localAudioQueue.current=[]
    })
  }, [])

  // Fallback: if globalShortcut("Escape") failed to register (common on some Windows setups),
  // the keypress reaches the window when focused — forward it to main via IPC.
  // When the global shortcut IS registered it consumes the key and this never fires.
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{ if(e.key==="Escape") window.yomi.requestEscape() }
    window.addEventListener("keydown", onKey)
    return ()=>window.removeEventListener("keydown", onKey)
  }, [])


  const hasContent = entries.length>0 || hotkeyState==="text-input"
  const isListening = hotkeyState==="listening"

  const setMouseEventsIgnored = useCallback((ignored: boolean) => {
    if (mouseEventsIgnoredRef.current === ignored) return
    mouseEventsIgnoredRef.current = ignored
    window.yomi.setMouseEventsIgnored(ignored)
  }, [])

  useEffect(() => {
    if (authState !== "authenticated" || hasContent) {
      setMouseEventsIgnored(false)
      return
    }

    setMouseEventsIgnored(true)

    const onMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      setMouseEventsIgnored(!target?.closest(".yomi-hit-area"))
    }

    window.addEventListener("mousemove", onMove)
    return () => {
      window.removeEventListener("mousemove", onMove)
      setMouseEventsIgnored(false)
    }
  }, [authState, hasContent, setMouseEventsIgnored])

  // ── Sign-in states ──────────────────────────────────────────────────────────

  if (authState === "checking") {
    // Transparent while we verify the stored token — barely visible
    return <div style={{ height:"100vh", background:"transparent" }} />
  }

  if (authState === "unauthenticated" || authState === "waiting") {
    return (
      <div style={{
        display:"flex", flexDirection:"column",
        height:"100vh",
        background:"var(--bg)",
        borderRadius:10, overflow:"hidden",
        border:"1px solid var(--border)",
        boxShadow:"0 16px 60px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,224,194,0.04)",
        backdropFilter:"blur(28px) saturate(160%)",
        WebkitBackdropFilter:"blur(28px) saturate(160%)",
        position:"relative",
      }}>
        <SignInPanel
          isWaiting={authState === "waiting"}
          loadingProvider={loadingProvider}
          error={authError}
          lastProvider={lastProvider}
          onSignIn={handleSignIn}
        />
      </div>
    )
  }

  // ── Authenticated UI ────────────────────────────────────────────────────────

  return (
    <div
      ref={rootRef}
      style={{
        display:"flex", flexDirection:"column",
        height:"100vh",
        background: hasContent ? "var(--bg)" : "transparent",
        borderRadius:10, overflow:"hidden",
        border: hasContent
          ? isListening
            ? "1px solid rgba(255,200,130,0.22)"
            : "1px solid var(--border)"
          : "none",
        boxShadow: hasContent
          ? isListening
            ? "0 0 0 1px rgba(255,200,130,0.06), 0 16px 60px rgba(0,0,0,0.65)"
            : "0 16px 60px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,224,194,0.04)"
          : "none",
        backdropFilter: hasContent ? "blur(28px) saturate(160%)" : "none",
        WebkitBackdropFilter: hasContent ? "blur(28px) saturate(160%)" : "none",
        transition:"border-color .3s, box-shadow .3s",
        minWidth:680,
      }}
    >
      <Toolbar
        state={hotkeyState}
        plan={subscription?.plan}
        interactionInfo={subscription?.plan === "explore" ? `${subscription.trialInteractionUsed}/${subscription.trialInteractionLimit}` : undefined}
        onSignOut={() => window.yomi.signOut()}
        menuOpen={menuOpen}
        menuClosing={menuClosing}
        onMenuToggle={() => menuOpen ? closeMenuNow() : openMenu()}
        onMenuClose={closeMenuNow}
        onMenuOpen={openMenu}
        onMenuScheduleClose={scheduleMenuClose}
        onMenuCancelClose={cancelMenuClose}
      />

      {hotkeyState==="text-input" && (
        <div style={{ padding:"6px 7px 7px", flexShrink:0 }}>
          <TextInputPanel />
        </div>
      )}

      {entries.length>0 && (
        <div
          ref={entriesRef}
          className="no-drag"
          style={{
            flex:1, minHeight:0,
            overflowY:"auto", overflowX:"hidden",
            display:"flex", flexDirection:"column", gap:5,
            padding:"6px 7px 7px",
            overscrollBehavior:"contain",
          }}
        >
          {[...entries].reverse().map((e,i) => (
            <ResponsePanel key={e.id} entry={e} isActive={i===0} onDismiss={()=>dismissEntry(e.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Mount ──────────────────────────────────────────────────────────────────────

const root = document.getElementById("root")
if (root) createRoot(root).render(<App />)
