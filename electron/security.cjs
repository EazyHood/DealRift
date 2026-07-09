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
  return TRUSTED_STORE_ROOTS.some((root) => host === root || host.endsWith(`.${root}`))
}

function isTrustedExternalUrl(value) {
  try {
    const url = new URL(value)
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
