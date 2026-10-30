import type { JSX } from 'react'
import type { KeyValue } from '../../shared/models'
import { useEffect, useRef, useState } from 'react'

const COLORS: Record<string, string> = {
  GET: 'var(--green)',
  POST: 'var(--yellow)',
  PUT: '#6ea8fe',
  PATCH: '#b18cff',
  DELETE: 'var(--red)',
  HEAD: '#4dd0e1',
  OPTIONS: '#4dd0e1',
}

export function methodColor(m: string): string {
  return COLORS[m.toUpperCase()] ?? '#b8b8b8'
}

export function MethodMini({ method }: { method: string }): JSX.Element {
  return (
    <span className="method-mini" style={{ color: methodColor(method) }}>
      {method.toUpperCase()}
    </span>
  )
}

export function MethodPill({ method }: { method: string }): JSX.Element {
  const m = method.toUpperCase()
  return (
    <span className={`method-pill pill-${m}`} style={{ color: methodColor(m) }}>
      {m}
    </span>
  )
}

export const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

/** Closes on outside click or Escape. */
export function useDismissed(open: boolean, close: () => void): { ref: React.RefObject<HTMLDivElement | null> } {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return { ref }
}

/** Checkbox row for key/value rows. */
export function RowCheck({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return <input type="checkbox" className="kv-check" checked={enabled} onChange={(e) => onChange(e.target.checked)} />
}

export interface RowCallbacks {
  setKey: (id: string, key: string) => void
  setValue: (id: string, value: string) => void
  setDesc?: (id: string, value: string) => void
  setEnabled: (id: string, v: boolean) => void
  remove: (id: string) => void
}

export function RowsEditor({ rows, cbs, showDesc, colHeader, showCheck = true }: { rows: KeyValue[]; cbs: RowCallbacks; showDesc: boolean; colHeader: string; showCheck?: boolean }): JSX.Element {
  if (rows.length === 0) return <div className="kv-empty">No {colHeader.toLowerCase()} yet — add a row to get started.</div>
  return (
    <table className="kv">
      <thead>
        <tr>
          {showCheck ? <th style={{ width: '26px' }} /> : null}
          <th style={{ width: '32%' }}>{colHeader}</th>
          <th>Value</th>
          {showDesc && cbs.setDesc ? <th style={{ width: '22%' }}>Description</th> : null}
          <th style={{ width: '28px' }} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            {showCheck ? (
              <td>
                <input type="checkbox" className="kv-check" checked={r.enabled} onChange={(e) => cbs.setEnabled(r.id, e.target.checked)} />
              </td>
            ) : null}
            <td>
              <input type="text" value={r.key} placeholder="Key" onChange={(e) => cbs.setKey(r.id, e.target.value)} />
            </td>
            <td>
              <input type="text" value={r.value} placeholder="Value" onChange={(e) => cbs.setValue(r.id, e.target.value)} />
            </td>
            {showDesc && cbs.setDesc ? (
              <td>
                <input type="text" className="kv-desc" value={r.description ?? ''} onChange={(e) => cbs.setDesc?.(r.id, e.target.value)} />
              </td>
            ) : null}
            <td>
              <button type="button" className="kv-x" title="Remove row" onClick={() => cbs.remove(r.id)}>
                ×
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Small modal prompt used for new collection / environment / rename. */
export function PromptDialog(props: {
  title: string
  initial?: string
  confirmLabel?: string
  onConfirm: (value: string) => void
  onClose: () => void
}): JSX.Element {
  const [value, setValue] = useState(props.initial ?? '')
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" style={{ width: 380 }}>
        <div className="modal-head">{props.title}</div>
        <div className="modal-body">
          <input
            className="text-input"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim()) props.onConfirm(value.trim())
            }}
          />
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!value.trim()} onClick={() => props.onConfirm(value.trim())}>
            {props.confirmLabel ?? 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

