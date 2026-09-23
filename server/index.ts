import { readFile } from 'node:fs/promises'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import { z } from 'zod'
import {
  emptyPriceHistory,
  enrichDealsWithIntelligence,
  canonicalGameKey,
  isCurrentVerifiedDeal,
  parsePriceHistory,
  priceHistoryStats,
  recordPriceObservations,
  type DealPriceHistoryDatabase,
} from './intelligence.js'
import { writeJsonAtomic } from './persistence.js'
import { registerLibraryRoutes } from './library.js'
import { enrichPlayStationWinnerRatings, fetchPlayStationDeals, supportedPlayStationCountries } from './playstation.js'
import { fetchXboxDeals } from './xbox.js'
import { scanWorldwide, verifiedWorldwideOffer, WORLDWIDE_COUNTRIES, type CountryOffers } from './worldwide.js'
import { gameIdentity } from '../src/shared/gameIdentity.js'
import { isAllowedCorsOrigin, SECURITY_HEADERS } from './security.js'
import { cheapSharkDealUrl, trustedStoreUrl } from './storeLinks.js'
import type { GameHistoryResponse } from '../src/shared/libraryTypes.js'
import type {
  Deal,
  GameEcosystem,
  PriceScope,
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
const USER_AGENT = process.env.RADAR_USER_AGENT ?? 'DealRift/1.4 (https://github.com/EazyHood/DealRift)'
const REFRESH_SECONDS = 300
const APP_VERSION = process.env.DEALRIFT_VERSION ?? '1.4.0-beta.1'
const dataDir = process.env.DEALRIFT_DATA_DIR ? path.resolve(process.env.DEALRIFT_DATA_DIR) : path.join(process.cwd(), 'data')
const historyFile = path.join(dataDir, 'deal-history.json')
const priceHistoryFile = path.join(dataDir, 'deal-price-history.json')

type CacheEntry<T> = { expiresAt: number; value: T; updatedAt: string }
type Cached<T> = { value: T; updatedAt: string; stale: boolean; error?: string }

const cache = new Map<string, CacheEntry<unknown>>()
let priceHistoryWriteQueue = Promise.resolve()
let historyWriteQueue = Promise.resolve()
const cacheLoads = new Map<string, Promise<Cached<unknown>>>()
const requestContext = new AsyncLocalStorage<AbortSignal>()

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
  ecosystem: z.enum(['pc', 'playstation', 'xbox']).default('pc'),
  priceScope: z.enum(['country', 'worldwide']).default('country'),
  onlyFree: z.preprocess((value) => value === 'true' ? true : value === 'false' ? false : value, z.boolean().default(false)),
  country: z.string().regex(/^[a-zA-Z]{2}$/).default('US').transform((value) => value.toUpperCase()),
  locale: z.string().min(2).max(35).regex(/^[a-zA-Z0-9-]+$/).default('en-US'),
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
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Accept', 'Content-Type'],
  maxAge: 86_400,
}))
app.use(compression())

function nowIso() {
  return new Date(Date.now()).toISOString()
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
  const normalizedTitle = canonicalGameKey(title).replace(/-/g, ' ')
  const normalizedSearch = canonicalGameKey(search).replace(/-/g, ' ')
  return (` ${normalizedTitle}`).includes(` ${normalizedSearch}`)
}

async function withCache<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<Cached<T>> {
  const existing = cache.get(key) as CacheEntry<T> | undefined
  if (existing && existing.expiresAt > Date.now()) {
    return { value: existing.value, updatedAt: existing.updatedAt, stale: false }
  }
  const pending = cacheLoads.get(key)
  if (pending) return pending as Promise<Cached<T>>
  const load = (async (): Promise<Cached<T>> => {
    try {
      const value = await loader()
      const updatedAt = nowIso()
      cache.set(key, { expiresAt: Date.now() + ttlMs, value, updatedAt })
      return { value, updatedAt, stale: false }
    } catch (error) {
      if (existing) return { value: existing.value, updatedAt: existing.updatedAt, stale: true, error: error instanceof Error ? error.message : 'Source refresh failed.' }
      throw error
    }
  })()
  cacheLoads.set(key, load)
  try { return await load } finally { cacheLoads.delete(key) }
}

async function fetchJson<T>(url: string, timeoutMs = 12000): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        signal: requestContext.getStore() ? AbortSignal.any([controller.signal, requestContext.getStore()!]) : controller.signal,
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
      if (requestContext.getStore()?.aborted) throw error
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
    name?: string
    type?: string
    header_image?: string
    platforms?: { windows?: boolean; mac?: boolean; linux?: boolean }
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
    url: cheapSharkDealUrl(deal.dealID),
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
    countries: ['US'],
    priceCountry: 'US',
    riskLevel: sourceRisk(sourceKind),
    confidence: 'live-api',
    tags: [
      sourceKind,
      savings >= 80 ? 'deep-cut' : 'sale',
      deal.steamAppID && sale > 0 ? 'regional-scan-ready' : sale <= 0 ? 'free-game' : 'pc',
      'provider-redirect',
    ],
    notes: [
      'US reference price from CheapShark. The required CheapShark redirect opens the retailer offer; verify activation region and checkout price.',
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
    const time = Date.now()
    const validPromos = [...current, ...upcoming].filter((promo) =>
      promo.discountSetting?.discountPercentage === 0 && promo.startDate && promo.endDate
      && Number.isFinite(Date.parse(promo.startDate)) && Date.parse(promo.endDate) > time,
    ).sort((a, b) => Date.parse(a.startDate!) - Date.parse(b.startDate!))
    const promo = validPromos[0]
    if (!promo) continue
    const isUpcoming = Date.parse(promo.startDate!) > time

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
        formatted: isUpcoming ? 'Upcoming giveaway' : 'Free',
        usd: 0,
      },
      normalPrice: originalAmount
        ? {
            amount: originalAmount,
            currency,
            formatted: element.price?.totalPrice?.fmtPrice?.originalPrice ?? `${originalAmount.toFixed(2)} ${currency}`,
          }
        : undefined,
      savingsPercent: isUpcoming ? 0 : 100,
      dealScore: isUpcoming ? 0 : 10,
      signalScore: isUpcoming ? 0 : 96,
      startsAt: promo.startDate,
      expiresAt: promo.endDate,
      detectedAt: nowIso(),
      isFree: !isUpcoming,
      countries: [country],
      priceCountry: country,
      availability: isUpcoming ? 'upcoming' : 'active',
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

function mapSteamSpecials(response: SteamFeaturedResponse, country: string, locale: string, rates: Record<string, number>, search?: string, includeFullPrice = false): Deal[] {
  const items = response.specials?.items ?? []

  return items
    .filter((item) => item.name && item.type === 0 && typeof item.final_price === 'number' && Number.isFinite(item.final_price) && item.final_price >= 0 && (includeFullPrice || (item.discount_percent ?? 0) > 0) && titleMatches(item.name, search))
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
        priceCountry: country,
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
      const amount = product.price?.finalMoney?.amount
      return ['game', 'pack'].includes(productType) && amount !== undefined && amount !== '' && Number.isFinite(Number(amount)) && Number(amount) >= 0 && titleMatches(product.title, search)
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
        storeProductId: product.id,
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
        priceCountry: country,
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

    const storeMap = new Map(stores.value.map((store) => [store.id, store]))
    return deals.filter((deal) => titleMatches(deal.title, search)).map((deal) => mapCheapSharkDeal(deal, storeMap)).filter((deal) => deal.savingsPercent >= minSavings)
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

    if (rates.stale) throw new Error(`Exchange rates unavailable: ${rates.error}`)
    return mapSteamSpecials(response, country, locale, rates.value, search)
      .filter((deal) => deal.savingsPercent >= minSavings)
      .slice(0, Math.min(limit, 50))
  })
}

async function getGogDeals(country: string, locale: string, limit: number, minSavings: number, search?: string, includeFullPrice = false) {
  const cacheKey = `gog-catalog:${country}:${locale}:${limit}:${minSavings}:${search ?? ''}:${includeFullPrice}`
  return withCache(cacheKey, REFRESH_SECONDS * 1000, async () => {
    const currency = gogCurrency(country)
    const params = new URLSearchParams({
      limit: String(Math.min(limit * 2, 100)),
      order: 'desc:discount',
      discounted: 'eq:true',
      countryCode: country,
      locale: gogLocale(locale),
      currencyCode: currency,
    })
    if (includeFullPrice && search) params.delete('discounted')
    if (search) params.set('query', `like:${search}`)
    const [rates, response] = await Promise.all([
      getExchangeRates(),
      fetchJson<GogCatalogResponse>(`${gogCatalogBase}?${params.toString()}`),
    ])

    if (rates.stale) throw new Error(`Exchange rates unavailable: ${rates.error}`)
    return mapGogDeals(response, country, locale, rates.value, search)
      .filter((deal) => deal.savingsPercent >= minSavings)
      .slice(0, Math.min(limit, 50))
  })
}

async function getSteamSearchDetails(country: string, locale: string, search: string, discovered: Array<Pick<Deal, 'steamAppId'>>, concurrency = 8) {
  const explicitId = search.match(/^(?:steam:)?(\d{1,10})$/i)?.[1]
  const appIds = [...new Set(explicitId ? [explicitId] : discovered.map((deal) => deal.steamAppId).filter((id): id is string => Boolean(id && /^\d{1,10}$/.test(id))))].slice(0, 8)
  return withCache(`steam-lookup:${country}:${locale}:${search}:${appIds.join(',')}`, REFRESH_SECONDS * 1000, async () => {
    if (appIds.length === 0) return [] as Deal[]
    const rates = await getExchangeRates()
    if (rates.stale) throw new Error(`Exchange rates unavailable: ${rates.error}`)
    const lookup = async (appId: string) => {
      const params = new URLSearchParams({ appids: appId, cc: country.toLowerCase(), l: steamLanguage(locale), filters: 'basic,price_overview,platforms' })
      const response = await fetchJson<Record<string, SteamAppDetails>>(`https://store.steampowered.com/api/appdetails?${params}`)
      const item = response[appId]
      const data = item?.data
      const price = data?.price_overview
      if (!item?.success || !data?.name || data.type !== 'game' || !price) return []
      return mapSteamSpecials({ specials: { items: [{
        id: Number(appId), type: 0, name: data.name, header_image: data.header_image,
        currency: price.currency, original_price: price.initial, final_price: price.final,
        discount_percent: price.discount_percent, windows_available: data.platforms?.windows,
        mac_available: data.platforms?.mac, linux_available: data.platforms?.linux,
      }] } }, country, locale, rates.value, explicitId ? undefined : search, true).map((deal) => ({
        ...deal, tags: deal.tags.filter((tag) => tag !== 'steam-specials').concat('steam-product-lookup'),
        notes: [`Steam product price checked for app ${appId} in ${country}. Search discovery is limited to IDs supplied by CheapShark or an explicit Steam app ID.`],
      }))
    }
    const rows: Deal[][] = Array.from({ length: appIds.length }, () => [])
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(concurrency, appIds.length) }, async () => {
      while (cursor < appIds.length) {
        const index = cursor++
        rows[index] = await lookup(appIds[index])
      }
    }))
    return rows.flat()
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
  if (!rate || !Number.isFinite(rate) || rate <= 0) throw new Error(`No reliable USD exchange rate for ${currency}.`)
  return amount / rate
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

async function getRegionalScan(appId: string, title: string, baselineCountry = 'US'): Promise<Cached<RegionalScan>> {
  const countries = Array.from(new Set([baselineCountry, ...scanCountries])).slice(0, 28)
  const cacheKey = `steam-region:${appId}:${baselineCountry}:${countries.join(',')}`

  return withCache<RegionalScan>(cacheKey, 15 * 60 * 1000, async () => {
    const rates = await getExchangeRates()
    if (rates.stale) throw new Error(`Exchange rates unavailable: ${rates.error}`)
    const settled = await Promise.allSettled(
      countries.map((country) => fetchSteamCountryPrice(appId, country, baselineCountry, rates.value)),
    )

    const rows = settled
      .filter((entry): entry is PromiseFulfilledResult<RegionalPricePoint> => entry.status === 'fulfilled')
      .map((entry) => entry.value)
    if (rows.length === 0) throw new Error('Steam regional prices are unavailable.')

    const available = rows.filter((row) => row.available && row.usd > 0)
    const baseline = available.find((row) => row.countryCode === baselineCountry)
    const baselineUsd = baseline?.usd ?? 0

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

function dedupeDeals(deals: Deal[], country: string) {
  const byKey = new Map<string, Deal>()
  const local = new Set(deals.filter((deal) => deal.priceCountry === country && !deal.freshness?.stale)
    .map((deal) => `${deal.source.toLowerCase()}:${gameIdentity(deal)}`))

  for (const deal of deals) {
    const titleKey = gameIdentity(deal)
    const identity = `${deal.source.toLowerCase()}:${titleKey}`
    // A US reference quote must never displace the selected country's product price.
    if (deal.priceCountry !== country && local.has(identity)) continue
    const key = `${identity}:${deal.priceCountry ?? deal.countries.join(',')}:${deal.salePrice.currency}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, deal)
      continue
    }

    const dealPrice = deal.salePrice.usd ?? deal.salePrice.amount
    const existingPrice = existing.salePrice.usd ?? existing.salePrice.amount
    const dealIsDirect = !deal.tags.includes('store-search-link') && !deal.tags.includes('provider-redirect')
    const existingIsDirect = !existing.tags.includes('store-search-link') && !existing.tags.includes('provider-redirect')
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

function metricsFor(deals: Deal[], regionalScans: RegionalScan[], country: string, priceScope: PriceScope = 'country'): RadarMetrics {
  deals = deals.filter((deal) => isCurrentVerifiedDeal(deal, priceScope === 'worldwide' ? deal.priceCountry ?? country : country))
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
  const topDeal = response.deals.find((deal) => isCurrentVerifiedDeal(deal, response.country))
  const nextPoint: DealHistoryPoint = {
    ecosystem: response.ecosystem ?? 'pc',
    country: response.country,
    updatedAt: response.updatedAt,
    totalDeals: response.metrics.totalDeals,
    freebies: response.metrics.freebies,
    maxSavings: response.metrics.maxSavings,
    regionalOpportunities: response.metrics.regionalOpportunities,
    topDealTitle: topDeal?.title,
    topDealPrice: topDeal?.salePrice.formatted,
  }

  const history = await readHistory()
  const withoutSameMinute = history.filter((point) => (point.ecosystem ?? 'pc') !== nextPoint.ecosystem || point.country !== nextPoint.country || point.updatedAt.slice(0, 16) !== nextPoint.updatedAt.slice(0, 16))
  await writeHistory([...withoutSameMinute, nextPoint].slice(-432))
}

async function readPriceHistory(): Promise<DealPriceHistoryDatabase> {
  try {
    return parsePriceHistory(JSON.parse(await readFile(priceHistoryFile, 'utf8')))
  } catch {
    return emptyPriceHistory()
  }
}

function withPriceHistory<T>(operation: (database: DealPriceHistoryDatabase) => Promise<T>) {
  // Serialize the entire read/modify/write transaction, not just the final rename.
  const transaction = priceHistoryWriteQueue.then(async () => operation(await readPriceHistory()))
  priceHistoryWriteQueue = transaction.then(() => undefined, () => undefined)
  return transaction
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

app.get('/api/history', async (req, res) => {
  const parsed = z.object({ ecosystem: z.enum(['pc', 'playstation', 'xbox']).default('pc'), country: z.string().regex(/^[A-Z]{2}$/).optional() }).safeParse(req.query)
  if (!parsed.success) { res.status(400).json({ error: 'Invalid platform or country.' }); return }
  res.json((await readHistory()).filter((point) => (point.ecosystem ?? 'pc') === parsed.data.ecosystem && (!parsed.data.country || point.country === parsed.data.country)))
})

app.get('/api/stores', async (_req, res) => {
  try {
    res.json((await getStores()).value)
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to load stores.' })
  }
})

app.get('/api/regions/:appId', async (req, res) => {
  const appId = req.params.appId
  const country = String(req.query.country ?? 'US').slice(0, 2).toUpperCase()
  const title = String(req.query.title ?? `Steam app ${appId}`)

  try {
    if (!/^\d{1,10}$/.test(appId) || !/^[A-Z]{2}$/.test(country)) {
      res.status(400).json({ error: 'Invalid Steam app or country.' })
      return
    }
    const scan = await getRegionalScan(appId, title, country)
    res.json({ ...scan.value, freshness: { updatedAt: scan.updatedAt, stale: scan.stale, error: scan.error } })
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to scan Steam regions.' })
  }
})

function sourceResultStatus<T>(name: string, result: PromiseSettledResult<Cached<T>>, message: string, coverage?: SourceStatus['coverage']): SourceStatus {
  if (result.status === 'rejected') return { ...status(name, false, result.reason instanceof Error ? result.reason.message : 'Source unavailable.'), coverage }
  const { updatedAt, stale, error } = result.value
  return { name, ok: !stale, message: stale ? `Cached data from ${updatedAt}; refresh failed: ${error}` : message, updatedAt, stale, error, coverage }
}

function cachedDeals(result: PromiseSettledResult<Cached<Deal[]>>, country: string): Deal[] {
  if (result.status !== 'fulfilled') return []
  const { value, updatedAt, stale, error } = result.value
  return value.map((deal) => {
    const upcoming = Boolean(deal.startsAt && Date.parse(deal.startsAt) > Date.now())
    const expired = Boolean(deal.expiresAt && Date.parse(deal.expiresAt) <= Date.now())
    const wasScheduled = deal.availability === 'upcoming'
    // Never silently promote a cached schedule into a confirmed active giveaway.
    const needsRefresh = wasScheduled && !upcoming
    const unavailable = stale || needsRefresh
    return {
      ...deal,
      availability: expired ? 'expired' : upcoming || needsRefresh ? 'upcoming' : 'active',
      confidence: unavailable ? 'fallback' : deal.confidence,
      freshness: { updatedAt, stale: unavailable, error: needsRefresh ? 'Promotion must be refreshed before it can be claimed.' : error },
      tags: Array.from(new Set([...deal.tags, ...(unavailable ? ['stale'] : []), ...(deal.priceCountry !== country ? ['foreign-price'] : [])])),
    } satisfies Deal
  })
}

async function loadConsoleRadar(params: LoadRadarParams & { ecosystem: 'playstation' | 'xbox' }): Promise<RadarResponse> {
  const { ecosystem, country, locale, limit, minSavings, search, onlyFree } = params
  const name = ecosystem === 'playstation' ? 'PlayStation Store' : 'Xbox'
  const [source] = await Promise.allSettled([withCache(`console:${ecosystem}:${country}:${locale}:${limit}:${minSavings}:${Boolean(onlyFree)}:${search ?? ''}`, 5 * 60 * 1000, async () => {
    const result = await (ecosystem === 'playstation' ? fetchPlayStationDeals : fetchXboxDeals)(params)
    const needsRates = result.deals.some((deal) => deal.salePrice.currency !== 'USD')
    const rates = needsRates ? await getExchangeRates() : undefined
    if (rates?.stale) throw new Error(`Exchange rates unavailable: ${rates.error}`)
    return { ...result, deals: result.deals.map((deal) => ({
      ...deal,
      salePrice: { ...deal.salePrice, usd: roundMoney(toUsd(deal.salePrice.amount, deal.salePrice.currency, rates?.value ?? {})) },
      normalPrice: deal.normalPrice ? { ...deal.normalPrice, usd: roundMoney(toUsd(deal.normalPrice.amount, deal.normalPrice.currency, rates?.value ?? {})) } : undefined,
    })) }
  })])
  const sourceStatus = [sourceResultStatus(name, source, source.status === 'fulfilled' ? source.value.value.message : '', search ? 'catalog-search' : 'catalog-sample')]
  const adapted = source.status === 'fulfilled'
    ? { status: 'fulfilled' as const, value: { ...source.value, value: source.value.value.deals } }
    : source
  const base = dedupeDeals(cachedDeals(adapted, country), country)
  let deals: Deal[]
  try {
    deals = await withPriceHistory(async (history) => {
      const enriched = enrichDealsWithIntelligence(base, country, history)
      await writeJsonAtomic(priceHistoryFile, recordPriceObservations(history, enriched, country))
      return enriched
    })
  } catch (error) {
    deals = enrichDealsWithIntelligence(base, country, await readPriceHistory())
    sourceStatus.push(status('Deal intelligence', false, error instanceof Error ? error.message : 'Unable to save price history.'))
  }
  deals.sort((a, b) => (b.intelligence?.score ?? b.signalScore) - (a.intelligence?.score ?? a.signalScore))
  const response: RadarResponse = {
    ecosystem, priceScope: 'country', country, locale, updatedAt: nowIso(), refreshSeconds: REFRESH_SECONDS,
    deals: deals.slice(0, limit), stores: [{ id: ecosystem, name, isActive: true, kind: 'official' }],
    regionalScans: [], marketScouts: [], metrics: metricsFor(deals.slice(0, limit), [], country), sourceStatus,
  }
  if (!search && !onlyFree && source.status === 'fulfilled' && !source.value.stale) {
    const record = historyWriteQueue.then(() => recordHistory(response))
    historyWriteQueue = record.catch(() => undefined)
    try { await record } catch { sourceStatus.push(status('Radar history', false, 'Unable to save radar history.')) }
  }
  return response
}

async function worldwideConsoleCountry(params: LoadRadarParams & { ecosystem: 'playstation' | 'xbox' }, signal: AbortSignal, productIds?: string[]): Promise<CountryOffers> {
  const { country, locale, ecosystem, search, onlyFree } = params
  const name = ecosystem === 'playstation' ? 'PlayStation Store' : 'Xbox'
  const cached = await withCache(`world-console:${ecosystem}:${country}:${locale}:${Boolean(onlyFree)}:${search ?? ''}:${productIds?.join(',') ?? ''}`, REFRESH_SECONDS * 1000, async () => {
    const result = ecosystem === 'playstation'
      ? await fetchPlayStationDeals({ ...params, minSavings: 0, enrichRatings: false, maxPages: search ? 2 : 1, signal })
      : await fetchXboxDeals({ ...params, minSavings: 0, productIds, signal })
    let fxError: string | undefined
    const rates = result.deals.some((deal) => deal.salePrice.currency !== 'USD') ? await getExchangeRates().catch((error: unknown) => {
      fxError = error instanceof Error ? error.message : 'Exchange rates unavailable.'
      return undefined
    }) : undefined
    if (rates?.stale) fxError = rates.error ?? 'Exchange rates are stale.'
    const deals: Deal[] = []
    for (const deal of result.deals) {
      try {
        if (deal.salePrice.currency !== 'USD' && (fxError || !rates)) throw new Error(fxError ?? 'Exchange rates unavailable.')
        deals.push({ ...deal,
          salePrice: { ...deal.salePrice, usd: roundMoney(toUsd(deal.salePrice.amount, deal.salePrice.currency, rates?.value ?? {})) },
          normalPrice: deal.normalPrice ? { ...deal.normalPrice, usd: roundMoney(toUsd(deal.normalPrice.amount, deal.normalPrice.currency, rates?.value ?? {})) } : undefined,
        })
      } catch (error) { fxError = error instanceof Error ? error.message : 'A price has no reliable USD conversion.' }
    }
    return { deals, message: result.message, fxError, partial: 'partial' in result ? Boolean(result.partial) : false }
  })
  const sourceStatus = [sourceResultStatus(name, { status: 'fulfilled', value: cached }, cached.value.message, search || productIds ? 'catalog-search' : 'catalog-sample')]
  if (cached.value.partial) sourceStatus.push(status('Catalogue discovery', false, 'One provider search route failed; the surviving route does not provide complete discovery coverage.'))
  if (cached.value.fxError) sourceStatus.push(status('USD conversion', false, `${cached.value.fxError} Unconvertible prices were excluded.`))
  return { deals: cachedDeals({ status: 'fulfilled', value: { ...cached, value: cached.value.deals } }, country), sourceStatus,
    recheckedProducts: productIds && !cached.stale ? productIds.map((storeProductId) => ({ source: name, storeProductId })) : undefined,
    stores: [{ id: ecosystem, name, isActive: !cached.stale, kind: 'official' }] }
}

/** Steam supports price_overview for multiple app IDs in one public request. */
async function worldwideSteamPrices(country: string, locale: string, discovered: Deal[]): Promise<CountryOffers> {
  const candidates = new Map<string, Deal>()
  for (const deal of discovered) {
    if (deal.source === 'Steam' && deal.steamAppId && !deal.tags.includes('provider-redirect')) candidates.set(deal.steamAppId, deal)
    if (candidates.size >= 40) break
  }
  const appIds = [...candidates.keys()].sort()
  if (!appIds.length) return { deals: [], sourceStatus: [status('Steam exact product prices', true, 'No official Steam IDs were discovered for exact regional verification.')] }
  const cached = await withCache(`world-steam-exact:${country}:${locale}:${appIds.join(',')}`, REFRESH_SECONDS * 1000, async () => {
    const rates = await getExchangeRates()
    if (rates.stale) throw new Error(`Exchange rates unavailable: ${rates.error}`)
    const query = new URLSearchParams({ appids: appIds.join(','), cc: country.toLowerCase(), filters: 'price_overview' })
    const response = await fetchJson<Record<string, SteamAppDetails>>(`https://store.steampowered.com/api/appdetails?${query}`)
    if (!appIds.some((id) => Object.hasOwn(response, id))) throw new Error('Steam returned no verifiable response for the requested product IDs.')
    const deals: Deal[] = []
    for (const appId of appIds) {
      const product = response[appId]
      const price = product?.data?.price_overview
      if (!product?.success || !price || !Number.isFinite(price.final) || price.final < 0 || !Number.isFinite(price.initial)) continue
      const seed = candidates.get(appId)!
      const amount = price.final / 100
      const initial = price.initial / 100
      deals.push({ ...seed,
        id: `steam-special-${country}-${appId}`, url: `https://store.steampowered.com/app/${appId}/?cc=${country.toLowerCase()}`,
        salePrice: { amount, currency: price.currency, formatted: formatMoney(amount, price.currency, locale), usd: roundMoney(toUsd(amount, price.currency, rates.value)) },
        normalPrice: initial > amount ? { amount: initial, currency: price.currency, formatted: formatMoney(initial, price.currency, locale), usd: roundMoney(toUsd(initial, price.currency, rates.value)) } : undefined,
        savingsPercent: price.discount_percent, isFree: amount === 0, countries: [country], priceCountry: country,
        detectedAt: nowIso(), expiresAt: undefined, startsAt: undefined, bestRegion: undefined, intelligence: undefined,
        availability: 'active', confidence: 'live-api', freshness: undefined,
        tags: ['official', 'steam-product-lookup'], notes: [`Exact Steam app ${appId} price checked in ${country}, including full-price listings. Edition identity comes from the official Steam product discovery.`],
      })
    }
    return { deals, recheckedProducts: appIds.filter((id) => Object.hasOwn(response, id)).map((steamAppId) => ({ source: 'Steam', steamAppId })) }
  })
  return { deals: cachedDeals({ status: 'fulfilled', value: { ...cached, value: cached.value.deals } }, country),
    recheckedProducts: cached.stale ? undefined : cached.value.recheckedProducts,
    sourceStatus: [sourceResultStatus('Steam exact product prices', { status: 'fulfilled', value: cached }, `${cached.value.deals.length} of ${appIds.length} exact Steam product IDs priced, including listings outside featured discounts.`)] }
}

async function loadWorldwideRadar(params: LoadRadarParams & { ecosystem: GameEcosystem }): Promise<RadarResponse> {
  const { ecosystem, country, locale, limit, minSavings, search, onlyFree } = params
  // Base country and regional scan sample do not affect the global candidate comparison.
  const key = `worldwide:${ecosystem}:${locale}:${limit}:${minSavings}:${Boolean(onlyFree)}:${search ?? ''}`
  const cached = await withCache(key, REFRESH_SECONDS * 1000, async () => {
    const signal = AbortSignal.timeout(45_000)
    return requestContext.run(signal, async () => {
      let cheap: PromiseSettledResult<Cached<Deal[]>> | undefined
      let steamSeed: Deal[] = []
      const explicitSteam = ecosystem === 'pc' && /^(?:steam:)?\d{1,10}$/i.test(search ?? '')
      if (ecosystem === 'pc') {
        ;[cheap] = await Promise.allSettled([getCheapSharkDeals(limit, 0, search)])
        if (search) {
          const discovered: Array<Pick<Deal, 'steamAppId'>> = [...cachedDeals(cheap, 'US')]
          if (!explicitSteam) {
            try {
              const official = await withCache(`world-steam-search:${locale}:${search}`, REFRESH_SECONDS * 1000, async () => {
                const query = new URLSearchParams({ term: search, l: steamLanguage(locale), cc: 'US' })
                const response = await fetchJson<{ items?: Array<{ id?: number }> }>(`https://store.steampowered.com/api/storesearch/?${query}`)
                if (!Array.isArray(response.items)) throw new Error('Steam search returned no verifiable catalogue response.')
                return response.items.filter((item) => Number.isInteger(item.id) && item.id! > 0).slice(0, 8).map((item) => ({ steamAppId: String(item.id) }))
              })
              if (!official.stale) discovered.unshift(...official.value)
            } catch { /* Existing CheapShark/featured discovery remains explicitly bounded. */ }
          }
          // Store search includes soundtracks and DLC: appdetails still must confirm type=game.
          const [seed] = await Promise.allSettled([getSteamSearchDetails('US', locale, search, discovered, 4)])
          steamSeed = cachedDeals(seed, 'US')
        }
      }
      const countryParams = (checkedCountry: string) => ({ ...params, country: checkedCountry, minSavings: 0, regionSample: 0 })
      const result = await scanWorldwide({
        countries: WORLDWIDE_COUNTRIES,
        supportedCountries: ecosystem === 'playstation' ? supportedPlayStationCountries() : undefined,
        scope: /^(?:steam:|product:)/i.test(search ?? '') ? 'product-lookup' : search ? 'catalog-search' : 'catalog-sample',
        signal, concurrency: 4,
        loadCountry: async (checkedCountry, currentSignal) => {
          if (ecosystem !== 'pc') return worldwideConsoleCountry({ ...countryParams(checkedCountry), ecosystem }, currentSignal)
          if (explicitSteam) {
            const lookup = await getSteamSearchDetails(checkedCountry, locale, search!, [], 1)
            return { deals: cachedDeals({ status: 'fulfilled', value: lookup }, checkedCountry), sourceStatus: [sourceResultStatus('Steam exact regional product', { status: 'fulfilled', value: lookup }, `${lookup.value.length} current game prices verified directly in ${checkedCountry}; US availability is not required.`)] }
          }
          const sources: Array<{ name: string; loader: () => Promise<Cached<Deal[]>>; coverage: SourceStatus['coverage'] }> = [
            { name: 'Steam specials', loader: () => getSteamSpecials(checkedCountry, locale, limit, 0, search), coverage: 'featured-sample' },
            { name: 'GOG catalog', loader: () => getGogDeals(checkedCountry, locale, limit, 0, search, true), coverage: search ? 'catalog-search' : 'catalog-sample' },
            { name: 'Epic giveaways', loader: () => getEpicDeals(checkedCountry, locale), coverage: 'catalog-sample' },
          ]
          const output: CountryOffers = { deals: [], sourceStatus: [] }
          for (const source of sources) {
            const [loaded] = await Promise.allSettled([source.loader()])
            const deals = cachedDeals(loaded, checkedCountry).filter((deal) => titleMatches(deal.title, search))
            output.deals.push(...deals)
            output.sourceStatus.push(sourceResultStatus(source.name, loaded, `${deals.length} candidates in the bounded ${source.coverage}; full-price GOG search listings are included.`, source.coverage))
          }
          if (checkedCountry === 'US' && cheap) {
            output.deals.push(...cachedDeals(cheap, 'US'), ...steamSeed)
            output.sourceStatus.push(sourceResultStatus('CheapShark US reference', cheap, 'US quotes only; never substituted for other countries.', 'reference-us'))
          }
          return output
        },
        refineCountry: explicitSteam || ecosystem === 'playstation' || /^product:/i.test(search ?? '') ? undefined : async (checkedCountry, discovered, currentSignal) => {
          if (ecosystem === 'pc') return worldwideSteamPrices(checkedCountry, locale, [...steamSeed, ...discovered])
          const ids = [...new Set(discovered.map((deal) => deal.storeProductId).filter((id): id is string => Boolean(id)))].sort().slice(0, 60)
          return worldwideConsoleCountry({ ...countryParams(checkedCountry), ecosystem: 'xbox' }, currentSignal, ids)
        },
      })
      // Select the global price first; discount/free filters must not hide a cheaper full-price country.
      result.deals = result.deals.filter((deal) => (deal.isFree || deal.savingsPercent >= minSavings) && (!onlyFree || deal.isFree)).slice(0, limit)
      if (ecosystem === 'playstation') {
        const rated = await enrichPlayStationWinnerRatings(result.deals)
        result.sourceStatus.push(status('PlayStation winner ratings', true, `Official ratings verified for ${rated} of ${result.deals.length} global winners; at most 24 products and 8 seconds total.`))
      }
      return result
    })
  })
  // An expired aggregate must never re-label old prices as current after a refresh failure.
  const current = cached.stale ? [] : cached.value.deals.filter((deal) => verifiedWorldwideOffer(deal, deal.priceCountry ?? '') !== undefined)
  // Keep existing intelligence filters usable without recording foreign quotes in the base country.
  const history = await readPriceHistory()
  const deals = [...new Set(current.map((deal) => deal.priceCountry!))].flatMap((quoteCountry) =>
    enrichDealsWithIntelligence(current.filter((deal) => deal.priceCountry === quoteCountry), quoteCountry, history),
  ).sort((a, b) => a.salePrice.usd! - b.salePrice.usd! || a.title.localeCompare(b.title))
  const worldwide = cached.stale ? { ...cached.value.worldwide, failedCountries: [...WORLDWIDE_COUNTRIES], partial: true } : cached.value.worldwide
  const summary: SourceStatus = { name: 'Worldwide price comparison', ok: !worldwide.partial && !cached.stale, updatedAt: cached.updatedAt,
    message: `${worldwide.checkedCountries.length}/${worldwide.requestedCountries.length} countries checked; ${worldwide.failedCountries.length} failed or partial, ${worldwide.unsupportedCountries.length} unsupported. Lowest verified USD prices in retrieved edition/platform results. Discovery is bounded and may omit other products or regions.`,
    stale: cached.stale, error: cached.error, coverage: search ? 'catalog-search' : 'catalog-sample' }
  return { ecosystem, priceScope: 'worldwide', country, locale, updatedAt: cached.updatedAt, refreshSeconds: REFRESH_SECONDS,
    deals, stores: cached.value.stores, regionalScans: [], marketScouts: [], worldwide,
    metrics: metricsFor(deals, [], country, 'worldwide'), sourceStatus: [summary, ...cached.value.sourceStatus] }
}

export interface LoadRadarParams {
  priceScope?: PriceScope
  onlyFree?: boolean
  ecosystem?: GameEcosystem
  country: string
  locale: string
  limit: number
  minSavings: number
  search?: string
  regionSample: number
}

export async function loadRadar(params: LoadRadarParams): Promise<RadarResponse> {
  const parsed = querySchema.parse(params)
  if (parsed.priceScope === 'worldwide') return loadWorldwideRadar(parsed)
  if (parsed.ecosystem !== 'pc') return loadConsoleRadar({ ...parsed, ecosystem: parsed.ecosystem })
  const { country, locale, limit, minSavings, search, regionSample } = querySchema.parse(params)
  const sourceStatus: SourceStatus[] = []
  const [storesResult, cheapResult, epicResult, steamResult, gogResult] = await Promise.allSettled([
    getStores(), getCheapSharkDeals(limit, minSavings, search), getEpicDeals(country, locale),
    getSteamSpecials(country, locale, limit, minSavings, search), getGogDeals(country, locale, limit, minSavings, search),
  ])
  const stores = storesResult.status === 'fulfilled' ? storesResult.value.value : []
  const cheapDeals = cachedDeals(cheapResult, country)
  const epicDeals = cachedDeals(epicResult, country).filter((deal) => titleMatches(deal.title, search))
  let steamDeals = cachedDeals(steamResult, country)
  const gogDeals = cachedDeals(gogResult, country)
  sourceStatus.push(
    sourceResultStatus('CheapShark stores', storesResult, 'Store index loaded.'),
    sourceResultStatus('CheapShark deals', cheapResult, `${cheapDeals.length} US reference offers. Regional activation and checkout prices require verification.`, 'reference-us'),
    sourceResultStatus('Epic giveaways', epicResult, `${epicDeals.length} current or upcoming promotions for ${country}.`),
    sourceResultStatus('Steam specials', steamResult, `${steamDeals.length} matches in Steam featured specials for ${country}; this is not a full catalog search.`, 'featured-sample'),
    sourceResultStatus('GOG catalog', gogResult, search
      ? `${gogDeals.length} discounted catalog matches for "${search}" in ${country}; at most ${Math.min(limit * 2, 100)} provider results checked.`
      : `${gogDeals.length} discounted entries in a sample of up to ${Math.min(limit * 2, 100)} catalog products for ${country}.`, search ? 'catalog-search' : 'catalog-sample'),
  )
  if (search) {
    const [lookup] = await Promise.allSettled([getSteamSearchDetails(country, locale, search, cheapDeals)])
    const products = cachedDeals(lookup, country).filter((deal) => deal.savingsPercent >= minSavings)
    steamDeals = [...steamDeals, ...products]
    sourceStatus.push(sourceResultStatus('Steam product lookup', lookup, `${products.length} regional products checked. Discovery is limited to up to 8 Steam IDs from CheapShark or an explicit numeric Steam app ID; unmatched titles do not mean unavailable.`, 'featured-sample'))
  }
  const seenRegionalApps = new Set<string>()
  const regionTargets = [...steamDeals, ...cheapDeals]
    .filter((deal) => deal.steamAppId && !deal.isFree && !deal.freshness?.stale)
    .sort((a, b) => b.signalScore - a.signalScore)
    .filter((deal) => {
      if (!deal.steamAppId || seenRegionalApps.has(deal.steamAppId)) return false
      seenRegionalApps.add(deal.steamAppId)
      return true
    }).slice(0, regionSample)
  const regionalSettled = await Promise.allSettled(regionTargets.map((deal) => getRegionalScan(deal.steamAppId!, deal.title, country)))
  // Stale scans remain available from /api/regions with their timestamp but cannot boost current rankings.
  const regionalScans = regionalSettled
    .filter((entry): entry is PromiseFulfilledResult<Cached<RegionalScan>> => entry.status === 'fulfilled' && !entry.value.stale)
    .map((entry) => entry.value.value)
  const regionalFailures = regionalSettled.length - regionalScans.length
  sourceStatus.push(status('Steam regional scan', regionalFailures === 0, `${regionalScans.length} current comparisons; ${regionalFailures} failed or stale scans.`))
  const baseDeals = attachRegionalHighlights(dedupeDeals([...epicDeals, ...steamDeals, ...gogDeals, ...cheapDeals], country), regionalScans)
  let allDeals: Deal[] = []
  try {
    allDeals = await withPriceHistory(async (history) => {
      const enriched = enrichDealsWithIntelligence(baseDeals, country, history)
      const next = recordPriceObservations(history, enriched, country, nowIso())
      await writeJsonAtomic(priceHistoryFile, next)
      const stats = priceHistoryStats(next)
      sourceStatus.push(status('Deal intelligence', true, `${stats.games} games and ${stats.observations} verified country-specific observations. History shows the lowest offer observed per game, not a complete market history.`))
      return enriched
    })
  } catch (error) {
    allDeals = enrichDealsWithIntelligence(baseDeals, country, await readPriceHistory())
    sourceStatus.push(status('Deal intelligence', false, error instanceof Error ? error.message : 'Unable to save price intelligence.'))
  }
  allDeals = allDeals.sort((a, b) => (b.intelligence?.score ?? b.signalScore) - (a.intelligence?.score ?? a.signalScore) || b.signalScore - a.signalScore).slice(0, limit)
  const marketScouts = buildMarketScouts(allDeals, search)
  sourceStatus.push(status('Marketplace scouts', true, `${marketScouts.length} comparison search links. Marketplace prices are not verified.`))
  const providerLinks = allDeals.filter((deal) => deal.tags.includes('provider-redirect')).length
  sourceStatus.push(status('Destination links', true, `${providerLinks} required CheapShark redirects; remaining offers use store product links.`))
  const response: RadarResponse = {
    ecosystem: 'pc', priceScope: 'country', updatedAt: nowIso(), refreshSeconds: REFRESH_SECONDS, country, locale, deals: allDeals, stores,
    regionalScans, marketScouts, metrics: metricsFor(allDeals, regionalScans, country), sourceStatus,
  }
  const providerResults = [cheapResult, epicResult, steamResult, gogResult]
  if (!search && providerResults.every((result) => result.status === 'fulfilled' && !result.value.stale)) {
    const record = historyWriteQueue.then(() => recordHistory(response))
    historyWriteQueue = record.catch(() => undefined)
    try { await record } catch (error) { sourceStatus.push(status('Radar history', false, error instanceof Error ? error.message : 'Unable to save radar history.')) }
  }
  return response
}

app.get('/api/radar', async (req, res) => {
  const parsed = querySchema.safeParse(req.query)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }
  try { res.json(await loadRadar(parsed.data)) }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to load radar.' }) }
})

app.get('/api/game-history', async (req, res) => {
  const parsed = z.object({ gameKey: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/), country: z.string().regex(/^[a-zA-Z]{2}$/).default('US').transform((value) => value.toUpperCase()) }).safeParse(req.query)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }
  await priceHistoryWriteQueue
  const { gameKey, country } = parsed.data
  const entry = (await readPriceHistory()).games[`${country}:${gameKey}`]
  const response: GameHistoryResponse = {
    gameKey, country,
    points: (entry?.observations ?? []).flatMap<GameHistoryResponse['points'][number]>((point) => point.free
      ? [{ at: point.at, priceUsd: 0, source: point.freeStore ?? 'Observed giveaway', free: true }]
      : point.bestPaidUsd !== undefined ? [{ at: point.at, priceUsd: point.bestPaidUsd, source: point.bestStore ?? 'Observed minimum', free: false }] : []),
  }
  res.json(response)
})

const libraryService = registerLibraryRoutes(app, { dataDir, queryRadar: loadRadar })

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

  return new Promise<{ server: ReturnType<typeof app.listen>; port: number; host: string; libraryService: typeof libraryService }>((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address() as AddressInfo | null
      resolve({ server, port: address?.port ?? port, host, libraryService })
    })
    server.on('error', reject)
  })
}
