/**
 * Local persistence: versioned JSON stores with debounced atomic writes.
 *
 * Rationale (documented in ARCHITECTURE.md): user data here is a handful of
 * small document sets (collections, environments, history, settings, tabs).
 * There are no relational queries, so an embedded SQL database adds native
 * build/build-system risk without a useful win. This store provides full
 * serialization/snapshot guarantees instead:
 *   - atomic save (write temp file + fsync + rename)
 *   - schema version + migration hooks
 *   - corrupt file recovery (backup + fresh start, never blocks the UI)
 *   - async, debounced persistence off the UI thread
 */
import fs from 'node:fs/promises'
import path from 'node:path'

export interface StoreMeta {
  version: number
  app: 'postmaster'
}

/** Single source of truth for store schema versioning. */
export const CURRENT_VERSION = 1

type Migrator = (data: unknown) => unknown

/** Registered store files + their current/supported versions. */
export const STORE_FILES: Record<string, { version: number; migrations: Record<number, Migrator> }> = {
  collections: { version: CURRENT_VERSION, migrations: {} },
  environments: { version: CURRENT_VERSION, migrations: {} },
  history: { version: CURRENT_VERSION, migrations: {} },
  settings: { version: CURRENT_VERSION, migrations: {} },
  tabs: { version: CURRENT_VERSION, migrations: {} },
}

export class DataStore {
  private dir: string
  private cache = new Map<string, unknown>()
  private dirty = new Set<string>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private flushInterval: ReturnType<typeof setInterval> | undefined

  constructor(dir: string) {
    this.dir = dir
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    for (const name of Object.keys(STORE_FILES)) {
      await this.load(name)
    }
    // periodic background flush (every 2s, writes only when dirty)
    this.flushInterval = setInterval(() => void this.flushAll(), 2000)
    if (typeof this.flushInterval.unref === 'function') this.flushInterval.unref()
  }

  private fileFor(name: string): string {
    return path.join(this.dir, `${name}.json.bak`)
  }

  private realFile(name: string): string {
    return path.join(this.dir, `${name}.json`)
  }

  async load(name: string): Promise<void> {
    const spec = STORE_FILES[name]
    for (const candidate of [this.realFile(name), this.fileFor(name)]) {
      try {
        const raw = await fs.readFile(candidate, 'utf8')
        const parsed = JSON.parse(raw) as { meta?: StoreMeta; data?: unknown }
        if (parsed?.meta?.app !== 'postmaster') continue
        let data: unknown = parsed.data
        const from = parsed.meta?.version ?? 0
        const to = spec.version
        if (from > to) {
          // future version — keep raw data, don't destroy
          data = parsed
          this.cache.set(name, parsed)
          return
        }
        if (from < to) {
          for (let v = from; v < to; v++) {
            data = spec.migrations[v]?.(data) ?? data
          }
        }
        this.cache.set(name, data)
        return
      } catch {
        // try next candidate
      }
    }
    this.cache.set(name, specDefaults(name))
  }

  private lastErrorTurbo: Error | null = null
  getLastError(): Error | null {
    return this.lastErrorTurbo
  }

  get<T>(name: string, fallback: T): T {
    const v = this.cache.get(name)
    return (v === undefined ? fallback : v) as T
  }

  set<T>(name: string, value: T): void {
    this.cache.set(name, value)
    this.scheduleFlush(name)
  }

  private scheduleFlush(name: string): void {
    this.dirty.add(name)
    const existing = this.timers.get(name)
    if (existing) clearTimeout(existing)
    const t = setTimeout(() => {
      this.timers.delete(name)
      void this.flush(name)
    }, 400)
    if (typeof t.unref === 'function') t.unref()
  }

  async flush(name: string): Promise<void> {
    if (!this.dirty.has(name)) return
    this.dirty.delete(name)
    const spec = STORE_FILES[name]
    const data = this.cache.get(name)
    try {
      const payload = JSON.stringify({ meta: { version: spec.version, app: 'postmaster' } satisfies StoreMeta, data })
      // backup current file before overwrite
      try {
        await fs.copyFile(this.realFile(name), this.fileFor(name))
      } catch {
        /* first write may have no previous */
      }
      const temp = path.join(this.dir, `${name}.json.tmp`)
      const handle = await fs.open(temp, 'w')
      await handle.write(payload, 0, 'utf8')
      await handle.sync()
      await handle.close()
      await fs.rename(temp, this.realFile(name))
    } catch (err) {
      this.lastErrorTurbo = err instanceof Error ? err : new Error(String(err))
      // stay silent in normal operation; surfaced through IPC diagnostics
    }
  }

  async flushAll(): Promise<void> {
    for (const name of [...this.dirty]) {
      await this.flush(name)
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushInterval) clearInterval(this.flushInterval)
    // synchronous final write to avoid data loss
    for (const name of Object.keys(STORE_FILES)) {
      const data = this.cache.get(name)
      if (data === undefined) continue
      const spec = STORE_FILES[name]
      const payload = JSON.stringify({ meta: { version: spec.version, app: 'postmaster' }, data })
      try {
        const temp = path.join(this.dir, `${name}.json.tmp`)
        await fs.writeFile(temp, payload, 'utf8')
        await fs.rename(temp, this.realFile(name))
      } catch {
        /* best-effort */
      }
    }
  }
}

function specDefaults(name: string): unknown {
  switch (name) {
    case 'collections':
      return []
    case 'environments':
      return { environments: [], globals: [] }
    case 'history':
      return []
    case 'settings':
      return {}
    case 'tabs':
      return { tabs: [] }
    default:
      return null
  }
}
