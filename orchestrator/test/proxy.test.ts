import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createProxy, outputTokensIn, vetRequest, type ProxyPolicy } from '../src/proxy.js'
import { signJobToken, verifyJobToken } from '../src/token.js'

const SECRET = 'x'.repeat(40)
const policy: ProxyPolicy = { models: ['claude-sonnet-5-5'], maxTokens: 1000, maxBodyBytes: 10_000, maxRequestsPerJob: 2, maxOutputTokensPerJob: 500 }
const future = () => Math.floor(Date.now() / 1000) + 600
const message = (extra: object = {}) => JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 100, messages: [], ...extra })

describe('job tokens', () => {
  it('round-trips and rejects tampering, expiry and other secrets', () => {
    const token = signJobToken(SECRET, 'abc', future())
    expect(verifyJobToken(SECRET, token)?.jobId).toBe('abc')
    expect(verifyJobToken(SECRET, token.replace('abc', 'abd'))).toBeNull()
    expect(verifyJobToken('y'.repeat(40), token)).toBeNull()
    expect(verifyJobToken(SECRET, signJobToken(SECRET, 'abc', 1))).toBeNull()
    expect(verifyJobToken(SECRET, 'sk-ant-whatever')).toBeNull()
  })
})

describe('vetRequest', () => {
  const vet = (body: string) => vetRequest(Buffer.from(body), policy)
  it('passes a plain request and caps max_tokens', () => {
    const verdict = vet(message({ max_tokens: 64_000, tools: [{ name: 'Write', input_schema: {} }] }))
    expect(verdict.ok && JSON.parse(verdict.body).max_tokens).toBe(1000)
  })
  it.each([
    ['other model', message({ model: 'claude-fable-5-1' })],
    ['server tool', message({ tools: [{ type: 'web_search_20250305', name: 'web_search' }] })],
    ['code execution tool', message({ tools: [{ type: 'code_execution_20250825', name: 'code_execution' }] })],
    ['mcp connector', message({ mcp_servers: [{ url: 'https://evil.example' }] })],
    ['non-JSON', 'hello'],
    ['array body', '[]'],
  ])('refuses %s', (_name, body) => expect(vet(body).ok).toBe(false))
})

describe('outputTokensIn', () => {
  it('reads streamed and plain responses', () => {
    const stream = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1}}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{},"usage":{"output_tokens":42}}\n'
    expect(outputTokensIn(stream)).toBe(42)
    expect(outputTokensIn('{"id":"x","usage":{"input_tokens":3,"output_tokens":7}}')).toBe(7)
    expect(outputTokensIn('nothing')).toBe(0)
  })
})

describe('proxy server', () => {
  let upstream: Server
  let proxy: Server
  let base: string
  const seen: { key: unknown; auth: unknown; cookie: unknown; path: string | undefined }[] = []

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      seen.push({ key: req.headers['x-api-key'], auth: req.headers.authorization, cookie: req.headers.cookie, path: req.url })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":300}}\n\n')
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    proxy = createProxy({ apiKey: 'REAL-KEY', signingSecret: SECRET, policy, upstream: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`, log: () => {} })
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`
  })
  afterAll(() => {
    upstream.close()
    proxy.close()
  })

  const post = (path: string, token: string, body = message()) =>
    fetch(base + path, { method: 'POST', headers: { 'x-api-key': token, 'content-type': 'application/json', cookie: 'a=b', authorization: 'Bearer nope' }, body })

  it('swaps the job token for the real key and forwards nothing else', async () => {
    const res = await post('/v1/messages?beta=true', signJobToken(SECRET, 'job-a', future()))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('message_delta')
    expect(seen.at(-1)).toEqual({ key: 'REAL-KEY', auth: undefined, cookie: undefined, path: '/v1/messages?beta=true' })
  })

  it('refuses bad tokens, other paths and oversized bodies without calling upstream', async () => {
    const before = seen.length
    const token = signJobToken(SECRET, 'job-b', future())
    expect((await post('/v1/messages', 'sk-ant-guess')).status).toBe(401)
    expect((await post('/v1/files', token)).status).toBe(404)
    expect((await post('/v1/messages/batches', token)).status).toBe(404)
    expect((await post('/v1/messages', token, message({ pad: 'x'.repeat(20_000) }))).status).toBe(413)
    expect((await post('/v1/messages', token, message({ model: 'other' }))).status).toBe(400)
    expect(seen.length).toBe(before)
  })

  it('stops a job once its output token budget is spent', async () => {
    const token = signJobToken(SECRET, 'job-c', future())
    expect((await post('/v1/messages', token)).status).toBe(200)
    expect((await post('/v1/messages', token)).status).toBe(200)
    const third = await post('/v1/messages', token)
    expect(third.status).toBe(400)
    expect(await third.text()).toContain('budget exhausted')
  })
})
