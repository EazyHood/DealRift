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

function hasTrustedHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (['store.playstation.com', 'www.xbox.com', 'xbox.com', 'www.microsoft.com'].includes(host)) return true
  return TRUSTED_STORE_ROOTS.some((root) => host === root || host.endsWith(`.${root}`))
}

function isTrustedExternalUrl(value) {
  try {
    const url = new URL(value)
    if (url.hostname === 'www.cheapshark.com') {
      const ids = url.searchParams.getAll('dealID')
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
        url.pathname === '/redirect' && [...url.searchParams.keys()].length === 1 && ids.length === 1 &&
        /^[A-Za-z0-9+/=_-]{1,256}$/.test(ids[0])
    }
    return url.protocol === 'https:' && !url.username && !url.password && hasTrustedHost(url.hostname)
  } catch {
    return false
  }
}

function isInternalAppUrl(value, port) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.port === String(port) &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

module.exports = {
  TRUSTED_STORE_ROOTS,
  isInternalAppUrl,
  isTrustedExternalUrl,
}
