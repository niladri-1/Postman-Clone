import { describe, expect, it, vi } from 'vitest'
import { runScript } from '../electron-main/scripts/scripts'

const ctx = {
  variables: { globals: { g1: 'G' }, environment: { e1: 'E' }, collection: { c1: 'C' } },
  request: { method: 'GET', url: 'https://x.io/', headers: { 'X-A': '1' } },
}

describe('runScript (sandbox)', () => {
  it('runs pm API: env/globals/collection writes', () => {
    const run = runScript({
      script: [
        "pm.environment.set('a', 'A');",
        "pm.globals.set('b', 'B');",
        "pm.collectionVariables.set('c', 'C');",
      ].join('\n'),
      timeoutMs: 1000,
      context: ctx,
    })
    expect(run.envSets).toEqual({ a: 'A' })
    expect(run.globalSets).toEqual({ b: 'B' })
    expect(run.collectionSets).toEqual({ c: 'C' })
    expect(run.error).toBeUndefined()
  })

  it('reads variables with precedence collection > env > globals', () => {
    const run = runScript({
      script: "console.log(pm.variables.get('g1'), pm.variables.get('e1'), pm.variables.get('c1'))",
      timeoutMs: 1000,
      context: ctx,
    })
    expect(run.logs[0].message).toContain('G E C')
  })

  it('captures console output and levels', () => {
    const run = runScript({
      script: "console.log('one'); console.warn('two'); console.error('three')",
      timeoutMs: 1000,
      context: ctx,
    })
    expect(run.logs.map((l) => l.level)).toEqual(['log', 'warn', 'error'])
    expect(run.logs.map((l) => l.message)).toEqual(['one', 'two', 'three'])
  })

  it('pm.test + assertions record pass/fail', () => {
    const run = runScript({
      script: [
        "pm.test('passing', () => pm.expect(2 + 2).to.equal(4));",
        "pm.test('failing', () => pm.expect(1).to.equal(2));",
        "pm.test('deep', () => pm.expect({a:[1]}).to.eql({a:[1]}));",
        "pm.expect('x').to.be.a('string');",
      ].join('\n'),
      timeoutMs: 1000,
      context: ctx,
    })
    expect(run.tests.map((t) => ({ n: t.name, p: t.passed }))).toEqual([
      { n: 'passing', p: true },
      { n: 'failing', p: false },
      { n: 'deep', p: true },
    ])
    expect(run.tests[1].error).toContain('to equal 2')
  })

  it('response access in post scripts', () => {
    const run = runScript({
      script: "pm.test('status', () => pm.expect(pm.response.code).to.equal(200)); pm.environment.set('type', pm.response.json().kind); console.log(typeof pm.response.body());",
      timeoutMs: 1000,
      context: {
        ...ctx,
        response: { code: 200, status: 'OK', responseTime: 42, headers: [{ key: 'c', value: 'd' }], sizeBytes: 10, body: '{"kind":"ping"}', contentType: 'application/json' },
      },
    })
    expect(run.tests[0].passed).toBe(true)
    expect(run.envSets).toEqual({ type: 'ping' })
  })

  it('syntax errors surface as run.error without throwing', () => {
    const run = runScript({ script: 'this is not javascript (', timeoutMs: 1000, context: ctx })
    expect(run.error).toBeTruthy()
    expect(run.error).toContain('Unexpected')
  })

  it('infinite loops are cut off by the vm timeout', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const run = runScript({ script: 'while (true) { }', timeoutMs: 250, context: ctx })
    expect(run.error).toBeTruthy()
    expect(run.error?.toLowerCase()).toContain('timed out')
    consoleSpy.mockRestore()
  })

  it('sandbox denies node globals', () => {
    const run = runScript({
      script: "let leaked = typeof require !== 'undefined' || typeof process !== 'undefined'; console.log(leaked)",
      timeoutMs: 1000,
      context: ctx,
    })
    expect(run.logs[0].message).toContain('false')
  })

  it('no pm.sendRequest (documented deferral)', () => {
    const run = runScript({
      script: 'console.log(typeof pm.sendRequest)',
      timeoutMs: 1000,
      context: ctx,
    })
    expect(run.logs[0].message).toBe('undefined')
  })
})
