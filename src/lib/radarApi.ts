import type { GameEcosystem, DealHistoryPoint, RadarResponse, RegionalScan } from '../shared/dealTypes'

export interface RadarParams {
  priceScope?: 'country' | 'worldwide'
  onlyFree?: boolean
  ecosystem?: GameEcosystem
  country: string
  locale: string
  limit: number
  minSavings: number
  search?: string
  regionSample: number
}

export async function fetchRadar(params: RadarParams, signal?: AbortSignal) {
  const query = new URLSearchParams({
    priceScope: params.priceScope ?? 'country',
    ecosystem: params.ecosystem ?? 'pc',
    onlyFree: String(params.onlyFree ?? false),
    country: params.country,
    locale: params.locale,
    limit: String(params.limit),
    minSavings: String(params.minSavings),
    regionSample: String(params.regionSample),
  })

  if (params.search) query.set('search', params.search)

  const response = await fetch(`/api/radar?${query.toString()}`, { signal })
  if (!response.ok) {
    throw new Error(`Radar API failed: ${response.status}`)
  }

  const result = (await response.json()) as RadarResponse
  if (!radarMatchesRequest(result, params)) throw new Error('Radar returned data for a different country, platform or price scope. Please retry.')
  return result
}

export function radarMatchesRequest(response: RadarResponse, params: RadarParams) {
  return response.country === params.country && (response.ecosystem ?? 'pc') === (params.ecosystem ?? 'pc') &&
    (response.priceScope ?? 'country') === (params.priceScope ?? 'country')
}

export async function fetchRegionalScan(appId: string, title: string, country: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ title, country })
  const response = await fetch(`/api/regions/${encodeURIComponent(appId)}?${query.toString()}`, { signal })
  if (!response.ok) {
    throw new Error(`Regional scan failed: ${response.status}`)
  }

  return (await response.json()) as RegionalScan
}

export async function fetchHistory(signal?: AbortSignal, ecosystem: GameEcosystem = 'pc', country?: string) {
  const response = await fetch(`/api/history?${new URLSearchParams({ ecosystem, ...(country ? { country } : {}) })}`, { signal })
  if (!response.ok) {
    throw new Error(`History API failed: ${response.status}`)
  }

  return (await response.json()) as DealHistoryPoint[]
}
