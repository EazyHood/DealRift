import assert from 'node:assert/strict'
import test from 'node:test'
import type { Deal } from '../src/shared/dealTypes.js'
import { lowestWorldwideOffers, scanWorldwide, verifiedWorldwideOffer, worldwideIdentity } from './worldwide.js'

function offer(country = 'US', amount = 10, overrides: Partial<Deal> = {}): Deal {
  return { id: `steam-${country}-10`, title: 'Alpha Deluxe', source: 'Steam', sourceKind: 'official', ecosystem: 'pc', platform: 'PC / Steam', steamAppId: '10', image: '', url: `https://store.steampowered.com/app/10/?cc=${country.toLowerCase()}`, salePrice: { amount, currency: 'USD', formatted: `$${amount}`, usd: amount }, savingsPercent: 50, signalScore: 60, dealScore: 6, isFree: false, countries: [country], priceCountry: country, detectedAt: new Date().toISOString(), freshness: { updatedAt: new Date().toISOString(), stale: false }, availability: 'active', confidence: 'live-api', tags: [], notes: [], riskLevel: 'low', ...overrides }
}
const sourceStatus = [{ name: 'Store', ok: true, message: 'Verified', updatedAt: new Date().toISOString() }]

test('global minima use USD, keep native price and country URL, and do not filter full-price candidates first', () => {
  const us = offer('US', 10, { savingsPercent: 80 })
  const co = offer('CO', 12000, { salePrice: { amount: 12000, currency: 'COP', formatted: '$12.000', usd: 3 }, savingsPercent: 0 })
  const [winner] = lowestWorldwideOffers([us, co])
  assert.equal(winner.priceCountry, 'CO')
  assert.equal(winner.salePrice.amount, 12000)
  assert.equal(winner.salePrice.usd, 3)
  assert.match(winner.url, /cc=co$/)
  assert.equal(winner.savingsPercent, 0)
  assert.equal(lowestWorldwideOffers([us, co]).filter((deal) => deal.savingsPercent >= 50).length, 0)
})

test('unknown FX, foreign references, malformed times, expired and unverified prices cannot become minima', () => {
  const now = Date.now()
  const invalid = [
    offer('CO', 1000, { salePrice: { amount: 1000, currency: 'COP', formatted: '1000 COP' } }),
    offer('CO', 1000, { salePrice: { amount: 1000, currency: 'COP', formatted: '1000 COP', usd: NaN } }),
    offer('CO', 0, { isFree: false }), offer('CO', -1),
    offer('US', 1), offer('CO', 1, { confidence: 'fallback' }),
    offer('CO', 1, { freshness: { updatedAt: new Date().toISOString(), stale: true } }),
    offer('CO', 1, { startsAt: '2099-01-01T00:00:00Z' }), offer('CO', 1, { startsAt: 'invalid' }),
    offer('CO', 1, { expiresAt: '2000-01-01T00:00:00Z' }), offer('CO', 1, { expiresAt: 'invalid' }),
    offer('CO', 1, { tags: ['foreign-price'] }),
  ]
  for (const deal of invalid) assert.equal(verifiedWorldwideOffer(deal, 'CO', now), undefined)
  assert.equal(verifiedWorldwideOffer(offer('CO', 0, { isFree: true }), 'CO')?.salePrice.usd, 0)
  assert.equal(verifiedWorldwideOffer(offer('CO', 2, { salePrice: { amount: 2, currency: 'USD', formatted: '$2' } }), 'CO')?.salePrice.usd, 2)
})

test('identities preserve editions, console licence compatibility and independent storefront products', () => {
  const pc = offer()
  assert.notEqual(worldwideIdentity(pc), worldwideIdentity(offer('CO', 1, { title: 'Alpha Standard' })))
  assert.notEqual(worldwideIdentity(pc), worldwideIdentity(offer('CO', 1, { source: 'GOG', steamAppId: undefined, storeProductId: '123' })))
  const ps = offer('US', 12, { ecosystem: 'playstation', source: 'PlayStation Store', steamAppId: undefined, storeProductId: 'US-ID', platform: 'PS5 / PS4' })
  const psRegion = { ...ps, storeProductId: 'EU-ID', platform: 'PS4 / PS5' }
  assert.equal(worldwideIdentity(ps), worldwideIdentity(psRegion))
  assert.notEqual(worldwideIdentity(ps), worldwideIdentity({ ...ps, platform: 'PS5' }))
  assert.notEqual(worldwideIdentity(ps), worldwideIdentity({ ...ps, title: 'Alpha Deluxe Complete Edition' }))
  const xbox = { ...ps, ecosystem: 'xbox' as const, source: 'Xbox', storeProductId: 'ABC123ABC123', platform: 'Xbox One / Xbox Series X|S' }
  assert.equal(worldwideIdentity(xbox), worldwideIdentity({ ...xbox, title: 'Localized product title' }))
  assert.notEqual(worldwideIdentity(xbox), worldwideIdentity({ ...xbox, storeProductId: 'DEF456DEF456' }))
  assert.notEqual(worldwideIdentity(ps), worldwideIdentity(xbox))
})

test('PlayStation joins localized titles by product ID and matching regional editions by full title', () => {
  const ps = offer('US', 12, { ecosystem: 'playstation', source: 'PlayStation Store', steamAppId: undefined, storeProductId: 'EP-SAME', platform: 'PS5', title: 'Hades II' })
  const translated = offer('KR', 8, { ...ps, id: 'ps-kr', priceCountry: 'KR', countries: ['KR'], title: 'Hades II 한국어', salePrice: { amount: 8, currency: 'USD', usd: 8, formatted: '$8' } })
  const regional = offer('TR', 5, { ...ps, id: 'ps-tr', storeProductId: 'UP-DIFFERENT', priceCountry: 'TR', countries: ['TR'], salePrice: { amount: 5, currency: 'USD', usd: 5, formatted: '$5' } })
  const edition = offer('US', 4, { ...ps, storeProductId: 'EP-DELUXE', title: 'Hades II Deluxe', salePrice: { amount: 4, currency: 'USD', usd: 4, formatted: '$4' } })
  const winners = lowestWorldwideOffers([ps, translated, regional, edition])
  assert.equal(winners.length, 2)
  assert.equal(winners.find((deal) => deal.title === 'Hades II')?.priceCountry, 'TR')
  assert.ok(winners.some((deal) => deal.title === 'Hades II Deluxe'))
})

test('bounded country scans report unsupported, failed and partial coverage without discarding valid prices', async () => {
  let active = 0, maximum = 0
  const result = await scanWorldwide({ countries: ['US', 'CO', 'GB', 'VN', 'DE', 'TR'], supportedCountries: ['US', 'CO', 'GB', 'DE', 'TR'], scope: 'catalog-search', concurrency: 2,
    loadCountry: async (country) => {
      active += 1; maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 3)); active -= 1
      if (country === 'TR') throw new Error('Store unavailable')
      return { deals: [offer(country, country === 'CO' ? 3 : 10)], sourceStatus: country === 'DE' ? [...sourceStatus, { ...sourceStatus[0], name: 'FX', ok: false }] : sourceStatus }
    },
  })
  assert.equal(maximum, 2)
  assert.deepEqual(result.worldwide.checkedCountries, ['US', 'CO', 'GB', 'DE'])
  assert.deepEqual(result.worldwide.failedCountries, ['DE', 'TR'])
  assert.deepEqual(result.worldwide.unsupportedCountries, ['VN'])
  assert.equal(result.worldwide.partial, true)
  assert.equal(result.deals[0].priceCountry, 'CO')
})

test('exact rechecks supersede discovery quotes and find full-price products absent from a country deals feed', async () => {
  const result = await scanWorldwide({ countries: ['US', 'CO'], scope: 'catalog-sample',
    loadCountry: async (country) => ({ deals: country === 'US' ? [offer('US', 2)] : [], sourceStatus }),
    refineCountry: async (country, candidates) => {
      assert.equal(candidates.length, 1)
      return { deals: [offer(country, country === 'US' ? 10 : 3, { savingsPercent: 0 })], sourceStatus }
    },
  })
  assert.equal(result.deals[0].priceCountry, 'CO')
  assert.equal(result.deals[0].salePrice.usd, 3)
})

test('exact unavailability removes discovery quotes, but failed rechecks preserve independently verified evidence', async () => {
  const result = await scanWorldwide({ countries: ['US', 'CO', 'GB'], scope: 'catalog-sample',
    loadCountry: async (country) => ({ deals: [offer(country, country === 'US' ? 1 : country === 'CO' ? 3 : 8)], sourceStatus }),
    refineCountry: async (country) => {
      if (country === 'CO') throw new Error('Temporary network failure')
      return { deals: country === 'US' ? [] : [offer(country, 8)], sourceStatus, recheckedProducts: [{ source: 'Steam', steamAppId: '10' }] }
    },
  })
  assert.equal(result.deals[0].priceCountry, 'CO')
  assert.equal(result.deals[0].salePrice.usd, 3)
  assert.deepEqual(result.worldwide.failedCountries, ['CO'])
})

test('an aggregate deadline returns honest partial results and cancels in-flight country work', async () => {
  const keepAlive = setTimeout(() => undefined, 1000)
  let cancelled = false
  try {
    const result = await scanWorldwide({ countries: ['US', 'CO', 'GB'], scope: 'catalog-sample', timeoutMs: 20, concurrency: 1,
      loadCountry: async (country, signal) => {
        if (country === 'US') return { deals: [offer()], sourceStatus }
        return new Promise((_, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(signal.reason) }, { once: true }))
      },
    })
    assert.equal(cancelled, true)
    assert.equal(result.deals.length, 1)
    assert.deepEqual(result.worldwide.failedCountries, ['CO', 'GB'])
    assert.equal(result.worldwide.partial, true)
  } finally { clearTimeout(keepAlive) }
})
