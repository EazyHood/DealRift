import { useMemo, useRef, useState } from 'react'
import { Bell, BookOpen, Check, Download, GitCompareArrows, Plus, RefreshCw, Settings, Upload, Wallet } from 'lucide-react'
import type { Deal, Language } from '../shared/dealTypes'
import { libraryGameId, type LibraryAction, type LibraryState } from '../shared/libraryTypes'
import { exportLibraryBackup, IMPORT_MAX_BYTES, parseLibraryImport, titleId, type ImportPreview } from '../lib/importLibrary'
import { LibraryGameRow } from './LibraryGameRow'
import { PurchasePlan } from './PurchasePlan'
import { EditionComparison } from './EditionComparison'
import { LibrarySettings } from './LibrarySettings'
import './Personal.css'

export interface LibraryPanelProps {
  state: LibraryState
  language: Language
  country: string
  deals: Deal[]
  busy: boolean
  error: string
  onAction: (action: LibraryAction) => Promise<void>
  onCheck: () => Promise<void>
  onOpenGame: (deal: Deal) => void
}
type LibraryView = 'games' | 'plan' | 'compare' | 'alerts' | 'settings'

export function LibraryPanel({ state, language, country, deals, busy, error, onAction, onCheck, onOpenGame }: LibraryPanelProps) {
  const es = language === 'es'
  const [view, setView] = useState<LibraryView>('games')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [steamId, setSteamId] = useState('')
  const [localError, setLocalError] = useState('')
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [restore, setRestore] = useState(false)
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)
  const [reading, setReading] = useState(false)
  const [alertLimit, setAlertLimit] = useState(25)
  const fileInput = useRef<HTMLInputElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const watched = state.games.filter((game) => game.watched).length
  const owned = state.games.filter((game) => game.owned).length
  const unread = state.alerts.filter((alert) => !alert.read).length
  const activeWatches = state.games.filter((game) => game.watched && !game.owned).length
  const filtered = useMemo(() => state.games.filter((game) => (filter === 'all' || (filter === 'watched' ? game.watched : game.owned)) && game.title.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title)), [state.games, filter, query])
  const allOffers = useMemo(() => [...new Map([...state.games.flatMap((game) => game.snapshot ? [game.snapshot] : []), ...deals].map((deal) => [deal.id, deal])).values()], [state.games, deals])
  const dates = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(es ? 'es-CO' : 'en-US') : (es ? 'Aún no comprobado' : 'Not checked yet')
  const batchStatus = state.checkError?.match(/Checked (\d+) of (\d+) watched games/)
  const checkStatus = state.checkError ? state.checkError.startsWith('Country changed.')
    ? (es ? 'Cambiaste el país. Comprueba favoritos para verificar los precios de esta región.' : 'Country changed. Check favorites to verify prices for this region.')
    : batchStatus ? (es ? `Se revisaron ${batchStatus[1]} de ${batchStatus[2]} favoritos. Los demás se revisarán en las siguientes comprobaciones.` : `${batchStatus[1]} of ${batchStatus[2]} favorites checked. The remaining games rotate through subsequent checks.`) + (state.checkError.includes('could not be verified') ? (es ? ' Algunas ofertas siguen pendientes de verificar.' : ' Some offers still need verification.') : '')
    : (es ? 'Algunos precios no se pudieron verificar. Revisa cada juego y vuelve a comprobar favoritos.' : 'Some prices could not be verified. Review each game and check favorites again.') : ''
  const check = async () => {
    setLocalError(''); setStatus('')
    try { await onCheck(); setStatus(es ? 'Comprobación terminada. Revisa el estado de cada favorito y las alertas.' : 'Check finished. Review each favorite and the alert log.') }
    catch { setLocalError(es ? 'No se pudieron comprobar los favoritos. Revisa la conexión e inténtalo de nuevo.' : 'Favorites could not be checked. Check your connection and retry.') }
  }
  const add = async (event: React.FormEvent) => {
    event.preventDefault(); setLocalError('')
    const id = titleId(title)
    if (!id || (steamId && !/^\d{1,12}$/.test(steamId))) { setLocalError(es ? 'Escribe un título y, si lo usas, un ID numérico de Steam.' : 'Enter a title and, optionally, a numeric Steam app ID.'); return }
    const existing = state.games.find((game) => game.id === id)
    try {
      await onAction({ action: 'upsert', game: { ...existing, id, title: title.trim(), steamAppId: steamId || existing?.steamAppId, owned: existing?.owned ?? false, watched: true, priority: existing?.priority ?? 2, notes: existing?.notes ?? '', updatedAt: new Date().toISOString() } })
      setTitle(''); setSteamId(''); setAdding(false); setStatus(es ? 'Juego añadido a tus favoritos.' : 'Game added to favorites.')
    } catch { setLocalError(es ? 'No se pudo guardar el juego. Conservamos tus datos para reintentar.' : 'Could not save the game. Your input remains available to retry.') }
  }
  const loadFile = async (file?: File) => {
    if (!file) return
    setReading(true); setLocalError(''); setStatus(''); setPreview(null); setRestore(false); setRestoreConfirmed(false)
    try {
      if (file.size > IMPORT_MAX_BYTES) throw new Error(es ? 'El archivo supera 2 MB.' : 'File exceeds 2 MB.')
      setPreview(parseLibraryImport(await file.text(), file.name))
    } catch (failure) { setLocalError(failure instanceof SyntaxError ? (es ? 'JSON inválido. Revisa el formato del archivo.' : 'Invalid JSON. Check the file format.') : failure instanceof Error && failure.name === 'ZodError' ? (es ? 'La copia contiene datos o enlaces no válidos. No se ha aplicado ningún cambio; elige una copia válida.' : 'The backup contains invalid data or links. No changes were applied; choose a valid backup.') : failure instanceof Error ? failure.message : (es ? 'No se pudo leer el archivo.' : 'Could not read the file.')) }
    finally { setReading(false); if (fileInput.current) fileInput.current.value = '' }
  }
  const applyImport = async () => {
    if (!preview || (restore && !restoreConfirmed)) return
    try {
      if (restore && preview.restore) await onAction({ action: 'restore', state: preview.restore })
      else await onAction({ action: 'import', games: preview.games })
      setStatus(es ? 'Biblioteca actualizada. Comprueba tus favoritos para recuperar precios verificados.' : 'Library updated. Check favorites to retrieve verified prices.'); setPreview(null)
    } catch { setLocalError(es ? 'No se pudo aplicar el archivo. Tu vista previa sigue disponible para reintentar.' : 'Could not apply the file. Your preview remains available to retry.') }
  }
  const exportBackup = () => {
    const url = URL.createObjectURL(new Blob([exportLibraryBackup(state)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `dealrift-library-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setStatus(es ? 'Copia de biblioteca preparada para descargar.' : 'Library backup prepared for download.')
  }
  const tabs: { id: LibraryView; label: string; icon: React.ReactNode }[] = [
    { id: 'games', label: es ? 'Biblioteca' : 'Library', icon: <BookOpen size={17} /> },
    { id: 'plan', label: es ? 'Plan de compra' : 'Purchase plan', icon: <Wallet size={17} /> },
    { id: 'compare', label: es ? 'Comparar ediciones' : 'Compare editions', icon: <GitCompareArrows size={17} /> },
    { id: 'alerts', label: `${es ? 'Registro de alertas' : 'Alert log'}${unread ? ` (${unread})` : ''}`, icon: <Bell size={17} /> },
    { id: 'settings', label: es ? 'Preferencias' : 'Preferences', icon: <Settings size={17} /> },
  ]
  return <section className="personal-panel" aria-label={es ? 'Asistente personal de ofertas' : 'Personal deals assistant'} aria-busy={busy || reading}>
    <header className="personal-heading"><div><p className="personal-eyebrow">{es ? 'Tu colección, tus decisiones' : 'Your collection, your decisions'}</p><h2>{es ? 'Tu espacio en DealRift' : 'Your space in DealRift'}</h2><p>{watched} {es ? 'vigilados' : 'watched'} · {owned} {es ? 'poseídos' : 'owned'} · {es ? 'Guardado en este equipo' : 'Saved on this computer'}</p></div><button type="button" className="personal-primary" onClick={() => void check()} disabled={busy || !activeWatches}><RefreshCw size={16} className={busy ? 'spin' : ''} />{busy ? (es ? 'Comprobando…' : 'Checking…') : (es ? 'Comprobar favoritos' : 'Check favorites')}</button></header>
    <p className="personal-fine-print">{es ? 'Última comprobación' : 'Last check'}: {dates(state.lastCheckedAt)}</p>{checkStatus ? <p className="personal-price-warnings" role="status">{checkStatus}</p> : null}
    <nav className="personal-tabs" aria-label={es ? 'Secciones de biblioteca' : 'Library sections'}>{tabs.map((tab) => <button type="button" key={tab.id} aria-current={view === tab.id ? 'page' : undefined} onClick={() => setView(tab.id)}>{tab.icon}{tab.label}</button>)}</nav>
    {error || localError ? <div className="personal-notice error" role="alert"><p>{localError || error}</p><button type="button" onClick={() => { setLocalError(''); void check() }} disabled={busy}>{es ? 'Reintentar comprobación' : 'Retry check'}</button></div> : null}<p className="personal-status" role="status">{status || (reading ? (es ? 'Leyendo archivo local…' : 'Reading local file…') : '')}</p>
    {view === 'games' ? <>
      <div className="personal-library-toolbar"><label className="personal-search">{es ? 'Buscar en tu biblioteca' : 'Search your library'}<input type="search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="personal-actions"><button type="button" aria-expanded={adding} onClick={() => { setAdding(!adding); window.setTimeout(() => titleInput.current?.focus(), 0) }}><Plus size={16} />{es ? 'Añadir juego' : 'Add game'}</button><button type="button" onClick={() => fileInput.current?.click()} disabled={reading || busy}><Upload size={16} />{es ? 'Importar / restaurar' : 'Import / restore'}</button><button type="button" onClick={exportBackup} disabled={busy}><Download size={16} />{es ? 'Exportar copia' : 'Export backup'}</button></div></div>
      <input className="personal-hidden" type="file" ref={fileInput} accept=".csv,.json,text/csv,application/json" aria-label={es ? 'Archivo CSV o JSON' : 'CSV or JSON file'} onChange={(event) => void loadFile(event.target.files?.[0])} />
      <details className="personal-import-help"><summary>{es ? 'Formato de importación y privacidad' : 'Import format and privacy'}</summary><p>{es ? 'Archivos locales CSV o JSON, máximo 2 MB y 500 juegos. El archivo se lee aquí; solo los registros validados se envían a la API local de DealRift. No necesitas contraseña, cookies ni API key de Steam.' : 'Local CSV or JSON files, up to 2 MB and 500 games. The file is read here; only validated records are sent to DealRift’s local API. No Steam password, cookies or API key needed.'}</p><p>{es ? 'CSV: title obligatorio; steamAppId, owned, watched, priority, notes, targetAmount y targetCurrency opcionales. JSON: array de juegos o copia exportada. owned/watched usan true/false; prioridad 1=alta, 2=normal, 3=baja.' : 'CSV: title required; steamAppId, owned, watched, priority, notes, targetAmount and targetCurrency optional. JSON: game array or exported backup. owned/watched use true/false; priority 1=high, 2=normal, 3=low.'}</p><code>title,steamAppId,owned,watched,priority,targetAmount,targetCurrency<br />Portal 2,620,false,true,1,5,USD</code></details>
      {adding ? <form className="personal-section" onSubmit={(event) => void add(event)}><h3>{es ? 'Añadir un favorito' : 'Add a favorite'}</h3><div className="personal-form-row"><label>{es ? 'Título completo (obligatorio)' : 'Full title (required)'}<input ref={titleInput} type="text" autoComplete="off" maxLength={300} required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>{es ? 'ID de Steam (opcional)' : 'Steam app ID (optional)'}<input type="text" inputMode="numeric" autoComplete="off" pattern="[0-9]{1,12}" maxLength={12} value={steamId} onChange={(event) => setSteamId(event.target.value)} /></label><button type="submit" className="personal-primary" disabled={busy}>{es ? 'Guardar favorito' : 'Save favorite'}</button><button type="button" onClick={() => setAdding(false)}>{es ? 'Cancelar' : 'Cancel'}</button></div><p className="personal-fine-print">{es ? 'Conserva el nombre exacto de la edición. El ID opcional es el número en la URL de Steam /app/620/; no identifica por sí solo una edición.' : 'Keep the exact edition name. The optional ID is the number in a Steam URL such as /app/620/; it does not identify an edition on its own.'}</p></form> : null}
      {preview ? <section className="personal-import-preview" aria-labelledby="import-preview-title"><h3 id="import-preview-title">{es ? 'Revisa antes de aplicar' : 'Review before applying'}</h3><p>{preview.games.length} {es ? 'juegos válidos' : 'valid games'} · {preview.games.filter((game) => state.games.some((existing) => existing.id === game.id)).length} {es ? 'ya existen y se actualizarán al combinar' : 'already exist and will be updated when merged'}{preview.warnings ? ` · ${preview.warnings} ${es ? 'duplicados unificados (última fila)' : 'duplicates merged (last row)'}` : ''}</p><details><summary>{es ? 'Ver todos los títulos' : 'View all titles'}</summary><ul>{preview.games.map((game) => <li key={game.id}>{game.title} · {game.owned ? (es ? 'poseído' : 'owned') : (es ? 'no poseído' : 'not owned')} · {es ? 'prioridad' : 'priority'} {game.priority}</li>)}</ul></details><p className="personal-fine-print">{es ? 'La copia conserva juegos, notas, objetivos, precios guardados y alertas históricas. Los precios restaurados quedan pendientes de verificación; las alertas anteriores no se vuelven a notificar.' : 'Backups preserve games, notes, targets, saved prices and historical alerts. Restored prices require verification; historical alerts are not notified again.'}</p>{preview.restore ? <label className="personal-setting"><input type="checkbox" checked={restore} onChange={(event) => { setRestore(event.target.checked); setRestoreConfirmed(false) }} /><span><strong>{es ? 'Reemplazar biblioteca y preferencias con esta copia' : 'Replace library and preferences with this backup'}</strong><small>{es ? 'Si no lo marcas, los juegos se combinan por identificador y tus preferencias se conservan.' : 'Otherwise games merge by identifier and current preferences remain.'}</small></span></label> : null}{restore ? <label className="personal-setting personal-notice"><input type="checkbox" checked={restoreConfirmed} onChange={(event) => setRestoreConfirmed(event.target.checked)} /><span>{es ? `Entiendo que reemplazará mis ${state.games.length} juegos, preferencias y registro de alertas. He exportado una copia si la necesito.` : `I understand this replaces my ${state.games.length} games, preferences and alert log. I have exported a backup if needed.`}</span></label> : null}<div className="personal-actions"><button type="button" className={restore ? 'personal-danger' : 'personal-primary'} disabled={busy || (restore && !restoreConfirmed)} onClick={() => void applyImport()}>{restore ? (es ? 'Restaurar copia' : 'Restore backup') : (es ? 'Combinar juegos' : 'Merge games')}</button><button type="button" onClick={() => setPreview(null)}>{es ? 'Cancelar' : 'Cancel'}</button></div></section> : null}
      <div className="personal-filter-row" role="group" aria-label={es ? 'Filtrar biblioteca' : 'Filter library'}>{[['all', es ? 'Todos' : 'All'], ['watched', es ? 'Vigilados' : 'Watched'], ['owned', es ? 'Poseídos' : 'Owned']].map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}<span className="personal-muted">{filtered.length} {es ? 'juegos' : 'games'}</span></div>
      <div className="library-game-list">{filtered.length ? filtered.map((game) => <LibraryGameRow key={game.id} game={game} currentDeal={deals.find((deal) => libraryGameId(deal) === game.id)} language={language} country={country} busy={busy} onAction={onAction} onOpenGame={onOpenGame} />) : <div className="personal-empty"><BookOpen size={28} /><h3>{state.games.length ? (es ? 'Ningún juego coincide' : 'No games match') : (es ? 'Empieza con un juego que quieras jugar' : 'Start with a game you want to play')}</h3><p>{state.games.length ? (es ? 'Cambia el filtro o la búsqueda. Tus juegos guardados siguen en la biblioteca.' : 'Change the filter or search. Your saved games remain in the library.') : (es ? 'Guarda una oferta del radar, añade un título o importa tu lista. Tus favoritos permanecerán aunque salgan del radar.' : 'Save a radar offer, add a title or import a list. Favorites stay even when they leave the radar.')}</p><button type="button" onClick={() => { if (state.games.length) { setQuery(''); setFilter('all') } else { setAdding(true); window.setTimeout(() => titleInput.current?.focus(), 0) } }}>{state.games.length ? (es ? 'Mostrar todos' : 'Show all') : (es ? 'Añadir mi primer juego' : 'Add my first game')}</button></div>}</div>
    </> : null}
    {view === 'plan' ? <PurchasePlan games={state.games} deals={deals} country={country} language={language} busy={busy} onCheck={check} /> : null}
    {view === 'compare' ? <EditionComparison deals={allOffers} language={language} country={country} onOpenGame={onOpenGame} /> : null}
    {view === 'settings' ? <LibrarySettings state={state} language={language} busy={busy} onAction={onAction} /> : null}
    {view === 'alerts' ? <section className="personal-section"><div className="personal-heading"><div><h3>{es ? 'Lo que encontró tu radar' : 'What your radar found'}</h3><p>{es ? 'Registro persistente de avisos de tus juegos vigilados.' : 'Persistent alert log for your watched games.'}</p></div><button type="button" disabled={busy || !unread} onClick={() => { void onAction({ action: 'read-alerts' }).catch(() => setLocalError(es ? 'No se pudieron marcar como leídas.' : 'Could not mark alerts read.')) }}><Check size={16} />{es ? 'Marcar todas como leídas' : 'Mark all read'}</button></div>{state.alerts.length ? <><ol className="personal-alert-list">{[...state.alerts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, alertLimit).map((alert) => <li key={alert.id} className={alert.read ? '' : 'unread'}><div><strong>{alert.title}</strong>{!alert.read ? <span className="personal-badge positive">{es ? 'Nueva' : 'New'}</span> : null}<p>{alert.message}</p><small>{dates(alert.createdAt)}</small></div><a className="personal-button" href={alert.url} target="_blank" rel="noreferrer">{es ? 'Ver oferta' : 'View offer'}</a></li>)}</ol>{state.alerts.length > alertLimit ? <button type="button" onClick={() => setAlertLimit((value) => value + 25)}>{es ? 'Mostrar más alertas' : 'Show more alerts'}</button> : null}</> : <div className="personal-empty"><Bell size={28} /><h4>{es ? 'Sin alertas todavía' : 'No alerts yet'}</h4><p>{es ? 'Vigila un juego, define un precio objetivo y comprueba favoritos. Los nuevos hallazgos aparecerán aquí.' : 'Watch a game, set a target price and check favorites. New findings will appear here.'}</p></div>}</section> : null}
  </section>
}
