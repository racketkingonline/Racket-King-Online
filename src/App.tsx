import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { fmtMoney, fmtNum, getLang, LANGS, locale, onLang, render, setLang, t, type Msg } from './i18n';
import MapCanvas from './map/MapCanvas';
import logoUrl from './assets/racket-king-logo.svg';
import { api, useNet, type Net } from './net';
import { Art, AVATARS, bossArt, FAVOR_ICON, Ico, logArt, lotArt, lotIcon, MISSION_ICON, reportArt, reportIcon, TAB_ICON, ZONE_ICON } from './art';
import { nextSeason, seasonAt, SEASON_LENGTH, syncSeasonSingle } from './engine/seasons';
import City3D, { type Look, type TurfView } from './city/City3D';
import { CITIES_BY_COUNTY, CITIES_BY_STATE, searchCities, STATES } from './engine/world';
import { blockFit, DECO_LABEL, layout, lotZone, nearPolice } from './engine/layout';
import {
  CATEGORY_LABEL, K, PAYROLL, RACKETS, RESEARCH, SPEEDS, UNITS, ZONE_DESC, ZONE_LABEL,
  type Category, type Cost, type RacketId, type Requirement, type UnitId, type Zone,
} from './engine/data';
import {
  presidio as cityRatesPresidio, clock as engineClock, squadText as engineSquadText, vacationDaysLeft, investBonus, migrate, totalCost, acquireCost, act, campaignCost, isMayorOf, mayorCost, usableLots, whereIs, buildHours, buildingLevel, buildOptions, canAfford, capitalize, cityLimit, cityName, cityRates, def, demand,
  duration, efficiency, exposed, freeLots, gangBlocks, giriOn, giriPlaced, giriTotal, protectUsed, racketLevel, tileRisk, activeRoutes, gangDefense, influenceNeeded, nearestThreat, MAYOR, missingReqMsg, gangMsg, nameOf, newGame, owned,
  payrollCost, peekCity, POLICE, power, rates, researchCost, researchHours, safeCap, score, statesHeld, synergy, thresholds,
  tick, travelHours, unitHours, upgradeCost, useDef,
  type Action, type BattleReport, type HostedId, type CityState, type GameState, type LogEntry, type MissionKind, type Squad, type UseKind,
} from './engine/engine';

const SAVE_KEY = 'impero-save-v4';
type Saved = { state: GameState; speed: number; savedAt: number };

function load(): Saved | null {
  try { const raw = localStorage.getItem(SAVE_KEY); return raw ? JSON.parse(raw) as Saved : null; } catch { return null; }
}
function persist(state: GameState, speed: number) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ state, speed, savedAt: Date.now() })); } catch { /* storage non disponibile */ }
}

const TABS = ['Città', 'Panoramica', 'Crew', 'Know-how', 'Mappa', 'Rapporti'] as const;
type Tab = (typeof TABS)[number];

// ---------------------------------------------------------------- testi e numeri nella lingua attiva
const money = (x: number) => fmtMoney(x);
const group = (x: number) => fmtNum(x);
const fmt = group;
/** Numero con decimali fissi, con il separatore della lingua attiva. */
const dec = (x: number, d: number) => x.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
const short = (x: number) => (Math.abs(x) >= 1e6 ? dec(x / 1e6, 2) + 'M' : Math.abs(x) >= 1e4 ? dec(x / 1e3, 1) + 'k' : fmt(x));
/** Data di gioco nella lingua attiva: "Giorno 3, 14:05" / "Day 3, 14:05". */
const clock = (sec: number) => engineClock(sec, getLang());
/** Elenco di uomini nella lingua attiva: "3 picchiatori, 1 soldati". */
const squadText = (sq: Squad) => engineSquadText(sq, getLang());
/** Nome di una banda nella lingua attiva (il nome salvato è italiano). */
const gangL = (name: string) => render(gangMsg(name));
/** Requisiti mancanti, già tradotti. */
const missing = (s: GameState, c: CityState | null, req?: Requirement) => missingReqMsg(s, c, req).map(m => render(m));
const logText = (e: LogEntry) => (e.m ? render(e.m) : t(e.text));
/** Come t(), ma i segnaposto possono essere elementi React. */
function tj(it: string, p: Record<string, React.ReactNode>) {
  const str = t(it); const out: React.ReactNode[] = []; let last = 0;
  str.replace(/\{(\w+)\}/g, (m: string, k: string, off: number) => { out.push(str.slice(last, off)); out.push(<Fragment key={off}>{p[k] ?? m}</Fragment>); last = off + m.length; return m; });
  out.push(str.slice(last));
  return out;
}

export default function App({ net }: { net?: Net } = {}) {
  const ref = useRef<GameState | null>(null);
  if (net?.state) ref.current = net.state;
  const [, setV] = useState(0);
  const [speed, setSpeed] = useState(60);
  const [tab, setTab] = useState<Tab>('Città');
  const [cid, setCid] = useState<string>('');
  const [toast, setToast] = useState<{ ok: boolean; msg: string; m?: Msg } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [picker, setPicker] = useState(false);

  if (!ref.current) {
    const saved = load();
    try {
      if (saved?.state?.version !== 4) throw new Error('nessun salvataggio compatibile');
      const st = migrate(saved.state);
      rates(st); // verifica che lo stato sia leggibile
      const away = Math.min(12 * 3600, Math.max(0, (Date.now() - saved.savedAt) / 1000));
      if (saved.speed > 0 && away > 30) tick(st, away);
      syncSeasonSingle(st);
      if (st.introSeen === undefined && st.time > 6 * 3600) st.introSeen = true; // partite già avviate: niente introduzione
      ref.current = st;
    } catch {
      ref.current = newGame();
    }
  }
  const s = ref.current;
  const rerender = useCallback(() => setV(v => v + 1), []);
  const lang = getLang();
  useEffect(() => { const off = onLang(rerender); return () => { off(); }; }, [rerender]);
  useEffect(() => { document.documentElement.lang = lang; document.title = t('Racket King Online — prototipo'); }, [lang]);

  useEffect(() => {
    if (!net) return;
    let last = performance.now();
    const id = setInterval(() => { const now = performance.now(); net.interpolate((now - last) / 1000); last = now; rerender(); }, 250);
    const off = net.on(rerender);
    return () => { clearInterval(id); off(); };
  }, [net, rerender]);
  useEffect(() => {
    if (net) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now(), dt = (now - last) / 1000; last = now;
      if (speed > 0 && ref.current && ref.current.introSeen) { tick(ref.current, dt * speed); syncSeasonSingle(ref.current); rerender(); }
    }, 200);
    const save = setInterval(() => ref.current && persist(ref.current, speed), 5000);
    const onHide = () => ref.current && persist(ref.current, speed);
    window.addEventListener('beforeunload', onHide);
    return () => { clearInterval(id); clearInterval(save); window.removeEventListener('beforeunload', onHide); };
  }, [speed, rerender, net]);
  /** Salva in locale (partita offline) o avvisa il server (partita online). */
  const save = (srv?: Parameters<Net['act']>[0]) => { if (net) { if (srv) void net.act(srv); } else if (ref.current) persist(ref.current, speed); };

  const run = useCallback((a: Action) => {
    if (!ref.current) return;
    if (net) { void net.act(a).then(r => { if (!r.ok || r.msg || r.m) setToast({ ok: r.ok, msg: r.msg ?? '', m: r.m }); }); return; }
    const r = act(ref.current, a);
    if (!r.ok || r.msg || r.m) setToast({ ok: r.ok, msg: r.msg ?? '', m: r.m });
    persist(ref.current, speed); rerender();
  }, [speed, rerender, net]);

  const lastSpeed = useRef(60);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (net && (e.key === ' ' || /^[1-6]$/.test(e.key))) return;
      if (e.key === ' ') { e.preventDefault(); setSpeed(v => { if (v > 0) { lastSpeed.current = v; return 0; } return lastSpeed.current || 60; }); }
      else if (e.key === 'q' || e.key === 'Q') setTab(t => TABS[(TABS.indexOf(t) + TABS.length - 1) % TABS.length]);
      else if (e.key === 'e' || e.key === 'E') setTab(t => TABS[(TABS.indexOf(t) + 1) % TABS.length]);
      else if (/^[1-6]$/.test(e.key)) setSpeed(SPEEDS[Number(e.key) - 1]);
      else if (e.key === 'Escape' && ref.current) { const u = ref.current.reports?.slice().reverse().find(x => !x.seen); if (u) { u.seen = true; if (net) void net.act({ t: 'seen', ids: [u.id] }); rerender(); } }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rerender, net]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);

  const mine = owned(s);
  const c = s.cities[cid]?.owner === 'player' ? s.cities[cid] : s.cities[s.capital];
  const r = rates(s);
  const cr = r.cities[c.id];
  const incoming = mine.filter(x => x.gang.incoming);
  s.reports ??= []; s.nextReportId ??= 1;
  const unseen = s.reports.slice().reverse().find(x => !x.seen) ?? null;

  return (
    <div className="app">
      <header className="top">
        <div className="ident">
        <button className="me" onClick={() => setPicker(true)} title={t('Cambia il tuo ritratto')} aria-label={t('Il tuo ritratto')}>
          <Art id={s.avatar ?? AVATARS[0]} />
        </button>
        <div className="brand">
          <div className="kicker">{t('‹ Dossier riservato ›')}</div>
          <img className="logo" src={logoUrl} alt="Racket King Online" />
          <div className="cities" role="group" aria-label={t('Le tue città')}>
            {mine.map(x => (
              <button key={x.id} className={x.id === c.id ? 'on' : ''} onClick={() => setCid(x.id)}>
                {x.id === s.capital && <Ico id="res-capitale" size="xs" />}{cityName(x.id)}{x.gang.incoming && <Ico id="esito-attacco" size="xs" className="after" />}
              </button>
            ))}
            <span className={`limit ${mine.length > cityLimit(s) ? 'over' : ''}`}><Ico id="res-citta" size="xs" />{t('{n}/{max} città gestibili', { n: mine.length, max: cityLimit(s) })}</span>
          </div>
        </div>
        </div>
        <div className="clock">
          <div><Ico id="res-tempo" size="sm" />{clock(s.time)}</div>
          {!net && <SeasonTag day={Math.floor(s.time / 86400)} />}
          {net && <div className="who"><b>{net.me?.name}</b>{net.status !== 'online' && <span className="warn"> · {t('riconnessione…')}</span>} · <button className="link" onClick={() => { void api('/api/auth/logout', {}).then(() => location.reload()); }}>{t('Esci')}</button></div>}
          <div className="clock-row">
            {!net && <div className="speeds" role="group" aria-label={t('Velocità del tempo')}>
              {SPEEDS.map(v => (
                <button key={v} className={v === speed ? 'on' : ''} onClick={() => setSpeed(v)}>{v === 0 ? t('Pausa') : `${v}×`}</button>
              ))}
            </div>}
            <div className="speeds langs" role="group" aria-label={t('Lingua')}>
              {LANGS.map(l => <button key={l.id} className={l.id === lang ? 'on' : ''} lang={l.id} onClick={() => setLang(l.id)} aria-pressed={l.id === lang}>{l.label}</button>)}
            </div>
          </div>
        </div>
      </header>

      <section className="resbar">
        <Res label={t('Contante sporco')} value={money(s.res.sporco)} rate={r.dirty - r.upkeepSporco - r.laundering} tone="dirty" icon="res-sporco"
          hint={t('Al sicuro nelle casseforti: {safe} · esposto: {exp}', { safe: money(Math.min(s.res.sporco, safeCap(s))), exp: money(exposed(s)) })} />
        <Res label={t('Contante pulito')} value={money(s.res.pulito)} rate={r.clean + r.laundering * (1 - r.launderFee) - r.upkeepPulito} tone="clean" icon="res-pulito" />
        <Res label={t('Influenza · {city}', { city: cityName(c.id) })} value={`${fmt(c.influence)} / ${fmt(K.influenceCap)}`} rate={cr.influence} tone="infl" icon="res-influenza" />
        <div className="res heat has-ico">
          <Ico id="res-calore" size="lg" />
          <div>
            <div className="label">{t('Calore · {city}', { city: cityName(c.id) })}</div>
            <HeatBar s={s} heat={c.heat} target={cr.heatTarget} />
          </div>
        </div>
        <div className="res has-ico">
          <Ico id="res-punteggio" size="lg" />
          <div>
            <div className="label">{t('Punti')}</div>
            <div className="value">{fmt(score(s))}</div>
          </div>
        </div>
      </section>

      {incoming.map(x => (
        <div className="alert with-face" key={x.id}>
          <Ico id="esito-attacco" size="md" />
          {x.gang.incoming!.from && <Art id={bossArt(x.gang.incoming!.from)} className="face" />}
          <strong>{t('Attacco in arrivo a {city}', { city: cityName(x.id) })}</strong> · {x.gang.incoming!.from ? t('{gang} da {city}', { gang: gangL(s.cities[x.gang.incoming!.from]?.gang.name ?? ''), city: cityName(x.gang.incoming!.from) }) : t('una banda')} ({squadText(x.gang.incoming!.units)}) · {x.gang.incoming!.kind === 'razzia' ? t('vogliono il tuo contante') : t('puntano alle attività legali')} · {t('tra {d}', { d: duration(x.gang.incoming!.arriveAt - s.time) })}
        </div>
      ))}
      {net?.me?.incoming.filter(x => x.arriveAt > s.time).map(x => (
        <div className="alert" key={x.key}>
          <Ico id="esito-attacco" size="md" />
          <strong>{t('{name} attacca {city}', { name: x.byName, city: cityName(x.to) })}</strong> · {t(x.kind === 'assault' ? 'assalto' : x.kind === 'strike' ? 'colpo a un edificio' : 'colpo alla cassa')} · {x.units ? squadText(x.units) : t('quanti siano, non si sa: servono informatori in città')} · {t('tra {d}', { d: duration(x.arriveAt - s.time) })}
        </div>
      ))}
      {r.efficiency < 1 && <div className="alert soft"><Ico id="esito-allerta" size="sm" />{t('Gestisci {n} città ma il tuo limite è {max}: tutte le città rendono il {pct}%. Studia il know-how Gestione.', { n: mine.length, max: cityLimit(s), pct: Math.round(r.efficiency * 100) })}</div>}

      <nav className="tabs" aria-label={t('Schede')}>
        <button className="key" style={{ padding: 0 }} onClick={() => setTab(TABS[(TABS.indexOf(tab) + TABS.length - 1) % TABS.length])} aria-label={t('Scheda precedente')}>Q</button>
        {TABS.map(x => <button key={x} className={x === tab ? 'on' : ''} onClick={() => setTab(x)}><Ico id={TAB_ICON[x]} size="sm" />{t(x)}</button>)}
        <button className="key" style={{ padding: 0 }} onClick={() => setTab(TABS[(TABS.indexOf(tab) + 1) % TABS.length])} aria-label={t('Scheda successiva')}>E</button>
      </nav>
      <div className="crumbs"><b>{cityName(c.id)}</b><i>/</i>{t(tab)}</div>

      <main>
        {tab === 'Panoramica' && <Overview s={s} c={c} run={run} />}
        {tab === 'Città' && <CityTab s={s} c={c} run={run} />}
        {tab === 'Know-how' && <Research s={s} c={c} run={run} />}
        {tab === 'Crew' && <Crew s={s} c={c} run={run} />}
        {tab === 'Mappa' && <MapTab s={s} c={c} run={run} />}
        {tab === 'Rapporti' && <Log s={s} />}
      </main>

      <footer className="foot">
        <div className="keys">
          {!net && <span><span className="key">{t('Spazio')}</span>{t('Pausa')}</span>}
          <span><span className="key">Q</span><span className="key">E</span>{t('Scheda')}</span>
          {!net && <span><span className="key">1–6</span>{t('Velocità')}</span>}
          <span><span className="key">Esc</span>{t('Chiudi rapporto')}</span>
        </div>
        <span className="muted">{net ? t('Online · {n} boss nel mondo, {o} collegati · Geografia: U.S. Census Bureau (us-atlas), città: GeoNames (CC BY 4.0)', { n: net.world?.players ?? 0, o: net.world?.online ?? 0 }) : t('Prototipo locale · seme {seed} · Geografia: U.S. Census Bureau (us-atlas), città: GeoNames (CC BY 4.0)', { seed: String(s.seed) })}</span>
        {net ? null : confirmReset
          ? <span>{t('Ricominciare da zero?')} <button className="danger" onClick={() => { ref.current = newGame(); persist(ref.current, speed); setCid(''); setConfirmReset(false); setTab('Città'); rerender(); }}>{t('Sì, nuova partita')}</button> <button onClick={() => setConfirmReset(false)}>{t('No')}</button></span>
          : <button onClick={() => setConfirmReset(true)}>{t('Nuova partita')}</button>}
      </footer>

      {toast && <div className={`toast ${toast.ok ? 'ok' : 'ko'}`}>{toast.m ? render(toast.m) : t(toast.msg)}</div>}
      {!s.introSeen && <Intro s={s} done={() => { s.introSeen = true; save({ t: 'introSeen' }); rerender(); }} pick={id => { s.avatar = id; save({ t: 'avatar', id }); rerender(); }} />}
      {picker && s.introSeen && <div className="modal-bg" onClick={() => setPicker(false)}>
        <div className="modal wide" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('Scegli il tuo ritratto')}>
          <h2>{t('Chi sei')}</h2>
          <AvatarGrid value={s.avatar} onPick={id => { s.avatar = id; save({ t: 'avatar', id }); setPicker(false); rerender(); }} />
        </div>
      </div>}
      {unseen && s.introSeen && <div className="modal-bg" onClick={() => { unseen.seen = true; save({ t: 'seen', ids: [unseen.id] }); rerender(); }}>
        <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={unseen.m ? render(unseen.m.title) : t(unseen.title)}>
          <ReportCard r={unseen} />
          <div className="modal-act">
            {s.reports.filter(x => !x.seen).length > 1 && <span className="muted small">{t('altri {n} rapporti', { n: s.reports.filter(x => !x.seen).length - 1 })}</span>}
            <button onClick={() => { const ids = s.reports.filter(x => !x.seen).map(x => x.id); for (const x of s.reports) x.seen = true; save({ t: 'seen', ids }); rerender(); }}>{t('Segna tutti come letti')}</button>
            <button className="on" onClick={() => { unseen.seen = true; save({ t: 'seen', ids: [unseen.id] }); rerender(); }}>{t('Ok')}</button>

          </div>
        </div>
      </div>}
    </div>
  );
}

type P = { s: GameState; c: CityState; run: (a: Action) => void };

// ---------------------------------------------------------------- piccoli componenti
function Res({ label, value, rate, tone, hint, icon }: { label: string; value: string; rate: number; tone: string; hint?: string; icon?: string }) {
  return (
    <div className={`res ${tone} has-ico`} title={hint}>
      <Ico id={icon} size="lg" />
      <div>
        <div className="label">{label}</div>
        <div className="value">{value}</div>
        <div className={`rate ${rate < 0 ? 'neg' : ''}`}>{rate >= 0 ? '+' : ''}{short(rate)}/h</div>
      </div>
    </div>
  );
}

function HeatBar({ s, heat, target }: { s: GameState; heat: number; target: number }) {
  const T = thresholds(s);
  return (
    <div className="heatbar" aria-label={t('Calore {h} su 100', { h: Math.round(heat) })}>
      <div className="track">
        <div className="fill" style={{ width: `${heat}%` }} />
        {[T.controlli, T.retata, T.indagine].map(t => <div key={t} className="tick" style={{ left: `${t}%` }} />)}
        <div className="aim" style={{ left: `${target}%` }} title={t('Dove sta andando il calore')} />
      </div>
      <div className="heatnums"><b>{Math.round(heat)}</b> <span className="muted">→ {Math.round(target)}</span></div>
    </div>
  );
}

function CostLine({ cost, s, c }: { cost: Cost; s: GameState; c?: CityState }) {
  const parts: React.ReactNode[] = [];
  if (cost.sporco) parts.push(<span key="s" className={s.res.sporco >= cost.sporco ? '' : 'short'}>{t('{m} sporchi', { m: money(cost.sporco) })}</span>);
  if (cost.pulito) parts.push(<span key="p" className={s.res.pulito >= cost.pulito ? '' : 'short'}>{t('{m} puliti', { m: money(cost.pulito) })}</span>);
  if (cost.influenza) parts.push(<span key="i" className={(c?.influence ?? 0) >= cost.influenza ? '' : 'short'}>{t('{n} influenza', { n: cost.influenza })}</span>);
  return <span className="cost">{parts.reduce<React.ReactNode[]>((a, p, i) => (i ? [...a, ' · ', p] : [p]), [])}</span>;
}

function Card({ title, level, desc, children, locked, active, art, icon }: { title: string; level?: number; desc: string; children?: React.ReactNode; locked?: string[]; active?: boolean; art?: string; icon?: string }) {
  return (
    <div className={`card ${locked?.length ? 'locked' : ''} ${active ? 'active' : ''} ${art ? 'has-art' : ''}`}>
      {art && <Art id={art} className="portrait" />}
      <div className="card-head">
        <h3><Ico id={icon} size="md" />{title}</h3>
        {level !== undefined && <span className="lvl">{t('liv. {n}', { n: level })}</span>}
      </div>
      <p className="desc">{desc}</p>
      {locked?.length ? <p className="req"><Ico id="stato-bloccato" size="xs" />{t('Serve: {list}', { list: locked.join(', ') })}</p> : children}
    </div>
  );
}

function Progress({ s, start, end, label, onCancel }: { s: GameState; start: number; end: number; label: string; onCancel?: () => void }) {
  const p = Math.min(100, ((s.time - start) / Math.max(1, end - start)) * 100);
  return (
    <div className="progress">
      <div className="bar"><div style={{ width: `${p}%` }} /></div>
      <div className="row"><span>{label} · {duration(end - s.time)}</span>{onCancel && <button className="link" onClick={onCancel}>{t('annulla')}</button>}</div>
    </div>
  );
}

const Stat = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) => <div className={`stat ${tone ?? ''}`}><span>{k}</span><b>{v}</b></div>;

// ---------------------------------------------------------------- Panoramica
function AvatarGrid({ value, onPick }: { value?: string; onPick: (id: string) => void }) {
  return (
    <div className="avatars" role="group" aria-label={t('Ritratti')}>
      {AVATARS.map(id => <button key={id} className={value === id ? 'on' : ''} onClick={() => onPick(id)} aria-label={t(id.slice(10).replace(/-/g, ' '))} title={t(id.slice(10).replace(/-/g, ' '))}><Art id={id} /></button>)}
    </div>
  );
}

/** Introduzione: ingresso, scelta del ritratto, arrivo in città con i consigli del consigliere. */
function Intro({ s, done, pick }: { s: GameState; done: () => void; pick: (id: string) => void }) {
  const [step, setStep] = useState(0);
  const d = def(s.capital);
  return (
    <div className="intro-bg">
      {step === 0 && <div className="intro-screen" style={{ backgroundImage: 'url(art/ingresso-login.jpg)' }}>
        <div className="intro-box">
          <div className="kicker">{t('‹ Dossier riservato ›')}</div>
          <img className="logo" src={logoUrl} alt="Racket King Online" />
          <p className="lead">{t('Una valigia di contanti, sei uomini e una cittadina americana che non sa ancora chi sei.')}</p>
          <button className="on" onClick={() => setStep(1)}>{t('Entra')}</button>
        </div>
      </div>}
      {step === 1 && <div className="intro-screen" style={{ backgroundImage: 'url(art/ingresso-personaggio.jpg)' }}>
        <div className="intro-box wide">
          <h2>{t('Chi sei')}</h2>
          <p className="lead small">{t('Il volto con cui ti conosceranno gli altri boss.')}</p>
          <AvatarGrid value={s.avatar} onPick={pick} />
          <button className="on" disabled={!s.avatar} onClick={() => setStep(2)}>{t('Questo sono io')}</button>
        </div>
      </div>}
      {step === 2 && <div className="intro-screen" style={{ backgroundImage: 'url(art/ingresso-arrivo.jpg)' }}>
        <div className="intro-box wide">
          <h2>{d.name}, {d.state}</h2>
          <p className="lead">{s.log.length ? logText(s.log[s.log.length - 1]) : ''}</p>
          <div className="advisor">
            <Art id="personaggio-consigliere" className="portrait" />
            <ul>
              <li>{t('Comincia dal pizzo e da un bar: il bar lava il contante sporco.')}</li>
              <li>{t("Tieni d'occhio il calore. Tre avvisi, poi arriva la retata.")}</li>
              <li>{t('Le bande vicine si fanno vive tra un giorno: tieni qualche uomo in casa.')}</li>
            </ul>
          </div>
          <button className="on" onClick={done}>{t('Al lavoro')}</button>
        </div>
      </div>}
    </div>
  );
}

function SeasonTag({ day }: { day: number }) {
  const cur = seasonAt(day);
  if (cur) return <div className="season on" title={t(cur.text)}>{t('★ {name} · ancora {n} g', { name: t(cur.name), n: cur.day + SEASON_LENGTH - (day % 360) })}</div>;
  const nx = nextSeason(day); if (!nx) return null;
  return <div className="season" title={t(nx.text)}>{t('Prossimo evento: {name} tra {n} g', { name: t(nx.name), n: nx.inDays })}</div>;
}

function Overview({ s, c, run }: P) {
  const r = rates(s); const d = def(c.id); const cr = r.cities[c.id]; const pr = cr.pressure; const T = thresholds(s);
  return (
    <div className="grid two">
      <section className="panel">
        <h2>{d.name} {c.id === s.capital && <span className="tag">{t('capitale')}</span>}</h2>
        <p className="lead">{t(d.desc)}</p>
        <div className="stats">
          <Stat k={t('Contea · stato')} v={`${d.county} County · ${d.state}`} />
          <Stat k={t('Fascia')} v={t('{tier} · {pop} abitanti', { tier: t(d.tier), pop: d.population })} />
          <Stat k={t('Polizia')} v={d.police > 1.05 ? t('Severa') : d.police < 0.95 ? t('Distratta') : t('Nella media')} />
          <Stat k={t('Corruttibilità')} v={d.corruptible > 1.05 ? t('Alta') : d.corruptible < 0.95 ? t('Bassa') : t('Normale')} />
          <Stat k={t("Gioco d'azzardo")} v={d.legalGambling ? t('Legale nello stato') : t('Illegale')} />
          <Stat k={t('Minaccia più vicina')} v={(() => { const th = nearestThreat(s, c.id); return t('{gang} da {city}', { gang: gangL(peekCity(s, th).gang.name), city: cityName(th) }); })()} />
          <Stat k={t('Rendita sporca · pulita')} v={`${short(cr.dirty)}/h · ${short(cr.clean)}/h`} />
        </div>
      </section>

      <section className="panel">
        <h2 className="with-ico"><Ico id="res-citta" size="md" />{t("L'impero")}</h2>
        <table className="market">
          <thead><tr><th>{t('Città')}</th><th>{t('Sporco/h')}</th><th>{t('Pulito/h')}</th><th>{t('Influenza')}</th><th>{t('Calore')}</th><th>{t('Uomini')}</th></tr></thead>
          <tbody>
            {owned(s).map(x => { const xr = r.cities[x.id]; return (
              <tr key={x.id}><td>{x.id === s.capital && <Ico id="res-capitale" size="xs" />}{cityName(x.id)}</td><td>{short(xr.dirty)}</td><td>{short(xr.clean)}</td><td>{Math.floor(x.influence)}</td><td className={x.heat >= T.retata ? 'down' : ''}>{Math.round(x.heat)}</td><td>{Object.values(x.units).reduce((a, n) => a + n, 0)}</td></tr>
            ); })}
          </tbody>
        </table>
        <div className="stats" style={{ marginTop: 10 }}>
          <Stat k={t('Città gestibili senza perdite')} v={t('{a} su {b}', { a: owned(s).length, b: cityLimit(s) })} tone={owned(s).length > cityLimit(s) ? 'neg' : ''} />
          <Stat k={t('Resa delle città')} v={`${Math.round(efficiency(s) * 100)}%`} tone={efficiency(s) < 1 ? 'neg' : efficiency(s) > 1 ? 'pos' : ''} />
          <Stat k={t("Soglia dell'indagine federale")} v={owned(s).length > 1 ? t('{n} (scende con ogni città)', { n: T.indagine }) : String(T.indagine)} />
        </div>
      </section>

      <Family s={s} run={run} />
      <Ranking s={s} />

      <section className="panel">
        <h2 className="with-ico"><Ico id="azione-lavaggio" size="md" />{t('Lavaggio')}</h2>
        <p className="lead">{t("Quota della rendita sporca di tutto l'impero da far passare dalle attività legali. Più lavi, meno contante resta esposto, ma paghi la commissione.")}</p>
        <div className="seg" role="group" aria-label={t('Quota da lavare')}>
          {[0, 0.25, 0.5, 0.75, 1].map(v => <button key={v} className={s.launderShare === v ? 'on' : ''} onClick={() => run({ t: 'launder', share: v })}>{v * 100}%</button>)}
        </div>
        <div className="stats">
          <Stat k={t('Capacità di lavaggio')} v={`${short(r.launderCap)}/h`} />
          <Stat k={t('In lavaggio ora')} v={`${short(r.laundering)}/h`} />
          <Stat k={t('Commissione')} v={`${Math.round(r.launderFee * 100)}%`} />
          <Stat k={t('Casseforti')} v={money(safeCap(s))} />
        </div>
        {r.launderCap === 0 && <p className="hint">{t('Non hai ancora attività legali: apri un bar o una lavanderia per iniziare a lavare.')}</p>}
      </section>

      <section className="panel">
        <h2 className="with-ico"><Ico id="azione-investimento" size="md" />{t('Investimenti')}</h2>
        <p className="lead">{t('Il contante pulito che non ti serve diventa immobili, appalti e quote societarie: tutte le rendite salgono, con rendimenti decrescenti, fino a +{pct}%. Quello che investi non torna indietro.', { pct: Math.round(K.investMax * 100) })}</p>
        <div className="seg" role="group" aria-label={t('Quanto investire')}>
          {[100_000, 1_000_000, 5_000_000].map(v => <button key={v} disabled={s.res.pulito < v} onClick={() => run({ t: 'invest', amount: v })}>{money(v)}</button>)}
          <button disabled={s.res.pulito < K.investMin} onClick={() => run({ t: 'invest', amount: Math.floor(s.res.pulito) })}>{t('Tutto')}</button>
        </div>
        <div className="stats">
          <Stat k={t('Investito finora')} v={money(s.investments ?? 0)} />
          <Stat k={t('Bonus sulle rendite')} v={`+${dec(investBonus(s) * 100, 1)}%`} tone={investBonus(s) > 0 ? 'pos' : ''} />
        </div>
      </section>

      <section className="panel">
        {s.vacation && <Art id="stato-vacanza" className="banner" />}
        <h2 className="with-ico"><Ico id="azione-vacanza" size="md" />{t('Assenze e difesa')}</h2>
        {s.vacation
          ? <p className="lead">{t('In vacanza fino al {when}: niente entrate, niente attacchi, cantieri e code fermi. Al rientro le bande hanno dodici ore prima di accorgersene.', { when: clock(s.vacation.until) })}</p>
          : <p className="lead">{t("Se sparisci per qualche giorno, metti l'impero in vacanza: si ferma tutto, anche gli attacchi. Al massimo {max} giorni l'anno, almeno {min} alla volta.", { max: K.vacationDaysPerYear, min: K.vacationMinDays })}</p>}
        {!s.vacation && <div className="seg" role="group" aria-label={t('Durata della vacanza')}>
          {[2, 3, 7, 14].map(dd => <button key={dd} disabled={dd > vacationDaysLeft(s)} onClick={() => run({ t: 'vacation', days: dd })}>{t('{n} giorni', { n: dd })}</button>)}
        </div>}
        <div className="stats"><Stat k={t('Giorni di vacanza rimasti')} v={t('{a} su {b}', { a: vacationDaysLeft(s), b: K.vacationDaysPerYear })} /></div>
        <p className="lead small"><Ico id="azione-postura" size="sm" />{t('Postura difensiva: quando gli informatori avvisano di un attacco, recluti da solo quanto serve a coprirlo, anche se non sei collegato.')}</p>
        <div className="seg" role="group" aria-label={t('Postura difensiva')}>
          {[0, 0.3, 0.5].map(v => <button key={v} className={(s.posture?.auto ? s.posture.share : 0) === v ? 'on' : ''} onClick={() => run({ t: 'posture', auto: v > 0, share: v || 0.3 })}>{v === 0 ? t('Spenta') : t('Fino al {pct}% dello sporco', { pct: v * 100 })}</button>)}
        </div>
      </section>

      <section className="panel">
        <h2 className="with-ico"><Ico id="res-calore" size="md" />{t('Calore a {city}', { city: d.name })}</h2>
        <HeatBar s={s} heat={c.heat} target={cr.heatTarget} />
        <p className="lead small">{t('Soglie: sopra {route} si accende la seconda ronda · {bust} retate · {fed} indagine federale. Retate e indagini arrivano dopo tre avvisi nei rapporti.', { route: K.highRouteHeat, bust: T.retata, fed: T.indagine })}</p>
        <div className="stats">
          <Stat k={t('Racket')} v={`+${dec(pr.racket, 1)}`} tone="neg" />
          {c.id === s.capital && <Stat k={t('Contante esposto (nella capitale)')} v={`+${dec(pr.exposed, 1)}`} tone="neg" />}
          <Stat k={t('Criminali a guardia dei front')} v={`+${dec(pr.guards, 1)}`} tone="neg" />
          <Stat k={t('Sparatorie recenti')} v={`+${dec(pr.spike, 1)}`} tone="neg" />
          <Stat k={t('Poliziotti a libro paga')} v={`−${dec(pr.libroPaga, 1)}`} tone="pos" />
          <Stat k={t('Copertura dei front')} v={`−${dec(pr.cover, 1)}`} tone="pos" />
          <Stat k={t('Avvocati')} v={`−${dec(pr.avvocati, 1)}`} tone="pos" />
          {pr.effects !== 0 && <Stat k={t('Favori politici')} v={dec(pr.effects, 1)} tone="pos" />}
          <Stat k={t('Pressione totale')} v={dec(pr.total, 1)} />
        </div>
      </section>

      <section className="panel wide">
        <h2 className="with-ico"><Ico id="stato-coda" size="md" />{t('In corso')}</h2>
        <Ongoing s={s} />
        <h3 className="sub">{t('Ultimi rapporti')}</h3>

        <LogList s={s} n={6} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- online: famiglia e classifica
function Family({ s }: { s: GameState; run: (a: Action) => void }) {
  const net = useNet(); const me = net?.me; if (!net || !me) return null;
  const now = s.time;
  const shield = Math.max(me.shieldUntil, me.newbieUntil);
  return (
    <section className="panel">
      <h2 className="with-ico"><Ico id="mappa-banda" size="md" />{t('La famiglia')}</h2>
      {me.lord ? <>
        <p className="lead">{tj('Rispondi a {name}: gli versi il {pct}% della rendita sporca.', { name: <b>{me.lord.name}</b>, pct: Math.round(me.tribute * 100) })}</p>
        <div className="stats">
          {me.independenceAt && <Stat k={t('Libero senza pagare')} v={t('tra {d}, se non perdi città', { d: duration(Math.max(0, me.independenceAt - now)) })} />}
          {me.ransomCost !== null && <Stat k={t('Riscatto')} v={money(me.ransomCost) + ' ' + t('puliti')} />}
        </div>
        <button disabled={(me.ransomAt ?? 0) > now || s.res.pulito < (me.ransomCost ?? Infinity)} onClick={() => { void net.act({ t: 'ransom' }); }}>
          {(me.ransomAt ?? 0) > now ? t('Riscatto possibile tra {d}', { d: duration((me.ransomAt ?? 0) - now) }) : t('Paga il riscatto')}
        </button>
      </> : <p className="lead">{t('Sei un boss libero: non rispondi a nessuno.')}</p>}
      {me.vassals.length > 0 && <>
        <h3 className="sub">{t('I tuoi uomini')}</h3>
        {me.vassals.map(v => <div key={v.id} className="qline"><Ico id="crew-picchiatori" size="xs" />{v.name} <span className="muted">· {t('ti versa il {pct}% della rendita sporca', { pct: Math.round(me.tribute * 100) })}</span></div>)}
      </>}
      <p className="hint">{shield > now
        ? t('Sei protetto per altre {d}: gli altri boss non possono attaccarti.', { d: duration(shield - now) })
        : t('Chi prende il QG della tua capitale ti mette nella sua famiglia: le altre città invece si perdono. Gli altri boss non possono colpire chi è molto più debole di loro.')}</p>
    </section>
  );
}
function Ranking({ s }: { s: GameState }) {
  const net = useNet(); const w = net?.world; if (!net || !w) return null;
  const myId = net.me?.id;
  return (
    <section className="panel">
      <h2 className="with-ico"><Ico id="res-punteggio" size="md" />{t('Classifica')}</h2>
      <table className="market">
        <thead><tr><th>#</th><th>{t('Boss')}</th><th>{t('Città')}</th><th>{t('Punti')}</th><th>{t('Famiglia')}</th></tr></thead>
        <tbody>{w.ranking.slice(0, 20).map((x, i) => (
          <tr key={x.id} className={x.id === myId ? 'me' : ''}><td>{i + 1}</td><td>{x.name}</td><td>{x.cities}</td><td>{fmt(x.score)}</td>
            <td className="muted">{x.lord !== null ? t('di {name}', { name: w.names[x.lord] ?? '?' }) : x.vassals.length ? t('{n} uomini', { n: x.vassals.length }) : ''}</td></tr>
        ))}</tbody>
      </table>
      <p className="hint">{t('{n} boss nel mondo, {o} collegati adesso. Giorno {d} del server.', { n: w.players, o: w.online, d: Math.floor(s.time / 86400) + 1 })}</p>
    </section>
  );
}

function Ongoing({ s }: { s: GameState }) {
  const lines: React.ReactNode[] = [];
  for (const x of owned(s)) {
    if (x.buildQueue) lines.push(<Progress key={'b' + x.id} s={s} start={x.buildQueue.start} end={x.buildQueue.end} label={`${cityName(x.id)}: ${t(nameOf(x.buildQueue.kind, x.buildQueue.id))} → ${x.buildQueue.level}`} />);
    x.unitQueue.forEach((j, i) => lines.push(<div key={'u' + x.id + i} className="qline"><Ico id={`crew-${j.id}`} size="xs" />{t('{city}: reclutamento {done}/{n} {unit}', { city: cityName(x.id), done: j.done, n: j.n, unit: t(UNITS.find(u => u.id === j.id)!.name).toLowerCase() })}</div>));
  }
  if (s.researchQueue) lines.push(<Progress key="r" s={s} start={s.researchQueue.start} end={s.researchQueue.end} label={t('Know-how: {name} → {n}', { name: t(RESEARCH.find(x => x.id === s.researchQueue!.id)!.name), n: s.researchQueue.level })} />);
  for (const m of s.missions) lines.push(<div key={'m' + m.id} className="qline"><Ico id={m.resolved ? 'missione-rientro' : MISSION_ICON[m.kind]} size="xs" />{t(MISSION_LABEL[m.kind])} {cityName(m.from)} → {cityName(m.to)}: {squadText(m.units)} · {m.resolved ? t('rientro tra {d}', { d: duration(m.returnAt - s.time) }) : t('arrivo tra {d}', { d: duration(m.arriveAt - s.time) })}</div>);
  return lines.length ? <>{lines}</> : <p className="muted">{t('Nessun lavoro in corso. Il tempo è denaro.')}</p>;
}
const MISSION_LABEL: Record<MissionKind, string> = { raid: 'Colpo alla cassa', spy: 'Spionaggio', assault: 'Assalto', transfer: 'Trasferimento', strike: 'Colpo a un edificio' };

function Research({ s, run }: P) {
  return (
    <>
      <p className="intro">{t("Il know-how vale per tutto l'impero. Gestione alza il numero di città che puoi seguire senza perdite.")}</p>
      <div className="grid cards">
        {RESEARCH.map(d => {
          const L = s.research[d.id]; const cost = researchCost(d.id, L + 1); const q = s.researchQueue;
          const miss = missing(s, null, d.req);
          return (
            <Card key={d.id} title={t(d.name)} level={L} desc={t(d.desc)} locked={miss} art={`knowhow-${d.id}`} icon={`knowhow-${d.id}`}>
              {q && q.id === d.id
                ? <Progress s={s} start={q.start} end={q.end} label={t('Livello {n}', { n: q.level })} onCancel={() => run({ t: 'cancel', queue: 'research' })} />
                : <div className="upg">
                    <div><CostLine cost={cost} s={s} /> <span className="muted">· {duration(researchHours(s, cost) * 3600)}</span></div>
                    <button disabled={!!q || !canAfford(s, cost)} onClick={() => run({ t: 'research', id: d.id })}>{t('Impara il livello {n}', { n: L + 1 })}</button>
                  </div>}
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Crew
function Crew({ s, c, run }: P) {
  const [n, setN] = useState<Partial<Record<UnitId, number>>>({});
  const guardable = UNITS.filter(u => u.branch === 'criminale' && u.def > 0 && u.carry <= 300);
  return (
    <>
      <p className="intro">{tj("Uomini di stanza a {city}. Per spostarli in un'altra tua città usa la Mappa.", { city: <b>{cityName(c.id)}</b> })}</p>
      <div className="grid cards">
        {UNITS.map(u => {
          const miss = missing(s, c, u.req); const k = n[u.id] ?? 1;
          const cost: Cost = { sporco: u.cost.sporco ? u.cost.sporco * k : undefined, pulito: u.cost.pulito ? u.cost.pulito * k : undefined };
          return (
            <Card key={u.id} title={t(u.name)} desc={t(u.desc)} locked={miss} art={`crew-${u.id}`} icon={`crew-${u.id}`}>
              <div className="stats">
                <Stat k={t('Disponibili qui')} v={fmt(c.units[u.id])} />
                {(c.guards[u.id] ?? 0) > 0 && <Stat k={t('A guardia dei front')} v={fmt(c.guards[u.id] ?? 0)} />}
                {u.att > 0 && <Stat k={t('Attacco')} v={u.att} />}
                {u.def > 0 && <Stat k={t('Difesa')} v={u.def} />}
                {u.carry > 300 && <Stat k={t('Trasporto')} v={money(u.carry)} />}
                <Stat k={t('Stipendio')} v={u.upkeep.sporco ? t('{m}/h sporchi', { m: money(u.upkeep.sporco) }) : t('{m}/h puliti', { m: money(u.upkeep.pulito ?? 0) })} />
              </div>
              <div className="upg">
                <div><input type="number" min={1} value={k} onChange={e => setN({ ...n, [u.id]: Math.max(1, Number(e.target.value) || 1) })} aria-label={t('Quanti {unit}', { unit: t(u.name) })} /> <CostLine cost={cost} s={s} /> <span className="muted">· {t('{d} ciascuno', { d: duration(unitHours(c, u.id) * 3600) })}</span></div>
                <button disabled={!canAfford(s, cost)} onClick={() => run({ t: 'recruit', city: c.id, id: u.id, n: k })}>{t('Recluta')}</button>
              </div>
            </Card>
          );
        })}
      </div>
      <section className="panel">
        <h2 className="with-ico"><Ico id="missione-difesa" size="md" />{t('Protezione delle attività legali')}</h2>
        <p className="lead">{t('I criminali a guardia dei front respingono i sabotaggi, ma ogni uomo aggiunge calore e, in caso di indagine, rende i front sequestrabili. Le guardie giurate proteggono senza calore, ma valgono meno.')}</p>
        <div className="guards">
          {guardable.map(u => (
            <label key={u.id}>{t(u.name)}: <input type="number" min={0} value={c.guards[u.id] ?? 0} onChange={e => run({ t: 'guard', city: c.id, id: u.id, n: Number(e.target.value) || 0 })} /> <span className="muted">{t('({n} liberi)', { n: c.units[u.id] })}</span></label>
          ))}
          <span>{t('Guardie giurate:')} <b>{fmt(c.units.guardie)}</b></span>

        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Mappa
function MapTab({ s, c, run }: P) {
  const [target, setTarget] = useState<string>(c.id);
  const [from, setFrom] = useState<string>(c.id);
  const [sq, setSq] = useState<Squad>({});
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [look, setLook] = useState(false);
  const [lotSel, setLotSel] = useState<number | null>(null);
  const [lastTarget, setLastTarget] = useState(target);
  if (lastTarget !== target) { setLastTarget(target); setLook(false); setLotSel(null); }
  const origin = s.cities[from]?.owner === 'player' ? s.cities[from] : c;
  const tc = peekCity(s, target);
  const td = def(tc.id);
  const isNpc = tc.owner === 'npc';
  const intel = tc.gang.intel;
  const myAtt = power(s, sq, 'att');
  const carryCap = Object.entries(sq).reduce((a, [id, k]) => a + UNITS.find(u => u.id === id)!.carry * (k ?? 0), 0);
  const same = origin.id === tc.id;
  const travel = (same ? 0.5 * K.travelHours : travelHours(s, origin.id, tc.id)) * 3600;
  const need = influenceNeeded(s, tc.id);
  const blocked = need > origin.influence;
  const send = (kind: MissionKind, units: Squad, lot?: number) => { run({ t: 'mission', kind, from: origin.id, to: tc.id, units, lot }); setSq({}); };
  const seenLots = intel?.lots; const quality: Look = intel?.quality ?? 'partial'; const qgKnown = !!intel?.qgKnown;
  const tL = layout(tc.id);
  const seen = lotSel !== null && seenLots ? seenLots[lotSel] : null;
  const seenHidden = !!seen && quality === 'partial' && (seen.kind === 'racket' || (seen.kind === 'building' && (seen.id === 'qg' || seen.id === 'cassaforte') && !qgKnown));
  const seenIsQg = !!seen && !seenHidden && seen.kind === 'building' && seen.id === 'qg';
  const realLot = lotSel !== null ? tc.lots[lotSel] : null;
  const protectedNow = (realLot?.protectedUntil ?? 0) > s.time;
  const acq = acquireCost(tc);
  const fighters = UNITS.filter(u => u.branch === 'criminale' && u.id !== 'informatori');
  const mine = owned(s);
  const ownedSet = new Set(mine.map(x => x.id));
  const net = useNet();
  const rivals = new Set(net?.world ? Object.entries(net.world.owners).filter(([, o]) => o !== net.me?.id).map(([id]) => id) : []);
  const known = new Set(Object.values(s.cities).filter(x => x.owner === 'npc' && !rivals.has(x.id)).map(x => x.id));
  const rival = net?.ownerName(tc.id) ?? null;
  const heldStates = new Set(mine.map(x => def(x.id).stateIdx));
  const results = searchCities(q);
  const go = (id: string) => { setTarget(id); setFocus({ id, n: Date.now() }); setQ(''); if (net && rivals.has(id)) void net.act({ t: 'look', city: id }); };
  const countyIds = CITIES_BY_COUNTY[td.countyIdx], stateIds = CITIES_BY_STATE[td.stateIdx];
  const mineIn = (ids: number[]) => ids.filter(i => ownedSet.has(String(i))).length;
  const mm = s.missions.map(m => {
    const tt = Math.max(1, m.returnAt - m.arriveAt);
    const p = m.resolved ? 1 - (s.time - m.arriveAt) / tt : (s.time - (m.arriveAt - tt)) / tt;
    return { from: m.from, to: m.to, kind: m.kind, p: Math.min(1, Math.max(0, p)) };
  });

  return (
    <div className="mapwrap">
      <section className="panel map">
        <div className="maphead">
          <div className="search">
            <input type="search" placeholder={t('Cerca una città…')} value={q} onChange={e => setQ(e.target.value)} aria-label={t('Cerca una città')} />
            {results.length > 0 && (
              <ul className="results">
                {results.map(i => { const d = def(String(i)); return <li key={i}><button onClick={() => go(String(i))}>{d.name} <span className="muted">· {d.county} County, {d.stateAbbr} · {t(d.tier)}</span></button></li>; })}
              </ul>
            )}
          </div>
          <button onClick={() => go(s.capital)}>{t('★ Vai alla capitale')}</button>
        </div>
        {look && seenLots ? (
          <>
            <div className="cityhead"><div><b>{td.name}</b> <span className="muted">· {quality === 'complete' ? t('vista dal rapporto completo di {d} fa', { d: duration(s.time - intel!.at) }) : t('vista dal rapporto parziale di {d} fa', { d: duration(s.time - intel!.at) })}</span></div><button onClick={() => { setLook(false); setLotSel(null); }}>{t('Torna alla mappa')}</button></div>
            <City3D cityId={tc.id} lots={seenLots} building={null} heat={0} look={quality} qgKnown={qgKnown} now={s.time}
              turf={{ tiles: {}, gang: [...gangBlocks(tc)], routeMain: tL.routeMain, routeHigh: tL.routeHigh, highActive: false }}
              selected={lotSel !== null ? tL.lotBlocks[lotSel] : null} onSelect={(bi) => { const b = bi !== null ? tL.blocks[bi] : null; setLotSel(b && b.lot !== undefined && !b.extra ? b.lot : null); }} />
            <p className="hint">{quality === 'complete' ? t('Rapporto completo: vedi tutto, il QG ha il tetto rosso e la cassaforte quello verde.') : qgKnown ? t('Rapporto parziale, ma il QG è venuto allo scoperto.') : t('Rapporto parziale: i racket, il QG e la cassaforte sembrano palazzi qualunque. Un assalto su un palazzo sconosciuto è alla cieca.')} {t('Clicca un lotto per sceglierlo come bersaglio.')}</p>
          </>
        ) : <MapCanvas owned={ownedSet} known={known} rivals={rivals} capital={s.capital} selected={target} heldStates={heldStates} missions={mm} focus={focus} onSelect={id => { setTarget(id); if (net && rivals.has(id)) void net.act({ t: 'look', city: id }); }} />}
      </section>

      <section className="panel side">
        {isNpc && !rival && <Art id={bossArt(tc.id)} className="face big right" />}
        <h2>{td.name}</h2>
        <p className="lead small">{td.county} County · {td.state} · {t(td.tier)} · {t('{n} abitanti', { n: td.population })}</p>
        <p className="lead small">{t(td.desc)}</p>
        {rival && tc.proxy === undefined && <p className="req">{t('Per ora non puoi colpire {name}: è nuovo, in vacanza, ha appena perso una città, è della tua famiglia o è troppo debole per te.', { name: rival })}</p>}
        <div className="stats">
          <Stat k={t('Controllo')} v={rival ? t('Il boss {name}', { name: rival }) : isNpc ? capitalize(gangL(tc.gang.name)) : tc.id === s.capital ? t('Tua (capitale)') : t('Tua')} />
          {isNpc && <Stat k={t('Presa della banda')} v={`${Math.round(tc.gang.share * 100)}%`} />}
          {intel ? <>
            <Stat k={t('Uomini (rapporto di {d} fa)', { d: duration(s.time - intel.at) })} v={squadText(intel.units)} />
            <Stat k={t('Difesa del QG (assalto)')} v={fmt(intel.defense)} />
            <Stat k={t('Rapporto')} v={intel.quality === 'complete' ? t('completo') : intel.qgKnown ? t('parziale, QG scoperto') : t('parziale')} />
            {isNpc && <Stat k={t('Difesa in un colpo')} v={fmt(power(null, intel.units, 'def') + 20)} />}
            <Stat k={t('In cassa')} v={money(intel.stash)} />
          </> : <Stat k={t('Informazioni')} v={t('nessuna: manda gli informatori')} />}
          <Stat k={t('Tue nella contea')} v={t('{a} su {b} città', { a: mineIn(countyIds), b: countyIds.length })} />
          <Stat k={t('Tue nello stato')} v={t('{a} su {b} città', { a: mineIn(stateIds), b: stateIds.length })} />
          {!same && <Stat k={t('Viaggio da {city}', { city: cityName(origin.id) })} v={duration(travel)} />}
          {need > 0 && <Stat k={t('Influenza per operare in {st}', { st: td.stateAbbr })} v={t('{need} ({city} ne ha {n})', { need, city: cityName(origin.id), n: Math.floor(origin.influence) })} tone={blocked ? 'neg' : 'pos'} />}
          {isNpc && <Stat k={t('Erediterebbe da {city}', { city: cityName(origin.id) })} v={t('{i} influenza, {h} calore', { i: Math.round(origin.influence * (def(origin.id).stateAbbr === td.stateAbbr ? K.inheritSameState : K.inheritOtherState)), h: Math.round(origin.heat * (def(origin.id).stateAbbr === td.stateAbbr ? K.inheritSameState : K.inheritOtherState)) })} />}
        </div>
        {need > 0 && <p className="hint">{t('Non hai ancora città in {state}. Per colpire, assaltare o comprare qui serve almeno {need} di influenza nella città da cui parti: non la spendi, ma devi averla. La soglia sale con ogni stato in cui entri.', { state: td.state, need })}</p>}

        <h3 className="sub">{t('Parti da')}</h3>
        <div className="seg">
          {mine.map(x => <button key={x.id} className={x.id === origin.id ? 'on' : ''} onClick={() => { setFrom(x.id); setSq({}); }}>{cityName(x.id)}</button>)}
        </div>
        <div className="squad">
          {[...fighters, UNITS.find(u => u.id === 'informatori')!].map(u => (
            <label key={u.id}><Ico id={`crew-${u.id}`} size="xs" />{t(u.name)} <input type="number" min={0} max={origin.units[u.id]} value={sq[u.id] ?? 0} onChange={e => setSq({ ...sq, [u.id]: Math.min(origin.units[u.id], Math.max(0, Number(e.target.value) || 0)) })} /> <span className="muted">/ {origin.units[u.id]}</span></label>
          ))}
        </div>
        <div className="stats">
          <Stat k={t("Forza d'attacco")} v={fmt(myAtt)} tone={intel ? (myAtt > intel.defense * 1.15 ? 'pos' : myAtt < intel.defense * 0.85 ? 'neg' : '') : ''} />
          <Stat k={t('Capacità di trasporto')} v={money(carryCap)} />
        </div>
        {myAtt > 0 && (!intel ? <p className="req">{t('Non hai un rapporto recente su questa banda: attacchi alla cieca. Manda prima gli informatori.')}</p>
          : myAtt < (isNpc ? intel.defense : gangDefense(tc)) * 1.2 ? <p className="req">{t("Con {att} di attacco contro {def} di difesa rischi di perdere: per stare tranquillo servono almeno {safe}. (Il colpo affronta solo gli uomini, l'assalto anche le fortificazioni.)", { att: myAtt, def: isNpc ? intel.defense : gangDefense(tc), safe: (isNpc ? intel.defense : gangDefense(tc)) * 1.2 })}</p> : null)}
        {isNpc && look && lotSel !== null && (
          <div className="target">
            <h3 className="sub">{t('Bersaglio')}</h3>
            {seen ? <>
              <b>{seenHidden ? t('Un palazzo qualunque') : `${capitalize(t(nameOf(seen.kind, seen.id)))} · ${t('liv. {n}', { n: seen.level })}`}</b>
              <div className="muted small">{t(ZONE_LABEL[lotZone(tc.id, lotSel)])}{(seen.closedUntil ?? 0) > s.time ? ' · ' + t('chiuso nel rapporto') : ''}{protectedNow ? ' · ' + t('appena colpito: protetto per ora') : ''}</div>
            </> : <div className="muted">{t('Lotto vuoto.')}</div>}
            <div className="actions">
              {seen && !seenHidden && !seenIsQg && <button disabled={myAtt <= 0 || blocked || protectedNow} onClick={() => send('strike', sq, lotSel)}><Ico id="missione-colpo" size="xs" />{t("Colpisci l'edificio")}</button>}
              {seen && (seenIsQg || seenHidden) && <button className="strong" disabled={myAtt <= 0 || blocked} onClick={() => send('assault', sq, lotSel)}><Ico id="missione-assalto" size="xs" />{seenIsQg ? t('Assalta il QG') : t('Assalto alla cieca qui')}</button>}
            </div>
            <p className="hint">{seenIsQg ? t('Il QG ha {def} di difesa con le fortificazioni. Se vinci, la città è tua.', { def: intel!.defense }) : seenHidden ? t("Potrebbe essere il QG, la cassaforte o un racket. Se non è il QG, chiudi l'edificio ma la banda va in allerta.") : t("Un colpo affronta solo gli uomini (circa {def} nel rapporto). Se vinci, l'edificio resta chiuso {min}–{max} ore.", { def: power(null, intel!.units, 'def') + 20, min: K.closeMin, max: K.closeMax })}</p>
          </div>
        )}
        <div className="actions">
          {isNpc && <button disabled={!(sq.informatori ?? 0)} onClick={() => send('spy', { informatori: sq.informatori })} title={t('Solo gli informatori selezionati')}><Ico id="missione-spia" size="xs" />{t('Spia')}</button>}
          {isNpc && seenLots && !look && <button onClick={() => setLook(true)}><Ico id="mappa-spiata" size="xs" />{t('Guarda la città')}</button>}
          {isNpc && <button disabled={myAtt <= 0 || blocked} onClick={() => send('raid', sq)} title={t('Rubi metà della cassa e riduci la presa della banda')}><Ico id="missione-razzia" size="xs" />{t('Colpo alla cassa')}</button>}
          {isNpc && !look && <button className="strong" disabled={myAtt <= 0 || blocked} onClick={() => send('assault', sq, qgKnown ? whereIs(tc, 'qg')?.lot : undefined)} title={t('Se prendi il QG, la città è tua')}><Ico id="missione-assalto" size="xs" />{qgKnown ? t('Assalta il QG') : t('Assalto alla cieca')}</button>}
          {!isNpc && !same && <button disabled={!Object.values(sq).some(v => (v ?? 0) > 0)} onClick={() => send('transfer', sq)}><Ico id="missione-trasferimento" size="xs" />{t('Trasferisci')}</button>}
        </div>
        <p className="hint">{t('Per conquistare devi prendere il loro quartier generale. Spia per sapere dov\'è (serve un rapporto completo), poi apri la città con "Guarda la città" e scegli il bersaglio. Colpo alla cassa: rubi metà dei loro soldi. Colpo a un edificio: lo chiudi per qualche ora e la loro presa scende.')}</p>

        {isNpc && (
          <div className="pol">
            <Ico id="res-citta" size="md" />
            <div><b>{t('Acquisizione')}</b><div className="muted small">{t('Compri la città senza sparare, quando la banda è sotto il {pct}% di presa. Nessun calore. Paga {city}.', { pct: K.acquireMaxShare * 100, city: cityName(origin.id) })}</div></div>
            <div className="pol-act"><CostLine cost={acq} s={s} c={origin} /><button disabled={tc.gang.share > K.acquireMaxShare || !canAfford(s, acq, origin) || origin.influence < need + K.acquireInfluenza} onClick={() => run({ t: 'acquire', from: origin.id, city: tc.id })}>{t('Compra')}</button></div>
          </div>
        )}
        {isNpc && <><div className="pol">
          <Ico id="polizia-soffiata" size="md" />
          <div><b>{t('Soffiata sulla banda')}</b><div className="muted small">{t('Dalla centrale di {from}: la polizia arresta un quarto della banda di {city}; la loro presa −5%.', { from: cityName(origin.id), city: td.name })}</div></div>
          <div className="pol-act"><CostLine cost={{ influenza: 40 }} s={s} c={origin} /><button disabled={origin.influence < 40} onClick={() => run({ t: 'police', city: origin.id, id: 'soffiata', target: tc.id })}>{t('Fai')}</button></div>
        </div></>}
      </section>

      <section className="panel wide">
        <h2 className="with-ico"><Ico id="mappa-viaggio" size="md" />{t('Movimenti')}</h2>
        <Ongoing s={s} />
        <p className="hint">{statesHeld(s).size === 1 ? t('Sei presente in {n} stato su {tot}.', { n: 1, tot: STATES.length }) : t('Sei presente in {n} stati su {tot}.', { n: statesHeld(s).size, tot: STATES.length })} {t("Più tempo passa, più le bande si rafforzano. Ogni città in più abbassa la soglia dell'indagine federale e, oltre il tuo limite di gestione, la resa di tutte le città.")}</p>

      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Città (vista 3D e lotti)
const CATEGORY_TABS: { kind: UseKind; label: string }[] = [{ kind: 'racket', label: 'Racket' }, { kind: 'front', label: 'Attività legali' }, { kind: 'building', label: 'Strutture' }]; // etichette tradotte con t()

function CityTab({ s, c, run }: P) {
  const [sel, setSel] = useState<number | null>(null);
  const [cityOf, setCityOf] = useState(c.id);
  if (cityOf !== c.id) { setCityOf(c.id); setSel(null); }
  const L = layout(c.id);
  const b = sel !== null ? L.blocks[sel] : null;
  const onSelect = useCallback((i: number | null) => setSel(i), []);
  const gang = gangBlocks(c); const mayor = isMayorOf(s, c.id);
  const tiles: TurfView['tiles'] = {};
  for (const k of new Set([...Object.keys(c.turf), ...Object.keys(c.protect)])) { const b = Number(k); tiles[k] = { giri: giriOn(c, b), protect: c.protect[k] ?? 0, level: tileRisk(c, b).level }; }
  const turf: TurfView = { tiles, gang: [...gang], routeMain: L.routeMain, routeHigh: L.routeHigh, highActive: activeRoutes(c).length > L.routeMain.length };
  return (
    <div className="citywrap">
      <section className="panel cityview">
        <div className="cityhead">
          <div><b>{cityName(c.id)}</b> <span className="muted">· {t(def(c.id).tier)} · {t('{free} lotti liberi su {n}', { free: freeLots(c, s).length, n: usableLots(s, c) })}{mayor ? ' · ' + t('sei il sindaco') : ''}</span></div>
          <div className="legend2"><span><i className="sw gold" />{t('tuo')}</span><span><i className="sw qg" />{t('QG')}</span><span><i className="sw safe" />{t('Cassaforte')}</span><span><i className="sw dash" />{t('lotto libero')}</span><span><i className="sw blue" />{t('polizia e ronde')}</span><span><i className="sw risk" />{t('rischio controlli')}</span></div>
        </div>
        <City3D cityId={c.id} lots={c.lots} building={c.buildQueue?.lot ?? null} heat={Math.round(c.heat)} turf={turf} selected={sel} onSelect={onSelect} mayor={mayor} now={s.time} />
        <p className="hint">{t("Trascina per spostarti, rotellina per lo zoom, tasto destro per ruotare. Clicca un lotto, un isolato, la centrale di polizia o il municipio. I dischi colorati sono i tuoi giri; il bordo dell'isolato va dal verde al rosso con il rischio di controlli; le strisce blu sono le ronde.")}</p>
      </section>
      <section className="panel side">
        {!b && <CitySummary s={s} c={c} run={run} />}
        {(b?.kind === 'lot' || (b?.extra && mayor)) && <LotPanel s={s} c={c} run={run} lot={b!.lot!} />}
        {b?.kind === 'police' && <PolicePanel s={s} c={c} run={run} />}
        {b?.kind === 'mayor' && <MayorPanel s={s} c={c} run={run} />}
        {b?.kind === 'civic' && !(b.extra && mayor) && <BlockPanel s={s} c={c} run={run} block={sel!} gang={gang.has(sel!)} />}
      </section>
    </div>
  );
}

function CitySummary({ s, c, run }: P) {
  const cr = cityRates(s, c); const d = def(c.id);
  const zones = new Map<string, number>(); layout(c.id).lots.forEach((_, i) => { const z = lotZone(c.id, i); zones.set(z, (zones.get(z) ?? 0) + 1); });
  return (
    <>
      <h2>{d.name}</h2>
      <p className="lead small">{d.county} County · {d.state} · {t('{n} abitanti', { n: d.population })}</p>
      <div className="stats">
        <Stat k={t('Rendita sporca')} v={`${short(cr.dirty)}/h`} tone="dirty" />
        <Stat k={t('Reddito pulito')} v={`${short(cr.clean)}/h`} tone="clean" />
        <Stat k={t('Influenza')} v={`${Math.floor(c.influence)} / ${K.influenceCap} (+${dec(cr.influence, 2)}/h)`} />
        <Stat k={t('Calore')} v={`${Math.round(c.heat)} → ${Math.round(cr.heatTarget)}`} />
        <Stat k={t('Lotti')} v={t('{used} usati, {free} liberi', { used: c.lots.filter(Boolean).length, free: freeLots(c, s).length })} />
      </div>
      {c.move && <Progress s={s} start={c.move.end - K.moveHours * 3600} end={c.move.end} label={c.move.id === 'qg' ? t('Trasloco del QG') : t('Trasloco della cassaforte')} />}
      {c.campaign && <Progress s={s} start={c.campaign.ends - K.campaignHours * 3600} end={c.campaign.ends} label={t('Campagna elettorale')} />}
      {isMayorOf(s, c.id) && <p className="advice">{t('Sei il sindaco: mandato fino a {when}.', { when: clock(s.mayor!.termEnds) })}</p>}
      <h3 className="sub">{t('Giri sugli isolati')}</h3>
      <TurfSummary s={s} c={c} run={run} />
      <h3 className="sub">{t('Quartieri')}</h3>
      {[...zones].map(([z, n]) => <div key={z} className="zone"><Ico id={ZONE_ICON[z]} size="sm" /><b>{t(ZONE_LABEL[z as Zone])}</b> <span className="muted">· {t('{n} lotti', { n })}</span><div className="muted small">{t(ZONE_DESC[z as Zone])}</div></div>)}
      <p className="hint">{t("Un racket accanto alla centrale di polizia fa il {pct}% di calore in più. Un'attività legale accanto al racket che potenzia dà più sinergia.", { pct: Math.round((K.policeAdjHeat - 1) * 100) })}</p>
    </>
  );
}

function TurfSummary({ c, run }: P) {
  const pr = presidioOf(c);
  const rs = RACKETS.filter(r => racketLevel(c, r.id) > 0);
  return (
    <>
      {rs.length ? <div className="stats">{rs.map(r => <Stat key={r.id} k={<><Ico id={`racket-${r.id}`} size="xs" />{t(r.name)}</> as unknown as string} v={t('{a} / {b} giri', { a: giriPlaced(c, r.id), b: giriTotal(c, r.id) })} tone={giriPlaced(c, r.id) < giriTotal(c, r.id) ? 'neg' : ''} />)}</div> : <p className="muted small">{t('Nessun racket aperto.')}</p>}
      <div className="stats">
        <Stat k={t('Presidio')} v={t('{men} uomini per {slots} posti ({pct}%)', { men: pr.avail, slots: pr.required, pct: Math.round(pr.coverage * 100) })} tone={pr.coverage < 1 ? 'neg' : 'pos'} />
        <Stat k={t('Punti protezione (libro paga)')} v={t('{a} / {b} usati', { a: protectUsed(c), b: c.payroll })} />
      </div>
      {pr.coverage < 1 && <p className="req">{t('Il presidio è scoperto: i giri rendono il {pct}%. Servono {n} uomini (picchiatori, soldati o enforcer) per ogni isolato occupato.', { pct: Math.round(pr.coverage * 100), n: K.presidioPerBlock })}</p>}
      <p className="hint">{t('Ogni {n} livelli di racket hai un giro da piazzare su un isolato: clicca un isolato per spostarli. Ammucchiare fa risparmiare presidio, ma con le ronde vicine rischi controlli.', { n: K.levelsPerGiro })}</p>
      <button className="ghost" onClick={() => run({ t: 'autoTurf', city: c.id })}>{t('Risistema i giri automaticamente')}</button>
    </>
  );
}
const presidioOf = (c: CityState) => cityRatesPresidio(c);
const RISK_LABEL = ['nullo', 'basso', 'attenzione', 'medio', 'alto'];

function BlockPanel({ c, run, block, gang }: P & { block: number; gang: boolean }) {
  const L = layout(c.id); const b = L.blocks[block];
  const giri = giriOn(c, block); const risk = tileRisk(c, block);
  const rs = RACKETS.filter(r => racketLevel(c, r.id) > 0);
  if (b.extra) return <><h2>{t(DECO_LABEL[b.deco!])}</h2><p className="lead small">{t('Questo isolato accanto al municipio diventa un lotto edificabile quando sei il sindaco della città.')}</p></>;
  if (!L.turf.includes(block)) return <p className="muted">{t('Questo isolato non si usa.')}</p>;
  return (
    <>
      <h2>{t(DECO_LABEL[b.deco!])}</h2>
      <p className="lead small">{tj('{zone} · abitazioni e uffici dei cittadini: qui lavorano i tuoi giri.', { zone: <b>{t(ZONE_LABEL[b.zone])}</b> })}</p>
      {gang ? <p className="req">{t('Questo isolato è controllato da {gang}. Colpisci la banda (Mappa → questa città → Colpo) o fai una soffiata per liberarlo.', { gang: gangL(c.gang.name) })}</p> : <>
        <div className="stats">
          <Stat k={t('Giri qui')} v={`${giri.length} / ${K.maxGiriPerBlock}`} />
          <Stat k={t('Strade con ronda intorno')} v={risk.exposure} />
          <Stat k={t("Grado di calore dell'isolato")} v={c.protect[block] ? t('{g} (protezioni −{p})', { g: risk.grade, p: c.protect[block] }) : String(risk.grade)} />
          <Stat k={t('Rischio controlli')} v={t(RISK_LABEL[risk.level])} tone={risk.level >= 3 ? 'neg' : risk.level ? 'pos' : ''} />
        </div>
        <h3 className="sub">{t('Giri')}</h3>
        {rs.length === 0 && <p className="muted small">{t('Apri un racket su un lotto per avere giri da piazzare.')}</p>}
        <div className="turf">
          {rs.map(r => {
            const here = giri.filter(x => x === r.id).length; const free = giriTotal(c, r.id) - giriPlaced(c, r.id);
            return (
              <div key={r.id} className="turf-row">
                <span><Ico id={`racket-${r.id}`} size="xs" />{t(r.name)} <span className="muted small">· {t('resa qui ×{x}', { x: dec(blockFit(c.id, block, r.id), 1) })}</span></span>
                <span className="turf-act">
                  <button disabled={!here} onClick={() => run({ t: 'turf', city: c.id, block, racket: r.id, op: 'remove' })} aria-label={t('Togli un giro di {r}', { r: t(r.name) })}>−</button>
                  <b>{here}</b>
                  <button disabled={free <= 0 || giri.length >= K.maxGiriPerBlock} onClick={() => run({ t: 'turf', city: c.id, block, racket: r.id, op: 'add' })} aria-label={t('Aggiungi un giro di {r}', { r: t(r.name) })}>+</button>
                  <span className="muted small">{t('{n} liberi', { n: free })}</span>
                </span>
              </div>
            );
          })}
        </div>
        <h3 className="sub">{t('Protezione')}</h3>
        <div className="turf-row">
          <span>{t('Punti protezione su questo isolato')} <span className="muted small">{t('({n} liberi)', { n: c.payroll - protectUsed(c) })}</span></span>
          <span className="turf-act">
            <button disabled={!c.protect[block]} onClick={() => run({ t: 'protect', city: c.id, block, delta: -1 })} aria-label={t('Togli protezione')}>−</button>
            <b>{c.protect[block] ?? 0}</b>
            <button disabled={protectUsed(c) >= c.payroll || (c.protect[block] ?? 0) >= giri.length} onClick={() => run({ t: 'protect', city: c.id, block, delta: 1 })} aria-label={t('Aggiungi protezione')}>+</button>
          </span>
        </div>
        <p className="hint">{t('Ogni grado del libro paga (centrale di polizia) è un punto protezione: abbassa di uno il grado di calore di un isolato.')}</p>
      </>}
    </>
  );
}

function MovePanel({ s, c, run, what }: P & { what: HostedId }) {
  const [open, setOpen] = useState(false);
  const here = whereIs(c, what);
  if (c.move) return <p className="hint">{t('Trasloco in corso: {d}.', { d: duration(c.move.end - s.time) })}</p>;
  if (!here) return null;
  const cost = K.moveCostPerLevel * here.level;
  const targets = c.lots.map((l, i) => ({ l, i })).filter(({ l, i }) => i !== here.lot && i < usableLots(s, c) && (l ? (l.kind === 'front' || l.kind === 'racket') && !l.hosted : freeLots(c, s).includes(i)));
  const isQg = what === 'qg';
  return (
    <div className="movebox">
      {!open ? <button className="ghost" onClick={() => setOpen(true)}>{isQg ? t('Trasloca il QG…') : t('Trasloca la cassaforte…')}</button> : <>
        <h3 className="sub">{isQg ? t('Dove spostare il QG') : t('Dove spostare la cassaforte')}</h3>
        <p className="hint">{t("Costa {m} sporchi e {h} ore, in cui {what}. Dentro un'attività libera un lotto, ma ne condivide la sorte.", { m: money(cost), h: K.moveHours, what: isQg ? t('il QG non velocizza i cantieri e non difende') : t('la cassaforte non protegge') })}</p>
        <div className="options">
          {targets.map(({ l, i }) => (
            <div key={i} className="opt">
              <div><b>{l ? t('Dentro {name}', { name: t(nameOf(l.kind, l.id)) }) : t('Lotto libero')}</b><div className="muted small">{t(ZONE_LABEL[lotZone(c.id, i)])}{l?.kind === 'racket' ? ' · ' + t('nascosto meglio, ma esposto alle retate') : l ? ' · ' + t('esposto a sabotaggi e sequestri') : ''}</div></div>
              <div className="opt-act"><button disabled={s.res.sporco < cost} onClick={() => { run({ t: 'move', city: c.id, what, toLot: i }); setOpen(false); }}>{t('Sposta')}</button></div>
            </div>
          ))}
          {!targets.length && <p className="muted small">{t("Nessun posto disponibile: serve un lotto libero o un'attività senza ospiti.")}</p>}
        </div>
        <button className="link" onClick={() => setOpen(false)}>{t('Annulla')}</button>

      </>}
    </div>
  );
}

function LotPanel({ s, c, run, lot }: P & { lot: number }) {
  const [cat, setCat] = useState<UseKind>('racket');
  const [confirm, setConfirm] = useState(false);
  const z = lotZone(c.id, lot); const u = c.lots[lot]; const q = c.buildQueue;
  const cr = cityRates(s, c); const lr = cr.lots[lot];
  const nearCops = nearPolice(c.id, lot);
  const head = (
    <>
      <h2 className="with-ico"><Ico id={lotIcon(u?.kind, u?.id)} size="md" />{u ? t(nameOf(u.kind, u.id)) : t('Lotto libero')} {u && <span className="lvl">{t('liv. {n}', { n: u.level })}</span>}</h2>
      <p className="lead small"><b>{t(ZONE_LABEL[z])}</b> · {t(ZONE_DESC[z])}{nearCops ? ' ' + t('Vicino alla centrale di polizia: i racket qui fanno più calore.') : ''}</p>
    </>
  );
  if (q && q.lot === lot) return <><Art id={lotArt(q.kind, q.id)} className="banner lot" />{head}<Progress s={s} start={q.start} end={q.end} label={t('{name} → livello {n}', { name: t(nameOf(q.kind, q.id)), n: q.level })} onCancel={() => run({ t: 'cancel', city: c.id, queue: 'build' })} /></>;
  if (u) {
    const d = useDef(u.kind, u.id); const cost = upgradeCost(u.kind, u.id, u.level + 1); const miss = missing(s, c, d.req);
    return (
      <>
        <Art id={lotArt(u.kind, u.id)} className="banner lot" />
        {head}
        <p className="desc">{t(d.desc)}{u.kind === 'racket' ? ' ' + t('Da fuori sembra un edificio qualunque.') : ''}{u.kind === 'building' && (u.id === 'qg' || u.id === 'cassaforte') ? ' ' + t("Da fuori sembra un palazzo d'appartamenti: il tetto colorato lo vedi solo tu.") : ''}</p>
        {u.closedUntil && u.closedUntil > s.time && <div className="req"><Ico id="stato-chiuso" size="xs" />{t('Chiuso dopo un colpo: riapre tra {d}.', { d: duration(u.closedUntil - s.time) })} <button onClick={() => run({ t: 'reopen', city: c.id, lot })}><Ico id="azione-riapri" size="xs" />{t('Riapri subito · {m}', { m: money(Math.round(totalCost(upgradeCost(u.kind, u.id, u.level)) * K.reopenFactor)) })}</button></div>}
        {u.hosted && <p className="advice warn">{t(u.hosted.id === 'qg' ? 'Dentro è nascosto il tuo QG (livello {n}). Ne condivide la sorte: {fate}.' : 'Dentro è nascosta la tua cassaforte (livello {n}). Ne condivide la sorte: {fate}.', {
          n: u.hosted.level,
          fate: u.kind !== 'racket' ? t('un sabotaggio o un sequestro lo colpiscono') : u.hosted.id === 'cassaforte' ? t('una retata lo colpisce, e il contante lì dentro non è al sicuro dalla polizia') : t('una retata lo colpisce'),
        })}</p>}
        {(u.kind === 'building' && (u.id === 'qg' || u.id === 'cassaforte')) && <MovePanel s={s} c={c} run={run} what={u.id as HostedId} />}
        {u.hosted && <MovePanel s={s} c={c} run={run} what={u.hosted.id} />}
        {lr && <div className="stats">
          {lr.dirty > 0 && <Stat k={t('Rendita sporca')} v={`${short(lr.dirty)}/h`} tone="dirty" />}
          {u.kind === 'racket' && <Stat k={t('Calore')} v={`+${dec(lr.heat, 1)}`} tone="neg" />}
          {u.kind === 'racket' && synergy(c, u.id as RacketId) > 0 && <Stat k={t('Sinergia dai front')} v={`+${Math.round(synergy(c, u.id as RacketId) * 100)}%`} tone="pos" />}
          {lr.clean > 0 && <Stat k={t('Reddito pulito')} v={`${short(lr.clean)}/h`} tone="clean" />}
          {lr.launder > 0 && <Stat k={t('Capacità di lavaggio')} v={`${short(lr.launder)}/h`} />}
          {lr.influence > 0 && <Stat k={t('Influenza')} v={`+${dec(lr.influence, 2)}/h`} />}
          {lr.cover > 0 && <Stat k={t('Copertura dal calore')} v={`−${dec(lr.cover, 1)}`} tone="pos" />}
        </div>}
        {u.kind === 'building' && <p className="hint">{u.id === 'qg' ? t('Lavori più veloci (×{x}), difesa base {d}.', { x: 1 + buildingLevel(c, 'qg'), d: 10 * buildingLevel(c, 'qg') }) : u.id === 'cassaforte' ? t("Questa cassaforte protegge {m}. In tutto l'impero: {tot}.", { m: money(K.safeBase * K.safeGrowth ** (u.level - 1)), tot: money(safeCap(s)) }) : t('Reclutamento più veloce in questa città (×{x}).', { x: 1 + buildingLevel(c, 'armeria') })}</p>}
        <div className="upg">
          <div><CostLine cost={cost} s={s} /> <span className="muted">· {duration(buildHours(c, cost) * 3600)}</span>{miss.length > 0 && <div className="req">{t('Serve: {list}', { list: miss.join(', ') })}</div>}</div>
          <button disabled={!!q || !canAfford(s, cost, c) || miss.length > 0} onClick={() => run({ t: 'upgrade', city: c.id, lot })}><Ico id="azione-livello" size="xs" />{t('Livello {n}', { n: u.level + 1 })}</button>
        </div>
        {q && <p className="hint">{t("C'è già un cantiere aperto in città: {name}, {d}.", { name: t(nameOf(q.kind, q.id)), d: duration(q.end - s.time) })}</p>}
        {u.kind === 'racket' && <button className="ghost" onClick={() => run({ t: 'promote', city: c.id, racket: u.id as RacketId })}><Ico id="azione-promozione" size="xs" />{t("Promozione: domanda +25% per 12 ore · {m} sporchi · un po' di calore", { m: money(5000) })}</button>}
        {!(u.kind === 'building' && u.id === 'qg') && !u.hosted && (confirm
          ? <div className="confirm">{t("Chiudere {name}? L'investimento va perso.", { name: t(nameOf(u.kind, u.id)) })} <button className="danger" onClick={() => { run({ t: 'demolish', city: c.id, lot }); setConfirm(false); }}>{t('Sì, chiudi')}</button> <button onClick={() => setConfirm(false)}>{t('No')}</button></div>
          : <button className="link" onClick={() => setConfirm(true)}><Ico id="azione-demolisci" size="xs" />{t('Chiudi e libera il lotto')}</button>)}
      </>
    );
  }
  const opts = buildOptions(s, c).filter(o => o.kind === cat);
  return (
    <>
      {head}
      <div className="seg">{CATEGORY_TABS.map(x => <button key={x.kind} className={cat === x.kind ? 'on' : ''} onClick={() => setCat(x.kind)}><Ico id={x.kind === 'racket' ? 'racket-pizzo' : x.kind === 'front' ? 'front-bar' : 'struttura-qg'} size="xs" />{t(x.label)}</button>)}</div>
      {q && <p className="hint">{t("C'è già un cantiere aperto in città: {name}, {d}.", { name: t(nameOf(q.kind, q.id)), d: duration(q.end - s.time) })}</p>}
      <div className="options">
        {opts.map(o => (
          <div key={o.id} className={`opt ${o.blocked ? 'locked' : ''}`}>
            <Art id={lotArt(o.kind, o.id)} className="thumb" />
            <div className="opt-body"><b>{t(o.name)}</b><div className="muted small">{t(o.desc)}</div>{o.blockedM && <div className="req">{render(o.blockedM)}</div>}</div>
            <div className="opt-act"><CostLine cost={o.cost} s={s} /><span className="muted small">{duration(buildHours(c, o.cost) * 3600)}</span>
              <button disabled={!!o.blocked || !!q || !canAfford(s, o.cost, c)} onClick={() => run({ t: 'build', city: c.id, lot, kind: o.kind, id: o.id })}><Ico id="lotto-cantiere" size="xs" />{t('Costruisci')}</button></div>
          </div>
        ))}
      </div>
    </>
  );
}

function PolicePanel({ s, c, run }: P) {
  const threat = nearestThreat(s, c.id);
  const [target, setTarget] = useState(threat);
  const cr = cityRates(s, c);
  const known = [peekCity(s, threat), ...Object.values(s.cities).filter(x => x.owner === 'npc' && x.id !== threat)];
  return (
    <>
      <Art id="edificio-cepd" className="banner" />
      <h2 className="with-ico"><Ico id="polizia-controllo" size="md" />{t('Centrale di polizia')}</h2>
      <p className="lead small">{tj('Qui si comprano silenzi e si fanno soffiate. Influenza di {city}: {n}.', { city: cityName(c.id), n: <b>{fmt(Math.floor(c.influence))}</b> })}</p>
      <h3 className="sub"><Ico id="polizia-libropaga" size="sm" />{t('A libro paga')}</h3>
      <div className="payroll">
        {PAYROLL.map((p, i) => (
          <button key={i} className={c.payroll === i ? 'on' : ''} onClick={() => run({ t: 'payroll', city: c.id, level: i })} disabled={i > c.payroll && s.res.sporco < Array.from({ length: i - c.payroll }, (_, k) => payrollCost(c.payroll + k + 1).sporco!).reduce((a, b) => a + b, 0)}>
            {t(p)}{i > c.payroll && <span className="small"> · {money(Array.from({ length: i - c.payroll }, (_, k) => payrollCost(c.payroll + k + 1).sporco!).reduce((a, b) => a + b, 0))}</span>}
          </button>
        ))}
      </div>
      <div className="stats">
        <Stat k={t('Calore tolto')} v={`−${dec(cr.pressure.libroPaga, 1)}`} tone="pos" />
        <Stat k={t('Stipendio')} v={t('{m}/h sporchi', { m: money(K.libroPagaUpkeep * c.payroll) })} />
      </div>
      <h3 className="sub">{t('Favori')}</h3>
      <div className="politics">
        {POLICE.map(p => {
          const cost = p.cost(c); const cd = p.id === 'bustarella' ? (c.cooldowns.bustarella ?? 0) - s.time : 0;
          return (
            <div key={p.id} className="pol">
              <Ico id={FAVOR_ICON[p.id]} size="md" />
              <div><b>{t(p.name)}</b><div className="muted small">{t(p.desc)}</div>
                {p.id === 'soffiata' && <select value={target} onChange={e => setTarget(e.target.value)} aria-label={t('Città bersaglio')}>
                  {known.map(x => <option key={x.id} value={x.id}>{cityName(x.id)} ({gangL(x.gang.name)})</option>)}
                </select>}
              </div>
              <div className="pol-act"><CostLine cost={cost} s={s} c={c} /><button disabled={!canAfford(s, cost, c) || cd > 0} onClick={() => run({ t: 'police', city: c.id, id: p.id, target: p.id === 'soffiata' ? target : undefined })}>{cd > 0 ? duration(cd) : t('Fai')}</button></div>
            </div>
          );
        })}
      </div>
      <p className="hint">{t('Per una soffiata su una città che non hai mai toccato, sceglila dalla Mappa.')}</p>
    </>
  );
}

function MayorRace({ s, c, run }: P) {
  const T = thresholds(s); const cost = campaignCost(c);
  if (isMayorOf(s, c.id)) return (
    <div className="advice">
      <b>{t('Sei il sindaco.')}</b> {t('Mandato fino a {when} (tra {d}).', { when: clock(s.mayor!.termEnds), d: duration(s.mayor!.termEnds - s.time) })}<br />
      {t("Hai 2 lotti in più accanto al municipio, eventi e licenze a metà prezzo, calore −{p} e difesa della città +{d}%. Costa {u} di influenza all'ora.", { p: -K.mayorPressure, d: Math.round((K.mayorDefense - 1) * 100), u: K.mayorUpkeep })}<br />
      {t('Rielezione: almeno {i} di influenza e calore sotto {h}. Uno scandalo (calore oltre {f}) ti fa cadere.', { i: K.reelectInfluence, h: T.retata, f: T.indagine })}
    </div>
  );
  if (c.campaign) return <Progress s={s} start={c.campaign.ends - K.campaignHours * 3600} end={c.campaign.ends} label={t('Campagna elettorale: tieni il calore sotto la soglia delle retate')} />;
  const reasons: string[] = [];
  if (s.mayor) reasons.push(t('sei già sindaco di {city} (una città per volta)', { city: cityName(s.mayor.city) }));
  if (c.influence < K.influenceCap) reasons.push(t("serve l'influenza al massimo ({a} / {b})", { a: Math.floor(c.influence), b: K.influenceCap }));
  if (c.heat >= T.retata) reasons.push(t('il calore deve stare sotto {n}', { n: T.retata }));
  return (
    <div className="pol">
      <Ico id="politica-campagna" size="md" />
      <div><b>{t('Candidati sindaco')}</b><div className="muted small">{t('Campagna di {h} ore, poi mandato di {d} giorni: +2 lotti, municipio a metà prezzo, meno calore, città più difesa.', { h: K.campaignHours, d: K.termDays })}{reasons.length ? ' ' + t('Per ora no: {r}.', { r: reasons.join('; ') }) : ''}</div></div>
      <div className="pol-act"><CostLine cost={cost} s={s} /><button disabled={reasons.length > 0 || !canAfford(s, cost)} onClick={() => run({ t: 'campaign', city: c.id })}>{t('Candidati')}</button></div>
    </div>
  );
}

function MayorPanel({ s, c, run }: P) {
  return (
    <>
      <Art id="edificio-municipio" className="banner" />
      <h2 className="with-ico"><Ico id="politica-sindaco" size="md" />{t('Municipio')}</h2>
      <p className="lead small">{tj("Eventi, licenze e favori. Si paga con il contante pulito o con l'influenza di {city}: {n} su {max}.", { city: cityName(c.id), n: <b>{fmt(Math.floor(c.influence))}</b>, max: fmt(K.influenceCap) })}</p>
      <MayorRace s={s} c={c} run={run} />
      <div className="politics">
        {MAYOR.map(p => {
          const done = p.once && c.flags[p.id as 'licenzaCasino' | 'zonizzazione'];
          return (
            <div key={p.id} className="pol">
              <Ico id={FAVOR_ICON[p.id]} size="md" />
              <div><b>{t(p.name)}</b><div className="muted small">{t(p.desc)}</div></div>
              <div className="pol-act"><CostLine cost={mayorCost(s, c, p.cost)} s={s} c={c} /><button disabled={!!done || !canAfford(s, mayorCost(s, c, p.cost), c)} onClick={() => run({ t: 'mayor', city: c.id, id: p.id })}>{done ? t('Ottenuto') : t('Fai')}</button></div>
            </div>
          );
        })}
      </div>
      {c.effects.length > 0 && <><h3 className="sub">{t('Effetti attivi')}</h3>{c.effects.map((e, i) => <div key={i} className="qline">{e.m ? render(e.m) : t(e.label)} · {t('ancora {d}', { d: duration(e.until - s.time) })}</div>)}</>}
      <h3 className="sub">{t('Il mercato della città')}</h3>
      <table className="market">
        <thead><tr><th>{t('Categoria')}</th><th>{t('Base')}</th><th>{t('Ora')}</th></tr></thead>
        <tbody>{(Object.keys(CATEGORY_LABEL) as Category[]).map(k => { const bse = def(c.id).demand[k] ?? 40, x = demand(s, c, k); return <tr key={k}><td>{t(CATEGORY_LABEL[k])}</td><td>{bse}</td><td className={x > bse ? 'up' : ''}>{Math.round(x)}</td></tr>; })}</tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------- Rapporti
function LogList({ s, n }: { s: GameState; n?: number }) {
  const items = n ? s.log.slice(0, n) : s.log;
  if (!items.length) return <p className="muted">{t('Ancora niente.')}</p>;
  return <ul className="log">{items.map((l, i) => { const f = logArt(l.text); return <li key={i} className={`${l.kind} ${f ? 'with-face' : ''}`}>{f ? <Art id={f} className="face" /> : <Ico id={l.kind === 'bad' ? 'esito-sconfitta' : l.kind === 'warn' ? 'esito-allerta' : l.kind === 'good' ? 'esito-vittoria' : null} size="xs" />}<span className="t">{clock(l.t)}</span>{logText(l)}</li>; })}</ul>;
}
function Log({ s }: { s: GameState }) {
  return (
    <div className="grid two">
      <section className="panel"><h2 className="with-ico"><Ico id="tab-rapporti" size="md" />{t('Rapporti di battaglia e spionaggio')}</h2>
        {s.reports.length ? s.reports.map(r => <details key={r.id} className="rep"><summary className={r.win ? 'win' : 'loss'}><Ico id={reportIcon(r)} size="sm" /><span className="t">{clock(r.t)}</span>{r.m ? render(r.m.title) : t(r.title)}</summary><ReportCard r={r} compact /></details>) : <p className="muted">{t('Nessun rapporto ancora.')}</p>}
      </section>
      <section className="panel"><h2 className="with-ico"><Ico id="esito-nonletto" size="md" />{t('Cronaca')}</h2><LogList s={s} /></section>
    </div>
  );
}

function ReportCard({ r, compact }: { r: BattleReport; compact?: boolean }) {
  const fight = r.kind !== 'spy' && r.kind !== 'mayor' && (r.att > 0 || r.def > 0);
  const total = Math.max(1, r.att + r.def);
  const title = r.m ? render(r.m.title) : t(r.title);
  const lines = r.m ? r.m.lines.map(x => render(x)) : r.lines.map(x => t(x));
  const advice = r.m ? render(r.m.advice) : r.advice ? t(r.advice) : '';
  return (
    <div className="report">
      <Art id={reportArt(r)} className={compact ? 'banner small' : 'banner'} />
      {r.kind === 'spy' && r.win && <Art id={bossArt(r.city)} className="face big" />}
      {!compact && <h2 className={r.win ? 'win' : 'loss'}>{title}</h2>}
      {fight && (
        <div className="duel" aria-label={t('Attacco {a} contro difesa {d}', { a: r.att, d: r.def })}>
          <div className="duel-bar"><div className="att" style={{ width: `${(r.att / total) * 100}%` }} /><div className="def" style={{ width: `${(r.def / total) * 100}%` }} /></div>
          <div className="duel-lbl"><span>{r.kind === 'defense' || r.kind === 'sabotage' ? t('Loro') : t('Tu')} · {group(r.att)}</span><span>{group(r.def)} · {r.kind === 'defense' || r.kind === 'sabotage' ? t('Tu') : t('Loro')}</span></div>
        </div>
      )}
      <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      {advice && <p className={`advice ${r.win ? '' : 'warn'}`}>{advice}</p>}

    </div>
  );
}
