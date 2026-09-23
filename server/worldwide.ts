import type { Deal, SourceStatus, StoreSummary, WorldwideCoverage } from '../src/shared/dealTypes.js'
import { canonicalTitle, getGameEcosystem } from '../src/shared/gameIdentity.js'

export const WORLDWIDE_COUNTRIES = ['US', 'CO', 'IN', 'TR', 'AR', 'BR', 'MX', 'CL', 'PE', 'ID', 'MY', 'PH', 'TH', 'VN', 'ZA', 'PL', 'CN', 'JP', 'KR', 'GB', 'DE', 'ES', 'CA', 'AU']

export interface CountryOffers {
  deals: Deal[]
  sourceStatus: SourceStatus[]
  stores?: StoreSummary[]
  /** A successful exact query authoritatively replaces discovery, including unavailable products. */
  recheckedProducts?: Array<{ source: string; steamAppId?: string; storeProductId?: string }>
}
export interface WorldwideResult { deals: Deal[]; sourceStatus: SourceStatus[]; stores: StoreSummary[]; worldwide: WorldwideCoverage }
interface ScanOptions {
  countries?: string[]
  supportedCountries?: string[]
  scope: WorldwideCoverage['scope']
  loadCountry: (country: string, signal: AbortSignal) => Promise<CountryOffers>
  refineCountry?: (country: string, discovered: Deal[], signal: AbortSignal) => Promise<CountryOffers>
  signal?: AbortSignal
  timeoutMs?: number
  concurrency?: number
}

/** Keep regional product IDs where stable, and never collapse editions or console licences. */
export function worldwideIdentity(deal: Deal): string {
  const ecosystem = getGameEcosystem(deal)
  const title = canonicalTitle(deal.title)
  if (ecosystem === 'xbox') return `${ecosystem}:${deal.storeProductId?.toUpperCase() ?? title}:${canonicalTitle(deal.platform)}`
  if (ecosystem === 'playstation') {
    const platforms = [...new Set(deal.platform.toUpperCase().match(/PS[45]/g) ?? [])].sort().join('+')
    return `${ecosystem}:${title}:${platforms || canonicalTitle(deal.platform)}`
  }
  const source = canonicalTitle(deal.source)
  const product = deal.steamAppId ? `steam-${deal.steamAppId}` : deal.storeProductId ? `product-${deal.storeProductId}` : 'title'
  // A Steam metadata ID on an authorized store does not prove identical DRM/activation rights.
  return `pc:${source}:${product}:${title}`
}

export function verifiedWorldwideOffer(deal: Deal, country: string, now = Date.now()): Deal | undefined {
  if (deal.priceCountry !== country || !deal.countries.includes(country)) return undefined
  if (!['live-api', 'computed'].includes(deal.confidence) || deal.freshness?.stale || ['upcoming', 'expired'].includes(deal.availability ?? '')) return undefined
  if (deal.tags.some((tag) => ['stale', 'unverified', 'upcoming', 'expired', 'foreign-price'].includes(tag))) return undefined
  const checked = Date.parse(deal.freshness?.updatedAt ?? deal.detectedAt)
  if (!Number.isFinite(checked) || checked > now + 60_000 || now - checked > 30 * 60_000) return undefined
  if (deal.startsAt && (!Number.isFinite(Date.parse(deal.startsAt)) || Date.parse(deal.startsAt) > now) || deal.expiresAt && (!Number.isFinite(Date.parse(deal.expiresAt)) || Date.parse(deal.expiresAt) <= now)) return undefined
  const usd = deal.salePrice.currency === 'USD' ? deal.salePrice.amount : deal.salePrice.usd
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0 || !Number.isFinite(deal.salePrice.amount) || deal.salePrice.amount < 0) return undefined
  if ((usd === 0 || deal.salePrice.amount === 0) && !deal.isFree) return undefined
  return { ...deal, salePrice: { ...deal.salePrice, usd } }
}

export function lowestWorldwideOffers(offers: Deal[]): Deal[] {
  offers = offers.filter((offer) => offer.priceCountry && verifiedWorldwideOffer(offer, offer.priceCountry))
  // Product IDs prove equivalence even when PlayStation localizes the title. Across
  // regional IDs we only join matching full titles and console compatibility.
  const parents = new Map<string, string>()
  const root = (key: string): string => {
    const parent = parents.get(key)
    if (!parent || parent === key) { parents.set(key, key); return key }
    const result = root(parent); parents.set(key, result); return result
  }
  for (const deal of offers) {
    if (getGameEcosystem(deal) !== 'playstation' || !deal.storeProductId) continue
    const platforms = [...new Set(deal.platform.toUpperCase().match(/PS[45]/g) ?? [])].sort().join('+') || canonicalTitle(deal.platform)
    const productKey = `playstation-product:${deal.storeProductId.toUpperCase()}:${platforms}`
    parents.set(root(worldwideIdentity(deal)), root(productKey))
  }
  const winners = new Map<string, Deal>()
  const observed = new Map<string, Set<string>>()
  for (const offer of offers) {
    const country = offer.priceCountry
    if (!country) continue
    const deal = verifiedWorldwideOffer(offer, country)
    if (!deal) continue
    const key = root(worldwideIdentity(deal))
    const countries = observed.get(key) ?? new Set<string>()
    countries.add(country); observed.set(key, countries)
    const previous = winners.get(key)
    if (!previous || deal.salePrice.usd! < previous.salePrice.usd! || (deal.salePrice.usd === previous.salePrice.usd && country.localeCompare(previous.priceCountry!) < 0)) winners.set(key, deal)
  }
  return [...winners.entries()].map(([key, deal]) => ({
    ...deal,
    notes: [...deal.notes, `Lowest verified USD price among ${observed.get(key)!.size} countries with a matching edition/platform in the retrieved results. Discovery is bounded; other products or countries may be cheaper. Account country, taxes and activation must be checked at the destination.`],
  })).sort((a, b) => a.salePrice.usd! - b.salePrice.usd! || a.title.localeCompare(b.title))
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** Two bounded phases: discover candidates, then verify exact products where a provider supports it. */
export async function scanWorldwide(options: ScanOptions): Promise<WorldwideResult> {
  const requestedCountries = [...new Set(options.countries ?? WORLDWIDE_COUNTRIES)]
  const unsupportedCountries = requestedCountries.filter((country) => options.supportedCountries && !options.supportedCountries.includes(country))
  const supported = requestedCountries.filter((country) => !unsupportedCountries.includes(country))
  const checked = new Set<string>(), failed = new Set<string>()
  const sourceStatus: SourceStatus[] = []
  const stores = new Map<string, StoreSummary>()
  const offers: Deal[] = []
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 45_000), ...(options.signal ? [options.signal] : [])])
  const concurrency = Math.max(1, Math.min(6, options.concurrency ?? 4))
  const phase = async (loader: ScanOptions['loadCountry'], refinement = false) => {
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(concurrency, supported.length) }, async () => {
      while (cursor < supported.length) {
        const country = supported[cursor++]
        if (signal.aborted) { failed.add(country); continue }
        try {
          const result = await abortable(loader(country, signal), signal)
          const healthy = result.sourceStatus.some((source) => source.ok && !source.stale)
          const degraded = result.sourceStatus.some((source) => !source.ok || source.stale)
          if (healthy) checked.add(country)
          if (!healthy || degraded) failed.add(country)
          for (const source of result.sourceStatus) sourceStatus.push({ ...source, name: `${country} · ${source.name}` })
          for (const store of result.stores ?? []) stores.set(store.id, store)
          if (refinement) {
            for (let index = offers.length - 1; index >= 0; index -= 1) {
              const previous = offers[index]
              if (previous.priceCountry === country && result.recheckedProducts?.some((product) => product.source === previous.source &&
                (product.steamAppId ? product.steamAppId === previous.steamAppId : product.storeProductId && product.storeProductId === previous.storeProductId))) offers.splice(index, 1)
            }
          }
          for (const deal of result.deals) {
            const valid = verifiedWorldwideOffer(deal, country)
            if (valid) {
              if (refinement) {
                const identity = worldwideIdentity(valid)
                // The exact product lookup supersedes an earlier discovery quote in that country,
                // even when its newer price is higher than a cached featured/deals price.
                for (let index = offers.length - 1; index >= 0; index -= 1) {
                  if (offers[index].priceCountry === country && worldwideIdentity(offers[index]) === identity) offers.splice(index, 1)
                }
              }
              offers.push(valid)
            }
            else if (deal.priceCountry === country && deal.salePrice.currency !== 'USD' && !Number.isFinite(deal.salePrice.usd)) failed.add(country)
          }
        } catch (error) {
          failed.add(country)
          sourceStatus.push({ name: `${country} · Worldwide scan`, ok: false, updatedAt: new Date().toISOString(), message: error instanceof Error ? error.message : 'Country scan did not finish.' })
        }
      }
    }))
  }
  await phase(options.loadCountry)
  if (options.refineCountry && offers.length) {
    const discovered = [...offers]
    await phase((country, currentSignal) => options.refineCountry!(country, discovered, currentSignal), true)
  }
  for (const country of unsupportedCountries) sourceStatus.push({ name: `${country} · Storefront unsupported`, ok: false, updatedAt: new Date().toISOString(), message: `No supported storefront for ${country}; no foreign-country price was substituted.` })
  return {
    deals: lowestWorldwideOffers(offers), sourceStatus, stores: [...stores.values()],
    worldwide: { requestedCountries, checkedCountries: requestedCountries.filter((country) => checked.has(country)), failedCountries: requestedCountries.filter((country) => failed.has(country)), unsupportedCountries, partial: failed.size > 0 || unsupportedCountries.length > 0, scope: options.scope, discoveryLimited: true },
  }
}
