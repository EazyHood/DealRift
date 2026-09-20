import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initializeLibrary } from './lib/personalLibrary'
import type { LibraryState } from './shared/libraryTypes'
import { AppBoundary } from './components/AppBoundary'
import { MotionConfig } from 'framer-motion'

export function Startup() {
  const [state, setState] = useState<LibraryState | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    void initializeLibrary().then((next) => { if (active) setState(next) }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : 'Unable to open your library.')
    })
    return () => { active = false }
  }, [attempt])
  const es = navigator.language.startsWith('es')
  if (state) return <App initialLibrary={state} />
  return <main className="startup-state" aria-busy={!error}>
    <h1>DealRift</h1>
    <p role={error ? 'alert' : 'status'}>{error ? (es ? 'No se pudo abrir tu biblioteca local.' : 'Your local library could not be opened.') : (es ? 'Abriendo tu biblioteca…' : 'Opening your library…')}</p>
    {error ? <><p>{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>{es ? 'Reintentar' : 'Retry'}</button></> : null}
  </main>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppBoundary><MotionConfig reducedMotion="user"><Startup /></MotionConfig></AppBoundary>
  </StrictMode>,
)
