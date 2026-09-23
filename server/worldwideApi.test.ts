import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import test from 'node:test'
import type { RadarResponse } from '../src/shared/dealTypes.js'

test('worldwide API discovers full-price Steam games, batches countries, coalesces cache and leaves local history unchanged', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dealrift-worldwide-api-'))
  const previousDir = process.env.DEALRIFT_DATA_DIR
  process.env.DEALRIFT_DATA_DIR = directory
  const realFetch = globalThis.fetch
  const requests: URL[] = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.hostname === '127.0.0.1') return realFetch(input, init)
    requests.push(url)
    let payload: unknown
    if (url.pathname.endsWith('/stores')) payload = [{ storeID: '1', storeName: 'Steam', isActive: 1 }]
    else if (url.hostname === 'www.cheapshark.com') payload = []
    else if (url.pathname.includes('freeGamesPromotions')) payload = { data: { Catalog: { searchStore: { elements: [] } } } }
    else if (url.hostname === 'open.er-api.com') payload = { result: 'success', rates: { USD: 1, COP: 4000 } }
    else if (url.hostname === 'catalog.gog.com') payload = { products: [] }
    else if (url.pathname.includes('storesearch')) payload = { items: [{ id: 10, name: 'Alpha Game', type: 'app' }, { id: 99, name: 'Alpha Game Soundtrack', type: 'app' }] }
    else if (url.pathname.includes('featuredcategories')) payload = { specials: { items: url.searchParams.get('cc') === 'us' ? [{ id: 10, type: 0, name: 'Alpha Game', discount_percent: 50, original_price: 4000, final_price: 2000, currency: 'USD', windows_available: true }] : [] } }
    else if (url.pathname.includes('appdetails')) {
      const country = url.searchParams.get('cc')
      const basic = url.searchParams.get('filters')?.includes('basic')
      const ids = url.searchParams.get('appids')!.split(',')
      payload = Object.fromEntries(ids.map((id) => [id, id === '777' && country === 'us' ? { success: false } : { success: true, data: {
        ...(basic ? { type: id === '99' ? 'dlc' : 'game', name: id === '99' ? 'Alpha Game Soundtrack' : 'Alpha Game', platforms: { windows: true } } : {}),
        price_overview: id === '888' ? { currency: 'USD', initial: 0, final: 0, discount_percent: 0 } : country === 'co'
          ? { currency: 'COP', initial: 1200000, final: 1200000, discount_percent: 0 }
          : { currency: 'USD', initial: 4000, final: id === '99' ? 1 : 2000, discount_percent: 50 },
      } }]))
    } else throw new Error(`Unexpected request ${url}`)
    return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } })
  }
  const { loadRadar, startRadarServer } = await import('./index.js')
  const { server, port } = await startRadarServer({ port: 0 })
  const params = { country: 'US', locale: 'en-US', limit: 120, minSavings: 0, regionSample: 0, search: 'Alpha' }
  try {
    const local = await loadRadar(params)
    assert.equal(local.priceScope, 'country')
    assert.equal(local.deals[0].priceCountry, 'US')
    assert.equal(local.deals[0].salePrice.usd, 20)
    const historicalBefore = await readFile(path.join(directory, 'deal-price-history.json'), 'utf8')
    const before = requests.length
    const [global, coalesced] = await Promise.all([
      loadRadar({ ...params, priceScope: 'worldwide', country: 'CO' }),
      loadRadar({ ...params, priceScope: 'worldwide', country: 'TR' }),
    ])
    assert.equal(global.priceScope, 'worldwide')
    assert.equal(global.country, 'CO')
    assert.equal(coalesced.country, 'TR')
    assert.deepEqual(global.deals, coalesced.deals)
    assert.equal(global.deals.length, 1, 'soundtrack discovery must still pass appdetails type=game validation')
    assert.equal(global.deals[0].priceCountry, 'CO')
    assert.equal(global.deals[0].salePrice.currency, 'COP')
    assert.equal(global.deals[0].salePrice.usd, 3)
    assert.equal(global.deals[0].savingsPercent, 0)
    assert.ok(global.deals[0].intelligence, 'worldwide offers retain the existing intelligence filters')
    assert.equal(global.deals[0].intelligence.history.sampleCount, 0, 'US observations must not become Colombian history')
    assert.match(global.deals[0].url, /cc=co$/)
    assert.equal(global.worldwide?.checkedCountries.length, 24)
    assert.equal(global.worldwide?.partial, false)
    const made = requests.slice(before)
    assert.equal(made.filter((url) => url.pathname.includes('storesearch')).length, 1)
    assert.equal(made.filter((url) => url.searchParams.get('filters') === 'price_overview').length, 24)
    assert.ok(made.filter((url) => url.searchParams.get('filters') === 'price_overview').every((url) => url.searchParams.get('appids') === '10'))
    assert.equal(await readFile(path.join(directory, 'deal-price-history.json'), 'utf8'), historicalBefore)
    const cachedCount = requests.length
    const cached = await loadRadar({ ...params, priceScope: 'worldwide', country: 'GB', regionSample: 10 })
    assert.deepEqual(cached.deals, global.deals)
    assert.equal(requests.length, cachedCount)
    const discounted = await loadRadar({ ...params, priceScope: 'worldwide', minSavings: 50 })
    assert.equal(discounted.deals.length, 0, 'filter after selecting the cheaper full-price country')
    const invalid = await realFetch(`http://127.0.0.1:${port}/api/radar?priceScope=invalid`)
    assert.equal(invalid.status, 400)
    const api = await (await realFetch(`http://127.0.0.1:${port}/api/radar?priceScope=worldwide&country=CO&locale=en-US&limit=120&minSavings=0&regionSample=0&search=Alpha`)).json() as RadarResponse
    assert.equal(api.priceScope, 'worldwide')
    assert.equal(api.metrics.totalDeals, 1)
    const regionalOnly = await loadRadar({ ...params, priceScope: 'worldwide', search: 'steam:777' })
    assert.equal(regionalOnly.deals.length, 1, 'an explicit product need not be purchasable in the US to be checked worldwide')
    assert.equal(regionalOnly.deals[0].priceCountry, 'CO')
    assert.equal(regionalOnly.worldwide?.checkedCountries.length, 24)
    assert.ok(requests.some((url) => url.searchParams.get('appids') === '777' && url.searchParams.get('cc') === 'co'))
    const free = await loadRadar({ ...params, priceScope: 'worldwide', search: 'steam:888', onlyFree: true, minSavings: 35 })
    assert.equal(free.deals.length, 1, 'a real free-to-play game is retained with the default discount filter')
    assert.equal(free.deals[0].salePrice.amount, 0)
    assert.equal(free.deals[0].salePrice.usd, 0)
    assert.equal(free.deals[0].savingsPercent, 0)
    assert.ok(free.deals[0].intelligence?.reasons.some((reason) => reason.code === 'free-game'))
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    globalThis.fetch = realFetch
    if (previousDir === undefined) delete process.env.DEALRIFT_DATA_DIR
    else process.env.DEALRIFT_DATA_DIR = previousDir
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep))
    await rm(directory, { recursive: true, force: true })
  }
})
