import type { Deal } from '../shared/dealTypes'
import type { LibraryGame } from '../shared/libraryTypes'
import { libraryMatchesDeal } from '../shared/gameIdentity'

export const MAX_OFFER_AGE_MS = 30 * 60 * 1000
export type ExclusionReason = 'owned' | 'unwatched' | 'missing' | 'stale' | 'expired' | 'upcoming' | 'country' | 'currency' | 'risk' | 'budget'
export interface PlanItem { game: LibraryGame; deal: Deal; amount: number }
export interface PurchasePlan { items: PlanItem[]; excluded: { game: LibraryGame; reason: ExclusionReason }[]; total: number; remaining: number }

/** Decimal entry, without grouping or exponential notation. A comma is accepted as the decimal separator. */
export function parseMoney(input: string): number | undefined {
  const value = input.trim()
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) return undefined
  const amount = Number(value.replace(',', '.'))
  return Number.isFinite(amount) && amount >= 0 && amount <= 100_000_000 ? amount : undefined
}

export function formatMoney(amount: number, currency: string, language = 'en') {
  try {
    return new Intl.NumberFormat(language === 'es' ? 'es-CO' : 'en-US', { style: 'currency', currency, currencyDisplay: 'code', maximumFractionDigits: 2 }).format(amount)
  } catch { return `${amount.toFixed(2)} ${currency}` }
}

export function offerAmount(deal: Deal, currency: string): number | undefined {
  const value = deal.salePrice.currency === currency ? deal.salePrice.amount : currency === 'USD' ? deal.salePrice.usd : undefined
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function offerExclusion(deal: Deal, country: string, currency: string, now = Date.now()): ExclusionReason | undefined {
  const detected = Date.parse(deal.freshness?.updatedAt ?? deal.detectedAt)
  if (deal.freshness?.stale || deal.tags.includes('stale') || !Number.isFinite(detected) || detected > now + 60_000 || now - detected > MAX_OFFER_AGE_MS) return 'stale'
  if (deal.availability === 'expired' || deal.tags.includes('expired')) return 'expired'
  if (deal.availability === 'upcoming' || deal.tags.includes('upcoming')) return 'upcoming'
  if (deal.expiresAt && (!Number.isFinite(Date.parse(deal.expiresAt)) || Date.parse(deal.expiresAt) <= now)) return 'expired'
  if (deal.startsAt && (!Number.isFinite(Date.parse(deal.startsAt)) || Date.parse(deal.startsAt) > now)) return 'upcoming'
  if ((deal.priceCountry && deal.priceCountry !== country.toUpperCase()) || deal.tags.includes('foreign-price')) return 'country'
  const supported = deal.countries.some((value) => value.toUpperCase() === country.toUpperCase()) || (!deal.priceCountry && deal.countries.length > 0 && deal.countries.every((value) => ['GLOBAL', 'WW'].includes(value.toUpperCase())))
  if (!supported) return 'country'
  if (deal.riskLevel !== 'low' || deal.confidence === 'fallback' || deal.confidence === 'search-link' || deal.tags.some((tag) => ['store-search-link', 'unverified'].includes(tag))) return 'risk'
  if (offerAmount(deal, currency) === undefined) return 'currency'
  return undefined
}

/** Greedy, deterministic: priority 1 first, then cheapest. This is not an optimal knapsack solver. */
export function buildPurchasePlan(games: LibraryGame[], deals: Deal[], budget: number, currency: string, country: string, now = Date.now()): PurchasePlan {
  const excluded: PurchasePlan['excluded'] = []
  const candidates: PlanItem[] = []
  const safeBudget = Number.isFinite(budget) && budget >= 0 ? Math.min(budget, 100_000_000) : 0
  for (const game of games) {
    if (game.owned || !game.watched) { excluded.push({ game, reason: game.owned ? 'owned' : 'unwatched' }); continue }
    const matches = deals.filter((deal) => libraryMatchesDeal(game, deal))
    // A stored snapshot is usable only within the same freshness and eligibility checks.
    if (game.snapshot && libraryMatchesDeal(game, game.snapshot)) {
      const duplicate = matches.findIndex((deal) => deal.id === game.snapshot?.id)
      if (duplicate < 0) matches.push(game.snapshot)
      else if (Date.parse(game.snapshot.freshness?.updatedAt ?? game.snapshot.detectedAt) > Date.parse(matches[duplicate].freshness?.updatedAt ?? matches[duplicate].detectedAt)) matches[duplicate] = game.snapshot
    }
    const eligible = matches.filter((deal) => !offerExclusion(deal, country, currency, now))
      .sort((a, b) => offerAmount(a, currency)! - offerAmount(b, currency)! || a.id.localeCompare(b.id))
    if (!eligible.length) { excluded.push({ game, reason: matches.length ? offerExclusion(matches[0], country, currency, now) ?? 'missing' : 'missing' }); continue }
    candidates.push({ game, deal: eligible[0], amount: offerAmount(eligible[0], currency)! })
  }
  candidates.sort((a, b) => a.game.priority - b.game.priority || a.amount - b.amount || a.game.id.localeCompare(b.game.id))
  let cents = Math.floor(safeBudget * 100 + 0.00001)
  const items: PlanItem[] = []
  for (const item of candidates) {
    const cost = Math.ceil(item.amount * 100 - 0.00001)
    if (cost <= cents) { items.push(item); cents -= cost } else excluded.push({ game: item.game, reason: 'budget' })
  }
  const total = items.reduce((sum, item) => sum + Math.ceil(item.amount * 100 - 0.00001), 0) / 100
  return { items, excluded, total, remaining: cents / 100 }
}

/** Candidate discovery only. Never use this relaxed key to merge offers, ownership, or histories. */
export function editionFamily(title: string) {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(standard|deluxe|ultimate|complete|definitive|collector'?s?|gold|premium|game of the year|goty)\s*(edition)?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}
