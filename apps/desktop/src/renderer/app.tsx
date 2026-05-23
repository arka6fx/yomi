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
  @keyframes slideUp{ from{opacity:0;transform:translateY(7px)} to{opacity:1;transform:translateY(0)} }
  @keyframes fadeIn { from{opacity:0} to{opacity:1} }

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

// ── CodeBlock ──────────────────────────────────────────────────────────────────

function CodeBlock({ code, lang }: { code:string; lang:string }) {
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

function Blocks({ text, isStreaming }: { text:string; isStreaming:boolean }) {
  const blocks = useMemo(()=>parseBlocks(text), [text])
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

const SCREEN_PROMPT = "Look at my screen. Tell me what's going on and what I should know right now. If there's a question visible, answer it. If there's an error, explain it. If there's code, break it down. Keep it short and direct."

function TextInputPanel() {
  const [value, setValue] = React.useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const valueRef = useRef("")
  useEffect(()=>{ valueRef.current=value }, [value])
  useEffect(()=>{ inputRef.current?.focus() }, [])

  const submit = React.useCallback(()=>{
    const text = valueRef.current.trim() || SCREEN_PROMPT
    setValue(""); valueRef.current=""
    window.yomi.submitTextQuery(text)  // Main process transitions to processing
  }, [])

  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if (e.key==="Enter"&&!e.ctrlKey&&!e.shiftKey&&!e.altKey) { e.preventDefault(); submit() }
    }
    document.addEventListener("keydown",onKey)
    return ()=>document.removeEventListener("keydown",onKey)
  }, [submit])

  return (
    <div style={{
      background:"var(--surface)",
      border:"1px solid var(--border-hi)",
      borderRadius:9, overflow:"hidden",
      boxShadow:"0 8px 40px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,224,194,0.04)",
      animation:"slideUp 0.2s cubic-bezier(0.16,1,0.3,1)",
    }} className="drag">
      <div style={{ padding:"8px 10px", display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:9, color:"rgba(255,200,130,0.5)", letterSpacing:"0.14em", fontFamily:UI_FONT, fontWeight:600, flexShrink:0 }}>
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
            borderRadius:4, padding:"2px 9px", fontSize:10,
            color:"rgba(255,224,194,0.8)", fontFamily:UI_FONT,
            cursor:"pointer", flexShrink:0, transition:"all .15s",
          }}
          onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,224,194,0.17)"; e.currentTarget.style.color="rgba(255,224,194,1)"}}
          onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,224,194,0.1)"; e.currentTarget.style.color="rgba(255,224,194,0.8)"}}
        >
          Send ↵
        </button>
      </div>
      <div style={{ height:1, background:"rgba(255,224,194,0.05)" }} />
      <div style={{ padding:"4px 12px 5px", fontSize:9, color:"rgba(175,155,115,0.35)", fontFamily:UI_FONT }}>
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
      ...(isActive ? { display:"flex", flexDirection:"column", flex:1, minHeight:0 } : {}),
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
            fontSize:8.5, letterSpacing:"0.14em", fontFamily:UI_FONT, fontWeight:700, flexShrink:0,
            color: entry.error ? "rgba(255,140,101,0.6)" : "rgba(255,200,130,0.45)",
          }}>
            {entry.error ? "ERR" : "YOU"}
          </span>
          <span style={{
            fontSize:11.5, fontFamily:UI_FONT,
            color: entry.error ? "var(--error)" : "var(--dim)",
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

      {/* Body — flex:1 + scrollable when active, compact when old */}
      {!entry.error && entry.text !== "" && (
        <div
          className="no-drag"
          style={{
            padding:"10px 12px 4px 14px",
            overscrollBehavior:"contain",
            ...(isActive
              ? { flex:1, minHeight:0, overflowY:"auto", overflowX:"auto" }
              : { maxHeight:88, overflowY:"auto", overflowX:"auto" }),
          }}
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
      background:"rgba(255,224,194,0.05)",
      border:"1px solid rgba(255,224,194,0.1)",
      borderBottom:"2px solid rgba(255,224,194,0.12)",
      borderRadius:4, padding:"0 4px", fontSize:9,
      color:"rgba(255,255,255,0.5)", minWidth:14, height:15,
    }}>{label}</kbd>
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
        fontSize:10, fontFamily:UI_FONT,
        color: hot ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.65)",
        letterSpacing:"0.01em",
      }}>{label}</span>
      <div style={{ display:"flex", gap:2 }}>
        {keys.map((k,i)=><Key key={i} label={k} />)}
      </div>
    </div>
  )
}

function Toolbar({ state, plan, interactionInfo }: { state:HotkeyState; plan?:string; interactionInfo?:string }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", justifyContent:"space-between",
      padding:"0 10px",
      height:46,
      background:"var(--bg)",
      borderBottom: state!=="idle" ? "1px solid rgba(255,224,194,0.07)" : "1px solid rgba(255,224,194,0.04)",
      borderRadius: "10px 10px 0 0",
      gap:10,
    }} className="drag">

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
            fontSize:9, fontFamily:UI_FONT, letterSpacing:"0.06em",
            color:"rgba(175,155,115,0.35)",
            border:"1px solid rgba(255,224,194,0.08)",
            borderRadius:4, padding:"0 6px", lineHeight:"16px",
            textTransform:"capitalize",
          }}>
            {plan}
          </span>
        )}
        {/* Interaction usage for trial */}
        {interactionInfo && state==="idle" && (
          <span style={{
            fontSize:9, fontFamily:UI_FONT, letterSpacing:"0.02em",
            color:"rgba(255,200,130,0.3)",
          }}>
            {interactionInfo}
          </span>
        )}
      </div>

      {/* Right: shortcut chips */}
      <div style={{ display:"flex", gap:4, alignItems:"center" }} className="no-drag">
        {state==="idle" && <>
          <Chip label="Voice" keys={["⌃⇧","Spc"]} hot={false} />
          <Chip label="Type"  keys={["⌃⇧","↵"]}   hot={false} />
          <Chip label="Move"  keys={["⌃⇧","↑↓←→"]} hot={false} />
          <Chip label="Hide"  keys={["⌃⇧","H"]}   hot={false} />
          <Chip label="Quit"  keys={["⌃⇧","Q"]}   hot={false} />
          <div style={{ width:1, height:16, background:"rgba(255,224,194,0.07)", margin:"0 4px" }} />
          <button
            onClick={() => window.yomi.signOut()}
            style={{
              background:"none", border:"none",
              fontSize:9, fontFamily:UI_FONT, letterSpacing:"0.04em",
              color:"rgba(175,155,115,0.35)", cursor:"pointer",
              padding:"0 2px", transition:"color .15s",
            }}
            onMouseEnter={e=>{e.currentTarget.style.color="rgba(255,224,194,0.5)"}}
            onMouseLeave={e=>{e.currentTarget.style.color="rgba(175,155,115,0.35)"}}
          >
            Sign out
          </button>
        </>}
        {state==="listening" && <>
          <Chip label="Stop"   keys={["⌃⇧","Spc"]} hot={true}  />
          <Chip label="Cancel" keys={["Esc"]}       hot={false} />
        </>}
        {state==="text-input" && (
          <Chip label="Cancel" keys={["Esc"]} hot={false} />
        )}
        {state==="processing" && (
          <span style={{ fontSize:10, color:"rgba(175,155,115,0.3)", fontFamily:UI_FONT }}>processing…</span>
        )}
      </div>
    </div>
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
    hotkeyState, entries, audioQueue, subscription,
    handleSseEvent, setHotkeyState, dismissEntry,
    setSubscription, setSubscriptionLoading,
  } = useYomiStore()

  const [loadingProvider, setLoadingProvider] = React.useState<"github" | "google" | null>(null)
  const [lastProvider, setLastProvider] = React.useState<"github" | "google" | null>(null)

  const rootRef         = useRef<HTMLDivElement>(null)
  const entriesRef      = useRef<HTMLDivElement>(null)
  const streamRef       = useRef<MediaStream|null>(null)
  const processorRef    = useRef<AudioWorkletNode|null>(null)
  const ctxRef          = useRef<AudioContext|null>(null)
  const workletReadyRef = useRef<Promise<void>|null>(null)
  const audioPlayingRef    = useRef(false)
  const localAudioQueue    = useRef<string[]>([])  // Mutable queue; NOT a mirror of React state
  const audioConsumedRef   = useRef(0)             // How many items from audioQueue state we've enqueued
  const audioSourceRef  = useRef<AudioBufferSourceNode|null>(null)
  const draggingRef     = useRef(false)

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

  // Resize window based on auth + content state
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
      window.yomi.resize(680, Math.max(46, 46 + textInputH + entriesH))
    }
  }, [authState, entries, hotkeyState])

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

  useEffect(()=>{
    if (hotkeyState!=="listening") {
      processorRef.current?.disconnect(); processorRef.current=null; return
    }
    let cancelled=false
    let src: MediaStreamAudioSourceNode|null=null
    let proc: AudioWorkletNode|null=null
    ;(async()=>{
      await workletReadyRef.current; if (cancelled) return
      const stream=streamRef.current, ctx=ctxRef.current
      if (!stream||!ctx) return
      if (ctx.state==="suspended") await ctx.resume()
      if (cancelled) return
      src=ctx.createMediaStreamSource(stream)
      proc=new AudioWorkletNode(ctx,"pcm-processor")
      proc.port.onmessage=e=>window.yomi.sendAudioChunk(e.data as ArrayBuffer, 16000)
      src.connect(proc); proc.connect(ctx.destination); processorRef.current=proc
    })()
    return ()=>{ cancelled=true; src?.disconnect(); proc?.disconnect(); processorRef.current=null }
  }, [hotkeyState])

  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if (e.key!=="Escape") return
      // Stop any playing audio immediately
      audioSourceRef.current?.stop(); audioSourceRef.current=null
      audioPlayingRef.current=false; localAudioQueue.current=[]
      // Dismiss the latest entry (partial or complete)
      if (entries.length) dismissEntry(entries.at(-1)!.id)
      // If generating, the global hotkey already called onAbort in main process;
      // nothing extra needed here — main resets state to idle.
    }
    document.addEventListener("keydown",onKey)
    return ()=>document.removeEventListener("keydown",onKey)
  }, [entries, dismissEntry])


  const hasContent = entries.length>0 || hotkeyState==="text-input"
  const isListening = hotkeyState==="listening"

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
            display:"flex", flexDirection:"column", gap:5,
            padding:"6px 7px 7px",
          }}
        >
          {(()=>{
            const reversed = [...entries].reverse()
            const active = reversed[0]!
            const old = reversed.slice(1)
            return <>
              <ResponsePanel key={active.id} entry={active} isActive={true} onDismiss={()=>dismissEntry(active.id)} />
              {old.length>0 && (
                <div style={{
                  display:"flex", flexDirection:"column", gap:5,
                  overflowY:"auto", overflowX:"hidden",
                  flexShrink:0, maxHeight:260, scrollbarWidth:"thin",
                }}>
                  {old.map(e=>(
                    <ResponsePanel key={e.id} entry={e} isActive={false} onDismiss={()=>dismissEntry(e.id)} />
                  ))}
                </div>
              )}
            </>
          })()}
        </div>
      )}
    </div>
  )
}

// ── Mount ──────────────────────────────────────────────────────────────────────

const root = document.getElementById("root")
if (root) createRoot(root).render(<App />)
