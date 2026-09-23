import type { Deal } from '../shared/dealTypes'
import { offerExclusion } from './planner'

export type PriceScope = 'country' | 'worldwide'

/** Comparison-only eligibility. Never use it for the base-country library, budget or alerts. */
export function radarOfferExclusion(deal: Deal, country: string, scope: PriceScope, now = Date.now()) {
  if (scope === 'country') return offerExclusion(deal, country, 'USD', now)
  if (!deal.priceCountry || !/^[A-Z]{2}$/.test(deal.priceCountry)) return 'country'
  // Keep the original offer unchanged so personal alerts still reject a foreign quote.
  const comparisonQuote = deal.tags.includes('foreign-price') ? { ...deal, tags: deal.tags.filter((tag) => tag !== 'foreign-price') } : deal
  return offerExclusion(comparisonQuote, deal.priceCountry, 'USD', now)
}

export function worldwideUsd(deal: Deal) {
  const value = deal.salePrice.usd ?? (deal.salePrice.currency === 'USD' ? deal.salePrice.amount : undefined)
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function worldwidePriceLabel(deal: Deal) {
  const value = worldwideUsd(deal)
  return value === undefined ? '— USD' : `$${value.toFixed(2)} USD`
}

/** Preserve the store's localized price while making ambiguous currency symbols explicit. */
export function nativePriceLabel(deal: Deal) {
  const { formatted, currency } = deal.salePrice
  return formatted.toUpperCase().match(/\b[A-Z]{3}\b/g)?.includes(currency.toUpperCase()) ? formatted : `${formatted} ${currency}`
}
