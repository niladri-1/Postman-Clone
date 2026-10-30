import type { JSX } from 'react'
import { useState } from 'react'
import { actions, appStore } from '../../state/actions'
import { useStore } from '../../state/store'
import { RowsEditor, METHOD_OPTIONS, type RowCallbacks } from '../../ui/controls'
import { buildUrl, splitUrl } from '../../../shared/http-utils'
import type { RequestDraft, AuthConfig, KeyValue } from '../../../shared/models'

type PanelsProps = { tabId: string; draft: RequestDraft }

const AUTH_TYPES: { value: AuthConfig['type']; label: string }[] = [
  { value: 'none', label: 'No Auth' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'apiKey', label: 'API Key' },
]

// --- params (URL ⇄ rows sync, single source: the URL string) ------------------

export function ParamsPanel({ draft, tabId }: PanelsProps): JSX.Element {
  const [bulk, setBulk] = useState(false)
  const parsed = splitUrl(draft.url)
  const pairs = parsed.pairs ?? []
  const count = pairs.filter((p) => p.enabled && p.key).length

  const setUrl = (next: { base: string; pairs: typeof pairs }): void => {
    actions.updateTab(tabId, (d) => {
      d.url = buildUrl(next.base, next.pairs)
    })
  }

  const EMPTY_ID = 'params-empty-row'
  const KV_SHAPE = { id: 'x', key: '', value: '', description: '', enabled: true } as const

  const editPair = (idx: number, patch: Partial<(typeof pairs)[number]>): void => {
    // idx === pairs.length → the phantom empty row: typing creates a real pair
    const next =
      idx >= pairs.length
        ? [...pairs, { ...KV_SHAPE, id: 'n' + Math.random().toString(36).slice(2, 8), ...patch }]
        : pairs.map((p, i) => (i === idx ? { ...p, ...patch } : p))
    setUrl({ base: parsed.base, pairs: next })
  }

  const removePair = (idx: number): void => {
    if (idx >= pairs.length) return // phantom row has nothing to remove
    setUrl({ base: parsed.base, pairs: pairs.filter((_, i) => i !== idx) })
  }

  const bulkApply = (text: string): void => {
    const rows = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')
      .map((l) => {
        const eq = l.indexOf('=')
        return { id: 'b' + Math.random().toString(36).slice(2, 6), key: eq < 0 ? l : l.slice(0, eq), value: eq < 0 ? '' : l.slice(eq + 1), description: '', enabled: true }
      })
    setUrl({ base: parsed.base, pairs: rows })
  }

  return (
    <div>
      <div className="kv-toolbar">
        <span className="kv-caption">Query Params</span>
        <button className={`btn${bulk ? '' : ''}`} style={{ padding: '3px 10px', fontSize: 11.5 }} onClick={() => setBulk((v) => !v)}>
          {bulk ? 'Table edit' : 'Bulk edit'}
        </button>
      </div>
      {bulk ? (
        <textarea
          className="bulk"
          spellCheck={false}
          defaultValue={pairs.map((p) => `${p.key}=${p.value}`).join('\n')}
          onBlur={(e) => bulkApply(e.target.value)}
          placeholder="key=value per line, e.g.&#10;page=1&#10;sort=name"
        />
      ) : (
        <table className="kv">
          <thead>
            <tr>
              <th style={{ width: '30%' }}>Key</th>
              <th>Value</th>
              <th style={{ width: 28 }} />
            </tr>
          </thead>
          <tbody>
            {(() => {
              const hasEmpty = pairs.some((p) => p.key === '' && p.value === '')
              const rows = hasEmpty ? pairs : [...pairs, { ...KV_SHAPE, id: EMPTY_ID, key: '', value: '', description: '', enabled: true }]
              return rows.map((p, i) => (
                <tr key={p.id}>
                  <td>
                    <input type="text" value={p.key} placeholder="Key" onChange={(e) => editPair(i, { key: e.target.value })} />
                  </td>
                  <td>
                    <input type="text" value={p.value} placeholder="Value" onChange={(e) => editPair(i, { value: e.target.value })} />
                  </td>
                  <td>
                    <button type="button" className="kv-x" title="Remove param" onClick={() => removePair(i)}>
                      ×
                    </button>
                  </td>
                </tr>
              ))
            })()}
          </tbody>
        </table>
      )}
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>{count} active param{count === 1 ? '' : 's'} — editing here rewrites the URL automatically.</div>
    </div>
  )
}

// --- headers -----------------------------------------------------------------

/** Phantom trailing row marker — an always-present empty header row, like the reference app. */
const EMPTY_ID = 'header-empty-row'

export function HeadersPanel({ draft, tabId }: PanelsProps): JSX.Element {
  const cbs: RowCallbacks = {
    setKey: (id, key) => actions.updateTab(tabId, (d) => { const h = d.headers.find((x) => x.id === id); if (h) h.key = key }),
    setValue: (id, value) => actions.updateTab(tabId, (d) => { const h = d.headers.find((x) => x.id === id); if (h) h.value = value }),
    setDesc: (id, description) => actions.updateTab(tabId, (d) => { const h = d.headers.find((x) => x.id === id); if (h) h.description = description }),
    setEnabled: (id, enabled) => actions.updateTab(tabId, (d) => { const h = d.headers.find((x) => x.id === id); if (h) h.enabled = enabled }),
    remove: (id) => actions.updateTab(tabId, (d) => { d.headers = d.headers.filter((x) => x.id !== id) }),
  }
  const count = draft.headers.filter((h) => h.enabled && h.key).length

  // keep one always-empty row: type into it and it becomes a real header
  const hasEmpty = draft.headers.some((h) => h.key === '' && h.value === '')
  const rows: KeyValue[] = hasEmpty
    ? draft.headers
    : [...draft.headers, { id: EMPTY_ID, key: '', value: '', description: '', enabled: true }]
  const pushEmpty = (patch: Partial<KeyValue>): void =>
    actions.updateTab(tabId, (d) => {
      d.headers.push({ id: 'h' + Math.random().toString(36).slice(2, 10), key: '', value: '', enabled: true, ...patch })
    })
  const wrapped: RowCallbacks = {
    setKey: (id, key) => (id === EMPTY_ID ? pushEmpty({ key }) : cbs.setKey(id, key)),
    setValue: (id, value) => (id === EMPTY_ID ? pushEmpty({ value }) : cbs.setValue(id, value)),
    setDesc: (id, description) => (id === EMPTY_ID ? pushEmpty({ description }) : cbs.setDesc?.(id, description)),
    setEnabled: (id, enabled) => (id === EMPTY_ID ? pushEmpty({ enabled }) : cbs.setEnabled(id, enabled)),
    remove: (id) => (id === EMPTY_ID ? undefined : cbs.remove(id)),
  }
  return (
    <div>
      <div className="kv-toolbar">
        <span className="kv-caption">Headers</span>
        <span className="badge" style={{ fontSize: 10, background: 'var(--bg-hover)', padding: '1px 6px', borderRadius: 8, color: 'var(--text-2)' }}>{count}</span>
        <button
          className="link-btn"
          onClick={() =>
            actions.updateTab(tabId, (d) => {
              d.headers.push({ id: 'h' + Math.random().toString(36).slice(2, 10), key: '', value: '', enabled: true })
            })
          }
        >
          + Add header
        </button>
      </div>
      <RowsEditor rows={rows} cbs={wrapped} showDesc colHeader="Key" />
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>Auth headers and Content-Type are added automatically on send.</div>
    </div>
  )
}

// --- body --------------------------------------------------------------------

const BODY_TYPES: { value: RequestDraft['body']['type']; label: string }[] = [
  { value: 'none', label: 'none' },
  { value: 'json', label: 'JSON' },
  { value: 'raw', label: 'raw' },
  { value: 'urlencoded', label: 'x-www-form-urlencoded' },
  { value: 'form', label: 'form-data' },
]

export function BodyPanel({ draft, tabId }: PanelsProps): JSX.Element {
  if (draft.body.type === 'none') {
    return (
      <div>
        <BodyTypeRow draft={draft} tabId={tabId} />
        <div className="body-none-hint">This request does not have a body</div>
      </div>
    )
  }
  if (draft.body.type === 'urlencoded') {
    const cbs: RowCallbacks = {
      setKey: (id, key) => actions.updateTab(tabId, (d) => { const p = d.body.urlencoded.find((x) => x.id === id); if (p) p.key = key }),
      setValue: (id, value) => actions.updateTab(tabId, (d) => { const p = d.body.urlencoded.find((x) => x.id === id); if (p) p.value = value }),
      setEnabled: (id, enabled) => actions.updateTab(tabId, (d) => { const p = d.body.urlencoded.find((x) => x.id === id); if (p) p.enabled = enabled }),
      remove: (id) => actions.updateTab(tabId, (d) => { d.body.urlencoded = d.body.urlencoded.filter((x) => x.id !== id) }),
    }
    return (
      <div>
        <BodyTypeRow draft={draft} tabId={tabId} />
        <RowsEditor rows={draft.body.urlencoded} cbs={cbs} showDesc={false} colHeader="Key" />
        <button
          className="link-btn"
          style={{ marginTop: 8 }}
          onClick={() =>
            actions.updateTab(tabId, (d) => {
              d.body.urlencoded.push({ id: 'f' + Math.random().toString(36).slice(2, 10), key: '', value: '', enabled: true })
            })
          }
        >
          + Add field
        </button>
      </div>
    )
  }
  if (draft.body.type === 'form') {
    const cbs: RowCallbacks = {
      setKey: (id, key) => actions.updateTab(tabId, (d) => { const p = d.body.form.find((x) => x.id === id); if (p) p.key = key }),
      setValue: (id, value) => actions.updateTab(tabId, (d) => { const p = d.body.form.find((x) => x.id === id); if (p) p.value = value }),
      setEnabled: (id, enabled) => actions.updateTab(tabId, (d) => { const p = d.body.form.find((x) => x.id === id); if (p) p.enabled = enabled }),
      remove: (id) => actions.updateTab(tabId, (d) => { d.body.form = d.body.form.filter((x) => x.id !== id) }),
    }
    return (
      <div>
        <BodyTypeRow draft={draft} tabId={tabId} />
        <RowsEditor rows={draft.body.form} cbs={cbs} showDesc={false} colHeader="Key" />
        <button
          className="link-btn"
          style={{ marginTop: 8 }}
          onClick={() =>
            actions.updateTab(tabId, (d) => {
              d.body.form.push({ id: 'fm' + Math.random().toString(36).slice(2, 10), key: '', value: '', enabled: true })
            })
          }
        >
          + Add field
        </button>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>Text fields only in v1 — file upload is a documented deferral.</div>
      </div>
    )
  }
  const isJson = draft.body.type === 'json'
  return (
    <div>
      <BodyTypeRow draft={draft} tabId={tabId} />
      <textarea
        className="code-editor"
        spellCheck={false}
        value={isJson ? draft.body.json : draft.body.raw}
        placeholder={isJson ? '{ "hello": "world" }' : 'Raw body text…'}
        onChange={(e) =>
          actions.updateTab(tabId, (d) => {
            if (isJson) d.body.json = e.target.value
            else d.body.raw = e.target.value
          })
        }
      />
    </div>
  )
}

function BodyTypeRow({ draft, tabId }: PanelsProps): JSX.Element {
  return (
    <div className="body-type-row">
      <span className="kv-caption">Body type</span>
      <select
        className="select-input"
        value={draft.body.type}
        onChange={(e) =>
          actions.updateTab(tabId, (d) => {
            d.body.type = e.target.value as RequestDraft['body']['type']
            if (d.body.type === 'json' && !d.body.json.trim() && d.body.raw.trim()) d.body.json = d.body.raw
          })
        }
      >
        {BODY_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// --- auth --------------------------------------------------------------------

export function AuthPanel({ draft, tabId }: PanelsProps): JSX.Element {
  const auth = draft.auth
  const set = (patch: Partial<AuthConfig>): void => actions.updateTab(tabId, (d) => { d.auth = { ...d.auth, ...patch } })

  return (
    <div>
      <div className="auth-row">
        <label style={{ color: 'var(--text-2)', fontSize: 12.5 }}>Auth type</label>
        <select className="select-input" value={auth.type} onChange={(e) => set({ type: e.target.value as AuthConfig['type'] })}>
          {AUTH_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {auth.type === 'none' ? (
        <div className="auth-empty">
          This request does not use any authorization.
          <br />
          Choose a type above to add credentials manually.
        </div>
      ) : null}

      {auth.type === 'basic' ? (
        <div>
          <div className="auth-field">
            <label>Username</label>
            <input className="text-input" value={auth.username ?? ''} onChange={(e) => set({ username: e.target.value })} placeholder="username" />
          </div>
          <div className="auth-field">
            <label>Password</label>
            <input className="text-input" type="password" value={auth.password ?? ''} onChange={(e) => set({ password: e.target.value })} placeholder="password" />
          </div>
        </div>
      ) : null}

      {auth.type === 'bearer' ? (
        <div className="auth-field">
          <label>Token</label>
          <input className="text-input" type="password" value={auth.token ?? ''} onChange={(e) => set({ token: e.target.value })} placeholder="paste your bearer token" />
        </div>
      ) : null}

      {auth.type === 'apiKey' ? (
        <div>
          <div className="auth-field">
            <label>Add to</label>
            <select className="select-input" value={auth.apiKeyLocation ?? 'header'} onChange={(e) => set({ apiKeyLocation: e.target.value as 'header' | 'query' })}>
              <option value="header">Header</option>
              <option value="query">Query parameter</option>
            </select>
          </div>
          <div className="auth-field">
            <label>Key name</label>
            <input className="text-input" value={auth.apiKeyIn ?? ''} onChange={(e) => set({ apiKeyIn: e.target.value })} placeholder={auth.apiKeyLocation === 'query' ? 'api_key' : 'X-Api-Key'} />
          </div>
          <div className="auth-field">
            <label>Value</label>
            <input className="text-input" type="password" value={auth.apiKeyValue ?? ''} onChange={(e) => set({ apiKeyValue: e.target.value })} />
          </div>
        </div>
      ) : null}

      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 12 }}>
        OAuth 2.0 and Digest flows are deferred in this version. Variables like <code>{'{{token}}'}</code> resolve in every field.
      </div>
    </div>
  )
}

// --- scripts -------------------------------------------------------------------

export function ScriptsPanel({ draft, tabId }: PanelsProps): JSX.Element {
  const [phase, setPhase] = useState<'pre' | 'post'>('pre')
  const pre = draft.scripts?.pre ?? ''
  const post = draft.scripts?.post ?? ''
  const value = phase === 'pre' ? pre : post

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 220 }}>
      <div className="scripts-tabs">
        <button className={`subtab${phase === 'pre' ? ' active' : ''}`} onClick={() => setPhase('pre')}>Pre-request</button>
        <button className={`subtab${phase === 'post' ? ' active' : ''}`} onClick={() => setPhase('post')}>Post-response</button>
      </div>
      <div className="script-hint">
        Sandboxed JavaScript with a <code>pm</code> API. Examples: <code>pm.environment.set('x', '1')</code>,{' '}
        <code>pm.test('ok', () =&gt; pm.expect(pm.response.code).to.equal(200))</code>, <code>console.log(...)</code>. Timeout 2.5&nbsp;s.
        Nested requests, crypto and moment are not available.
      </div>
      <textarea
        className="code-editor"
        style={{ flex: 1 }}
        spellCheck={false}
        value={value}
        placeholder={phase === 'pre' ? '// runs before the request' : '// runs after the response'}
        onChange={(e) => {
          const v = e.target.value
          actions.updateTab(tabId, (d) => {
            d.scripts = { pre: phase === 'pre' ? v : pre, post: phase === 'post' ? v : post }
          })
        }}
      />
    </div>
  )
}

// --- per-request settings -------------------------------------------------------

export function RequestSettingsPanel({ draft, tabId }: PanelsProps): JSX.Element {
  const s = draft.settings
  const set = (patch: Partial<RequestDraft['settings']>): void => actions.updateTab(tabId, (d) => { d.settings = { ...d.settings, ...patch } })
  const appDefaults = useStore(appStore, (st) => st.settings)

  return (
    <div className="req-settings-grid">
      <div className="row">
        <label title="0 = use the app default or never">Timeout (ms)</label>
        <input className="num-input" type="number" min={0} value={s.timeoutMs} onChange={(e) => set({ timeoutMs: Number(e.target.value) || 0 })} />
        <span style={{ color: 'var(--text-3)', fontSize: 11.5 }}>app default: {appDefaults.requestTimeoutMs === 0 ? 'never' : appDefaults.requestTimeoutMs + ' ms'}</span>
      </div>
      <div className="row">
        <label>Follow redirects</label>
        <Toggle checked={s.followRedirects} onChange={(v) => set({ followRedirects: v })} />
      </div>
      <div className="row">
        <label>SSL certificate verification</label>
        <Toggle checked={s.sslVerify} onChange={(v) => set({ sslVerify: v })} />
      </div>
      <div className="row">
        <label>Send cookies (session jar)</label>
        <Toggle checked={s.sendCookies} onChange={(v) => set({ sendCookies: v })} />
      </div>
    </div>
  )
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider" />
    </label>
  )
}

export { METHOD_OPTIONS }

