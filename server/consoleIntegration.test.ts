import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { Deal, GameEcosystem, RadarResponse } from '../src/shared/dealTypes.js'
import { gameIdentity, libraryMatchesDeal } from '../src/shared/gameIdentity.js'
import type { LibraryGame } from '../src/shared/libraryTypes.js'
import { emptyPriceHistory, enrichDealsWithIntelligence, priceHistoryKey, recordPriceObservations } from './intelligence.js'
import { createLibraryService, type LibraryRadarParams } from './library.js'

function deal(ecosystem: GameEcosystem, overrides: Partial<Deal> = {}): Deal {
  const id = ecosystem === 'xbox' ? '9P8DL6W0JBB8' : ecosystem === 'playstation' ? 'UP2125-CUSA27973_00-0000000000000000' : undefined
  return {
    id: `${ecosystem}-hades`, title: 'Hades', ecosystem, storeProductId: id,
    source: ecosystem === 'xbox' ? 'Xbox' : ecosystem === 'playstation' ? 'PlayStation' : 'Steam', sourceKind: 'official',
    platform: ecosystem === 'xbox' ? 'Xbox One · Xbox Series X|S' : ecosystem === 'playstation' ? 'PS4 / PS5' : 'PC',
    image: '', url: ecosystem === 'xbox' ? `https://www.xbox.com/es-co/games/store/hades/${id}` : ecosystem === 'playstation' ? `https://store.playstation.com/es-co/product/${id}` : 'https://store.steampowered.com/app/1145360/',
    salePrice: { amount: 40_000, currency: 'COP', formatted: '$40.000', usd: 10 },
    normalPrice: { amount: 80_000, currency: 'COP', formatted: '$80.000', usd: 20 },
    savingsPercent: 50, dealScore: 5, signalScore: 60, detectedAt: new Date().toISOString(),
    isFree: false, countries: ['CO'], priceCountry: 'CO', riskLevel: 'low', confidence: 'live-api',
    availability: 'active', tags: [], notes: [], ...overrides,
  }
}
function game(snapshot: Deal, overrides: Partial<LibraryGame> = {}): LibraryGame {
  return { id: gameIdentity(snapshot), title: snapshot.title, ecosystem: snapshot.ecosystem, storeProductId: snapshot.storeProductId, snapshot, owned: false, watched: true, priority: 2, notes: '', updatedAt: new Date().toISOString(), ...overrides }
}
function radar(deals: Deal[]): RadarResponse {
  return { updatedAt: new Date().toISOString(), refreshSeconds: 300, country: 'CO', locale: 'es-CO', deals, stores: [], regionalScans: [], marketScouts: [], metrics: { totalDeals: deals.length, freebies: 0, maxSavings: 50, officialDeals: deals.length, regionalOpportunities: 0, averageSavings: 50 }, sourceStatus: [] }
}
async function fixture(run: (directory: string) => Promise<void>) {
  const root = path.resolve(os.tmpdir())
  const directory = await mkdtemp(path.join(root, 'dealrift-console-'))
  try { await run(directory) }
  finally {
    assert.ok(path.resolve(directory).startsWith(`${root}${path.sep}`))
    await rm(directory, { recursive: true, force: true })
  }
}

test('same title on PC, PlayStation and Xbox has independent library and edition identity', () => {
  const pc = deal('pc')
  const ps = deal('playstation')
  const xbox = deal('xbox')
  assert.equal(new Set([pc, ps, xbox].map(gameIdentity)).size, 3)
  assert.equal(gameIdentity({ title: 'Hades' }), gameIdentity(pc), 'legacy PC IDs remain stable')
  assert.notEqual(gameIdentity(xbox), gameIdentity({ ...xbox, storeProductId: '9PCR3Z2MSM4T' }))
  assert.equal(gameIdentity(ps), gameIdentity({ ...ps, title: 'Título traducido' }), 'store ID survives localization')
  assert.equal(libraryMatchesDeal(game(xbox), pc), false)
  assert.equal(libraryMatchesDeal(game(xbox), ps), false)
  assert.equal(libraryMatchesDeal(game(xbox), { ...xbox, storeProductId: '9PCR3Z2MSM4T' }), false)
  assert.equal(libraryMatchesDeal(game(xbox), { ...xbox, title: 'Hades®', storeProductId: xbox.storeProductId!.toLowerCase() }), true)
  assert.notEqual(gameIdentity({ title: '日本のゲーム', ecosystem: 'xbox' }), gameIdentity({ title: '別のゲーム', ecosystem: 'xbox' }))
  assert.equal(libraryMatchesDeal({ title: '日本のゲーム', ecosystem: 'xbox' }, { ...xbox, title: '別のゲーム' }), false)
  assert.equal(libraryMatchesDeal({ title: '日本のゲーム', ecosystem: 'xbox' }, { ...xbox, title: '日本のゲーム' }), true)
})

test('history and market comparisons never use another console license as a cheaper offer', () => {
  const offers = [
    deal('pc', { salePrice: { amount: 4000, currency: 'COP', formatted: '$4.000', usd: 1 } }),
    deal('playstation', { salePrice: { amount: 20, currency: 'USD', formatted: '$20', usd: 20 } }),
    deal('xbox', { salePrice: { amount: 100_000, currency: 'COP', formatted: '$100.000', usd: 25 } }),
    deal('xbox', { id: 'xbox-second-edition', storeProductId: '9PCR3Z2MSM4T', salePrice: { amount: 120_000, currency: 'COP', formatted: '$120.000', usd: 30 } }),
  ]
  const history = recordPriceObservations(emptyPriceHistory(), offers, 'CO')
  assert.equal(Object.keys(history.games).length, 4)
  for (const offer of offers) assert.equal(history.games[priceHistoryKey('CO', offer)].observations[0].bestPaidUsd, offer.salePrice.usd)
  assert.equal(priceHistoryKey('CO', offers[0]), 'CO:hades')
  const enriched = enrichDealsWithIntelligence(offers, 'CO', history)
  for (const offer of enriched) {
    assert.equal(offer.intelligence?.market.offerCount, 1)
    assert.equal(offer.intelligence?.market.lowestUsd, offer.salePrice.usd)
    assert.equal(offer.intelligence?.market.nextBestUsd, undefined)
  }
})

test('console watchlist uses exact product lookup, country and currency even when the active radar is PC', () => fixture(async (dataDir) => {
  const calls: LibraryRadarParams[] = []
  const xbox = deal('xbox')
  const ps = deal('playstation', { salePrice: { amount: 11, currency: 'USD', formatted: '$11', usd: 11 } })
  const library = createLibraryService({ dataDir, queryRadar: async (params) => {
    calls.push(params)
    return radar([
      deal('pc', { salePrice: { amount: 0, currency: 'USD', formatted: '$0', usd: 0 }, isFree: true }),
      deal('xbox', { id: 'wrong-edition', storeProductId: '9PCR3Z2MSM4T', salePrice: { amount: 0, currency: 'COP', formatted: '$0', usd: 0 }, isFree: true }),
      { ...xbox, id: 'foreign-price', countries: ['US'], priceCountry: 'US', salePrice: { amount: 1, currency: 'USD', formatted: '$1', usd: 1 } },
      xbox, ps,
    ])
  } })
  await library.update({ action: 'settings', settings: { 'dealrift-country': 'CO', 'dealrift-ecosystem': 'pc' } })
  await library.update({ action: 'upsert', game: game(xbox, { targetPrice: { amount: 45_000, currency: 'COP' } }) })
  await library.update({ action: 'upsert', game: game(ps, { targetPrice: { amount: 12, currency: 'USD' } }) })
  const state = await library.check()
  assert.equal(calls.length, 2)
  assert.deepEqual(new Set(calls.map((call) => call.search)), new Set([`product:${xbox.storeProductId}`, `product:${ps.storeProductId}`]))
  assert.deepEqual(new Set(calls.map((call) => call.ecosystem)), new Set(['xbox', 'playstation']))
  assert.ok(calls.every((call) => call.country === 'CO' && call.minSavings === 0 && call.regionSample === 0))
  assert.equal(state.alerts.length, 2)
  assert.equal(state.alerts.find((alert) => alert.gameId === gameIdentity(xbox))?.price, 40_000)
  assert.equal(state.alerts.find((alert) => alert.gameId === gameIdentity(ps))?.price, 11)
  assert.equal(state.games.find((entry) => entry.ecosystem === 'xbox')?.snapshot?.storeProductId, xbox.storeProductId)
  const reloaded = await createLibraryService({ dataDir, queryRadar: async () => radar([]) }).read()
  assert.deepEqual(reloaded.games, state.games)
}))

test('console USD target waits for a verified conversion rather than treating local currency as dollars', () => fixture(async (dataDir) => {
  let current = deal('xbox', { salePrice: { amount: 40_000, currency: 'COP', formatted: '$40.000' } })
  const library = createLibraryService({ dataDir, queryRadar: async () => radar([current]) })
  await library.update({ action: 'settings', settings: { 'dealrift-country': 'CO' } })
  await library.update({ action: 'upsert', game: game(current, { targetPrice: { amount: 12, currency: 'USD' } }) })
  assert.equal((await library.check()).alerts.length, 0)
  current = { ...current, salePrice: { ...current.salePrice, usd: 10 } }
  const verified = await library.check()
  assert.equal(verified.alerts.length, 1)
  assert.equal(verified.alerts[0].price, 10)
  assert.equal(verified.alerts[0].currency, 'USD')
}))

test('a console price cannot be replaced by a same-title PC or another-edition price during monitoring', () => fixture(async (dataDir) => {
  const saved = deal('xbox')
  const library = createLibraryService({ dataDir, queryRadar: async () => radar([
    deal('pc', { salePrice: { amount: 1, currency: 'USD', formatted: '$1', usd: 1 } }),
    deal('xbox', { storeProductId: '9PCR3Z2MSM4T', salePrice: { amount: 1, currency: 'USD', formatted: '$1', usd: 1 } }),
  ]) })
  await library.update({ action: 'settings', settings: { 'dealrift-country': 'CO' } })
  await library.update({ action: 'upsert', game: game(saved, { targetPrice: { amount: 100, currency: 'USD' } }) })
  const state = await library.check()
  assert.equal(state.alerts.length, 0)
  assert.equal(state.games[0].snapshot?.storeProductId, saved.storeProductId)
  assert.equal(state.games[0].snapshot?.confidence, 'fallback')
  assert.match(state.checkError ?? '', /could not be verified/)
}))
