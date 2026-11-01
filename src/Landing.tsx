// Home pubblica della closed alpha: iscrizione alla lista d'attesa e "Ho un accesso alfa".
import { useState } from 'react';
import logoUrl from './assets/racket-king-logo.svg';
import { getLang, LANGS, setLang, t } from './i18n';
import { api } from './net';
import { useAntibot } from './antibot';

type Providers = { google: boolean; facebook: boolean; email: boolean; turnstile?: string | null };
type Access = 'no' | 'attesa' | 'mail' | 'account' | 'social';

export default function Landing({ providers, onLogin }: { providers: Providers; onLogin: () => void }) {
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState<'join' | 'access'>(params.get('login') === 'invito' ? 'access' : 'join');
  const [, setV] = useState(0);
  return (
    <div className="landing">
      <div className="landing-hero" style={{ backgroundImage: 'url(art/ingresso-arrivo.jpg)' }}>
        <div className="landing-top">
          <div className="kicker">{t('‹ Closed alpha ›')}</div>
          <div className="speeds langs" role="group" aria-label={t('Lingua')}>
            {LANGS.map(l => <button type="button" key={l.id} className={l.id === getLang() ? 'on' : ''} onClick={() => { setLang(l.id); setV(v => v + 1); }}>{l.label}</button>)}
          </div>
        </div>
        <div className="landing-main">
          <div className="landing-pitch">
            <img className="logo" src={logoUrl} alt="Racket King Online" />
            <p className="landing-claim">{t('Una valigia di contanti, sei uomini e una cittadina americana che non sa ancora chi sei.')}</p>
            <p className="lead">{t("Costruisci il tuo impero criminale in tempo reale contro altri boss: racket e attività di facciata, polizia da tenere buona, città da conquistare, famiglie da sottomettere. Gratis, nel browser.")}</p>
          </div>
          <div className="intro-box auth">
            {params.get('confermato') && <p className="hint ok-note">{t('Email confermata: sei nella lista. Ti scriviamo quando arriva la tua alfa key.')}</p>}
            {params.get('login') === 'invito' && <p className="req">{t('Questa email non ha ancora una alfa key: iscriviti alla lista e aspetta la mail di accettazione.')}</p>}
            <div className="seg">
              <button type="button" className={mode === 'join' ? 'on' : ''} onClick={() => setMode('join')}>{t('Iscriviti alla closed alpha')}</button>
              <button type="button" className={mode === 'access' ? 'on' : ''} onClick={() => setMode('access')}>{t('Ho un accesso alfa')}</button>
            </div>
            {mode === 'join' ? <Join /> : <AccessForm providers={providers} onLogin={onLogin} />}
          </div>
        </div>
      </div>
      <div className="landing-strip">
        {([['evento-conquista', 'Conquista', 'Prendi il QG di una banda e la città è tua.'], ['evento-retata', 'Calore', 'Più guadagni, più la polizia ti guarda. Comprala, o nasconditi.'], ['evento-sottomissione', 'Famiglie', 'Prendi la capitale di un altro boss: da quel giorno lavora per te.']] as const).map(([img, h, p]) => (
          <div key={img} className="landing-card"><img src={`art/${img}.jpg`} alt="" loading="lazy" /><b>{t(h)}</b><span>{t(p)}</span></div>
        ))}
      </div>
      <p className="landing-foot muted small">{t('Racket King Online è in closed alpha: i posti si aprono a piccoli gruppi. Nessuno spam: useremo la tua email solo per il tuo invito e per le notizie sul gioco, e puoi chiedere di cancellarla quando vuoi.')}</p>
    </div>
  );
}

function Join() {
  const bot = useAntibot();
  const [email, setEmail] = useState(''); const [consent, setConsent] = useState(false); const [trap, setTrap] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ref = new URLSearchParams(location.search).get('ref') ?? undefined;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const r = await api<{ ok: boolean; msg?: string; confirm?: boolean }>('/api/alpha/join', { email, consent, lang: getLang(), ref, ...(await bot.get(trap)) });
      if (r.ok) setMsg({ ok: true, text: r.confirm === false ? t('Sei nella lista! Ti scriviamo quando arriva la tua alfa key.') : t('Ci sei quasi: ti abbiamo mandato una mail, clicca il link per confermare l\'iscrizione.') });
      else setMsg({ ok: false, text: t(r.msg ?? 'Errore.') });
    } finally { setBusy(false); bot.reset(); }
  };
  if (msg?.ok) return <p className="hint ok-note">{msg.text}</p>;
  return (
    <form onSubmit={submit} className="auth-form">
      <p className="lead small">{t('Lascia la tua email: quando si libera un posto ti mandiamo la tua alfa key.')}</p>
      <label>{t('Email')}<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={trap} onChange={e => setTrap(e.target.value)} />
      <label className="check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required /> <span>{t('Voglio ricevere la mia alfa key e le notizie su Racket King Online a questo indirizzo.')}</span></label>
      {bot.needsTurnstile && <div ref={bot.box} />}
      {msg && <p className="req">{msg.text}</p>}
      <button className="on" disabled={busy}>{busy ? t('Un attimo…') : t('Iscrivimi')}</button>
    </form>
  );
}

function AccessForm({ providers, onLogin }: { providers: Providers; onLogin: () => void }) {
  const bot = useAntibot();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [trap, setTrap] = useState('');
  const [status, setStatus] = useState<Access | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [forgot, setForgot] = useState<string | null>(null);
  const check = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (status === 'account') {
        const r = await api('/api/auth/login', { email, password });
        if (r.ok) return onLogin();
        setErr(t(r.msg ?? 'Errore.'));
      } else {
        const r = await api<{ ok: boolean; msg?: string; status?: Access }>('/api/alpha/access', { email, ...(await bot.get(trap)) });
        bot.reset();
        if (r.ok) setStatus(r.status ?? 'no'); else setErr(t(r.msg ?? 'Errore.'));
      }
    } finally { setBusy(false); }
  };
  const sendReset = async () => { setBusy(true); const r = await api('/api/auth/forgot', { email, ...(await bot.get(trap)) }); bot.reset(); setBusy(false); setForgot(r.ok ? t("Se l'email è registrata, ti abbiamo mandato un link per scegliere una nuova password.") : t(r.msg ?? 'Errore.')); };
  return (
    <form onSubmit={check} className="auth-form">
      <label>{t('La tua email')}<input type="email" autoComplete="email" required value={email} onChange={e => { setEmail(e.target.value); setStatus(null); }} /></label>
      <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={trap} onChange={e => setTrap(e.target.value)} />
      {status === 'account' && <label>{t('Password')}<input type="password" autoComplete="current-password" required autoFocus value={password} onChange={e => setPassword(e.target.value)} /></label>}
      {status === 'mail' && <p className="hint ok-note">{t('La tua alfa key è pronta: ti abbiamo mandato (di nuovo) la mail con il link per creare il tuo boss.')}</p>}
      {status === 'attesa' && <p className="hint">{t("Sei nella lista d'attesa: la tua alfa key non è ancora arrivata. Ti scriviamo noi.")}</p>}
      {status === 'no' && <p className="req">{t('Questa email non è iscritta alla closed alpha. Iscriviti dalla scheda accanto.')}</p>}
      {status === 'social' && <p className="hint">{t('Hai creato il tuo boss con Google o Facebook: entra da lì.')}</p>}
      {err && <p className="req">{err}</p>}
      {forgot && <p className="hint">{forgot}</p>}
      {bot.needsTurnstile && status !== 'account' && <div ref={bot.box} />}
      {(status === null || status === 'account') && <button className="on" disabled={busy}>{busy ? t('Un attimo…') : status === 'account' ? t('Entra') : t('Continua')}</button>}
      {status === 'account' && <button type="button" className="link" onClick={() => void sendReset()}>{t('Password dimenticata?')}</button>}
      {(providers.google || providers.facebook) && <div className="oauth">
        <span className="muted small">{t('oppure, se la tua alfa key è per la stessa email')}</span>
        {providers.google && <a className="btn" href="/api/auth/google">{t('Entra con Google')}</a>}
        {providers.facebook && <a className="btn" href="/api/auth/facebook">{t('Entra con Facebook')}</a>}
      </div>}
    </form>
  );
}
