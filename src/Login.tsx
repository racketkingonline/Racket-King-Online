// Ingresso nel gioco online: accesso, registrazione, password dimenticata, scelta del nome del boss.
import { useState } from 'react';
import logoUrl from './assets/racket-king-logo.svg';
import { getLang, LANGS, setLang, t } from './i18n';
import { api } from './net';

type Mode = 'login' | 'register' | 'forgot' | 'reset' | 'name';
type Providers = { google: boolean; facebook: boolean; email: boolean };

export default function Login({ providers, initial, onDone }: { providers: Providers; initial?: Mode; onDone: () => void }) {
  const params = new URLSearchParams(location.search);
  const resetToken = params.get('reset');
  const [mode, setMode] = useState<Mode>(initial ?? (resetToken ? 'reset' : 'login'));
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(params.get('login') === 'errore' ? { ok: false, text: t('Accesso non riuscito: riprova.') } : null);
  const [busy, setBusy] = useState(false);
  const [, setV] = useState(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      if (mode === 'login') { const r = await api('/api/auth/login', { email, password }); if (r.ok) return onDone(); setMsg({ ok: false, text: t(r.msg ?? 'Errore.') }); }
      else if (mode === 'register') { const r = await api('/api/auth/register', { email, password, name, lang: getLang() }); if (r.ok) return onDone(); setMsg({ ok: false, text: t(r.msg ?? 'Errore.') }); }
      else if (mode === 'forgot') { await api('/api/auth/forgot', { email }); setMsg({ ok: true, text: t("Se l'email è registrata, ti abbiamo mandato un link per scegliere una nuova password.") }); }
      else if (mode === 'reset') { const r = await api('/api/auth/reset', { token: resetToken, password }); if (r.ok) { history.replaceState(null, '', '/'); return onDone(); } setMsg({ ok: false, text: t(r.msg ?? 'Errore.') }); }
      else if (mode === 'name') { const r = await api('/api/auth/name', { name }); if (r.ok) return onDone(); setMsg({ ok: false, text: t(r.msg ?? 'Errore.') }); }
    } finally { setBusy(false); }
  };

  const title = { login: 'Accedi', register: 'Crea il tuo boss', forgot: 'Password dimenticata', reset: 'Nuova password', name: 'Come ti chiameranno?' }[mode];
  return (
    <div className="intro-bg">
      <div className="intro-screen" style={{ backgroundImage: 'url(art/ingresso-login.jpg)' }}>
        <form className="intro-box auth" onSubmit={submit}>
          <div className="auth-top">
            <div className="kicker">{t('‹ Dossier riservato ›')}</div>
            <div className="speeds langs" role="group" aria-label={t('Lingua')}>
              {LANGS.map(l => <button type="button" key={l.id} className={l.id === getLang() ? 'on' : ''} onClick={() => { setLang(l.id); setV(v => v + 1); }}>{l.label}</button>)}
            </div>
          </div>
          <img className="logo" src={logoUrl} alt="Racket King Online" />
          <h2>{t(title)}</h2>
          {mode === 'name' && <p className="lead small">{t('Il nome con cui ti conosceranno gli altri boss. Non si cambia.')}</p>}
          {(mode === 'login' || mode === 'register' || mode === 'forgot') && <label>{t('Email')}<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>}
          {(mode === 'login' || mode === 'register' || mode === 'reset') && <label>{t('Password')}<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 8} value={password} onChange={e => setPassword(e.target.value)} /></label>}
          {(mode === 'register' || mode === 'name') && <label>{t('Nome del boss')}<input required minLength={3} maxLength={20} value={name} onChange={e => setName(e.target.value)} placeholder="Dwight M." /></label>}
          {msg && <p className={msg.ok ? 'hint' : 'req'}>{msg.text}</p>}
          <button className="on" disabled={busy}>{t({ login: 'Entra', register: 'Crea e entra', forgot: 'Mandami il link', reset: 'Salva e entra', name: 'Conferma' }[mode])}</button>
          {(mode === 'login' || mode === 'register') && (providers.google || providers.facebook) && <div className="oauth">
            <span className="muted small">{t('oppure')}</span>
            {providers.google && <a className="btn" href="/api/auth/google">{t('Entra con Google')}</a>}
            {providers.facebook && <a className="btn" href="/api/auth/facebook">{t('Entra con Facebook')}</a>}
          </div>}
          <div className="auth-links">
            {mode !== 'login' && mode !== 'name' && <button type="button" className="link" onClick={() => { setMode('login'); setMsg(null); }}>{t('Hai già un account? Accedi')}</button>}
            {mode === 'login' && <button type="button" className="link" onClick={() => { setMode('register'); setMsg(null); }}>{t('Nuovo? Crea il tuo boss')}</button>}
            {mode === 'login' && <button type="button" className="link" onClick={() => { setMode('forgot'); setMsg(null); }}>{t('Password dimenticata?')}</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
