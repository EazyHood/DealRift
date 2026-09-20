import assert from 'node:assert/strict'
import test from 'node:test'
import type { Deal } from '../src/shared/dealTypes.js'
import {
  canonicalGameKey,
  emptyPriceHistory,
  enrichDealsWithIntelligence,
  priceHistoryKey,
  recordPriceObservations,
  type DealPriceHistoryDatabase,
} from './intelligence.js'

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: 'deal-1',
    title: 'Alpha Game',
    source: 'Steam',
    sourceKind: 'official',
    platform: 'PC / Steam',
    image: '',
    url: 'https://store.steampowered.com/app/1/',
    salePrice: { amount: 20, currency: 'USD', formatted: '$20.00', usd: 20 },
    normalPrice: { amount: 40, currency: 'USD', formatted: '$40.00', usd: 40 },
    savingsPercent: 50,
    dealScore: 8,
    signalScore: 80,
    steamRatingPercent: 90,
    detectedAt: '2026-01-02T00:00:00.000Z',
    isFree: false,
    countries: ['US'],
    riskLevel: 'low',
    confidence: 'live-api',
    tags: ['official', 'direct-store-link'],
    notes: [],
    ...overrides,
  }
}

test('canonicalGameKey normalizes punctuation and accents without merging editions', () => {
  assert.equal(canonicalGameKey('Futbol: Edicion 2026!'), 'futbol-edicion-2026')
  assert.notEqual(canonicalGameKey('Alpha Game'), canonicalGameKey('Alpha Game Deluxe'))
})

test('price observations are throttled unless the best price changes', () => {
  const first = recordPriceObservations(emptyPriceHistory(), [makeDeal()], 'US', '2026-01-01T00:00:00.000Z')
  const unchanged = recordPriceObservations(first, [makeDeal()], 'US', '2026-01-01T01:00:00.000Z')
  const changed = recordPriceObservations(
    unchanged,
    [makeDeal({ salePrice: { amount: 18, currency: 'USD', formatted: '$18.00', usd: 18 } })],
    'US',
    '2026-01-01T02:00:00.000Z',
  )
  const key = priceHistoryKey('US', 'Alpha Game')

  assert.equal(first.games[key].observations.length, 1)
  assert.equal(unchanged.games[key].observations.length, 1)
  assert.equal(changed.games[key].observations.length, 2)
})

test('intelligence recognizes an observed low and the best current market offer', () => {
  const key = priceHistoryKey('US', 'Alpha Game')
  const history: DealPriceHistoryDatabase = {
    version: 1,
    games: {
      [key]: {
        title: 'Alpha Game',
        country: 'US',
        observations: [
          { at: '2026-01-01T00:00:00.000Z', bestPaidUsd: 25, bestStore: 'Steam', free: false, offerCount: 2 },
          { at: '2026-01-01T06:00:00.000Z', bestPaidUsd: 22, bestStore: 'Steam', free: false, offerCount: 2 },
          { at: '2026-01-01T13:00:00.000Z', bestPaidUsd: 20, bestStore: 'Steam', free: false, offerCount: 2 },
        ],
      },
    },
  }
  const best = makeDeal()
  const alternative = makeDeal({
    id: 'deal-2',
    source: 'GOG',
    url: 'https://www.gog.com/game/alpha_game',
    salePrice: { amount: 28, currency: 'USD', formatted: '$28.00', usd: 28 },
  })
  const enriched = enrichDealsWithIntelligence([best, alternative], 'US', history, new Date('2026-01-02T00:00:00.000Z').getTime())

  assert.equal(enriched[0].intelligence?.history.isObservedLow, true)
  assert.equal(enriched[0].intelligence?.market.rank, 1)
  assert.equal(enriched[0].intelligence?.market.savingsVsNextUsd, 8)
  assert.ok((enriched[0].intelligence?.score ?? 0) > (enriched[1].intelligence?.score ?? 0))
  assert.ok(enriched[0].intelligence?.reasons.some((reason) => reason.code === 'observed-low'))
})

test('a trusted giveaway is exceptional while a risky search offer is held back', () => {
  const giveaway = makeDeal({
    id: 'free',
    title: 'Free Game',
    source: 'Epic Games Store',
    sourceKind: 'freebie',
    salePrice: { amount: 0, currency: 'USD', formatted: 'Free', usd: 0 },
    normalPrice: { amount: 30, currency: 'USD', formatted: '$30.00', usd: 30 },
    savingsPercent: 100,
    isFree: true,
  })
  const risky = makeDeal({
    id: 'risky',
    title: 'Risky Game',
    source: 'Marketplace',
    sourceKind: 'marketplace',
    riskLevel: 'high',
    confidence: 'search-link',
    tags: ['store-search-link'],
    salePrice: { amount: 1, currency: 'USD', formatted: '$1.00', usd: 1 },
    normalPrice: { amount: 60, currency: 'USD', formatted: '$60.00', usd: 60 },
    savingsPercent: 98,
  })
  const enriched = enrichDealsWithIntelligence([giveaway, risky], 'US', emptyPriceHistory())

  assert.equal(enriched[0].intelligence?.verdict, 'exceptional')
  assert.equal(enriched[1].intelligence?.verdict, 'wait')
  assert.ok((enriched[0].intelligence?.score ?? 0) > (enriched[1].intelligence?.score ?? 0))
})

test('regional intelligence only rewards a country price that beats the current offer', () => {
  const expensiveRegion = makeDeal({
    bestRegion: {
      countryCode: 'AR',
      countryName: 'Argentina',
      currency: 'USD',
      final: 30,
      initial: 60,
      finalFormatted: '$30.00',
      discountPercent: 50,
      usd: 30,
      relativeToBaselinePercent: -50,
      storeUrl: 'https://store.steampowered.com/app/1/',
      available: true,
    },
  })
  const cheaperRegion = makeDeal({
    id: 'cheaper-region',
    title: 'Beta Game',
    bestRegion: {
      ...expensiveRegion.bestRegion!,
      final: 15,
      finalFormatted: '$15.00',
      usd: 15,
    },
  })
  const [withoutReward, withReward] = enrichDealsWithIntelligence([expensiveRegion, cheaperRegion], 'US', emptyPriceHistory())

  assert.equal(withoutReward.intelligence?.reasons.some((reason) => reason.code === 'regional-advantage'), false)
  assert.equal(withReward.intelligence?.reasons.some((reason) => reason.code === 'regional-advantage'), true)
})

test('future, expired, stale and foreign prices do not affect rankings or observed history', () => {
  const time = Date.parse('2026-01-02T00:00:00.000Z')
  const current = makeDeal()
  const unavailable = [
    makeDeal({ id: 'upcoming', isFree: true, salePrice: { amount: 0, currency: 'USD', formatted: 'Free', usd: 0 }, startsAt: '2026-01-03T00:00:00Z' }),
    makeDeal({ id: 'expired', expiresAt: '2026-01-01T00:00:00Z' }),
    makeDeal({ id: 'stale', freshness: { updatedAt: '2026-01-01T00:00:00Z', stale: true, error: 'offline' } }),
    makeDeal({ id: 'foreign', countries: ['CO'], priceCountry: 'CO' }),
  ]
  const enriched = enrichDealsWithIntelligence([current, ...unavailable], 'US', emptyPriceHistory(), time)
  assert.equal(enriched[0].intelligence?.market.offerCount, 1)
  for (const deal of enriched.slice(1)) {
    assert.equal(deal.intelligence?.score, 0)
    assert.equal(deal.intelligence?.verdict, 'wait')
    assert.equal(deal.intelligence?.market.offerCount, 0)
  }
  const history = recordPriceObservations(emptyPriceHistory(), [current, ...unavailable], 'US', new Date(time).toISOString())
  const point = history.games['US:alpha-game'].observations[0]
  assert.equal(point.free, false)
  assert.equal(point.offerCount, 1)
  assert.equal(point.bestPaidUsd, 20)
})
