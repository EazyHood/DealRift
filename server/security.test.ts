import assert from 'node:assert/strict'
import test from 'node:test'
import { CONTENT_SECURITY_POLICY, isAllowedCorsOrigin, SECURITY_HEADERS } from './security.js'

test('CORS only accepts the development UI and explicit local overrides', () => {
  assert.equal(isAllowedCorsOrigin(undefined, ''), true)
  assert.equal(isAllowedCorsOrigin('http://localhost:5173', ''), true)
  assert.equal(isAllowedCorsOrigin('http://127.0.0.1:5173', ''), true)
  assert.equal(isAllowedCorsOrigin('https://deals.example.test', 'https://deals.example.test'), true)
  assert.equal(isAllowedCorsOrigin('https://malicious.example', ''), false)
  assert.equal(isAllowedCorsOrigin('http://localhost:9999', ''), false)
})

test('security headers lock scripts, framing, permissions, and referrers', () => {
  assert.match(CONTENT_SECURITY_POLICY, /script-src 'self'/)
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/)
  assert.equal(SECURITY_HEADERS['X-Frame-Options'], 'DENY')
  assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff')
  assert.equal(SECURITY_HEADERS['Referrer-Policy'], 'no-referrer')
})
