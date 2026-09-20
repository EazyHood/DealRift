import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { DealHistoryPoint, RadarResponse } from '../src/shared/dealTypes.js'

test('console API routes sources, converts native prices, isolates overview history and preserves stale evidence', async () => {
  const root = path.resolve(os.tmpdir())
  const directory = await mkdtemp(path.join(root, 'dealrift-console-api-'))
  const previous = process.env.DEALRIFT_DATA_DIR
  process.env.DEALRIFT_DATA_DIR = directory
  const realFetch = globalThis.fetch, realNow = Date.now
  let clock = Date.now(), offline = false
  Date.now = () => clock
  const requested: URL[] = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.hostname === '127.0.0.1') return realFetch(input, init)
    requested.push(url)
    if (offline) throw new Error('Console provider unavailable')
    let payload: unknown
    if (url.hostname === 'web.np.playstation.com') {
      if (url.searchParams.get('operationName') === 'queryRetrieveTelemetryDataPDPProduct') payload = { data: { productRetrieve: { id: 'UP4497-PPSA03972_00-00000000000GOTY7', name: 'Example Game', starRating: { averageRating: 4.5 } } } }
      else {
        const search = url.searchParams.get('operationName') === 'getSearchResults'
        payload = { data: { [search ? 'universalSearch' : 'categoryGridRetrieve']: {
          [search ? 'results' : 'products']: [{ id: 'UP4497-PPSA03972_00-00000000000GOTY7', name: 'Example Game', platforms: ['PS5'], storeDisplayClassification: 'FULL_GAME', skus: [{ type: 'STANDARD' }], price: { basePrice: '20,00 €', discountedPrice: '10,00 €', isFree: false, isExclusive: false, isTiedToSubscription: false, serviceBranding: ['NONE'] } }],
          pageInfo: { totalCount: 1, isLast: true },
        } } }
      }
    } else if (url.hostname === 'open.er-api.com') payload = { result: 'success', rates: { USD: 1, EUR: 0.5 } }
    else if (url.hostname === 'www.microsoft.com') {
      const response = new Response('<script>{"productId":"9P8DL6W0JBB8"}</script>')
      Object.defineProperty(response, 'url', { value: url.toString() })
      return response
    } else if (url.hostname === 'displaycatalog.mp.microsoft.com') payload = { Products: [{
      ProductId: '9P8DL6W0JBB8', ProductType: 'Game', Properties: { XboxConsoleGenCompatible: ['ConsoleGen9'] }, LocalizedProperties: [{ ProductTitle: 'Example Game', Markets: ['ES'] }],
      DisplaySkuAvailabilities: [{ Sku: { SkuType: 'full', Properties: {} }, Availabilities: [{ Actions: ['Purchase', 'Browse'], Markets: ['ES'], Conditions: { ClientConditions: { AllowedPlatforms: [{ PlatformName: 'Windows.Xbox' }] }, StartDate: '2020-01-01T00:00:00Z', EndDate: '2099-01-01T00:00:00Z' }, OrderManagementData: { Price: { ListPrice: 5, MSRP: 20, CurrencyCode: 'EUR' } } }] }],
    }] }
    else throw new Error(`Unexpected PC provider during console request: ${url.hostname}`)
    const response = new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } })
    Object.defineProperty(response, 'url', { value: url.toString() })
    return response
  }
  const { loadRadar, startRadarServer } = await import('./index.js')
  const { server, port } = await startRadarServer({ port: 0 })
  const params = { country: 'ES', locale: 'es-ES', limit: 10, minSavings: 0, regionSample: 0 }
  try {
    const ps = await loadRadar({ ...params, ecosystem: 'playstation' })
    const xbox = await loadRadar({ ...params, ecosystem: 'xbox' })
    assert.equal(ps.deals[0].salePrice.usd, 20)
    assert.equal(ps.deals[0].salePrice.currency, 'EUR')
    assert.equal(xbox.deals[0].salePrice.usd, 10)
    assert.equal(ps.deals[0].intelligence?.market.offerCount, 1)
    assert.equal(ps.regionalScans.length, 0)
    assert.equal(ps.marketScouts.length, 0)
    assert.ok(requested.every((url) => ['web.np.playstation.com', 'open.er-api.com', 'www.microsoft.com', 'displaycatalog.mp.microsoft.com'].includes(url.hostname)))
    const history = await (await realFetch(`http://127.0.0.1:${port}/api/history?ecosystem=playstation&country=ES`)).json() as DealHistoryPoint[]
    assert.equal(history.length, 1)
    assert.equal(history[0].ecosystem, 'playstation')
    assert.equal(history[0].country, 'ES')
    assert.deepEqual(await (await realFetch(`http://127.0.0.1:${port}/api/history?ecosystem=playstation&country=CO`)).json(), [])
    const before = await readFile(path.join(directory, 'deal-price-history.json'), 'utf8')
    clock += 31 * 60 * 1000; offline = true
    const stale = await loadRadar({ ...params, ecosystem: 'playstation' })
    assert.equal(stale.deals[0].freshness?.stale, true)
    assert.equal(stale.deals[0].freshness?.updatedAt, ps.deals[0].freshness?.updatedAt)
    assert.equal(stale.metrics.totalDeals, 0)
    assert.equal(stale.sourceStatus[0].ok, false)
    assert.equal(await readFile(path.join(directory, 'deal-price-history.json'), 'utf8'), before)
    const invalid = await realFetch(`http://127.0.0.1:${port}/api/radar?ecosystem=invalid`)
    assert.equal(invalid.status, 400)
    const unsupported = await (await realFetch(`http://127.0.0.1:${port}/api/radar?ecosystem=playstation&country=VN`)).json() as RadarResponse
    assert.equal(unsupported.deals.length, 0)
    assert.equal(unsupported.sourceStatus[0].ok, false)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    globalThis.fetch = realFetch; Date.now = realNow
    if (previous === undefined) delete process.env.DEALRIFT_DATA_DIR
    else process.env.DEALRIFT_DATA_DIR = previous
    assert.ok(path.resolve(directory).startsWith(`${root}${path.sep}`))
    await rm(directory, { recursive: true, force: true })
  }
})
