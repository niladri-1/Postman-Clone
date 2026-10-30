import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { actions } from '../state/actions'
import { pm } from '../api/bridge'

interface CookieRow {
  domain: string
  path: string
  name: string
  value: string
  expires: number | null
  secure: boolean
  httpOnly: boolean
}

export default function CookiesModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [rows, setRows] = useState<CookieRow[] | null>(null)
  const [domain, setDomain] = useState('')
  const [revealed, setRevealed] = useState(false)

  const load = (): void => {
    setRows(null)
    void pm?.listCookies().then((all) => setRows(all))
  }
  useEffect(load, [])

  const filtered = (rows ?? []).filter((c) => !domain || c.domain.includes(domain))

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          Cookie jar
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <input className="text-input" style={{ width: 180 }} placeholder="Filter by domain…" value={domain} onChange={(e) => setDomain(e.target.value)} />
            <button className="btn" onClick={load}>Refresh</button>
            <button
              className="btn danger"
              onClick={() => {
                void pm?.clearCookies().then((ok) => {
                  if (ok) actions.toast('Cookie jar cleared', 'success')
                  load()
                })
              }}
            >
              Clear all
            </button>
            <button className="btn" onClick={() => setRevealed((v) => !v)}>
              {revealed ? 'Hide values' : 'Reveal values'}
            </button>
          </span>
        </div>
        <div className="modal-body">
          {rows === null ? <div className="kv-empty">Loading…</div> : null}
          {rows !== null && filtered.length === 0 ? <div className="kv-empty">No cookies stored.</div> : null}
          {filtered.length > 0 ? (
            <table className="kv">
              <thead>
                <tr>
                  <th style={{ width: '18%' }}>Domain</th>
                  <th style={{ width: '18%' }}>Name</th>
                  <th>Value</th>
                  <th style={{ width: 60 }}>Flags</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.domain}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.name}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, userSelect: 'text' }}>
                      {revealed ? c.value : '●●●●●●●●'}
                    </td>
                    <td style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                      {[c.secure ? 'Secure' : '', c.httpOnly ? 'HttpOnly' : ''].filter(Boolean).join(' ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <p style={{ color: 'var(--text-3)', fontSize: 11.5, marginTop: 12 }}>
            Cookies persist in the <code>postmaster-cookie-store</code> partition and are sent on requests with
            “Send cookies” enabled.
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

