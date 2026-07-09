import type { DealHistoryPoint, RadarResponse, RegionalScan } from '../shared/dealTypes'

export interface RadarParams {
  country: string
  locale: string
  limit: number
  minSavings: number
  search?: string
  regionSample: number
}

export async function fetchRadar(params: RadarParams, signal?: AbortSignal) {
  const query = new URLSearchParams({
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

export async function fetchHistory(signal?: AbortSignal) {
  const response = await fetch('/api/history', { signal })
  if (!response.ok) {
    throw new Error(`History API failed: ${response.status}`)
  }

  return (await response.json()) as DealHistoryPoint[]
}
