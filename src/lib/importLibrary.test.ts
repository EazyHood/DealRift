import test from 'node:test'
import assert from 'node:assert/strict'
import type { LibraryState } from '../shared/libraryTypes'
import { exportLibraryBackup, IMPORT_MAX_BYTES, parseCsv, parseLibraryImport } from './importLibrary'
import { safeImportedStoreUrl } from './importSchemas'

const now = '2026-09-20T12:00:00Z'
const backup: LibraryState = {
  schemaVersion: 1, revision: 4, settings: { 'dealrift-language': 'es', 'dealrift-country': 'CO' },
  games: [{ id: 'portal-2', title: 'Portal 2', owned: false, watched: true, priority: 1, notes: 'Jugar con Ana', updatedAt: now, targetPrice: { amount: 5, currency: 'USD' }, snapshot: { id: 'steam-620', title: 'Portal 2', source: 'Steam', sourceKind: 'official', platform: 'Steam', image: '', url: 'https://store.steampowered.com/app/620/', salePrice: { amount: 5, currency: 'USD', usd: 5, formatted: '$5' }, savingsPercent: 50, signalScore: 80, dealScore: 80, detectedAt: now, isFree: false, countries: ['US'], priceCountry: 'US', riskLevel: 'low', confidence: 'live-api', tags: [], notes: [] } }],
  alerts: [{ id: 'a'.repeat(24), gameId: 'portal-2', title: 'Portal 2', message: 'Target reached', price: 5, currency: 'USD', country: 'US', url: 'https://store.steampowered.com/app/620/', createdAt: now, read: false }], lastCheckedAt: now,
}

test('CSV handles quoted commas, escaped quotes and newline notes; merges duplicate title IDs', () => {
  const csv = 'title,notes,owned,watched,priority,targetAmount,targetCurrency\r\n"Game, The","Line 1\nHe said ""yes""",false,true,1,"5,20",USD\r\n"Game, The",Updated,false,true,2,4,USD'
  assert.equal(parseCsv(csv)[1][1], 'Line 1\nHe said "yes"')
  const parsed = parseLibraryImport(csv, 'list.csv', now)
  assert.equal(parsed.games.length, 1)
  assert.equal(parsed.games[0].notes, 'Updated')
  assert.equal(parsed.games[0].targetPrice?.amount, 4)
  assert.equal(parsed.warnings, 1)
})
test('rejects malformed inputs, ambiguity, negative target, invalid boolean and oversized file', () => {
  assert.throws(() => parseLibraryImport('title,notes\n"Broken,text', 'a.csv'))
  assert.throws(() => parseLibraryImport('title,title\nA,B', 'a.csv'))
  assert.throws(() => parseLibraryImport('[{"title":"A","owned":"maybe"}]', 'a.json'))
  assert.throws(() => parseLibraryImport('[{"title":"A","targetAmount":-1}]', 'a.json'))
  assert.throws(() => parseLibraryImport('[{"title":"A","steamAppId":"a"}]', 'a.json'))
  assert.throws(() => parseLibraryImport(' '.repeat(IMPORT_MAX_BYTES + 1), 'a.json'))
  assert.throws(() => parseLibraryImport(JSON.stringify(Array.from({ length: 501 }, (_, index) => ({ title: `Game ${index}` }))), 'a.json'))
})
test('backup roundtrip preserves watch data, targets, settings, snapshots and historical alerts without claiming live prices', () => {
  const imported = parseLibraryImport(exportLibraryBackup(backup), 'backup.json', now)
  assert.deepEqual(imported.restore?.alerts, backup.alerts)
  assert.deepEqual(imported.restore?.settings, backup.settings)
  assert.equal(imported.restore?.games[0].snapshot?.salePrice.amount, 5)
  assert.equal(imported.restore?.games[0].snapshot?.confidence, 'fallback')
  assert.equal(imported.restore?.games[0].snapshot?.freshness?.stale, true)
  assert.equal(imported.restore?.games[0].targetPrice?.currency, 'USD')
  assert.equal(imported.restore?.games[0].notes, 'Jugar con Ana')
  assert.equal(imported.restore?.lastCheckedAt, now)
})
test('empty backups restore successfully without requiring a game', () => {
  const empty = { ...backup, games: [], alerts: [] }
  assert.deepEqual(parseLibraryImport(exportLibraryBackup(empty), 'backup.json').restore?.games, [])
})
test('does not accept executable or lookalike store destinations in snapshots or alerts', () => {
  for (const url of ['javascript:alert(1)', 'https://store.steampowered.com.evil.test/app/620', 'https://user:pass@store.steampowered.com/app/620']) {
    const altered = structuredClone(backup); altered.games[0].snapshot!.url = url
    assert.throws(() => parseLibraryImport(JSON.stringify(altered), 'backup.json'))
    assert.equal(safeImportedStoreUrl(url), false)
  }
  const altered = structuredClone(backup); altered.alerts[0].url = 'https://evil.test/'
  assert.throws(() => parseLibraryImport(JSON.stringify(altered), 'backup.json'))
  const malformed = structuredClone(backup); malformed.games[0].snapshot!.salePrice.amount = -4
  assert.throws(() => parseLibraryImport(JSON.stringify(malformed), 'backup.json'))
})
test('formula-looking CSV text remains inert text and unknown executable fields are not imported', () => {
  const parsed = parseLibraryImport('title,notes\nPortal 2,"=HYPERLINK(""https://evil.test"")"', 'a.csv', now)
  assert.equal(parsed.games[0].notes, '=HYPERLINK("https://evil.test")')
  const json = parseLibraryImport('[{"title":"Portal 2","url":"javascript:alert(1)","__proto__":{"owned":true}}]', 'a.json', now)
  assert.equal(json.games[0].owned, false)
  assert.equal('url' in json.games[0], false)
})
