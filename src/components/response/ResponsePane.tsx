import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { actions, appStore } from '../../state/actions'
import { useStore } from '../../state/store'
import JsonView, { PRETTY_LIMIT } from '../../ui/JsonView'
import { CopyIcon, DownloadIcon, SearchIcon } from '../../ui/icons'
import type { ResponseState } from '../../state/actions'

const TABS = ['body', 'cookies', 'headers', 'tests'] as const
type RespTab = (typeof TABS)[number]

export default function ResponsePane({ tabId }: { tabId: string }): JSX.Element {
  const resp = useStore(appStore, (s) => s.responses[tabId]) ?? null
  const tests = useStore(appStore, (s) => s.testResults[tabId]) ?? []
  const pending = useStore(appStore, (s) => !!s.pending[tabId])
  const tabSize = useStore(appStore, (s) => s.settings.tabSize)
  const [tab, setTab] = useState<RespTab>('body')
  const [filter, setFilter] = useState('')
  const [showFilter, setShowFilter] = useState(false)

  if (pending) {
    return (
      <div className="resp-pane">
        <div className="resp-empty">Sending…</div>
      </div>
    )
  }
  if (!resp) {
    return (
      <div className="resp-pane">
        <div className="resp-empty">
          Send request to get a response
          <br />
          <span style={{ fontSize: 12 }}>Ctrl+Enter sends · response is kept until you send again</span>
        </div>
      </div>
    )
  }

  const isError = resp.failError !== undefined
  const ok = !isError && (resp.status ?? 0) < 400
  const warn = !isError && (resp.status ?? 0) >= 400 && (resp.status ?? 0) < 500
  const chipClass = isError ? 'status-bad' : warn ? 'status-warn' : ok ? 'status-ok' : 'status-bad'
  const cookieCount = resp.headers.filter((h) => h.key.toLowerCase() === 'set-cookie').length
  const passed = tests.filter((t) => t.passed).length

  return (
    <div className="resp-pane">
      <div className="resp-head">
        {TABS.map((t) => (
          <button key={t} className={`subtab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'body' ? 'Body' : t === 'cookies' ? `Cookies${cookieCount ? ` (${cookieCount})` : ''}` : t === 'headers' ? `Headers (${resp.headers.length})` : `Test Results${tests.length ? ` (${passed}/${tests.length})` : ''}`}
          </button>
        ))}
        <div className="resp-meta">
          {isError ? (
            <span className={`status-chip ${chipClass}`}>Error</span>
          ) : (
            <span className={`status-chip ${chipClass}`}>{resp.status} {resp.statusText}</span>
          )}
          {!isError ? (
            <>
              <span>{fmtMs(resp.durationMs)}</span>
              <span>{fmtBytes(resp.bodyBytes)}</span>
            </>
          ) : null}
          <span style={{ color: 'var(--text-3)' }}>{new Date(resp.sentAt).toLocaleTimeString()}</span>
          {!isError && resp.body ? (
            <>
              <span
                className="icon-btn"
                title="Copy body"
                onClick={() => void navigator.clipboard.writeText(resp.body ?? '').then(() => actions.toast('Body copied', 'success'))}
              >
                <CopyIcon />
              </span>
              <span
                className="icon-btn"
                title="Save body to file"
                onClick={() => void download(resp)}
              >
                <DownloadIcon />
              </span>
            </>
          ) : null}
          {tab === 'body' && !isError ? (
            <span className="icon-btn" title="Search body" onClick={() => setShowFilter((v) => !v)}>
              <SearchIcon />
            </span>
          ) : null}
        </div>
      </div>

      {showFilter && tab === 'body' ? (
        <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-soft)' }}>
          <input className="text-input" autoFocus placeholder="Filter lines…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {isError ? (
          <div className="resp-error">{`[${resp.errorCode}] ${resp.failError}`}</div>
        ) : tab === 'body' ? (
          <BodyView resp={resp} tabSize={tabSize} filter={filter} />
        ) : tab === 'headers' ? (
          <HeadersView resp={resp} />
        ) : tab === 'cookies' ? (
          <CookiesView resp={resp} />
        ) : (
          <TestsView tests={tests} />
        )}
      </div>
    </div>
  )
}

function BodyView({ resp, tabSize, filter }: { resp: ResponseState; tabSize: number; filter: string }): JSX.Element {
  const body = resp.body
  const pretty = useMemo(() => {
    if (!body) return { lines: [] as string[], highlight: false }
    if (body.length > PRETTY_LIMIT) return { lines: body.split('\n'), highlight: false }
    let obj: unknown
    try {
      obj = JSON.parse(body)
    } catch {
      return { lines: body.split('\n'), highlight: false }
    }
    try {
      return { lines: JSON.stringify(obj, null, tabSize).split('\n'), highlight: true }
    } catch {
      return { lines: body.split('\n'), highlight: false }
    }
  }, [body, tabSize])

  if (!body) return <div className="resp-empty">No body (empty or binary response){resp.truncated ? ' — response was truncated by the size limit' : ''}</div>
  return <JsonView lines={pretty.lines} highlight={pretty.highlight} filter={filter} />
}

function HeadersView({ resp }: { resp: ResponseState }): JSX.Element {
  return (
    <div className="resp-body-wrap">
      <table className="resp-table">
        <thead>
          <tr>
            <th>Header</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {resp.headers.map((h, i) => (
            <tr key={i}>
              <td>{h.key}</td>
              <td>{h.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CookiesView({ resp }: { resp: ResponseState }): JSX.Element {
  const setCookies = resp.headers.filter((h) => h.key.toLowerCase() === 'set-cookie')
  return (
    <div className="resp-body-wrap">
      {setCookies.length === 0 ? <div className="resp-empty">This response has no cookies.</div> : null}
      {setCookies.map((h, i) => {
        const [nv, ...attrs] = h.value.split(';')
        const eq = nv.indexOf('=')
        return (
          <div key={i} style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-soft)' }}>
            <div className="cookie-name">{eq < 0 ? nv : nv.slice(0, eq)} <span style={{ color: 'var(--text-3)' }}>=</span></div>
            <div className="cookie-value">{eq < 0 ? '' : nv.slice(eq + 1)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{attrs.join('; ')}</div>
          </div>
        )
      })}
    </div>
  )
}

function TestsView({ tests }: { tests: { name: string; passed: boolean; error?: string }[] }): JSX.Element {
  return (
    <div className="resp-body-wrap">
      {tests.length === 0 ? <div className="resp-empty">No tests — add pm.test() calls in the Scripts → Post-response tab.</div> : null}
      {tests.map((t, i) => (
        <div key={i} className={t.passed ? 'test-row-ok' : 'test-row-fail'} style={{ padding: '7px 14px', borderBottom: '1px solid var(--border-soft)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {t.passed ? '✔ PASS' : '✘ FAIL'} {t.name}
          {t.error ? <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{t.error}</div> : null}
        </div>
      ))}
    </div>
  )
}

async function download(resp: ResponseState): Promise<void> {
  const { pm } = await import('../../api/bridge')
  if (!pm) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const ext = resp.contentType.includes('json') ? 'json' : 'txt'
  const out = await pm.exportFile(`postmaster-response-${stamp}.${ext}`, resp.body ?? '')
  if (out.saved) actions.toast('Saved to ' + out.saved, 'success')
  else if (out.error) actions.toast('Save failed: ' + out.error, 'error')
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

