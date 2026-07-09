const TRUSTED_STORE_ROOTS = Object.freeze([
  '2game.com',
  'allkeyshop.com',
  'allyouplay.com',
  'amazon.com',
  'cdkeys.com',
  'dlgamer.com',
  'dreamgame.com',
  'eneba.com',
  'epicgames.com',
  'fanatical.com',
  'g2a.com',
  'gamebillet.com',
  'gamersgate.com',
  'gamesload.com',
  'gamesplanet.com',
  'gg.deals',
  'gog.com',
  'greenmangaming.com',
  'humblebundle.com',
  'indiegala.com',
  'kinguin.net',
  'steampowered.com',
  'steamdb.info',
  'ubisoft.com',
  'wingamestore.com',
])

function hasTrustedHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return TRUSTED_STORE_ROOTS.some((root) => host === root || host.endsWith(`.${root}`))
}

export function isTrustedStoreUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && hasTrustedHost(url.hostname)
  } catch {
    return false
  }
}

export function trustedStoreUrl(candidate: string | undefined, fallback: string) {
  return candidate && isTrustedStoreUrl(candidate) ? candidate : fallback
}

export function storeSearchUrl(storeName: string, title: string, steamAppId?: string) {
  const store = storeName.toLowerCase()
  const query = encodeURIComponent(title)

  if (store.includes('steam')) {
    return steamAppId ? `https://store.steampowered.com/app/${encodeURIComponent(steamAppId)}/` : `https://store.steampowered.com/search/?term=${query}`
  }
  if (store.includes('epic')) return `https://store.epicgames.com/browse?q=${query}&sortBy=relevancy&sortDir=DESC&count=40`
  if (store.includes('gog')) return `https://www.gog.com/en/games?query=${query}&order=desc:score`
  if (store.includes('humble')) return `https://www.humblebundle.com/store/search?search=${query}`
  if (store.includes('fanatical')) return `https://www.fanatical.com/en/search?search=${query}`
  if (store.includes('gamebillet')) return `https://www.gamebillet.com/search?q=${query}`
  if (store.includes('greenmangaming')) return `https://www.greenmangaming.com/search/?query=${query}`
  if (store.includes('gamersgate')) return `https://www.gamersgate.com/games/?q=${query}`
  if (store.includes('gamesplanet')) return `https://us.gamesplanet.com/search?query=${query}`
  if (store.includes('gamesload')) return `https://www.gamesload.com/catalogsearch/result/?q=${query}`
  if (store.includes('indiegala')) return `https://www.indiegala.com/store_search?search=${query}`
  if (store.includes('ubisoft') || store.includes('uplay')) return `https://store.ubisoft.com/search?q=${query}`
  if (store.includes('wingamestore')) return `https://www.wingamestore.com/search/?SearchWord=${query}`
  if (store.includes('2game')) return `https://2game.com/catalogsearch/result/?q=${query}`
  if (store.includes('dreamgame')) return `https://www.dreamgame.com/en/search?keyword=${query}`
  if (store.includes('dlgamer')) return `https://www.dlgamer.com/us/games/buy-games/search?keywords=${query}`
  if (store.includes('allyouplay')) return `https://www.allyouplay.com/en/catalogsearch/result/?q=${query}`
  if (store.includes('amazon')) return `https://www.amazon.com/s?k=${query}`

  return steamAppId ? `https://store.steampowered.com/app/${encodeURIComponent(steamAppId)}/` : `https://store.steampowered.com/search/?term=${query}`
}
