import assert from 'node:assert/strict'
import test from 'node:test'
import { startRadarServer } from './index.js'

test('local API serves security headers and does not authorize arbitrary origins', async () => {
  const { server, port } = await startRadarServer({ port: 0, host: '127.0.0.1' })

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Origin: 'https://malicious.example' },
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), null)
    assert.equal(response.headers.get('x-powered-by'), null)
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'/)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
})
