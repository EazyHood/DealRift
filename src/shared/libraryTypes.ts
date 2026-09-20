import type { Deal, GameEcosystem } from './dealTypes.js'
import { gameIdentity } from './gameIdentity.js'

export interface PriceTarget { amount: number; currency: string }
export interface LibraryGame {
  ecosystem?: GameEcosystem
  storeProductId?: string
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
  return gameIdentity(deal)
}
