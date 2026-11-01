// Playtest multiplayer simulato: N giocatori bot sullo stesso server, in lockstep di un'ora.
// Ogni giocatore ha il proprio stato del motore; le città degli altri giocatori gli appaiono come "proxy"
// (le loro difese, i loro edifici, il loro contante esposto). Dopo ogni ora gli esiti degli scontri
// vengono riportati sui proprietari veri: perdite, bottini, chiusure, città perse, vassallaggio.
// Uso: npx tsx scripts/mp.ts <giocatori> <giorni> <cartella>
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { CITY_COUNT, cityRaw, searchCities } from '../src/engine/world';
import {
  act, buildOptions, canAfford, cityLimit, def, exposed, fortDefense, freeLots, gangDefense, influenceNeeded, missingReq, newGame, owned,
  peekCity, power, rates, researchCost, safeCap, thresholds, tick, upgradeCost, whereIs, autoDefend, vacationDaysLeft, investBonus, SEASON, type CityState, type GameState, type Squad,
} from '../src/engine/engine';
import { K, RESEARCH, type ResearchId, type UnitId } from '../src/engine/data';
import { SEASONS, SEASON_LENGTH, applySeasonMods } from '../src/engine/seasons';

const NP = Number(process.argv[2] ?? 300), DAYS = Number(process.argv[3] ?? 365), DIR = process.argv[4] ?? '/home/claude/playtest/mp', SEED = Number(process.argv[5] ?? 0);
mkdirSync(DIR, { recursive: true });
const H = 3600, D = 86400, STEP = 300;
const TRIBUTE = 0.15; // quota del reddito sporco che un vassallo versa al suo capo (ipotesi)

function mulberry(seed: number) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const world = mulberry(20261031 + SEED * 7777);

// ---------------------------------------------------------------- mappa del server
// Stessa densità di un server pieno (10.000 giocatori su ~17.000 territori): per 300 giocatori ~514 città attorno a Tulsa.
const tulsa = searchCities('Tulsa', 5).find(i => cityRaw(i)[0] === 'Tulsa') ?? searchCities('Tulsa')[0];
const T = cityRaw(tulsa); const REGION_N = Math.round(CITY_COUNT * NP / 10000);
const REGION: string[] = Array.from({ length: CITY_COUNT }, (_, i) => i).map(i => ({ i, d: Math.hypot(cityRaw(i)[3] - T[3], cityRaw(i)[4] - T[4]) }))
  .sort((a, b) => a.d - b.d).slice(0, REGION_N).map(x => String(x.i));
const IN_REGION = new Set(REGION);
const XY = (id: string) => { const r = cityRaw(Number(id)); return [r[3], r[4]] as const; };

// ---------------------------------------------------------------- profili
type Profile = {
  id: number; assiduita: 'hardcore' | 'regolare' | 'casual' | 'sporadico'; ritmo: 'lento' | 'normale' | 'veloce';
  testa: 'stratega' | 'equilibrato' | 'impulsivo'; discontinuo: boolean; joinDay: number;
  sessionsPerDay: number; sessionMin: number; offDay: number; breakProb: number; actionsPerCheck: number;
};
function profile(i: number): Profile {
  const r = mulberry(1000 + i * 7919 + SEED * 104723);
  const a = r(); const assiduita = a < 0.1 ? 'hardcore' : a < 0.45 ? 'regolare' : a < 0.85 ? 'casual' : 'sporadico';
  const b = r(); const ritmo = b < 0.3 ? 'lento' : b < 0.75 ? 'normale' : 'veloce';
  const c = r(); const testa = c < 0.3 ? 'stratega' : c < 0.7 ? 'equilibrato' : 'impulsivo';
  const discontinuo = r() < 0.35;
  const j = r(); const joinDay = j < 0.7 ? Math.floor(r() * 3) : j < 0.9 ? 3 + Math.floor(r() * 27) : 30 + Math.floor(r() * 90);
  const base = { hardcore: [10, 40], regolare: [4, 20], casual: [2, 12], sporadico: [0.7, 10] }[assiduita];
  return {
    id: i, assiduita, ritmo, testa, discontinuo, joinDay,
    sessionsPerDay: base[0], sessionMin: base[1] * (ritmo === 'lento' ? 1.4 : ritmo === 'veloce' ? 0.7 : 1),
    offDay: (discontinuo ? 0.3 : 0.05) + (assiduita === 'sporadico' ? 0.3 : 0),
    breakProb: discontinuo ? 0.02 : 0.003, actionsPerCheck: ritmo === 'lento' ? 1 : ritmo === 'normale' ? 3 : 6,
  };
}

// ---------------------------------------------------------------- giocatori e mondo condiviso
type Snap = { units: Squad; stash: number; closed: (number | undefined)[]; owner: number };
type Player = {
  p: Profile; s: GameState | null; rr: () => number; ev: Record<string, number>; mem: Mem;
  sessions: [number, number][]; away: number; lastLog: number; seenRep: number;
  proxies: Map<string, Snap>; lord: number | null; vassals: Set<number>; allies: Set<number>; shieldUntil: number; vassalSince: number; lastOnline: number; joinedAt: number; seenMissions: Set<string>; daily: number[][]; history: { day: number; what: string; city?: string; other?: number }[];
};
type Mem = { saving?: boolean; cands: string[]; candsAt: number; lastAttack: number; nextExpandCheck: number };
const owner = new Map<string, number>(); // città → giocatore
const players: Player[] = [];
const EV = ['attRecv', 'attLost', 'retate', 'indagini', 'controlli', 'diserzioni', 'avvisi', 'warnOffline', 'assaltiOk', 'assaltiKo', 'assaltiCieco',
  'spieKo', 'acquisti', 'campagne', 'sindaco', 'sindacoPerso', 'scandali', 'checks', 'idleChecks', 'actions', 'onlineMin', 'sessions',
  'pvpFatti', 'pvpVinti', 'pvpSubiti', 'pvpPersi', 'pvpBottinoPreso', 'pvpBottinoPerso', 'conquisteNpc', 'conquistePvp', 'cittaPerse', 'vassallo', 'tributoPagato', 'tributoRicevuto', 'conflitti', 'expandBlocked', 'raidFatti', 'riscatti', 'indipendenze', 'vacanze', 'giorniVacanza', 'posturaReclute', 'protetti'];

function scanLog(pl: Player, online: boolean) {
  const s = pl.s!; const ev = pl.ev;
  for (const e of s.log) {
    if (e.t <= pl.lastLog) break;
    const x = e.text;
    if (/ti hanno razziato/.test(x)) { ev.attRecv++; ev.attLost++; }
    else if (/sabotaggio riuscito/.test(x)) { ev.attRecv++; ev.attLost++; }
    else if (/hai respinto/.test(x)) ev.attRecv++;
    else if (/affonda in uno scandalo/.test(x)) ev.scandali++;
    else if (/RETATA/.test(x)) ev.retate++;
    else if (/INDAGINE FEDERALE/.test(x)) ev.indagini++;
    else if (/CONTROLLO su un tuo isolato/.test(x)) ev.controlli++;
    else if (/gli informatori avvisano/.test(x)) { ev.avvisi++; if (!online) ev.warnOffline++; }
    else if (/^Assalto fallito/.test(x)) ev.assaltiKo++;
    else if (/^Assalto a /.test(x)) ev.assaltiCieco++;
    else if (/informatori sono stati scoperti/.test(x)) ev.spieKo++;
    else if (/^Acquisizione:/.test(x)) ev.acquisti++;
    else if (/hai vinto le elezioni/.test(x)) ev.sindaco++;
    else if (/non sei più il sindaco/.test(x)) ev.sindacoPerso++;
    else if (/per gli stipendi/.test(x)) ev.diserzioni++;
  }
  pl.lastLog = s.time;
  for (const r of s.reports) {
    if (r.id <= pl.seenRep) break;
    if (r.kind === 'defense' || r.kind === 'sabotage') pl.mem.lastAttack = Math.max(pl.mem.lastAttack * 0.7, r.att);
    if ((r.kind === 'raid' || r.kind === 'assault' || r.kind === 'strike') && pl.proxies.has(r.city)) { ev.pvpFatti++; if (r.win) ev.pvpVinti++; ev.pvpBottinoPreso += r.loot ?? 0; }
  }
  pl.seenRep = s.reports[0]?.id ?? pl.seenRep;
}

// ---------------------------------------------------------------- proxy: le città degli altri viste da me
const FIGHT: UnitId[] = ['picchiatori', 'soldati', 'enforcer', 'guardie', 'informatori', 'corrieri'];
const ownerCache = new Map<number, { t: number; r: ReturnType<typeof rates>; exp: number }>();
function ownerInfo(oi: number) { const o = players[oi].s!; let e = ownerCache.get(oi); if (!e || e.t !== o.time) { e = { t: o.time, r: rates(o), exp: exposed(o) }; ownerCache.set(oi, e); } return e; }
function cityShare(o: GameState, c: CityState, r: ReturnType<typeof rates>) { return c.id === o.capital ? Math.max(0.5, (r.cities[c.id]?.dirty ?? 0) / Math.max(1, r.dirty)) : (r.cities[c.id]?.dirty ?? 0) / Math.max(1, r.dirty); }
function refreshProxy(pl: Player, id: string) {
  const oi = owner.get(id); if (oi === undefined || oi === pl.p.id) return;
  const o = players[oi].s!; const oc = o.cities[id]; if (!oc) return;
  const s = pl.s!;
  let c = s.cities[id];
  if (!c || c.owner === 'player') { c = peekCity(s, id); s.cities[id] = c; }
  // una banda che stava per attaccarmi da quella città non esiste più
  for (const mine of owned(s)) if (mine.gang.incoming?.from === id) { mine.gang.incoming = null; mine.gang.nextAttackAt = s.time + 12 * H; }
  c.proxy = oi; c.owner = 'npc';
  c.lots = JSON.parse(JSON.stringify(oc.lots));
  const units: Squad = {}; for (const u of FIGHT) if (oc.units[u]) units[u] = oc.units[u];
  for (const [u, n] of Object.entries(oc.guards)) units[u as UnitId] = (units[u as UnitId] ?? 0) + (n ?? 0);
  // rinforzi della famiglia: il capo copre i suoi vassalli
  const lordIdx = players[oi].lord; const ls = lordIdx !== null ? players[lordIdx].s : null;
  if (ls && ls.cities[ls.capital]) units.guardie = (units.guardie ?? 0) + Math.floor(RULES.familyGuard * power(ls, ls.cities[ls.capital].units, 'def') / 4);
  const g = c.gang;
  g.name = `la famiglia del giocatore ${oi}`; g.units = units; g.share = 1; g.mult = 1; g.nextAttackAt = 1e15; g.lastGrowAt = s.time; g.incoming = null;
  const info = ownerInfo(oi); g.stash = Math.round(info.exp * cityShare(o, oc, info.r));
  c.heat = oc.heat;
  pl.proxies.set(id, { units: { ...units }, stash: g.stash, closed: c.lots.map(l => l?.closedUntil), owner: oi });
}
/** Toglie una città da uno stato senza lasciare missioni appese: chi era in viaggio verso di lei torna a casa. */
function purgeCity(s: GameState, id: string) {
  delete s.cities[id];
  const home = s.cities[s.capital] ?? owned(s)[0];
  s.missions = s.missions.filter(m => {
    if (m.from === id && home) m.from = home.id;
    if (m.to !== id) return true;
    const back = s.cities[m.from] ?? home; if (back) for (const [u, n] of Object.entries(m.units)) if (n) back.units[u as UnitId] += n;
    return false;
  });
}
function dropProxy(pl: Player, id: string) { pl.proxies.delete(id); const c = pl.s!.cities[id]; if (c && c.proxy !== undefined) purgeCity(pl.s!, id); }

// ---------------------------------------------------------------- bot (stesso del playtest single player, con i rivali umani)
const tryAct = (pl: Player, a: Parameters<typeof act>[1]) => { const r = act(pl.s!, a); if (r.ok) pl.ev.actions++; return r.ok; };
const friend = (pl: Player, oi: number | undefined) => oi !== undefined && (oi === pl.lord || pl.vassals.has(oi) || pl.allies.has(oi) || oi === pl.p.id);

// ---------------------------------------------------------------- regole del server (v2)
const RULES = {
  newbieDays: 5,          // protezione dei nuovi arrivati
  weakShare: 0.2,         // non si colpisce chi ha meno del 20% del tuo punteggio...
  inactiveDays: 7,        // ...salvo che sia inattivo da una settimana
  shieldHours: 72,        // dopo aver perso una città, 72 ore di tregua
  independenceDays: 30,   // vassallo per 30 giorni senza perdere città: torna libero
  ransomAfterDays: 7,     // il riscatto si può pagare solo dopo una settimana
  familyGuard: 0.25,      // il capo manda in difesa dei vassalli un quarto della difesa della sua capitale
  ransomBase: 150000,     // riscatto in pulito: base + una settimana del proprio reddito
};
const scoreOf = (pl: Player) => pl.s ? pl.s.stats.invested / 1000 : 0;
function protectedFrom(att: Player, vi: number | undefined): string | null {
  if (vi === undefined) return null;
  const v = players[vi]; const s = v.s; if (!s) return 'assente';
  if (friend(att, vi)) return 'famiglia';
  if (s.vacation) return 'vacanza';
  if (s.time - v.joinedAt < RULES.newbieDays * D) return 'nuovo';
  if (v.shieldUntil > s.time) return 'tregua';
  if (scoreOf(v) < RULES.weakShare * scoreOf(att) && s.time - v.lastOnline < RULES.inactiveDays * D) return 'debole';
  return null;
}
const ransomCost = (pl: Player) => {
  const r = rates(pl.s!); const lord = pl.lord !== null ? players[pl.lord].s : null; const lr = lord ? ownerInfo(pl.lord!).r : null;
  // il riscatto pesa anche la ricchezza del capo: liberarsi da un boss grande costa di più
  return Math.round((RULES.ransomBase + 168 * (r.dirty + r.clean) + (lr ? 0.25 * 168 * (lr.dirty + lr.clean) : 0)) * (SEASON.id === 'cartelli' ? 0.5 : 1));
};
function freeVassal(pl: Player, why: string) {
  if (pl.lord === null) return;
  players[pl.lord].vassals.delete(pl.p.id);
  for (const a of pl.allies) players[a].allies.delete(pl.p.id);
  pl.allies = new Set(); pl.lord = null; pl.ev.indipendenze++;
  pl.history.push({ day: Math.floor(pl.s!.time / D) + 1, what: 'libero:' + why });
  pl.mem.cands = [];
}

function nearby(pl: Player, from: string, n: number, sameState: boolean): string[] {
  const me = def(from);
  return REGION.filter(id => id !== from && owner.get(id) !== pl.p.id && !protectedFrom(pl, owner.get(id)) && (!sameState || def(id).stateIdx === me.stateIdx))
    .map(id => { const [x, y] = XY(id); return { id, d: Math.hypot(x - me.x, y - me.y) }; }).sort((a, b) => a.d - b.d).slice(0, n).map(x => x.id);
}

function economy(pl: Player, c: CityState, budget: { n: number }) {
  const s = pl.s!; const p = pl.p;
  if (budget.n <= 0 || c.buildQueue) return;
  const r = rates(s); const smart = p.testa === 'stratega' ? 1 : p.testa === 'equilibrato' ? 0.6 : 0.2;
  const needLaunder = r.launderCap < r.dirty;
  const opts: { a: Parameters<typeof act>[1]; score: number }[] = [];
  c.lots.forEach((l, lot) => {
    if (!l || l.closedUntil) return;
    const k = upgradeCost(l.kind, l.id, l.level + 1); if (!canAfford(s, k, c)) return;
    const w = l.kind === 'racket' ? (c.heat > 50 ? 0.4 * smart + (1 - smart) * 1.5 : 1.2) : l.kind === 'front' ? (needLaunder ? 2.5 : 0.8)
      : l.id === 'qg' ? 1.3 : l.id === 'cassaforte' ? (s.res.sporco > safeCap(s) ? 2 * smart + 0.3 : 0.4) : 0.7;
    opts.push({ a: { t: 'upgrade', city: c.id, lot }, score: w / Math.max(1, (k.sporco ?? 0) + (k.pulito ?? 0)) });
  });
  const free = freeLots(c, s);
  if (free.length) for (const o of buildOptions(s, c)) {
    if (o.blocked || !canAfford(s, o.cost, c)) continue;
    if (o.kind === 'building' && (o.id !== 'armeria' || c.lots.some(l => l?.id === 'armeria'))) continue;
    if (o.kind === 'front' && c.lots.some(l => l?.id === o.id) && smart > 0.5) continue;
    const w = o.kind === 'racket' ? 1.8 : o.kind === 'front' ? (needLaunder ? 2.5 : 0.9) : 1.4;
    opts.push({ a: { t: 'build', city: c.id, lot: free[0], kind: o.kind, id: o.id }, score: w / Math.max(1, (o.cost.sporco ?? 0) + (o.cost.pulito ?? 0)) });
  }
  if (!opts.length) return;
  opts.sort((a, b) => b.score - a.score);
  const pick = pl.rr() < smart ? opts[0] : opts[Math.floor(pl.rr() * opts.length)];
  if (tryAct(pl, pick.a)) budget.n--;
}
function research(pl: Player, budget: { n: number }) {
  const s = pl.s!; if (s.researchQueue || budget.n <= 0) return;
  const order: ResearchId[] = pl.p.testa === 'impulsivo' ? ['tattica', 'gestione', 'logistica', 'contabilita', 'corruzione', 'cifrate']
    : owned(s).length >= cityLimit(s) ? ['gestione', 'tattica', 'contabilita', 'corruzione', 'cifrate', 'logistica'] : ['contabilita', 'tattica', 'corruzione', 'gestione', 'cifrate', 'logistica'];
  for (const id of order) {
    const d = RESEARCH.find(r => r.id === id)!; if (missingReq(s, null, d.req).length) continue;
    const k = researchCost(id, s.research[id] + 1);
    if (canAfford(s, k) && (k.sporco ?? 0) <= s.res.sporco * 0.5 && (k.pulito ?? 0) <= s.res.pulito * 0.7 && tryAct(pl, { t: 'research', id })) { budget.n--; return; }
  }
}
function heatCare(pl: Player, c: CityState, budget: { n: number }) {
  const s = pl.s!; const p = pl.p; if (budget.n <= 0) return;
  const lim = p.testa === 'stratega' ? 30 : p.testa === 'equilibrato' ? 42 : 58;
  if (c.heat > lim && c.payroll < 5 && (p.testa !== 'impulsivo' || pl.rr() < 0.4) && tryAct(pl, { t: 'payroll', city: c.id, level: c.payroll + 1 })) { budget.n--; return; }
  if (c.heat > thresholds(s).retata - 8 && p.testa !== 'impulsivo' && tryAct(pl, { t: 'police', city: c.id, id: 'bustarella' })) budget.n--;
}
function defense(pl: Player, c: CityState, budget: { n: number }) {
  const s = pl.s!; const p = pl.p; if (budget.n <= 0 || c.unitQueue.length) return;
  const inc = c.gang.incoming;
  const est = inc ? power(null, inc.units, 'att') : Math.max(pl.mem.lastAttack, K.attackFloorBase + K.attackFloorPerDay * s.time / D);
  const want = est * (p.testa === 'stratega' ? 1.4 : p.testa === 'equilibrato' ? 1.0 : 0.5);
  const have = power(s, c.units, 'def') + 10 * (whereIs(c, 'qg')?.level ?? 0);
  if (have >= want) return;
  const soldier = c.lots.some(l => l?.id === 'armeria');
  const id: UnitId = soldier ? 'soldati' : 'picchiatori'; const per = soldier ? 2000 : 500; const dv = soldier ? 8 : 3;
  const n = Math.min(Math.ceil((want - have) / dv), Math.floor(s.res.sporco * 0.4 / per));
  if (n > 0 && tryAct(pl, { t: 'recruit', city: c.id, id, n })) budget.n--;
}
function army(c: CityState, keep: number): Squad { return { soldati: Math.floor(c.units.soldati * (1 - keep)), picchiatori: Math.floor(c.units.picchiatori * (1 - keep)), enforcer: Math.floor(c.units.enforcer * (1 - keep)) }; }

function expand(pl: Player, budget: { n: number }) {
  const s = pl.s!; const p = pl.p; const mem = pl.mem;
  if (budget.n <= 0 || s.time < mem.nextExpandCheck) return;
  mem.nextExpandCheck = s.time + (p.testa === 'impulsivo' ? 3 : 8) * H;
  const mine = owned(s); if (!mine.length) return;
  const home = mine.slice().sort((a, b) => power(s, b.units, 'att') - power(s, a.units, 'att'))[0];
  if (s.time - mem.candsAt > 24 * H || !mem.cands.length) { mem.cands = [...nearby(pl, home.id, 10, true), ...nearby(pl, home.id, 6, false)].filter((x, i, a) => a.indexOf(x) === i); mem.candsAt = s.time; }
  const cands = mem.cands.filter(id => owner.get(id) !== p.id && !protectedFrom(pl, owner.get(id)) && home.influence >= influenceNeeded(s, id));
  for (const id of mem.cands) if (owner.has(id) && protectedFrom(pl, owner.get(id)) && pl.proxies.has(id)) dropProxy(pl, id);
  for (const id of cands) if (owner.has(id)) { if (!pl.proxies.has(id) || s.cities[id]?.proxy === undefined) refreshProxy(pl, id); } else if (pl.proxies.has(id)) dropProxy(pl, id);
  if (!cands.length || s.missions.some(m => m.kind === 'assault' || m.kind === 'spy' || m.kind === 'raid')) return;
  const view = cands.map(id => ({ id, c: peekCity(s, id) }));
  const att = power(s, army(home, 0), 'att');
  // 1) colpo alla cassa su chi ha contante esposto (soprattutto altri giocatori distratti)
  const raidWill = p.testa === 'impulsivo' ? 0.6 : p.testa === 'equilibrato' ? 0.3 : 0.15;
  if (pl.rr() < raidWill) {
    const rt = view.filter(x => x.c.gang.stash > 20000 && att > gangDefense(x.c) * (p.testa === 'impulsivo' ? 1 : 1.4)).sort((a, b) => b.c.gang.stash - a.c.gang.stash)[0];
    if (rt && tryAct(pl, { t: 'mission', kind: 'raid', from: home.id, to: rt.id, units: army(home, 0.4) })) { pl.ev.raidFatti++; budget.n--; return; }
  }
  // 2) conquista
  const limit = cityLimit(s) + (p.testa === 'impulsivo' ? 1 : 0);
  if (mine.length >= limit) return;
  const noise = p.testa === 'impulsivo' ? 0.6 + pl.rr() * 0.8 : 1;
  const isCap = (id: string) => { const o = owner.get(id); return o !== undefined && players[o].s?.capital === id; };
  // per crescere servono città conquistabili; le capitali dei rivali si possono solo sottomettere (ogni tanto)
  const pool = view.filter(x => !isCap(x.id)).length && pl.rr() > 0.2 ? view.filter(x => !isCap(x.id)) : view;
  const t = pool.sort((a, b) => fortDefense(a.c) - fortDefense(b.c))[0];
  const fd = fortDefense(t.c) * noise;
  if (p.testa !== 'impulsivo' && t.c.proxy === undefined && t.c.gang.share <= K.acquireMaxShare && tryAct(pl, { t: 'acquire', from: home.id, city: t.id })) { budget.n--; return; }
  const margin = p.testa === 'stratega' ? 1.5 : p.testa === 'equilibrato' ? 1.25 : 1.0;
  const qgKnown = !!t.c.gang.intel?.qgKnown && s.time - (t.c.gang.intel?.at ?? 0) < 24 * H;
  if (p.testa !== 'impulsivo' && !qgKnown) {
    if (home.units.informatori < 3) { if (!home.unitQueue.length && tryAct(pl, { t: 'recruit', city: home.id, id: 'informatori', n: 3 - home.units.informatori })) budget.n--; return; }
    if (tryAct(pl, { t: 'mission', kind: 'spy', from: home.id, to: t.id, units: { informatori: Math.min(home.units.informatori, 4) } })) budget.n--;
    return;
  }
  if (att >= fd * margin) {
    const keep = p.testa === 'stratega' ? 0.25 : p.testa === 'equilibrato' ? 0.15 : 0;
    if (tryAct(pl, { t: 'mission', kind: 'assault', from: home.id, to: t.id, units: army(home, keep) })) { mem.saving = false; budget.n--; }
  } else if (home.lots.some(l => l?.id === 'armeria')) {
    const per = 8 * (1 + 0.1 * s.research.tattica);
    const need = Math.ceil((fd * margin - att) / per); const cost = need * 2000;
    if (cost > Math.max(1, rates(s).dirty) * 48) { pl.ev.expandBlocked++; mem.saving = false; return; }
    mem.saving = p.testa !== 'impulsivo';
    if (!home.unitQueue.length) { const n = Math.min(need, Math.floor(s.res.sporco * (p.testa === 'impulsivo' ? 0.6 : 0.8) / 2000)); if (n > 0 && tryAct(pl, { t: 'recruit', city: home.id, id: 'soldati', n })) budget.n--; }
  }
}
function mayor(pl: Player, budget: { n: number }) {
  const s = pl.s!; if (budget.n <= 0 || s.mayor || pl.p.testa === 'impulsivo') return;
  for (const c of owned(s)) if (c.influence >= K.influenceCap && c.heat < thresholds(s).retata - 15 && tryAct(pl, { t: 'campaign', city: c.id })) { pl.ev.campagne++; budget.n--; return; }
}
function check(pl: Player) {
  const s = pl.s!; pl.ev.checks++; pl.lastOnline = s.time;
  if (!s.posture) { const w = pl.p.testa === 'stratega' ? 0.5 : pl.p.testa === 'equilibrato' ? 0.3 : pl.rr() < 0.3 ? 0.3 : 0; act(s, { t: 'posture', auto: w > 0, share: w || 0.3 }); }
  if (pl.lord !== null && s.time - pl.vassalSince >= RULES.ransomAfterDays * D && (pl.p.testa !== 'impulsivo' || pl.rr() < 0.3)) {
    const k = ransomCost(pl);
    if (s.res.pulito >= k * 1.2) { s.res.pulito -= k; players[pl.lord].s!.res.pulito += k * 0.5; pl.ev.riscatti++; freeVassal(pl, 'riscatto'); }
  }
  const budget = { n: pl.p.actionsPerCheck }; const before = budget.n;
  const mine = owned(s);
  for (const c of mine) heatCare(pl, c, budget);
  for (const c of mine) defense(pl, c, budget);
  const n0 = mine.length; expand(pl, budget); if (owned(s).length > n0) pl.mem.saving = false;
  for (const c of owned(s)) { if (!pl.mem.saving || s.res.sporco > 400000) economy(pl, c, budget); if (pl.rr() < 0.2) act(s, { t: 'autoTurf', city: c.id }); }
  research(pl, budget); mayor(pl, budget);
  if (pl.p.testa === 'stratega') { const r = rates(s); act(s, { t: 'launder', share: r.launderCap < r.dirty ? 1 : 0.7 }); }
  // investimenti: il pulito oltre una riserva (riscatto, campagna, attività legali) diventa rendita
  if (budget.n > 0 && (pl.p.testa !== 'impulsivo' || pl.rr() < 0.3)) {
    const reserve = Math.max(500000, pl.lord !== null ? ransomCost(pl) * 1.2 : 0);
    if (s.res.pulito > reserve * 1.5 && tryAct(pl, { t: 'invest', amount: s.res.pulito - reserve })) { budget.n--; pl.ev.investito = (pl.ev.investito ?? 0) + 1; }
  }
  if (budget.n === before) pl.ev.idleChecks++;
}

// ---------------------------------------------------------------- nascita, perdita, vassallaggio
function freeCityNear(x: number, y: number, r: () => number): string {
  const free = REGION.filter(id => !owner.has(id));
  const pool = free.map(id => { const [a, b] = XY(id); return { id, d: Math.hypot(a - x, b - y) }; }).sort((a, b) => a.d - b.d).slice(0, 8);
  return pool[Math.floor(r() * pool.length)]?.id ?? free[0];
}
function becomeVassal(pl: Player, by: Player) {
  if (pl.lord !== null) players[pl.lord].vassals.delete(pl.p.id);
  for (const a of pl.allies) players[a].allies.delete(pl.p.id);
  pl.allies = new Set();
  pl.lord = by.p.id; by.vassals.add(pl.p.id); pl.ev.vassallo++; pl.vassalSince = by.s!.time;
  for (const v of by.vassals) if (v !== pl.p.id) { players[v].allies.add(pl.p.id); pl.allies.add(v); }
  pl.history.push({ day: Math.floor(by.s!.time / D) + 1, what: 'vassallo', other: by.p.id });
}
/** Il capo affida a un suo uomo la sua città meno sviluppata (non la capitale). */
function entrust(lord: Player, pl: Player, t: number): string | null {
  const ls = lord.s!; const opts = owned(ls).filter(c => c.id !== ls.capital && owner.get(c.id) === lord.p.id)
    .sort((a, b) => a.lots.reduce((x, l) => x + (l?.level ?? 0), 0) - b.lots.reduce((x, l) => x + (l?.level ?? 0), 0));
  const c = opts[0]; if (!c) return null;
  const capital = ls.cities[ls.capital];
  for (const [u, n] of Object.entries(c.units)) if (n) capital.units[u as UnitId] += n;
  for (const [u, n] of Object.entries(c.guards)) if (n) capital.units[u as UnitId] += n;
  const lots = JSON.parse(JSON.stringify(c.lots));
  if (ls.mayor?.city === c.id) ls.mayor = null;
  purgeCity(ls, c.id);
  const ns = newGame(9000 + pl.p.id * 31 + Math.floor(t), c.id);
  const home = ns.cities[c.id]; home.lots = lots; home.gang.nextAttackAt = t + 24 * H; home.since = t; home.turf = {};
  if (!pl.s) { ns.time = t; for (const l of ns.log) l.t = t; pl.s = ns; pl.lastLog = t; }
  else { pl.s.cities[c.id] = home; pl.s.capital = c.id; }
  owner.set(c.id, pl.p.id); lord.ev.cittaAffidate = (lord.ev.cittaAffidate ?? 0) + 1;
  lord.mem.cands = []; pl.mem.cands = [];
  return c.id;
}
function spawn(pl: Player, t: number): boolean {
  const free = REGION.filter(id => !owner.has(id));
  if (!free.length) {
    // mappa piena: chi arriva tardi entra già affiliato a una famiglia che gli affida una città
    const lords = players.filter(x => x.s && x.lord === null && owned(x.s).length >= 3).sort((a, b) => owned(b.s!).length - owned(a.s!).length);
    const lord = lords[Math.floor(world() * Math.min(10, lords.length))]; if (!lord) return false;
    const id = entrust(lord, pl, t); if (!id) return false;
    becomeVassal(pl, lord); pl.ev.affiliatoAllIngresso = 1; pl.joinedAt = t; pl.lastOnline = t;
    pl.history.push({ day: Math.floor(t / D) + 1, what: 'entra', city: id });
    return true;
  }
  const start = freeCityNear(...(XY(REGION[Math.floor(world() * REGION.length)])), world);
  const s = newGame(5000 + pl.p.id * 104729 + SEED * 13, start);
  s.time = t; const h = s.cities[start]; h.gang.nextAttackAt += t; h.since = t; for (const l of s.log) l.t = t;
  pl.s = s; owner.set(start, pl.p.id); pl.lastLog = t; pl.joinedAt = t; pl.lastOnline = t;
  pl.history.push({ day: Math.floor(t / D) + 1, what: 'entra', city: start });
  return true;
}
function loseCity(victim: Player, id: string, by: Player) {
  const s = victim.s!; const c = s.cities[id]; if (!c) return;
  victim.ev.cittaPerse++; victim.shieldUntil = s.time + RULES.shieldHours * H; victim.vassalSince = s.time;
  if (s.mayor?.city === id) s.mayor = null;
  const left = owned(s).filter(x => x.id !== id);
  victim.history.push({ day: Math.floor(s.time / D) + 1, what: 'perde', city: id, other: by.p.id });
  if (left.length) {
    if (s.capital === id) s.capital = left.sort((a, b) => b.lots.filter(Boolean).length - a.lots.filter(Boolean).length)[0].id;
  } else {
    // ultima città persa: diventa vassallo del conquistatore e riparte da una città libera vicino a lui,
    // oppure (mappa piena) da una città che il nuovo capo gli affida
    becomeVassal(victim, by);
    const free = REGION.some(id => !owner.has(id));
    if (free) {
      const [x, y] = XY(by.s!.capital);
      const nid = freeCityNear(x, y, victim.rr);
      const ns = newGame(9000 + victim.p.id * 31 + Math.floor(s.time), nid);
      const home = ns.cities[nid]; home.gang.nextAttackAt = s.time + 24 * H; home.since = s.time;
      s.cities[nid] = home; s.capital = nid; owner.set(nid, victim.p.id);
    } else if (!entrust(by, victim, s.time)) { victim.ev.senzaCitta = (victim.ev.senzaCitta ?? 0) + 1; s.missions = []; }
  }
  purgeCity(s, id);
  victim.mem.cands = []; by.mem.cands = [];
}

/** Dopo ogni ora: riporta sui proprietari quello che i loro rivali hanno fatto alle loro città. */
function sync() {
  // 1) conquiste e conflitti
  for (const pl of players) {
    if (!pl.s) continue; const s = pl.s;
    for (const c of owned(s)) {
      const was = owner.get(c.id);
      if (was === pl.p.id) continue;
      if (was === undefined) {
        if (pl.proxies.has(c.id)) pl.proxies.delete(c.id);
        if (c.proxy !== undefined) delete c.proxy;
        owner.set(c.id, pl.p.id); pl.ev.conquisteNpc++;
        pl.history.push({ day: Math.floor(s.time / D) + 1, what: 'conquista', city: c.id });
      } else {
        const snap = pl.proxies.get(c.id);
        if (snap && snap.owner === was && !friend(pl, was) && players[was].s?.capital === c.id) {
          // capitale presa: non si conquista, si sottomette. Il rivale tiene la città e diventa vassallo.
          const back = owned(s).find(x => x.id !== c.id && owner.get(x.id) === pl.p.id);
          if (back) for (const [u, n] of Object.entries(c.units)) if (n) back.units[u as UnitId] += n;
          purgeCity(s, c.id); pl.proxies.delete(c.id);
          const v = players[was]; pl.ev.sottomissioni = (pl.ev.sottomissioni ?? 0) + 1; v.ev.sottomesso = (v.ev.sottomesso ?? 0) + 1;
          v.ev.pvpSubiti++; v.ev.pvpPersi++; v.shieldUntil = v.s!.time + RULES.shieldHours * H; v.vassalSince = v.s!.time;
          if (v.lord !== pl.p.id) becomeVassal(v, pl);
          pl.history.push({ day: Math.floor(s.time / D) + 1, what: 'sottomette', other: was });
          v.history.push({ day: Math.floor(s.time / D) + 1, what: 'sottomesso', other: pl.p.id });
        } else if (snap && snap.owner === was && !friend(pl, was)) {
          // città presa a un altro giocatore
          delete c.proxy; pl.proxies.delete(c.id);
          owner.set(c.id, pl.p.id); pl.ev.conquistePvp++;
          pl.history.push({ day: Math.floor(s.time / D) + 1, what: 'conquistaPvp', city: c.id, other: was });
          players[was].ev.pvpSubiti++; players[was].ev.pvpPersi++;
          loseCity(players[was], c.id, pl);
        } else {
          // l'ha presa qualcun altro nella stessa ora: torna indietro, gli uomini a casa
          pl.ev.conflitti++;
          const back = owned(s).find(x => x.id !== c.id && owner.get(x.id) === pl.p.id);
          if (back) for (const [u, n] of Object.entries(c.units)) if (n) back.units[u as UnitId] += n;
          if (s.capital === c.id && back) s.capital = back.id;
          purgeCity(s, c.id);
        }
      }
    }
  }
  // 2) danni sulle città dei rivali
  for (const pl of players) {
    if (!pl.s) continue; const s = pl.s;
    for (const [id, snap] of pl.proxies) {
      const c = s.cities[id]; const victim = players[snap.owner]; const vs = victim.s;
      if (!c || c.proxy === undefined || !vs || owner.get(id) !== snap.owner) continue;
      const vc = vs.cities[id]; if (!vc) continue;
      let hit = false, lost = false;
      for (const [u, n0] of Object.entries(snap.units)) {
        const d = (n0 ?? 0) - (c.gang.units[u as UnitId] ?? 0); if (d <= 0) continue; hit = true;
        let left = d; const g = Math.min(vc.guards[u as UnitId] ?? 0, left); if (g) { vc.guards[u as UnitId] = (vc.guards[u as UnitId] ?? 0) - g; left -= g; }
        vc.units[u as UnitId] = Math.max(0, vc.units[u as UnitId] - left);
      }
      const loot = Math.max(0, snap.stash - c.gang.stash);
      if (loot > 1) { const take = Math.min(vs.res.sporco, loot); vs.res.sporco -= take; victim.ev.pvpBottinoPerso += take; hit = lost = true; }
      c.lots.forEach((l, i) => { if (l?.closedUntil && !snap.closed[i] && vc.lots[i]) { vc.lots[i]!.closedUntil = l.closedUntil; vc.lots[i]!.protectedUntil = l.protectedUntil; hit = lost = true; } });
      if (hit) { victim.ev.pvpSubiti++; if (lost) victim.ev.pvpPersi++; victim.mem.lastAttack = Math.max(victim.mem.lastAttack, power(null, snap.units, 'def') * 1.2); }
    }
  }
  // 3) tributi dei vassalli
  for (const pl of players) if (pl.s && pl.lord !== null && players[pl.lord].s) {
    const t = Math.min(pl.s.res.sporco, rates(pl.s).dirty * TRIBUTE);
    pl.s.res.sporco -= t; players[pl.lord].s!.res.sporco += t; pl.ev.tributoPagato += t; players[pl.lord].ev.tributoRicevuto += t;
  }
  // 3b) indipendenza dopo 14 giorni senza perdere città
  for (const pl of players) if (pl.s && pl.lord !== null && pl.s.time - pl.vassalSince >= RULES.independenceDays * D) freeVassal(pl, '14 giorni');
  // 3c) avvisi PvP: chi ha la postura difensiva recluta mentre l'attacco è in viaggio
  for (const pl of players) {
    if (!pl.s) continue;
    for (const m of pl.s.missions) {
      if (m.resolved || !(m.kind === 'assault' || m.kind === 'raid' || m.kind === 'strike')) continue;
      const key = m.id; const snap = pl.proxies.get(m.to); if (!snap) continue;
      const k = pl.p.id + ':' + key; if (pl.seenMissions.has(k)) continue; pl.seenMissions.add(k);
      const v = players[snap.owner]; const vc = v.s?.cities[m.to]; if (!vc || vc.owner !== 'player') continue;
      v.ev.posturaReclute += autoDefend(v.s!, vc, power(pl.s, m.units, 'att'), m.kind === 'strike' ? 'sabotaggio' : 'razzia');
    }
  }
  // 4) proxy aggiornati
  for (const pl of players) {
    if (!pl.s) continue;
    for (const id of [...pl.proxies.keys()]) { const o = owner.get(id); if (o === undefined || o === pl.p.id || protectedFrom(pl, o)) dropProxy(pl, id); else refreshProxy(pl, id); }
  }
}

// ---------------------------------------------------------------- calendario e partita
function planDay(pl: Player, day: number) {
  const p = pl.p; const r = pl.rr; pl.sessions = [];
  if (pl.away > 0) { pl.away--; return; }
  if (r() < p.breakProb) {
    pl.away = 3 + Math.floor(r() * 18);
    // chi sa che starà via prova la modalità vacanza (non tutti se ne ricordano)
    const s = pl.s; if (s && (p.testa !== 'impulsivo' ? r() < 0.8 : r() < 0.3)) { const d = Math.min(pl.away, vacationDaysLeft(s)); if (d >= 2) { const res = act(s, { t: 'vacation', days: d }); if (res.ok) { pl.ev.vacanze++; pl.ev.giorniVacanza += d; } } }
    return;
  }
  if (r() < p.offDay) return;
  const n = Math.max(1, Math.round(p.sessionsPerDay * (0.6 + r() * 0.8)));
  for (let k = 0; k < n; k++) { const st = day * D + (7 + r() * 17) * H; const len = p.sessionMin * (0.5 + r()) * 60; pl.sessions.push([st, st + len]); }
  pl.sessions.sort((a, b) => a[0] - b[0]);
}
function advanceTo(pl: Player, tEnd: number) {
  const s = pl.s!;
  while (s.time < tEnd) {
    const sess = pl.sessions.find(([a, b]) => b > s.time && a < tEnd);
    if (sess && sess[0] <= s.time) {
      if (!(pl as any)._in || (pl as any)._in !== sess) { (pl as any)._in = sess; pl.ev.sessions++; pl.ev.onlineMin += (sess[1] - sess[0]) / 60; }
      check(pl); tick(s, Math.min(5 * 60, sess[1] - s.time, tEnd - s.time), STEP); scanLog(pl, true);
    } else {
      const to = sess ? Math.min(sess[0], tEnd) : tEnd;
      tick(s, to - s.time, STEP); scanLog(pl, false);
    }
  }
}
function snapshot(pl: Player, day: number) {
  const s = pl.s!; const r = rates(s); const mine = owned(s);
  pl.daily.push([day, Math.round(s.res.sporco), Math.round(s.res.pulito), Math.round(r.dirty), Math.round(r.clean + r.laundering * (1 - r.launderFee)),
    mine.length, mine.reduce((a, c) => a + c.lots.filter(Boolean).length, 0), mine.reduce((a, c) => a + c.lots.length, 0),
    Math.round(Math.max(0, ...mine.map(c => c.heat))), Math.round(Math.max(0, ...mine.map(c => c.influence))),
    Math.round(mine.reduce((a, c) => a + power(s, c.units, 'def'), 0)), Math.round(s.stats.invested / 1000),
    Object.values(s.research).reduce((a, b) => a + b, 0), s.mayor ? 1 : 0, pl.ev.attLost, pl.ev.retate + pl.ev.indagini, pl.ev.conquisteNpc + pl.ev.conquistePvp,
    pl.ev.idleChecks, pl.ev.checks, mine.reduce((a, c) => a + c.lots.reduce((x, l) => x + (l?.level ?? 0), 0), 0),
    pl.ev.pvpSubiti, pl.ev.pvpPersi, pl.ev.cittaPerse, pl.lord === null ? -1 : pl.lord, pl.vassals.size, Math.round(power(s, mine.reduce((sq: Squad, c) => { for (const u of ['picchiatori', 'soldati', 'enforcer'] as UnitId[]) sq[u] = (sq[u] ?? 0) + c.units[u]; return sq; }, {}), 'att')), Math.round(investBonus(s) * 1000) / 10]);
}

for (let i = 0; i < NP; i++) players.push({ p: profile(i), s: null, rr: mulberry(77 + i * 31 + SEED * 9973), ev: Object.fromEntries(EV.map(k => [k, 0])), mem: { cands: [], candsAt: -1e9, lastAttack: 0, nextExpandCheck: 0 },
  sessions: [], away: 0, lastLog: -1, seenRep: 0, proxies: new Map(), lord: null, vassals: new Set(), allies: new Set(), shieldUntil: 0, vassalSince: 0, lastOnline: 0, joinedAt: 0, seenMissions: new Set(), daily: [], history: [] });

// ---------------------------------------------------------------- stagioni: ogni 90 giorni un evento di 21 giorni, annunciato 7 giorni prima
const SEASON_DAYS = SEASON_LENGTH;
function seasonDay(day: number) {
  for (const ev of SEASONS) {
    if (day === ev.day - 7) for (const pl of players) if (pl.s) pl.s.log.unshift({ t: pl.s.time, kind: 'warn', text: `Tra 7 giorni: ${ev.name}. ${ev.text}` });
    if (day === ev.day) {
      for (const pl of players) if (pl.s) pl.s.log.unshift({ t: pl.s.time, kind: 'warn', text: `Comincia: ${ev.name}. ${ev.text}` });
      applySeasonMods(ev.id);
      if (ev.id === 'cartelli') {
        for (const pl of players) if (pl.s) for (const c of Object.values(pl.s.cities)) if (c.owner === 'npc' && c.proxy === undefined) for (const u of Object.keys(c.gang.units) as UnitId[]) c.gang.units[u] = Math.floor((c.gang.units[u] ?? 0) * 0.4);
      }
      if (ev.id === 'giroDiVite') {
        const act_ = players.filter(x => x.s).sort((a, b) => scoreOf(b) - scoreOf(a));
        for (const pl of act_.slice(0, Math.ceil(act_.length * 0.1))) { pl.s!.policeShift = -15; pl.ev.giroDiVite = 1; }
      }
    }
    if (day === ev.day + SEASON_DAYS) {
      applySeasonMods(null);
      for (const pl of players) if (pl.s) pl.s.policeShift = 0;
    }
  }
}

const t0 = Date.now(); const worldDaily: any[] = [];
for (let day = 0; day < DAYS; day++) {
  seasonDay(day);
  for (const pl of players) { if (!pl.s && pl.p.joinDay <= day) { if (spawn(pl, day * D)) pl.ev.ritardoIngresso = day - pl.p.joinDay; } if (pl.s && !owned(pl.s).length && pl.lord !== null) entrust(players[pl.lord], pl, day * D); if (pl.s) planDay(pl, day); }
  for (let h = 1; h <= 24; h++) {
    const tEnd = day * D + h * H;
    for (const pl of players) if (pl.s && owned(pl.s).length) { const real = Math.random; Math.random = pl.rr; try { advanceTo(pl, tEnd); } finally { Math.random = real; } }
    sync();
  }
  for (const pl of players) if (pl.s && owned(pl.s).length) snapshot(pl, day + 1);
  const act_ = players.filter(p => p.s);
  const cities = act_.map(p => owned(p.s!).length).sort((a, b) => b - a);
  worldDaily.push({ day: day + 1, attivi: act_.length, cittaGiocatori: owner.size, vassalli: act_.filter(p => p.lord !== null).length, top10Citta: cities.slice(0, 10).reduce((a, b) => a + b, 0), maxCitta: cities[0] ?? 0,
    stagione: SEASON.id, conquisteNpc: act_.reduce((a, p) => a + p.ev.conquisteNpc, 0), conquistePvp: act_.reduce((a, p) => a + p.ev.conquistePvp, 0), indipendenze: act_.reduce((a, p) => a + p.ev.indipendenze, 0), riscatti: act_.reduce((a, p) => a + p.ev.riscatti, 0), inVacanza: act_.filter(p => p.s!.vacation).length, sporcoTot: act_.reduce((a, p) => a + rates(p.s!).dirty, 0), retate: act_.reduce((a, p) => a + p.ev.retate + p.ev.indagini, 0), retateTop: act_.filter(p => p.ev.giroDiVite).reduce((a, p) => a + p.ev.retate + p.ev.indagini, 0),
    pvpSubiti: act_.reduce((a, p) => a + p.ev.pvpSubiti, 0), pvpPersi: act_.reduce((a, p) => a + p.ev.pvpPersi, 0), cittaPerse: act_.reduce((a, p) => a + p.ev.cittaPerse, 0) });
  if ((day + 1) % 5 === 0 || day < 3) console.log(`giorno ${day + 1} | ${((Date.now() - t0) / 1000).toFixed(0)}s | attivi ${act_.length} | città dei giocatori ${owner.size} | vassalli ${worldDaily.at(-1).vassalli} | max città ${cities[0]} | pvp subiti ${worldDaily.at(-1).pvpSubiti} persi ${worldDaily.at(-1).pvpPersi} | città perse ${worldDaily.at(-1).cittaPerse} | npc ${worldDaily.at(-1).conquisteNpc} | indip ${worldDaily.at(-1).indipendenze} riscatti ${worldDaily.at(-1).riscatti}`);
  if ((day + 1) % 30 === 0 || day === DAYS - 1) {
    writeFileSync(`${DIR}/world.json`, JSON.stringify({ region: REGION.length, tulsa: String(tulsa), daily: worldDaily }));
    writeFileSync(`${DIR}/players.jsonl`, players.map(pl => JSON.stringify({ p: pl.p, ev: pl.ev, daily: pl.daily, history: pl.history, lord: pl.lord, vassals: [...pl.vassals], capital: pl.s?.capital, cities: pl.s ? owned(pl.s).map(c => c.id) : [], research: pl.s?.research })).join('\n'));
  }
}
console.log('fatto in', ((Date.now() - t0) / 1000).toFixed(0), 's');
