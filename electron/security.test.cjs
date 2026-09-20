const test = require('node:test')
const assert = require('node:assert/strict')
const { isInternalAppUrl, isTrustedExternalUrl } = require('./security.cjs')

test('external links only allow HTTPS destinations on supported store domains', () => {
  assert.equal(isTrustedExternalUrl('https://store.steampowered.com/app/570/'), true)
  assert.equal(isTrustedExternalUrl('https://store.epicgames.com/en-US/p/example'), true)
  assert.equal(isTrustedExternalUrl('https://www.eneba.com/store/all?text=example'), true)
  assert.equal(isTrustedExternalUrl('https://us.gamesplanet.com/search?query=example'), true)
})

test('external links reject redirects, unsafe protocols, credentials, and lookalike domains', () => {
  assert.equal(isTrustedExternalUrl('https://www.cheapshark.com/api/1.0/redirect?dealID=123'), false)
  assert.equal(isTrustedExternalUrl('http://store.steampowered.com/app/570/'), false)
  assert.equal(isTrustedExternalUrl('file:///C:/Windows/System32/calc.exe'), false)
  assert.equal(isTrustedExternalUrl('https://user:pass@www.gog.com/game/example'), false)
  assert.equal(isTrustedExternalUrl('https://steampowered.com.example.test/app/570/'), false)
})

test('CheapShark permits only its exact documented deal redirect', () => {
  assert.equal(isTrustedExternalUrl('https://www.cheapshark.com/redirect?dealID=abc%2Bdef%2F123%3D'), true)
  for (const url of [
    'https://cheapshark.com/redirect?dealID=abc',
    'https://www.cheapshark.com/redirect?dealID=abc&url=https://evil.test',
    'https://www.cheapshark.com/redirect?dealID=abc&dealID=def',
    'https://www.cheapshark.com/redirect?dealID=',
    'https://www.cheapshark.com/redirect?dealID=abc#redirect',
    'https://www.cheapshark.com:444/redirect?dealID=abc',
    'https://user@www.cheapshark.com/redirect?dealID=abc',
    'https://www.cheapshark.com/redirect?dealID=https%3A%2F%2Fevil.test',
  ]) assert.equal(isTrustedExternalUrl(url), false, url)
})

test('internal navigation is limited to the exact loopback origin', () => {
  assert.equal(isInternalAppUrl('http://127.0.0.1:43123/deals', 43123), true)
  assert.equal(isInternalAppUrl('http://localhost:43123/deals', 43123), false)
  assert.equal(isInternalAppUrl('http://127.0.0.1:43124/deals', 43123), false)
  assert.equal(isInternalAppUrl('https://127.0.0.1:43123/deals', 43123), false)
})
