import assert from 'node:assert/strict'
import test from 'node:test'
import { isTrustedStoreUrl, storeSearchUrl, trustedStoreUrl } from './storeLinks.js'

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
