import type { Deal, DealPrice } from '../src/shared/dealTypes.js'

const CATALOG = 'https://displaycatalog.mp.microsoft.com/v7.0'
const PRODUCT_ID = /^[A-Z0-9]{12}$/
const MAX_PRODUCTS = 60
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024

type JsonObject = Record<string, unknown>
export interface XboxOptions {
  country: string
  locale: string
  limit: number
  minSavings: number
  search?: string
  onlyFree?: boolean
}

function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function strings(value: unknown): string[] { return array(value).filter((item): item is string => typeof item === 'string') }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function normalizedTitle(value: string) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() }
function searchTitle(value: string) {
  return normalizedTitle(value)
    .replace(/\bgta\s*(?=\d|\b)/g, 'grand theft auto ')
    .replace(/\bcod\b/g, 'call of duty')
    .replace(/\brdr\s*(?=\d|\b)/g, 'red dead redemption ')
    .replace(/\bgrand theft auto\s+(iii|iv|v|vi)\b/g, (_, numeral: string) => `grand theft auto ${{ iii: 3, iv: 4, v: 5, vi: 6 }[numeral as 'iii' | 'iv' | 'v' | 'vi']}`)
    .trim()
}

/** Product IDs are discovery only. Every price and console capability is verified in the catalog. */
export function xboxProductIdsFromHtml(html: string): string[] {
  return [...new Set([...html.matchAll(/"productId"\s*:\s*"([a-z0-9]{12})"/gi)].map((match) => match[1].toUpperCase()))].slice(0, MAX_PRODUCTS)
}

function storeLocale(country: string, locale: string) {
  const nativeLanguages: Record<string, string> = { AR: 'es', BR: 'pt', CL: 'es', CO: 'es', DE: 'de', ES: 'es', FR: 'fr', IT: 'it', JP: 'ja', KR: 'ko', MX: 'es', PL: 'pl', TR: 'tr', TW: 'zh' }
  return `${nativeLanguages[country] ?? (locale.toLowerCase().startsWith('es') && country === 'US' ? 'es' : 'en')}-${country.toLowerCase()}`
}

async function request(url: URL): Promise<string> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json,text/html' },
    signal: AbortSignal.timeout(15_000),
    // These public Microsoft discovery pages may redirect to their canonical search route.
    redirect: 'follow',
  })
  if (!response.ok) throw new Error(`Xbox catalog HTTP ${response.status}`)
  const host = new URL(response.url).hostname
  if (host !== 'www.microsoft.com' && host !== 'displaycatalog.mp.microsoft.com') throw new Error('Unexpected Xbox catalog redirect')
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new Error('Xbox catalog response is too large')
  if (!response.body) throw new Error('Xbox catalog returned an empty response')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let body = ''
  let bytes = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('Xbox catalog response is too large')
      body += decoder.decode(chunk.value, { stream: true })
    }
    return body + decoder.decode()
  } finally { await reader.cancel().catch(() => undefined) }
}

function price(amount: number, currency: string, locale: string): DealPrice {
  let formatted: string
  try { formatted = new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount) }
  catch { formatted = `${currency} ${amount.toFixed(2)}` }
  return { amount, currency, formatted, ...(currency === 'USD' ? { usd: amount } : {}) }
}

function imageUrl(localized: JsonObject): string {
  const images = array(localized.Images).map(object)
  const candidate = images.find((item) => item.ImagePurpose === 'BoxArt') ?? images.find((item) => item.ImagePurpose === 'Poster')
  const uri = text(candidate?.Uri)
  try {
    const url = new URL(uri.startsWith('//') ? `https:${uri}` : uri)
    return url.protocol === 'https:' && url.hostname === 'store-images.s-microsoft.com' ? url.toString() : ''
  } catch { return '' }
}

function hasConditions(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return Object.keys(object(value)).length > 0
}

/** Normalizes a Microsoft Details response, never subscription entitlements or trial licenses. */
export function parseXboxProducts(payload: unknown, options: XboxOptions, now = new Date()): Deal[] {
  const country = options.country.toUpperCase()
  const checkedAt = now.toISOString()
  const nowMs = now.getTime()
  const deals = new Map<string, Deal>()
  for (const raw of array(object(payload).Products)) {
    const product = object(raw)
    const id = text(product.ProductId).toUpperCase()
    const properties = object(product.Properties)
    if (!PRODUCT_ID.test(id) || product.ProductType !== 'Game' || properties.IsDemo === true || properties.IsAddOn === true) continue
    const localized = object(array(product.LocalizedProperties).find((item) => strings(object(item).Markets).includes(country)) ?? array(product.LocalizedProperties)[0])
    const title = text(localized.ProductTitle).trim()
    if (!title || /\b(?:demo|free trial|prueba gratuita)\b/i.test(title)) continue
    const titleKey = normalizedTitle(title)
    // Some upgrade-only bundles are mislabeled Game by the catalog. Do not offer these as a full game.
    if (/\b(?:upgrade|actualizacion|dlc|season pass|pase de temporada|expansion pass)\b/.test(titleKey)) continue
    const query = options.search?.trim()
    if (query && !/^product:/i.test(query) && (!searchTitle(query) || !searchTitle(query).split(' ').every((word) => searchTitle(title).split(' ').some((titleWord) => titleWord.startsWith(word))))) continue
    const market = object(array(product.MarketProperties).find((item) => strings(object(item).Markets).includes(country)))
    const rating = object(array(market.UsageData).find((item) => object(item).AggregateTimeSpan === 'AllTime'))
    const averageRating = number(rating.AverageRating)
    const ratingCount = number(rating.RatingCount)
    const storeRatingPercent = averageRating !== undefined && averageRating >= 0 && averageRating <= 5 && ratingCount && ratingCount > 0 ? Math.round(averageRating * 20) : undefined
    const generations = strings(properties.XboxConsoleGenCompatible)
    const platform = [generations.includes('ConsoleGen8') ? 'Xbox One' : '', generations.includes('ConsoleGen9') ? 'Xbox Series X|S' : ''].filter(Boolean).join(' · ')
    const candidates: { amount: number; original: number; currency: string; startsAt: string; endsAt: string; bundle: boolean }[] = []
    for (const rawSku of array(product.DisplaySkuAvailabilities)) {
      const entry = object(rawSku)
      const sku = object(entry.Sku)
      const skuProperties = object(sku.Properties)
      if (text(sku.SkuType).toLowerCase() !== 'full' || skuProperties.IsTrial === true || skuProperties.IsPreOrder === true || sku.SubscriptionPolicyId || sku.RecurrencePolicy) continue
      for (const rawAvailability of array(entry.Availabilities)) {
        const availability = object(rawAvailability)
        const actions = strings(availability.Actions)
        const conditions = object(availability.Conditions)
        const allowedPlatforms = array(object(conditions.ClientConditions).AllowedPlatforms).map((item) => text(object(item).PlatformName))
        // Browse + Purchase is the public purchase offer. License, Gift and member upsells are not ownership prices.
        if (!actions.includes('Purchase') || !actions.includes('Browse') || !allowedPlatforms.includes('Windows.Xbox')) continue
        if (!strings(availability.Markets).includes(country) || availability.RemediationRequired === true || array(availability.Remediations).length || hasConditions(conditions.UserConditions)) continue
        const startsAt = text(conditions.StartDate)
        const endsAt = text(conditions.EndDate)
        if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || Date.parse(startsAt) > nowMs || Date.parse(endsAt) <= nowMs) continue
        const order = object(availability.OrderManagementData)
        // PIFilter lists payment instruments (cards, PayPal, stored value), not membership eligibility.
        // Membership prices are excluded by the public actions/remediation/user conditions checks above.
        const values = object(order.Price)
        const amount = number(values.ListPrice)
        const original = number(values.MSRP)
        const currency = text(values.CurrencyCode)
        if (amount === undefined || original === undefined || amount < 0 || original < amount || !/^[A-Z]{3}$/.test(currency)) continue
        candidates.push({ amount, original, currency, startsAt, endsAt, bundle: skuProperties.IsBundle === true })
      }
    }
    // A market should have one currency; conflicting currencies are ambiguous, never compare their numeric amounts.
    if (!candidates.length || new Set(candidates.map((candidate) => candidate.currency)).size > 1) continue
    const selected = candidates.sort((a, b) => a.amount - b.amount)[0]
    const savings = selected.original > 0 ? Math.round((1 - selected.amount / selected.original) * 100) : 0
    const isFree = selected.amount === 0
    if (isFree && /friend['’]?s?\s+pass|pase\s+de\s+amigo/i.test(title)) continue
    if (options.onlyFree && !isFree) continue
    if (!isFree && savings < options.minSavings) continue
    const discounted = selected.original > selected.amount
    const slug = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game'
    const spanish = options.locale.toLowerCase().startsWith('es')
    deals.set(id, {
      id: `xbox-${id}`,
      ecosystem: 'xbox',
      storeProductId: id,
      title,
      source: 'Xbox',
      sourceKind: 'official',
      ...(storeRatingPercent !== undefined ? { storeRatingPercent } : {}),
      // A purchase restricted to Windows.Xbox confirms console support even on older records without generation metadata.
      platform: platform || 'Xbox',
      image: imageUrl(localized),
      url: `https://www.xbox.com/${storeLocale(country, options.locale)}/games/store/${slug}/${id}`,
      salePrice: price(selected.amount, selected.currency, options.locale),
      normalPrice: price(selected.original, selected.currency, options.locale),
      savingsPercent: savings,
      dealScore: Math.min(10, savings / 10),
      signalScore: isFree ? 82 : Math.min(95, Math.round(30 + savings * 0.6)),
      detectedAt: checkedAt,
      ...(discounted ? { startsAt: selected.startsAt } : {}),
      ...(discounted && Date.parse(selected.endsAt) - nowMs < 366 * 24 * 60 * 60 * 1000 ? { expiresAt: selected.endsAt } : {}),
      isFree,
      countries: [country],
      priceCountry: country,
      availability: 'active',
      freshness: { updatedAt: checkedAt, stale: false },
      riskLevel: 'low',
      confidence: 'live-api',
      tags: ['Xbox', ...strings(properties.Categories).slice(0, 3), ...(selected.bundle ? [spanish ? 'Paquete' : 'Bundle'] : [])],
      notes: [spanish ? `Compra pública en Xbox ${country}; no requiere Game Pass. Confirma contenido y compatibilidad en la tienda.` : `Public Xbox ${country} purchase; no Game Pass required. Confirm contents and compatibility in the store.`],
    })
  }
  return [...deals.values()].slice(0, Math.max(1, Math.min(MAX_PRODUCTS, Math.floor(options.limit))))
}

export async function fetchXboxDeals(options: XboxOptions): Promise<{ deals: Deal[]; message: string }> {
  const country = options.country.toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('Invalid Xbox market')
  const locale = storeLocale(country, options.locale)
  const query = options.search?.trim().slice(0, 100)
  let ids: string[]
  let partialDiscovery = false
  if (query && /^product:/i.test(query)) {
    const productId = query.slice('product:'.length).toUpperCase()
    if (!PRODUCT_ID.test(productId)) throw new Error('Invalid Xbox product identifier')
    ids = [productId]
  } else if (query) {
    const searchUrl = new URL(`https://www.microsoft.com/${locale}/search/shop/games`)
    searchUrl.searchParams.set('q', query)
    searchUrl.searchParams.set('devicetype', 'xbox')
    const catalogSearch = new URL(`${CATALOG}/productFamilies/games/products`)
    catalogSearch.search = new URLSearchParams({ market: country, languages: options.locale, query, platformDependencyName: 'Windows.Xbox' }).toString()
    const results = await Promise.allSettled([
      request(catalogSearch).then((body) => {
        const payload = object(JSON.parse(body))
        if (!Array.isArray(payload.ProductIds)) throw new Error('Xbox search format changed')
        return strings(payload.ProductIds).map((id) => id.toUpperCase()).filter((id) => PRODUCT_ID.test(id))
      }),
      request(searchUrl).then(xboxProductIdsFromHtml),
    ])
    if (results.every((result) => result.status === 'rejected')) throw new Error('Xbox search is temporarily unavailable')
    partialDiscovery = results.some((result) => result.status === 'rejected')
    ids = [...new Set(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []))].slice(0, MAX_PRODUCTS)
    if (!ids.length && results[0].status === 'rejected') throw new Error('Xbox search returned no verifiable catalog response')
  } else {
    const collection = options.onlyFree ? 'top-free' : 'deals'
    ids = xboxProductIdsFromHtml(await request(new URL(`https://www.microsoft.com/${locale}/store/${collection}/games/xbox`)))
    if (!ids.length) throw new Error('Xbox collection returned no verifiable products')
  }
  const batches: string[][] = []
  for (let index = 0; index < ids.length; index += 20) batches.push(ids.slice(index, index + 20))
  const products = await Promise.all(batches.map(async (batch) => {
    const url = new URL(`${CATALOG}/products`)
    url.search = new URLSearchParams({ bigIds: batch.join(','), market: country, languages: options.locale, fieldsTemplate: 'Details' }).toString()
    const payload = object(JSON.parse(await request(url)))
    if (!Array.isArray(payload.Products)) throw new Error('Xbox product catalog format changed')
    return payload.Products.filter((product) => batch.includes(text(object(product).ProductId).toUpperCase()))
  }))
  const deals = parseXboxProducts({ Products: products.flat() }, { ...options, country })
  const spanish = options.locale.toLowerCase().startsWith('es')
  const message = spanish
    ? `${query ? 'Búsqueda oficial' : options.onlyFree ? 'Muestra de juegos gratuitos oficiales' : 'Muestra de ofertas oficiales'}: ${ids.length} productos consultados en Xbox ${country}; ${deals.length} juegos de consola cumplen los filtros. Sin precios de suscripción ni DLC independientes.${partialDiscovery ? ' Una vía de búsqueda no respondió; cobertura parcial.' : ''}`
    : `${query ? 'Official search' : options.onlyFree ? 'Official free games sample' : 'Official deals sample'}: ${ids.length} products checked in Xbox ${country}; ${deals.length} console games match the filters. Subscription prices and standalone DLC excluded.${partialDiscovery ? ' One search endpoint was unavailable; partial coverage.' : ''}`
  return { deals, message }
}
