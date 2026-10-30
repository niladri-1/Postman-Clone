import type { JSX } from 'react'
import { useEffect, useRef } from 'react'
import { actions, appStore } from '../state/actions'
import { useStore } from '../state/store'

/** Bottom drawer with sandbox script console output for the active tab. */
export default function ConsoleDrawer(): JSX.Element | null {
  const active = useStore(appStore, (s) => s.activeTabId)
  const logs = useStore(appStore, (s) => (s.activeTabId ? s.scriptLogs[s.activeTabId] : undefined))
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [logs])

  if (!active) return null

  return (
    <div className="console">
      <div className="console-head">
        <span>Console — {logs?.length ?? 0} message{logs?.length === 1 ? '' : 's'}</span>
        <span style={{ marginLeft: 'auto' }} />
        <button
          className="side-icon-btn"
          title="Clear"
          onClick={() => appStore.set((s) => ({ scriptLogs: { ...s.scriptLogs, [active]: [] } }))}
        >
          Clear
        </button>
        <button className="side-icon-btn" title="Close" onClick={actions.toggleConsole}>
          ×
        </button>
      </div>
      <div className="console-body" ref={bodyRef}>
        {(logs ?? []).length === 0 ? <div className="log-info">Script log output appears here (console.log / warnings / test errors).</div> : null}
        {(logs ?? []).map((l, i) => (
          <div key={i} className={`log-${l.level}`}>
            <span className="console-time">{new Date(l.ts).toLocaleTimeString()}</span>
            {l.message}
          </div>
        ))}
      </div>
    </div>
  )
}

