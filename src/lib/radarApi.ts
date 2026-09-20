import type { GameEcosystem, DealHistoryPoint, RadarResponse, RegionalScan } from '../shared/dealTypes'

export interface RadarParams {
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

  return (await response.json()) as RadarResponse
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
