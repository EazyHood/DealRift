import test from 'node:test'
import assert from 'node:assert/strict'
import type { Deal, RadarResponse } from '../shared/dealTypes'
import { nativePriceLabel, radarOfferExclusion, worldwidePriceLabel, worldwideUsd } from './priceScope'
import { offerExclusion } from './planner'
import { fetchRadar, radarMatchesRequest, type RadarParams } from './radarApi'

const now = Date.parse('2026-09-22T12:00:00Z')
const quote: Deal = { id: 'steam-620-IN', title: 'Portal 2', source: 'Steam', sourceKind: 'official', platform: 'Steam', image: '', url: 'https://store.steampowered.com/app/620/?cc=in', salePrice: { amount: 59, currency: 'INR', usd: .71, formatted: '₹59' }, savingsPercent: 90, signalScore: 80, dealScore: 80, detectedAt: new Date(now).toISOString(), isFree: false, countries: ['IN'], priceCountry: 'IN', riskLevel: 'low', confidence: 'live-api', tags: ['foreign-price'], notes: [] }
const params: RadarParams = { priceScope: 'worldwide', country: 'CO', ecosystem: 'pc', locale: 'es-ES', limit: 120, minSavings: 35, regionSample: 5 }
const response: RadarResponse = { priceScope: 'worldwide', country: 'CO', ecosystem: 'pc', locale: 'es-ES', updatedAt: new Date(now).toISOString(), refreshSeconds: 300, deals: [quote], stores: [], regionalScans: [], marketScouts: [], metrics: { totalDeals: 1, freebies: 0, maxSavings: 90, officialDeals: 1, regionalOpportunities: 0, averageSavings: 90 }, sourceStatus: [] }

test('worldwide ranking can use the actual quote country without relaxing base-country personal eligibility', () => {
  const before = structuredClone(quote)
  assert.equal(radarOfferExclusion(quote, 'CO', 'worldwide', now), undefined)
  assert.equal(radarOfferExclusion(quote, 'CO', 'country', now), 'country')
  assert.equal(offerExclusion(quote, 'CO', 'USD', now), 'country')
  assert.deepEqual(quote, before)
})
test('worldwide comparison still excludes stale, future, unknown-country and unverified quotes', () => {
  assert.equal(radarOfferExclusion({ ...quote, freshness: { updatedAt: quote.detectedAt, stale: true } }, 'CO', 'worldwide', now), 'stale')
  assert.equal(radarOfferExclusion({ ...quote, availability: 'upcoming' }, 'CO', 'worldwide', now), 'upcoming')
  assert.equal(radarOfferExclusion({ ...quote, priceCountry: undefined }, 'CO', 'worldwide', now), 'country')
  assert.equal(radarOfferExclusion({ ...quote, confidence: 'fallback' }, 'CO', 'worldwide', now), 'risk')
})
test('USD presentation never interprets a native INR amount as dollars', () => {
  assert.equal(worldwidePriceLabel(quote), '$0.71 USD')
  assert.equal(worldwideUsd({ ...quote, salePrice: { ...quote.salePrice, usd: undefined } }), undefined)
  assert.equal(worldwidePriceLabel({ ...quote, salePrice: { amount: 2.5, currency: 'USD', formatted: '$2.50' } }), '$2.50 USD')
})
test('native prices keep one explicit currency code for localized store labels', () => {
  for (const [formatted, currency, expected] of [['359,00 ARS', 'ARS', '359,00 ARS'], ['INR 1309,00', 'INR', 'INR 1309,00'], ['$2.50', 'USD', '$2.50 USD'], ['₹59', 'INR', '₹59 INR']]) {
    assert.equal(nativePriceLabel({ ...quote, salePrice: { ...quote.salePrice, formatted, currency } }), expected)
  }
})
test('response guard isolates price modes, country and ecosystem', () => {
  assert.equal(radarMatchesRequest(response, params), true)
  assert.equal(radarMatchesRequest({ ...response, priceScope: 'country' }, params), false)
  assert.equal(radarMatchesRequest({ ...response, country: 'US' }, params), false)
  assert.equal(radarMatchesRequest({ ...response, ecosystem: 'xbox' }, params), false)
  assert.equal(radarMatchesRequest({ ...response, priceScope: undefined }, { ...params, priceScope: 'country' }), true)
})
test('radar request sends mode and retained base country, passes cancellation, and rejects the wrong mode', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  let requestUrl = ''
  let requestSignal: AbortSignal | null | undefined
  try {
    globalThis.fetch = async (input, init) => { requestUrl = String(input); requestSignal = init?.signal; return Response.json(response) }
    await fetchRadar(params, controller.signal)
    const query = new URL(requestUrl, 'http://localhost').searchParams
    assert.equal(query.get('priceScope'), 'worldwide')
    assert.equal(query.get('country'), 'CO')
    assert.equal(requestSignal, controller.signal)
    globalThis.fetch = async () => Response.json({ ...response, priceScope: 'country' })
    await assert.rejects(fetchRadar(params), /different country, platform or price scope/)
  } finally { globalThis.fetch = originalFetch }
})
