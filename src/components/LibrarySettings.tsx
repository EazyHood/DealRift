import { useEffect, useState } from 'react'
import type { Language } from '../shared/dealTypes'
import type { LibraryAction, LibraryState } from '../shared/libraryTypes'

const settingKeys = ['dealrift-notifications', 'dealrift-background', 'dealrift-low-power', 'dealrift-hide-owned', 'dealrift-quiet-start', 'dealrift-quiet-end']
export function LibrarySettings({ state, language, busy, onAction }: { state: LibraryState; language: Language; busy: boolean; onAction: (action: LibraryAction) => Promise<void> }) {
  const es = language === 'es'
  const [draft, setDraft] = useState(state.settings)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { if (!dirty) setDraft(state.settings) }, [state.settings, dirty])
  const change = (key: string, value: string) => { setDirty(true); setMessage(''); setDraft((current) => ({ ...current, [key]: value })) }
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    const start = draft['dealrift-quiet-start'] ?? '', end = draft['dealrift-quiet-end'] ?? ''
    if (Boolean(start) !== Boolean(end) || (start && start === end)) { setError(es ? 'Elige dos horas distintas o deja ambas vacías para desactivar el horario de silencio.' : 'Choose two different times, or leave both empty to disable quiet hours.'); return }
    try {
      await onAction({ action: 'settings', settings: Object.fromEntries(settingKeys.map((key) => [key, draft[key] ?? (key.includes('quiet') ? '' : 'false')])) })
      setDirty(false); setMessage(es ? 'Preferencias guardadas.' : 'Preferences saved.')
    } catch { setError(es ? 'No se pudieron guardar. Tus cambios siguen aquí; reintenta.' : 'Could not save. Your changes remain here; retry.') }
  }
  return <section className="personal-section"><h3>{es ? 'A tu ritmo' : 'On your terms'}</h3><p className="personal-muted">{es ? 'Preferencias locales para tus avisos y biblioteca.' : 'Local preferences for alerts and your library.'}</p><form onSubmit={(event) => void save(event)} aria-busy={busy}><fieldset className="personal-settings"><legend>{es ? 'Notificaciones y rendimiento' : 'Notifications and performance'}</legend>{[
    ['dealrift-notifications', es ? 'Activar avisos del sistema' : 'Enable system notifications', es ? 'El permiso del sistema o navegador se solicita por separado. Los avisos también quedan en el registro.' : 'System or browser permission is requested separately. Alerts also appear in the log.'],
    ['dealrift-background', es ? 'Continuar en segundo plano (Windows)' : 'Continue in background (Windows)', es ? 'En la app de escritorio, permite seguir vigilando desde la bandeja. En navegador, la pestaña debe permanecer abierta.' : 'In the desktop app, continue watching from the tray. In a browser, the tab must remain open.'],
    ['dealrift-low-power', es ? 'Modo de bajo consumo' : 'Low-power mode', es ? 'Desactiva el fondo animado para reducir el trabajo de la GPU.' : 'Disables the animated background to reduce GPU work.'],
    ['dealrift-hide-owned', es ? 'Ocultar juegos poseídos en el radar' : 'Hide owned games in the radar', es ? 'Seguirán disponibles en la sección de biblioteca.' : 'They remain available in your library.'],
  ].map(([key, label, hint]) => <label className="personal-setting" key={key}><input type="checkbox" checked={draft[key] === 'true'} onChange={(event) => change(key, String(event.target.checked))} /><span><strong>{label}</strong><small>{hint}</small></span></label>)}</fieldset><fieldset className="personal-settings"><legend>{es ? 'Horario de silencio' : 'Quiet hours'}</legend><div className="personal-form-row"><label>{es ? 'Desde' : 'From'}<input type="time" value={draft['dealrift-quiet-start'] ?? ''} onChange={(event) => change('dealrift-quiet-start', event.target.value)} /></label><label>{es ? 'Hasta' : 'Until'}<input type="time" value={draft['dealrift-quiet-end'] ?? ''} onChange={(event) => change('dealrift-quiet-end', event.target.value)} /></label><button type="button" onClick={() => { change('dealrift-quiet-start', ''); change('dealrift-quiet-end', '') }}>{es ? 'Sin horario' : 'No quiet hours'}</button></div><p className="personal-fine-print">{es ? 'Usa la zona horaria de este equipo. Puede atravesar medianoche. Durante este horario, revisa los hallazgos en el registro.' : 'Uses this computer’s time zone and can cross midnight. During quiet hours, review findings in the log.'}</p></fieldset>{error ? <p className="personal-error" role="alert">{error}</p> : null}<button type="submit" className="personal-primary" disabled={busy || !dirty}>{busy ? (es ? 'Guardando…' : 'Saving…') : (es ? 'Guardar preferencias' : 'Save preferences')}</button><p className="personal-status" role="status">{message}</p></form></section>
}
