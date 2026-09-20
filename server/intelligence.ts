import { gameIdentity } from '../src/shared/gameIdentity.js'
import type {
  Deal,
  DealIntelligence,
  DealIntelligenceReason,
  DealVerdict,
  IntelligenceReasonCode,
  RiskLevel,
} from '../src/shared/dealTypes.js'

const SIX_HOURS_MS = 6 * 60 * 60 * 1000
const RELIABLE_HISTORY_MS = 12 * 60 * 60 * 1000
const MAX_OBSERVATIONS_PER_GAME = 180
const MAX_TRACKED_GAMES = 1500

export interface DealPriceObservation {
  at: string
  bestPaidUsd?: number
  bestStore?: string
  freeStore?: string
  free: boolean
  offerCount: number
}

export interface DealPriceHistoryEntry {
  title: string
  country: string
  observations: DealPriceObservation[]
}

export interface DealPriceHistoryDatabase {
  version: 1
  games: Record<string, DealPriceHistoryEntry>
}

export function emptyPriceHistory(): DealPriceHistoryDatabase {
  return { version: 1, games: {} }
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function dealUsd(deal: Deal) {
  return deal.salePrice.usd ?? (deal.salePrice.currency === 'USD' ? deal.salePrice.amount : Number.NaN)
}

/** Only verified, currently claimable prices can support comparisons or historical claims. */
export function isCurrentVerifiedDeal(deal: Deal, country?: string, now = Date.now()) {
  if (deal.freshness?.stale || deal.confidence === 'fallback' || deal.confidence === 'search-link') return false
  if (deal.availability === 'upcoming' || deal.availability === 'expired' || deal.tags.includes('upcoming')) return false
  if (deal.startsAt && (!Number.isFinite(Date.parse(deal.startsAt)) || Date.parse(deal.startsAt) > now)) return false
  if (deal.expiresAt && (!Number.isFinite(Date.parse(deal.expiresAt)) || Date.parse(deal.expiresAt) <= now)) return false
  if (country && (deal.priceCountry ? deal.priceCountry !== country.toUpperCase() : !deal.countries.includes(country.toUpperCase()))) return false
  return Number.isFinite(dealUsd(deal)) && dealUsd(deal) >= 0
}

export function canonicalGameKey(title: string) {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
}

export function priceHistoryKey(country: string, game: string | Deal) {
  return `${country.toUpperCase()}:${typeof game === 'string' ? canonicalGameKey(game) : gameIdentity(game)}`
}

export function parsePriceHistory(value: unknown): DealPriceHistoryDatabase {
  if (!value || typeof value !== 'object') return emptyPriceHistory()
  const candidate = value as Partial<DealPriceHistoryDatabase>
  if (candidate.version !== 1 || !candidate.games || typeof candidate.games !== 'object') return emptyPriceHistory()

  const games: Record<string, DealPriceHistoryEntry> = {}
  for (const [key, entryValue] of Object.entries(candidate.games)) {
    if (!entryValue || typeof entryValue !== 'object') continue
    const entry = entryValue as Partial<DealPriceHistoryEntry>
    if (typeof entry.title !== 'string' || typeof entry.country !== 'string' || !Array.isArray(entry.observations)) continue

    const observations = entry.observations
      .filter((observation): observation is DealPriceObservation => {
        if (!observation || typeof observation !== 'object') return false
        const point = observation as Partial<DealPriceObservation>
        return (
          typeof point.at === 'string' && Number.isFinite(Date.parse(point.at)) &&
          typeof point.free === 'boolean' &&
          typeof point.offerCount === 'number' && Number.isFinite(point.offerCount) && point.offerCount >= 0 &&
          (point.bestPaidUsd === undefined || (typeof point.bestPaidUsd === 'number' && Number.isFinite(point.bestPaidUsd) && point.bestPaidUsd >= 0))
        )
      })
      .slice(-MAX_OBSERVATIONS_PER_GAME)

    games[key] = { title: entry.title, country: entry.country, observations }
  }

  return { version: 1, games }
}

function verdictFor(score: number, risk: RiskLevel, anomaly: boolean, confidence: number): DealVerdict {
  if (risk === 'high' || (anomaly && confidence < 65)) return 'wait'
  if (score >= 82) return 'exceptional'
  if (score >= 60) return 'strong'
  if (score >= 45) return 'fair'
  return 'wait'
}

function addReason(
  reasons: DealIntelligenceReason[],
  code: IntelligenceReasonCode,
  impact: number,
  evidence?: string,
) {
  reasons.push({ code, impact: Math.round(impact), evidence })
}

function buildIntelligence(
  deal: Deal,
  group: Deal[],
  history: DealPriceHistoryEntry | undefined,
  now: number,
  current = true,
): DealIntelligence {
  const price = dealUsd(deal)
  const market = [...group].sort((a, b) => dealUsd(a) - dealUsd(b) || b.signalScore - a.signalScore)
  const lowerOffers = market.filter((candidate) => dealUsd(candidate) < price - 0.005).length
  const rank = lowerOffers + 1
  const alternative = market.find((candidate) => candidate.id !== deal.id)
  const lowestUsd = dealUsd(market[0] ?? deal)
  const observations = history?.observations ?? []
  const paidHistory = observations
    .map((observation) => observation.bestPaidUsd)
    .filter((value): value is number => typeof value === 'number' && value > 0)
  const firstSeenAt = observations[0]?.at
  const lastSeenAt = observations.at(-1)?.at
  const historySpan = firstSeenAt && lastSeenAt ? new Date(lastSeenAt).getTime() - new Date(firstSeenAt).getTime() : 0
  const reliableHistory = observations.length >= 3 && historySpan >= RELIABLE_HISTORY_MS
  const paidLowUsd = paidHistory.length ? Math.min(...paidHistory) : undefined
  const averagePaidUsd = paidHistory.length ? round(paidHistory.reduce((sum, value) => sum + value, 0) / paidHistory.length) : undefined
  const isObservedLow = Boolean(reliableHistory && !deal.isFree && paidLowUsd !== undefined && price <= paidLowUsd + 0.01)
  const wasEverFree = observations.some((observation) => observation.free)
  const directLink = !deal.tags.includes('store-search-link') && deal.confidence !== 'search-link'
  const expiresIn = deal.expiresAt ? new Date(deal.expiresAt).getTime() - now : Number.POSITIVE_INFINITY
  const expiringSoon = expiresIn > 0 && expiresIn <= 72 * 60 * 60 * 1000
  const normalUsd = deal.normalPrice?.usd ?? deal.normalPrice?.amount ?? 0
  const priceAnomaly = !deal.isFree && price > 0 && price <= 1 && normalUsd >= 20 && deal.savingsPercent >= 95
  const reasons: DealIntelligenceReason[] = []

  let score = 18 + Math.min(8, deal.signalScore * 0.08)
  if (deal.isFree) {
    score += 48
    addReason(reasons, 'free-game', 48)
  }

  const discountImpact = Math.min(24, Math.max(0, deal.savingsPercent) * 0.24)
  score += discountImpact
  if (deal.savingsPercent >= 75) addReason(reasons, 'deep-discount', round(discountImpact), `${Math.round(deal.savingsPercent)}%`)

  const rating = deal.storeRatingPercent ?? deal.steamRatingPercent ?? deal.metacriticScore ?? 0
  if (rating >= 80) {
    const impact = Math.min(9, (rating - 70) * 0.3)
    score += impact
    addReason(reasons, 'high-rating', round(impact), `${Math.round(rating)}%`)
  }

  if (!deal.isFree && reliableHistory && paidLowUsd !== undefined) {
    if (isObservedLow) {
      score += 18
      addReason(reasons, 'observed-low', 18, `$${paidLowUsd.toFixed(2)}`)
    } else if (price <= paidLowUsd * 1.1) {
      score += 11
      addReason(reasons, 'near-observed-low', 11, `$${paidLowUsd.toFixed(2)}`)
    }
  } else if (!deal.isFree) {
    addReason(reasons, 'limited-history', 0, String(observations.length))
  }

  if (market.length > 1) {
    if (rank === 1) {
      score += 12
      addReason(reasons, 'market-lowest', 12, `${market.length}`)
    } else if (rank === 2 && price <= lowestUsd * 1.08) {
      score += 6
      addReason(reasons, 'market-competitive', 6, `#${rank}/${market.length}`)
    } else if (price > lowestUsd * 1.15) {
      score -= 9
      addReason(reasons, 'above-market', -9, `$${lowestUsd.toFixed(2)}`)
    }
  }

  const regionalAdvantage = deal.bestRegion && deal.bestRegion.usd < price * 0.98
    ? Math.abs(Math.min(0, deal.bestRegion.relativeToBaselinePercent))
    : 0
  if (regionalAdvantage >= 8) {
    const impact = Math.min(10, regionalAdvantage * 0.22)
    score += impact
    addReason(reasons, 'regional-advantage', round(impact), `${round(regionalAdvantage)}%`)
  }

  if (directLink) {
    score += 4
    addReason(reasons, 'direct-link', 4)
  } else {
    score -= 4
    addReason(reasons, 'search-link', -4)
  }

  if (deal.confidence === 'live-api') {
    score += 4
    addReason(reasons, 'live-source', 4)
  }

  if (deal.riskLevel === 'medium') {
    score -= 10
    addReason(reasons, 'medium-risk', -10)
  } else if (deal.riskLevel === 'high') {
    score -= 28
    addReason(reasons, 'high-risk', -28)
  }

  if (priceAnomaly) {
    score -= 4
    addReason(reasons, 'price-anomaly', -4)
  }

  let confidenceScore = 30
  confidenceScore += deal.confidence === 'live-api' ? 25 : deal.confidence === 'computed' ? 16 : deal.confidence === 'search-link' ? 5 : 0
  confidenceScore += directLink ? 12 : 0
  confidenceScore += deal.sourceKind === 'official' || deal.sourceKind === 'freebie' ? 15 : deal.sourceKind === 'authorized' ? 10 : -8
  confidenceScore += reliableHistory ? 12 : Math.min(8, observations.length * 2)
  confidenceScore += market.length > 1 ? 6 : 0
  confidenceScore = Math.round(clamp(confidenceScore, 5, 100))
  const normalizedScore = current ? Math.round(clamp(score, 0, 100)) : 0
  if (!current) confidenceScore = Math.min(25, confidenceScore)
  const sortedReasons = current ? reasons.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 6) : []

  return {
    gameKey: gameIdentity(deal),
    score: normalizedScore,
    verdict: verdictFor(normalizedScore, deal.riskLevel, priceAnomaly, confidenceScore),
    confidenceScore,
    reasons: sortedReasons,
    history: {
      sampleCount: observations.length,
      firstSeenAt,
      lastSeenAt,
      paidLowUsd,
      averagePaidUsd,
      reliable: reliableHistory,
      isObservedLow: current && isObservedLow,
      wasEverFree,
    },
    market: {
      offerCount: current ? market.length : 0,
      storeCount: current ? new Set(market.map((candidate) => candidate.source)).size : 0,
      rank: current ? rank : 0,
      lowestUsd: Number.isFinite(lowestUsd) ? round(lowestUsd) : 0,
      nextBestUsd: current && alternative ? round(dealUsd(alternative)) : undefined,
      savingsVsNextUsd: current && alternative ? round(Math.max(0, dealUsd(alternative) - price)) : undefined,
    },
    flags: {
      priceAnomaly,
      expiringSoon,
      searchDestination: !directLink,
    },
  }
}

export function enrichDealsWithIntelligence(
  deals: Deal[],
  country: string,
  database: DealPriceHistoryDatabase,
  now = Date.now(),
) {
  const groups = new Map<string, Deal[]>()
  for (const deal of deals) {
    if (!isCurrentVerifiedDeal(deal, country, now)) continue
    const key = gameIdentity(deal)
    const group = groups.get(key) ?? []
    group.push(deal)
    groups.set(key, group)
  }

  return deals.map((deal) => {
    const gameKey = gameIdentity(deal)
    return {
      ...deal,
      intelligence: buildIntelligence(deal, groups.get(gameKey) ?? [], database.games[priceHistoryKey(country, deal)], now, isCurrentVerifiedDeal(deal, country, now)),
    }
  })
}

function observationChanged(previous: DealPriceObservation | undefined, next: DealPriceObservation) {
  if (!previous) return true
  if (previous.free !== next.free || previous.bestStore !== next.bestStore || previous.offerCount !== next.offerCount) return true
  return Math.abs((previous.bestPaidUsd ?? 0) - (next.bestPaidUsd ?? 0)) >= 0.01
}

export function recordPriceObservations(
  database: DealPriceHistoryDatabase,
  deals: Deal[],
  country: string,
  at = new Date().toISOString(),
) {
  const groups = new Map<string, Deal[]>()
  for (const deal of deals) {
    if (!isCurrentVerifiedDeal(deal, country, Date.parse(at))) continue
    const key = priceHistoryKey(country, deal)
    const group = groups.get(key) ?? []
    group.push(deal)
    groups.set(key, group)
  }

  const games = { ...database.games }
  for (const [key, group] of groups) {
    const paid = group.filter((deal) => !deal.isFree && dealUsd(deal) > 0).sort((a, b) => dealUsd(a) - dealUsd(b))
    const bestPaid = paid[0]
    const observation: DealPriceObservation = {
      at,
      bestPaidUsd: bestPaid ? round(dealUsd(bestPaid)) : undefined,
      bestStore: bestPaid?.source,
      freeStore: group.find((deal) => deal.isFree)?.source,
      free: group.some((deal) => deal.isFree),
      offerCount: group.length,
    }
    const current = games[key] ?? { title: group[0]?.title ?? key, country: country.toUpperCase(), observations: [] }
    const previous = current.observations.at(-1)
    const previousTime = previous ? new Date(previous.at).getTime() : 0
    const shouldRecord = observationChanged(previous, observation) || new Date(at).getTime() - previousTime >= SIX_HOURS_MS
    if (!shouldRecord) continue

    games[key] = {
      ...current,
      title: group[0]?.title ?? current.title,
      observations: [...current.observations, observation].slice(-MAX_OBSERVATIONS_PER_GAME),
    }
  }

  const prunedEntries = Object.entries(games)
    .sort(([, a], [, b]) => (b.observations.at(-1)?.at ?? '').localeCompare(a.observations.at(-1)?.at ?? ''))
    .slice(0, MAX_TRACKED_GAMES)

  return { version: 1, games: Object.fromEntries(prunedEntries) } satisfies DealPriceHistoryDatabase
}

export function priceHistoryStats(database: DealPriceHistoryDatabase) {
  const entries = Object.values(database.games)
  return {
    games: entries.length,
    observations: entries.reduce((total, entry) => total + entry.observations.length, 0),
  }
}
