/**
 * Minimal external store (useSyncExternalStore based) — fine-grained
 * subscriptions keep re-renders localized without external dependencies.
 */
import { useSyncExternalStore } from 'react'

export type Listener = () => void

export class Store<T> {
  private state: T
  private listeners = new Set<Listener>()

  constructor(initial: T) {
    this.state = initial
  }

  get(): T {
    return this.state
  }

  set(patch: Partial<T> | ((s: T) => Partial<T>)): void {
    const p = typeof patch === 'function' ? (patch as (s: T) => Partial<T>)(this.state) : patch
    let changed = false
    for (const k of Object.keys(p) as (keyof T)[]) {
      if (this.state[k] !== p[k]) {
        changed = true
        break
      }
    }
    if (!changed) return
    this.state = { ...this.state, ...p }
    this.emit()
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): T => this.state

  private emit(): void {
    for (const l of this.listeners) l()
  }
}

/** Selector hook with identity comparison (cheap for primitive/atom slices). */
export function useStore<T, S>(store: Store<T>, selector: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
}

/** Hook that re-renders on any store change */
export function useStoreAll<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
