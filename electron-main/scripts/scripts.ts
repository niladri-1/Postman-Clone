/**
 * Sandboxed pre-request / post-response script execution.
 *
 * A small `pm` runtime surface is implemented here (variables, request read
 * access, response access, assertions via pm.expect, console). Scripts run
 * with a fresh v8 context on every execution and a hard timeout — infinite
 * loops and errant sync work cannot wedge the process forever.
 *
 * Not implemented (documented DEFERENCE): nested pm.sendRequest inside
 * sandboxed scripts, ctor require/dynamic loading, crypto and moment shims.
 */
import vm from 'node:vm'

export interface ScriptLog {
  ts: number
  level: 'log' | 'warn' | 'error'
  message: string
}

export interface ScriptTest {
  name: string
  passed: boolean
  error?: string
  assertion?: {
    actual: unknown
    expected: unknown
  }
}

export interface ScriptRun {
  logs: ScriptLog[]
  tests: ScriptTest[]
  envSets: Record<string, string>
  globalSets: Record<string, string>
  collectionSets: Record<string, string>
  error?: string
  durationMs: number
}

interface ScriptContext {
  variables: { globals: Record<string, string>; environment: Record<string, string>; collection: Record<string, string> }
  request: { method: string; url: string; headers: Record<string, string>; body?: string }
  response?: {
    code: number
    status: string
    responseTime: number
    headers: { key: string; value: string }[]
    sizeBytes: number
    body: string | null
    contentType: string
  }
}

export interface ScriptOptions {
  script: string
  timeoutMs?: number
  context: ScriptContext
}

interface ReplyState {
  run: ScriptRun
}

export function runScript(opts: ScriptOptions): ScriptRun {
  const state: ReplyState = {
    run: {
      logs: [],
      tests: [],
      envSets: {},
      globalSets: {},
      collectionSets: {},
      durationMs: 0,
    },
  }

  const t0 = performance.now()
  const pm = createPm(opts, state.run)
  const sandbox = {
    pm,
    console: {
      log: (...a: unknown[]) => {
        state.run.logs.push({ ts: Date.now(), level: 'log', message: a.map(stringyValue).join(' ') })
      },
      warn: (...a: unknown[]) => {
        state.run.logs.push({ ts: Date.now(), level: 'warn', message: a.map(stringyValue).join(' ') })
      },
      error: (...a: unknown[]) => {
        state.run.logs.push({ ts: Date.now(), level: 'error', message: a.map(stringyValue).join(' ') })
      },
    },
  }

  try {
    const script = new vm.Script(opts.script, { filename: 'postmaster-script.js' })
    const context = vm.createContext(sandbox)
    script.runInContext(context, {
      timeout: opts.timeoutMs ?? 2500,
      displayErrors: true,
      breakOnSigint: true,
    })
  } catch (err) {
    const e = err as Error
    state.run.error = truncate(e.message, 500)
    state.run.logs.push({ ts: Date.now(), level: 'error', message: `Script error: ${truncate(e.message, 300)}` })
  }

  state.run.durationMs = Math.round(performance.now() - t0)
  return state.run
}

function createPm(opts: ScriptOptions, run: ScriptRun): unknown {
  const vars = opts.context.variables
  const isPost = opts.context.response !== undefined

  const variableApi = {
    get: (key: string) => findInstr(vars, key),
    set: (_key: string, _value: string) => {
      throw new Error('pm.variables.set is not available; use pm.environment.set or pm.globals.set')
    },
    toObject: () => lowerDeep({ ...vars.environment, ...vars.globals, ...vars.collection }),
  }
  const envApi = {
    get: (key: string) => findInstr(vars, key),
    set: (key: string, value: unknown) => {
      run.envSets[key] = String(value)
      return undefined
    },
    unset: (_key: string) => {
      throw new Error('pm.environment.unset is not available in this version')
    },
    toObject: () => lowerDeep(vars.environment),
  }
  const globalsApi = {
    get: (key: string) => findInstr(vars, key),
    set: (key: string, value: unknown) => {
      run.globalSets[key] = String(value)
      return undefined
    },
    toObject: () => lowerDeep(vars.globals),
  }
  const collectionApi = {
    get: (key: string) => findInstr(vars, key),
    set: (key: string, value: unknown) => {
      run.collectionSets[key] = String(value)
      return undefined
    },
    toObject: () => lowerDeep(vars.collection),
  }

  const pmRequest = {
    method: opts.context.request.method,
    url: opts.context.request.url,
    headers: opts.context.request.headers,
    body: opts.context.request.body,
    toObject: () => ({ ...opts.context.request }),
  }

  const respCtx = opts.context.response
  const pmResponse = respCtx
    ? {
        code: respCtx.code,
        status: respCtx.status,
        responseTime: respCtx.responseTime,
        size: { value: respCtx.sizeBytes, streamed: false },
        headers: respCtx.headers,
        body: respCtx.body,
        text: () => respCtx.body ?? '',
        json: () => {
          const t = respCtx.body
          if (!t) return null
          const parsed = JSON.parse(t) as unknown
          return parsed
        },
        contentType: () => respCtx.contentType.split(';')[0] ?? '',
      }
    : undefined

  return {
    request: pmRequest,
    response: pmResponse,
    variables: variableApi,
    environment: envApi,
    globals: globalsApi,
    collectionVariables: collectionApi,
    test: (name: string, fn: () => void) => {
      const startLen = run.tests.length
      run.tests.push({ name, passed: true })
      try {
        fn()
      } catch (err) {
        const e = err as Error
        const updated = run.tests[startLen]
        updated.passed = false
        updated.error = truncate(e.message, 300)
      }
    },
    expect: (actual: unknown) => createExpectation(actual),
    info: { isPost: isPost, eventName: isPost ? 'test' : 'prerequest' },
  }
}

interface ChainableExpectation {
  to: unknown
}

function createExpectation(actual: unknown): ChainableExpectation {
  const fail = (message: string): never => {
    throw new Error(message)
  }
  const ok = (): void => {}
  const show1 = (v: unknown): string => show(v)
  void show1
  const api = {
    to: {
      equal: (expected: unknown) =>
        actual === expected ? ok() : fail(`expected ${show(actual)} to equal ${show(expected)}`),
      eql: (expected: unknown) =>
        deepEqual(actual, expected) ? ok() : fail(`expected ${show(actual)} to deeply equal ${show(expected)}`),
      be: {
        a: (t: string) => (typeof actual === t ? ok() : fail(`expected ${show(actual)} to be a ${t}`)),
        above: (n: number) =>
          typeof actual === 'number' && actual > n ? ok() : fail(`expected ${show(actual)} to be above ${n}`),
        below: (n: number) =>
          typeof actual === 'number' && actual < n ? ok() : fail(`expected ${show(actual)} to be below ${n}`),
      },
      have: {
        property: (p: string) =>
          hasProperty(actual, p) ? ok() : fail(`expected object to have property "${p}"`),
      },
      include: (needle: unknown) =>
        includeMatch(actual, needle) ? ok() : fail(`expected ${show(actual)} to include ${show(needle)}`),
      match: (re: RegExp) =>
        re.test(String(actual)) ? ok() : fail(`expected ${show(actual)} to match ${String(re)}`),
    },
  }
  return api as ChainableExpectation
}

function hasProperty(o: unknown, prop: string): boolean {
  if (o === null || o === undefined || typeof o !== 'object') return false
  return Object.prototype.hasOwnProperty.call(o, prop)
}

function includeMatch(actual: unknown, needle: unknown): boolean {
  if (typeof actual === 'string' && typeof needle === 'string') return actual.includes(needle)
  if (Array.isArray(actual)) return actual.some((x) => deepEqual(x, needle))
  return deepEqual(actual, needle)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object)
    const kb = Object.keys(b as object)
    if (ka.length !== kb.length) return false
    for (const k of ka) {
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
    }
    return true
  }
  return String(a) === String(b)
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 3) + '...'
}

function findInstr(vars: ScriptContext['variables'], key: string): string | undefined {
  return vars.collection[key] ?? vars.environment[key] ?? vars.globals[key]
}

function lowerDeep(obj: Record<string, string>): Record<string, string> {
  return { ...obj }
}

function stringyValue(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

function show(v: unknown): string {
  const s = stringyValue(v)
  return s.length > 120 ? s.slice(0, 117) + '...' : s
}

