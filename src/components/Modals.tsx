import type { JSX } from 'react'
import { Suspense, lazy } from 'react'
import { actions, appStore } from '../state/actions'
import { useStore } from '../state/store'
import { PromptDialog } from '../ui/controls'
import SettingsModal from './SettingsModal'
import CookiesModal from './CookiesModal'
import ImportModal from './ImportModal'
import SaveRequestModal from './SaveRequestModal'
import ShareModal from './ShareModal'

const Toasts = lazy(() => import('./Toast'))

/** Renders whichever modal the state requests; toasts render regardless. */
export default function Modals(): JSX.Element {
  const modals = useStore(appStore, (s) => s.modals)
  const activeTabId = useStore(appStore, (s) => s.activeTabId)
  const close = actions.closeModal

  let content: JSX.Element | null = null
  if (modals.settings) content = <SettingsModal onClose={() => close('settings')} />
  else if (modals.cookies) content = <CookiesModal onClose={() => close('cookies')} />
  else if (modals.import) content = <ImportModal onClose={() => close('import')} />
  else if (modals.saveRequest && activeTabId) content = <SaveRequestModal tabId={activeTabId} onClose={() => close('saveRequest')} />
  else if (modals.share && activeTabId) content = <ShareModal tabId={activeTabId} onClose={() => close('share')} />
  else if (modals.newCollection) {
    content = (
      <PromptDialog
        title="New collection"
        initial="New Collection"
        onConfirm={(v) => {
          actions.createCollection(v)
          close('newCollection')
        }}
        onClose={() => close('newCollection')}
      />
    )
  } else if (modals.newEnv) {
    content = (
      <PromptDialog
        title="New environment"
        initial="New Environment"
        onConfirm={(v) => {
          actions.createEnvironment(v)
          close('newEnv')
        }}
        onClose={() => close('newEnv')}
      />
    )
  }

  return (
    <>
      {content}
      <Suspense fallback={null}>
        <Toasts />
      </Suspense>
    </>
  )
}

