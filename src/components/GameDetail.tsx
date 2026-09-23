import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Eye, X, RefreshCw } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Deal, Language } from '../shared/dealTypes'
import { libraryGameId, type GamePricePoint } from '../shared/libraryTypes'
import { formatMoney } from '../lib/planner'
import { dealStatusLabels } from '../lib/dealStatus'
import { worldwidePriceLabel, type PriceScope } from '../lib/priceScope'
import './Personal.css'

export interface GameDetailProps {
  deal: Deal
  offers: Deal[]
  language: Language
  country: string
  priceScope?: PriceScope
  onClose: () => void
  onWatch: (deal: Deal) => void
  watched: boolean
}

export function GameDetail({ deal, offers, language, country, priceScope = 'country', onClose, onWatch, watched }: GameDetailProps) {
  const es = language === 'es'
  const dialog = useRef<HTMLDialogElement>(null)
  const [points, setPoints] = useState<GamePricePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const gameKey = libraryGameId(deal)
  const historyCountry = deal.priceCountry ?? country
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement as HTMLElement | null
    element?.showModal()
    return () => { element?.close(); previousFocus?.focus() }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    setLoading(true); setError(false); setPoints([])
    const query = new URLSearchParams({ gameKey, country: historyCountry })
    void fetch(`/api/game-history?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('History unavailable')
        const result: unknown = await response.json()
        const raw = result as { points?: unknown; gameKey?: unknown; country?: unknown }
        if (!raw || raw.gameKey !== gameKey || raw.country !== historyCountry || !Array.isArray(raw.points)) throw new Error('Invalid history')
        const valid = raw.points.filter((point): point is GamePricePoint => Boolean(point) && typeof point === 'object' &&
          typeof point.at === 'string' && Number.isFinite(Date.parse(point.at)) && typeof point.priceUsd === 'number' &&
          Number.isFinite(point.priceUsd) && point.priceUsd >= 0 && typeof point.source === 'string' && typeof point.free === 'boolean')
        if (!cancelled) setPoints(valid.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)))
      }).catch(() => { if (!cancelled) setError(true) })
      .finally(() => { window.clearTimeout(timeout); if (!cancelled) setLoading(false) })
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout) }
  }, [gameKey, historyCountry, attempt])

  const sameEdition = useMemo(() => [...new Map([deal, ...offers].filter((offer) => libraryGameId(offer) === gameKey).map((offer) => [offer.id, offer])).values()]
    .sort((a, b) => (a.salePrice.usd ?? Infinity) - (b.salePrice.usd ?? Infinity)), [deal, offers, gameKey])
  const paid = points.filter((point) => !point.free && point.priceUsd > 0)
  const low = paid.length ? Math.min(...paid.map((point) => point.priceUsd)) : undefined
  const chartPoints = useMemo(() => {
    const best = new Map<string, GamePricePoint>()
    for (const point of points) if (!best.has(point.at) || best.get(point.at)!.priceUsd > point.priceUsd) best.set(point.at, point)
    return [...best.values()].map((point) => ({ ...point, timestamp: Date.parse(point.at) }))
  }, [points])
  const date = (value: string | number) => new Intl.DateTimeFormat(es ? 'es-CO' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  const sourceLabel = deal.confidence === 'live-api' ? (es ? 'Fuente en directo' : 'Live source') : deal.confidence === 'computed' ? (es ? 'Dato calculado' : 'Computed data') : (es ? 'Verificación limitada' : 'Limited verification')
  const warnings = dealStatusLabels(deal, country, language)

  return <dialog ref={dialog} className="personal-dialog game-detail" aria-labelledby="game-detail-title" onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header className="personal-heading">
      <div><p className="personal-eyebrow">{es ? 'Ficha del juego' : 'Game detail'} · {es ? 'Precio de' : 'Price from'} {historyCountry}</p><h2 id="game-detail-title">{deal.title}</h2><p>{deal.platform}</p></div>
      <button type="button" className="personal-icon" onClick={onClose} aria-label={es ? 'Cerrar ficha' : 'Close detail'}><X size={20} /></button>
    </header>
    <div className="detail-overview">
      {deal.image ? <img src={deal.image} alt="" className="detail-cover" /> : null}
      <div><span className="personal-muted">{deal.source}</span><strong className="detail-price">{priceScope === 'worldwide' ? worldwidePriceLabel(deal) : formatMoney(deal.salePrice.amount, deal.salePrice.currency, language)}</strong>{priceScope === 'worldwide' ? <p className="personal-muted">{formatMoney(deal.salePrice.amount, deal.salePrice.currency, language)} · {historyCountry}</p> : null}{warnings.length ? <ul className="personal-price-warnings">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}<p className="personal-muted">{es ? 'Observado' : 'Observed'}: {date(deal.freshness?.updatedAt ?? deal.detectedAt)}</p>
        <div className="personal-actions"><button type="button" className="personal-primary" onClick={() => onWatch(deal)} aria-pressed={watched}><Eye size={16} />{watched ? (es ? 'Vigilando' : 'Watching') : (es ? 'Vigilar juego' : 'Watch game')}</button><a className="personal-button" href={deal.url} target="_blank" rel="noreferrer"><ExternalLink size={16} />{es ? 'Ver en la tienda' : 'View at store'}</a></div>
      </div>
    </div>
    <section className="personal-section" aria-labelledby="detail-history-title">
      <div className="personal-heading"><div><h3 id="detail-history-title">{es ? 'Historial observado en USD' : 'Observed USD history'} · {historyCountry}</h3><p>{es ? 'Precios recogidos por esta instalación, para esta edición y el país indicado; no mezcla mínimos de otros países.' : 'Prices collected by this installation for this edition and listed country; lows from other countries are not mixed.'}</p></div><span className="personal-badge">{points.length} {es ? 'observaciones' : 'observations'}</span></div>
      {loading ? <div className="personal-skeleton" role="status">{es ? 'Cargando historial…' : 'Loading history…'}</div> : error ? <div className="personal-notice error" role="alert"><p>{es ? 'No se pudo cargar el historial. Tus favoritos siguen guardados.' : 'History could not load. Your library is still saved.'}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={15} />{es ? 'Reintentar' : 'Retry'}</button></div> : !points.length ? <div className="personal-empty"><h4>{es ? 'Aún estamos reuniendo evidencia' : 'Collecting evidence'}</h4><p>{es ? 'Comprueba este favorito en diferentes momentos para construir su historial. No hay un mínimo histórico verificado todavía.' : 'Check this favorite at different times to build its history. There is no verified historical low yet.'}</p></div> : <>
        <div className="personal-facts"><div><span>{es ? 'Mínimo de pago observado' : 'Observed paid low'}</span><strong>{low === undefined ? '—' : formatMoney(low, 'USD', language)}</strong></div><div><span>{es ? 'Primera observación' : 'First observation'}</span><strong>{date(points[0].at)}</strong></div><div><span>{es ? 'Oferta gratuita observada' : 'Free offer observed'}</span><strong>{points.some((point) => point.free) ? (es ? 'Sí' : 'Yes') : (es ? 'No registrada' : 'Not recorded')}</strong></div></div>
        <div className="detail-chart" role="img" aria-label={es ? `Historial de ${points.length} observaciones; mínimo de pago ${low ?? 'no disponible'} USD. Los datos también están en la tabla.` : `${points.length} price observations; paid low ${low ?? 'unavailable'} USD. Data also available in the table.`}>
          <ResponsiveContainer width="100%" height={230}><LineChart data={chartPoints} margin={{ top: 12, right: 20, left: 0, bottom: 4 }}><CartesianGrid stroke="var(--personal-border)" /><XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(value: number) => new Intl.DateTimeFormat(es ? 'es' : 'en', { month: 'short', day: 'numeric' }).format(value)} stroke="var(--muted)" fontSize={11} /><YAxis stroke="var(--muted)" fontSize={11} /><Tooltip labelFormatter={(value) => date(Number(value))} formatter={(value) => [formatMoney(Number(value), 'USD', language), es ? 'Mínimo observado' : 'Observed low']} contentStyle={{ background: 'var(--personal-surface)', borderColor: 'var(--personal-border)', color: 'var(--text)' }} /><Line dataKey="priceUsd" name="USD" type="linear" stroke="var(--cyan)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} connectNulls={false} /></LineChart></ResponsiveContainer>
        </div>
        <details className="personal-data-table"><summary>{es ? 'Ver observaciones y fuentes' : 'View observations and sources'}</summary><div className="personal-table-scroll"><table><thead><tr><th>{es ? 'Fecha' : 'Date'}</th><th>{es ? 'Precio' : 'Price'}</th><th>{es ? 'Fuente' : 'Source'}</th></tr></thead><tbody>{points.map((point, index) => <tr key={`${point.at}-${point.source}-${index}`}><td>{date(point.at)}</td><td>{formatMoney(point.priceUsd, 'USD', language)}</td><td>{point.source}</td></tr>)}</tbody></table></div></details>
      </>}
      <p className="personal-fine-print">{es ? 'Los huecos no se interpolan como observaciones reales. Un mínimo local no equivale al mínimo de toda la historia; la conversión a USD puede variar.' : 'Gaps are not additional observations. A local low is not an all-time low; USD conversion can vary.'}</p>
    </section>
    <section className="personal-section"><h3>{es ? 'Esta edición en otras tiendas' : 'This edition across stores'}</h3><p className="personal-muted">{es ? 'Solo se comparan ofertas con el mismo identificador de edición.' : 'Only offers with the same edition identifier are compared.'}</p><div className="personal-table-scroll"><table><thead><tr><th>{es ? 'Tienda' : 'Store'}</th><th>{es ? 'Precio' : 'Price'}</th><th>{es ? 'Región publicada' : 'Listed region'}</th><th>{es ? 'Destino' : 'Destination'}</th></tr></thead><tbody>{sameEdition.map((offer) => <tr key={offer.id}><td>{offer.source}<small>{offer.platform}</small></td><td>{formatMoney(offer.salePrice.amount, offer.salePrice.currency, language)}{dealStatusLabels(offer, country, language).map((warning) => <small className="personal-price-warnings" key={warning}>{warning}</small>)}</td><td>{offer.priceCountry ? `${es ? 'Precio de' : 'Price from'} ${offer.priceCountry} · ` : ''}{offer.countries.join(', ') || (es ? 'No confirmada' : 'Unconfirmed')}</td><td><a href={offer.url} target="_blank" rel="noreferrer">{offer.confidence === 'search-link' || offer.tags.includes('store-search-link') ? (es ? 'Buscar en tienda' : 'Store search') : (es ? 'Ver oferta' : 'View offer')}<ExternalLink size={13} /></a></td></tr>)}</tbody></table></div></section>
    <section className="personal-section"><h3>{es ? 'Qué sabemos y qué debes comprobar' : 'Evidence and checks'}</h3><ul className="personal-evidence"><li><strong>{sourceLabel}.</strong> {es ? 'Describe el origen del dato, no una probabilidad de acierto.' : 'Describes the source, not a probability of correctness.'}</li><li>{deal.intelligence?.history.reliable ? (es ? 'Hay observaciones suficientes para comparar el precio con el historial local.' : 'Enough observations exist for comparison with local history.') : (es ? 'Historial limitado: todavía no permite afirmar un mínimo fiable.' : 'Limited history: a reliable low cannot be claimed yet.')}</li><li>{es ? 'Comprueba país de tu cuenta, moneda, método de pago, DRM y restricciones de activación en la tienda. “Global” no confirma que tu cuenta sea elegible.' : 'Check account country, currency, payment method, DRM and activation restrictions at the store. “Global” does not verify your account eligibility.'}</li><li>{es ? 'Los impuestos, comisiones y contenido extra de la edición no están verificados.' : 'Taxes, fees and extra edition content are not verified.'}</li></ul></section>
  </dialog>
}
