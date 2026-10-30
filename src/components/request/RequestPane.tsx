import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { actions, appStore } from '../../state/actions'
import { useStore } from '../../state/store'
import { METHOD_OPTIONS, methodColor } from '../../ui/controls'
import { resolveVariables, varsToScope, type VarScope } from '../../../shared/variables'
import { ParamsPanel, HeadersPanel, BodyPanel, AuthPanel, ScriptsPanel, RequestSettingsPanel } from './Panels'
import UrlInput from './UrlSuggest'
import type { OpenTab } from '../../../shared/models'

export default function RequestPane({ tab }: { tab: OpenTab }): JSX.Element {
  const [sub, setSub] = useState<SubTab>('params')
  const pending = useStore(appStore, (s) => !!s.pending[tab.id])
  const varsHint = useUnresolvedVars(tab.draft)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div className="req-head">
        <div className="req-title-row">
          <span style={{ color: methodColor(tab.draft.method), display: 'inline-flex' }}>◆</span>
          <input
            className="req-name-input"
            value={tab.draft.name ?? ''}
            placeholder="Request name"
            onChange={(e) => {
              const v = e.target.value
              actions.updateTab(tab.id, (d) => { d.name = v })
              actions.renameTab(tab.id, v) // keep the tab title live while typing
            }}
          />
          <span className="save-group">
            <button className="btn" onClick={() => actions.saveActiveRequest(tab.id)} title="Save instantly (updates the saved copy)">
              Save
            </button>
            <button className="btn caret" onClick={() => actions.openModal('saveRequest')} title="Save as… (choose collection or folder)">
              ▾
            </button>
          </span>
          <button className="btn" onClick={() => actions.openModal('share')} title="Copy as cURL">
            Share
          </button>
        </div>

        <div className="req-url-row">
          <select
            className={`method-select method-${tab.draft.method.toUpperCase()}`}
            value={tab.draft.method.toUpperCase()}
            onChange={(e) => actions.updateTab(tab.id, (d) => { d.method = e.target.value })}
          >
            {[...new Set([tab.draft.method.toUpperCase(), ...METHOD_OPTIONS])].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <UrlInput tab={tab} />
          {pending ? (
            <button className="send-btn stop" onClick={() => actions.cancel(tab.id)} title="Cancel request">
              Cancel
            </button>
          ) : (
            <button className="send-btn" onClick={() => actions.send(tab.id)} title="Send (Enter)">
              Send
            </button>
          )}
        </div>

        {varsHint.length > 0 ? <div className="url-vars-hint">Unresolved variables: {varsHint.join(', ')}</div> : null}

        <div className="req-subtabs">
          <SubTabBtn id="params" current={sub} onPick={setSub} label="Params" dot={paramsFilled(tab.draft)} />
          <SubTabBtn id="headers" current={sub} onPick={setSub} label="Headers" badge={tab.draft.headers.filter((h) => h.enabled && h.key).length} />
          <SubTabBtn id="auth" current={sub} onPick={setSub} label="Authorization" />
          <SubTabBtn id="body" current={sub} onPick={setSub} label="Body" dot={tab.draft.body.type !== 'none'} />
          <SubTabBtn id="scripts" current={sub} onPick={setSub} label="Scripts" />
          <SubTabBtn id="settings" current={sub} onPick={setSub} label="Settings" />
        </div>
      </div>

      <div className="req-panel">
        <div className="panel-card">
          {sub === 'params' ? <ParamsPanel tabId={tab.id} draft={tab.draft} /> : null}
          {sub === 'headers' ? <HeadersPanel tabId={tab.id} draft={tab.draft} /> : null}
          {sub === 'auth' ? <AuthPanel tabId={tab.id} draft={tab.draft} /> : null}
          {sub === 'body' ? <BodyPanel tabId={tab.id} draft={tab.draft} /> : null}
          {sub === 'scripts' ? <ScriptsPanel tabId={tab.id} draft={tab.draft} /> : null}
          {sub === 'settings' ? <RequestSettingsPanel tabId={tab.id} draft={tab.draft} /> : null}
        </div>
      </div>
    </div>
  )
}

type SubTab = 'params' | 'headers' | 'auth' | 'body' | 'scripts' | 'settings'

function SubTabBtn({ id, current, onPick, label, badge, dot }: { id: SubTab; current: SubTab; onPick: (v: SubTab) => void; label: string; badge?: number; dot?: boolean }): JSX.Element {
  return (
    <button className={`subtab${current === id ? ' active' : ''}`} onClick={() => onPick(id)}>
      {label}
      {typeof badge === 'number' && badge > 0 ? <span className="badge">{badge}</span> : null}
      {dot ? <span className="unsaved-dot" /> : null}
    </button>
  )
}

function paramsFilled(d: OpenTab['draft']): boolean {
  try {
    return d.url.includes('?') && d.url.slice(d.url.indexOf('?') + 1).length > 0
  } catch {
    return false
  }
}

/** Variables referenced anywhere in the draft that do not resolve. */
function useUnresolvedVars(draft: OpenTab['draft']): string[] {
  const envId = useStore(appStore, (s) => s.activeEnvId)
  const s = useMemo(() => {
    const st = appStore.get()
    const env = st.environments.find((e) => e.id === envId) ?? null
    return {
      globals: varsToScope(st.globals),
      environment: env ? varsToScope(env.variables) : undefined,
      runtime: draft.runtimeVars,
    } satisfies VarScope
  }, [envId, draft.runtimeVars, draft.url, draft.headers, draft.body])

  const unresolved = new Set<string>()
  for (const text of [draft.url, ...draft.headers.filter((h) => h.enabled).flatMap((h) => [h.key, h.value]), draft.body.json, draft.body.raw]) {
    if (!text) continue
    for (const u of resolveVariables(text, s).unresolved) unresolved.add(u)
  }
  return [...unresolved]
}

