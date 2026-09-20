import type { Deal, GameEcosystem } from './dealTypes.js'

type GameIdentity = { title: string; ecosystem?: GameEcosystem; storeProductId?: string; snapshot?: Deal }

export function canonicalTitle(title: string): string {
  return title.replace(/[™®©]/g, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
}

export function getGameEcosystem(game: { ecosystem?: GameEcosystem; snapshot?: Deal }): GameEcosystem {
  return game.ecosystem ?? game.snapshot?.ecosystem ?? 'pc'
}

export function gameIdentity(game: GameIdentity): string {
  const ecosystem = getGameEcosystem(game)
  // Preserve legacy PC IDs; console licenses and editions have independent store identifiers.
  if (ecosystem === 'pc') return game.title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const productId = game.storeProductId ?? game.snapshot?.storeProductId
  if (!productId && !canonicalTitle(game.title)) return ''
  return `${ecosystem}--${productId ? canonicalTitle(productId) : `title-${canonicalTitle(game.title)}`}`
}

export function libraryMatchesDeal(game: GameIdentity, deal: Deal): boolean {
  if (getGameEcosystem(game) !== getGameEcosystem(deal)) return false
  const productId = game.storeProductId ?? game.snapshot?.storeProductId
  if (getGameEcosystem(game) !== 'pc' && productId) return productId.toLowerCase() === deal.storeProductId?.toLowerCase()
  const title = canonicalTitle(game.title)
  return Boolean(title) && title === canonicalTitle(deal.title)
}
