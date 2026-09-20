import test from 'node:test'
import assert from 'node:assert/strict'
import type { Deal } from '../shared/dealTypes'
import type { LibraryGame } from '../shared/libraryTypes'
import { buildPurchasePlan, editionFamily, offerExclusion, parseMoney } from './planner'

const now = Date.parse('2026-09-20T12:00:00Z')
function offer(id: string, amount: number, extra: Partial<Deal> = {}): Deal {
  return { id, title: id, source: 'Steam', sourceKind: 'official', platform: 'Steam', image: '', url: 'https://store.steampowered.com/app/620/', salePrice: { amount, currency: 'USD', usd: amount, formatted: `$${amount}` }, savingsPercent: 50, signalScore: 80, dealScore: 80, detectedAt: new Date(now).toISOString(), isFree: amount === 0, countries: ['US'], riskLevel: 'low', confidence: 'live-api', tags: [], notes: [], ...extra }
}
const game = (id: string, priority: 1 | 2 | 3 = 2, owned = false): LibraryGame => ({ id, title: id, owned, watched: true, priority, notes: '', updatedAt: new Date(now).toISOString() })

test('money accepts decimal commas and zero, rejects ambiguous grouping, negatives and exponent notation', () => {
  assert.equal(parseMoney('12,35'), 12.35)
  assert.equal(parseMoney('0'), 0)
  assert.equal(parseMoney('150000'), 150000)
  for (const input of ['1,500.00', '1.500,00', '1,500', '-1', '1e3', 'Infinity', '', '0x10']) assert.equal(parseMoney(input), undefined, input)
})
test('budget uses priority then price deterministically without floating-point overspend', () => {
  const games = [game('a', 1), game('b', 1), game('c', 2), game('owned', 1, true)]
  const deals = [offer('a', .2), offer('b', .1), offer('c', .1), offer('owned', 0)]
  const result = buildPurchasePlan(games, deals, .3, 'USD', 'US', now)
  assert.deepEqual(result.items.map((item) => item.game.id), ['b', 'a'])
  assert.equal(result.total, .3)
  assert.equal(result.remaining, 0)
  assert.deepEqual(buildPurchasePlan([...games].reverse(), [...deals].reverse(), .3, 'USD', 'US', now).items.map((item) => item.game.id), ['b', 'a'])
  assert.equal(result.excluded.find((item) => item.game.id === 'owned')?.reason, 'owned')
})
test('excludes stale source metadata, future/free, expired and foreign prices even with Global availability', () => {
  assert.equal(offerExclusion(offer('a', 1, { freshness: { updatedAt: new Date(now - 31 * 60000).toISOString(), stale: false } }), 'US', 'USD', now), 'stale')
  assert.equal(offerExclusion(offer('a', 1, { freshness: { updatedAt: new Date(now).toISOString(), stale: true } }), 'US', 'USD', now), 'stale')
  assert.equal(offerExclusion(offer('a', 0, { availability: 'upcoming' }), 'US', 'USD', now), 'upcoming')
  assert.equal(offerExclusion(offer('a', 1, { availability: 'expired' }), 'US', 'USD', now), 'expired')
  assert.equal(offerExclusion(offer('a', 1, { countries: ['US', 'Global'], priceCountry: 'US' }), 'CO', 'USD', now), 'country')
  assert.equal(offerExclusion(offer('a', 1, { confidence: 'fallback' }), 'US', 'USD', now), 'risk')
})
test('does not reinterpret USD as COP and chooses the cheapest valid offer for one edition', () => {
  const a = offer('a', 10)
  const cheaper = offer('alternate', 8, { title: 'a', source: 'GOG' })
  const edition = offer('a-deluxe', 1)
  assert.equal(buildPurchasePlan([game('a')], [a], 50000, 'COP', 'US', now).items.length, 0)
  assert.equal(buildPurchasePlan([game('a')], [a, cheaper, edition], 9, 'USD', 'US', now).items[0].deal.id, 'alternate')
})
test('stored fresh snapshot survives empty radar but restored fallback snapshot is ineligible', () => {
  const saved = { ...game('a'), snapshot: offer('a', 2) }
  assert.equal(buildPurchasePlan([saved], [], 3, 'USD', 'US', now).items.length, 1)
  assert.equal(buildPurchasePlan([{ ...saved, snapshot: { ...saved.snapshot, confidence: 'fallback' } }], [], 3, 'USD', 'US', now).items.length, 0)
  assert.equal(buildPurchasePlan([saved], [offer('a', 2, { freshness: { stale: true, updatedAt: new Date(now - 3600000).toISOString() } })], 3, 'USD', 'US', now).items.length, 1)
})
test('edition family only suggests variants and preserves numbered sequels', () => {
  assert.equal(editionFamily('Hades II — Deluxe Edition'), editionFamily('Hades II'))
  assert.notEqual(editionFamily('Hades II'), editionFamily('Hades'))
})
