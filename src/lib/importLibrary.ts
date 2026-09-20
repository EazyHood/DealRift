import type { LibraryGame, LibraryState } from '../shared/libraryTypes'
import { parseMoney } from './planner'
import { importedAlertSchema, importedDateSchema, importedSettingsSchema, importedSnapshotSchema } from './importSchemas'

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024
const MAX_GAMES = 500
export interface ImportPreview { games: LibraryGame[]; restore?: LibraryState; warnings: number }

export function titleId(title: string) {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object / Se esperaba un objeto.')
  return value as Record<string, unknown>
}

function boolean(value: unknown, fallback: boolean) {
  if (value === undefined || value === '') return fallback
  if (value === true || value === 'true' || value === '1' || value === 1) return true
  if (value === false || value === 'false' || value === '0' || value === 0) return false
  throw new Error('Use true/false for owned and watched / Usa true/false en owned y watched.')
}

function parseGame(value: unknown, now: string, preserve = false): LibraryGame {
  const raw = typeof value === 'string' ? { title: value } : record(value)
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 300) throw new Error('Each game needs a title (1–300 characters) / Cada juego necesita un título de 1–300 caracteres.')
  const title = raw.title.trim()
  if (preserve && (typeof raw.id !== 'string' || !raw.id || raw.id.length > 300)) throw new Error('Invalid game ID in backup / Identificador de juego inválido en la copia.')
  const id = preserve && typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 300 ? raw.id : titleId(title)
  if (!id) throw new Error('Title needs at least one letter or number / El título necesita letras o números.')
  const priority = Number(raw.priority || 2)
  if (![1, 2, 3].includes(priority)) throw new Error('Priority must be 1, 2 or 3 / La prioridad debe ser 1, 2 o 3.')
  const steamAppId = raw.steamAppId === undefined || raw.steamAppId === '' ? undefined : String(raw.steamAppId)
  if (steamAppId && !/^\d{1,12}$/.test(steamAppId)) throw new Error('Invalid Steam app ID / ID de Steam inválido.')
  if (raw.notes !== undefined && (typeof raw.notes !== 'string' || raw.notes.length > 2000)) throw new Error('Notes must be text under 2,000 characters / Notas: máximo 2.000 caracteres.')
  const owned = boolean(raw.owned, false)
  const game: LibraryGame = { id, title, steamAppId, owned, watched: boolean(raw.watched, !owned), priority: priority as 1 | 2 | 3, notes: String(raw.notes ?? ''), updatedAt: preserve && raw.updatedAt !== undefined ? importedDateSchema.parse(raw.updatedAt) : now }
  const target = raw.targetPrice === undefined ? undefined : record(raw.targetPrice)
  const amountInput = target?.amount ?? raw.targetAmount
  if (amountInput !== undefined && amountInput !== '') {
    const amount = preserve && typeof amountInput === 'number' && Number.isFinite(amountInput) && amountInput >= 0 && amountInput <= 1e12 ? amountInput : parseMoney(String(amountInput))
    const currency = String(target?.currency ?? raw.targetCurrency ?? 'USD').toUpperCase()
    if (amount === undefined || !/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid target price or currency / Precio objetivo o moneda inválidos.')
    game.targetPrice = { amount, currency }
  }
  if (preserve && raw.snapshot !== undefined) {
    const snapshot = importedSnapshotSchema.parse(raw.snapshot)
    game.snapshot = { ...snapshot, confidence: 'fallback', freshness: { ...snapshot.freshness, updatedAt: snapshot.freshness?.updatedAt ?? snapshot.detectedAt, stale: true } }
  }
  return game
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false, closed = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1 }
      else if (char === '"') { quoted = false; closed = true }
      else field += char
    } else if (char === '"') {
      if (field || closed) throw new Error('Invalid CSV quoting / Comillas CSV inválidas.')
      quoted = true
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field); field = ''; closed = false
      if (char !== ',') {
        if (char === '\r' && text[index + 1] === '\n') index += 1
        if (row.some((cell) => cell.trim())) rows.push(row)
        row = []
      }
    } else if (closed && char.trim()) throw new Error('Unexpected text after CSV quote / Texto tras comillas CSV.')
    else if (!closed) field += char
  }
  if (quoted) throw new Error('Unclosed CSV quote / Comillas CSV sin cerrar.')
  row.push(field)
  if (row.some((cell) => cell.trim())) rows.push(row)
  return rows
}

export function parseLibraryImport(text: string, filename: string, now = new Date().toISOString()): ImportPreview {
  if (new TextEncoder().encode(text).byteLength > IMPORT_MAX_BYTES) throw new Error('Maximum file size: 2 MB / Tamaño máximo: 2 MB.')
  const content = text.replace(/^\uFEFF/, '')
  let input: unknown[], backup: Record<string, unknown> | undefined
  if (filename.toLowerCase().endsWith('.csv')) {
    const rows = parseCsv(content)
    const headers = rows.shift()?.map((cell) => cell.trim()) ?? []
    if (!headers.includes('title') || new Set(headers).size !== headers.length) throw new Error('CSV needs a unique title column / El CSV necesita una columna title única.')
    input = rows.map((cells) => {
      if (cells.length !== headers.length) throw new Error('CSV row has a different column count / Una fila CSV tiene otra cantidad de columnas.')
      return Object.fromEntries(headers.map((header, index) => [header, cells[index]]))
    })
  } else if (filename.toLowerCase().endsWith('.json')) {
    const parsed: unknown = JSON.parse(content)
    if (Array.isArray(parsed)) input = parsed
    else {
      const raw = record(parsed)
      if (!Array.isArray(raw.games)) throw new Error('JSON needs a games array / El JSON necesita un array games.')
      input = raw.games
      if ('schemaVersion' in raw) {
        if (raw.schemaVersion !== 1) throw new Error('Unsupported backup version / Versión de copia no compatible.')
        backup = raw
      }
    }
  } else throw new Error('Choose a CSV or JSON file / Elige un archivo CSV o JSON.')
  if (input.length > MAX_GAMES) throw new Error('Maximum 500 games / Máximo 500 juegos.')
  const parsedGames = input.map((item) => parseGame(item, now, Boolean(backup)))
  const games = [...new Map(parsedGames.map((game) => [game.id, game])).values()]
  if (!games.length && !backup) throw new Error('The file contains no games / El archivo no contiene juegos.')
  if (backup && games.length !== parsedGames.length) throw new Error('Duplicate IDs in backup / Identificadores duplicados en la copia.')
  const alerts = backup ? importedAlertSchema.array().max(1000).parse(backup.alerts ?? []) : []
  if (backup?.checkError !== undefined && (typeof backup.checkError !== 'string' || backup.checkError.length > 2000)) throw new Error('Invalid check status in backup / Estado de comprobación inválido en la copia.')
  return {
    games,
    warnings: parsedGames.length - games.length,
    restore: backup ? { schemaVersion: 1, revision: 0, settings: importedSettingsSchema.parse(backup.settings ?? {}), games, alerts, ...(backup.lastCheckedAt === undefined ? {} : { lastCheckedAt: importedDateSchema.parse(backup.lastCheckedAt) }), ...(typeof backup.checkError === 'string' && backup.checkError.length <= 2000 ? { checkError: backup.checkError } : {}) } : undefined,
  }
}

export function exportLibraryBackup(state: LibraryState) {
  return JSON.stringify(state)
}
