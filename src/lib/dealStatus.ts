import type { Deal, Language } from '../shared/dealTypes'
import { MAX_OFFER_AGE_MS } from './planner'

export function dealStatusLabels(deal: Deal, country: string, language: Language, now = Date.now()) {
  const es = language === 'es'
  const labels: string[] = []
  if (deal.availability === 'upcoming' || deal.tags.includes('upcoming') || (deal.startsAt && Date.parse(deal.startsAt) > now)) labels.push(es ? 'Próxima: aún no disponible a este precio' : 'Upcoming: not available at this price yet')
  if (deal.availability === 'expired' || deal.tags.includes('expired') || (deal.expiresAt && Date.parse(deal.expiresAt) <= now)) labels.push(es ? 'Oferta finalizada' : 'Expired offer')
  const updated = Date.parse(deal.freshness?.updatedAt ?? deal.detectedAt)
  if (deal.freshness?.stale || !Number.isFinite(updated) || now - updated > MAX_OFFER_AGE_MS || deal.tags.includes('stale')) labels.push(es ? 'Precio antiguo: requiere actualización' : 'Older price: refresh required')
  if (deal.priceCountry && deal.priceCountry !== country) labels.push(es ? `Precio de ${deal.priceCountry}; no verificado para ${country}` : `${deal.priceCountry} price; not verified for ${country}`)
  else if (!deal.countries.some((code) => code.toUpperCase() === country) && !deal.countries.every((code) => ['GLOBAL', 'WW'].includes(code.toUpperCase()))) labels.push(es ? 'País no verificado para esta oferta' : 'Country not verified for this offer')
  if (deal.confidence === 'fallback' || deal.tags.includes('unverified')) labels.push(es ? 'Oferta guardada pendiente de verificar' : 'Saved offer awaiting verification')
  return labels
}
