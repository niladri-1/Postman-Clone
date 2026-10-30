import { describe, expect, it } from 'vitest'
import { importPostmanCollection, importOpenApi, importEnvironment, exportPostmanCollection, exportEnvironment } from '../shared/transfer'

const POSTMAN_V21 = JSON.stringify({
  info: { name: 'My API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    {
      name: 'Users',
      item: [
        {
          name: 'List users',
          request: {
            method: 'GET',
            url: { raw: 'https://api.io/users?page=1', host: ['api', 'io'], path: ['users'], query: [{ key: 'page', value: '1' }] },
            header: [{ key: 'Authorization', value: 'Bearer xyz', disabled: false }],
            auth: { type: 'bearer', bearer: [{ token: 'abc' }] },
          },
        },
      ],
    },
    {
      name: 'Create user',
      request: {
        method: 'POST',
        url: 'https://api.io/users',
        body: { mode: 'raw', raw: '{"name":"Ann"}', options: { raw: { language: 'json' } } },
      },
    },
  ],
})

describe('importPostmanCollection', () => {
  it('maps folders, requests, auth and bodies', () => {
    const col = importPostmanCollection(POSTMAN_V21)
    expect(col.name).toBe('My API')
    expect(col.items).toHaveLength(2)

    const folder = col.items[0]
    expect(folder.kind).toBe('folder')
    expect(folder.name).toBe('Users')

    const req = (folder as { items: { kind: string; name: string; request: { method: string; url: string; headers: { key: string; enabled: boolean }[]; auth: { type: string; token?: string } } }[] }).items[0]
    expect(req.name).toBe('List users')
    expect(req.request.method).toBe('GET')
    expect(req.request.url).toBe('https://api.io/users?page=1')
    expect(req.request.headers[0].enabled).toBe(true)
    expect(req.request.auth.type).toBe('bearer')
    expect(req.request.auth.token).toBe('abc')

    const post = col.items[1] as { request: { body: { type: string; json: string } } }
    expect(post.request.body.type).toBe('json')
    expect(post.request.body.json).toBe('{"name":"Ann"}')
  })

  it('throws on non-collection json', () => {
    expect(() => importPostmanCollection('{"openapi":"3"}')).toThrow()
  })
})

describe('importOpenApi', () => {
  it('builds folders by path segment and templates variables', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Pets' },
      servers: [{ url: 'https://pet.io/v1' }],
      paths: {
        '/users/{id}': {
          get: { operationId: 'getU', parameters: [{ name: 'verbose', in: 'query', example: 'true' }] },
          delete: { summary: 'Remove user' },
        },
      },
    })
    const col = importOpenApi(spec)
    expect(col.name).toBe('Pets')
    const folder = col.items[0] as { name: string; items: { name: string; request: { method: string; url: string } }[] }
    expect(folder.name).toBe('/users')
    expect(folder.items.map((i) => i.request.method).sort()).toEqual(['DELETE', 'GET'])
    const get = folder.items.find((i) => i.request.method === 'GET')!
    expect(get.request.url).toBe('https://pet.io/v1/users/{{id}}')
  })

  it('throws without paths', () => {
    expect(() => importOpenApi('{"openapi":"3"}')).toThrow(/paths/)
  })
})

describe('importEnvironment / exportEnvironment roundtrip', () => {
  it('preserves keys, values and secrets', () => {
    const src = JSON.stringify({
      name: 'Prod',
      values: [
        { key: 'host', value: 'a.io' },
        { key: 'pw', value: 'hunter2', secret: true },
      ],
    })
    const env = importEnvironment(src)
    expect(env.name).toBe('Prod')
    expect(env.variables[1].secret).toBe(true)

    const out = JSON.parse(exportEnvironment(env)) as { values: { key: string; secret?: boolean }[] }
    expect(out.values[1].key).toBe('pw')
    expect(out.values[1].secret).toBe(true)
  })

  it('throws on invalid env file', () => {
    expect(() => importEnvironment('{"name":1}')).toThrow()
  })
})

describe('exportPostmanCollection', () => {
  it('emits valid v2.1 shape re-importable', () => {
    const col = importPostmanCollection(POSTMAN_V21)
    const exported = exportPostmanCollection(col)
    const again = importPostmanCollection(exported)
    expect(again.name).toBe('My API')
    expect(again.items.length).toBe(2)
    const first = again.items[0] as { items: unknown[] }
    expect(first.items.length).toBe(1)
  })
})
