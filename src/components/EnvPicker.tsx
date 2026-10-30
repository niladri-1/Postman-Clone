import type { JSX } from 'react'
import { useState } from 'react'
import { actions, appStore } from '../state/actions'
import { useStore } from '../state/store'
import { useDismissed } from '../ui/controls'

/** Environment selector. Lives in the title bar so its dropdown is never clipped. */
export default function EnvPicker(): JSX.Element {
  const envs = useStore(appStore, (s) => s.environments)
  const activeId = useStore(appStore, (s) => s.activeEnvId)
  const [open, setOpen] = useState(false)
  const { ref } = useDismissed(open, () => setOpen(false))
  const active = envs.find((e) => e.id === activeId)

  return (
    <div className="env-picker" ref={ref}>
      <button className="env-btn" onClick={() => setOpen((v) => !v)} title="Select environment">
        <span className={`env-dot${active ? '' : ' none'}`} />
        {active ? active.name : 'No Environment'}
      </button>
      {open ? (
        <div className="dropdown">
          <div className="dropdown-head">Active environment</div>
          <button className={`dropdown-item${active ? '' : ' selected'}`} onClick={() => { actions.setActiveEnv(null); setOpen(false) }}>
            No Environment
          </button>
          {envs.map((e) => (
            <button
              key={e.id}
              className={`dropdown-item${e.id === activeId ? ' selected' : ''}`}
              onClick={() => { actions.setActiveEnv(e.id); setOpen(false) }}
            >
              {e.name}
            </button>
          ))}
          {envs.length > 0 ? <div className="dropdown-sep" /> : null}
          <button
            className="dropdown-item"
            onClick={() => {
              setOpen(false)
              actions.setPanel('environments')
              actions.openModal('newEnv')
            }}
          >
            + New environment
          </button>
        </div>
      ) : null}
    </div>
  )
}
