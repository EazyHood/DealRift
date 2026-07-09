import { readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import { z } from 'zod'
import {
  emptyPriceHistory,
  enrichDealsWithIntelligence,
  parsePriceHistory,
  priceHistoryStats,
  recordPriceObservations,
  type DealPriceHistoryDatabase,
} from './intelligence.js'
import { writeJsonAtomic } from './persistence.js'
import { isAllowedCorsOrigin, SECURITY_HEADERS } from './security.js'
import { storeSearchUrl, trustedStoreUrl } from './storeLinks.js'
import type {
  Deal,
  DealHistoryPoint,
  MarketScout,
  RadarMetrics,
  RadarResponse,
  RegionalPricePoint,
  RegionalScan,
  SourceKind,
  SourceStatus,
  StoreSummary,
} from '../src/shared/dealTypes.js'

const PORT = Number(process.env.PORT ?? 5174)
const USER_AGENT = process.env.RADAR_USER_AGENT ?? 'GameDealRadar/0.1 (local-dev; contact: local@example.invalid)'
const REFRESH_SECONDS = 300
const APP_VERSION = process.env.DEALRIFT_VERSION ?? '1.1.1-beta.1'
const dataDir = process.env.DEALRIFT_DATA_DIR ? path.resolve(process.env.DEALRIFT_DATA_DIR) : path.join(process.cwd(), 'data')
const historyFile = path.join(dataDir, 'deal-history.json')
const priceHistoryFile = path.join(dataDir, 'deal-price-history.json')

type CacheEntry<T> = { expiresAt: number; value: T; updatedAt: string }

const cache = new Map<string, CacheEntry<unknown>>()
let priceHistoryWriteQueue = Promise.resolve()

const cheapSharkBase = 'https://www.cheapshark.com/api/1.0'
const epicBase = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions'
const exchangeBase = 'https://open.er-api.com/v6/latest/USD'
const steamFeaturedBase = 'https://store.steampowered.com/api/featuredcategories'
const gogCatalogBase = 'https://catalog.gog.com/v1/catalog'

const countryNames: Record<string, string> = {
  AR: 'Argentina',
  AU: 'Australia',
  BR: 'Brazil',
  CA: 'Canada',
  CL: 'Chile',
  CN: 'China',
  CO: 'Colombia',
  DE: 'Germany',
  ES: 'Spain',
  GB: 'United Kingdom',
  HK: 'Hong Kong',
  ID: 'Indonesia',
  IN: 'India',
  JP: 'Japan',
  KR: 'South Korea',
  MX: 'Mexico',
  MY: 'Malaysia',
  PE: 'Peru',
  PH: 'Philippines',
  PL: 'Poland',
  SA: 'Saudi Arabia',
  SG: 'Singapore',
  TH: 'Thailand',
  TR: 'Turkiye',
  TW: 'Taiwan',
  US: 'United States',
  VN: 'Vietnam',
  ZA: 'South Africa',
}

const scanCountries = [
  'US',
  'CO',
  'IN',
  'TR',
  'AR',
  'BR',
  'MX',
  'CL',
  'PE',
  'ID',
  'MY',
  'PH',
  'TH',
  'VN',
  'ZA',
  'PL',
  'CN',
  'JP',
  'KR',
  'GB',
  'DE',
  'ES',
  'CA',
  'AU',
]

const gogCurrencyByCountry: Record<string, string> = {
  AU: 'AUD',
  CA: 'CAD',
  DE: 'EUR',
  ES: 'EUR',
  GB: 'GBP',
  PL: 'PLN',
  TR: 'TRY',
  US: 'USD',
}

const marketplaceTemplates = [
  {
    id: 'eneba',
    marketplace: 'Eneba',
    riskLevel: 'medium' as const,
    url: (query: string) => `https://www.eneba.com/store/all?text=${encodeURIComponent(query)}`,
  },
  {
    id: 'cdkeys',
    marketplace: 'CDKeys',
    riskLevel: 'medium' as const,
    url: (query: string) => `https://www.cdkeys.com/catalogsearch/result/?q=${encodeURIComponent(query)}`,
  },
  {
    id: 'kinguin',
    marketplace: 'Kinguin',
    riskLevel: 'high' as const,
    url: (query: string) => `https://www.kinguin.net/listing?active=1&hideUnavailable=1&phrase=${encodeURIComponent(query)}`,
  },
  {
    id: 'g2a',
    marketplace: 'G2A',
    riskLevel: 'high' as const,
    url: (query: string) => `https://www.g2a.com/search?query=${encodeURIComponent(query)}`,
  },
  {
    id: 'ggdeals',
    marketplace: 'GG.deals',
    riskLevel: 'medium' as const,
    url: (query: string) => `https://gg.deals/games/?title=${encodeURIComponent(query)}`,
  },
  {
    id: 'allkeyshop',
    marketplace: 'AllKeyShop',
    riskLevel: 'high' as const,
    url: (query: string) => `https://www.allkeyshop.com/blog/catalogue/search-${encodeURIComponent(query)}/`,
  },
  {
    id: 'steamdb',
    marketplace: 'SteamDB',
    riskLevel: 'low' as const,
    url: (query: string) => `https://steamdb.info/search/?a=app&q=${encodeURIComponent(query)}`,
  },
]

const querySchema = z.object({
  country: z.string().length(2).default('US').transform((value) => value.toUpperCase()),
  locale: z.string().default('en-US'),
  limit: z.coerce.number().int().min(10).max(120).default(70),
  minSavings: z.coerce.number().min(0).max(100).default(0),
  search: z.string().trim().max(80).optional().catch(undefined),
  regionSample: z.coerce.number().int().min(0).max(10).default(5),
})

const app = express()
app.disable('x-powered-by')
app.use((_req, res, next) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value)
  next()
})
app.use(cors({
  origin(origin, callback) {
    callback(null, isAllowedCorsOrigin(origin))
  },
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Accept', 'Content-Type'],
  maxAge: 86_400,
}))
app.use(compression())

function nowIso() {
  return new Date().toISOString()
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function parseMoney(value?: string | number) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatMoney(amount: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

function steamLanguage(locale: string) {
  return locale.toLowerCase().startsWith('es') ? 'spanish' : 'english'
}

function gogLocale(locale: string) {
  return locale.toLowerCase().startsWith('es') ? 'es-ES' : 'en-US'
}

function gogCurrency(country: string) {
  return gogCurrencyByCountry[country] ?? 'USD'
}

function titleMatches(title: string, search?: string) {
  if (!search) return true
  return title.toLowerCase().includes(search.toLowerCase())
}

async function withCache<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const existing = cache.get(key) as CacheEntry<T> | undefined
  if (existing && existing.expiresAt > Date.now()) {
    return existing.value
  }

  try {
    const value = await loader()
    cache.set(key, { expiresAt: Date.now() + ttlMs, value, updatedAt: nowIso() })
    return value
  } catch (error) {
    if (existing) return existing.value
    throw error
  }
}

async function fetchJson<T>(url: string, timeoutMs = 12000): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
      })

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }

      return (await response.json()) as T
    } catch (error) {
      lastError = error
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350))
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed.')
}

interface CheapSharkStore {
  storeID: string
  storeName: string
  isActive: number
  images?: { logo?: string }
}

interface CheapSharkDeal {
  title: string
  dealID: string
  storeID: string
  salePrice: string
  normalPrice: string
  savings: string
  dealRating: string
  metacriticScore?: string
  steamRatingPercent?: string
  steamRatingText?: string
  steamAppID?: string
  thumb?: string
  lastChange?: number
}

interface EpicPromotion {
  startDate?: string
  endDate?: string
  discountSetting?: {
    discountType?: string
    discountPercentage?: number
  }
}

interface EpicElement {
  title: string
  id: string
  productSlug?: string | null
  urlSlug?: string | null
  offerType?: string
  keyImages?: Array<{ type: string; url: string }>
  price?: {
    totalPrice?: {
      discountPrice?: number
      originalPrice?: number
      currencyCode?: string
      fmtPrice?: {
        originalPrice?: string
        discountPrice?: string
      }
    }
  }
  promotions?: {
    promotionalOffers?: Array<{ promotionalOffers: EpicPromotion[] }>
    upcomingPromotionalOffers?: Array<{ promotionalOffers: EpicPromotion[] }>
  }
}

interface EpicResponse {
  data?: {
    Catalog?: {
      searchStore?: {
        elements?: EpicElement[]
      }
    }
  }
}

interface SteamFeaturedItem {
  id: number
  type?: number
  name: string
  discount_percent?: number
  original_price?: number
  final_price?: number
  currency?: string
  large_capsule_image?: string
  header_image?: string
  discount_expiration?: number
  windows_available?: boolean
  mac_available?: boolean
  linux_available?: boolean
}

interface SteamFeaturedResponse {
  specials?: {
    items?: SteamFeaturedItem[]
  }
}

interface SteamAppDetails {
  success: boolean
  data?: {
    price_overview?: {
      currency: string
      initial: number
      final: number
      discount_percent: number
      initial_formatted?: string
      final_formatted?: string
    }
  }
}

interface GogMoney {
  amount?: string
  currency?: string
}

interface GogProduct {
  id: string
  slug?: string
  title: string
  productType?: string
  coverHorizontal?: string
  storeLink?: string
  operatingSystems?: string[]
  reviewsRating?: number
  reviewsCount?: number
  price?: {
    final?: string
    base?: string
    discount?: string
    finalMoney?: GogMoney
    baseMoney?: GogMoney
  }
}

interface GogCatalogResponse {
  products?: GogProduct[]
}

interface ExchangeResponse {
  result: string
  rates: Record<string, number>
  time_last_update_utc?: string
}

function storeKind(storeName: string): SourceKind {
  const official = ['Steam', 'Epic Games Store', 'GOG', 'Ubisoft Store', 'Uplay', 'Blizzard Shop']
  return official.some((name) => storeName.toLowerCase().includes(name.toLowerCase())) ? 'official' : 'authorized'
}

function sourceRisk(kind: SourceKind) {
  if (kind === 'marketplace') return 'high'
  if (kind === 'authorized') return 'low'
  return 'low'
}

function platformForStore(storeName: string, hasSteamMetadata: boolean) {
  const normalized = storeName.toLowerCase()
  if (normalized.includes('epic')) return 'PC / Epic'
  if (normalized.includes('gog')) return 'PC / GOG'
  if (normalized.includes('steam')) return 'PC / Steam'
  if (normalized.includes('ubisoft') || normalized.includes('uplay')) return 'PC / Ubisoft'
  if (normalized.includes('blizzard')) return 'PC / Battle.net'
  return hasSteamMetadata ? 'PC / store key' : 'PC'
}

function asStoreSummaries(stores: CheapSharkStore[]): StoreSummary[] {
  return stores.map((store) => ({
    id: store.storeID,
    name: store.storeName,
    isActive: store.isActive === 1,
    kind: storeKind(store.storeName),
    logoUrl: store.images?.logo ? `https://www.cheapshark.com${store.images.logo}` : undefined,
  }))
}

function mapCheapSharkDeal(deal: CheapSharkDeal, stores: Map<string, StoreSummary>): Deal {
  const store = stores.get(deal.storeID)
  const sale = Number(deal.salePrice)
  const normal = Number(deal.normalPrice)
  const savings = Number(deal.savings)
  const dealScore = Number(deal.dealRating)
  const metacriticScore = Number(deal.metacriticScore)
  const steamRatingPercent = Number(deal.steamRatingPercent)
  const sourceKind = store?.kind ?? 'authorized'
  const isDirectStoreLink = Boolean(deal.steamAppID && store?.name.toLowerCase().includes('steam'))
  const signalScore =
    Math.min(45, savings * 0.45) +
    Math.min(22, dealScore * 2.2) +
    (Number.isFinite(steamRatingPercent) ? Math.min(18, steamRatingPercent * 0.18) : 8) +
    (Number.isFinite(metacriticScore) ? Math.min(10, metacriticScore * 0.1) : 4) +
    (deal.steamAppID ? 5 : 0)

  return {
    id: `cheapshark-${deal.dealID}`,
    title: deal.title,
    source: store?.name ?? 'CheapShark',
    sourceKind,
    platform: platformForStore(store?.name ?? 'CheapShark', Boolean(deal.steamAppID)),
    image: deal.thumb ?? '',
    url: storeSearchUrl(store?.name ?? 'CheapShark', deal.title, deal.steamAppID || undefined),
    salePrice: {
      amount: sale,
      currency: 'USD',
      formatted: sale <= 0 ? 'Free' : `$${sale.toFixed(2)}`,
      usd: sale,
    },
    normalPrice: {
      amount: normal,
      currency: 'USD',
      formatted: `$${normal.toFixed(2)}`,
      usd: normal,
    },
    savingsPercent: Number.isFinite(savings) ? roundMoney(savings) : 0,
    dealScore: Number.isFinite(dealScore) ? dealScore : 0,
    signalScore: Math.round(signalScore),
    metacriticScore: Number.isFinite(metacriticScore) ? metacriticScore : undefined,
    steamRatingPercent: Number.isFinite(steamRatingPercent) ? steamRatingPercent : undefined,
    steamRatingText: deal.steamRatingText,
    steamAppId: deal.steamAppID || undefined,
    detectedAt: deal.lastChange ? new Date(deal.lastChange * 1000).toISOString() : nowIso(),
    isFree: sale <= 0,
    countries: ['US', 'Global'],
    riskLevel: sourceRisk(sourceKind),
    confidence: 'live-api',
    tags: [
      sourceKind,
      savings >= 80 ? 'deep-cut' : 'sale',
      deal.steamAppID && sale > 0 ? 'regional-scan-ready' : sale <= 0 ? 'free-game' : 'pc',
      isDirectStoreLink ? 'direct-store-link' : 'store-search-link',
    ],
    notes: [
      isDirectStoreLink
        ? 'Price comes from CheapShark; the link opens the product directly on Steam without a CheapShark redirect.'
        : 'Price comes from CheapShark; the link opens a clean search on the retailer because the feed does not expose a stable product URL.',
      deal.steamAppID && sale > 0
        ? 'Steam country scan can compare regional pricing for this paid offer.'
        : sale <= 0
          ? 'Free promotions do not need regional price comparison.'
          : 'No Steam app id was provided by the source.',
    ],
  }
}

function getEpicImage(element: EpicElement) {
  const preferred = ['OfferImageWide', 'DieselStoreFrontWide', 'featuredMedia', 'Thumbnail']
  for (const type of preferred) {
    const image = element.keyImages?.find((entry) => entry.type === type)
    if (image?.url) return image.url
  }
  return element.keyImages?.[0]?.url ?? ''
}

function epicPromos(element: EpicElement) {
  const current = element.promotions?.promotionalOffers?.flatMap((group) => group.promotionalOffers) ?? []
  const upcoming = element.promotions?.upcomingPromotionalOffers?.flatMap((group) => group.promotionalOffers) ?? []
  return { current, upcoming }
}

function epicUrl(element: EpicElement, locale: string) {
  const slug = element.productSlug ?? element.urlSlug ?? element.id
  const normalized = slug.replace(/\/home$/, '')
  return `https://store.epicgames.com/${locale}/p/${normalized}`
}

function mapEpicFreebies(response: EpicResponse, country: string, locale: string): Deal[] {
  const languagePath = locale.toLowerCase().startsWith('es') ? 'es-ES' : 'en-US'
  const elements = response.data?.Catalog?.searchStore?.elements ?? []
  const mapped: Deal[] = []

  for (const element of elements) {
    const { current, upcoming } = epicPromos(element)
    const promo = current[0] ?? upcoming[0]
    if (!promo) continue

    const discount = promo.discountSetting?.discountPercentage
    const isFree = discount === 0 || element.price?.totalPrice?.discountPrice === 0
    const isUpcoming = current.length === 0
    if (!isFree && discount !== 100) continue

    const originalAmount = (element.price?.totalPrice?.originalPrice ?? 0) / 100
    const currency = element.price?.totalPrice?.currencyCode ?? 'USD'

    mapped.push({
      id: `epic-${element.id}-${promo.startDate ?? 'now'}`,
      title: element.title,
      source: 'Epic Games Store',
      sourceKind: 'freebie',
      platform: 'PC / Epic',
      image: getEpicImage(element),
      url: epicUrl(element, languagePath),
      salePrice: {
        amount: 0,
        currency,
        formatted: 'Free',
        usd: currency === 'USD' ? 0 : undefined,
      },
      normalPrice: originalAmount
        ? {
            amount: originalAmount,
            currency,
            formatted: element.price?.totalPrice?.fmtPrice?.originalPrice ?? `${originalAmount.toFixed(2)} ${currency}`,
          }
        : undefined,
      savingsPercent: 100,
      dealScore: 10,
      signalScore: isUpcoming ? 86 : 96,
      startsAt: promo.startDate,
      expiresAt: promo.endDate,
      detectedAt: nowIso(),
      isFree: true,
      countries: [country],
      riskLevel: 'low',
      confidence: 'live-api',
      tags: ['free-game', isUpcoming ? 'upcoming' : 'claim-now', 'official'],
      notes: [
        isUpcoming ? 'Upcoming Epic giveaway detected.' : 'Active Epic giveaway detected.',
        `Country parameter checked as ${country}. Some Epic promotions can vary by country.`,
      ],
    })
  }

  return mapped
}

function mapSteamSpecials(response: SteamFeaturedResponse, country: string, locale: string, rates: Record<string, number>, search?: string): Deal[] {
  const items = response.specials?.items ?? []

  return items
    .filter((item) => item.name && item.type === 0 && (item.discount_percent ?? 0) > 0 && titleMatches(item.name, search))
    .map((item) => {
      const currency = item.currency ?? 'USD'
      const final = (item.final_price ?? 0) / 100
      const initial = (item.original_price ?? item.final_price ?? 0) / 100
      const savings = item.discount_percent ?? 0
      const usd = roundMoney(toUsd(final, currency, rates))
      const platform = [
        item.windows_available ? 'Windows' : '',
        item.mac_available ? 'Mac' : '',
        item.linux_available ? 'Linux' : '',
      ].filter(Boolean)

      return {
        id: `steam-special-${country}-${item.id}`,
        title: item.name,
        source: 'Steam',
        sourceKind: 'official',
        platform: platform.length ? `PC / Steam / ${platform.join(', ')}` : 'PC / Steam',
        image: item.large_capsule_image ?? item.header_image ?? '',
        url: `https://store.steampowered.com/app/${item.id}/?cc=${country.toLowerCase()}`,
        salePrice: {
          amount: final,
          currency,
          formatted: final <= 0 ? 'Free' : formatMoney(final, currency, locale),
          usd,
        },
        normalPrice: initial > final
          ? {
              amount: initial,
              currency,
              formatted: formatMoney(initial, currency, locale),
              usd: roundMoney(toUsd(initial, currency, rates)),
            }
          : undefined,
        savingsPercent: savings,
        dealScore: roundMoney(Math.min(10, savings / 10)),
        signalScore: Math.min(100, Math.round(34 + savings * 0.55 + (usd <= 10 ? 12 : usd <= 25 ? 7 : 2))),
        steamAppId: String(item.id),
        expiresAt: item.discount_expiration ? new Date(item.discount_expiration * 1000).toISOString() : undefined,
        detectedAt: nowIso(),
        isFree: final <= 0,
        countries: [country],
        riskLevel: 'low',
        confidence: 'live-api',
        tags: ['official', 'steam-specials', final > 0 ? 'regional-scan-ready' : 'free-game'],
        notes: [
          `Official Steam specials feed checked with country ${country}.`,
          'The buy link opens Steam directly with the selected country code.',
        ],
      } satisfies Deal
    })
}

function mapGogDeals(response: GogCatalogResponse, country: string, locale: string, rates: Record<string, number>, search?: string): Deal[] {
  const products = response.products ?? []

  return products
    .filter((product) => {
      const productType = product.productType ?? 'game'
      return ['game', 'pack'].includes(productType) && titleMatches(product.title, search)
    })
    .map((product) => {
      const currency = product.price?.finalMoney?.currency ?? product.price?.baseMoney?.currency ?? gogCurrency(country)
      const final = parseMoney(product.price?.finalMoney?.amount)
      const initial = parseMoney(product.price?.baseMoney?.amount) || final
      const savings = parseMoney(product.price?.discount?.replace(/[^0-9.]/g, ''))
      const usd = roundMoney(toUsd(final, currency, rates))
      const slug = product.slug ?? product.id

      return {
        id: `gog-${country}-${product.id}`,
        title: product.title,
        source: 'GOG',
        sourceKind: 'official',
        platform: product.operatingSystems?.length ? `PC / GOG / ${product.operatingSystems.join(', ')}` : 'PC / GOG',
        image: product.coverHorizontal ?? '',
        url: trustedStoreUrl(
          product.storeLink,
          `https://www.gog.com/${gogLocale(locale) === 'es-ES' ? 'es' : 'en'}/game/${slug}`,
        ),
        salePrice: {
          amount: final,
          currency,
          formatted: final <= 0 ? 'Free' : product.price?.final ?? formatMoney(final, currency, locale),
          usd,
        },
        normalPrice: initial > final
          ? {
              amount: initial,
              currency,
              formatted: product.price?.base ?? formatMoney(initial, currency, locale),
              usd: roundMoney(toUsd(initial, currency, rates)),
            }
          : undefined,
        savingsPercent: savings,
        dealScore: roundMoney(Math.min(10, savings / 10)),
        signalScore: Math.min(100, Math.round(32 + savings * 0.58 + (usd <= 5 ? 14 : usd <= 15 ? 9 : 3))),
        detectedAt: nowIso(),
        isFree: final <= 0,
        countries: [country],
        riskLevel: 'low',
        confidence: 'live-api',
        tags: ['official', 'gog-catalog', 'drm-free', product.productType ?? 'game'],
        notes: [
          `GOG discounted catalog checked with country ${country} and currency ${currency}.`,
          'GOG links are direct product links from the catalog response.',
        ],
      } satisfies Deal
    })
}

async function getStores() {
  return withCache('cheapshark-stores', 60 * 60 * 1000, async () => {
    const stores = await fetchJson<CheapSharkStore[]>(`${cheapSharkBase}/stores`)
    return asStoreSummaries(stores).filter((store) => store.isActive)
  })
}

async function getCheapSharkDeals(limit: number, minSavings: number, search?: string) {
  const params = new URLSearchParams({
    sortBy: 'Deal Rating',
    pageSize: String(limit),
    onSale: '1',
  })

  if (search) params.set('title', search)
  if (minSavings > 0) params.set('lowerPrice', '0')

  const cacheKey = `cheapshark-deals:${limit}:${minSavings}:${search ?? ''}`
  return withCache(cacheKey, REFRESH_SECONDS * 1000, async () => {
    const [stores, deals] = await Promise.all([
      getStores(),
      fetchJson<CheapSharkDeal[]>(`${cheapSharkBase}/deals?${params.toString()}`),
    ])

    const storeMap = new Map(stores.map((store) => [store.id, store]))
    return deals.map((deal) => mapCheapSharkDeal(deal, storeMap)).filter((deal) => deal.savingsPercent >= minSavings)
  })
}

async function getEpicDeals(country: string, locale: string) {
  const cacheKey = `epic-free:${country}:${locale}`
  return withCache(cacheKey, REFRESH_SECONDS * 1000, async () => {
    const params = new URLSearchParams({
      locale,
      country,
      allowCountries: country,
    })
    const response = await fetchJson<EpicResponse>(`${epicBase}?${params.toString()}`)
    return mapEpicFreebies(response, country, locale)
  })
}

async function getSteamSpecials(country: string, locale: string, limit: number, minSavings: number, search?: string) {
  const cacheKey = `steam-specials:${country}:${locale}:${limit}:${minSavings}:${search ?? ''}`
  return withCache(cacheKey, REFRESH_SECONDS * 1000, async () => {
    const params = new URLSearchParams({
      cc: country.toLowerCase(),
      l: steamLanguage(locale),
    })
    const [rates, response] = await Promise.all([
      getExchangeRates(),
      fetchJson<SteamFeaturedResponse>(`${steamFeaturedBase}?${params.toString()}`),
    ])

    return mapSteamSpecials(response, country, locale, rates, search)
      .filter((deal) => deal.savingsPercent >= minSavings)
      .slice(0, Math.min(limit, 50))
  })
}

async function getGogDeals(country: string, locale: string, limit: number, minSavings: number, search?: string) {
  const cacheKey = `gog-catalog:${country}:${locale}:${limit}:${minSavings}:${search ?? ''}`
  return withCache(cacheKey, REFRESH_SECONDS * 1000, async () => {
    const currency = gogCurrency(country)
    const params = new URLSearchParams({
      limit: String(Math.min(limit * 2, 100)),
      order: 'desc:discount',
      discounted: 'true',
      countryCode: country,
      locale: gogLocale(locale),
      currencyCode: currency,
    })
    const [rates, response] = await Promise.all([
      getExchangeRates(),
      fetchJson<GogCatalogResponse>(`${gogCatalogBase}?${params.toString()}`),
    ])

    return mapGogDeals(response, country, locale, rates, search)
      .filter((deal) => deal.savingsPercent >= minSavings)
      .slice(0, Math.min(limit, 50))
  })
}

async function getExchangeRates() {
  return withCache('exchange-rates-usd', 6 * 60 * 60 * 1000, async () => {
    const response = await fetchJson<ExchangeResponse>(exchangeBase)
    if (response.result !== 'success') {
      throw new Error('Exchange rate provider did not return success.')
    }
    return response.rates
  })
}

function toUsd(amount: number, currency: string, rates: Record<string, number>) {
  if (currency === 'USD') return amount
  const rate = rates[currency]
  return rate ? amount / rate : amount
}

async function fetchSteamCountryPrice(
  appId: string,
  countryCode: string,
  baselineCountry: string,
  rates: Record<string, number>,
): Promise<RegionalPricePoint> {
  const response = await fetchJson<Record<string, SteamAppDetails>>(
    `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&cc=${countryCode.toLowerCase()}&filters=price_overview`,
    9000,
  )

  const price = response[appId]?.data?.price_overview
  if (!price) {
    return {
      countryCode,
      countryName: countryNames[countryCode] ?? countryCode,
      currency: 'N/A',
      final: 0,
      initial: 0,
      finalFormatted: 'Unavailable',
      discountPercent: 0,
      usd: 0,
      relativeToBaselinePercent: 0,
      storeUrl: `https://store.steampowered.com/app/${appId}/?cc=${countryCode.toLowerCase()}`,
      available: false,
    } satisfies RegionalPricePoint
  }

  const final = price.final / 100
  const initial = price.initial / 100
  const usd = toUsd(final, price.currency, rates)

  return {
    countryCode,
    countryName: countryNames[countryCode] ?? countryCode,
    currency: price.currency,
    final,
    initial,
    finalFormatted: price.final_formatted || `${final.toFixed(2)} ${price.currency}`,
    initialFormatted: price.initial_formatted,
    discountPercent: price.discount_percent,
    usd: roundMoney(usd),
    relativeToBaselinePercent: countryCode === baselineCountry ? 0 : 0,
    storeUrl: `https://store.steampowered.com/app/${appId}/?cc=${countryCode.toLowerCase()}`,
    available: true,
  } satisfies RegionalPricePoint
}

async function getRegionalScan(appId: string, title: string, baselineCountry = 'US'): Promise<RegionalScan> {
  const countries = Array.from(new Set([baselineCountry, ...scanCountries])).slice(0, 28)
  const cacheKey = `steam-region:${appId}:${baselineCountry}:${countries.join(',')}`

  return withCache<RegionalScan>(cacheKey, 15 * 60 * 1000, async () => {
    const rates = await getExchangeRates()
    const settled = await Promise.allSettled(
      countries.map((country) => fetchSteamCountryPrice(appId, country, baselineCountry, rates)),
    )

    const rows = settled
      .filter((entry): entry is PromiseFulfilledResult<RegionalPricePoint> => entry.status === 'fulfilled')
      .map((entry) => entry.value)

    const available = rows.filter((row) => row.available && row.usd > 0)
    const baseline = available.find((row) => row.countryCode === baselineCountry) ?? available.find((row) => row.countryCode === 'US')
    const baselineUsd = baseline?.usd ?? available[0]?.usd ?? 0

    const normalized = rows
      .map((row) => ({
        ...row,
        relativeToBaselinePercent:
          row.available && baselineUsd > 0 ? roundMoney(((row.usd - baselineUsd) / baselineUsd) * 100) : 0,
      }))
      .sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1
        return a.usd - b.usd
      })

    return {
      appId,
      title,
      baselineCountry,
      updatedAt: nowIso(),
      best: normalized.find((row) => row.available && row.usd > 0),
      rows: normalized,
    } satisfies RegionalScan
  })
}

function attachRegionalHighlights(deals: Deal[], scans: RegionalScan[]) {
  const byApp = new Map(scans.map((scan) => [scan.appId, scan]))

  return deals.map((deal) => {
    if (!deal.steamAppId || deal.isFree) return deal
    const scan = byApp.get(deal.steamAppId)
    const best = scan?.best
    const currentUsd = deal.salePrice.usd ?? deal.salePrice.amount
    if (!best || best.relativeToBaselinePercent >= -5 || currentUsd <= 0 || best.usd >= currentUsd * 0.98) return deal

    return {
      ...deal,
      bestRegion: best,
      signalScore: Math.min(100, deal.signalScore + Math.min(18, Math.abs(best.relativeToBaselinePercent) * 0.35)),
      sourceKind: deal.sourceKind,
      tags: Array.from(new Set([...deal.tags, 'regional-opportunity'])),
      notes: [
        ...deal.notes,
        `${best.countryName} is currently about ${Math.abs(best.relativeToBaselinePercent).toFixed(1)}% below the baseline Steam country price.`,
      ],
    } satisfies Deal
  })
}

function dedupeDeals(deals: Deal[]) {
  const byKey = new Map<string, Deal>()

  for (const deal of deals) {
    const titleKey = deal.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const key = `${deal.source.toLowerCase()}:title:${titleKey}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, deal)
      continue
    }

    const dealPrice = deal.salePrice.usd ?? deal.salePrice.amount
    const existingPrice = existing.salePrice.usd ?? existing.salePrice.amount
    const dealIsDirect = !deal.tags.includes('store-search-link')
    const existingIsDirect = !existing.tags.includes('store-search-link')
    if (
      (dealIsDirect && !existingIsDirect) ||
      (dealIsDirect === existingIsDirect && (dealPrice < existingPrice || (dealPrice === existingPrice && deal.signalScore > existing.signalScore)))
    ) {
      byKey.set(key, deal)
    }
  }

  return Array.from(byKey.values())
}

function buildMarketScouts(deals: Deal[], search?: string): MarketScout[] {
  const titles = Array.from(
    new Set([
      search,
      ...deals
        .filter((deal) => deal.signalScore > 70 || deal.savingsPercent > 65 || deal.isFree)
        .slice(0, 4)
        .map((deal) => deal.title),
      'EA Sports FC 25',
    ].filter(Boolean) as string[]),
  ).slice(0, 5)

  return titles.flatMap((title) =>
    marketplaceTemplates.map((market) => ({
      id: `${market.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title,
      marketplace: market.marketplace,
      url: market.url(title),
      riskLevel: market.riskLevel,
      confidence: 'search-link',
      countryHint: 'Check activation country, key type, taxes, and seller rating before buying.',
      notes: [
        'Marketplace search link generated locally because this store does not expose a stable public deals API.',
        'Prices and activation regions must be verified on the marketplace page.',
      ],
    })),
  )
}

function metricsFor(deals: Deal[], regionalScans: RegionalScan[]): RadarMetrics {
  const savings = deals.map((deal) => deal.savingsPercent).filter(Number.isFinite)
  const bestCountries = regionalScans
    .map((scan) => scan.best)
    .filter((best): best is RegionalPricePoint => Boolean(best))
    .filter((best) => best.relativeToBaselinePercent < -5)

  return {
    totalDeals: deals.length,
    freebies: deals.filter((deal) => deal.isFree).length,
    maxSavings: Math.max(0, ...savings),
    officialDeals: deals.filter((deal) => deal.sourceKind === 'official' || deal.sourceKind === 'freebie').length,
    regionalOpportunities: bestCountries.length,
    averageSavings: roundMoney(savings.reduce((sum, value) => sum + value, 0) / Math.max(1, savings.length)),
    bestRegionalCountry: bestCountries.sort((a, b) => a.usd - b.usd)[0]?.countryName,
  }
}

function status(name: string, ok: boolean, message: string): SourceStatus {
  return { name, ok, message, updatedAt: nowIso() }
}

async function readHistory(): Promise<DealHistoryPoint[]> {
  try {
    const raw = await readFile(historyFile, 'utf8')
    const parsed = JSON.parse(raw) as DealHistoryPoint[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeHistory(points: DealHistoryPoint[]) {
  await writeJsonAtomic(historyFile, points)
}

async function recordHistory(response: RadarResponse) {
  const topDeal = response.deals[0]
  const nextPoint: DealHistoryPoint = {
    updatedAt: response.updatedAt,
    totalDeals: response.metrics.totalDeals,
    freebies: response.metrics.freebies,
    maxSavings: response.metrics.maxSavings,
    regionalOpportunities: response.metrics.regionalOpportunities,
    topDealTitle: topDeal?.title,
    topDealPrice: topDeal?.salePrice.formatted,
  }

  const history = await readHistory()
  const withoutSameMinute = history.filter((point) => point.updatedAt.slice(0, 16) !== nextPoint.updatedAt.slice(0, 16))
  await writeHistory([...withoutSameMinute, nextPoint].slice(-144))
}

async function readPriceHistory(): Promise<DealPriceHistoryDatabase> {
  try {
    return parsePriceHistory(JSON.parse(await readFile(priceHistoryFile, 'utf8')))
  } catch {
    return emptyPriceHistory()
  }
}

function writePriceHistory(database: DealPriceHistoryDatabase) {
  const write = async () => {
    await writeJsonAtomic(priceHistoryFile, database)
  }
  priceHistoryWriteQueue = priceHistoryWriteQueue.then(write, write)
  return priceHistoryWriteQueue
}

app.get('/api/health', async (_req, res) => {
  const intelligenceHistory = priceHistoryStats(await readPriceHistory())
  res.json({
    ok: true,
    updatedAt: nowIso(),
    refreshSeconds: REFRESH_SECONDS,
    cacheEntries: cache.size,
    dataDir,
    version: APP_VERSION,
    intelligenceHistory,
  })
})

app.get('/api/history', async (_req, res) => {
  res.json(await readHistory())
})

app.get('/api/stores', async (_req, res) => {
  try {
    res.json(await getStores())
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to load stores.' })
  }
})

app.get('/api/regions/:appId', async (req, res) => {
  const appId = req.params.appId
  const country = String(req.query.country ?? 'US').slice(0, 2).toUpperCase()
  const title = String(req.query.title ?? `Steam app ${appId}`)

  try {
    res.json(await getRegionalScan(appId, title, country))
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to scan Steam regions.' })
  }
})

app.get('/api/radar', async (req, res) => {
  const parsed = querySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() })
    return
  }

  const { country, locale, limit, minSavings, search, regionSample } = parsed.data
  const sourceStatus: SourceStatus[] = []

  const [storesResult, cheapResult, epicResult, steamResult, gogResult] = await Promise.allSettled([
    getStores(),
    getCheapSharkDeals(limit, minSavings, search),
    getEpicDeals(country, locale),
    getSteamSpecials(country, locale, limit, minSavings, search),
    getGogDeals(country, locale, limit, minSavings, search),
  ])

  const stores = storesResult.status === 'fulfilled' ? storesResult.value : []
  sourceStatus.push(
    storesResult.status === 'fulfilled'
      ? status('CheapShark stores', true, 'Store index loaded.')
      : status('CheapShark stores', false, storesResult.reason instanceof Error ? storesResult.reason.message : 'Store index failed.'),
  )

  const cheapDeals = cheapResult.status === 'fulfilled' ? cheapResult.value : []
  sourceStatus.push(
    cheapResult.status === 'fulfilled'
      ? status('CheapShark deals', true, `${cheapDeals.length} live deals loaded.`)
      : status('CheapShark deals', false, cheapResult.reason instanceof Error ? cheapResult.reason.message : 'Deals failed.'),
  )

  const epicDeals = epicResult.status === 'fulfilled' ? epicResult.value : []
  sourceStatus.push(
    epicResult.status === 'fulfilled'
      ? status('Epic giveaways', true, `${epicDeals.length} giveaways loaded for ${country}.`)
      : status('Epic giveaways', false, epicResult.reason instanceof Error ? epicResult.reason.message : 'Epic promotions failed.'),
  )

  const steamDeals = steamResult.status === 'fulfilled' ? steamResult.value : []
  sourceStatus.push(
    steamResult.status === 'fulfilled'
      ? status('Steam specials', true, `${steamDeals.length} official specials loaded for ${country}.`)
      : status('Steam specials', false, steamResult.reason instanceof Error ? steamResult.reason.message : 'Steam specials failed.'),
  )

  const gogDeals = gogResult.status === 'fulfilled' ? gogResult.value : []
  sourceStatus.push(
    gogResult.status === 'fulfilled'
      ? status('GOG catalog', true, `${gogDeals.length} discounted catalog entries loaded for ${country}.`)
      : status('GOG catalog', false, gogResult.reason instanceof Error ? gogResult.reason.message : 'GOG catalog failed.'),
  )

  const seenRegionalApps = new Set<string>()
  const regionTargets = [...cheapDeals, ...steamDeals]
    .filter((deal) => deal.steamAppId && !deal.isFree)
    .sort((a, b) => b.signalScore - a.signalScore)
    .filter((deal) => {
      if (!deal.steamAppId || seenRegionalApps.has(deal.steamAppId)) return false
      seenRegionalApps.add(deal.steamAppId)
      return true
    })
    .slice(0, regionSample)

  const regionalSettled = await Promise.allSettled(
    regionTargets.map((deal) => getRegionalScan(deal.steamAppId!, deal.title, country)),
  )

  const regionalScans = regionalSettled
    .filter((entry): entry is PromiseFulfilledResult<RegionalScan> => entry.status === 'fulfilled')
    .map((entry) => entry.value)

  const regionalFailures = regionalSettled.filter((entry) => entry.status === 'rejected').length
  sourceStatus.push(
    regionalFailures === 0
      ? status('Steam regional scan', true, `${regionalScans.length} games compared across countries.`)
      : status('Steam regional scan', false, `${regionalScans.length} scans loaded, ${regionalFailures} failed.`),
  )

  const baseDeals = attachRegionalHighlights(dedupeDeals([...epicDeals, ...steamDeals, ...gogDeals, ...cheapDeals]), regionalScans)
  const priceHistory = await readPriceHistory()
  const allDeals = enrichDealsWithIntelligence(baseDeals, country, priceHistory)
    .sort((a, b) => (b.intelligence?.score ?? b.signalScore) - (a.intelligence?.score ?? a.signalScore) || b.signalScore - a.signalScore)
    .slice(0, limit)

  const nextPriceHistory = recordPriceObservations(priceHistory, allDeals, country)
  try {
    await writePriceHistory(nextPriceHistory)
    const intelligenceStats = priceHistoryStats(nextPriceHistory)
    sourceStatus.push(status('Deal intelligence', true, `${intelligenceStats.games} games and ${intelligenceStats.observations} price observations available.`))
  } catch (historyError) {
    sourceStatus.push(status('Deal intelligence', false, historyError instanceof Error ? historyError.message : 'Unable to save price intelligence.'))
  }

  const marketScouts = buildMarketScouts(allDeals, search)
  sourceStatus.push(status('Marketplace scouts', true, `${marketScouts.length} marketplace comparison routes prepared across ${marketplaceTemplates.length} services.`))

  const directLinks = allDeals.filter((deal) => !deal.tags.includes('store-search-link')).length
  sourceStatus.push(status('Destination links', true, `${directLinks} direct product links and ${allDeals.length - directLinks} clean retailer searches prepared.`))

  const response: RadarResponse = {
    updatedAt: nowIso(),
    refreshSeconds: REFRESH_SECONDS,
    country,
    locale,
    deals: allDeals,
    stores,
    regionalScans,
    marketScouts,
    metrics: metricsFor(allDeals, regionalScans),
    sourceStatus,
  }

  await recordHistory(response)
  res.json(response)
})

let staticFilesConfigured = false

function configureStaticFiles(staticDir?: string) {
  if (!staticDir || staticFilesConfigured) return

  app.use(express.static(staticDir))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      next()
      return
    }

    res.sendFile(path.join(staticDir, 'index.html'))
  })
  staticFilesConfigured = true
}

export interface StartRadarServerOptions {
  port?: number
  host?: string
  staticDir?: string
}

export function startRadarServer(options: StartRadarServerOptions = {}) {
  const port = options.port ?? PORT
  const host = options.host ?? '127.0.0.1'
  configureStaticFiles(options.staticDir)

  return new Promise<{ server: ReturnType<typeof app.listen>; port: number; host: string }>((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address() as AddressInfo | null
      resolve({ server, port: address?.port ?? port, host })
    })
    server.on('error', reject)
  })
}
