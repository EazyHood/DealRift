import { z } from 'zod'

// Keep import validation aligned with the local API. The API validates the complete request again.
const roots = ['2game.com', 'allkeyshop.com', 'allyouplay.com', 'amazon.com', 'cdkeys.com', 'dlgamer.com', 'dreamgame.com', 'eneba.com', 'epicgames.com', 'fanatical.com', 'g2a.com', 'gamebillet.com', 'gamersgate.com', 'gamesload.com', 'gamesplanet.com', 'gg.deals', 'gog.com', 'greenmangaming.com', 'humblebundle.com', 'indiegala.com', 'kinguin.net', 'steampowered.com', 'steamdb.info', 'ubisoft.com', 'wingamestore.com']
export function safeImportedStoreUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
    if (url.hostname === 'www.cheapshark.com') {
      const keys = [...url.searchParams.keys()]
      return url.pathname === '/redirect' && !url.hash && keys.length === 1 && keys[0] === 'dealID' && /^[A-Za-z0-9+/=_-]{1,256}$/.test(url.searchParams.get('dealID') ?? '')
    }
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (['store.playstation.com', 'www.xbox.com', 'xbox.com', 'www.microsoft.com'].includes(host)) return true
    return roots.some((root) => host === root || host.endsWith(`.${root}`))
  } catch { return false }
}
const text = z.string().max(2000)
const date = z.string().datetime({ offset: true })
const finite = z.number().finite()
const money = finite.min(0).max(1e12)
const currency = z.string().regex(/^[A-Z]{3}$/)
const storeUrl = z.string().max(3000).refine(safeImportedStoreUrl)
const price = z.object({ amount: money, currency, formatted: text, usd: money.optional() }).strict()
const imageUrl = z.string().max(3000).refine((value) => {
  if (!value) return true
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password } catch { return false }
})
const region = z.object({ countryCode: z.string().regex(/^[A-Z]{2}$/), countryName: text, currency: z.string().max(10), final: money, initial: money, finalFormatted: text, initialFormatted: text.optional(), discountPercent: finite.min(0).max(100), usd: money, relativeToBaselinePercent: finite, storeUrl, available: z.boolean() }).strict()
const intelligence = z.object({
  gameKey: z.string().max(300), score: finite.min(0).max(100), verdict: z.enum(['exceptional', 'strong', 'fair', 'wait']), confidenceScore: finite.min(0).max(100),
  reasons: z.array(z.object({ code: z.enum(['free-game', 'observed-low', 'near-observed-low', 'market-lowest', 'market-competitive', 'deep-discount', 'high-rating', 'regional-advantage', 'direct-link', 'live-source', 'limited-history', 'search-link', 'medium-risk', 'high-risk', 'above-market', 'price-anomaly']), impact: finite, evidence: text.optional() }).strict()).max(30),
  history: z.object({ sampleCount: z.number().int().nonnegative(), firstSeenAt: date.optional(), lastSeenAt: date.optional(), paidLowUsd: money.optional(), averagePaidUsd: money.optional(), reliable: z.boolean(), isObservedLow: z.boolean(), wasEverFree: z.boolean() }).strict(),
  market: z.object({ offerCount: z.number().int().nonnegative(), storeCount: z.number().int().nonnegative(), rank: z.number().int().nonnegative(), lowestUsd: money, nextBestUsd: money.optional(), savingsVsNextUsd: money.optional() }).strict(),
  flags: z.object({ priceAnomaly: z.boolean(), expiringSoon: z.boolean(), searchDestination: z.boolean() }).strict(),
}).strict()
export const importedSnapshotSchema = z.object({
  ecosystem: z.enum(['pc', 'playstation', 'xbox']).optional(), storeProductId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(), storeRatingPercent: finite.min(0).max(100).optional(),
  id: z.string().min(1).max(500), title: z.string().min(1).max(300), source: text, sourceKind: z.enum(['official', 'authorized', 'marketplace', 'freebie', 'regional']), platform: text,
  image: imageUrl, url: storeUrl, salePrice: price, normalPrice: price.optional(), savingsPercent: finite.min(0).max(100), dealScore: finite, signalScore: finite,
  metacriticScore: finite.min(0).max(100).optional(), steamRatingPercent: finite.min(0).max(100).optional(), steamRatingText: text.optional(), steamAppId: z.string().regex(/^\d{1,12}$/).optional(),
  startsAt: date.optional(), expiresAt: date.optional(), detectedAt: date, isFree: z.boolean(), countries: z.array(z.string().min(2).max(30)).max(60), bestRegion: region.optional(),
  riskLevel: z.enum(['low', 'medium', 'high']), confidence: z.enum(['live-api', 'computed', 'search-link', 'fallback']), tags: z.array(z.string().max(100)).max(40), notes: z.array(text).max(30), intelligence: intelligence.optional(),
  freshness: z.object({ updatedAt: date, stale: z.boolean(), error: text.optional() }).strict().optional(), availability: z.enum(['active', 'upcoming', 'expired']).optional(), priceCountry: z.string().regex(/^[A-Z]{2}$/).optional(),
}).strict()
export const importedAlertSchema = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/), gameId: z.string().min(1).max(300), title: text, message: text, price: money, currency, url: storeUrl, createdAt: date, read: z.boolean(), country: z.string().regex(/^[A-Z]{2}$/).optional() }).strict()
export const importedSettingsSchema = z.record(z.string().regex(/^dealrift-[a-z0-9-]{1,70}$/), z.string().max(32768)).refine((settings) => {
  if (Object.keys(settings).length > 100) return false
  for (const key of ['dealrift-background', 'dealrift-notifications', 'dealrift-low-power', 'dealrift-hide-owned']) if (settings[key] !== undefined && !['true', 'false'].includes(settings[key])) return false
  for (const key of ['dealrift-quiet-start', 'dealrift-quiet-end']) if (settings[key] !== undefined && settings[key] !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(settings[key])) return false
  return settings['dealrift-country'] === undefined || /^[A-Z]{2}$/.test(settings['dealrift-country'])
})
export const importedDateSchema = date
