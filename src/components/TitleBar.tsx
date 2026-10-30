import type { JSX } from 'react'
import { pm } from '../api/bridge'
import { actions, appStore } from '../state/actions'
import { useStore } from '../state/store'
import { GearIcon, MenuIcon, MaxIcon, CloseIcon, MinIcon } from '../ui/icons'
import EnvPicker from './EnvPicker'

export default function TitleBar(): JSX.Element {
  const sidebarHidden = useStore(appStore, (s) => s.sidebarWidth === 0)

  return (
    <div className="titlebar">
      <button
        className="tb-icon-btn"
        title={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
        onClick={actions.toggleSidebar}
      >
        <MenuIcon />
      </button>
      <span className="titlebar-title">Postmaster</span>
      <div className="titlebar-spacer" />
      <EnvPicker />
      <button className="tb-icon-btn" title="Settings" onClick={() => actions.openModal('settings')}>
        <GearIcon />
      </button>
      <div className="win-controls">
        <button className="win-btn" title="Minimize" onClick={() => pm?.minimize()}>
          <MinIcon />
        </button>
        <button
          className="win-btn"
          title="Maximize"
          onClick={() => pm?.maximize()}
        >
          <MaxIcon />
        </button>
        <button className="win-btn close" title="Close" onClick={() => pm?.close()}>
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}

