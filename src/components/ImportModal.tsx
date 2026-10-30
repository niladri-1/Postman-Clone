import type { JSX } from 'react'
import { useState } from 'react'
import { actions, appStore } from '../state/actions'
import { pm } from '../api/bridge'
import { importEnvironment, importOpenApi, importPostmanCollection } from '../../shared/transfer'

type Mode = 'collection' | 'environment'

export default function ImportModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [mode, setMode] = useState<Mode>('collection')
  const [result, setResult] = useState<string | null>(null)

  const run = async (): Promise<void> => {
    if (!pm) {
      setResult('Import requires the desktop shell.')
      return
    }
    const pick = await pm.importFile()
    if (pick === null || !pick.path) return // dialog canceled
    if (!pick.content) {
      setResult('Read failed: ' + (pick.error ?? 'unknown error'))
      return
    }
    try {
      if (mode === 'collection') {
        const col = detectAndImportCollection(pick.content)
        appStore.set((s) => ({ collections: [...s.collections, col] }))
        actions.saveAll()
        setResult(`Imported collection “${col.name}” (${col.items.length} top-level items).`)
      } else {
        const env = importEnvironment(pick.content)
        appStore.set((s) => ({ environments: [...s.environments, env] }))
        actions.saveAll()
        setResult(`Imported environment “${env.name}” (${env.variables.length} variables).`)
      }
    } catch (err) {
      setResult('Import failed: ' + String((err as Error).message))
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">Import</div>
        <div className="modal-body">
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button className={`btn${mode === 'collection' ? ' primary' : ''}`} onClick={() => { setMode('collection'); setResult(null) }}>
              Collection
            </button>
            <button className={`btn${mode === 'environment' ? ' primary' : ''}`} onClick={() => { setMode('environment'); setResult(null) }}>
              Environment
            </button>
          </div>
          <p style={{ color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.8 }}>
            {mode === 'collection' ? (
              <>
                Supported: <strong>Postman Collection v2.x JSON</strong> and <strong>OpenAPI 3.x JSON</strong> (auto-detected).
                Environments referenced by variables must be imported separately.
              </>
            ) : (
              <>Supported: <strong>Postman Environment v2 JSON</strong> (secret values are preserved and encrypted locally).</>
            )}
          </p>
          <button className="btn primary" onClick={() => void run()}>
            Choose file…
          </button>
          {result ? (
            <div
              style={{ marginTop: 14, padding: '10px 12px', borderRadius: 6, fontSize: 12.5, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', userSelect: 'text' }}
            >
              {result}
            </div>
          ) : null}
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

/** Postman v2 vs OpenAPI 3 auto-detection by shape. */
function detectAndImportCollection(content: string): ReturnType<typeof importPostmanCollection> {
  const head = content.slice(0, 2000)
  if (head.includes('"openapi"')) return importOpenApi(content)
  return importPostmanCollection(content)
}

