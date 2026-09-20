import type { Deal } from './dealTypes.js'

export interface PriceTarget { amount: number; currency: string }
export interface LibraryGame {
  id: string
  title: string
  steamAppId?: string
  owned: boolean
  watched: boolean
  priority: 1 | 2 | 3
  notes: string
  targetPrice?: PriceTarget
  snapshot?: Deal
  updatedAt: string
}
export interface AlertRecord {
  id: string
  gameId: string
  title: string
  message: string
  price: number
  currency: string
  url: string
  createdAt: string
  read: boolean
  country?: string
}
export interface LibraryState {
  schemaVersion: 1
  revision: number
  settings: Record<string, string>
  games: LibraryGame[]
  alerts: AlertRecord[]
  lastCheckedAt?: string
  checkError?: string
}
export type LibraryAction =
  | { action: 'upsert'; game: LibraryGame }
  | { action: 'remove'; id: string }
  | { action: 'settings'; settings: Record<string, string> }
  | { action: 'import'; games: LibraryGame[] }
  | { action: 'restore'; state: LibraryState }
  | { action: 'read-alerts' }

export interface GamePricePoint { at: string; priceUsd: number; source: string; free: boolean }
export interface GameHistoryResponse { gameKey: string; country: string; points: GamePricePoint[] }

export function libraryGameId(deal: Deal): string {
  // Keep editions distinct even when providers share a base Steam app ID.
  return deal.intelligence?.gameKey ?? deal.title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
