import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { GameHistoryResponse } from '../src/shared/libraryTypes.js'
import type { RadarResponse } from '../src/shared/dealTypes.js'

test('radar preserves regional prices, marks stale data and serializes observation transactions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dealrift-reliability-'))
  const previousDir = process.env.DEALRIFT_DATA_DIR
  process.env.DEALRIFT_DATA_DIR = directory
  const realFetch = globalThis.fetch
  const realNow = Date.now
  let clock = Date.parse('2026-09-20T12:00:00Z')
  Date.now = () => clock
  let offline = false
  const captured: URL[] = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.hostname === '127.0.0.1') return realFetch(input, init)
    captured.push(url)
    if (offline) throw new Error('Mock provider outage')
    let body: unknown
    if (url.pathname.endsWith('/stores')) body = [{ storeID: '1', storeName: 'Steam', isActive: 1 }]
    else if (url.hostname === 'www.cheapshark.com') body = [
      { title: 'Alpha Game', dealID: 'abc%2B%3D', storeID: '1', salePrice: '10', normalPrice: '40', savings: '75', dealRating: '8', steamAppID: '42' },
      { title: 'Alpha Game Deluxe', dealID: 'deluxe', storeID: '1', salePrice: '5', normalPrice: '60', savings: '90', dealRating: '9', steamAppID: '42' },
    ].filter((deal) => !url.searchParams.get('title') || deal.title.includes(url.searchParams.get('title')!))
    else if (url.pathname.includes('freeGamesPromotions')) body = { data: { Catalog: { searchStore: { elements: [
      { title: 'Future Giveaway', id: 'future', price: { totalPrice: { discountPrice: 3000, originalPrice: 3000, currencyCode: 'USD' } }, promotions: { upcomingPromotionalOffers: [{ promotionalOffers: [{ startDate: '2099-01-01T00:00:00Z', endDate: '2099-01-08T00:00:00Z', discountSetting: { discountPercentage: 0 } }] }] } },
      { title: 'Expired Giveaway', id: 'expired', promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: '2020-01-01T00:00:00Z', endDate: '2020-01-08T00:00:00Z', discountSetting: { discountPercentage: 0 } }] }] } },
    ] } } } }
    else if (url.hostname === 'open.er-api.com') body = { result: 'success', rates: { USD: 1, COP: 4000 } }
    else if (url.pathname.includes('featuredcategories')) body = { specials: { items: [{ id: 42, type: 0, name: 'Alpha Game', discount_percent: 50, original_price: 16000000, final_price: 8000000, currency: 'COP', windows_available: true }] } }
    else if (url.pathname.includes('appdetails')) body = { '42': { success: true, data: { type: 'game', name: 'Alpha Game', price_overview: { currency: 'COP', initial: 16000000, final: 8000000, discount_percent: 50 } } } }
    else if (url.hostname === 'catalog.gog.com') {
      const query = url.searchParams.get('query')?.replace(/^like:/, '')
      body = { products: query ? [{ id: query.replace(/ /g, '-'), title: query, productType: 'game', price: { finalMoney: { amount: '15', currency: 'USD' }, baseMoney: { amount: '30', currency: 'USD' }, discount: '50%' } }] : [] }
    } else throw new Error(`Unexpected URL ${url}`)
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  }
  const { startRadarServer, loadRadar } = await import('./index.js')
  const { server, port } = await startRadarServer({ port: 0 })
  const params = { country: 'CO', locale: 'en-US', limit: 120, minSavings: 0, regionSample: 0 }
  const getRadar = async () => {
    const response = await realFetch(`http://127.0.0.1:${port}/api/radar?country=CO&regionSample=0&limit=120`)
    assert.equal(response.status, 200)
    return await response.json() as RadarResponse
  }
  try {
    const first = await getRadar()
    const alpha = first.deals.find((deal) => deal.title === 'Alpha Game')!
    assert.equal(alpha.salePrice.currency, 'COP')
    assert.equal(alpha.salePrice.amount, 80000)
    assert.equal(alpha.priceCountry, 'CO')
    assert.equal(alpha.intelligence?.market.offerCount, 1)
    assert.ok(first.deals.some((deal) => deal.title === 'Alpha Game Deluxe'))
    const future = first.deals.find((deal) => deal.title === 'Future Giveaway')!
    assert.equal(future.isFree, false)
    assert.equal(future.intelligence?.verdict, 'wait')
    assert.equal(future.intelligence?.score, 0)
    assert.equal(first.metrics.freebies, 0)
    assert.equal(first.deals.some((deal) => deal.title === 'Expired Giveaway'), false)
    const firstHistory = await readFile(path.join(directory, 'deal-price-history.json'), 'utf8')
    const saved = JSON.parse(firstHistory)
    assert.equal(saved.games['CO:future-giveaway'], undefined)
    assert.equal(saved.games['CO:alpha-game'].observations[0].bestPaidUsd, 20)
    assert.equal(saved.games['CO:alpha-game-deluxe'], undefined)
    clock += 7 * 60 * 60 * 1000
    offline = true
    const stale = await getRadar()
    assert.equal(stale.metrics.totalDeals, 0)
    assert.ok(stale.deals.every((deal) => deal.confidence === 'fallback' && deal.freshness?.stale))
    const staleSource = stale.sourceStatus.find((source) => source.name === 'Steam specials')!
    assert.equal(staleSource.ok, false)
    assert.equal(staleSource.stale, true)
    assert.equal(staleSource.updatedAt, first.sourceStatus.find((source) => source.name === 'Steam specials')?.updatedAt)
    assert.match(staleSource.error!, /Mock provider outage/)
    assert.equal(await readFile(path.join(directory, 'deal-price-history.json'), 'utf8'), firstHistory)
    offline = false
    await getRadar()
    const overviewBeforeSearch = await readFile(path.join(directory, 'deal-history.json'), 'utf8')
    // Library checks share loadRadar but must not replace this minute's dashboard snapshot.
    await Promise.all([loadRadar({ ...params, search: 'Concurrent A' }), loadRadar({ ...params, search: 'Concurrent B' })])
    const concurrent = JSON.parse(await readFile(path.join(directory, 'deal-price-history.json'), 'utf8'))
    assert.ok(concurrent.games['CO:concurrent-a'])
    assert.ok(concurrent.games['CO:concurrent-b'])
    assert.ok(captured.some((url) => url.hostname === 'catalog.gog.com' && url.searchParams.get('query') === 'like:Concurrent A'))
    const targeted = await loadRadar({ ...params, search: '42' })
    assert.ok(targeted.deals.some((deal) => deal.title === 'Alpha Game' && deal.tags.includes('steam-product-lookup')))
    assert.equal(await readFile(path.join(directory, 'deal-history.json'), 'utf8'), overviewBeforeSearch)
    const overviewResponse = await realFetch(`http://127.0.0.1:${port}/api/history`)
    assert.deepEqual(await overviewResponse.json(), JSON.parse(overviewBeforeSearch))
    const historyResponse = await realFetch(`http://127.0.0.1:${port}/api/game-history?gameKey=alpha-game&country=CO`)
    const history = await historyResponse.json() as GameHistoryResponse
    assert.equal(historyResponse.status, 200)
    assert.ok(history.points.length >= 1)
    assert.deepEqual(history.points[0], { at: '2026-09-20T12:00:00.000Z', priceUsd: 20, source: 'Steam', free: false })
    const invalid = await realFetch(`http://127.0.0.1:${port}/api/game-history?gameKey=../bad&country=CO`)
    assert.equal(invalid.status, 400)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    globalThis.fetch = realFetch
    Date.now = realNow
    if (previousDir === undefined) delete process.env.DEALRIFT_DATA_DIR
    else process.env.DEALRIFT_DATA_DIR = previousDir
    await rm(directory, { recursive: true, force: true })
  }
})
