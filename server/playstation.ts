import type { Deal, DealPrice } from '../src/shared/dealTypes.js'

// Public persisted operations used by store.playstation.com (web store 0.114.0).
// These are query identifiers, not credentials. Never disable its query allowlist.
const API = 'https://web.np.playstation.com/api/graphql/v1/op'
const OPERATIONS = {
  getSearchResults: '4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa',
  categoryGridRetrieve: '88c0b9a1273c6d320c51cd73e390924e21ae28bf09f01cde8b84b1034b16cd03',
  queryRetrieveTelemetryDataPDPProduct: '71375f8f3dba0de83520ecd474069e037f8ea23b4efcb6778aef58894cd4452d',
} as const
// The official Deals page links this category; no subscription-only collection.
const DEALS_CATEGORY = '3f772501-f6f8-49b7-abac-874a88ca4897'
// Public Free to play collection, verified in CO, US and ES:
// https://store.playstation.com/en-us/category/3b3b0ed6-a365-4a28-8e11-e95bfa1d9186/1
const FREE_CATEGORY = '3b3b0ed6-a365-4a28-8e11-e95bfa1d9186'
const PRODUCT_ID = /^[A-Z]{2}\d{4}-[A-Z0-9]{9}_\d{2}-[A-Z0-9]{16}$/
const GAME_CLASSES = new Set(['FULL_GAME', 'GAME_BUNDLE', 'PREMIUM_EDITION'])
const STOREFRONTS: Record<string, { locale: string; currency: string }> = {
  US: { locale: 'en-us', currency: 'USD' }, CO: { locale: 'es-co', currency: 'USD' },
  AR: { locale: 'es-ar', currency: 'USD' }, CL: { locale: 'es-cl', currency: 'USD' },
  PE: { locale: 'es-pe', currency: 'USD' }, MX: { locale: 'es-mx', currency: 'MXN' },
  BR: { locale: 'pt-br', currency: 'BRL' }, ES: { locale: 'es-es', currency: 'EUR' },
  DE: { locale: 'de-de', currency: 'EUR' }, FR: { locale: 'fr-fr', currency: 'EUR' },
  IT: { locale: 'it-it', currency: 'EUR' }, GB: { locale: 'en-gb', currency: 'GBP' },
  CA: { locale: 'en-ca', currency: 'CAD' }, AU: { locale: 'en-au', currency: 'AUD' },
  IN: { locale: 'en-in', currency: 'INR' }, TR: { locale: 'tr-tr', currency: 'TRY' },
  ID: { locale: 'en-id', currency: 'IDR' }, MY: { locale: 'en-my', currency: 'MYR' },
  TH: { locale: 'en-th', currency: 'THB' }, ZA: { locale: 'en-za', currency: 'ZAR' },
  PL: { locale: 'pl-pl', currency: 'PLN' }, CN: { locale: 'zh-hans-cn', currency: 'CNY' },
  JP: { locale: 'ja-jp', currency: 'JPY' }, KR: { locale: 'ko-kr', currency: 'KRW' },
  HK: { locale: 'zh-hant-hk', currency: 'HKD' }, SG: { locale: 'en-sg', currency: 'SGD' },
  TW: { locale: 'zh-hant-tw', currency: 'TWD' }, SA: { locale: 'ar-sa', currency: 'USD' },
}

type RecordValue = Record<string, unknown>
export interface PlayStationOptions {
  country: string
  locale: string
  limit: number
  minSavings: number
  search?: string
  onlyFree?: boolean
  enrichRatings?: boolean
  maxPages?: number
  signal?: AbortSignal
}

export function supportedPlayStationCountries(): string[] {
  return Object.keys(STOREFRONTS)
}

function object(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function string(value: unknown) { return typeof value === 'string' ? value : '' }

export function playStationLocale(country: string) {
  const result = STOREFRONTS[country.toUpperCase()]
  if (!result) throw new Error(`PlayStation Store does not provide a supported storefront for ${country.toUpperCase()}. No other country's price was substituted.`)
  return result.locale
}

/** Store search also returns unrelated recommendations; require title-word matches. */
export function playStationTitleMatches(title: string, search: string) {
  const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\bgta\s*(?=\d|\b)/g, 'grand theft auto ')
    .replace(/\bcod\b/g, 'call of duty')
    .replace(/\brdr\s*(?=\d|\b)/g, 'red dead redemption ')
    .replace(/\bgrand theft auto\s+(iii|iv|v|vi)\b/g, (_, numeral: string) => `grand theft auto ${{ iii: 3, iv: 4, v: 5, vi: 6 }[numeral as 'iii' | 'iv' | 'v' | 'vi']}`)
    .trim()
  const query = normalize(search)
  const words = normalize(title).split(' ')
  return Boolean(query) && query.split(' ').filter(Boolean).every((word) => words.some((candidate) => candidate.startsWith(word)))
}

/** Parse the displayed public price. An explicit currency always wins over country defaults. */
export function parsePlayStationPrice(value: unknown, country: string, isFree = false): DealPrice | undefined {
  const text = string(value).trim()
  if (!text || text.length > 100) return undefined
  const storefront = STOREFRONTS[country.toUpperCase()]
  if (!storefront) return undefined
  const currency = /US\$|\bUSD\b/i.test(text) ? 'USD'
    : /€|\bEUR\b/i.test(text) ? 'EUR'
      : /£|\bGBP\b/i.test(text) ? 'GBP'
        : /R\$|\bBRL\b/i.test(text) ? 'BRL'
          : /MX\$|\bMXN\b/i.test(text) ? 'MXN'
            : /COP|COL\$/i.test(text) ? 'COP'
              : storefront.currency
  const freeLabel = /^(free|gratuito|gratis|gratuit|grátis|kostenlos|無料|무료|免费|免費)$/i.test(text)
  if (freeLabel) return isFree ? { amount: 0, currency, formatted: text, ...(currency === 'USD' ? { usd: 0 } : {}) } : undefined
  // Do not turn unavailable text, percentages, subscriptions or a negative price into a price.
  if (/%|\d\s*[-–]|[-–]\s*\d|\/|\b(month|mes|incluido|included|trial|prueba)\b/i.test(text)) return undefined
  const numberPart = text.match(/^[^\d]*([\d.,\s\u00a0\u202f]+)[^\d]*$/)?.[1]
  if (!numberPart) return undefined
  const compact = numberPart.replace(/[\s\u00a0\u202f]/g, '')
  const decimal = compact.match(/[.,](\d{1,2})$/)
  const amount = decimal
    ? Number(`${compact.slice(0, decimal.index).replace(/[.,]/g, '')}.${decimal[1]}`)
    : Number(compact.replace(/[.,]/g, ''))
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000 || (amount === 0 && !isFree)) return undefined
  return { amount, currency, formatted: text, ...(currency === 'USD' ? { usd: amount } : {}) }
}

export function parsePlayStationProduct(value: unknown, country: string, detectedAt = new Date().toISOString()): Deal | undefined {
  const product = object(value)
  const id = string(product.id)
  const title = string(product.name).trim()
  const classification = string(product.storeDisplayClassification)
  const platforms = array(product.platforms).filter((p): p is string => p === 'PS4' || p === 'PS5')
  const skus = array(product.skus).map(object)
  const price = object(product.price)
  if (price.isFree === true && /friend['’]?s?\s+pass|pase\s+de\s+amigo/i.test(title)) return undefined
  if (!PRODUCT_ID.test(id) || !title || title.length > 300 || !GAME_CLASSES.has(classification) || !platforms.length) return undefined
  // A missing flag is not evidence that a price is available without a subscription.
  if (price.isTiedToSubscription !== false || price.isExclusive !== false) return undefined
  if (!skus.some((sku) => sku.type === 'STANDARD') || skus.some((sku) => /PREORDER|TRIAL|DEMO|SUBSCRIPTION/.test(string(sku.type)))) return undefined
  if (price.isFree === true && /\b(demo|trial|free access|acceso gratuito|prueba gratuita)\b/i.test(title)) return undefined
  const branding = array(price.serviceBranding).map(string).filter(Boolean)
  if (branding.some((brand) => brand !== 'NONE')) return undefined
  const sale = parsePlayStationPrice(price.discountedPrice ?? price.basePrice, country, price.isFree === true)
  const normal = parsePlayStationPrice(price.basePrice, country, price.isFree === true)
  if (!sale || (normal && sale.currency !== normal.currency) || (normal && sale.amount > normal.amount)) return undefined
  const savings = normal && normal.amount > sale.amount ? Math.round((1 - sale.amount / normal.amount) * 100) : 0
  const isFree = sale.amount === 0 && price.isFree === true
  const media = array(product.media).map(object)
  const image = media.find((item) => item.role === 'MASTER' && item.type === 'IMAGE') ?? media.find((item) => item.type === 'IMAGE')
  let imageUrl = string(image?.url)
  try { const url = new URL(imageUrl); if (url.protocol !== 'https:' || url.hostname !== 'image.api.playstation.com') imageUrl = '' } catch { imageUrl = '' }
  return {
    id: `playstation-${id}-${country.toUpperCase()}`, title, source: 'PlayStation Store', sourceKind: 'official',
    ecosystem: 'playstation', storeProductId: id, platform: platforms.join(' / '), image: imageUrl,
    url: `https://store.playstation.com/${playStationLocale(country)}/product/${id}`,
    salePrice: sale, normalPrice: normal, savingsPercent: savings,
    dealScore: Math.round(savings / 10), signalScore: Math.min(100, Math.round(savings * 0.7 + 15)),
    detectedAt, isFree, countries: [country.toUpperCase()], priceCountry: country.toUpperCase(), availability: 'active',
    riskLevel: 'low', confidence: 'live-api', tags: ['PlayStation', ...platforms, ...(isFree ? ['Free to play / free game'] : [])],
    notes: ['Public price without PlayStation Plus. The PSN account country must match this storefront.',
      'Product edition and compatible consoles come from PlayStation Store. Check included content on the product page.'],
  }
}

export function parsePlayStationResponse(payload: unknown, operation: 'search' | 'deals') {
  const result = object(object(object(payload).data)[operation === 'search' ? 'universalSearch' : 'categoryGridRetrieve'])
  const products = result[operation === 'search' ? 'results' : 'products']
  const info = object(result.pageInfo)
  if (!Array.isArray(products) || typeof info.totalCount !== 'number' || typeof info.isLast !== 'boolean') {
    throw new Error('PlayStation Store returned an unsupported catalogue response. Prices were not inferred.')
  }
  return { products, next: string(result.next), total: info.totalCount, isLast: info.isLast }
}

async function request(operation: keyof typeof OPERATIONS, variables: RecordValue, locale: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const url = new URL(API)
  url.searchParams.set('operationName', operation)
  url.searchParams.set('variables', JSON.stringify(variables))
  url.searchParams.set('extensions', JSON.stringify({ persistedQuery: { version: 1, sha256Hash: OPERATIONS[operation] } }))
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json',
      'X-PSN-Store-Locale-Override': locale, 'User-Agent': 'DealRift (+https://github.com/EazyHood/DealRift)' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]), redirect: 'error',
  })
  if (!response.ok) throw new Error(`PlayStation Store HTTP ${response.status}; the public catalogue could not be checked.`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('PlayStation Store returned an empty response.')
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > 2_000_000) { await reader.cancel(); throw new Error('PlayStation Store response exceeded the catalogue size limit.') }
    chunks.push(value)
  }
  const json: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (array(object(json).errors).length) throw new Error('PlayStation Store could not verify this catalogue or product in the selected country.')
  return json
}

async function enrichRatings(deals: Deal[], locale: string | undefined, signal?: AbortSignal) {
  const candidates = deals.filter((deal) => deal.ecosystem === 'playstation' && deal.storeProductId && PRODUCT_ID.test(deal.storeProductId)).slice(0, 24)
  const boundedSignal = AbortSignal.any([AbortSignal.timeout(8_000), ...(signal ? [signal] : [])])
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
    while (cursor < candidates.length && !boundedSignal.aborted) {
      const deal = candidates[cursor++]
      try {
        const storeLocale = locale ?? playStationLocale(deal.priceCountry ?? '')
        const payload = await request('queryRetrieveTelemetryDataPDPProduct', { productId: deal.storeProductId }, storeLocale, boundedSignal)
        const product = object(object(object(payload).data).productRetrieve)
        const rating = object(product.starRating).averageRating
        if (product.id === deal.storeProductId && typeof rating === 'number' && rating >= 0 && rating <= 5) {
          deal.storeRatingPercent = Math.round(rating * 20)
        }
      } catch { /* Missing ratings must not invalidate an independently verified public price. */ }
    }
  }))
  return candidates.filter((deal) => deal.storeRatingPercent !== undefined).length
}

/** Enrich only the selected worldwide offers, sharing one 24-product / 8-second budget across countries. */
export async function enrichPlayStationWinnerRatings(deals: Deal[], signal?: AbortSignal): Promise<number> {
  return enrichRatings(deals, undefined, signal)
}

export async function fetchPlayStationDeals(params: PlayStationOptions): Promise<{ deals: Deal[]; message: string; discoveryLimited: boolean }> {
  const country = params.country.toUpperCase()
  const locale = playStationLocale(country)
  const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(params.signal ? [params.signal] : [])])
  signal.throwIfAborted()
  const limit = Math.min(120, Math.max(1, Math.floor(params.limit) || 40))
  const minSavings = Math.min(100, Math.max(0, params.minSavings || 0))
  const maxPages = Number.isFinite(params.maxPages) ? Math.min(4, Math.max(1, Math.floor(params.maxPages!))) : 4
  let search = params.search?.trim().slice(0, 200) ?? ''
  let exactId: string | undefined
  let rating: number | undefined
  if (/^product:/i.test(search)) {
    exactId = search.slice(8).trim().toUpperCase()
    if (!PRODUCT_ID.test(exactId)) throw new Error('Invalid PlayStation product ID.')
    const payload = await request('queryRetrieveTelemetryDataPDPProduct', { productId: exactId }, locale, signal)
    const product = object(object(object(payload).data).productRetrieve)
    if (product.id !== exactId || !string(product.name)) throw new Error('This PlayStation product is not available in the selected storefront.')
    search = string(product.name)
    const stars = object(product.starRating).averageRating
    if (params.enrichRatings !== false && typeof stars === 'number' && stars >= 0 && stars <= 5) rating = Math.round(stars * 20)
  }
  const deals = new Map<string, Deal>()
  const seenProducts = new Set<string>()
  let total = 0, scanned = 0, next = '', exhausted = false
  const now = new Date().toISOString()
  // Bounded requests keep background monitoring predictable; global search is not limited to the deals collection.
  for (let page = 0; page < maxPages; page += 1) {
    const payload = search
      ? await request('getSearchResults', { countryCode: country, languageCode: locale.split('-')[0], searchTerm: search,
        pageSize: 48, pageOffset: page, nextCursor: next }, locale, signal)
      : await request('categoryGridRetrieve', { id: params.onlyFree ? FREE_CATEGORY : DEALS_CATEGORY, pageArgs: { size: 48, offset: page * 48 },
        filterBy: [...GAME_CLASSES].map((kind) => `storeDisplayClassification:${kind}`) }, locale, signal)
    const result = parsePlayStationResponse(payload, search ? 'search' : 'deals')
    total = result.total
    let newProducts = 0
    for (const product of result.products) {
      const id = string(object(product).id)
      if (seenProducts.has(id)) continue
      seenProducts.add(id); newProducts += 1; scanned += 1
      const deal = parsePlayStationProduct(product, country, now)
      if (!deal || (params.onlyFree && !deal.isFree) || (exactId && deal.storeProductId !== exactId) || (search && !exactId && !playStationTitleMatches(deal.title, search)) || (!deal.isFree && deal.savingsPercent < minSavings)) continue
      if (exactId && rating !== undefined) deal.storeRatingPercent = rating
      deals.set(deal.id, deal)
    }
    next = result.next
    exhausted = result.isLast || scanned >= total
    if (exhausted || !newProducts || deals.size >= limit || (exactId && deals.size > 0) || (search && !next)) break
  }
  const es = params.locale.toLowerCase().startsWith('es')
  const scope = es ? (search ? 'búsqueda del catálogo' : params.onlyFree ? 'colección oficial de juegos gratis' : 'muestra de ofertas populares')
    : (search ? 'catalogue search' : params.onlyFree ? 'official free-to-play collection' : 'popular deals sample')
  const coverage = es ? `PlayStation ${country}: ${scope}; ${scanned} de ${total} resultados revisados${exhausted ? '' : ' (consulta limitada)'}.`
    : `PlayStation ${country}: ${scope}; checked ${scanned} of ${total} results${exhausted ? '' : ' (bounded query)'}.`
  const selected = [...deals.values()].slice(0, limit)
  const rated = params.enrichRatings === false ? 0 : exactId ? selected.filter((deal) => deal.storeRatingPercent !== undefined).length : await enrichRatings(selected, locale, signal)
  signal.throwIfAborted()
  const ratingCoverage = params.enrichRatings === false
    ? es ? 'Valoraciones omitidas en esta consulta.' : 'Ratings omitted for this query.'
    : es ? `Valoración oficial verificada en ${rated} de ${selected.length} juegos (máximo 24 por consulta).`
      : `Official ratings verified for ${rated} of ${selected.length} games (up to 24 per query).`
  return { deals: selected, discoveryLimited: !exhausted && !(exactId && selected.length > 0), message: `${coverage} ${ratingCoverage} ${es
    ? 'Precios públicos sin Plus; se omiten demos, reservas y complementos identificados. Esta fuente no publica la fecha de fin de cada oferta.'
    : 'Public prices without Plus; identified demos, preorders and add-ons are omitted. This source does not publish each offer’s end date.'}` }
}
