import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { request } from 'node:http'
import test from 'node:test'
import express from 'express'
import type { Deal, RadarResponse } from '../src/shared/dealTypes.js'
import type { LibraryGame } from '../src/shared/libraryTypes.js'
import { createLibraryService, isQuietHours, registerLibraryRoutes } from './library.js'

function deal(overrides: Partial<Deal> = {}): Deal {
  return { id: 'steam-10', title: 'Alpha Deluxe', source: 'Steam', sourceKind: 'official', platform: 'PC', image: '', url: 'https://store.steampowered.com/app/10/', salePrice: { amount: 10, currency: 'USD', usd: 10, formatted: '$10' }, savingsPercent: 50, dealScore: 8, signalScore: 80, steamAppId: '10', detectedAt: new Date().toISOString(), isFree: false, countries: ['US'], riskLevel: 'low', confidence: 'live-api', tags: [], notes: [], ...overrides }
}
function game(id = 'alpha-deluxe', overrides: Partial<LibraryGame> = {}): LibraryGame {
  return { id, title: 'Alpha Deluxe', owned: false, watched: true, priority: 2, notes: '', updatedAt: new Date().toISOString(), ...overrides }
}
function radar(deals: Deal[]): RadarResponse {
  return { updatedAt: new Date().toISOString(), refreshSeconds: 300, country: 'US', locale: 'en-US', deals, stores: [], regionalScans: [], marketScouts: [], metrics: { totalDeals: deals.length, freebies: 0, maxSavings: 50, officialDeals: deals.length, regionalOpportunities: 0, averageSavings: 50 }, sourceStatus: [] }
}
async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dealrift-library-'))
  try { await run(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

test('concurrent library actions merge atomically and survive a new service instance', () => fixture(async (dataDir) => {
  const options = { dataDir, queryRadar: async () => radar([]) }
  const library = createLibraryService(options)
  await Promise.all(Array.from({ length: 20 }, (_, index) => library.update({ action: 'upsert', game: game(`edition-${index}`) })))
  await library.update({ action: 'settings', settings: { 'dealrift-language': 'es', 'dealrift-country': 'CO', 'dealrift-background': 'true' } })
  const recovered = await createLibraryService(options).read()
  assert.equal(recovered.games.length, 20)
  assert.equal(recovered.revision, 21)
  assert.equal(recovered.settings['dealrift-country'], 'CO')
}))

test('corrupt library is reported and preserved instead of silently resetting', () => fixture(async (dataDir) => {
  const file = path.join(dataDir, 'library.json')
  await writeFile(file, '{broken')
  const library = createLibraryService({ dataDir, queryRadar: async () => radar([]) })
  await assert.rejects(library.read(), /preserved/)
  await assert.rejects(library.update({ action: 'upsert', game: game() }), /preserved/)
  assert.equal(await readFile(file, 'utf8'), '{broken')
}))

test('imports deeply reject malicious URLs, nested numbers, oversized lists, and unknown fields', () => fixture(async (dataDir) => {
  const library = createLibraryService({ dataDir, queryRadar: async () => radar([]) })
  for (const snapshot of [
    deal({ url: 'javascript:alert(1)' }),
    deal({ image: 'file:///C:/secret.txt' }),
    deal({ salePrice: { amount: -10, currency: 'USD', formatted: '-10' } }),
    { ...deal(), unknown: { dangerous: true } },
  ]) {
    assert.throws(() => library.update({ action: 'import', games: [game('alpha', { snapshot })] }))
  }
  assert.throws(() => library.update({ action: 'import', games: Array.from({ length: 501 }, (_, i) => game(String(i))) }))
  assert.throws(() => library.update({ action: 'settings', settings: { '__proto__': 'bad', 'dealrift-country': 'UNKNOWN' } }))
  assert.equal((await library.read()).games.length, 0)
  await library.update({ action: 'import', games: [game('alpha', { snapshot: deal() })] })
  assert.equal((await library.read()).games[0].snapshot?.confidence, 'fallback')
}))

test('settings and restored backups reject unsafe language, numeric, enum, and legacy boolean preferences', () => fixture(async (dataDir) => {
  const library = createLibraryService({ dataDir, queryRadar: async () => radar([]) })
  const original = await library.update({ action: 'upsert', game: game() })
  const invalid: Record<string, string>[] = [
    { 'dealrift-language': 'fr' }, { 'dealrift-language': '__proto__' },
    { 'dealrift-country': 'ZZ' }, { 'dealrift-sort-mode': 'broken' },
    { 'dealrift-page-size': '0' }, { 'dealrift-active-view': 'unknown' },
    { 'dealrift-min-savings': 'NaN' }, { 'dealrift-min-savings': '101' },
    { 'dealrift-min-rating': '-1' }, { 'dealrift-max-price': 'Infinity' },
    { 'dealrift-alert-savings': '39' }, { 'dealrift-alert-signal': '49' },
    { 'dealrift-max-price': ' ' }, { 'dealrift-max-price': '0x10' },
    { 'dealrift-only-free': '1' }, { 'dealrift-alert-free': 'yes' },
    { 'dealrift-check-cursor': '500' }, { 'dealrift-desktop-notified': '["untrusted"]' },
  ]
  for (const settings of invalid) {
    assert.throws(() => library.update({ action: 'settings', settings }), JSON.stringify(settings))
    assert.throws(() => library.update({ action: 'restore', state: { ...original, settings } }), JSON.stringify(settings))
  }
  assert.deepEqual(await library.read(), original)
  const settings = {
    'dealrift-language': 'es', 'dealrift-country': 'CO', 'dealrift-sort-mode': 'value', 'dealrift-page-size': '20',
    'dealrift-min-savings': '0', 'dealrift-min-rating': '100', 'dealrift-max-price': '19.99',
    'dealrift-alert-savings': '40', 'dealrift-alert-signal': '100', 'dealrift-only-free': 'false', 'dealrift-alert-free': 'true',
  }
  const saved = await library.update({ action: 'settings', settings })
  assert.equal(saved.settings['dealrift-language'], 'es')
  await library.update({ action: 'restore', state: saved })
  assert.equal((await library.read()).settings['dealrift-max-price'], '19.99')
}))

test('all watched editions are checked, owned titles excluded, overlap collapsed, concurrency bounded', () => fixture(async (dataDir) => {
  let active = 0, maximum = 0, queries = 0
  const library = createLibraryService({ dataDir, queryRadar: async (params) => {
    assert.equal(params.regionSample, 0)
    assert.equal(params.minSavings, 0)
    queries += 1; active += 1; maximum = Math.max(maximum, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active -= 1
    return radar([deal({ title: params.search })])
  } })
  for (let i = 0; i < 7; i++) await library.update({ action: 'upsert', game: game(`edition-${i}`, { title: `Game edition ${i}` }) })
  await library.update({ action: 'upsert', game: game('owned', { owned: true }) })
  const first = library.check(), second = library.check()
  assert.equal(first, second)
  const state = await first
  assert.equal(state.alerts.length, 7)
  assert.equal(queries, 7)
  assert.ok(maximum <= 3)
}))

test('targets compare native or available USD values, lower prices and changed targets re-alert once', () => fixture(async (dataDir) => {
  let amount = 10
  const library = createLibraryService({ dataDir, queryRadar: async () => radar([deal({ salePrice: { amount: amount * 4000, currency: 'COP', formatted: `${amount * 4000} COP`, usd: amount } })]) })
  await library.update({ action: 'upsert', game: game('alpha', { targetPrice: { amount: 11, currency: 'USD' } }) })
  assert.equal((await library.check()).alerts.length, 1)
  assert.equal((await library.check()).alerts.length, 1)
  amount = 10.5
  assert.equal((await library.check()).alerts.length, 1, 'a higher price below target is not a new deal')
  amount = 9
  assert.equal((await library.check()).alerts.length, 2)
  await library.update({ action: 'upsert', game: game('alpha', { targetPrice: { amount: 10, currency: 'USD' } }) })
  assert.equal((await library.check()).alerts.length, 3)
  await library.update({ action: 'upsert', game: game('alpha', { targetPrice: { amount: 999, currency: 'EUR' } }) })
  assert.equal((await library.check()).alerts.length, 3)
}))

test('a saved Steam ID recovers a regional target price after title search misses the game', () => fixture(async (dataDir) => {
  const queries: string[] = []
  const title = 'The Witcher 3: Wild Hunt'
  const library = createLibraryService({ dataDir, queryRadar: async (params) => {
    queries.push(params.search!)
    assert.equal(params.country, 'CO')
    assert.equal(params.regionSample, 0)
    assert.equal(params.minSavings, 0)
    return radar(params.search === 'steam:292030' ? [deal({ title: 'The Witcher® 3: Wild Hunt™', steamAppId: '292030', countries: ['CO'], salePrice: { amount: 16000, currency: 'COP', usd: 4, formatted: '$16.000' } })] : [])
  } })
  await library.update({ action: 'settings', settings: { 'dealrift-country': 'CO' } })
  await library.update({ action: 'upsert', game: game('witcher-3', { title, steamAppId: '292030', targetPrice: { amount: 17000, currency: 'COP' } }) })
  const state = await library.check()
  assert.deepEqual(queries, [title, 'steam:292030'])
  assert.equal(state.alerts.length, 1)
  assert.equal(state.alerts[0].currency, 'COP')
  assert.equal(state.alerts[0].price, 16000)
  assert.equal(state.games[0].snapshot?.steamAppId, '292030')
  assert.equal(state.checkError, undefined)
}))

test('ID fallback adds a target-compatible offer but rejects other editions and different IDs', () => fixture(async (dataDir) => {
  let fallbackOffers = [deal({ id: 'steam-local', countries: ['CO'], salePrice: { amount: 16000, currency: 'COP', formatted: '$16.000' } })]
  let calls = 0
  const library = createLibraryService({ dataDir, queryRadar: async (params) => {
    calls += 1
    return radar(params.search === 'steam:10' ? fallbackOffers : [deal({ id: 'gog-usd', source: 'GOG', steamAppId: undefined, countries: ['CO'] })])
  } })
  await library.update({ action: 'settings', settings: { 'dealrift-country': 'CO' } })
  await library.update({ action: 'upsert', game: game('alpha', { steamAppId: '10', targetPrice: { amount: 17000, currency: 'COP' } }) })
  const matched = await library.check()
  assert.equal(calls, 2)
  assert.equal(matched.games[0].snapshot?.id, 'steam-local')
  assert.equal(matched.alerts.length, 1)
  fallbackOffers = [
    deal({ id: 'wrong-edition', title: 'Alpha Standard', countries: ['CO'], salePrice: { amount: 1000, currency: 'COP', formatted: '$1.000' } }),
    deal({ id: 'wrong-id', steamAppId: '999', countries: ['CO'], salePrice: { amount: 1000, currency: 'COP', formatted: '$1.000' } }),
  ]
  const rejected = await library.check()
  assert.equal(rejected.alerts.length, 1)
  assert.equal(rejected.games[0].snapshot?.id, 'gog-usd', 'keep the valid original offer when the fallback edition does not match')
}))

test('Steam fallback recovers a failed title query and is skipped when the title already has a compatible offer', () => fixture(async (dataDir) => {
  const queries: string[] = []
  let titleFails = true
  const library = createLibraryService({ dataDir, queryRadar: async (params) => {
    queries.push(params.search!)
    if (params.search !== 'steam:10' && titleFails) throw new Error('Title feed unavailable')
    return radar([deal()])
  } })
  await library.update({ action: 'upsert', game: game('alpha', { steamAppId: '10', targetPrice: { amount: 11, currency: 'USD' } }) })
  assert.equal((await library.check()).alerts.length, 1)
  assert.deepEqual(queries, ['Alpha Deluxe', 'steam:10'])
  titleFails = false
  queries.length = 0
  await library.check()
  assert.deepEqual(queries, ['Alpha Deluxe'])
}))

test('large watchlists rotate a bounded budget without invalidating untouched snapshots', () => fixture(async (dataDir) => {
  const queries: string[] = []
  const library = createLibraryService({ dataDir, queryRadar: async (params) => { queries.push(params.search!); return radar([deal({ title: params.search })]) } })
  await library.update({ action: 'import', games: Array.from({ length: 25 }, (_, index) => game(`game-${index}`, { title: `Game ${index}` })) })
  const first = await library.check()
  assert.equal(queries.length, 20)
  assert.match(first.checkError ?? '', /20 of 25/)
  assert.equal(first.games[24].snapshot, undefined)
  const second = await library.check()
  assert.equal(queries.length, 40)
  assert.equal(new Set(queries).size, 25)
  assert.ok(second.games[24].snapshot)
}))

test('a verified crossing of the target rearms a previously delivered matching alert', () => fixture(async (dataDir) => {
  let amount = 9
  const library = createLibraryService({ dataDir, queryRadar: async () => radar([deal({ salePrice: { amount, currency: 'USD', formatted: String(amount) } })]) })
  await library.update({ action: 'settings', settings: { 'dealrift-notifications': 'true' } })
  await library.update({ action: 'upsert', game: game('alpha', { targetPrice: { amount: 10, currency: 'USD' } }) })
  await library.check()
  assert.equal((await library.claimNotifications()).length, 1)
  amount = 11
  await library.check()
  assert.equal((await library.claimNotifications()).length, 0)
  amount = 9
  await library.check()
  assert.equal((await library.claimNotifications()).length, 1)
  await library.check()
  assert.equal((await library.claimNotifications()).length, 0)
}))

test('future, stale, expired, foreign and different editions never trigger alerts; old snapshot remains unverified', () => fixture(async (dataDir) => {
  let offers: Deal[] = []
  const library = createLibraryService({ dataDir, queryRadar: async () => radar(offers) })
  await library.update({ action: 'upsert', game: game('alpha', { snapshot: deal() }) })
  for (const bad of [
    deal({ startsAt: '2099-01-01T00:00:00Z' }), deal({ expiresAt: '2000-01-01T00:00:00Z' }),
    deal({ confidence: 'fallback' }), deal({ tags: ['stale'] }), deal({ countries: ['CO'] }),
    deal({ title: 'Alpha Standard' }), deal({ detectedAt: '2000-01-01T00:00:00Z' }), deal({ detectedAt: '2099-01-01T00:00:00Z' }), deal({ countries: [] }),
  ]) {
    offers = [bad]
    const state = await library.check()
    assert.equal(state.alerts.length, 0)
    assert.equal(state.games[0].snapshot?.title, 'Alpha Deluxe')
    assert.equal(state.games[0].snapshot?.confidence, 'fallback')
    assert.ok(state.checkError)
  }
}))

test('quiet hours span midnight, claims persist, and quiet backlog never replays', () => fixture(async (dataDir) => {
  const settings = { 'dealrift-quiet-start': '22:00', 'dealrift-quiet-end': '08:00' }
  assert.equal(isQuietHours(settings, new Date(2026, 0, 1, 23, 0)), true)
  assert.equal(isQuietHours(settings, new Date(2026, 0, 2, 7, 59)), true)
  assert.equal(isQuietHours(settings, new Date(2026, 0, 2, 8, 0)), false)
  const options = { dataDir, queryRadar: async () => radar([deal()]) }
  const library = createLibraryService(options)
  await library.update({ action: 'upsert', game: game() })
  await library.update({ action: 'settings', settings: { 'dealrift-notifications': 'true' } })
  await library.check()
  const claims = await Promise.all([library.claimNotifications(), library.claimNotifications()])
  assert.equal(claims.flat().length, 1)
  assert.equal((await createLibraryService(options).claimNotifications()).length, 0)
  await library.update({ action: 'upsert', game: game('second') })
  await library.check()
  await library.update({ action: 'settings', settings })
  assert.equal((await library.claimNotifications(new Date(2026, 0, 1, 23, 0))).length, 0)
  assert.equal((await library.claimNotifications(new Date(2026, 0, 2, 10, 0))).length, 0)
  assert.equal((await library.read()).alerts.length, 2)
}))

test('country changes suppress old notifications and independently track identical prices in the new region', () => fixture(async (dataDir) => {
  const library = createLibraryService({ dataDir, queryRadar: async (params) => radar([deal({ countries: [params.country] })]) })
  await library.update({ action: 'settings', settings: { 'dealrift-notifications': 'true' } })
  await library.update({ action: 'upsert', game: game() })
  await library.check()
  const changed = await library.update({ action: 'settings', settings: { 'dealrift-country': 'CO' } })
  assert.equal(changed.games[0].snapshot?.confidence, 'fallback')
  assert.equal((await library.claimNotifications()).length, 0)
  const refreshed = await library.check()
  assert.equal(refreshed.alerts.length, 2)
  const claimed = await library.claimNotifications()
  assert.equal(claimed.length, 1)
  assert.equal(claimed[0].country, 'CO')
}))

test('notification delivery rechecks freshness and current price instead of replaying outdated alerts', () => fixture(async (dataDir) => {
  let amount = 10
  const library = createLibraryService({ dataDir, queryRadar: async () => radar([deal({ salePrice: { amount, currency: 'USD', formatted: String(amount) } })]) })
  await library.update({ action: 'settings', settings: { 'dealrift-notifications': 'true' } })
  await library.update({ action: 'upsert', game: game() })
  await library.check()
  amount = 8
  await library.check()
  const alerts = await library.claimNotifications()
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].price, 8)
  amount = 7
  await library.check()
  assert.equal((await library.claimNotifications(new Date(Date.now() + 31 * 60 * 1000))).length, 0)
}))

test('mutation routes enforce loopback Host, same origin, JSON, and size bounds', () => fixture(async (dataDir) => {
  const app = express()
  registerLibraryRoutes(app, { dataDir, queryRadar: async () => radar([]) })
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const started = app.listen(0, '127.0.0.1', () => resolve(started)) })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const body = JSON.stringify({ action: 'upsert', game: game() })
  try {
    assert.equal((await fetch(`${origin}/api/library`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' }, body })).status, 403)
    assert.equal((await fetch(`${origin}/api/library`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: origin }, body })).status, 415)
    const wrongHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${origin}/api/library`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Host: 'rebind.attacker.test' } }, (response) => { response.resume(); resolve(response.statusCode) })
      req.on('error', reject)
      req.end(body)
    })
    assert.equal(wrongHostStatus, 403)
    const wrongReadHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${origin}/api/library`, { headers: { Host: 'rebind.attacker.test' } }, (response) => { response.resume(); resolve(response.statusCode) })
      req.on('error', reject)
      req.end()
    })
    assert.equal(wrongReadHost, 403)
    assert.equal((await fetch(`${origin}/api/library`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body })).status, 200)
    const malformed = await fetch(`${origin}/api/library`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: '{broken' })
    assert.equal(malformed.status, 400)
    assert.deepEqual(await malformed.json(), { error: 'Invalid JSON.' })
    const restoreBody = JSON.stringify({ action: 'restore', state: { schemaVersion: 1, revision: 0, settings: {}, games: [], alerts: [] } })
    const withEnvelopeRoom = restoreBody + ' '.repeat(2 * 1024 * 1024 + 100 - restoreBody.length)
    assert.equal((await fetch(`${origin}/api/library`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: withEnvelopeRoom })).status, 200)
    assert.equal((await fetch(`${origin}/api/library`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024 + 1024) }) })).status, 413)
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
}))
