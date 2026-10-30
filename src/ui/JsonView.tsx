import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

const LINE_H = 20
const OVERSCAN = 10
/** Above this char count we skip JSON.parse + coloring (UI-thread protection). */
const PRETTY_LIMIT = 4_000_000

interface Token {
  text: string
  cls?: string
}

const TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)/g

function tokenizeLine(line: string): Token[] {
  const out: Token[] = []
  let last = 0
  let m: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  // a key is a string directly followed by a colon
  while ((m = TOKEN_RE.exec(line)) !== null) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), cls: 'json-cmd' })
    if (m[1] !== undefined && m[2] === undefined) out.push({ text: m[1], cls: 'json-str' })
    else if (m[1] !== undefined) out.push({ text: m[1], cls: 'json-key' })
    else if (m[3] !== undefined) out.push({ text: m[3], cls: 'json-num' })
    else if (m[4] !== undefined) out.push({ text: m[4], cls: 'json-bool' })
    else if (m[5] !== undefined) out.push({ text: m[5], cls: 'json-null' })
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ text: line.slice(last), cls: 'json-cmd' })
  return out
}

/** Windowed, syntax-highlighted viewer for large bodies. */
export default function JsonView({
  lines,
  highlight,
  filter = '',
}: {
  lines: string[]
  highlight: boolean
  filter?: string
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: 80 })

  const visible = useMemo(
    () => (filter ? lines.filter((l) => l.toUpperCase().includes(filter.toUpperCase())) : lines),
    [lines, filter],
  )

  useEffect(() => {
    setRange({ start: 0, end: 80 })
    if (ref.current) ref.current.scrollTop = 0
  }, [visible])

  const onScroll = (): void => {
    const el = ref.current
    if (!el) return
    const start = Math.max(0, Math.floor(el.scrollTop / LINE_H) - OVERSCAN)
    const count = Math.ceil(el.clientHeight / LINE_H) + OVERSCAN * 2
    setRange({ start, end: start + count })
  }

  const slice = visible.slice(range.start, range.end)

  return (
    <div className="resp-body-wrap">
      <div style={{ height: 26, padding: '2px 10px', fontSize: 11, color: 'var(--text-3)' }}>
        {visible.length.toLocaleString()} lines{filter ? ` (filtered from ${lines.length.toLocaleString()})` : ''} — windowed view
      </div>
      <div className="json-view" ref={ref} onScroll={onScroll} style={{ height: 'calc(100% - 26px)', overflow: 'auto' }}>
        <div style={{ height: Math.max(visible.length, range.end) * LINE_H, position: 'relative' }}>
          <div style={{ paddingTop: range.start * LINE_H }}>
            {slice.map((line, i) => (
              <div className="json-line" style={{ height: LINE_H }} key={range.start + i}>
                <span className="json-ln">{range.start + i + 1}</span>
                <span className="json-content">{highlight ? renderTokens(line) : line}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Tokenize lazily but memoize per line via a bounded cache. */
const cache = new Map<string, Token[]>()
function renderTokens(line: string): ReactNode {
  let toks = cache.get(line)
  if (!toks) {
    toks = tokenizeLine(line)
    if (cache.size > 20_000) cache.clear()
    cache.set(line, toks)
  }
  return toks.map((t, i) => (t.cls ? <span key={i} className={t.cls}>{t.text}</span> : t.text))
}

export { PRETTY_LIMIT }

