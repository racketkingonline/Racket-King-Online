import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Login from './Login.tsx'
import Landing from './Landing.tsx'
import { api, Net, NetContext, serverAvailable } from './net'
import { getLang, MISSING, t } from './i18n'

// Lingua della pagina e titolo fin dal primo istante; i testi non tradotti restano ispezionabili da console.
document.documentElement.lang = getLang()
document.title = 'Racket King Online'
;(window as unknown as { __i18nMissing: Set<string> }).__i18nMissing = MISSING

// Se qualcosa si rompe durante il gioco, niente pagina bianca: si mostra l'errore e si può ricominciare.
class Guard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="app"><section className="panel" style={{ marginTop: 40 }}>
        <h2>{t('Qualcosa si è rotto')}</h2>
        <p className="lead">{t('Il gioco ha incontrato un errore:')} <code>{this.state.error.message}</code></p>
        <button className="on" onClick={() => location.reload()}>{t('Riprova')}</button>{' '}
        <button className="danger" onClick={() => { try { localStorage.removeItem('impero-save-v4') } catch { /* niente */ } location.reload() }}>{t('Cancella il salvataggio e ricomincia')}</button>
      </section></div>
    )
  }
}

// Con un server dietro (gioco online) si entra con l'account; senza (anteprima del prototipo) si gioca in locale.
type Providers = { google: boolean; facebook: boolean; email: boolean; alpha?: boolean; turnstile?: string | null }
type Invite = { token: string; email: string | null; valid: boolean }
type Phase = { k: 'checking' } | { k: 'local' } | { k: 'login'; p: Providers; name?: boolean; invite?: Invite } | { k: 'online'; net: Net }
function Boot() {
  const [phase, setPhase] = useState<Phase>({ k: 'checking' })
  const [, setV] = useState(0)
  const enter = async (p: Providers) => {
    const me = await api<{ ok: boolean; user?: { name: string | null } }>('/api/auth/me')
    if (!me.ok) {
      const key = new URLSearchParams(location.search).get('chiave')
      if (key) { const i = await api<{ valid: boolean; email: string | null }>(`/api/invite/${encodeURIComponent(key)}`); return setPhase({ k: 'login', p, invite: { token: key, email: i.email ?? null, valid: !!i.valid } }) }
      return setPhase({ k: 'login', p })
    }
    if (!me.user?.name) return setPhase({ k: 'login', p, name: true })
    const net = new Net(); net.on(() => { if (net.error === 'auth') setPhase({ k: 'login', p }); else setV(v => v + 1) }); net.connect()
    setPhase({ k: 'online', net })
  }
  useEffect(() => { void serverAvailable().then(p => (p ? enter(p) : setPhase({ k: 'local' }))) }, [])
  if (phase.k === 'checking') return null
  if (phase.k === 'local') return <App />
  if (phase.k === 'login') {
    const reset = new URLSearchParams(location.search).has('reset')
    if (phase.p.alpha && !phase.name && !phase.invite && !reset) return <Landing providers={phase.p} onLogin={() => void enter(phase.p)} />
    return <Login providers={phase.p} initial={phase.name ? 'name' : phase.invite ? 'register' : undefined} invite={phase.invite} onDone={() => void enter(phase.p)} />
  }
  if (!phase.net.state) return <div className="app"><p className="lead" style={{ marginTop: 80, textAlign: 'center' }}>{phase.net.status === 'offline' ? t('Server non raggiungibile: riprovo…') : t('Collegamento al server…')}</p></div>
  return <NetContext.Provider value={phase.net}><App net={phase.net} /></NetContext.Provider>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Guard><Boot /></Guard>
  </StrictMode>,
)
