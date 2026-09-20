export type Language = 'es' | 'en'
export type GameEcosystem = 'pc' | 'playstation' | 'xbox'

export type SourceKind = 'official' | 'authorized' | 'marketplace' | 'freebie' | 'regional'

export type RiskLevel = 'low' | 'medium' | 'high'

export type Confidence = 'live-api' | 'computed' | 'search-link' | 'fallback'

export type DealVerdict = 'exceptional' | 'strong' | 'fair' | 'wait'

export type IntelligenceReasonCode =
  | 'free-game'
  | 'observed-low'
  | 'near-observed-low'
  | 'market-lowest'
  | 'market-competitive'
  | 'deep-discount'
  | 'high-rating'
  | 'regional-advantage'
  | 'direct-link'
  | 'live-source'
  | 'limited-history'
  | 'search-link'
  | 'medium-risk'
  | 'high-risk'
  | 'above-market'
  | 'price-anomaly'

export type SortMode = 'signal' | 'value' | 'savings' | 'price' | 'rating' | 'regional' | 'ending'

export interface StoreSummary {
  id: string
  name: string
  isActive: boolean
  kind: SourceKind
  logoUrl?: string
}

export interface DealPrice {
  amount: number
  currency: string
  formatted: string
  usd?: number
}

export interface DealIntelligenceReason {
  code: IntelligenceReasonCode
  impact: number
  evidence?: string
}

export interface DealIntelligence {
  gameKey: string
  score: number
  verdict: DealVerdict
  confidenceScore: number
  reasons: DealIntelligenceReason[]
  history: {
    sampleCount: number
    firstSeenAt?: string
    lastSeenAt?: string
    paidLowUsd?: number
    averagePaidUsd?: number
    reliable: boolean
    isObservedLow: boolean
    wasEverFree: boolean
  }
  market: {
    offerCount: number
    storeCount: number
    rank: number
    lowestUsd: number
    nextBestUsd?: number
    savingsVsNextUsd?: number
  }
  flags: {
    priceAnomaly: boolean
    expiringSoon: boolean
    searchDestination: boolean
  }
}

export interface Deal {
  ecosystem?: GameEcosystem
  storeProductId?: string
  storeRatingPercent?: number
  id: string
  title: string
  source: string
  sourceKind: SourceKind
  platform: string
  image: string
  url: string
  salePrice: DealPrice
  normalPrice?: DealPrice
  savingsPercent: number
  dealScore: number
  signalScore: number
  metacriticScore?: number
  steamRatingPercent?: number
  steamRatingText?: string
  steamAppId?: string
  startsAt?: string
  expiresAt?: string
  detectedAt: string
  isFree: boolean
  countries: string[]
  bestRegion?: RegionalPricePoint
  riskLevel: RiskLevel
  confidence: Confidence
  tags: string[]
  notes: string[]
  intelligence?: DealIntelligence
  /** Country actually checked by the price provider, not an inferred activation region. */
  priceCountry?: string
  availability?: 'active' | 'upcoming' | 'expired'
  freshness?: { updatedAt: string; stale: boolean; error?: string }
}

export interface RegionalPricePoint {
  countryCode: string
  countryName: string
  currency: string
  final: number
  initial: number
  finalFormatted: string
  initialFormatted?: string
  discountPercent: number
  usd: number
  relativeToBaselinePercent: number
  storeUrl: string
  available: boolean
}

export interface RegionalScan {
  appId: string
  title: string
  baselineCountry: string
  updatedAt: string
  best?: RegionalPricePoint
  rows: RegionalPricePoint[]
}

export interface MarketScout {
  id: string
  title: string
  marketplace: string
  url: string
  riskLevel: RiskLevel
  confidence: Confidence
  countryHint: string
  notes: string[]
}

export interface RadarMetrics {
  totalDeals: number
  freebies: number
  maxSavings: number
  officialDeals: number
  regionalOpportunities: number
  averageSavings: number
  bestRegionalCountry?: string
}

export interface SourceStatus {
  name: string
  ok: boolean
  message: string
  updatedAt: string
  stale?: boolean
  error?: string
  coverage?: 'catalog-search' | 'featured-sample' | 'catalog-sample' | 'reference-us'
}

export interface DealHistoryPoint {
  ecosystem?: GameEcosystem
  country?: string
  updatedAt: string
  totalDeals: number
  freebies: number
  maxSavings: number
  regionalOpportunities: number
  topDealTitle?: string
  topDealPrice?: string
}

export interface RadarResponse {
  ecosystem?: GameEcosystem
  updatedAt: string
  refreshSeconds: number
  country: string
  locale: string
  deals: Deal[]
  stores: StoreSummary[]
  regionalScans: RegionalScan[]
  marketScouts: MarketScout[]
  metrics: RadarMetrics
  sourceStatus: SourceStatus[]
}
