// Ingresso nel gioco online: accesso, registrazione, password dimenticata, scelta del nome del boss.
import { useState } from 'react';
import logoUrl from './assets/racket-king-logo.svg';
import { getLang, LANGS, setLang, t } from './i18n';
import { api } from './net';
import { useAntibot } from './antibot';

type Mode = 'login' | 'register' | 'forgot' | 'reset' | 'name';
type Providers = { google: boolean; facebook: boolean; email: boolean; alpha?: boolean; turnstile?: string | null };

export default function Login({ providers, initial, onDone, invite }: { providers: Providers; initial?: Mode; onDone: () => void; invite?: { token: string; email: string | null; valid: boolean } }) {
  const params = new URLSearchParams(location.search);
  const resetToken = params.get('reset');
  const [mode, setMode] = useState<Mode>(initial ?? (resetToken ? 'reset' : 'login'));
  const bot = useAntibot(); const [trap, setTrap] = useState('');
  const [email, setEmail] = useState(invite?.email ?? ''); const [password, setPassword] = useState(''); const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(params.get('login') === 'errore' ? { ok: false, text: t('Accesso non riuscito: riprova.') } : invite && !invite.valid ? { ok: false, text: t('Questa alfa key non è valida, è scaduta o è già stata usata.') } : null);
  const [busy, setBusy] = useState(false);
  const [, setV] = useState(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      if (mode === 'login') { const r = await api('/api/auth/login', { email, password }); if (r.ok) return onDone(); setMsg({ ok: false, text: t(r.msg ?? 'Errore.') }); }
      else if (mode === 'register') { const r = await api('/api/auth/register', { email, password, name, lang: getLang(), invite: invite?.token, ...(await bot.get(trap)) }); bot.reset(); if (r.ok) { history.replaceState(null, '', '/'); return onDone(); } setMsg({ ok: false, text: t(r.msg ?? 'Errore.') }); }
      else if (mode === 'forgot') { const r = await api('/api/auth/forgot', { email, ...(await bot.get(trap)) }); bot.reset(); setMsg(r.ok ? { ok: true, text: t("Se l'email è registrata, ti abbiamo mandato un link per scegliere una nuova password.") } : { ok: false, text: t(r.msg ?? 'Errore.') }); }
      else if (mode === 'reset') { const r = await api('/api/auth/reset', { token: resetToken, password }); if (r.ok) { history.replaceState(null, '', '/'); return onDone(); } setMsg({ ok: false, text: t(r.msg ?? 'Errore.') }); }
      else if (mode === 'name') { const r = await api('/api/auth/name', { name }); if (r.ok) return onDone(); setMsg({ ok: false, text: t(r.msg ?? 'Errore.') }); }
    } finally { setBusy(false); }
  };

  const title = { login: 'Accedi', register: invite ? 'Benvenuto nella closed alpha' : 'Crea il tuo boss', forgot: 'Password dimenticata', reset: 'Nuova password', name: 'Come ti chiameranno?' }[mode];
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
          {mode === 'register' && invite?.valid && <p className="lead small">{t('La tua alfa key è valida. Scegli il nome del tuo boss e una password: poi rientri dalla home con "Ho un accesso alfa".')}</p>}
          {mode === 'name' && <p className="lead small">{t('Il nome con cui ti conosceranno gli altri boss. Non si cambia.')}</p>}
          {(mode === 'login' || mode === 'register' || mode === 'forgot') && <label>{t('Email')}<input type="email" autoComplete="email" required value={email} readOnly={!!invite?.email} onChange={e => setEmail(e.target.value)} /></label>}
          <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={trap} onChange={e => setTrap(e.target.value)} />
          {bot.needsTurnstile && (mode === 'register' || mode === 'forgot') && <div ref={bot.box} />}
          {(mode === 'login' || mode === 'register' || mode === 'reset') && <label>{t('Password')}<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 8} value={password} onChange={e => setPassword(e.target.value)} /></label>}
          {(mode === 'register' || mode === 'name') && <label>{t('Nome del boss')}<input required minLength={3} maxLength={20} value={name} onChange={e => setName(e.target.value)} placeholder="Vic Marlowe" /></label>}
          {msg && <p className={msg.ok ? 'hint' : 'req'}>{msg.text}</p>}
          <button className="on" disabled={busy || (!!invite && !invite.valid)}>{t({ login: 'Entra', register: 'Crea e entra', forgot: 'Mandami il link', reset: 'Salva e entra', name: 'Conferma' }[mode])}</button>
          {(mode === 'login' || mode === 'register') && (providers.google || providers.facebook) && <div className="oauth">
            <span className="muted small">{t('oppure')}</span>
            {providers.google && <a className="btn" href={`/api/auth/google${invite ? `?invito=${invite.token}` : ''}`}>{t('Entra con Google')}</a>}
            {providers.facebook && <a className="btn" href={`/api/auth/facebook${invite ? `?invito=${invite.token}` : ''}`}>{t('Entra con Facebook')}</a>}
          </div>}
          <div className="auth-links">
            {invite ? <a className="link" href="/">{t('Torna alla home')}</a> : mode !== 'login' && mode !== 'name' && <button type="button" className="link" onClick={() => { setMode('login'); setMsg(null); }}>{t('Hai già un account? Accedi')}</button>}
            {mode === 'login' && !providers.alpha && <button type="button" className="link" onClick={() => { setMode('register'); setMsg(null); }}>{t('Nuovo? Crea il tuo boss')}</button>}
            {mode === 'login' && <button type="button" className="link" onClick={() => { setMode('forgot'); setMsg(null); }}>{t('Password dimenticata?')}</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
