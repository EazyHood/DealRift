import { useState } from 'react'
import { Check, Eye, Pencil, Trash2 } from 'lucide-react'
import type { Deal, Language } from '../shared/dealTypes'
import type { LibraryAction, LibraryGame } from '../shared/libraryTypes'
import { getGameEcosystem, libraryMatchesDeal } from '../shared/gameIdentity'
import { formatMoney, parseMoney } from '../lib/planner'
import { dealStatusLabels } from '../lib/dealStatus'

export function LibraryGameRow({ game, currentDeal, language, country, busy, onAction, onOpenGame }: { game: LibraryGame; currentDeal?: Deal; language: Language; country: string; busy: boolean; onAction: (action: LibraryAction) => Promise<void>; onOpenGame: (deal: Deal) => void }) {
  const es = language === 'es'
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [amount, setAmount] = useState(String(game.targetPrice?.amount ?? ''))
  const [currency, setCurrency] = useState(game.targetPrice?.currency ?? game.snapshot?.salePrice.currency ?? 'USD')
  const [priority, setPriority] = useState(game.priority)
  const [notes, setNotes] = useState(game.notes)
  const [error, setError] = useState('')
  const offer = currentDeal && libraryMatchesDeal(game, currentDeal) ? currentDeal : game.snapshot && libraryMatchesDeal(game, game.snapshot) ? game.snapshot : undefined
  const ecosystem = getGameEcosystem(game)
  const platform = ecosystem === 'playstation' ? 'PlayStation' : ecosystem === 'xbox' ? 'Xbox' : 'PC'
  const currencies = [...new Set(['USD', ...(country === 'CO' ? ['COP'] : []), ...(offer ? [offer.salePrice.currency] : []), currency])]
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    const targetAmount = amount.trim() ? parseMoney(amount) : undefined
    if (amount.trim() && targetAmount === undefined) { setError(es ? 'Precio objetivo inválido. Usa un importe sin separadores de miles, hasta 2 decimales.' : 'Invalid target price. Use an amount without grouping separators, up to 2 decimals.'); return }
    try {
      await onAction({ action: 'upsert', game: { ...game, priority, notes, targetPrice: targetAmount === undefined ? undefined : { amount: targetAmount, currency }, updatedAt: new Date().toISOString() } })
      setEditing(false); setError('')
    } catch { setError(es ? 'No se pudieron guardar los cambios. Inténtalo de nuevo.' : 'Changes could not be saved. Please retry.') }
  }
  const toggle = async (key: 'owned' | 'watched') => {
    try { await onAction({ action: 'upsert', game: { ...game, [key]: !game[key], updatedAt: new Date().toISOString() } }); setError('') }
    catch { setError(es ? 'No se pudo actualizar el juego. Inténtalo de nuevo.' : 'Could not update this game. Please retry.') }
  }
  return <article className={`library-game ${game.owned ? 'is-owned' : ''}`}>
    <div className="library-game-main"><div className="library-game-copy"><div className="personal-badges"><span className="personal-badge">{platform}{offer && ecosystem !== 'pc' ? ` · ${offer.platform}` : ''}</span><span className="personal-badge">{game.priority === 1 ? (es ? 'Prioridad alta' : 'High priority') : game.priority === 2 ? (es ? 'Prioridad normal' : 'Normal priority') : (es ? 'Prioridad baja' : 'Low priority')}</span>{game.owned ? <span className="personal-badge positive">{es ? `Poseído en ${platform}` : `Owned on ${platform}`}</span> : null}</div><h3>{game.title}</h3>
      {offer ? <><p><strong>{formatMoney(offer.salePrice.amount, offer.salePrice.currency, language)}</strong> · {offer.source}<small>{currentDeal ? (es ? 'En los resultados actuales' : 'In current results') : (es ? 'Última oferta guardada' : 'Last saved offer')} · {new Date(offer.freshness?.updatedAt ?? offer.detectedAt).toLocaleString(es ? 'es-CO' : 'en-US')}</small></p>{dealStatusLabels(offer, country, language).map((warning) => <p className="personal-price-warnings" key={warning}>{warning}</p>)}</> : <p className="personal-muted">{es ? 'Sin oferta guardada. Comprueba favoritos para buscar precios.' : 'No saved offer. Check favorites to look for prices.'}</p>}
      {game.targetPrice ? <p className="library-target">{es ? 'Avisarme a' : 'Notify me at'} {formatMoney(game.targetPrice.amount, game.targetPrice.currency, language)} {es ? 'o menos' : 'or less'}</p> : null}{game.notes && !editing ? <p className="library-notes">{game.notes}</p> : null}
    </div><div className="library-game-actions"><button type="button" disabled={busy} aria-pressed={game.watched} onClick={() => void toggle('watched')}><Eye size={16} />{game.watched ? (es ? 'Vigilando' : 'Watching') : (es ? 'Vigilar' : 'Watch')}</button><button type="button" disabled={busy} aria-pressed={game.owned} onClick={() => void toggle('owned')}><Check size={16} />{game.owned ? (es ? 'Lo tengo' : 'Owned') : (es ? 'Marcar poseído' : 'Mark owned')}</button>{offer ? <button type="button" onClick={() => onOpenGame(offer)}>{es ? 'Ver ficha' : 'View detail'}</button> : null}<button type="button" aria-expanded={editing} onClick={() => { setEditing(!editing); setAmount(String(game.targetPrice?.amount ?? '')); setCurrency(game.targetPrice?.currency ?? offer?.salePrice.currency ?? 'USD'); setNotes(game.notes); setPriority(game.priority); setError('') }}><Pencil size={15} />{es ? 'Editar' : 'Edit'}</button></div></div>
    {editing ? <form className="library-editor" onSubmit={(event) => void save(event)} aria-busy={busy}><div className="personal-form-row"><label>{es ? 'Precio objetivo (opcional)' : 'Target price (optional)'}<input type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(event) => setAmount(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `error-${game.id}` : undefined} /></label><label>{es ? 'Moneda' : 'Currency'}<select value={currency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((code) => <option key={code}>{code}</option>)}</select></label><label>{es ? 'Prioridad' : 'Priority'}<select value={priority} onChange={(event) => setPriority(Number(event.target.value) as 1 | 2 | 3)}><option value={1}>{es ? 'Alta' : 'High'}</option><option value={2}>{es ? 'Normal' : 'Normal'}</option><option value={3}>{es ? 'Baja' : 'Low'}</option></select></label></div><label className="personal-field">{es ? 'Notas' : 'Notes'}<textarea value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} rows={3} /></label><p className="personal-fine-print">{es ? 'Deja el precio vacío para quitar el objetivo. La comparación requiere la misma moneda o un precio normalizado USD.' : 'Leave the price empty to remove the target. Comparison requires the same currency or a normalized USD price.'}</p><div className="personal-actions"><button type="submit" className="personal-primary" disabled={busy}>{busy ? (es ? 'Guardando…' : 'Saving…') : (es ? 'Guardar cambios' : 'Save changes')}</button><button type="button" onClick={() => setEditing(false)}>{es ? 'Cancelar' : 'Cancel'}</button><button type="button" className="personal-danger" onClick={() => setRemoving(true)}><Trash2 size={15} />{es ? 'Eliminar' : 'Remove'}</button></div></form> : null}
    {removing ? <div className="personal-notice" role="group" aria-label={es ? 'Confirmar eliminación' : 'Confirm removal'}><p>{es ? `¿Eliminar ${game.title} y sus notas de tu biblioteca?` : `Remove ${game.title} and its notes from your library?`}</p><div className="personal-actions"><button type="button" className="personal-danger" disabled={busy} onClick={() => { void onAction({ action: 'remove', id: game.id }).catch(() => setError(es ? 'No se pudo eliminar. Reintenta.' : 'Could not remove. Retry.')) }}>{es ? 'Sí, eliminar' : 'Yes, remove'}</button><button type="button" onClick={() => setRemoving(false)}>{es ? 'Conservar' : 'Keep'}</button></div></div> : null}
    {error ? <p id={`error-${game.id}`} className="personal-error" role="alert">{error}</p> : null}
  </article>
}
