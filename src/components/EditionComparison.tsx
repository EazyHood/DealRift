import { useMemo, useState } from 'react'
import type { Deal, Language } from '../shared/dealTypes'
import { editionFamily, formatMoney } from '../lib/planner'
import { dealStatusLabels } from '../lib/dealStatus'

export function EditionComparison({ deals, language, country, onOpenGame }: { deals: Deal[]; language: Language; country: string; onOpenGame: (deal: Deal) => void }) {
  const es = language === 'es'
  const [query, setQuery] = useState('')
  const [seedId, setSeedId] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const unique = useMemo(() => [...new Map(deals.map((deal) => [deal.id, deal])).values()], [deals])
  const seed = unique.find((deal) => deal.id === seedId)
  const candidates = useMemo(() => unique.filter((deal) => {
    if (query.trim()) return deal.title.toLowerCase().includes(query.trim().toLowerCase())
    return seed ? editionFamily(deal.title) === editionFamily(seed.title) : true
  }), [query, seed, unique])
  const selected = unique.filter((deal) => selectedIds.includes(deal.id))
  return <section className="personal-section"><p className="personal-eyebrow">{es ? 'Compara antes de elegir' : 'Compare before choosing'}</p><h3>{es ? 'Ediciones, lado a lado' : 'Editions, side by side'}</h3><p className="personal-muted">{es ? 'Selecciona hasta 4 ofertas. Las sugerencias por nombre no prueban que incluyan el mismo juego o contenido.' : 'Select up to 4 offers. Name-based suggestions do not prove that offers include the same game or content.'}</p>
    <div className="personal-form-row"><label>{es ? 'Partir de un juego' : 'Start with a game'}<select value={seedId} onChange={(event) => { setSeedId(event.target.value); setQuery('') }}><option value="">{es ? 'Todos los juegos disponibles' : 'All available games'}</option>{unique.map((deal) => <option value={deal.id} key={deal.id}>{deal.title} — {deal.source}</option>)}</select></label><label>{es ? 'Buscar ediciones o paquetes' : 'Search editions or bundles'}<input type="search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
    <div className="edition-candidates" role="group" aria-label={es ? 'Ofertas para comparar' : 'Offers to compare'}>{candidates.length ? candidates.map((deal) => <label key={deal.id} className="edition-option"><input type="checkbox" checked={selectedIds.includes(deal.id)} disabled={!selectedIds.includes(deal.id) && selectedIds.length >= 4} onChange={() => setSelectedIds((current) => current.includes(deal.id) ? current.filter((id) => id !== deal.id) : [...current, deal.id])} /><span><strong>{deal.title}</strong><small>{deal.source} · {formatMoney(deal.salePrice.amount, deal.salePrice.currency, language)}</small></span></label>) : <div className="personal-empty"><p>{es ? 'No hay coincidencias en las ofertas cargadas. Prueba el nombre completo o actualiza el radar.' : 'No matches in loaded offers. Try the full name or refresh the radar.'}</p></div>}</div>
    {selected.length ? <><div className="personal-heading"><p role="status">{selected.length}/4 {es ? 'seleccionadas' : 'selected'}</p><button type="button" onClick={() => setSelectedIds([])}>{es ? 'Limpiar selección' : 'Clear selection'}</button></div><div className="edition-grid">{selected.map((deal) => <article className="edition-card" key={deal.id}><h4>{deal.title}</h4><strong>{formatMoney(deal.salePrice.amount, deal.salePrice.currency, language)}</strong>{dealStatusLabels(deal, country, language).map((warning) => <p className="personal-price-warnings" key={warning}>{warning}</p>)}<dl><dt>{es ? 'Tienda' : 'Store'}</dt><dd>{deal.source}</dd><dt>{es ? 'Plataforma publicada' : 'Listed platform'}</dt><dd>{deal.platform}</dd><dt>{es ? 'Países publicados' : 'Listed countries'}</dt><dd>{deal.countries.join(', ') || '—'}</dd><dt>{es ? 'Contenido adicional' : 'Extra content'}</dt><dd>{es ? 'No verificado' : 'Not verified'}</dd></dl><button type="button" onClick={() => onOpenGame(deal)}>{es ? 'Revisar evidencia' : 'Review evidence'}</button></article>)}</div></> : <p className="personal-fine-print">{es ? 'Marca las ofertas que quieras contrastar para ver la comparación.' : 'Select offers to display the comparison.'}</p>}
    <p className="personal-notice">{es ? 'Los títulos completos se conservan. No sumamos DLC ni calculamos un coste para completar la colección: faltan datos verificados de contenido y propiedad. Confirma qué incluye cada edición en la tienda.' : 'Full titles are preserved. We do not add DLC or calculate a collection completion cost without verified content and ownership data. Confirm each edition’s contents at the store.'}</p>
  </section>
}
