import type { JSX } from 'react'
import { useState } from 'react'
import { actions, appStore } from '../state/actions'
import { useStore } from '../state/store'
import type { EnvVar } from '../../shared/models'

const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

/** Edits one environment's variables (envId) or the globals list (envId === 'globals'). */
export default function EnvEditor({ envId, onClose }: { envId: string | 'globals'; onClose: () => void }): JSX.Element {
  let name = 'Globals'
  let variables: EnvVar[] = []
  if (envId === 'globals') {
    variables = useStore(appStore, (s) => s.globals)
  } else {
    const env = useStore(appStore, (s) => s.environments.find((e) => e.id === envId))
    name = env?.name ?? 'Environment'
    variables = env?.variables ?? []
  }
  const isGlobals = envId === 'globals'
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

  const save = (next: EnvVar[]): void => {
    if (isGlobals) actions.setGlobals(next)
    else actions.setEnvVars(envId, next)
  }

  const displayValue = (v: EnvVar): string =>
    v.secret && !revealed[v.id] ? '●●●●●●●●' : v.value

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 640 }}>
        <div className="modal-head">Edit variables — {name}</div>
        <div className="modal-body">
          <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 0 }}>
            Reference variables with <code style={{ color: 'var(--text-2)' }}>{'{{name}}'}</code> in URLs, headers, body and auth.
          </p>
          <table className="kv">
            <thead>
              <tr>
                <th style={{ width: '30%' }}>Variable</th>
                <th>Initial value</th>
                <th style={{ width: 70 }}>Secret</th>
                <th style={{ width: 28 }} />
              </tr>
            </thead>
            <tbody>
              {variables.length === 0 ? (
                <tr>
                  <td colSpan={4} className="kv-empty" style={{ borderBottom: 'none' }}>
                    No variables yet.
                  </td>
                </tr>
              ) : null}
              {variables.map((v) => (
                <tr key={v.id}>
                  <td>
                    <input type="text" value={v.key} onChange={(e) => v.key !== e.target.value && save(variables.map((x) => (x.id === v.id ? { ...x, key: e.target.value } : x)))} />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={displayValue(v)}
                      onChange={(e) => save(variables.map((x) => (x.id === v.id ? { ...x, value: e.target.value } : x)))}
                      onFocus={() => setRevealed((m) => ({ ...m, [v.id]: true }))}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" className="kv-check" checked={v.secret} onChange={(e) => save(variables.map((x) => (x.id === v.id ? { ...x, secret: e.target.checked } : x)))} />
                  </td>
                  <td>
                    <button type="button" className="kv-x" onClick={() => save(variables.filter((x) => x.id !== v.id))}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="btn"
            style={{ marginTop: 12 }}
            onClick={() => save([...variables, { id: 'var-' + uid(), key: '', value: '', secret: false }])}
          >
            + Add variable
          </button>
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

