import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchXboxDeals, parseXboxProducts, xboxProductIdsFromHtml } from './xbox.js'

const options = { country: 'CO', locale: 'es-CO', limit: 60, minSavings: 0 }
const now = new Date('2026-09-20T12:00:00Z')

// Trimmed shape of the public Microsoft Details response. The prices are fixtures, not live claims.
function offer(amount = 84000, original = 210000) {
  return {
    Actions: ['Details', 'Fulfill', 'Purchase', 'Browse', 'Curate', 'Redeem'],
    Markets: ['CO'],
    Conditions: {
      ClientConditions: { AllowedPlatforms: [{ PlatformName: 'Windows.Xbox' }, { PlatformName: 'Windows.Desktop' }] },
      StartDate: '2026-09-17T00:00:00Z', EndDate: '2026-09-24T09:59:59Z',
    },
    OrderManagementData: {
      Price: { CurrencyCode: 'COP', ListPrice: amount, MSRP: original },
      PIFilter: { InclusionProperties: [] as string[], ExclusionProperties: [] as string[] },
    },
  }
}
function product() {
  return {
    ProductId: '9PNN223H8MLZ', ProductType: 'Game',
    Properties: { IsDemo: false, XboxConsoleGenCompatible: ['ConsoleGen9'], Categories: ['Role playing'] },
    LocalizedProperties: [{ ProductTitle: 'FINAL FANTASY XVI', Markets: ['CO'], Images: [{ ImagePurpose: 'BoxArt', Uri: '//store-images.s-microsoft.com/image/apps.fixture' }] }],
    MarketProperties: [{ Markets: ['CO'], UsageData: [{ AggregateTimeSpan: 'AllTime', AverageRating: 4.4, RatingCount: 2710 }] }],
    DisplaySkuAvailabilities: [{
      Sku: { SkuType: 'full', Properties: { IsTrial: false, IsPreOrder: false, IsBundle: false } },
      Availabilities: [offer()],
    }],
  }
}
function parse(value: unknown, overrides = {}) {
  return parseXboxProducts({ Products: [value] }, { ...options, ...overrides }, now)
}

test('Xbox parses a regional public console price, precise platform, end date and rating', () => {
  const [deal] = parse(product())
  assert.equal(deal.salePrice.amount, 84000)
  assert.equal(deal.salePrice.currency, 'COP')
  assert.equal(deal.salePrice.usd, undefined)
  assert.equal(deal.savingsPercent, 60)
  assert.equal(deal.platform, 'Xbox Series X|S')
  assert.equal(deal.ecosystem, 'xbox')
  assert.equal(deal.storeProductId, '9PNN223H8MLZ')
  assert.equal(deal.priceCountry, 'CO')
  assert.equal(deal.storeRatingPercent, 88)
  assert.equal(deal.expiresAt, '2026-09-24T09:59:59Z')
  assert.match(deal.url, /^https:\/\/www\.xbox\.com\/es-co\/games\/store\/final-fantasy-xvi\/9PNN223H8MLZ$/)
  assert.equal(parse(product(), { minSavings: 61 }).length, 0)
})

test('Xbox does not present Game Pass entitlements or membership discounts as purchase prices', () => {
  const value = product()
  value.DisplaySkuAvailabilities[0].Availabilities.push(Object.assign(offer(0, 0), { RemediationRequired: true, Remediations: [{ Type: 'Upsell' }] }))
  assert.equal(parse(value)[0].salePrice.amount, 84000)
  value.DisplaySkuAvailabilities[0].Availabilities.shift()
  assert.equal(parse(value).length, 0)
  value.DisplaySkuAvailabilities[0].Availabilities = [Object.assign(offer(100, 1000), { Remediations: [{ Type: 'Upsell' }] })]
  assert.equal(parse(value).length, 0)
})

test('Xbox excludes trials, preorders, DLC and PC-only offers', () => {
  for (const property of ['IsTrial', 'IsPreOrder'] as const) {
    const value = product()
    value.DisplaySkuAvailabilities[0].Sku.Properties[property] = true
    assert.equal(parse(value).length, 0)
  }
  const trialType = product()
  trialType.DisplaySkuAvailabilities[0].Sku.SkuType = 'trial'
  assert.equal(parse(trialType).length, 0)
  const dlc = product()
  dlc.ProductType = 'Durable'
  assert.equal(parse(dlc).length, 0)
  const pc = product()
  pc.DisplaySkuAvailabilities[0].Availabilities[0].Conditions.ClientConditions.AllowedPlatforms = [{ PlatformName: 'Windows.Desktop' }]
  assert.equal(parse(pc).length, 0)
})

test('Xbox requires the selected market and current purchase dates', () => {
  assert.equal(parse(product(), { country: 'US' }).length, 0)
  const expired = product()
  expired.DisplaySkuAvailabilities[0].Availabilities[0].Conditions.EndDate = '2026-09-19T00:00:00Z'
  assert.equal(parse(expired).length, 0)
  const future = product()
  future.DisplaySkuAvailabilities[0].Availabilities[0].Conditions.StartDate = '2026-09-21T00:00:00Z'
  assert.equal(parse(future).length, 0)
})

test('Xbox accepts a public free-to-play game but not a license-only or gift SKU', () => {
  const value = product()
  value.DisplaySkuAvailabilities[0].Availabilities = [offer(0, 0)]
  assert.equal(parse(value, { minSavings: 100 })[0].isFree, true)
  const friendPass = structuredClone(value)
  friendPass.LocalizedProperties[0].ProductTitle = 'It Takes Two - Pase de amigo'
  assert.equal(parse(friendPass).length, 0)
  friendPass.LocalizedProperties[0].ProductTitle = "Split Fiction Friend’s Pass"
  assert.equal(parse(friendPass).length, 0)
  for (const actions of [['Details', 'License', 'Browse'], ['Details', 'Gift', 'Browse'], ['Details', 'Purchase']]) {
    value.DisplaySkuAvailabilities[0].Availabilities[0].Actions = actions
    assert.equal(parse(value).length, 0)
  }
})

test('Xbox rejects eligibility-restricted, malformed or currency-conflicting offers', () => {
  const userCondition = product()
  Object.assign(userCondition.DisplaySkuAvailabilities[0].Availabilities[0].Conditions, { UserConditions: { RequiredEntitlement: 'membership' } })
  assert.equal(parse(userCondition).length, 0)
  const invalid = product()
  invalid.DisplaySkuAvailabilities[0].Availabilities[0].OrderManagementData.Price.ListPrice = Number.NaN
  assert.equal(parse(invalid).length, 0)
  const conflicting = product()
  const usd = offer(10, 20)
  usd.OrderManagementData.Price.CurrencyCode = 'USD'
  conflicting.DisplaySkuAvailabilities[0].Availabilities.push(usd)
  assert.equal(parse(conflicting).length, 0)
})

test('Xbox supports legacy public payment instruments and excludes upgrade-only bundles', () => {
  const value = product()
  value.DisplaySkuAvailabilities[0].Availabilities[0].OrderManagementData.PIFilter = {
    InclusionProperties: ['legacy:Tokens', 'legacy:CurrencyStoredValue', 'legacy:CreditCard', 'legacy:PayPal'],
    ExclusionProperties: ['xboxonlycontent'],
  }
  assert.equal(parse(value).length, 1)
  value.LocalizedProperties[0].ProductTitle = 'Halo: Campaign Evolved - Actualización de la Edición Premium'
  assert.equal(parse(value).length, 0)
})

test('Xbox title search filters provider recommendations instead of returning unrelated games', () => {
  assert.equal(parse(product(), { search: 'hades' }).length, 0)
  assert.equal(parse(product(), { search: 'final fantasy' }).length, 1)
  const unrelated = product()
  unrelated.LocalizedProperties[0].ProductTitle = 'Outbreak: Shades of Horror'
  assert.equal(parse(unrelated, { search: 'hades' }).length, 0)
  const alias = product()
  alias.LocalizedProperties[0].ProductTitle = 'Grand Theft Auto V (Xbox Series X|S)'
  assert.equal(parse(alias, { search: 'gta5' }).length, 1)
  assert.equal(parse(alias, { search: 'gta' }).length, 1)
})

test('Xbox never invents generation compatibility, discounts or expiry for standard prices', () => {
  const value = product()
  value.Properties.XboxConsoleGenCompatible = []
  value.DisplaySkuAvailabilities[0].Availabilities = [offer(100, 100)]
  value.DisplaySkuAvailabilities[0].Availabilities[0].Conditions.EndDate = '2799-03-07T23:59:59Z'
  const [deal] = parse(value)
  assert.equal(deal.platform, 'Xbox')
  assert.equal(deal.expiresAt, undefined)
  assert.equal(deal.savingsPercent, 0)
  assert.equal(deal.isFree, false)
})

test('Xbox discovery deduplicates valid product identifiers and bounds the sample', () => {
  assert.deepEqual(xboxProductIdsFromHtml('"productId":"9pnn223h8mlz" "productId":"9PNN223H8MLZ" "productId":"javascript:alert(1)"'), ['9PNN223H8MLZ'])
  const html = Array.from({ length: 150 }, (_, index) => `"productId":"${String(index).padStart(12, '0')}"`).join(' ')
  assert.equal(xboxProductIdsFromHtml(html).length, 60)
})

test('Xbox ignores untrusted artwork and unrated products', () => {
  const value = product()
  value.LocalizedProperties[0].Images[0].Uri = 'https://untrusted.example/image.jpg'
  value.MarketProperties[0].UsageData[0].RatingCount = 0
  const [deal] = parse(value)
  assert.equal(deal.image, '')
  assert.equal(deal.storeRatingPercent, undefined)
})

test('Xbox exact product monitoring bypasses fuzzy discovery and preserves the requested market', async (context) => {
  const requests: URL[] = []
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input)
    requests.push(url)
    const value = product()
    value.DisplaySkuAvailabilities[0].Availabilities[0].Conditions.StartDate = '2020-01-01T00:00:00Z'
    value.DisplaySkuAvailabilities[0].Availabilities[0].Conditions.EndDate = '2099-01-01T00:00:00Z'
    const response = new Response(JSON.stringify({ Products: [value] }))
    Object.defineProperty(response, 'url', { value: url.toString() })
    return response
  })
  const result = await fetchXboxDeals({ ...options, search: 'product:9PNN223H8MLZ' })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].searchParams.get('market'), 'CO')
  assert.equal(requests[0].searchParams.get('bigIds'), '9PNN223H8MLZ')
  assert.equal(result.deals.length, 1)
  await assert.rejects(fetchXboxDeals({ ...options, search: 'product:../evil' }), /Invalid Xbox product/)
})

test('Xbox fails visibly when product details fail instead of reporting fabricated zero-price deals', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('Unavailable', { status: 503 }))
  await assert.rejects(fetchXboxDeals({ ...options, search: 'product:9PNN223H8MLZ' }), /HTTP 503/)
})

test('Xbox free-only discovery uses the public free collection and verifies ownership prices', async (context) => {
  const requests: URL[] = []
  const free = product()
  free.DisplaySkuAvailabilities[0].Availabilities = [offer(0, 0)]
  free.DisplaySkuAvailabilities[0].Availabilities[0].Conditions = { ...offer().Conditions, StartDate: '2020-01-01T00:00:00Z', EndDate: '2099-01-01T00:00:00Z' }
  const membership = product()
  membership.ProductId = '9P8DL6W0JBB8'
  membership.DisplaySkuAvailabilities[0].Availabilities = [Object.assign(offer(0, 0), { RemediationRequired: true })]
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input)
    requests.push(url)
    const response = new Response(url.hostname === 'www.microsoft.com'
      ? `"productId":"${free.ProductId}" "productId":"${membership.ProductId}"`
      : JSON.stringify({ Products: [free, membership] }))
    Object.defineProperty(response, 'url', { value: url.toString() })
    return response
  })
  const result = await fetchXboxDeals({ ...options, onlyFree: true, minSavings: 100 })
  assert.equal(requests[0].pathname, '/es-co/store/top-free/games/xbox')
  assert.equal(result.deals.length, 1)
  assert.equal(result.deals[0].storeProductId, free.ProductId)
  assert.equal(result.deals[0].isFree, true)
  assert.match(result.message, /juegos gratuitos/)
})

test('Xbox searching with free-only retains title search and removes paid games', async (context) => {
  const requests: URL[] = []
  const paid = product()
  const free = product()
  free.ProductId = '9P8DL6W0JBB8'
  free.DisplaySkuAvailabilities[0].Availabilities = [offer(0, 0)]
  for (const value of [free, paid]) value.DisplaySkuAvailabilities[0].Availabilities[0].Conditions = { ...offer().Conditions, StartDate: '2020-01-01T00:00:00Z', EndDate: '2099-01-01T00:00:00Z' }
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input)
    requests.push(url)
    const response = new Response(url.hostname === 'www.microsoft.com' ? `"productId":"${free.ProductId}"`
      : JSON.stringify(url.pathname.includes('productFamilies') ? { ProductIds: [paid.ProductId, free.ProductId] } : { Products: [paid, free] }))
    Object.defineProperty(response, 'url', { value: url.toString() })
    return response
  })
  const result = await fetchXboxDeals({ ...options, onlyFree: true, search: 'final fantasy' })
  assert.ok(requests.some((url) => url.searchParams.get('query') === 'final fantasy'))
  assert.ok(requests.every((url) => !url.pathname.includes('top-free')))
  assert.deepEqual(result.deals.map((deal) => deal.storeProductId), [free.ProductId])
})
