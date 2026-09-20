import { getGameEcosystem, libraryMatchesDeal } from '../src/shared/gameIdentity.js'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import express, { type Express, type RequestHandler, type ErrorRequestHandler } from 'express'
import { z } from 'zod'
import type { Deal, GameEcosystem, RadarResponse } from '../src/shared/dealTypes.js'
import type { AlertRecord, LibraryAction, LibraryGame, LibraryState } from '../src/shared/libraryTypes.js'
import { writeJsonAtomic } from './persistence.js'
import { isTrustedStoreUrl } from './storeLinks.js'

const MAX_FILE_BYTES = 2 * 1024 * 1024
// Restore wraps a valid backup in an action object; reserve room for that envelope.
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 1024
const MAX_ALERTS = 1000
const MAX_CHECK_GAMES = 20
const text = z.string().max(2000)
const instant = z.string().datetime({ offset: true })
const finite = z.number().finite()
const money = finite.nonnegative().max(1e12)
const currency = z.string().regex(/^[A-Z]{3}$/)
const storeUrl = z.string().max(3000).refine(isTrustedStoreUrl, 'Unsupported store URL')
const imageUrl = z.string().max(3000).refine((value) => {
  if (!value) return true
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password } catch { return false }
}, 'Image must use HTTPS')
const priceSchema = z.object({ amount: money, currency, formatted: text, usd: money.optional() }).strict()
const regionSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/), countryName: text, currency: z.string().max(10),
  final: money, initial: money, finalFormatted: text, initialFormatted: text.optional(),
  discountPercent: finite.min(0).max(100), usd: money, relativeToBaselinePercent: finite,
  storeUrl, available: z.boolean(),
}).strict()
const intelligenceSchema = z.object({
  gameKey: z.string().max(300), score: finite.min(0).max(100), verdict: z.enum(['exceptional', 'strong', 'fair', 'wait']),
  confidenceScore: finite.min(0).max(100),
  reasons: z.array(z.object({ code: z.enum(['free-game', 'observed-low', 'near-observed-low', 'deep-discount', 'high-rating', 'market-lowest', 'market-competitive', 'above-market', 'regional-advantage', 'direct-link', 'search-link', 'live-source', 'medium-risk', 'high-risk', 'limited-history', 'price-anomaly']), impact: finite, evidence: text.optional() }).strict()).max(30),
  history: z.object({ sampleCount: z.number().int().nonnegative(), firstSeenAt: instant.optional(), lastSeenAt: instant.optional(), paidLowUsd: money.optional(), averagePaidUsd: money.optional(), reliable: z.boolean(), isObservedLow: z.boolean(), wasEverFree: z.boolean() }).strict(),
  market: z.object({ offerCount: z.number().int().nonnegative(), storeCount: z.number().int().nonnegative(), rank: z.number().int().nonnegative(), lowestUsd: money, nextBestUsd: money.optional(), savingsVsNextUsd: money.optional() }).strict(),
  flags: z.object({ priceAnomaly: z.boolean(), expiringSoon: z.boolean(), searchDestination: z.boolean() }).strict(),
}).strict()

export const snapshotSchema = z.object({
  ecosystem: z.enum(['pc', 'playstation', 'xbox']).optional(), storeProductId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(), storeRatingPercent: finite.min(0).max(100).optional(),
  id: z.string().min(1).max(500), title: z.string().min(1).max(300), source: text,
  sourceKind: z.enum(['official', 'authorized', 'marketplace', 'freebie', 'regional']), platform: text,
  image: imageUrl, url: storeUrl, salePrice: priceSchema, normalPrice: priceSchema.optional(),
  savingsPercent: finite.min(0).max(100), dealScore: finite, signalScore: finite,
  metacriticScore: finite.min(0).max(100).optional(), steamRatingPercent: finite.min(0).max(100).optional(),
  steamRatingText: text.optional(), steamAppId: z.string().regex(/^\d{1,12}$/).optional(),
  startsAt: instant.optional(), expiresAt: instant.optional(), detectedAt: instant, isFree: z.boolean(),
  countries: z.array(z.string().min(2).max(30)).max(60), bestRegion: regionSchema.optional(),
  riskLevel: z.enum(['low', 'medium', 'high']), confidence: z.enum(['live-api', 'computed', 'search-link', 'fallback']),
  tags: z.array(z.string().max(100)).max(40), notes: z.array(text).max(30), intelligence: intelligenceSchema.optional(),
  freshness: z.object({ updatedAt: instant, stale: z.boolean(), error: text.optional() }).strict().optional(),
  availability: z.enum(['active', 'upcoming', 'expired']).optional(), priceCountry: z.string().regex(/^[A-Z]{2}$/).optional(),
}).strict()
const gameSchema = z.object({
  ecosystem: z.enum(['pc', 'playstation', 'xbox']).optional(), storeProductId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
  id: z.string().min(1).max(300), title: z.string().trim().min(1).max(300), steamAppId: z.string().regex(/^\d{1,12}$/).optional(),
  owned: z.boolean(), watched: z.boolean(), priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  notes: text, targetPrice: z.object({ amount: money, currency }).strict().optional(), snapshot: snapshotSchema.optional(), updatedAt: instant,
}).strict()
const booleanSetting = z.enum(['true', 'false'])
const quietSetting = z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/)
const numericSetting = (minimum: number, maximum: number) => z.string()
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/)
  .refine((value) => Number.isFinite(Number(value)) && Number(value) >= minimum && Number(value) <= maximum)
const settingValidators: Record<string, z.ZodType<string>> = {
  'dealrift-ecosystem': z.enum(['pc', 'playstation', 'xbox']),
  'dealrift-language': z.enum(['es', 'en']),
  'dealrift-country': z.enum(['US', 'CO', 'IN', 'TR', 'AR', 'BR', 'MX', 'CL', 'PE', 'ID', 'MY', 'PH', 'TH', 'VN', 'ZA', 'PL', 'CN', 'JP', 'KR', 'GB', 'DE', 'ES', 'CA', 'AU']),
  'dealrift-sort-mode': z.enum(['value', 'price', 'savings', 'regional', 'rating', 'ending', 'signal']),
  'dealrift-page-size': z.enum(['10', '20', '30', '40']),
  'dealrift-active-view': z.enum(['deals', 'library', 'regions', 'alerts', 'analytics', 'sources']),
  'dealrift-view': z.enum(['deals', 'library', 'regions', 'alerts', 'analytics', 'sources']),
  'dealrift-source-filter': z.enum(['all', 'official', 'authorized', 'freebie', 'regional', 'marketplace']),
  'dealrift-min-savings': numericSetting(0, 100),
  'dealrift-min-rating': numericSetting(0, 100),
  'dealrift-max-price': numericSetting(0, 100),
  'dealrift-alert-savings': numericSetting(40, 100),
  'dealrift-alert-signal': numericSetting(50, 100),
  'dealrift-quiet-start': quietSetting,
  'dealrift-quiet-end': quietSetting,
  'dealrift-check-cursor': z.string().regex(/^(0|[1-9]\d*)$/).refine((value) => Number(value) < 500),
  'dealrift-desktop-notified': z.string().refine((value) => {
    try { return z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(MAX_ALERTS).safeParse(JSON.parse(value)).success } catch { return false }
  }),
}
for (const key of ['background', 'notifications', 'low-power', 'hide-owned', 'compact-mode', 'only-free', 'only-regional', 'only-watched', 'only-ending-soon', 'only-deep-discount', 'only-low-risk', 'only-exceptional', 'alert-free', 'auto-refresh', 'show-high-risk']) {
  settingValidators[`dealrift-${key}`] = booleanSetting
}
const settingsSchema = z.record(z.string().regex(/^dealrift-[a-z0-9-]{1,70}$/), z.string().max(32768)).superRefine((settings, context) => {
  if (Object.keys(settings).length > 100) context.addIssue({ code: 'custom', message: 'Maximum 100 settings.' })
  for (const [key, value] of Object.entries(settings)) {
    const validator = settingValidators[key]
    if (validator && !validator.safeParse(value).success) context.addIssue({ code: 'custom', path: [key], message: `Invalid value for ${key}.` })
  }
})
const alertSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/), gameId: z.string().min(1).max(300), title: text, message: text,
  price: money, currency, url: storeUrl, createdAt: instant, read: z.boolean(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
}).strict()
export const libraryStateSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(), settings: settingsSchema,
  games: z.array(gameSchema).max(500).refine((games) => new Set(games.map((game) => game.id)).size === games.length, 'Duplicate game IDs'),
  alerts: z.array(alertSchema).max(MAX_ALERTS), lastCheckedAt: instant.optional(), checkError: text.optional(),
}).strict()
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('upsert'), game: gameSchema }).strict(),
  z.object({ action: z.literal('remove'), id: z.string().min(1).max(300) }).strict(),
  z.object({ action: z.literal('settings'), settings: settingsSchema }).strict(),
  z.object({ action: z.literal('import'), games: z.array(gameSchema).max(500) }).strict(),
  z.object({ action: z.literal('restore'), state: libraryStateSchema }).strict(),
  z.object({ action: z.literal('read-alerts') }).strict(),
])

export interface LibraryRadarParams { ecosystem?: GameEcosystem; country: string; locale: string; limit: number; minSavings: number; search?: string; regionSample: number }
interface LibraryOptions { dataDir: string; queryRadar: (params: LibraryRadarParams) => Promise<RadarResponse> }
function emptyLibrary(): LibraryState { return { schemaVersion: 1, revision: 0, settings: {}, games: [], alerts: [] } }


export function isQuietHours(settings: Record<string, string>, now = new Date()) {
  const start = settings['dealrift-quiet-start']
  const end = settings['dealrift-quiet-end']
  if (!start || !end || start === end) return false
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
  const current = now.getHours() * 60 + now.getMinutes()
  const from = minutes(start), to = minutes(end)
  return from < to ? current >= from && current < to : current >= from || current < to
}

function validCurrentOffer(deal: Deal, country: string, now: number) {
  const meta = deal as Deal & { freshness?: { stale: boolean; updatedAt: string }; availability?: string; priceCountry?: string }
  const checkedAt = meta.freshness?.updatedAt ?? deal.detectedAt
  if (!['live-api', 'computed'].includes(deal.confidence) || meta.freshness?.stale || ['upcoming', 'expired'].includes(meta.availability ?? '')) return false
  if (deal.tags.some((tag) => ['stale', 'upcoming', 'expired', 'foreign-price', 'unverified'].includes(tag))) return false
  if (deal.startsAt && Date.parse(deal.startsAt) > now || deal.expiresAt && Date.parse(deal.expiresAt) <= now) return false
  if (!Number.isFinite(Date.parse(checkedAt)) || Date.parse(checkedAt) > now + 60 * 1000 || now - Date.parse(checkedAt) > 30 * 60 * 1000) return false
  if (meta.priceCountry && meta.priceCountry !== country) return false
  return deal.countries.some((entry) => entry.toUpperCase() === country) || (!meta.priceCountry && deal.countries.length > 0 && deal.countries.every((entry) => ['GLOBAL', 'WW'].includes(entry.toUpperCase())))
}
function targetAmount(deal: Deal, currencyCode: string) {
  return deal.salePrice.currency === currencyCode ? deal.salePrice.amount : currencyCode === 'USD' ? deal.salePrice.usd : undefined
}
function unverified(snapshot?: Deal): Deal | undefined {
  if (!snapshot) return undefined
  return { ...snapshot, confidence: 'fallback', tags: [...new Set([...snapshot.tags, 'unverified'])] }
}
function deliveredIds(settings: Record<string, string>): string[] {
  try { const ids: unknown = JSON.parse(settings['dealrift-desktop-notified'] ?? '[]'); return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [] } catch { return [] }
}
function alertId(game: LibraryGame, amount: number, currencyCode: string, country: string) {
  return createHash('sha256').update(JSON.stringify([game.id, country, game.targetPrice?.amount ?? null, game.targetPrice?.currency ?? null, amount, currencyCode])).digest('hex').slice(0, 24)
}
function eligibleAlert(alert: AlertRecord, state: LibraryState, now: Date) {
  const country = state.settings['dealrift-country'] ?? 'US'
  const game = state.games.find((entry) => entry.id === alert.gameId)
  if (alert.read || alert.country !== country || !game?.watched || game.owned || !game.snapshot || !validCurrentOffer(game.snapshot, country, now.getTime())) return false
  if (alert.id !== alertId(game, alert.price, alert.currency, country)) return false
  const currentPrice = targetAmount(game.snapshot, alert.currency)
  return currentPrice !== undefined && Math.abs(currentPrice - alert.price) < 0.005 && (!game.targetPrice || currentPrice <= game.targetPrice.amount)
}

export function createLibraryService(options: LibraryOptions) {
  const file = path.join(options.dataDir, 'library.json')
  let queue = Promise.resolve()
  let inFlightCheck: Promise<LibraryState> | undefined
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation)
    queue = result.then(() => undefined, () => undefined)
    return result
  }
  const load = async (): Promise<LibraryState> => {
    try {
      if ((await stat(file)).size > MAX_FILE_BYTES) throw new Error('Library exceeds the 2 MB size limit.')
      return libraryStateSchema.parse(JSON.parse(await readFile(file, 'utf8'))) as LibraryState
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyLibrary()
      throw new Error('The saved library could not be read. Its existing file has been preserved.', { cause: error })
    }
  }
  const save = async (state: LibraryState) => {
    const validated = libraryStateSchema.parse(state) as LibraryState
    if (Buffer.byteLength(`${JSON.stringify(validated, null, 2)}\n`) > MAX_FILE_BYTES) throw new Error('Library exceeds the 2 MB size limit.')
    await writeJsonAtomic(file, validated)
    return validated
  }
  const read = () => serial(load)
  const update = (input: LibraryAction): Promise<LibraryState> => {
    const action = actionSchema.parse(input)
    return serial(async () => {
      const state = await load()
      const now = new Date().toISOString()
      let next: LibraryState = { ...state, revision: state.revision + 1 }
      if (action.action === 'settings') {
        next.settings = { ...state.settings, ...action.settings }
        if ((next.settings['dealrift-country'] ?? 'US') !== (state.settings['dealrift-country'] ?? 'US')) {
          next.games = state.games.map((game) => ({ ...game, snapshot: unverified(game.snapshot) }))
          next.lastCheckedAt = undefined
          next.checkError = 'Country changed. Saved prices need a new verification.'
        }
      }
      else if (action.action === 'upsert') {
        const game = { ...action.game, updatedAt: now } as LibraryGame
        next.games = [...state.games.filter((entry) => entry.id !== game.id), game]
      } else if (action.action === 'remove') {
        next.games = state.games.filter((game) => game.id !== action.id)
        next.alerts = state.alerts.filter((alert) => alert.gameId !== action.id)
      } else if (action.action === 'import') {
        const games = new Map(state.games.map((game) => [game.id, game]))
        for (const game of action.games) games.set(game.id, { ...game, snapshot: unverified(game.snapshot as Deal | undefined), updatedAt: now } as LibraryGame)
        next.games = [...games.values()]
      } else if (action.action === 'restore') {
        next = { ...action.state, revision: state.revision + 1, games: action.state.games.map((game) => ({ ...game, snapshot: unverified(game.snapshot as Deal | undefined) })) } as LibraryState
        // Imported alerts are historical records; never replay them as desktop notifications.
        next.settings = { ...next.settings, 'dealrift-desktop-notified': JSON.stringify(next.alerts.map((alert) => alert.id)) }
      } else next.alerts = state.alerts.map((alert) => ({ ...alert, read: true }))
      return save(next)
    })
  }
  const performCheck = async () => {
    const before = await read()
    const country = before.settings['dealrift-country'] ?? 'US'
    const locale = before.settings['dealrift-language'] === 'es' ? 'es-ES' : 'en-US'
    const allWatched = before.games.filter((game) => game.watched && !game.owned)
    if (!allWatched.length) return before
    const position = Math.max(0, Number.parseInt(before.settings['dealrift-check-cursor'] ?? '0', 10) || 0) % allWatched.length
    const watched = [...allWatched.slice(position), ...allWatched.slice(0, position)].slice(0, MAX_CHECK_GAMES)
    const results = new Map<string, { offers: Deal[]; error?: string }>()
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(3, watched.length) }, async () => {
      while (cursor < watched.length) {
        const game = watched[cursor++]
        let offers: Deal[] = []
        let queryFailed = false
        const ecosystem = getGameEcosystem(game)
        const matchesEdition = (deal: Deal) => libraryMatchesDeal(game, deal)
        try {
          const radar = await options.queryRadar({ ecosystem, country, locale, limit: 120, minSavings: 0, search: ecosystem !== 'pc' && (game.storeProductId ?? game.snapshot?.storeProductId) ? `product:${game.storeProductId ?? game.snapshot?.storeProductId}` : game.title, regionSample: 0 })
          offers = radar.deals.filter((deal) => matchesEdition(deal) && (!game.steamAppId || !deal.steamAppId || deal.steamAppId === game.steamAppId) && validCurrentOffer(deal, country, Date.now()))
        } catch { queryFailed = true }
        const comparable = !game.targetPrice || offers.some((offer) => targetAmount(offer, game.targetPrice!.currency) !== undefined)
        // Titles can miss provider search punctuation, while a saved Steam ID is stable.
        // Keep title/edition matching as well: a base app ID must not merge a deluxe edition.
        if (ecosystem === 'pc' && game.steamAppId && (!offers.length || !comparable)) {
          try {
            const radar = await options.queryRadar({ country, locale, limit: 120, minSavings: 0, search: `steam:${game.steamAppId}`, regionSample: 0 })
            const exact = radar.deals.filter((deal) => deal.steamAppId === game.steamAppId && matchesEdition(deal) && validCurrentOffer(deal, country, Date.now()))
            offers = [...new Map([...offers, ...exact].map((offer) => [offer.id, offer])).values()]
          } catch { queryFailed = true }
        }
        results.set(game.id, { offers, error: offers.length ? undefined : queryFailed ? `Could not verify ${game.title}.` : `No verified current offer for ${game.title}.` })
      }
    }))
    return serial(async () => {
      const state = await load()
      if ((state.settings['dealrift-country'] ?? 'US') !== country) return state
      const now = new Date().toISOString()
      const alerts = [...state.alerts]
      const known = new Set(alerts.map((alert) => alert.id))
      const rearmed = new Set<string>()
      let failures = 0
      const games = state.games.map((game) => {
        const result = results.get(game.id)
        if (!result || !game.watched || game.owned) return game
        if (result.error) { failures += 1; return { ...game, snapshot: unverified(game.snapshot) } }
        const currencyCode = game.targetPrice?.currency ?? result.offers[0].salePrice.currency
        const sorted = [...result.offers].sort((a, b) => (targetAmount(a, currencyCode) ?? Infinity) - (targetAmount(b, currencyCode) ?? Infinity))
        const best = sorted[0]
        const amount = targetAmount(best, currencyCode)
        if (amount !== undefined && (!game.targetPrice || amount <= game.targetPrice.amount)) {
          const id = alertId(game, amount, currencyCode, country)
          const previousAlerts = alerts.filter((alert) => alert.gameId === game.id && alert.id === alertId(game, alert.price, alert.currency, country))
          const previousLow = Math.min(Infinity, ...previousAlerts.map((alert) => alert.currency === currencyCode ? alert.price : Infinity))
          const previousAmount = game.snapshot && validCurrentOffer(game.snapshot, country, Date.now()) ? targetAmount(game.snapshot, currencyCode) : undefined
          const crossedTarget = game.targetPrice && previousAmount !== undefined && previousAmount > game.targetPrice.amount
          const shouldAlert = previousAlerts.length === 0 || amount < previousLow - 0.005 || crossedTarget
          if (shouldAlert && (!known.has(id) || crossedTarget)) {
            if (known.has(id)) {
              const existingIndex = alerts.findIndex((alert) => alert.id === id)
              if (existingIndex >= 0) alerts.splice(existingIndex, 1)
              rearmed.add(id)
            }
            known.add(id)
            const formatted = new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).format(amount)
            alerts.push({ id, gameId: game.id, title: game.title, message: `${game.title}: ${formatted} · ${best.source}`, price: amount, currency: currencyCode, country, url: best.url, createdAt: now, read: false })
          }
        }
        return { ...game, snapshot: best, updatedAt: now }
      })
      const delivered = deliveredIds(state.settings).filter((id) => !rearmed.has(id))
      const settings = {
        ...state.settings,
        'dealrift-check-cursor': String((position + watched.length) % allWatched.length),
        'dealrift-desktop-notified': JSON.stringify(isQuietHours(state.settings) ? [...new Set([...delivered, ...alerts.map((alert) => alert.id)])].slice(-MAX_ALERTS) : delivered),
      }
      const warnings = [failures ? `${failures} watched game(s) could not be verified; previous snapshots are preserved.` : '', allWatched.length > MAX_CHECK_GAMES ? `Checked ${watched.length} of ${allWatched.length} watched games. The remaining games rotate through subsequent checks.` : ''].filter(Boolean)
      return save({ ...state, revision: state.revision + 1, games, settings, alerts: alerts.slice(-MAX_ALERTS), lastCheckedAt: now, checkError: warnings.join(' ') || undefined })
    })
  }
  const check = () => {
    if (!inFlightCheck) inFlightCheck = performCheck().finally(() => { inFlightCheck = undefined })
    return inFlightCheck
  }
  const notificationsDue = async (now = new Date()): Promise<AlertRecord[]> => {
    const state = await read()
    if (state.settings['dealrift-notifications'] !== 'true' || isQuietHours(state.settings, now)) return []
    const delivered = new Set(deliveredIds(state.settings))
    return state.alerts.filter((alert) => !delivered.has(alert.id) && eligibleAlert(alert, state, now))
  }
  const markNotified = (ids: string[]) => serial(async () => {
    const state = await load()
    const delivered = [...new Set([...deliveredIds(state.settings), ...ids])].slice(-MAX_ALERTS)
    return save({ ...state, revision: state.revision + 1, settings: { ...state.settings, 'dealrift-desktop-notified': JSON.stringify(delivered) } })
  })
  const claimNotifications = (now = new Date()): Promise<AlertRecord[]> => serial(async () => {
    const state = await load()
    if (state.settings['dealrift-notifications'] !== 'true') return []
    const delivered = new Set(deliveredIds(state.settings))
    const pending = state.alerts.filter((alert) => !delivered.has(alert.id))
    if (!pending.length) return []
    const due = isQuietHours(state.settings, now) ? [] : pending.filter((alert) => eligibleAlert(alert, state, now))
    const ids = [...new Set([...delivered, ...pending.map((alert) => alert.id)])].slice(-MAX_ALERTS)
    await save({ ...state, revision: state.revision + 1, settings: { ...state.settings, 'dealrift-desktop-notified': JSON.stringify(ids) } })
    return due
  })
  return { read, update, check, notificationsDue, markNotified, claimNotifications }
}

export function registerLibraryRoutes(app: Express, options: LibraryOptions) {
  const service = createLibraryService(options)
  app.use('/api/library', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  const loopback: RequestHandler = (req, res, next) => {
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host ?? '')) { res.status(403).json({ error: 'Loopback host required.' }); return }
    next()
  }
  const guard: RequestHandler = (req, res, next) => {
    const host = req.headers.host ?? ''
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) { res.status(403).json({ error: 'Loopback host required.' }); return }
    const origin = req.headers.origin
    const sameOrigin = origin === `http://${host}`
    const development = process.env.NODE_ENV !== 'production' && process.env.DEALRIFT_DESKTOP !== '1' && ['http://localhost:5173', 'http://127.0.0.1:5173'].includes(origin ?? '')
    if (!sameOrigin && !development) { res.status(403).json({ error: 'Same-origin request required.' }); return }
    if (!req.is('application/json')) { res.status(415).json({ error: 'JSON required.' }); return }
    next()
  }
  const json = express.json({ limit: MAX_REQUEST_BYTES, strict: true })
  app.get('/api/library', loopback, async (_req, res) => {
    try { res.json(await service.read()) } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'Library unavailable.' }) }
  })
  app.post('/api/library', guard, json, async (req, res) => {
    const parsed = actionSchema.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: 'Invalid library action.', details: parsed.error.flatten() }); return }
    try { res.json(await service.update(parsed.data as LibraryAction)) } catch (error) { res.status(error instanceof z.ZodError ? 400 : 503).json({ error: error instanceof Error ? error.message : 'Library unavailable.' }) }
  })
  app.post('/api/library/check', guard, json, async (_req, res) => {
    try { res.json(await service.check()) } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'Library unavailable.' }) }
  })
  app.post('/api/library/notifications', guard, json, async (_req, res) => {
    try { res.json({ alerts: await service.claimNotifications() }) } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'Library unavailable.' }) }
  })
  const bodyError: ErrorRequestHandler = (error, _req, res, next) => {
    if (error?.type === 'entity.too.large') { res.status(413).json({ error: 'Library request exceeds 2 MiB plus its action envelope.' }); return }
    if (error?.type === 'entity.parse.failed') { res.status(400).json({ error: 'Invalid JSON.' }); return }
    next(error)
  }
  app.use('/api/library', bodyError)
  return service
}
