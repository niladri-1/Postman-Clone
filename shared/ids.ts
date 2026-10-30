/**
 * Tiny shared ID generator — crypto.randomUUID where available, fallback entropy.
 */
export function genId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return (
    'id-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10)
  )
}
