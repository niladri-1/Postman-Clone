import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { actions, appStore } from '../../state/actions'
import { useStore } from '../../state/store'
import type { OpenTab } from '../../../shared/models'

/**
 * URL input with autocomplete dropdown.
 *
 * Suggestion sources, in order:
 *  - localhost-style dev shortcuts (bare host without scheme gets `http://` + :3000)
 *  - well-known sample APIs when a prefix matches ("echo", "httpbin", …)
 *  - recently used URLs from history
 *  - saved request URLs from collections
 *
 * Keyboard: ↑/↓ selects, Enter picks a suggestion (or sends when nothing is
 * highlighted), Escape closes, Tab accepts. Clicking an item fills the box.
 */

interface Suggestion {
  url: string
  src: string
}

const COMMON_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'host.docker.internal'])

/** typing `localhost` → `http://localhost:3000/`, `myserver` → `http://myserver/` */
function devShortcuts(typed: string): Suggestion[] {
  const v = typed.trim()
  if (!v || /^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return [] // already has a scheme
  if (!/^[a-z0-9.\-[\]:]+(\/.*)?$/i.test(v)) return [] // not a bare-host shape
  const hasPath = v.includes('/')
  const hostPart = hasPath ? v.slice(0, v.indexOf('/')) : v
  const path = hasPath ? v.slice(v.indexOf('/')) : ''
  const bare = hostPart.split(':')[0].toLowerCase()
  const out: Suggestion[] = []
  if (COMMON_HOSTS.has(bare) || /\.(local|test|dev)$/i.test(bare) || v.startsWith('www.')) {
    if (/:\d+/.test(hostPart)) {
      out.push({ url: `http://${v}`, src: 'http' })
      out.push({ url: `https://${v}`, src: 'https' })
    } else {
      out.push({ url: `http://${hostPart}:3000${path}`, src: 'dev' })
      out.push({ url: `https://${hostPart}${path}`, src: 'https' })
    }
  } else if (v.length > 2 && !v.includes('.') && !v.includes(':')) {
    out.push({ url: `http://${v}`, src: 'http' }) // bare word like "api-server"
  }
  return out
}

const QUICK: { match: string; url: string }[] = [
  { match: 'echo', url: 'https://postman-echo.com/get' },
  { match: 'httpbin', url: 'http://httpbin.org/get' },
  { match: 'jsonplace', url: 'https://jsonplaceholder.typicode.com/posts/1' },
]

function quick(typed: string): Suggestion[] {
  const v = typed.trim().toLowerCase()
  if (!v) return []
  return QUICK.filter((q) => q.match.startsWith(v) && q.match !== v).map((q) => ({ url: q.url, src: 'sample' }))
}

function collectSuggestions(typed: string): Suggestion[] {
  const s = appStore.get()
  const out: Suggestion[] = []
  const seen = new Set<string>()
  const push = (url: string, src: string): void => {
    if (!url || seen.has(url) || url === typed.trim()) return
    seen.add(url)
    out.push({ url, src })
  }
  for (const q of quick(typed)) push(q.url, q.src)
  for (const q of devShortcuts(typed)) push(q.url, 'dev')

  const v = typed.trim().toLowerCase()
  for (const h of s.history) {
    if (!v || h.url.toLowerCase().includes(v)) push(h.url, 'history')
  }
  const walk = (item: { kind: string; items?: unknown[]; request?: { url: string } }): void => {
    if (item.kind === 'folder' && Array.isArray(item.items)) {
      for (const c of item.items) walk(c as never)
    } else if (item.kind === 'request' && item.request?.url && (!v || item.request.url.toLowerCase().includes(v))) {
      push(item.request.url, 'collection')
    }
  }
  for (const col of s.collections) for (const item of col.items) walk(item as never)

  return out.slice(0, 9)
}

export default function UrlInput({ tab }: { tab: OpenTab }): JSX.Element {
  const history = useStore(appStore, (s) => s.history.length)
  const collections = useStore(appStore, (s) => s.collections.length)
  const url = tab.draft.url
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState(-1)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // history/collection contents feed the dropdown; touch them so the memo recomputes
  const suggestions = useMemo(
    () => collectSuggestions(url),
    [url, history, collections], // eslint-disable-line react-hooks/exhaustive-deps
  )
  useEffect(() => setHl(-1), [url])

  // ── focus changes, escape keys, Down/Up move highlight, Enter picks/sends, Tab accepts.
  const accept = (u: string, refocus: boolean): void => {
    actions.updateTab(tab.id, (d) => { d.url = u })
    setOpen(false)
    const input = inputRef.current
    if (refocus && input) {
      input.focus()
      // place the caret at the end so typing continues naturally
      const len = u.length
      queueMicrotask(() => input.setSelectionRange(len, len))
    }
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const items = open ? suggestions : []

  return (
    <div className="url-suggest" ref={wrapRef}>
      <input
        className="url-input"
        ref={inputRef}
        value={url}
        placeholder="Enter URL or paste text"
        spellCheck={false}
        onChange={(e) => {
          actions.updateTab(tab.id, (d) => { d.url = e.target.value })
          setOpen(true)
        }}
        onFocus={() => setOpen(url.length > 0)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && items.length > 0) {
            e.preventDefault()
            setHl((h) => Math.min(items.length - 1, h + 1))
            return
          }
          if (e.key === 'ArrowUp' && items.length > 0) {
            e.preventDefault()
            setHl((h) => Math.max(-1, h - 1))
            return
          }
          if (e.key === 'Escape') {
            setOpen(false)
            return
          }
          if (e.key === 'Tab' && items[hl]) {
            e.preventDefault()
            accept(items[hl].url, true)
            return
          }
          if (e.key === 'Enter') {
            if (items[hl]) {
              // selecting a suggestion only fills the URL — sending is your next action
              e.preventDefault()
              accept(items[hl].url, true)
              setOpen(false)
            } else if (!items.length) {
              setOpen(false) // bare Enter falls through to the Send flow on the input row
            } else {
              e.preventDefault()
              setOpen(false)
            }
          }
        }}
      />
      {items.length > 0 ? (
        <div className="url-suggest-list" role="listbox">
          {items.map((it, i) => (
            <div
              key={it.src + it.url}
              role="option"
              aria-selected={i === hl}
              className={`url-suggest-item${i === hl ? ' hl' : ''}`}
              onMouseDown={(e) => {
                // mousedown so the input never blurs and focus stays in the box
                e.preventDefault()
                accept(it.url, true)
              }}
              onMouseEnter={() => setHl(i)}
            >
              <span className="url-suggest-url">{it.url}</span>
              <span className={`url-suggest-src src-${it.src}`}>{it.src}</span>
            </div>
          ))}
          <div className="url-suggest-foot">↑↓ to choose · Enter fills · Esc to dismiss</div>
        </div>
      ) : null}
    </div>
  )
}
