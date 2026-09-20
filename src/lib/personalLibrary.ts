import { useCallback, useEffect, useRef, useState } from 'react'
import type { AlertRecord, LibraryAction, LibraryState } from '../shared/libraryTypes'

declare global {
  interface Window { dealriftDesktop?: { isDesktop: boolean } }
}

let preferences: Record<string, string> = {}
export function readSetting(key: string, fallback: string) { return preferences[key] ?? fallback }

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: unknown }
    throw new Error(typeof result.error === 'string' ? result.error : `Unable to save local data (${response.status}).`)
  }
  return response.json() as Promise<T>
}

export async function initializeLibrary(): Promise<LibraryState> {
  let state = await request<LibraryState>('/api/library')
  // Recover preferences available at this browser origin once; future launches use the file.
  if (!Object.keys(state.settings).length) {
    const legacy: Record<string, string> = {}
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('dealrift-') && key !== 'dealrift-watchlist') legacy[key] = localStorage.getItem(key) ?? ''
      }
      if (Object.keys(legacy).length) state = await request<LibraryState>('/api/library', { action: 'settings', settings: legacy })
      const titles: unknown = JSON.parse(localStorage.getItem('dealrift-watchlist') ?? '[]')
      if (!state.games.length && Array.isArray(titles)) {
        const games = titles.filter((title): title is string => typeof title === 'string' && title.trim().length > 0).slice(0, 500).map((title) => ({
          id: title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          title, owned: false, watched: true, priority: 2, notes: '', updatedAt: new Date().toISOString(),
        }))
        if (games.length) state = await request<LibraryState>('/api/library', { action: 'import', games })
      }
    } catch (error) {
      // Malformed legacy JSON is ignored; server failures must still stop startup.
      if (!(error instanceof SyntaxError) && !(error instanceof DOMException)) throw error
    }
  }
  preferences = { ...state.settings }
  return state
}

export function usePersonalLibrary(initial: LibraryState) {
  const [state, setState] = useState(initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const queue = useRef(Promise.resolve())
  const pending = useRef(0)
  const current = useRef(state)
  current.current = state

  const accept = useCallback((next: LibraryState) => {
    if (next.revision < current.current.revision) return
    current.current = next
    preferences = { ...next.settings }
    setState(next)
  }, [])

  const action = useCallback((mutation: LibraryAction): Promise<void> => {
    pending.current += 1
    setBusy(true)
    const run = async () => {
      try {
        // Compare only after earlier actions finish, so rapid A → B → A changes are preserved.
        if (mutation.action === 'settings' && Object.entries(mutation.settings).every(([key, value]) => current.current.settings[key] === value)) return
        accept(await request<LibraryState>('/api/library', mutation))
        setError('')
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Unable to save local data.')
        throw failure
      } finally {
        pending.current -= 1
        setBusy(pending.current > 0)
      }
    }
    const result = queue.current.then(run, run)
    queue.current = result.catch(() => {})
    return result
  }, [accept])

  const saveSettings = useCallback(async (settings: Record<string, string>) => {
    await action({ action: 'settings', settings })
  }, [action])

  const check = useCallback(async () => {
    pending.current += 1
    setBusy(true)
    try {
      await queue.current
      accept(await request<LibraryState>('/api/library/check', {}))
      setError('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to check your games.')
      throw failure
    } finally {
      pending.current -= 1
      setBusy(pending.current > 0)
    }
  }, [accept])

  const watched = state.games.some((game) => game.watched && !game.owned)
  useEffect(() => {
    let disposed = false
    const poll = async () => {
      try { const next = await request<LibraryState>('/api/library'); if (!disposed) accept(next) }
      catch { /* Keep the last usable library. Explicit actions surface errors. */ }
    }
    const timer = window.setInterval(() => void poll(), 30_000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [accept])

  useEffect(() => {
    if (!watched || window.dealriftDesktop?.isDesktop) return
    void check().catch(() => {})
    const timer = window.setInterval(() => void check().catch(() => {}), 300_000)
    return () => window.clearInterval(timer)
  }, [watched, check])

  useEffect(() => {
    if (window.dealriftDesktop?.isDesktop || state.settings['dealrift-notifications'] !== 'true' ||
      typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    void request<{ alerts: AlertRecord[] }>('/api/library/notifications', {}).then(({ alerts }) => {
      // A claim is durable; do not discard it merely because React reran this effect.
      for (const alert of alerts) {
        const notification = new Notification('DealRift', { body: `${alert.title} · ${alert.price} ${alert.currency}`, tag: alert.id })
        notification.onclick = () => { window.focus(); notification.close() }
      }
    }).catch(() => {})
  }, [state.alerts, state.settings])

  return { state, action, saveSettings, check, busy, error }
}
