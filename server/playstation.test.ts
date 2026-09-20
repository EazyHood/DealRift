import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchPlayStationDeals, parsePlayStationPrice, parsePlayStationProduct, parsePlayStationResponse, playStationLocale, playStationTitleMatches } from './playstation.js'

function product(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Product', id: 'UP4497-PPSA03972_00-00000000000GOTY7', name: 'The Witcher 3: Wild Hunt – Complete Edition',
    platforms: ['PS4', 'PS5'], storeDisplayClassification: 'PREMIUM_EDITION', skus: [{ type: 'STANDARD' }],
    media: [{ role: 'MASTER', type: 'IMAGE', url: 'https://image.api.playstation.com/example.png' }],
    price: { basePrice: 'US$49.99', discountedPrice: 'US$9.99', isFree: false,
      isTiedToSubscription: false, isExclusive: false, serviceBranding: ['NONE'] }, ...overrides,
  }
}
function price(overrides: Record<string, unknown> = {}) { return { ...product().price, ...overrides } }
function page(products: unknown[], options: { search?: boolean; last?: boolean; total?: number; next?: string } = {}) {
  return { data: { [options.search ? 'universalSearch' : 'categoryGridRetrieve']: {
    [options.search ? 'results' : 'products']: products, next: options.next ?? '',
    pageInfo: { isLast: options.last ?? true, totalCount: options.total ?? products.length, offset: 0, size: 48 },
  } } }
}
function response(json: unknown) { return new Response(JSON.stringify(json), { headers: { 'Content-Type': 'application/json' } }) }

test('regional public prices retain their stated currency and locale-specific punctuation', () => {
  assert.equal(playStationLocale('CO'), 'es-co')
  assert.equal(playStationLocale('US'), 'en-us')
  assert.equal(playStationLocale('ES'), 'es-es')
  assert.deepEqual(parsePlayStationPrice('US$19.99', 'CO'), { amount: 19.99, currency: 'USD', formatted: 'US$19.99', usd: 19.99 })
  assert.equal(parsePlayStationPrice('1.299,99 €', 'ES')?.amount, 1299.99)
  assert.equal(parsePlayStationPrice('49,99\u00a0€', 'ES')?.currency, 'EUR')
  assert.equal(parsePlayStationPrice('R$ 199,90', 'BR')?.amount, 199.9)
  assert.equal(parsePlayStationPrice('COP 109.900', 'CO')?.currency, 'COP')
  assert.equal(parsePlayStationPrice('COP 109.900', 'CO')?.amount, 109900)
  assert.equal(parsePlayStationPrice('¥1,980', 'JP')?.amount, 1980)
  assert.equal(parsePlayStationPrice('Unavailable', 'US'), undefined)
  assert.equal(parsePlayStationPrice('Save 10%', 'US'), undefined)
  assert.equal(parsePlayStationPrice('$-10', 'US'), undefined)
  assert.equal(parsePlayStationPrice('Free', 'US'), undefined)
  assert.equal(parsePlayStationPrice('$0.00', 'US'), undefined)
})

test('official product identity, compatible console and selected country stay intact', () => {
  const deal = parsePlayStationProduct(product(), 'CO', '2026-09-20T00:00:00.000Z')!
  assert.equal(deal.ecosystem, 'playstation')
  assert.equal(deal.platform, 'PS4 / PS5')
  assert.equal(deal.storeProductId, 'UP4497-PPSA03972_00-00000000000GOTY7')
  assert.equal(deal.url, 'https://store.playstation.com/es-co/product/UP4497-PPSA03972_00-00000000000GOTY7')
  assert.equal(deal.priceCountry, 'CO')
  assert.equal(deal.savingsPercent, 80)
  assert.equal(deal.salePrice.amount, 9.99)
  assert.equal(deal.isFree, false)
  assert.equal(deal.steamAppId, undefined)
})

test('Plus prices, trials, preorder SKUs, DLC and unverified zero prices never become free games', () => {
  for (const candidate of [
    product({ price: price({ isTiedToSubscription: true, discountedPrice: 'Gratuito', isFree: true }) }),
    product({ price: price({ isExclusive: true }) }),
    product({ price: price({ isTiedToSubscription: undefined }) }),
    product({ price: price({ serviceBranding: ['PS_PLUS'] }) }),
    product({ price: price({ discountedPrice: '$0.00' }) }),
    product({ skus: [{ type: 'TRIAL' }] }), product({ skus: [{ type: 'PREORDER' }] }),
    product({ storeDisplayClassification: 'LEVEL' }), product({ storeDisplayClassification: 'VIRTUAL_CURRENCY' }),
    product({ price: price({ basePrice: '$9.99', discountedPrice: '19,99 €' }) }),
    product({ id: '../../other' }), product({ platforms: ['PC'] }),
    product({ name: 'It Takes Two - Pase de amigo', price: price({ basePrice: 'Gratuito', discountedPrice: 'Gratuito', isFree: true }) }),
  ]) assert.equal(parsePlayStationProduct(candidate, 'CO'), undefined)
  const free = parsePlayStationProduct(product({ price: price({ basePrice: 'Gratuito', discountedPrice: 'Gratuito', isFree: true }) }), 'CO')!
  assert.equal(free.isFree, true)
  assert.equal(free.salePrice.amount, 0)
  assert.equal(free.savingsPercent, 0) // Free-to-play is not falsely advertised as a 100% paid-game discount.
})

test('unsupported markets and changed catalogue schema fail explicitly instead of using US prices', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not request another market') })
  await assert.rejects(fetchPlayStationDeals({ country: 'VN', locale: 'es-CO', limit: 30, minSavings: 0 }), /supported storefront/)
  assert.equal(mock.mock.callCount(), 0)
  assert.throws(() => parsePlayStationResponse({ data: {} }, 'search'), /unsupported catalogue response/)
  assert.equal(parsePlayStationResponse(page([], { search: true }), 'search').total, 0)
})

test('text search reaches the worldwide catalogue and applies savings to verified products', async (t) => {
  const requests: URL[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(new URL(String(input)))
    const headers = init?.headers as Record<string, string> | undefined
    assert.equal(headers?.['X-PSN-Store-Locale-Override'], 'es-co')
    return response(page([product(), product({ id: 'UP4497-PPSA03972_00-00000000000GOTY8', price: price({ discountedPrice: 'US$49.99' }) }),
      product({ id: 'UP4497-PPSA03972_00-00000000000GOTY9', storeDisplayClassification: 'LEVEL' })], { search: true }))
  })
  const result = await fetchPlayStationDeals({ country: 'CO', locale: 'es-CO', limit: 30, minSavings: 50, search: 'witcher' })
  assert.equal(result.deals.length, 1)
  assert.equal(requests[0].searchParams.get('operationName'), 'getSearchResults')
  assert.equal(JSON.parse(requests[0].searchParams.get('variables')!).searchTerm, 'witcher')
  assert.match(result.message, /3 de 3/)
})

test('exact saved products use their ID and official rating instead of a similarly named edition', async (t) => {
  const target = product()
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.searchParams.get('operationName') === 'queryRetrieveTelemetryDataPDPProduct') {
      return response({ data: { productRetrieve: { id: target.id, name: target.name, starRating: { averageRating: 4.83 } } } })
    }
    return response(page([product({ id: 'UP4497-PPSA03972_00-00000000000GOTY8' }), target], { search: true }))
  })
  const result = await fetchPlayStationDeals({ country: 'US', locale: 'en-US', limit: 30, minSavings: 0, search: `Product:${target.id.toLowerCase()}` })
  assert.equal(result.deals.length, 1)
  assert.equal(result.deals[0].storeProductId, target.id)
  assert.equal(result.deals[0].storeRatingPercent, 97)
})

test('repeated catalogue pages cannot loop or inflate the reported coverage', async (t) => {
  let catalogueCalls = 0
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    if (new URL(String(input)).searchParams.get('operationName') === 'categoryGridRetrieve') catalogueCalls += 1
    return response(page([product()], { total: 1000, last: false }))
  })
  const result = await fetchPlayStationDeals({ country: 'ES', locale: 'en-US', limit: 120, minSavings: 0 })
  assert.equal(catalogueCalls, 2)
  assert.equal(result.deals.length, 1)
  assert.match(result.message, /checked 1 of 1000/)
})

test('rating requests are bounded and failures leave the verified offer usable', async (t) => {
  let ratingCalls = 0
  const products = Array.from({ length: 30 }, (_, index) => product({ id: `UP4497-PPSA03972_00-${String(index).padStart(16, '0')}` }))
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.searchParams.get('operationName') === 'categoryGridRetrieve') return response(page(products))
    ratingCalls += 1
    if (ratingCalls === 1) return new Response('failed', { status: 503 })
    const { productId } = JSON.parse(url.searchParams.get('variables')!)
    return response({ data: { productRetrieve: { id: productId, starRating: { averageRating: 4 } } } })
  })
  const result = await fetchPlayStationDeals({ country: 'CO', locale: 'es-CO', limit: 30, minSavings: 0 })
  assert.equal(ratingCalls, 24)
  assert.equal(result.deals.length, 30)
  assert.equal(result.deals.filter((deal) => deal.storeRatingPercent === 80).length, 23)
  assert.equal(result.deals[0].storeRatingPercent, undefined)
  assert.match(result.message, /23 de 30 juegos/)
})

test('provider errors remain errors, not an empty successful response', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('upstream down', { status: 503 }))
  await assert.rejects(fetchPlayStationDeals({ country: 'CO', locale: 'es-CO', limit: 30, minSavings: 0 }), /HTTP 503/)
})

test('search excludes unrelated recommendations and inside-word matches while preserving GTA aliases', () => {
  assert.equal(playStationTitleMatches('Hades II', 'hades'), true)
  assert.equal(playStationTitleMatches('Shades of Darkness', 'hades'), false)
  assert.equal(playStationTitleMatches('Freedom Finger', 'hades'), false)
  assert.equal(playStationTitleMatches('God of War Ragnarök', 'god of war rag'), true)
  assert.equal(playStationTitleMatches('Grand Theft Auto V (PS4™ and PS5™)', 'GTA'), true)
  assert.equal(playStationTitleMatches('Grand Theft Auto V (PS4™ and PS5™)', 'GTA5'), true)
  assert.equal(playStationTitleMatches('Call of Duty Modern Warfare', 'COD modern'), true)
  assert.equal(playStationTitleMatches('ウィッチャー3 ワイルドハント', 'ウィッチャー'), true)
  assert.equal(playStationTitleMatches('別のゲーム', 'ウィッチャー'), false)
  assert.equal(playStationTitleMatches('Any game', '!!!'), false)
})

test('free-only discovery queries the official F2P collection and keeps verified free games only', async (t) => {
  let category = ''
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.searchParams.get('operationName') !== 'categoryGridRetrieve') return response({ data: { productRetrieve: null } })
    category = JSON.parse(url.searchParams.get('variables')!).id
    return response(page([
      product({ name: 'Fortnite', price: price({ basePrice: 'Gratuito', discountedPrice: 'Gratuito', isFree: true }) }),
      product({ id: 'UP4497-PPSA03972_00-00000000000GOTY8' }),
      product({ id: 'UP4497-PPSA03972_00-00000000000GOTY9', name: 'Call of Duty Free Access', price: price({ basePrice: 'Gratuito', discountedPrice: 'Gratuito', isFree: true }) }),
    ]))
  })
  const result = await fetchPlayStationDeals({ country: 'CO', locale: 'es-CO', limit: 30, minSavings: 75, onlyFree: true })
  assert.equal(category, '3b3b0ed6-a365-4a28-8e11-e95bfa1d9186')
  assert.deepEqual(result.deals.map((deal) => deal.title), ['Fortnite'])
  assert.match(result.message, /colección oficial de juegos gratis/)
})

test('free-only title search stays a catalogue search and excludes paid and Plus prices', async (t) => {
  let searches = 0
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const operation = new URL(String(input)).searchParams.get('operationName')
    assert.notEqual(operation, 'categoryGridRetrieve')
    if (operation !== 'getSearchResults') return response({ data: { productRetrieve: null } })
    searches += 1
    return response(page([
      product({ name: 'Fortnite', price: price({ basePrice: 'Gratuito', discountedPrice: 'Gratuito', isFree: true }) }),
      product({ id: 'UP4497-PPSA03972_00-00000000000GOTY8', name: 'Fortnite paid pack' }),
      product({ id: 'UP4497-PPSA03972_00-00000000000GOTY9', name: 'Fortnite Plus pack', price: price({ basePrice: 'Gratuito', discountedPrice: 'Gratuito', isFree: true, isTiedToSubscription: true }) }),
    ], { search: true }))
  })
  const result = await fetchPlayStationDeals({ country: 'CO', locale: 'es-CO', limit: 30, minSavings: 0, search: 'Fortnite', onlyFree: true })
  assert.equal(searches, 1)
  assert.equal(result.deals.length, 1)
  assert.equal(result.deals[0].isFree, true)
})
