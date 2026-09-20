import assert from 'node:assert/strict'
import test from 'node:test'
import { cheapSharkDealUrl, isTrustedStoreUrl, storeSearchUrl, trustedStoreUrl } from './storeLinks.js'

test('retailer search links are clean HTTPS destinations without aggregator redirects', () => {
  const stores = [
    'Steam',
    'Epic Games Store',
    'GOG',
    'Humble Store',
    'Fanatical',
    'GameBillet',
    'GreenManGaming',
    'GamersGate',
    'GamesPlanet',
    'IndieGala',
    'Ubisoft Store',
  ]

  for (const store of stores) {
    const url = storeSearchUrl(store, 'A Game & DLC', '123')
    assert.equal(isTrustedStoreUrl(url), true, `${store} generated an untrusted URL`)
    assert.doesNotMatch(url, /cheapshark\.com|redirect/i)
  }
})

test('upstream product links fall back when the destination is not trusted', () => {
  const fallback = 'https://www.gog.com/en/game/example'
  assert.equal(trustedStoreUrl('https://www.gog.com/en/game/example-deluxe', fallback), 'https://www.gog.com/en/game/example-deluxe')
  assert.equal(trustedStoreUrl('https://www.cheapshark.com/api/1.0/redirect?dealID=123', fallback), fallback)
  assert.equal(trustedStoreUrl('javascript:alert(1)', fallback), fallback)
})

test('store URL validation rejects HTTP, credentials, and lookalike hosts', () => {
  assert.equal(isTrustedStoreUrl('http://www.gog.com/game/example'), false)
  assert.equal(isTrustedStoreUrl('https://user:pass@www.gog.com/game/example'), false)
  assert.equal(isTrustedStoreUrl('https://gog.com.example.test/game/example'), false)
})

test('CheapShark links preserve the required redirect and normalize encoded provider IDs once', () => {
  const url = cheapSharkDealUrl('abc%2B123%2F%3D')
  assert.equal(url, 'https://www.cheapshark.com/redirect?dealID=abc%2B123%2F%3D')
  assert.equal(isTrustedStoreUrl(url), true)
  for (const value of [
    'https://cheapshark.com/redirect?dealID=a',
    'https://www.cheapshark.com/api/1.0/redirect?dealID=a',
    'https://www.cheapshark.com/redirect?dealID=a&url=https://example.com',
    'https://www.cheapshark.com/redirect?dealID=a&dealID=b',
    'https://www.cheapshark.com/redirect?dealID=',
    'https://www.cheapshark.com/redirect?dealID=a#fragment',
    'https://www.cheapshark.com:8443/redirect?dealID=a',
    'https://www.cheapshark.com/redirect?dealID=https%3A%2F%2Fevil.example',
    'https://www.cheapshark.com/redirect?dealID=a%252Fb',
  ]) assert.equal(isTrustedStoreUrl(value), false, value)
  assert.throws(() => cheapSharkDealUrl('https://evil.example'))
})
