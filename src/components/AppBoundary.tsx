import { Component, type ReactNode } from 'react'

export class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    const es = navigator.language.startsWith('es')
    return <main className="startup-state" role="alert">
      <h1>DealRift</h1>
      <p>{es ? 'La vista no pudo abrirse. Tus datos locales siguen guardados.' : 'This view could not open. Your local data is still saved.'}</p>
      <button type="button" onClick={() => window.location.reload()}>{es ? 'Volver a abrir' : 'Reopen'}</button>
    </main>
  }
}
