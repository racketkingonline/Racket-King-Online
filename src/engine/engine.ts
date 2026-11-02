// Motore delle regole: puro TypeScript, nessuna dipendenza da DOM o React.
// Pensato per girare identico nel browser (prototipo) e sul server (dopo).
// Le funzioni lavorano sullo stato in place; il caso passa da un RNG con seme salvato nello stato.

import { M, N, render, t, type Lang, type Msg } from '../i18n';
import {
  BUILDINGS, FRONTS, K, PAYROLL, RACKETS, RESEARCH, UNITS,
  type BuildingId, type Category, type CityDef, type Cost, type FlagId, type FrontId, type RacketId,
  type Requirement, type ResearchId, type UnitId,
} from './data';
import { blockFit, blockRoads, layout, lotsAdjacent, lotZone, nearPolice } from './layout';
import { CITY_COUNT, cityDef, cityRaw, gangName, hash01 } from './world';

// ---------------------------------------------------------------- tipi
export type LogKind = 'info' | 'good' | 'warn' | 'bad';
/** text = testo italiano (per compatibilità e ricerche); m = messaggio da tradurre nella lingua di chi legge. */
export type LogEntry = { t: number; kind: LogKind; text: string; city?: string; m?: Msg };
export type UseKind = 'racket' | 'front' | 'building';
export type HostedId = 'qg' | 'cassaforte';
/** Un edificio su un lotto. hosted = QG o cassaforte nascosti dentro; closedUntil = chiuso dopo un colpo. */
export type LotUse = { kind: UseKind; id: string; level: number; hosted?: { id: HostedId; level: number }; closedUntil?: number; protectedUntil?: number };
export type MoveJob = { id: HostedId; level: number; toLot: number; host: boolean; end: number; start?: number; from?: number; fromHost?: boolean };
export type BuildJob = { lot: number; kind: UseKind; id: string; level: number; start: number; end: number; cost: Cost };
export type ResearchJob = { id: ResearchId; level: number; start: number; end: number; cost: Cost };
export type UnitJob = { id: UnitId; n: number; done: number; per: number; nextAt: number };
export type Squad = Partial<Record<UnitId, number>>;
export type MissionKind = 'raid' | 'spy' | 'assault' | 'transfer' | 'strike';
export type Mission = { id: number; kind: MissionKind; from: string; to: string; units: Squad; arriveAt: number; returnAt: number; resolved: boolean; loot: number; stay: boolean; lot?: number; recalled?: boolean };
/** label = nome italiano (chiave di traduzione); m = versione traducibile se il nome ha parti variabili. */
export type Effect = { id: string; until: number; label: string; m?: Msg; category?: Category; mult?: number; pressure?: number };
export type Intel = { at: number; units: Squad; stash: number; share: number; defense: number; quality?: 'partial' | 'complete'; lots?: (LotUse | null)[]; qgKnown?: boolean };
export type Incoming = { kind: 'razzia' | 'sabotaggio'; units: Squad; arriveAt: number; from?: string };
export type Gang = {
  name: string; units: Squad; stash: number; share: number; mult: number;
  nextAttackAt: number; lastGrowAt: number; incoming: Incoming | null; intel: Intel | null;
};

export type CityState = {
  /** Multiplayer: città di un altro giocatore vista da qui (id del proprietario). Non cresce e non attacca da sola. */
  proxy?: number;
  /** Multiplayer: la città vista è la capitale del suo proprietario (prenderla lo sottomette: non serve il Delfino). */
  proxyCapital?: boolean;
  /** Presa a un altro giocatore: non può diventare la tua capitale. */
  taken?: boolean;
  id: string; owner: 'player' | 'npc'; since: number;
  gang: Gang;
  lots: (LotUse | null)[];
  units: Record<UnitId, number>;
  guards: Squad;
  heat: number; heatSpike: number; influence: number;
  payroll: number;
  /** Giri dei racket piazzati sugli isolati (chiave = indice dell'isolato). */
  turf: Record<string, RacketId[]>;
  /** Punti protezione del libro paga piazzati sugli isolati. */
  protect: Record<string, number>;
  tileWarn: Record<string, number>;
  flags: Partial<Record<FlagId, boolean>>;
  cooldowns: Partial<Record<string, number>>;
  warned: { controlli: number; retata: number; indagine: number };
  buildQueue: BuildJob | null;
  unitQueue: UnitJob[];
  effects: Effect[];
  move: MoveJob | null;
  campaign: { ends: number } | null;
  alertUntil: number;
};

export type BattleReport = {
  id: number; t: number; kind: 'raid' | 'assault' | 'defense' | 'sabotage' | 'spy' | 'strike' | 'mayor' | 'police'; city: string; title: string; win: boolean;
  att: number; def: number; defMen: number; defFort: number; lostMine: number; lostTheirs: number;
  loot: number; lines: string[]; advice: string; seen: boolean;
  /** Versione traducibile di titolo, righe e consiglio. */
  m?: { title: Msg; lines: Msg[]; advice: Msg };
};

export type GameState = {
  version: 4;
  seed: number; rng: number; time: number;
  capital: string;
  res: { sporco: number; pulito: number };
  research: Record<ResearchId, number>;
  researchQueue: ResearchJob | null;
  cities: Record<string, CityState>;
  missions: Mission[]; nextMissionId: number;
  launderShare: number;
  stats: { invested: number; laundered: number; seized: number; looted: number; raids: number; conquests: number };
  log: LogEntry[];
  reports: BattleReport[]; nextReportId: number;
  mayor: { city: string; termEnds: number } | null;
  /** Modalità vacanza: niente produzione, niente attacchi, tutto fermo. Al massimo K.vacationDaysPerYear giorni l'anno. */
  vacation?: { start: number; until: number } | null;
  vacationLog?: { start: number; days: number }[];
  /** Postura difensiva: all'avviso di un attacco recluta da sola fino a coprirlo, spendendo al massimo questa quota del contante sporco. */
  posture?: { auto: boolean; share: number };
  /** Spostamento delle soglie di polizia (eventi di stagione: negativo = la polizia ti guarda di più). */
  policeShift?: number;
  /** Contante pulito investito in attività di facciata (immobili, appalti): aumenta tutte le rendite, con rendimenti decrescenti. */
  investments?: number;
  /** Ultima conquista e ultimo spostamento della capitale; momento d'ingresso nel mondo. */
  lastConquest?: number;
  capitalMovedAt?: number;
  /** Delfino in arruolamento: binario a parte, non blocca gli altri reclutamenti. */
  heir?: { start: number; end: number } | null;
  born?: number;
  /** Ritratto scelto dal giocatore (id dell'illustrazione) e introduzione già vista. */
  avatar?: string;
  introSeen?: boolean;
};

/** Modificatori di stagione, uguali per tutto il server. */
export const SEASON: { id: string | null; income: Partial<Record<Category, number>>; heat: Partial<Record<Category, number>>; npc: number } = { id: null, income: {}, heat: {}, npc: 1 };

export type PoliceAction = 'soffiata' | 'occhio' | 'bustarella';
export type MayorAction = 'boxe' | 'fiera' | 'beneficenza' | 'zonizzazione' | 'licenzaCasino';

export type Action =
  | { t: 'build'; city: string; lot: number; kind: UseKind; id: string }
  | { t: 'upgrade'; city: string; lot: number }
  | { t: 'demolish'; city: string; lot: number }
  | { t: 'research'; id: ResearchId }
  | { t: 'cancel'; city?: string; queue: 'build' | 'research' }
  | { t: 'recruit'; city: string; id: UnitId; n: number }
  | { t: 'guard'; city: string; id: UnitId; n: number }
  | { t: 'mission'; kind: MissionKind; from: string; to: string; units: Squad; lot?: number }
  | { t: 'acquire'; from: string; city: string }
  | { t: 'payroll'; city: string; level: number }
  | { t: 'police'; city: string; id: PoliceAction; target?: string }
  | { t: 'mayor'; city: string; id: MayorAction }
  | { t: 'promote'; city: string; racket: RacketId }
  | { t: 'turf'; city: string; block: number; racket: RacketId; op: 'add' | 'remove' }
  | { t: 'protect'; city: string; block: number; delta: number }
  | { t: 'autoTurf'; city: string }
  | { t: 'move'; city: string; what: HostedId; toLot: number }
  | { t: 'reopen'; city: string; lot: number }
  | { t: 'campaign'; city: string }
  | { t: 'launder'; share: number }
  | { t: 'vacation'; days: number }
  | { t: 'posture'; auto: boolean; share: number }
  | { t: 'invest'; amount: number }
  | { t: 'cancelUnits'; city: string; index: number }
  | { t: 'cancelHeir' }
  | { t: 'recall'; mission: number }
  | { t: 'setCapital'; city: string }
  | { t: 'cancelMove'; city: string }
  | { t: 'cancelCampaign'; city: string };

export type Result = { ok: true; msg?: string; m?: Msg } | { ok: false; msg: string; m?: Msg };

// ---------------------------------------------------------------- RNG
export function rand(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (s: { rng: number }, a: number, b: number) => a + (b - a) * rand(s);
const sround = (s: { rng: number }, x: number) => Math.floor(x) + (rand(s) < x - Math.floor(x) ? 1 : 0);
const H = 3600;

// ---------------------------------------------------------------- città e lotti
const zero = <T extends string>(ids: readonly { id: T }[]) => Object.fromEntries(ids.map(d => [d.id, 0])) as Record<T, number>;
export const def = (id: string): CityDef => cityDef(id);
export const cityName = (id: string) => def(id).name;
export const lotCount = (id: string) => layout(id).lots.length;
const allLotCount = (id: string) => layout(id).lotBlocks.length;

function emptyCity(id: string, owner: 'player' | 'npc', gang: Gang): CityState {
  return {
    id, owner, since: 0, gang, lots: Array(allLotCount(id)).fill(null),
    units: zero(UNITS) as Record<UnitId, number>, guards: {},
    heat: 0, heatSpike: 0, influence: 0, payroll: 0, turf: {}, protect: {}, tileWarn: {}, flags: {}, cooldowns: {},
    warned: { controlli: 0, retata: 0, indagine: 0 },
    buildQueue: null, unitQueue: [], effects: [], move: null, campaign: null, alertUntil: 0,
  };
}

/** Livello del racket (uno per tipo), livello del QG, somma dei livelli per gli edifici ripetibili. */
export function racketLevel(c: CityState, id: RacketId) { return c.lots.find(l => l?.kind === 'racket' && l.id === id)?.level ?? 0; }
export const isOpen = (l: LotUse | null | undefined): l is LotUse => !!l && !l.closedUntil;
/** Livello attivo di una struttura: edifici aperti più QG/cassaforte nascosti dentro attività aperte. */
export function buildingLevel(c: CityState, id: BuildingId) {
  return c.lots.reduce((a, l) => a + (isOpen(l) ? (l.kind === 'building' && l.id === id ? l.level : 0) + (l.hosted?.id === id ? l.hosted.level : 0) : 0), 0);
}
/** Dove sta il QG (o la cassaforte): lotto, e se è nascosto dentro un'altra attività. */
export function whereIs(c: CityState, id: HostedId): { lot: number; hosted: boolean; level: number } | null {
  for (let i = 0; i < c.lots.length; i++) {
    const l = c.lots[i]; if (!l) continue;
    if (l.kind === 'building' && l.id === id) return { lot: i, hosted: false, level: l.level };
    if (l.hosted?.id === id) return { lot: i, hosted: true, level: l.hosted.level };
  }
  return null;
}
export const isMayorOf = (s: GameState, cityId: string) => s.mayor?.city === cityId;
/** Lotti utilizzabili: i 2 lotti in più solo per il sindaco. */
export const usableLots = (s: GameState | null, c: CityState) => layout(c.id).lots.length + (s && isMayorOf(s, c.id) ? layout(c.id).extraLots.length : 0);
export function frontLevels(c: CityState, id: FrontId) { return c.lots.reduce((a, l) => a + (l?.kind === 'front' && l.id === id ? l.level : 0), 0); }
export const freeLots = (c: CityState, s: GameState | null = null) => c.lots.map((l, i) => (l || c.buildQueue?.lot === i || (c.move && !c.move.host && c.move.toLot === i) || i >= usableLots(s, c) ? -1 : i)).filter(i => i >= 0);

/** Lotti in cui sistemare le prime attività: un QG centrale, il pizzo in periferia, la cassaforte. */
function pickLot(c: CityState, prefer: string[]) {
  const free = freeLots(c);
  for (const z of prefer) { const i = free.find(i => lotZone(c.id, i) === z); if (i !== undefined) return i; }
  return free[0];
}

export function newGame(seed = (Date.now() % 2147483647) | 0, cityId?: string): GameState {
  const r = { rng: seed };
  let startId = cityId;
  while (!startId) { const i = Math.floor(rand(r) * CITY_COUNT); const p = cityRaw(i)[5]; if (p >= 10000 && p < 250000) startId = String(i); }
  const start = def(startId);
  const home = emptyCity(start.id, 'player', {
    name: '', units: {}, stash: 0, share: 0,
    mult: 1, nextAttackAt: 1e15, lastGrowAt: 0, incoming: null, intel: null,
  });
  home.lots[pickLot(home, ['centro'])] = { kind: 'building', id: 'qg', level: 1 };
  home.lots[pickLot(home, ['periferia', 'industriale'])] = { kind: 'racket', id: 'pizzo', level: 1 };
  home.lots[pickLot(home, ['centro', 'periferia'])] = { kind: 'building', id: 'cassaforte', level: 1 };
  home.units = { ...home.units, ...K.start.units } as Record<UnitId, number>;
  autoPlace(home);
  const state: GameState = {
    version: 4, seed, rng: r.rng, time: 0, capital: start.id,
    res: { sporco: K.start.sporco, pulito: K.start.pulito },
    research: zero(RESEARCH), researchQueue: null,
    cities: { [start.id]: home }, missions: [], nextMissionId: 1, launderShare: 0.5,
    stats: { invested: 0, laundered: 0, seized: 0, looted: 0, raids: 0, conquests: 0 },
    log: [], reports: [], nextReportId: 1, mayor: null,
  };
  home.gang.nextAttackAt = (K.protectionHours + between(state, K.rivalAttackMin, K.rivalAttackMax)) * H;
  log(state, 'info', M('Ti hanno mandato a {city}, {county} County, {state}. Sei uomini, una valigia di contanti e una città tutta per te. Le bande delle città vicine hanno {h} ore prima di accorgersi di te. In città ci sono {lots} lotti su cui costruire: scegli bene.',
    { city: start.name, county: start.county, state: start.state, h: K.protectionHours, lots: lotCount(start.id) }), start.id);
  return state;
}
/** La guarnigione di una banda del server: poche decine di uomini, fissi per città (variano entro le forbici di K.npcSquad). */
export function npcSquad(id: string): Squad {
  const sq: Squad = {};
  for (const [u, r] of Object.entries(K.npcSquad)) { const [lo, hi] = r!; sq[u as UnitId] = Math.round((lo + (hi - lo) * hash01('npc:' + id + ':' + u)) * SEASON.npc); }
  return sq;
}

/** Aggiorna un salvataggio di una versione precedente (stessa struttura, campi nuovi mancanti). */
export function migrate(s: GameState): GameState {
  s.reports ??= []; s.nextReportId ??= 1; s.mayor ??= null;
  for (const c of Object.values(s.cities)) {
    c.turf ??= {}; c.protect ??= {}; c.tileWarn ??= {}; c.cooldowns ??= {}; c.flags ??= {};
    c.units.delfino ??= 0;
    if (c.owner === 'npc' && c.proxy === undefined) { const cap = npcSquad(c.id); for (const u of Object.keys(c.gang.units) as UnitId[]) c.gang.units[u] = Math.min(c.gang.units[u] ?? 0, cap[u] ?? 0); }
    c.influence ??= 0; c.payroll ??= 0; c.move ??= null; c.campaign ??= null; c.alertUntil ??= 0;
    while (c.lots.length < allLotCount(c.id)) c.lots.push(null);
    if (c.owner === 'player') { c.gang.share = 0; c.gang.units = {}; if (c.gang.incoming && !c.gang.incoming.from) c.gang.incoming = null; }
    if (c.owner === 'player' && !Object.keys(c.turf).length) autoPlace(c);
    if (c.owner === 'npc' && !c.lots.some(Boolean)) gangAssets(c, s.time / 86400);
  }
  return s;
}

/** Stato di una città: quelle mai toccate non sono salvate e vengono generate al volo. */
export function peekCity(s: GameState, id: string): CityState {
  const have = s.cities[id]; if (have) return have;
  const d = def(id); const days = s.time / (24 * H); const mult = 1;
  const c = emptyCity(id, 'npc', {
    name: gangName(id), units: npcSquad(id), stash: Math.round(Math.min(500000 * d.pop, (8000 + 12000 * days) * d.pop)),
    share: 1, mult, nextAttackAt: 1e15, lastGrowAt: Math.floor(s.time / (6 * H)) * 6 * H, incoming: null, intel: null,
  });
  gangAssets(c, days);
  return c;
}

/** Gli edifici di una banda: QG, cassaforte, qualche racket e attività legali. Posizioni fisse per città, livelli che crescono col tempo. */
function gangAssets(c: CityState, days: number) {
  const d = def(c.id); const base = layout(c.id).lots.length;
  let a = 0; for (const ch of 'gang:' + c.id) a = (Math.imul(a ^ ch.charCodeAt(0), 16777619) + 0x9e3779b9) | 0;
  const r = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const free = Array.from({ length: base }, (_, i) => i);
  for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
  const lv = (k: number) => Math.max(1, Math.min(12, 1 + Math.floor(days * k * (0.6 + 0.4 * r()))));
  const put = (u: LotUse) => { const i = free.shift(); if (i !== undefined) c.lots[i] = u; };
  put({ kind: 'building', id: 'qg', level: lv(0.5) });
  put({ kind: 'building', id: 'cassaforte', level: lv(0.4) });
  const rk = RACKETS.map(x => x.id).filter((id, i) => i < 4 + Math.floor(d.pop) && id !== 'armi' || d.pop >= 2);
  for (let i = rk.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [rk[i], rk[j]] = [rk[j], rk[i]]; }
  const nR = Math.min(rk.length, 2 + Math.floor(d.pop));
  for (let i = 0; i < nR; i++) put({ kind: 'racket', id: rk[i], level: lv(0.7) });
  const fr = ['bar', 'lavanderia', 'concessionaria', 'nightclub'];
  for (let i = 0; i < 1 + Math.floor(d.pop / 2); i++) put({ kind: 'front', id: fr[Math.floor(r() * fr.length)], level: lv(0.6) });
  if (r() < 0.6) put({ kind: 'building', id: 'armeria', level: lv(0.4) });
}
const validCity = (id: string) => Number(id) >= 0 && Number(id) < CITY_COUNT && String(Number(id)) === id;
export function materialize(s: GameState, id: string): CityState {
  if (!s.cities[id]) { if (!validCity(id)) throw new Error('città sconosciuta'); s.cities[id] = peekCity(s, id); }
  return s.cities[id];
}

export const owned = (s: GameState) => Object.values(s.cities).filter(c => c.owner === 'player');
export const statesHeld = (s: GameState) => new Set(owned(s).map(c => def(c.id).stateAbbr));
/** Influenza minima nella città di partenza per operare in uno stato dove non hai città. */
export function influenceNeeded(s: GameState, targetId: string) {
  const held = statesHeld(s);
  return held.has(def(targetId).stateAbbr) ? 0 : K.stateInfluenceBase + K.stateInfluenceStep * (held.size - 1);
}
export const inheritShare = (from: string, to: string) => def(from).stateAbbr === def(to).stateAbbr ? K.inheritSameState : K.inheritOtherState;

// ---------------------------------------------------------------- messaggi
/** Nome traducibile di un racket, attività o struttura. */
const nm = (kind: string, id: string) => N(nameOf(kind, id));
/** Nome traducibile in minuscolo (dentro una frase). */
const lc = (name: string) => N(name.toLowerCase());
const unitLc = (id: string) => lc(UNITS.find(u => u.id === id)!.name);
/** "3 soldati"; con 1 tutta la frase è la chiave ("1 soldati" → "1 soldier"), così l'inglese può usare il singolare. */
const unitCount = (n: number, id: string): Msg => (n === 1 ? N('1 ' + UNITS.find(u => u.id === id)!.name.toLowerCase()) : M('{n} {units}', { n, units: unitLc(id) }));
/** Nome traducibile di una banda (il nome italiano è la chiave: "i Moreno" → "the Morenos"). */
export const gangMsg = (name: string) => N(name);
/** Lo stesso, con l'iniziale maiuscola (a inizio frase). */
export const gangMsgCap = (name: string) => N(cap(name));
export const gangNameMsg = (id: string) => gangMsg(gangName(id));
/** Unisce più messaggi con uno spazio (frasi) o una virgola (elenchi). */
export function joinMsg(list: Msg[], sep: ' ' | ', ' = ' '): Msg {
  if (!list.length) return N('');
  return list.slice(1).reduce((a, b) => M(sep === ' ' ? '{a} {b}' : '{a}, {b}', { a, b }), list[0]);
}

export function log(s: GameState, kind: LogKind, text: string | Msg, city?: string) {
  const m = typeof text === 'string' ? undefined : text;
  s.log.unshift({ t: s.time, kind, text: m ? render(m, 'it') : (text as string), city, ...(m ? { m } : {}) });
  if (s.log.length > 250) s.log.length = 250;
}

// ---------------------------------------------------------------- costi e requisiti
const scale = (c: Cost, f: number): Cost => ({
  sporco: c.sporco ? Math.round(c.sporco * f) : undefined,
  pulito: c.pulito ? Math.round(c.pulito * f) : undefined,
  influenza: c.influenza ? Math.round(c.influenza * f) : undefined,
});
export const totalCost = (c: Cost) => (c.sporco ?? 0) + (c.pulito ?? 0);
export const useDef = (kind: UseKind, id: string): { id: string; name: string; desc: string; req?: Requirement } =>
  (kind === 'racket' ? RACKETS : kind === 'front' ? FRONTS : BUILDINGS).find((x: { id: string }) => x.id === id)!;
export const nameOf = (kind: string, id: string) => useDef(kind as UseKind, id).name;

export function upgradeCost(kind: UseKind, id: string, toLevel: number): Cost {
  if (kind === 'racket') { const d = RACKETS.find(r => r.id === id)!; return { sporco: Math.round(d.baseCost * d.costGrowth ** (toLevel - 1)) }; }
  if (kind === 'front') { const d = FRONTS.find(r => r.id === id)!; return scale(d.baseCost, d.costGrowth ** (toLevel - 1)); }
  const d = BUILDINGS.find(r => r.id === id)!; return scale(d.baseCost, d.costGrowth ** (toLevel - 1));
}
export function researchCost(id: ResearchId, toLevel: number): Cost {
  const d = RESEARCH.find(r => r.id === id)!; return scale(d.baseCost, d.costGrowth ** (toLevel - 1));
}
export const payrollCost = (level: number): Cost => ({ sporco: Math.round(K.payrollBase * K.payrollGrowth ** (level - 1)) });
const maxBuilding = (s: GameState, id: BuildingId) => Math.max(0, ...owned(s).map(x => buildingLevel(x, id)));
export function buildHours(c: CityState, cost: Cost) { return Math.max(10 / H, totalCost(cost) / (K.buildDivisor * (1 + buildingLevel(c, 'qg')))); }
export function researchHours(s: GameState, c: Cost) { return Math.max(10 / H, totalCost(c) / (K.buildDivisor * 0.8 * (1 + 0.5 * maxBuilding(s, 'qg')))); }
export function unitHours(c: CityState, id: UnitId) { const d = UNITS.find(u => u.id === id)!; if (d.hours) return d.hours; return Math.max(5 / H, totalCost(d.cost) / (K.unitDivisor * (1 + buildingLevel(c, 'armeria')))); }

/** I soldi sono dell'impero; l'influenza è della città che agisce. */
export const canAfford = (s: GameState, c: Cost, city?: CityState) =>
  s.res.sporco >= (c.sporco ?? 0) && s.res.pulito >= (c.pulito ?? 0) && (!c.influenza || (city?.influence ?? 0) >= c.influenza);
function pay(s: GameState, c: Cost, city?: CityState, sign = 1) {
  s.res.sporco -= sign * (c.sporco ?? 0); s.res.pulito -= sign * (c.pulito ?? 0);
  if (c.influenza && city) city.influence -= sign * c.influenza;
}

// I requisiti di edificio valgono per la città; quelli di know-how per tutto l'impero.
export function missingReqMsg(s: GameState, c: CityState | null, r?: Requirement): Msg[] {
  if (!r) return [];
  const out: Msg[] = [];
  for (const [id, lv] of Object.entries(r.building ?? {})) {
    const have = c ? buildingLevel(c, id as BuildingId) : maxBuilding(s, id as BuildingId);
    if (have < (lv as number)) out.push(M('{what} {lv}', { what: N(BUILDINGS.find(b => b.id === id)!.name), lv: lv as number }));
  }
  for (const [id, lv] of Object.entries(r.research ?? {})) if (s.research[id as ResearchId] < (lv as number)) out.push(M('{what} {lv}', { what: N(RESEARCH.find(b => b.id === id)!.name), lv: lv as number }));
  if (r.flag && !c?.flags[r.flag]) out.push(N(r.flag === 'licenzaCasino' ? 'Licenza per il casinò (municipio)' : 'Zonizzazione'));
  return out;
}
/** Requisiti mancanti come testo (in italiano se non indichi la lingua). */
export const missingReq = (s: GameState, c: CityState | null, r?: Requirement, lang: Lang = 'it'): string[] => missingReqMsg(s, c, r).map(m => render(m, lang));

// ---------------------------------------------------------------- giri, ronde e protezioni
export const giriTotal = (c: CityState, r: RacketId) => Math.ceil(racketLevel(c, r) / K.levelsPerGiro);
export const giriPlaced = (c: CityState, r: RacketId) => Object.values(c.turf).reduce((a, l) => a + l.filter(x => x === r).length, 0);
export const giriOn = (c: CityState, block: number) => c.turf[block] ?? [];

/** Isolati in mano alla banda rivale: tanti quanto la sua fetta, i più lontani dal tuo QG. */
export function gangBlocks(c: CityState): Set<number> {
  const L = layout(c.id); if (c.owner !== 'player') return new Set(L.turf);
  if (c.gang.share <= 0) return new Set();
  const qgLot = c.lots.findIndex(l => l?.kind === 'building' && l.id === 'qg');
  const home = L.blocks[qgLot >= 0 ? L.lots[qgLot] : L.mayor];
  const n = Math.round(c.gang.share * L.turf.length * K.gangTurfShare);
  const sorted = [...L.turf].sort((a, b) => {
    const A = L.blocks[a], B = L.blocks[b];
    const da = Math.abs(A.gx - home.gx) + Math.abs(A.gy - home.gy), db = Math.abs(B.gx - home.gx) + Math.abs(B.gy - home.gy);
    return db - da || A.seed - B.seed;
  });
  return new Set(sorted.slice(0, n));
}
export function activeRoutes(c: CityState) {
  const L = layout(c.id); return c.heat >= K.highRouteHeat ? [...L.routeMain, ...L.routeHigh] : L.routeMain;
}
/** Passaggi di volanti all'ora su ogni lato di strada pattugliato. */
export const patrolRate = (c: CityState) => K.patrolBase + c.heat * K.patrolPerHeat;
export function exposure(c: CityState, block: number) {
  const routes = new Set(activeRoutes(c)); return blockRoads(layout(c.id).blocks[block]).filter(r => routes.has(r)).length;
}
export const tileGrade = (c: CityState, block: number) => Math.max(0, giriOn(c, block).length - (c.protect[block] ?? 0));
export type TileRisk = { grade: number; exposure: number; risk: number; level: 0 | 1 | 2 | 3 | 4 };
export function tileRisk(c: CityState, block: number): TileRisk {
  const grade = tileGrade(c, block), e = exposure(c, block), risk = grade * e * patrolRate(c);
  const level = grade === 0 ? 0 : risk >= K.riskRed ? 4 : risk >= K.riskOrange ? 3 : risk >= K.riskYellow ? 2 : 1;
  return { grade, exposure: e, risk, level };
}
export const protectUsed = (c: CityState) => Object.values(c.protect).reduce((a, n) => a + n, 0);
export function presidio(c: CityState) {
  const blocks = Object.values(c.turf).filter(l => l.length > 0).length;
  const required = blocks * K.presidioPerBlock;
  const avail = c.units.picchiatori + c.units.soldati + c.units.enforcer;
  return { blocks, required, avail, coverage: required === 0 ? 1 : 0.3 + 0.7 * Math.min(1, avail / required) };
}

/** Piazza i giri non ancora assegnati sugli isolati migliori (resa alta, lontano dalle ronde, non della banda). */
export function autoPlace(c: CityState) {
  const L = layout(c.id); const gang = gangBlocks(c);
  for (const r of RACKETS) {
    while (giriPlaced(c, r.id) < giriTotal(c, r.id)) {
      let best = -1, bestScore = -Infinity;
      for (const b of L.turf) {
        if (gang.has(b) || giriOn(c, b).length >= K.maxGiriPerBlock) continue;
        const e = exposure(c, b); const stack = giriOn(c, b).length;
        const score = blockFit(c.id, b, r.id) * 10 - e * 3 - stack * 2 + (stack > 0 ? 1 : 0);
        if (score > bestScore) { bestScore = score; best = b; }
      }
      if (best < 0) break;
      (c.turf[best] ??= []).push(r.id);
    }
  }
}
/** Toglie i giri in eccesso (racket chiuso o declassato) e quelli finiti sotto la banda. */
function trimTurf(c: CityState) {
  const gang = gangBlocks(c);
  for (const k of Object.keys(c.turf)) if (gang.has(Number(k))) delete c.turf[k];
  for (const r of RACKETS) {
    let extra = giriPlaced(c, r.id) - giriTotal(c, r.id);
    for (const k of Object.keys(c.turf)) { while (extra > 0 && c.turf[k].includes(r.id)) { c.turf[k].splice(c.turf[k].indexOf(r.id), 1); extra--; } if (!c.turf[k].length) delete c.turf[k]; }
  }
  let over = protectUsed(c) - c.payroll;
  for (const k of Object.keys(c.protect)) { while (over > 0 && c.protect[k] > 0) { c.protect[k]--; over--; } if (!c.protect[k]) delete c.protect[k]; }
}

// ---------------------------------------------------------------- economia
export function demand(_s: GameState, c: CityState, cat: Category): number {
  let d = def(c.id).demand[cat] ?? 40;
  for (const e of c.effects) if (e.category === cat && e.mult) d *= e.mult;
  if (cat === 'notte' && c.flags.zonizzazione) d *= 1.25;
  return Math.min(150, d);
}
const saturate = (raw: number, cap: number) => (cap <= 0 ? 0 : cap * (1 - Math.exp(-raw / cap)));
const lvlCurve = (L: number) => L * 1.1 ** L;

/** Moltiplicatori di quartiere. */
function zoneMult(c: CityState, lot: number, what: 'income' | 'heat' | 'clean' | 'influence', id: string) {
  const z = lotZone(c.id, lot);
  if (what === 'income') return z === 'industriale' ? 1.1 : z === 'porto' && id === 'contrabbando' ? 1.4 : 1;
  if (what === 'heat') return (z === 'centro' ? 1.3 : z === 'periferia' ? 0.75 : z === 'industriale' ? 0.85 : 1) * (nearPolice(c.id, lot) ? K.policeAdjHeat : 1);
  if (what === 'clean') return z === 'centro' ? 1.25 : z === 'periferia' ? 0.85 : z === 'industriale' ? 0.9 : z === 'porto' && id === 'logistica' ? 1.2 : 1;
  return z === 'centro' ? 1.2 : 1;
}

/** Sinergia: ogni front collegato dà +8% per livello, +12% se è in un isolato vicino. */
export function synergy(c: CityState, racket: RacketId) {
  const rl = c.lots.findIndex(l => l?.kind === 'racket' && l.id === racket);
  let b = 0;
  c.lots.forEach((l, i) => {
    if (!isOpen(l) || l.kind !== 'front') return;
    const f = FRONTS.find(x => x.id === l.id)!;
    if (!f.synergy?.includes(racket)) return;
    b += l.level * (rl >= 0 && lotsAdjacent(c.id, rl, i) ? K.adjSynergy : 0.08);
  });
  return Math.min(0.6, b);
}

const safeOf = (level: number) => Math.round(K.safeBase * K.safeGrowth ** (level - 1));
/** Contante protetto dalle razzie: casseforti aperte, anche quelle nascoste nelle attività. */
export function safeCap(s: GameState, police = false) {
  let t = 0;
  for (const c of owned(s)) for (const l of c.lots) {
    if (!isOpen(l)) continue;
    if (l.kind === 'building' && l.id === 'cassaforte') t += safeOf(l.level);
    // una cassaforte nascosta in un racket non protegge dalla polizia: se trovano il racket, trovano i soldi
    if (l.hosted?.id === 'cassaforte' && !(police && l.kind === 'racket')) t += safeOf(l.hosted.level);
  }
  return t;
}
export const exposed = (s: GameState) => Math.max(0, s.res.sporco - safeCap(s));
export const exposedPolice = (s: GameState) => Math.max(0, s.res.sporco - safeCap(s, true));

export const cityLimit = (s: GameState) => 1 + s.research.gestione;
export function efficiency(s: GameState) {
  const over = Math.max(0, owned(s).length - cityLimit(s));
  return Math.max(K.overFloor, 1 - K.overPenalty * over) * (1 + investBonus(s));
}
/** Bonus sulle rendite dagli investimenti puliti: fino a +30%, la metà circa con 7 milioni. */
export const investBonus = (s: GameState) => K.investMax * (1 - Math.exp(-(s.investments ?? 0) / K.investScale));
export const indagineThreshold = (s: GameState) => Math.max(K.federalFloor - (s.mayor ? K.mayorFederal : 0), K.thresholds.indagine - K.federalDrop * (owned(s).length - 1) - (s.mayor ? K.mayorFederal : 0));

export type LotRates = { dirty: number; clean: number; launder: number; influence: number; heat: number; cover: number };
export type CityRates = {
  lots: (LotRates | null)[];
  presidio: ReturnType<typeof presidio>;
  racket: Record<RacketId, { raw: number; eff: number; cap: number }>;
  dirty: number; launderCap: number; clean: number; influence: number;
  upkeepSporco: number; upkeepPulito: number;
  pressure: { racket: number; exposed: number; guards: number; spike: number; libroPaga: number; avvocati: number; cover: number; effects: number; total: number };
  heatTarget: number;
};
export type Rates = { cities: Record<string, CityRates>; dirty: number; launderCap: number; launderFee: number; laundering: number; clean: number; upkeepSporco: number; upkeepPulito: number; efficiency: number };

export function cityRates(s: GameState, c: CityState, eff = efficiency(s)): CityRates {
  const d = def(c.id);
  const lots: (LotRates | null)[] = c.lots.map(() => null);
  const racket = {} as CityRates['racket'];
  let dirty = 0, pRacket = 0;
  for (const r of RACKETS) racket[r.id] = { raw: 0, eff: 0, cap: 0 };
  const pres = presidio(c); const usable = usableLots(s, c);
  c.lots.forEach((l, i) => {
    if (!isOpen(l) || l.kind !== 'racket' || i >= usable) return;
    const r = RACKETS.find(x => x.id === l.id)!;
    // la resa passa dai giri: ognuno vale quanto l'isolato è adatto, e serve il presidio
    let fit = 0; for (const [b, list] of Object.entries(c.turf)) for (const x of list) if (x === r.id) fit += blockFit(c.id, Number(b), r.id);
    const turfFactor = (fit / Math.max(1, giriTotal(c, r.id))) * pres.coverage;
    const raw = r.baseIncome * lvlCurve(l.level) * (1 + synergy(c, r.id)) * zoneMult(c, i, 'income', r.id) * eff * turfFactor * (SEASON.income[r.category] ?? 1);
    const cap = demand(s, c, r.category) * K.demandToCash * d.pop * (1 - c.gang.share);
    const e = saturate(raw, cap);
    const heat = r.heatPerLevel * l.level * (r.id === 'bische' && d.legalGambling ? 0.5 : 1) * d.police * zoneMult(c, i, 'heat', r.id) * (SEASON.heat[r.category] ?? 1);
    racket[r.id] = { raw, eff: e, cap }; dirty += e; pRacket += heat;
    lots[i] = { dirty: e, clean: 0, launder: 0, influence: 0, heat, cover: 0 };
  });
  // attività legali: il reddito pulito si satura per categoria (i doppioni rendono sempre meno)
  const acc = s.research.contabilita, cont = c.units.contabili;
  const byCat = new Map<Category, { raw: number; lots: [number, number][] }>();
  let launderCap = 0, influence = 0, cover = 0;
  c.lots.forEach((l, i) => {
    if (!isOpen(l) || l.kind !== 'front' || i >= usable) return;
    const f = FRONTS.find(x => x.id === l.id)!;
    const raw = f.clean * lvlCurve(l.level) * zoneMult(c, i, 'clean', f.id) * eff;
    const g = byCat.get(f.category) ?? byCat.set(f.category, { raw: 0, lots: [] }).get(f.category)!;
    g.raw += raw; g.lots.push([i, raw]);
    const lc = f.launder * lvlCurve(l.level) * (1 + 0.1 * acc) * (1 + 0.05 * cont);
    const inf = f.influence * l.level * zoneMult(c, i, 'influence', f.id);
    const cv = f.cover * l.level;
    lots[i] = { dirty: 0, clean: 0, launder: lc, influence: inf, heat: 0, cover: cv };
    launderCap += lc; influence += inf; cover += cv;
  });
  influence += K.qgInfluence * buildingLevel(c, 'qg');
  let clean = 0;
  for (const [cat, g] of byCat) {
    const e = saturate(g.raw, demand(s, c, cat) * K.demandToCash * d.pop * 0.5);
    clean += e;
    for (const [i, raw] of g.lots) lots[i]!.clean = g.raw > 0 ? e * raw / g.raw : 0;
  }
  const pLibro = K.libroPagaMitigation * c.payroll * (1 + 0.2 * s.research.corruzione) * d.corruptible;
  let upkeepSporco = K.libroPagaUpkeep * c.payroll, upkeepPulito = 0;
  const all = cityUnitsAll(c);
  for (const u of UNITS) { upkeepSporco += (u.upkeep.sporco ?? 0) * (all[u.id] ?? 0); upkeepPulito += (u.upkeep.pulito ?? 0) * (all[u.id] ?? 0); }
  const pExposed = c.id === s.capital ? (exposed(s) / K.exposedPressurePer) * d.police : 0;
  const pGuards = Object.values(c.guards).reduce((a, n) => a + (n ?? 0), 0) * K.guardPressure;
  const pAvv = 0.4 * c.units.avvocati;
  const pEff = c.effects.reduce((a, e) => a + (e.pressure ?? 0), 0) + (isMayorOf(s, c.id) ? K.mayorPressure : 0);
  const total = Math.max(0, pRacket + pExposed + pGuards + c.heatSpike - pLibro - pAvv - cover + pEff);
  return {
    lots, presidio: pres, racket, dirty, launderCap, clean, influence, upkeepSporco, upkeepPulito,
    pressure: { racket: pRacket, exposed: pExposed, guards: pGuards, spike: c.heatSpike, libroPaga: pLibro, avvocati: pAvv, cover, effects: pEff, total },
    heatTarget: 100 * (1 - Math.exp(-total / K.heatScale)),
  };
}

export function rates(s: GameState): Rates {
  const eff = efficiency(s);
  const out: Rates = { cities: {}, dirty: 0, launderCap: 0, launderFee: 0, laundering: 0, clean: 0, upkeepSporco: 0, upkeepPulito: 0, efficiency: eff };
  let contabili = 0;
  for (const c of owned(s)) {
    const r = cityRates(s, c, eff); out.cities[c.id] = r;
    out.dirty += r.dirty; out.launderCap += r.launderCap; out.clean += r.clean;
    out.upkeepSporco += r.upkeepSporco; out.upkeepPulito += r.upkeepPulito; contabili += c.units.contabili;
  }
  for (const m of s.missions) for (const u of UNITS) { out.upkeepSporco += (u.upkeep.sporco ?? 0) * (m.units[u.id] ?? 0); out.upkeepPulito += (u.upkeep.pulito ?? 0) * (m.units[u.id] ?? 0); }
  out.launderFee = Math.max(K.launderFeeMin, K.launderFeeBase - 0.02 * s.research.contabilita - 0.005 * contabili);
  out.laundering = Math.min(out.launderCap, out.dirty * s.launderShare);
  return out;
}

function cityUnitsAll(c: CityState): Squad {
  const out: Squad = { ...c.units };
  for (const [id, n] of Object.entries(c.guards)) out[id as UnitId] = (out[id as UnitId] ?? 0) + (n ?? 0);
  return out;
}
export function score(s: GameState) { return Math.floor(s.stats.invested / 1000); }

// ---------------------------------------------------------------- tick
export function tick(s: GameState, seconds: number, maxStep = 60) {
  let left = seconds;
  while (left > 0) { const dt = Math.min(maxStep, left); step(s, dt); left -= dt; }
}

function step(s: GameState, dt: number) {
  s.time += dt;
  const h = dt / H;
  if (s.vacation) {
    // in vacanza tutto è fermo; il calore si raffredda piano
    if (s.time < s.vacation.until) { for (const c of owned(s)) { c.heat *= Math.exp(-0.02 * h); c.heatSpike *= Math.exp(-K.spikeDecayPerHour * h); } return; }
    endVacation(s);
  }
  const r = rates(s);
  s.res.sporco += r.dirty * h;
  s.res.pulito += r.clean * h;
  if (r.laundering > 0) {
    // il lavaggio non tocca mai la cassa degli stipendi delle prossime ore
    const amt = Math.min(r.laundering * h, Math.max(0, s.res.sporco - r.upkeepSporco * K.wageReserveHours));
    s.res.sporco -= amt; s.res.pulito += amt * (1 - r.launderFee); s.stats.laundered += amt;
  }
  s.res.sporco -= r.upkeepSporco * h;
  s.res.pulito -= r.upkeepPulito * h;
  if (s.res.sporco < 0) { s.res.sporco = 0; desert(s, 'criminale', h); }
  if (s.res.pulito < 0) { s.res.pulito = 0; desert(s, 'legale', h); }

  for (const c of owned(s)) {
    const cr = r.cities[c.id];
    c.influence = Math.min(K.influenceCap, c.influence + cr.influence * h);
    c.heat += (cr.heatTarget - c.heat) * (1 - Math.exp(-K.heatApproachPerHour * h));
    c.heatSpike *= Math.exp(-K.spikeDecayPerHour * h);
    heatEvents(s, c, h, cr.dirty / Math.max(1, r.dirty));
    patrols(s, c, h, cr);
    for (const e of c.effects) if (e.until <= s.time) log(s, 'info', M('{city}: finito {what}.', { city: cityName(c.id), what: e.m ?? N(e.label) }), c.id);
    c.effects = c.effects.filter(e => e.until > s.time);
    queues(s, c);
    timers(s, c);
    mayorStep(s, c, h);
  }
  if (s.heir && s.heir.end <= s.time) {
    const cap = s.cities[s.capital]?.owner === 'player' ? s.cities[s.capital] : owned(s)[0];
    s.heir = null;
    if (cap) { cap.units.delfino++; s.stats.invested += totalCost(UNITS.find(u => u.id === 'delfino')!.cost); log(s, 'good', M('{city}: il tuo Delfino è pronto. Mandalo con un assalto per prendere una città.', { city: cityName(cap.id) }), cap.id); }
  }
  if (s.researchQueue && s.researchQueue.end <= s.time) {
    const j = s.researchQueue; s.researchQueue = null;
    s.research[j.id] = j.level; s.stats.invested += totalCost(j.cost);
    log(s, 'good', M('Know-how acquisito: {what} livello {lv}.', { what: N(RESEARCH.find(x => x.id === j.id)!.name), lv: j.level }));
  }
  missions(s);
  for (const c of Object.values(s.cities)) gangStep(s, c, r);
}

/** Campagna elettorale, mandato, scandali e rielezione. */
function mayorStep(s: GameState, c: CityState, h: number) {
  const n = cityName(c.id); const T = thresholds(s);
  if (c.campaign) {
    if (c.heat >= T.retata) {
      c.campaign = null;
      log(s, 'bad', M('{city}: la campagna elettorale affonda in uno scandalo (troppo calore). Riprova quando le acque si calmano.', { city: n }), c.id);
      report(s, { kind: 'mayor', city: c.id, title: M('{city}: campagna fallita', { city: n }), win: false, att: 0, def: 0, defMen: 0, defFort: 0, lostMine: 0, lostTheirs: 0, loot: 0, lines: [N('Il calore ha superato la soglia delle retate durante la campagna.')], advice: M('Per candidarti di nuovo servono {inf} di influenza e calore sotto {heat}.', { inf: K.influenceCap, heat: T.retata }) });
    } else if (c.campaign.ends <= s.time) {
      c.campaign = null; s.mayor = { city: c.id, termEnds: s.time + K.termDays * 24 * H };
      log(s, 'good', M('{city}: hai vinto le elezioni. Sei il sindaco.', { city: n }), c.id);
      report(s, { kind: 'mayor', city: c.id, title: M('Sei il sindaco di {city}', { city: n }), win: true, att: 0, def: 0, defMen: 0, defFort: 0, lostMine: 0, lostTheirs: 0, loot: 0,
        lines: [M('Mandato di {d} giorni.', { d: K.termDays }),
          M('+{lots} lotti vicino al municipio, eventi e licenze a metà prezzo, calore −{heat}, difesa della città +{def}%.', { lots: layout(c.id).extraLots.length, heat: -K.mayorPressure, def: Math.round((K.mayorDefense - 1) * 100) }),
          M('Costa {inf} di influenza all\'ora, e gli occhi federali su di te: la soglia dell\'indagine scende di {fed} in tutte le città.', { inf: K.mayorUpkeep, fed: K.mayorFederal })],
        advice: M('Per la rielezione: almeno {inf} di influenza e calore sotto {heat} alla fine del mandato. Uno scandalo (calore oltre {fed}) ti fa cadere subito.', { inf: K.reelectInfluence, heat: T.retata, fed: T.indagine }) });
    }
  }
  if (!isMayorOf(s, c.id)) return;
  c.influence = Math.max(0, c.influence - K.mayorUpkeep * h);
  const lose = (why: Msg) => {
    s.mayor = null;
    log(s, 'bad', M('{city}: non sei più il sindaco. {why}', { city: n, why }), c.id);
    report(s, { kind: 'mayor', city: c.id, title: M('{city}: fine del mandato', { city: n }), win: false, att: 0, def: 0, defMen: 0, defFort: 0, lostMine: 0, lostTheirs: 0, loot: 0, lines: [why, N('Gli edifici sui lotti del sindaco restano fermi finché non torni in carica.')], advice: N('Puoi ricandidarti quando avrai di nuovo il massimo di influenza.') });
  };
  if (c.heat >= T.indagine) return lose(N('Uno scandalo: il calore ha superato la soglia dell\'indagine federale.'));
  if (c.influence <= 0) return lose(N('Hai perso il sostegno della città: influenza finita.'));
  if (s.mayor!.termEnds <= s.time) {
    if (c.influence >= K.reelectInfluence && c.heat < T.retata) { s.mayor!.termEnds += K.termDays * 24 * H; log(s, 'good', M('{city}: rieletto sindaco per altri {d} giorni.', { city: n, d: K.termDays }), c.id); }
    else lose(M('Elezioni perse: servivano {inf} di influenza e calore sotto {heat}.', { inf: K.reelectInfluence, heat: T.retata }));
  }
}

function timers(s: GameState, c: CityState) {
  for (const l of c.lots) if (l?.closedUntil && l.closedUntil <= s.time) { delete l.closedUntil; log(s, 'info', M('{city}: {what} riapre.', { city: cityName(c.id), what: nm(l.kind, l.id) }), c.id); }
  if (c.move && c.move.end <= s.time) {
    const m = c.move; c.move = null;
    const target = c.lots[m.toLot];
    if (m.host && target && (target.kind === 'front' || target.kind === 'racket') && !target.hosted) target.hosted = { id: m.id, level: m.level };
    else if (!m.host && !target) c.lots[m.toLot] = { kind: 'building', id: m.id, level: m.level };
    else { const i = freeLots(c, s)[0]; if (i !== undefined) c.lots[i] = { kind: 'building', id: m.id, level: m.level }; }
    const p = { city: cityName(c.id), lot: m.host ? nm(c.lots[m.toLot]!.kind, c.lots[m.toLot]!.id) : '' };
    log(s, 'good', m.host
      ? M(m.id === 'qg' ? '{city}: trasloco finito, il QG è nascosto dentro {lot}.' : '{city}: trasloco finito, la cassaforte è nascosta dentro {lot}.', p)
      : M(m.id === 'qg' ? '{city}: trasloco finito, il QG è nel nuovo lotto.' : '{city}: trasloco finito, la cassaforte è nel nuovo lotto.', { city: p.city }), c.id);
    if (m.id === 'qg' || m.id === 'cassaforte') autoPlace(c);
  }
}

function queues(s: GameState, c: CityState) {
  if (c.buildQueue && c.buildQueue.end <= s.time) {
    const j = c.buildQueue; c.buildQueue = null;
    c.lots[j.lot] = { kind: j.kind, id: j.id, level: j.level };
    if (j.kind === 'racket') autoPlace(c);
    s.stats.invested += totalCost(j.cost);
    log(s, 'good', j.level === 1
      ? M('{city}: aperto {what}.', { city: cityName(c.id), what: nm(j.kind, j.id) })
      : M('{city}: completato {what} livello {lv}.', { city: cityName(c.id), what: nm(j.kind, j.id), lv: j.level }), c.id);
  }
  while (c.unitQueue.length) {
    const j = c.unitQueue[0];
    if (j.nextAt > s.time) break;
    c.units[j.id]++; j.done++;
    s.stats.invested += totalCost(UNITS.find(u => u.id === j.id)!.cost);
    if (j.done >= j.n) {
      c.unitQueue.shift();
      log(s, 'good', M('{city}: reclutati {units}.', { city: cityName(c.id), units: unitCount(j.n, j.id) }), c.id);
      if (c.unitQueue[0]) c.unitQueue[0].nextAt = j.nextAt + c.unitQueue[0].per;
    } else j.nextAt += j.per;
  }
}

function desert(s: GameState, branch: 'criminale' | 'legale', h: number) {
  let lost = 0;
  for (const c of owned(s)) for (const u of UNITS) if (u.branch === branch) {
    const n = Math.min(c.units[u.id], sround(s, c.units[u.id] * 0.05 * h));
    c.units[u.id] -= n; lost += n;
  }
  if (lost > 0) log(s, 'bad', branch === 'criminale'
    ? M('Niente contante sporco per gli stipendi: {n} uomini se ne vanno.', { n: lost })
    : M('Niente contante pulito per gli stipendi: {n} dipendenti si licenziano.', { n: lost }));
}

// ---------------------------------------------------------------- calore: avvisi ed eventi
const WARNINGS = {
  controlli: ['Più pattuglie del solito nel quartiere.', 'Un agente fa domande al bar.', 'Gli sbirri fermano due dei tuoi per un controllo.'],
  retata: ['Il tuo uomo in polizia dice che in centrale si parla di te.', 'Un\'auto civetta è parcheggiata davanti al tuo locale da due giorni.', 'Soffiata: stanno preparando una retata.'],
  indagine: ['Un giornalista ha scritto un pezzo sui "nuovi arrivati".', 'Il tuo contabile è stato convocato per un colloquio.', 'Un grand jury federale è stato convocato. Hai poco tempo.'],
} as const;
const OFFSETS = [15, 8, 3];

export function thresholds(s: GameState) { const d = s.policeShift ?? 0; return { controlli: K.thresholds.controlli + d, retata: K.thresholds.retata + d, indagine: indagineThreshold(s) + d }; }

function heatEvents(s: GameState, c: CityState, h: number, weight: number) {
  const T = thresholds(s);
  const n = cityName(c.id);
  for (const key of ['retata', 'indagine'] as const) {
    const t = T[key];
    if (c.heat < t - 20) c.warned[key] = 0;
    // un avviso alla volta, a distanza di qualche ora: tre avvisi veri prima del colpo, mai tutti insieme
    if (c.warned[key] < 3 && c.heat >= t - OFFSETS[c.warned[key]] && (c.cooldowns['avviso-' + key] ?? 0) <= s.time && (c.cooldowns[key] ?? 0) <= s.time) {
      log(s, 'warn', M('{city}: {warning} (calore {heat})', { city: n, warning: N(WARNINGS[key][c.warned[key]]), heat: Math.round(c.heat) }), c.id);
      c.warned[key]++; c.cooldowns['avviso-' + key] = s.time + K.warnGapHours * H;
    }
  }
  const w = c.id === s.capital ? Math.max(0.5, weight) : weight;
  const avv = c.units.avvocati;
  const seizeRed = Math.min(0.4, 0.02 * avv), arrestRed = Math.min(0.6, 0.03 * avv);
  if (c.heat >= T.indagine && c.warned.indagine >= 3 && (c.cooldowns.indagine ?? 0) <= s.time && rand(s) < K.indagineChancePerHour * h) {
    const seized = exposedPolice(s) * 0.6 * w * (1 - seizeRed);
    s.res.sporco -= seized; s.stats.seized += seized;
    const arrested = arrest(s, c, 0.3 * (1 - arrestRed));
    const hit = contaminatedFront(s, c);
    let hostedHit: Msg | null = null;
    if (hit !== null) { const l = c.lots[hit]!; l.level = Math.max(1, l.level - 1); if (l.hosted) { l.hosted.level = Math.max(1, l.hosted.level - 1); hostedHit = N(l.hosted.id === 'qg' ? 'Dentro c\'era il tuo QG: perde un livello.' : 'Dentro c\'era la tua cassaforte: perde un livello.'); } }
    c.heat = Math.max(0, c.heat - 30); c.heatSpike = 0;
    c.warned.indagine = 0; c.warned.retata = 0; c.cooldowns.indagine = s.time + K.indagineCooldownHours * H; c.cooldowns.retata = s.time + K.retataCooldownHours * H;
    const ip = { city: n, money: { money: seized }, n: arrested };
    const head = hit === null ? M('{city}: INDAGINE FEDERALE. Sequestrati {money} di contante sporco, arrestati {n} uomini.', ip)
      : M('{city}: INDAGINE FEDERALE. Sequestrati {money} di contante sporco, arrestati {n} uomini, sequestrata una parte di un\'attività legale (−1 livello).', ip);
    log(s, 'bad', hostedHit ? joinMsg([head, hostedHit]) : head, c.id);
    const frontLine = N('Sequestrata una parte di un\'attività legale: perde un livello.');
    report(s, { kind: 'police', city: c.id, title: M('{city}: indagine federale', { city: n }), win: false, att: 0, def: 0, defMen: 0, defFort: 0, lostMine: arrested, lostTheirs: 0, loot: seized,
      lines: [M('Sequestrati {money} di contante sporco esposto.', { money: { money: seized } }), M('Arrestati {n} uomini.', { n: arrested }), ...(hit !== null ? [hostedHit ? joinMsg([frontLine, hostedHit]) : frontLine] : [])], advice: N('Il calore era oltre la soglia federale. Libro paga, avvocati e meno racket in città lo abbassano; tenere il contante nelle casseforti limita i sequestri.') });
  } else if (c.heat >= T.retata && c.warned.retata >= 3 && (c.cooldowns.retata ?? 0) <= s.time && rand(s) < K.retataChancePerHour * h) {
    const seized = exposedPolice(s) * 0.3 * w * (1 - seizeRed);
    s.res.sporco -= seized; s.stats.seized += seized;
    const arrested = arrest(s, c, 0.2 * (1 - arrestRed));
    c.heat = Math.max(0, c.heat - 15);
    c.warned.retata = 0; c.cooldowns.retata = s.time + K.retataCooldownHours * H;
    const extra: Msg[] = [];
    for (const l of c.lots) if (l?.kind === 'racket' && l.hosted) {
      l.hosted.level = Math.max(1, l.hosted.level - 1);
      extra.push(M(l.hosted.id === 'qg' ? 'Nel racket {racket} hanno trovato il tuo QG: −1 livello.' : 'Nel racket {racket} hanno trovato la tua cassaforte: −1 livello.', { racket: nm('racket', l.id) }));
    }
    log(s, 'bad', joinMsg([M('{city}: RETATA. Sequestrati {money} di contante sporco esposto e arrestati {n} uomini.', { city: n, money: { money: seized }, n: arrested }), ...extra]), c.id);
    report(s, { kind: 'police', city: c.id, title: M('{city}: retata', { city: n }), win: false, att: 0, def: 0, defMen: 0, defFort: 0, lostMine: arrested, lostTheirs: 0, loot: seized,
      lines: [M('Sequestrati {money} di contante sporco esposto.', { money: { money: seized } }), M('Arrestati {n} uomini.', { n: arrested }), ...(extra.length ? [joinMsg(extra)] : [])], advice: M('Ora la polizia ti lascia in pace per {h} ore: usale per abbassare il calore (libro paga, bustarella, meno giri sullo stesso isolato).', { h: K.retataCooldownHours }) });
  }
}

/** Le ronde passano sugli isolati: i giri ammucchiati scaldano la città e rischiano i controlli. */
function patrols(s: GameState, c: CityState, h: number, cr: CityRates) {
  trimTurf(c);
  const n = cityName(c.id); const rate = patrolRate(c);
  for (const [k, list] of Object.entries(c.turf)) {
    const b = Number(k); const t = tileRisk(c, b);
    if (t.grade >= 2) c.heatSpike += t.exposure * rate * h * K.heatPerPass * (t.grade - 1);
    const warned = c.tileWarn[k] ?? 0;
    if (t.level >= 3 && warned < t.level) {
      c.tileWarn[k] = t.level;
      const rackets = joinMsg(list.map(x => lc(RACKETS.find(r => r.id === x)!.name)), ', ');
      log(s, 'warn', M(t.level === 4 ? '{city}: le volanti passano spesso vicino ai tuoi giri ({rackets}). Rischio alto di controlli.' : '{city}: le volanti passano spesso vicino ai tuoi giri ({rackets}). Rischio medio di controlli.', { city: n, rackets }), c.id);
    } else if (t.level < 3 && warned) delete c.tileWarn[k];
    const p = t.level === 4 ? K.controlRed : t.level === 3 ? K.controlOrange : 0;
    if (p > 0 && (c.cooldowns['controllo-' + k] ?? 0) <= s.time && rand(s) < p * h) {
      c.cooldowns['controllo-' + k] = s.time + K.controlCooldownHours * H;
      // rendita del giro sequestrata e qualche arresto tra il presidio
      let tileIncome = 0; for (const x of list) { const rr = cr.racket[x]; const tot = giriTotal(c, x); if (tot) tileIncome += rr.eff / tot; }
      const seized = Math.min(s.res.sporco, tileIncome * K.controlHours);
      s.res.sporco -= seized; s.stats.seized += seized;
      let arrested = 0; for (const u of ['picchiatori', 'soldati', 'enforcer'] as UnitId[]) { const a = Math.min(c.units[u], 1 + Math.floor(rand(s) * 2)); if (a && arrested < 3) { c.units[u] -= a; arrested += a; } }
      c.heatSpike += 3;
      log(s, 'bad', M('{city}: CONTROLLO su un tuo isolato. Sequestrati {money}, arrestati {n} uomini del presidio.', { city: n, money: { money: seized }, n: arrested }), c.id);
    }
  }
}

function arrest(s: GameState, c: CityState, frac: number) {
  let n = 0;
  for (const u of UNITS) if (u.branch === 'criminale') {
    const a = sround(s, c.units[u.id] * frac); c.units[u.id] -= a; n += a;
    const g = c.guards[u.id] ?? 0; if (g) { const b = sround(s, g * frac); c.guards[u.id] = g - b; n += b; }
  }
  return n;
}
function contaminatedFront(s: GameState, c: CityState): number | null {
  const guarded = Object.values(c.guards).some(n => (n ?? 0) > 0);
  const cands = c.lots.map((l, i) => ({ l, i })).filter(({ l }) => l?.kind === 'front' && (guarded || FRONTS.find(f => f.id === l.id)!.synergy?.some(r => racketLevel(c, r) > 0))).map(x => x.i);
  return cands.length ? cands[Math.floor(rand(s) * cands.length)] : null;
}
export const group = (x: number) => { const n = Math.round(x), a = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return (n < 0 ? '−' : '') + a; };
export const money = (x: number) => (x < 0 ? '−$' : '$') + group(Math.abs(x));

// ---------------------------------------------------------------- combattimento
export function power(s: GameState | null, sq: Squad, mode: 'att' | 'def') {
  let p = 0;
  for (const [id, n] of Object.entries(sq)) { const u = UNITS.find(x => x.id === id)!; p += (mode === 'att' ? u.att : u.def) * (n ?? 0); }
  return s ? p * (1 + 0.1 * s.research.tattica) : p;
}
function battle(s: GameState, attP: number, defP: number) {
  const a = attP * between(s, 0.85, 1.15), d = defP * between(s, 0.85, 1.15);
  const attWins = a > d;
  const ratio = attWins ? a / Math.max(d, 1) : d / Math.max(a, 1);
  const loserLoss = Math.min(0.9, 0.35 * ratio), winnerLoss = Math.min(0.5, 0.25 / ratio);
  return { attWins, a, d, attLoss: attWins ? winnerLoss : loserLoss, defLoss: attWins ? loserLoss : winnerLoss };
}
function applyLoss(s: GameState, sq: Squad, frac: number): number {
  let lost = 0;
  for (const id of Object.keys(sq) as UnitId[]) { const l = sround(s, (sq[id] ?? 0) * frac); sq[id] = (sq[id] ?? 0) - l; lost += l; }
  return lost;
}
const carry = (sq: Squad) => Object.entries(sq).reduce((a, [id, n]) => a + UNITS.find(u => u.id === id)!.carry * (n ?? 0), 0);

export function distance(a: string, b: string) { const A = def(a), B = def(b); return Math.hypot(A.x - B.x, A.y - B.y); }
export const travelHours = (s: GameState, from: string, to: string) =>
  Math.max(0.1, (K.travelBase + distance(from, to) / K.travelSpeed) * (1 - 0.1 * s.research.logistica));
export const gangDefense = (c: CityState) => power(null, c.gang.units, 'def') + 20;
export const fortDefense = (c: CityState) => power(null, c.gang.units, 'def') + (c.proxy === undefined && c.owner === 'npc'
  ? K.npcFort
  : K.fortBase + K.fortPerPop * def(c.id).pop + 10 * (whereIs(c, 'qg')?.level ?? 0));

// ---------------------------------------------------------------- rapporti di battaglia
export type ReportIn = Omit<BattleReport, 'id' | 't' | 'seen' | 'title' | 'lines' | 'advice' | 'm'> & { title: string | Msg; lines: (string | Msg)[]; advice: string | Msg };
export function report(s: GameState, r: ReportIn) {
  const asMsg = (x: string | Msg): Msg => (typeof x === 'string' ? { k: x } : x);
  const it = (x: string | Msg) => (typeof x === 'string' ? x : render(x, 'it'));
  const m = { title: asMsg(r.title), lines: r.lines.map(asMsg), advice: asMsg(r.advice) };
  s.reports.unshift({ ...r, title: it(r.title), lines: r.lines.map(it), advice: it(r.advice), m, id: s.nextReportId++, t: s.time, seen: false });
  if (s.reports.length > 40) s.reports.length = 40;
}
/** Quanti uomini in più sarebbero serviti per vincere con un buon margine. */
function shortfall(s: GameState, att: number, def: number, intel: boolean): Msg {
  const need = def * 1.2 - att;
  if (need <= 0) return N('Le forze erano pari: è andata male ai dadi. Riprova con un margine più ampio, almeno il 20% sopra la loro difesa.');
  const t = 1 + 0.1 * s.research.tattica;
  const p = { pts: need, sol: Math.ceil(need / (8 * t)), enf: Math.ceil(need / (25 * t)) };
  return intel ? M('Ti mancavano circa {pts} punti di attacco: più o meno {sol} soldati o {enf} enforcer in più (gli enforcer servono un\'armeria di livello 3).', p)
    : M('Ti mancavano circa {pts} punti di attacco: più o meno {sol} soldati o {enf} enforcer in più (gli enforcer servono un\'armeria di livello 3). Non avevi un rapporto degli informatori: hai attaccato alla cieca. Spia prima, così conosci la loro difesa.', p);
}

// ---------------------------------------------------------------- missioni
function missions(s: GameState) {
  for (const m of s.missions) {
    if (!m.resolved && s.time >= m.arriveAt) { m.resolved = true; resolveMission(s, m); }
    if (m.resolved && !m.stay && s.time >= m.returnAt) {
      const home = s.cities[m.from];
      const dest = home?.owner === 'player' ? home : s.cities[s.capital]?.owner === 'player' ? s.cities[s.capital] : owned(s)[0];
      if (!dest) { m.stay = true; continue; }
      for (const [id, n] of Object.entries(m.units)) (id === 'delfino' && s.cities[s.capital]?.owner === 'player' ? s.cities[s.capital] : dest).units[id as UnitId] += n ?? 0;
      s.res.sporco += m.loot; s.stats.looted += m.loot;
      const back = Object.values(m.units).reduce((a, n) => a + (n ?? 0), 0);
      if (m.kind === 'raid' || m.kind === 'assault') log(s, back ? 'info' : 'bad', back
        ? (m.loot ? M('La crew è rientrata a {city} con {money}.', { city: cityName(dest.id), money: { money: m.loot } }) : M('La crew è rientrata a {city}.', { city: cityName(dest.id) }))
        : M('Della crew partita da {city} non è tornato nessuno.', { city: cityName(dest.id) }), dest.id);
    }
  }
  s.missions = s.missions.filter(m => !(m.resolved && (m.stay || s.time >= m.returnAt)));
}

function resolveMission(s: GameState, m: Mission) {
  const t = s.cities[m.to]; if (!t) return; const g = t.gang; const tn = cityName(t.id);
  if (m.kind === 'transfer') {
    if (t.owner === 'player') { for (const [id, n] of Object.entries(m.units)) t.units[id as UnitId] += n ?? 0; m.stay = true; log(s, 'info', M('Uomini arrivati a {city}: {units}.', { city: tn, units: squadMsg(m.units) }), t.id); }
    else log(s, 'warn', M('{city} non è più tua: gli uomini tornano indietro.', { city: tn }), t.id);
    return;
  }
  if (t.owner === 'player') { log(s, 'info', M('{city} è già tua: la crew torna indietro.', { city: tn }), t.id); return; }
  if (m.kind === 'spy') return spy(s, m, t);
  if (m.kind === 'raid') t.cooldowns.razzia = s.time + K.raidCooldownHours * H;
  const alert = t.alertUntil > s.time ? K.alertMult : 1;
  const hadIntel = !!g.intel && s.time - g.intel.at < 24 * H;
  const sent = squadMsg(m.units); const attP = power(s, m.units, 'att');
  const men = power(null, g.units, 'def');
  // bersaglio: per l'assalto il lotto scelto (o il QG se lo conosci, altrimenti un edificio a caso: alla cieca)
  let lot = m.lot;
  if (m.kind === 'assault' && lot === undefined) {
    const qg = whereIs(t, 'qg');
    if (g.intel?.qgKnown && qg) lot = qg.lot;
    else { const occ = t.lots.map((l, i) => (l ? i : -1)).filter(i => i >= 0); lot = occ[Math.floor(rand(s) * occ.length)]; }
  }
  const qgHere = lot !== undefined && whereIs(t, 'qg')?.lot === lot;
  const isConquest = m.kind === 'assault' && qgHere;
  const defTot = (isConquest ? fortDefense(t) : gangDefense(t)) * alert;
  const res = battle(s, attP, defTot);
  const delf = m.units.delfino ?? 0; delete m.units.delfino;
  const lostA = applyLoss(s, m.units, res.attLoss);
  if (delf && res.attWins) m.units.delfino = delf;
  const lostD = applyLoss(s, g.units, res.defLoss);
  const kind = (m.kind === 'assault' ? 'assault' : m.kind === 'strike' ? 'strike' : 'raid') as BattleReport['kind'];
  const base = { kind, city: t.id, att: Math.round(res.a), def: Math.round(res.d), defMen: Math.round(men), defFort: Math.round(defTot - men), lostMine: lostA, lostTheirs: lostD };
  const targetName = lot !== undefined && t.lots[lot] ? lotLabelMsg(t.lots[lot]!) : N('un edificio');
  // lo stesso con l'iniziale maiuscola (a inizio frase): il nome come scritto nel catalogo
  const targetCap = lot !== undefined && t.lots[lot] ? nm(t.lots[lot]!.kind, t.lots[lot]!.id) : N('Un edificio');
  const losses = { a: lostA, b: lostD };
  const theirs = { men, what: N(isConquest ? 'fortificazioni del QG' : 'rinforzi'), fort: defTot - men, def: defTot, batt: res.d };
  const lines: Msg[] = [M('Hai mandato: {units} (attacco {att}, in battaglia {batt}).', { units: sent, att: attP, batt: res.a }),
    alert > 1 ? M('Loro: uomini {men} + {what} {fort} = {def} di difesa (in allerta: +20%) (in battaglia {batt}).', theirs)
      : M('Loro: uomini {men} + {what} {fort} = {def} di difesa (in battaglia {batt}).', theirs),
    M('Perdite: tue {a}, loro {b}.', losses)];
  const what = N(m.kind === 'assault' ? 'Assalto' : m.kind === 'strike' ? 'Colpo' : 'Colpo alla cassa');
  if (!res.attWins) {
    if (m.kind === 'assault') t.alertUntil = s.time + K.alertHours * H;
    log(s, 'bad', M('{what} fallito a {city} contro {gang}. Perdite: tue {a}, loro {b}.', { what, city: tn, gang: gangMsg(g.name), ...losses }), t.id);
    if (delf) { lines.push(N('Il tuo Delfino è rimasto sul campo: per riprovare dovrai arruolarne un altro.')); log(s, 'bad', M('Il tuo Delfino è caduto a {city}.', { city: tn }), t.id); }
    report(s, { ...base, title: M('{what} fallito a {city}', { what, city: tn }), win: false, loot: 0, lines, advice: shortfall(s, attP, defTot, hadIntel) });
    return;
  }
  if (isConquest) {
    const gname = g.name;
    conquer(s, t, m, true);
    report(s, { ...base, title: M('{city} è tua', { city: tn }), win: true, loot: 0,
      lines: [...lines, N('Hai preso il loro quartier generale: la banda lascia la città e le sue attività passano a te (a metà livello).'),
        M('Parti con {inf} di influenza e {heat} di calore ereditati da {from}. I tuoi uomini restano in città.', { inf: Math.round(t.influence), heat: Math.round(t.heat), from: cityName(m.from) }),
        M('Il tuo Delfino ora regge {city}: costa {m}/h finché la tieni.', { city: tn, m: { money: 3000 } })],
      advice: owned(s).length > cityLimit(s) ? M('Gestisci {n} città ma il tuo limite è {max}: tutte rendono meno. Studia Gestione.', { n: owned(s).length, max: cityLimit(s) }) : N('Metti un po\' di difesa in città: le bande vicine se ne accorgeranno.') });
    log(s, 'good', M('{city} è tua: preso il quartier generale di {gang}. Perdite: tue {a}, loro {b}.', { city: tn, gang: gangMsg(gname), ...losses }), t.id);
    return;
  }
  if (m.kind === 'raid') {
    const loot = Math.min(g.stash * 0.5, carry(m.units));
    g.stash -= loot; m.loot = loot;
    g.share = Math.max(0.05, g.share - 0.1);
    log(s, 'good', M('Colpo alla cassa riuscito a {city}: bottino {money}. Perdite: tue {a}, loro {b}.', { city: tn, money: { money: loot }, ...losses }), t.id);
    report(s, { ...base, title: M('Colpo alla cassa riuscito a {city}', { city: tn }), win: true, loot,
      lines: [...lines, M('Bottino: {money} (capacità di trasporto {cap}).', { money: { money: loot }, cap: { money: carry(m.units) } }), M('La loro presa sulla città scende al {pct}%.', { pct: Math.round(g.share * 100) })],
      advice: loot >= carry(m.units) - 1 ? N('Hai riempito i sacchi: con più corrieri avresti portato via di più.') : N('') });
    return;
  }
  // colpo a un edificio (o assalto finito sull'edificio sbagliato): l'edificio chiude per qualche ora
  const l = lot !== undefined ? t.lots[lot] : null;
  const extra: Msg[] = [];
  if (l && !((l.protectedUntil ?? 0) > s.time)) {
    const hrs = closeLot(s, l); extra.push(M('{what} resta chiuso per {h} ore.', { what: targetCap, h: hrs }));
    if (l.kind === 'racket') { g.share = Math.max(0.05, g.share - 0.1); extra.push(M('Perdono un giro: la loro presa scende al {pct}%.', { pct: Math.round(g.share * 100) })); }
    if (l.kind === 'front') { g.share = Math.max(0.05, g.share - 0.05); extra.push(M('La loro presa scende al {pct}%.', { pct: Math.round(g.share * 100) })); }
    if (l.kind === 'building' && l.id === 'cassaforte') { const loot = Math.min(g.stash * 0.6, carry(m.units)); g.stash -= loot; m.loot = loot; extra.push(M('Dalla cassaforte portate via {money}.', { money: { money: loot } })); }
    if (l.kind === 'building' && l.id === 'armeria') extra.push(N('Il loro reclutamento rallenta finché resta chiusa.'));
  } else extra.push(l ? M('{what} era già chiuso o protetto: danni minori.', { what: targetCap }) : N('Il lotto era vuoto.'));
  if (m.kind === 'assault') { t.alertUntil = s.time + K.alertHours * H; extra.unshift(M('Il QG non era lì: hai colpito {what}. Ora la banda è in allerta per {h} ore.', { what: targetName, h: K.alertHours })); }
  log(s, 'good', M('{what} a {city}: {details}', { what, city: tn, details: joinMsg(extra) }), t.id);
  report(s, { ...base, title: m.kind === 'assault' ? M('{city}: il QG non era lì', { city: tn }) : M('Colpo riuscito a {city}', { city: tn }), win: m.kind !== 'assault', loot: m.loot, lines: [...lines, ...extra],
    advice: m.kind === 'assault' ? N('Uno spionaggio completo rivela dov\'è il QG. Anche chiudere metà dei loro edifici lo fa venire allo scoperto.') : N('') });
}

/** Nome di un edificio come lo vedrebbe chi lo colpisce (le strutture in minuscolo: "la cassaforte"). */
export const lotLabelMsg = (l: LotUse): Msg => (l.kind === 'building' ? lc(nameOf(l.kind, l.id)) : nm(l.kind, l.id));
export const lotLabel = (l: LotUse, lang: Lang = 'it') => render(lotLabelMsg(l), lang);

/** Spionaggio graduato: intercettato, parziale (niente racket, QG e cassaforte nascosti) o completo. */
function spy(s: GameState, m: Mission, t: CityState) {
  const g = t.gang; const tn = cityName(t.id);
  const n = m.units.informatori ?? 0;
  const p = Math.min(0.95, 0.4 + 0.1 * n + 0.1 * s.research.cifrate);
  if (rand(s) >= p) {
    m.units.informatori = 0; log(s, 'bad', M('I tuoi {n} informatori sono stati scoperti a {city}. Non torneranno.', { n, city: tn }), t.id);
    report(s, { kind: 'spy', city: t.id, title: M('Informatori scoperti a {city}', { city: tn }), win: false, att: 0, def: 0, defMen: 0, defFort: 0, lostMine: n, lostTheirs: 0, loot: 0,
      lines: [M('I tuoi {n} informatori sono stati intercettati. {gang} sanno che li stai guardando.', { n, gang: gangMsgCap(g.name) })],
      advice: M('Più informatori insieme e il know-how Comunicazioni cifrate aumentano le probabilità (oggi {pct}%).', { pct: Math.round(p * 100) }) });
    return;
  }
  const cp = Math.min(0.9, K.completeBase + 0.1 * n + 0.1 * s.research.cifrate);
  const complete = rand(s) < cp;
  const occ = t.lots.filter(Boolean); const closed = occ.filter(l => l!.closedUntil).length;
  const qgKnown = complete || (occ.length > 0 && closed / occ.length >= 0.5);
  g.intel = { at: s.time, units: { ...g.units }, stash: Math.round(g.stash), share: g.share, defense: Math.round(fortDefense(t)), quality: complete ? 'complete' : 'partial', lots: JSON.parse(JSON.stringify(t.lots)), qgKnown };
  const qg = whereIs(t, 'qg');
  log(s, 'good', M(complete ? 'Rapporto completo su {gang} ({city}).' : 'Rapporto parziale su {gang} ({city}).', { gang: gangMsg(g.name), city: tn }), t.id);
  report(s, { kind: 'spy', city: t.id, title: M(complete ? 'Rapporto completo: {city}' : 'Rapporto parziale: {city}', { city: tn }), win: true, att: 0, def: g.intel.defense, defMen: power(null, g.units, 'def'), defFort: g.intel.defense - power(null, g.units, 'def'), lostMine: 0, lostTheirs: 0, loot: 0,
    lines: [M('{gang}: {units}.', { gang: gangMsgCap(g.name), units: squadMsg(g.units) }), M('In cassa circa {money}. Presa sulla città: {pct}%.', { money: { money: g.stash }, pct: Math.round(g.share * 100) }),
      N(complete ? (qg ? 'Hai visto tutto: anche i racket e il quartier generale (tetto rosso).' : 'Hai visto tutto: anche i racket.') : qgKnown ? 'Rapporto parziale, ma con metà dei loro edifici chiusi il QG è venuto allo scoperto.' : 'Rapporto parziale: vedi le attività legali e le strutture, ma i racket, il QG e la cassaforte sembrano palazzi qualunque.'),
      M('Assalto al QG: {fort} di difesa. Colpo a un edificio: {def}.', { fort: g.intel.defense, def: gangDefense(t) })],
    advice: N('Apri la città dalla Mappa ("Guarda la città") per scegliere il bersaglio.') });
}

/** Passaggio di proprietà: la banda se ne va, le sue attività passano a te a metà livello. */
function conquer(s: GameState, t: CityState, m: Mission, violent: boolean) {
  const from = s.cities[m.from];
  t.owner = 'player'; t.since = s.time;
  t.lots = t.lots.map(l => {
    if (!l) return null;
    const keep = l.kind === 'building' && (l.id === 'qg' || l.id === 'cassaforte');
    return { kind: l.kind, id: l.id, level: keep ? l.level : Math.max(1, Math.ceil(l.level * K.conquestKeep)) };
  });
  if (buildingLevel(t, 'qg') === 0) { const i = pickLot(t, ['centro']); if (i !== undefined) t.lots[i] = { kind: 'building', id: 'qg', level: 1 }; }
  for (const [id, n] of Object.entries(m.units)) t.units[id as UnitId] += n ?? 0;
  m.stay = true;
  const share = from ? inheritShare(from.id, t.id) : 0;
  t.influence = Math.round((from?.influence ?? 0) * share);
  t.heat = Math.round((from?.heat ?? 0) * share);
  const g = t.gang;
  g.units = {}; g.share = 0; g.stash = 0; g.intel = null; g.incoming = null; t.alertUntil = 0;
  g.nextAttackAt = s.time + (12 + between(s, K.rivalAttackMin, K.rivalAttackMax)) * H;
  t.turf = {}; autoPlace(t);
  if (violent) { if (from?.owner === 'player') from.heatSpike += K.conquestHeat; t.heatSpike += K.conquestHeat; }
  s.stats.conquests++;
  s.lastConquest = s.time;
}

/** Una squadra a parole: "3 picchiatori, 2 soldati" (o "nessuno"). */
export function squadMsg(sq: Squad): Msg {
  const parts = Object.entries(sq).filter(([, n]) => (n ?? 0) > 0).map(([id, n]) => unitCount(n!, id));
  return parts.length ? joinMsg(parts, ', ') : N('nessuno');
}
export const squadText = (sq: Squad, lang: Lang = 'it') => render(squadMsg(sq), lang);

// ---------------------------------------------------------------- bande NPC
export function rivalTarget(days: number) { return Math.min(K.rivalCap, K.rivalBase + K.rivalGrowth * days ** K.rivalExp) * SEASON.npc; }
/** La forza (difesa degli uomini) di una banda del server: uguale per tutte le città, con una piccola variazione fissa per città. */
export function npcTarget(id: string) { return power(null, npcSquad(id), 'def'); }
/** Secondi prima di poter spostare di nuovo la capitale (0 = si può). */
export function capitalCooldown(s: GameState) { return s.capitalMovedAt === undefined ? 0 : Math.max(0, s.capitalMovedAt + K.capitalMoveDays * 86400 - s.time); }
/** Il Delfino serve per prendere una città, tranne la capitale di un altro giocatore (il boss sconfitto diventa tuo vassallo). */
export const needsDelfino = (c: CityState) => !(c.proxy !== undefined && c.proxyCapital);
/** Delfini liberi (nella capitale) e reggenti (nelle altre città). */
export function delfini(s: GameState) {
  let free = 0, regents = 0;
  for (const c of owned(s)) { if (c.id === s.capital) free += c.units.delfino; else regents += Math.min(1, c.units.delfino); }
  const training = !!s.heir || owned(s).some(c => c.unitQueue.some(j => j.id === 'delfino'));
  return { free, regents, training };
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
export { cap as capitalize };

/** Chiude un edificio per qualche ora (e protegge da altri colpi per un giorno). Ritorna le ore. */
export function closeLot(s: GameState, l: LotUse) {
  const hrs = Math.round(between(s, K.closeMin, K.closeMax));
  l.closedUntil = s.time + hrs * H; l.protectedUntil = l.closedUntil + K.hitProtectHours * H;
  return hrs;
}

/** La banda della città più vicina non tua: è lei a minacciare questa città. */
const threatCache = new Map<string, string>();
export function nearestThreat(s: GameState, cityId: string): string {
  const key = s.seed + ':' + cityId; const hit = threatCache.get(key); if (hit && s.cities[hit]?.owner !== 'player' && s.cities[hit]?.proxy === undefined) return hit;
  const me = def(cityId); let best = '', bd = Infinity;
  for (let i = 0; i < CITY_COUNT; i++) {
    const id = String(i); if (id === cityId || s.cities[id]?.owner === 'player' || s.cities[id]?.proxy !== undefined) continue;
    const r = cityRaw(i); const dd = (r[3] - me.x) ** 2 + (r[4] - me.y) ** 2 + (r[1] === me.stateIdx ? 0 : 400);
    if (dd < bd) { bd = dd; best = id; }
  }
  threatCache.set(key, best); return best;
}

function gangStep(s: GameState, c: CityState, r: Rates) {
  const g = c.gang; const d = def(c.id);
  while (c.owner === 'npc' && c.proxy === undefined && s.time - g.lastGrowAt >= 6 * H) {
    g.lastGrowAt += 6 * H;
    const days = g.lastGrowAt / (24 * H);
    for (const [u, want] of Object.entries(npcSquad(c.id))) {
      const have = g.units[u as UnitId] ?? 0;
      if (have < want!) g.units[u as UnitId] = have + Math.ceil((want! - have) * 0.25);
    }
    g.stash = Math.min(500000 * d.pop, g.stash + (3000 + 2000 * days) * (c.owner === 'npc' ? d.pop : 1));
    const occ = c.lots.filter((l): l is LotUse => !!l && l.level < 2 + days);
    if (occ.length) occ[Math.floor(rand(s) * occ.length)].level++;
    g.share = Math.min(c.owner === 'npc' ? 1 : K.rivalShareStart, g.share + (c.owner === 'npc' ? 0.02 : 0.005));
  }
  if (c.owner !== 'player') return;
  const n = cityName(c.id);
  const from = g.incoming?.from ?? nearestThreat(s, c.id); const A = materialize(s, from).gang;
  const window = Math.min(K.warningMaxMin, K.warningBaseMin + K.warningPerInformer * c.units.informatori) * 60;
  if (!g.incoming && s.time >= g.nextAttackAt - window) {
    const kind = c.lots.some(l => l?.kind === 'front') && rand(s) < 0.3 ? 'sabotaggio' : 'razzia';
    // La banda (con i suoi alleati della regione) manda quanto basta per mettere alla prova la tua difesa:
    // tra il 60% e il 125% della difesa attuale, con un minimo che cresce coi giorni. Non dipende dalla guarnigione della città vicina.
    const defNow = kind === 'razzia' ? power(s, c.units, 'def') + 10 * buildingLevel(c, 'qg') : power(s, { ...c.guards, guardie: c.units.guardie }, 'def') + 5;
    const want = Math.min(K.rivalCap, Math.max(K.attackFloorBase + K.attackFloorPerDay * (s.time - (s.born ?? 0)) / (24 * H), defNow * between(s, K.attackMin, K.attackMax)));
    const units: Squad = { picchiatori: Math.max(1, Math.round((want * 0.5) / 2)), soldati: Math.round((want * 0.35) / 8), enforcer: Math.round((want * 0.15) / 25) };
    g.incoming = { kind, units, arriveAt: g.nextAttackAt, from };
    autoDefend(s, c, power(null, units, 'att'), kind);
    const wp = { city: n, gang: gangMsg(A.name), from: cityName(from), units: squadMsg(units), min: Math.round((g.nextAttackAt - s.time) / 60) };
    log(s, 'warn', kind === 'razzia'
      ? M('{city}: gli informatori avvisano che {gang} da {from} stanno arrivando ({units}). Vogliono il tuo contante. Arrivo tra {min} minuti.', wp)
      : M('{city}: gli informatori avvisano che {gang} da {from} stanno arrivando ({units}). Vogliono colpire le tue attività legali. Arrivo tra {min} minuti.', wp), c.id);
  }
  if (g.incoming && s.time >= g.incoming.arriveAt) {
    const inc = g.incoming; g.incoming = null;
    g.nextAttackAt = s.time + between(s, K.rivalAttackMin, K.rivalAttackMax) * H;
    const att = power(null, inc.units, 'att');
    const defSq: Squad = inc.kind === 'razzia' ? c.units : { ...c.guards, guardie: c.units.guardie };
    const base = inc.kind === 'razzia' ? 10 * buildingLevel(c, 'qg') : 5;
    const res = battle(s, att, (power(s, defSq, 'def') + base) * (isMayorOf(s, c.id) ? K.mayorDefense : 1));
    const sent: Squad = { ...inc.units }; // per il rapporto: chi è arrivato, non chi è sopravvissuto
    const lostA = applyLoss(s, inc.units, res.attLoss);
    let lostD = 0;
    if (inc.kind === 'razzia') {
      for (const u of UNITS) if (u.def > 0) { const l = sround(s, c.units[u.id] * res.defLoss); c.units[u.id] -= l; lostD += l; }
    } else {
      for (const id of Object.keys(c.guards) as UnitId[]) { const l = sround(s, (c.guards[id] ?? 0) * res.defLoss); c.guards[id] = (c.guards[id] ?? 0) - l; lostD += l; }
      const l = sround(s, c.units.guardie * res.defLoss); c.units.guardie -= l; lostD += l;
    }
    c.heatSpike += K.defendHeatSpike;
    if (!res.attWins) g.nextAttackAt += K.repelPauseHours * H;
    const gp = { city: n, gang: gangMsg(A.name), from: cityName(from), a: lostD, b: lostA };
    const attLine = M('Attaccavano con {units} ({att}).', { units: squadMsg(sent), att: res.a });
    if (res.attWins) {
      if (inc.kind === 'razzia') {
        const wgt = r.cities[c.id] ? r.cities[c.id].dirty / Math.max(1, r.dirty) : 0;
        const w = c.id === s.capital ? Math.max(0.5, wgt) : wgt;
        const loot = Math.min(exposed(s) * 0.5 * w, carry(inc.units));
        s.res.sporco -= loot; A.stash += loot;
        log(s, 'bad', M('{city}: {gang} da {from} ti hanno razziato, portati via {money}. Perdite: tue {a}, loro {b}.', { ...gp, money: { money: loot } }), c.id);
        report(s, { kind: 'defense', city: c.id, title: M('{city}: razzia subita', { city: n }), win: false, att: Math.round(res.a), def: Math.round(res.d), defMen: Math.round(power(s, defSq, 'def')), defFort: base, lostMine: lostD, lostTheirs: lostA, loot,
          lines: [attLine, M('La tua difesa: {def}.', { def: res.d }), M('Portati via {money} di contante esposto.', { money: { money: loot } })], advice: N('Più uomini a casa, un quartier generale più alto o una cassaforte più grande riducono i danni.') });
      } else {
        const cands = c.lots.map((l, i) => ({ l, i })).filter(x => isOpen(x.l) && x.l.kind === 'front' && !((x.l.protectedUntil ?? 0) > s.time));
        const f = cands[Math.floor(rand(s) * cands.length)];
        let hrs = 0; if (f) hrs = closeLot(s, f.l!);
        const sp = { ...gp, front: f ? nm('front', f.l!.id) : '', h: hrs };
        log(s, 'bad', !f ? M('{city}: sabotaggio riuscito, danni minori. Perdite: tue {a}, loro {b}.', sp)
          : !f.l!.hosted ? M('{city}: sabotaggio riuscito, {front} resta chiuso per {h} ore. Perdite: tue {a}, loro {b}.', sp)
            : f.l!.hosted.id === 'qg' ? M('{city}: sabotaggio riuscito, {front} resta chiuso per {h} ore (e con lui il QG nascosto dentro). Perdite: tue {a}, loro {b}.', sp)
              : M('{city}: sabotaggio riuscito, {front} resta chiuso per {h} ore (e con lui la cassaforte nascosta dentro). Perdite: tue {a}, loro {b}.', sp), c.id);
        report(s, { kind: 'sabotage', city: c.id, title: M('{city}: sabotaggio subito', { city: n }), win: false, att: Math.round(res.a), def: Math.round(res.d), defMen: Math.round(power(s, defSq, 'def')), defFort: base, lostMine: lostD, lostTheirs: lostA, loot: 0,
          lines: [M('Attaccavano le attività legali con {units} ({att}).', { units: squadMsg(sent), att: res.a }), M('Le guardie dei front: {def}.', { def: res.d }), f ? M('{front} chiuso per {h} ore.', { front: sp.front, h: hrs }) : N('Danni minori.')],
          advice: N('Contro i sabotaggi servono guardie sui front (Crew → Protezione delle attività legali).') });
      }
    } else {
      log(s, 'good', M('{city}: hai respinto {gang} da {from}. Perdite: tue {a}, loro {b}.', gp), c.id);
      report(s, { kind: 'defense', city: c.id, title: M('{city}: attacco respinto', { city: n }), win: true, att: Math.round(res.a), def: Math.round(res.d), defMen: Math.round(power(s, defSq, 'def')), defFort: base, lostMine: lostD, lostTheirs: lostA, loot: 0,
        lines: [attLine, M('La tua difesa: {def}.', { def: res.d })], advice: N('') });
    }
  }
}

// ---------------------------------------------------------------- centrale di polizia e municipio
export const POLICE: { id: PoliceAction; name: string; desc: string; cost: (c: CityState) => Cost }[] = [
  { id: 'soffiata', name: 'Soffiata su una banda', desc: 'La polizia arresta un quarto della banda; la sua presa scende del 5%. Si può puntare questa città o un\'altra.', cost: () => ({ influenza: 40 }) },
  { id: 'occhio', name: 'Chiudere un occhio', desc: 'Il comando guarda altrove: pressione del calore −15 per 24 ore.', cost: () => ({ influenza: 60 }) },
  { id: 'bustarella', name: 'Bustarella', desc: `Calore −${K.bustarellaHeat} subito. Si può fare ogni ${K.bustarellaCooldown} ore.`, cost: c => ({ sporco: Math.round(6000 * def(c.id).pop) }) },
];
export const MAYOR: { id: MayorAction; name: string; desc: string; cost: Cost; hours?: number; once?: boolean }[] = [
  { id: 'boxe', name: 'Incontro di boxe', desc: 'Domanda di scommesse +40% per 24 ore.', cost: { pulito: 15000 }, hours: 24 },
  { id: 'fiera', name: 'Fiera di contea', desc: 'Ristorazione e vita notturna +30% per 24 ore.', cost: { pulito: 20000 }, hours: 24 },
  { id: 'beneficenza', name: 'Serata di beneficenza', desc: '+10 influenza in questa città; calore temporaneo −5.', cost: { pulito: 10000 } },
  { id: 'zonizzazione', name: 'Zonizzazione notturna', desc: 'Locali aperti fino a tardi: vita notturna +25% per sempre in questa città.', cost: { influenza: 80 }, once: true },
  { id: 'licenzaCasino', name: 'Licenza per il casinò', desc: 'Permette di aprire un casinò in questa città.', cost: { influenza: 150 }, once: true },
];

/** Costi del municipio: a metà prezzo per il sindaco. */
export const mayorCost = (s: GameState, c: CityState, cost: Cost) => isMayorOf(s, c.id) ? scale(cost, K.mayorDiscount) : cost;
export const campaignCost = (c: CityState): Cost => ({ pulito: Math.round(K.campaignPulito * def(c.id).pop) });

function addEffect(c: CityState, e: Effect) {
  const old = c.effects.find(x => x.id === e.id && x.category === e.category);
  if (old) old.until = Math.max(old.until, e.until); else c.effects.push(e);
}

export function acquireCost(c: CityState): Cost {
  return { pulito: Math.round(K.acquirePulito * def(c.id).pop * Math.max(0.2, c.gang.share / K.acquireMaxShare)), influenza: K.acquireInfluenza };
}

/** Che cosa si può costruire su un lotto libero (con il motivo, se no). */
export function buildOptions(s: GameState, c: CityState) {
  // blocked = motivo in italiano; blockedM = lo stesso, traducibile
  const out: { kind: UseKind; id: string; name: string; desc: string; cost: Cost; blocked: string | null; blockedM: Msg | null }[] = [];
  const add = (kind: UseKind, d: { id: string; name: string; desc: string; req?: Requirement }, blocked: Msg | null) => {
    const miss = missingReqMsg(s, c, d.req);
    const why = blocked ?? (miss.length ? M('Serve: {list}', { list: joinMsg(miss, ', ') }) : null);
    out.push({ kind, id: d.id, name: d.name, desc: d.desc, cost: upgradeCost(kind, d.id, 1), blocked: why ? render(why, 'it') : null, blockedM: why });
  };
  for (const r of RACKETS) add('racket', r, racketLevel(c, r.id) > 0 || c.buildQueue?.id === r.id ? N('Ce l\'hai già in città') : null);
  for (const f of FRONTS) add('front', f, null);
  for (const b of BUILDINGS) add('building', b, b.unique && (buildingLevel(c, b.id) > 0 || c.buildQueue?.id === b.id) ? N('Uno per città') : null);
  return out;
}

// ---------------------------------------------------------------- azioni
export function act(s: GameState, a: Action): Result {
  const mine = (id: string) => s.cities[id]?.owner === 'player' ? s.cities[id] : null;
  switch (a.t) {
    case 'build': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      if (c.buildQueue) return fail('C\'è già un cantiere aperto in questa città.');
      if (!freeLots(c, s).includes(a.lot)) return fail('Il lotto non è libero.');
      const opt = buildOptions(s, c).find(o => o.kind === a.kind && o.id === a.id);
      if (!opt) return fail('Sconosciuto.');
      if (opt.blockedM) return fail(M('{why}.', { why: opt.blockedM }));
      if (!canAfford(s, opt.cost, c)) return fail('Non hai abbastanza soldi.');
      pay(s, opt.cost, c);
      c.buildQueue = { lot: a.lot, kind: a.kind, id: a.id, level: 1, start: s.time, end: s.time + buildHours(c, opt.cost) * H, cost: opt.cost };
      return { ok: true };
    }
    case 'upgrade': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      if (c.buildQueue) return fail('C\'è già un cantiere aperto in questa città.');
      const l = c.lots[a.lot]; if (!l) return fail('Il lotto è vuoto.');
      if (l.closedUntil) return fail('È chiuso: riaprilo prima.');
      const miss = missingReqMsg(s, c, useDef(l.kind, l.id).req); if (miss.length) return fail(M('Serve: {list}.', { list: joinMsg(miss, ', ') }));
      const cost = upgradeCost(l.kind, l.id, l.level + 1);
      if (!canAfford(s, cost, c)) return fail('Non hai abbastanza soldi.');
      pay(s, cost, c);
      c.buildQueue = { lot: a.lot, kind: l.kind, id: l.id, level: l.level + 1, start: s.time, end: s.time + buildHours(c, cost) * H, cost };
      return { ok: true };
    }
    case 'demolish': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      const l = c.lots[a.lot]; if (!l) return fail('Il lotto è già vuoto.');
      if (l.kind === 'building' && l.id === 'qg') return fail('Il quartier generale non si demolisce.');
      if (c.buildQueue?.lot === a.lot) return fail('C\'è un cantiere aperto su questo lotto.');
      if (l.hosted) return fail(l.hosted.id === 'qg' ? 'Dentro c\'è il QG: prima traslocalo.' : 'Dentro c\'è la cassaforte: prima traslocalo.');
      c.lots[a.lot] = null; trimTurf(c);
      log(s, 'info', M('{city}: chiuso {what}. Il lotto è di nuovo libero.', { city: cityName(c.id), what: nm(l.kind, l.id) }), c.id);
      return okm(N('Lotto liberato.'));
    }
    case 'research': {
      if (s.researchQueue) return fail('Stai già imparando qualcosa.');
      const d = RESEARCH.find(x => x.id === a.id)!;
      const miss = missingReqMsg(s, null, d.req); if (miss.length) return fail(M('Serve: {list}.', { list: joinMsg(miss, ', ') }));
      const cost = researchCost(a.id, s.research[a.id] + 1);
      if (!canAfford(s, cost)) return fail('Non hai abbastanza soldi.');
      pay(s, cost);
      s.researchQueue = { id: a.id, level: s.research[a.id] + 1, start: s.time, end: s.time + researchHours(s, cost) * H, cost };
      return { ok: true };
    }
    case 'cancel': {
      if (a.queue === 'research') {
        if (!s.researchQueue) return fail('Niente da annullare.');
        pay(s, s.researchQueue.cost, undefined, -1); s.researchQueue = null; return okm(N('Interrotto: i soldi tornano, il tempo passato è perso.'));
      }
      const c = a.city ? mine(a.city) : null;
      if (!c?.buildQueue) return fail('Niente da annullare.');
      pay(s, c.buildQueue.cost, c, -1); c.buildQueue = null;
      return okm(N('Interrotto: i soldi tornano, il tempo passato è perso.'));
    }
    case 'cancelHeir': {
      if (!s.heir) return fail('Non stai arruolando un Delfino.');
      s.heir = null; pay(s, UNITS.find(u => u.id === 'delfino')!.cost, undefined, -1);
      return okm(N('Arruolamento del Delfino annullato, soldi restituiti.'));
    }
    case 'cancelUnits': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      const j = c.unitQueue[a.index]; if (!j) return fail('Niente da annullare.');
      const d = UNITS.find(u => u.id === j.id)!;
      // chi è già arruolato resta; si restituiscono i soldi di chi non lo è ancora (anche di quello a metà)
      pay(s, scale(d.cost, j.n - j.done), undefined, -1);
      c.unitQueue.splice(a.index, 1);
      if (a.index === 0 && c.unitQueue[0]) c.unitQueue[0].nextAt = s.time + c.unitQueue[0].per;
      return okm(j.done ? M('Arruolamento interrotto: restano i {n} già arruolati, i soldi degli altri tornano.', { n: j.done }) : N('Arruolamento annullato, soldi restituiti.'));
    }
    case 'setCapital': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      if (c.id === s.capital) return fail('È già la tua capitale.');
      if (c.taken) return fail('Una città presa a un altro boss non può diventare la tua capitale.');
      if (capitalCooldown(s) > 0) return fail(M('La capitale si sposta una volta a settimana: riprova tra {d}.', { d: duration(capitalCooldown(s)) }));
      const old = s.capital; s.capital = c.id; s.capitalMovedAt = s.time;
      const retired = c.units.delfino > 0; if (retired) c.units.delfino -= 1;
      log(s, 'good', retired
        ? M('Ti trasferisci a {city}: ora è la tua capitale. Il Delfino che la reggeva si fa da parte (niente più stipendio). {old} resta tua, senza un reggente.', { city: cityName(c.id), old: cityName(old) })
        : M('Ti trasferisci a {city}: ora è la tua capitale.', { city: cityName(c.id) }), c.id);
      return { ok: true };
    }
    case 'recall': {
      const m = s.missions.find(x => x.id === a.mission); if (!m) return fail('Missione non trovata.');
      if (m.resolved || s.time >= m.arriveAt) return fail('Sono già arrivati: ora tornano da soli.');
      const travel = Math.max(0, m.returnAt - m.arriveAt); const left = m.arriveAt - travel;
      const back = Math.max(60, s.time - left);
      m.resolved = true; m.recalled = true; m.loot = 0; m.stay = false; m.arriveAt = s.time; m.returnAt = s.time + back;
      log(s, 'info', M('Missione verso {city} annullata: gli uomini tornano indietro, a casa tra {d}.', { city: cityName(m.to), d: duration(back) }), m.from);
      return { ok: true };
    }
    case 'cancelMove': {
      const c = mine(a.city); if (!c?.move) return fail('Niente da annullare.');
      const mv = c.move; c.move = null;
      const at = mv.from !== undefined ? c.lots[mv.from] : undefined;
      if (mv.from !== undefined && mv.fromHost && at && !at.hosted && (at.kind === 'front' || at.kind === 'racket')) at.hosted = { id: mv.id, level: mv.level };
      else if (mv.from !== undefined && !mv.fromHost && !at) c.lots[mv.from] = { kind: 'building', id: mv.id, level: mv.level };
      else { const i = freeLots(c, s)[0]; if (i !== undefined) c.lots[i] = { kind: 'building', id: mv.id, level: mv.level }; }
      autoPlace(c);
      return okm(N('Trasloco interrotto: resta dov\'era, i soldi del trasloco sono persi.'));
    }
    case 'cancelCampaign': {
      const c = mine(a.city); if (!c?.campaign) return fail('Niente da annullare.');
      c.campaign = null;
      return okm(N('Campagna ritirata: i soldi spesi sono persi.'));
    }
    case 'recruit': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      const d = UNITS.find(u => u.id === a.id)!;
      const n = Math.floor(a.n); if (n <= 0) return fail('Quanti?');
      const miss = missingReqMsg(s, c, d.req); if (miss.length) return fail(M('Serve: {list}.', { list: joinMsg(miss, ', ') }));
      if (a.id === 'delfino') {
        if (c.id !== s.capital) return fail('Il Delfino si arruola solo nella capitale.');
        if (n !== 1) return fail('I Delfini si arruolano uno alla volta.');
        if (delfini(s).training) return fail('Stai già arruolando un Delfino.');
      }
      const cost = scale(d.cost, n);
      if (!canAfford(s, cost)) return fail('Non hai abbastanza soldi.');
      pay(s, cost);
      if (a.id === 'delfino') { s.heir = { start: s.time, end: s.time + unitHours(c, 'delfino') * H }; return { ok: true }; }
      const per = unitHours(c, a.id) * H;
      c.unitQueue.push({ id: a.id, n, done: 0, per, nextAt: c.unitQueue.length ? 0 : s.time + per });
      return { ok: true };
    }
    case 'guard': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      const d = UNITS.find(u => u.id === a.id)!;
      if (d.branch !== 'criminale' || d.def <= 0 || d.carry > 300) return fail('Questa unità non fa la guardia.');
      const cur = c.guards[a.id] ?? 0, target = Math.max(0, Math.floor(a.n));
      const diff = target - cur;
      if (diff > c.units[a.id]) return fail('Non hai abbastanza uomini liberi.');
      c.units[a.id] -= diff; c.guards[a.id] = target;
      return { ok: true };
    }
    case 'mission': {
      const from = mine(a.from); if (!from) return fail('Puoi partire solo da una tua città.');
      if (!validCity(a.to)) return fail('Città sconosciuta.');
      const to = peekCity(s, a.to);
      const hostile = a.kind === 'raid' || a.kind === 'assault' || a.kind === 'strike';
      if (hostile) {
        const need = influenceNeeded(s, a.to);
        if (from.influence < need) return fail(M('Per operare in {state} serve almeno {need} di influenza a {city} (ne ha {have}).', { state: def(a.to).state, need, city: cityName(from.id), have: Math.floor(from.influence) }));
      }
      const sq: Squad = {};
      for (const [id, n] of Object.entries(a.units)) {
        const k = Math.floor(n ?? 0); if (k <= 0) continue;
        if (k > from.units[id as UnitId]) return fail(M('Non hai abbastanza uomini liberi a {city}.', { city: cityName(from.id) }));
        sq[id as UnitId] = k;
      }
      if (!Object.keys(sq).length) return fail('Scegli chi mandare.');
      if (sq.delfino) {
        if (from.id !== s.capital) return fail(M('Il Delfino di {city} regge la città: non si muove.', { city: cityName(from.id) }));
        if (a.kind !== 'assault') return fail('Il Delfino parte solo per un assalto: è lui che prenderà la città.');
        if (sq.delfino > 1) return fail('Basta un Delfino per città.');
      }
      if (a.kind === 'spy' && Object.keys(sq).some(k => k !== 'informatori')) return fail('A spiare vanno solo gli informatori.');
      if (hostile && power(null, sq, 'att') <= 0) return fail('Serve almeno qualcuno che sappia menare le mani.');
      if ((hostile || a.kind === 'spy') && to.owner === 'player') return fail('Questa città è tua: non ci sono bande.');
      if (a.kind === 'assault' && needsDelfino(to) && !sq.delfino) return fail('Per prendere una città serve un Delfino che la governi: arruolalo nella capitale e mandalo con l\'assalto.');
      if (a.kind === 'raid' && (to.cooldowns.razzia ?? 0) > s.time) return fail(M('Quella cassa l\'hai appena ripulita: riprova tra {d}.', { d: duration((to.cooldowns.razzia ?? 0) - s.time) }));
      if (a.kind === 'strike') {
        const seen = to.gang.intel?.lots;
        if (!seen) return fail('Prima spia la città: si colpisce solo quello che hai visto.');
        if (a.lot === undefined || !seen[a.lot]) return fail('Scegli un edificio dalla vista della città.');
        const v = seen[a.lot]!;
        if (v.kind === 'building' && v.id === 'qg' && to.gang.intel?.qgKnown) return fail('Il quartier generale non si colpisce: si assalta.');
        if ((to.lots[a.lot]?.protectedUntil ?? 0) > s.time) return fail('Quell\'edificio è stato appena colpito: è protetto per un giorno.');
      }
      if (a.kind === 'assault' && a.lot !== undefined && !to.lots[a.lot] && !to.gang.intel?.lots?.[a.lot]) return fail('Su quel lotto non c\'è niente da assaltare.');
      if (a.kind === 'transfer' && (to.owner !== 'player' || to.id === from.id)) return fail('Puoi trasferire uomini solo verso un\'altra tua città.');
      materialize(s, a.to);
      for (const [id, n] of Object.entries(sq)) from.units[id as UnitId] -= n ?? 0;
      const t = (a.from === a.to ? 0.5 * K.travelHours : travelHours(s, a.from, a.to)) * (a.kind === 'spy' ? 0.5 : 1) * H;
      s.missions.push({ id: s.nextMissionId++, kind: a.kind, from: a.from, to: a.to, units: sq, arriveAt: s.time + t, returnAt: s.time + 2 * t, resolved: false, loot: 0, stay: false, lot: a.lot });
      if (hostile) { from.heatSpike += K.attackHeatSpike * (1 - 0.1 * s.research.cifrate); s.stats.raids++; }
      const what = { raid: 'La crew è partita. Arrivo tra {d}.', spy: 'Gli informatori sono partiti. Arrivo tra {d}.', assault: 'L\'assalto è partito. Arrivo tra {d}.', transfer: 'Gli uomini sono in viaggio. Arrivo tra {d}.', strike: 'La crew è partita. Arrivo tra {d}.' }[a.kind];
      return okm(M(what, { d: duration(t) }));
    }
    case 'acquire': {
      const from = mine(a.from); if (!from) return fail('Si paga da una tua città.');
      if (!validCity(a.city)) return fail('Città sconosciuta.');
      const c = peekCity(s, a.city);
      if (c.owner !== 'npc' || c.proxy !== undefined) return fail('Si possono comprare solo le città delle bande.');
      if (from.id !== s.capital || from.units.delfino < 1) return fail('Serve un Delfino libero nella capitale che governi la città: paga dalla capitale.');
      if (c.gang.share > K.acquireMaxShare) return fail(M('La banda ha ancora il {pct}% della città: indeboliscila sotto il {max}%.', { pct: Math.round(c.gang.share * 100), max: K.acquireMaxShare * 100 }));
      const need = influenceNeeded(s, a.city) + K.acquireInfluenza;
      if (from.influence < need) return fail(M('Serve almeno {need} di influenza a {city}.', { need, city: cityName(from.id) }));
      const cost = acquireCost(c);
      if (!canAfford(s, cost, from)) return fail('Non hai abbastanza contante pulito o influenza.');
      pay(s, cost, from);
      materialize(s, c.id);
      from.units.delfino -= 1;
      conquer(s, c, { id: 0, kind: 'assault', from: from.id, to: c.id, units: { delfino: 1 }, arriveAt: 0, returnAt: 0, resolved: true, loot: 0, stay: true }, false);
      s.stats.invested += totalCost(cost);
      log(s, 'good', M('Acquisizione: {city} passa a te con un paio di firme e qualche stretta di mano. Parte con {inf} di influenza e {heat} di calore ereditati da {from}.', { city: cityName(c.id), inf: Math.round(c.influence), heat: Math.round(c.heat), from: cityName(from.id) }), c.id);
      return { ok: true };
    }
    case 'payroll': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      const target = Math.max(0, Math.min(PAYROLL.length - 1, Math.floor(a.level)));
      if (target > c.payroll) {
        let cost = 0; for (let l = c.payroll + 1; l <= target; l++) cost += payrollCost(l).sporco!;
        if (s.res.sporco < cost) return fail('Non hai abbastanza contante sporco.');
        s.res.sporco -= cost; s.stats.invested += cost;
      }
      c.payroll = target; trimTurf(c);
      return okm(target ? M('{who} a libro paga.', { who: N(PAYROLL[target]) }) : N('Nessuno più a libro paga.'));
    }
    case 'police': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      const p = POLICE.find(x => x.id === a.id)!; const cost = p.cost(c);
      if (a.id === 'bustarella' && (c.cooldowns.bustarella ?? 0) > s.time) return fail(M('La prossima bustarella tra {d}.', { d: duration((c.cooldowns.bustarella ?? 0) - s.time) }));
      if (!canAfford(s, cost, c)) return fail('Non hai abbastanza risorse.');
      if (a.id === 'soffiata' && (!a.target || !validCity(a.target))) return fail('Scegli la città della banda.');
      if (a.id === 'soffiata' && s.cities[a.target!]?.owner === 'player') return fail('In quella città non ci sono bande.');
      pay(s, cost, c);
      if (a.id === 'soffiata') {
        const t = materialize(s, a.target!); const g = t.gang;
        for (const id of Object.keys(g.units) as UnitId[]) g.units[id] = Math.floor((g.units[id] ?? 0) * 0.75);
        g.share = Math.max(0.05, g.share - 0.05);
        log(s, 'good', M('Soffiata: la polizia di {city} arresta un quarto di {gang}.', { city: cityName(t.id), gang: gangMsg(g.name) }), t.id);
      } else if (a.id === 'occhio') {
        addEffect(c, { id: 'occhio', until: s.time + 24 * H, label: 'Il comando chiude un occhio', pressure: -15 });
      } else {
        c.heat = Math.max(0, c.heat - K.bustarellaHeat); c.cooldowns.bustarella = s.time + K.bustarellaCooldown * H;
      }
      return okm(M('{what}: fatto.', { what: N(p.name) }));
    }
    case 'mayor': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      const p = MAYOR.find(x => x.id === a.id)!; const cost = mayorCost(s, c, p.cost);
      if (p.once && c.flags[p.id as FlagId]) return fail('Già ottenuto.');
      if (!canAfford(s, cost, c)) return fail('Non hai abbastanza risorse.');
      pay(s, cost, c);
      const until = s.time + (p.hours ?? 0) * H;
      if (p.id === 'boxe') addEffect(c, { id: 'boxe', until, label: 'Incontro di boxe', category: 'scommesse', mult: 1.4 });
      else if (p.id === 'fiera') { addEffect(c, { id: 'fiera', until, label: 'Fiera (ristorazione)', category: 'ristorazione', mult: 1.3 }); addEffect(c, { id: 'fiera', until, label: 'Fiera (vita notturna)', category: 'notte', mult: 1.3 }); }
      else if (p.id === 'beneficenza') { c.influence = Math.min(K.influenceCap, c.influence + 10); c.heatSpike = Math.max(0, c.heatSpike - 5); }
      else c.flags[p.id as FlagId] = true;
      log(s, 'good', M('{city}: {what}, fatto.', { city: cityName(c.id), what: lc(p.name) }), c.id);
      return { ok: true };
    }
    case 'promote': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      const r = RACKETS.find(x => x.id === a.racket)!;
      if (racketLevel(c, r.id) <= 0) return fail('Prima apri il giro.');
      const cost = { sporco: 5000 };
      if (!canAfford(s, cost)) return fail('Non hai abbastanza soldi.');
      pay(s, cost);
      addEffect(c, { id: 'promo', until: s.time + 12 * H, label: `Promozione: ${r.name}`, m: M('Promozione: {what}', { what: N(r.name) }), category: r.category, mult: 1.25 });
      c.heatSpike += 4;
      return { ok: true };
    }
    case 'move': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      if (c.move) return fail('C\'è già un trasloco in corso.');
      const src = whereIs(c, a.what); if (!src) return fail('Non c\'è niente da spostare.');
      if (src.lot === a.toLot) return fail('È già lì.');
      if (!(a.toLot >= 0 && a.toLot < usableLots(s, c))) return fail('Lotto non valido.');
      const tgt = c.lots[a.toLot];
      const host = !!tgt;
      if (host && !(tgt!.kind === 'front' || tgt!.kind === 'racket')) return fail('Si può nascondere solo dentro un\'attività legale o un racket.');
      if (host && tgt!.hosted) return fail('Quell\'attività ospita già qualcosa.');
      if (!host && (c.buildQueue?.lot === a.toLot)) return fail('Su quel lotto c\'è un cantiere.');
      if (c.buildQueue?.lot === src.lot) return fail('C\'è un cantiere aperto sul lotto da spostare.');
      const cost: Cost = { sporco: K.moveCostPerLevel * src.level };
      if (!canAfford(s, cost)) return fail('Non hai abbastanza soldi.');
      pay(s, cost);
      if (src.hosted) delete c.lots[src.lot]!.hosted; else c.lots[src.lot] = null;
      c.move = { id: a.what, level: src.level, toLot: a.toLot, host, end: s.time + K.moveHours * H, start: s.time, from: src.lot, fromHost: !!src.hosted };
      if (!src.hosted) trimTurf(c);
      return okm(M(a.what === 'qg' ? 'Trasloco iniziato: {h} ore in cui il QG non lavora.' : 'Trasloco iniziato: {h} ore in cui la cassaforte non protegge.', { h: K.moveHours }));
    }
    case 'reopen': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      const l = c.lots[a.lot]; if (!l?.closedUntil) return fail('È già aperto.');
      const cost: Cost = { sporco: Math.round(totalCost(upgradeCost(l.kind, l.id, l.level)) * K.reopenFactor) };
      if (!canAfford(s, cost)) return fail('Non hai abbastanza soldi.');
      pay(s, cost); delete l.closedUntil;
      return okm(N('Riaperto.'));
    }
    case 'campaign': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      if (isMayorOf(s, c.id)) return fail('Sei già il sindaco qui.');
      if (s.mayor) return fail(M('Sei già sindaco di {city}: si può esserlo di una sola città.', { city: cityName(s.mayor.city) }));
      if (Object.values(s.cities).some(x => x.campaign)) return fail('Hai già una campagna in corso.');
      if (c.influence < K.influenceCap) return fail(M('Serve il massimo di influenza in città ({max}).', { max: K.influenceCap }));
      if (c.heat >= thresholds(s).retata) return fail(M('Il calore è troppo alto: deve stare sotto {heat}.', { heat: thresholds(s).retata }));
      const cost = campaignCost(c);
      if (!canAfford(s, cost)) return fail('Non hai abbastanza contante pulito per la campagna.');
      pay(s, cost);
      c.campaign = { ends: s.time + K.campaignHours * H };
      return okm(M('Campagna elettorale iniziata: {h} ore. Tieni basso il calore.', { h: K.campaignHours }));
    }
    case 'turf': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      if (!layout(c.id).turf.includes(a.block)) return fail('Su questo isolato non si possono piazzare giri.');
      if (a.op === 'add') {
        if (gangBlocks(c).has(a.block)) return fail('Questo isolato è della banda rivale: prima toglili di mezzo.');
        if (giriOn(c, a.block).length >= K.maxGiriPerBlock) return fail(M('Al massimo {n} giri per isolato.', { n: K.maxGiriPerBlock }));
        if (giriPlaced(c, a.racket) >= giriTotal(c, a.racket)) return fail('Non hai giri liberi di questo racket: alza il livello.');
        (c.turf[a.block] ??= []).push(a.racket);
      } else {
        const l = giriOn(c, a.block); const i = l.indexOf(a.racket); if (i < 0) return fail('Qui non c\'è quel giro.');
        l.splice(i, 1); if (!l.length) delete c.turf[a.block];
      }
      return { ok: true };
    }
    case 'protect': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      const cur = c.protect[a.block] ?? 0, next = cur + Math.sign(a.delta);
      if (next < 0) return { ok: true };
      if (a.delta > 0 && protectUsed(c) >= c.payroll) return fail('Non hai punti protezione liberi: sali di grado nel libro paga.');
      if (next > giriOn(c, a.block).length) return fail('Qui non servono altre protezioni.');
      if (next) c.protect[a.block] = next; else delete c.protect[a.block];
      return { ok: true };
    }
    case 'autoTurf': {
      const c = mine(a.city); if (!c) return fail('Questa città non è tua.');
      c.turf = {}; autoPlace(c);
      return okm(N('Giri risistemati.'));
    }
    case 'launder': s.launderShare = Math.min(1, Math.max(0, a.share)); return { ok: true };
    case 'vacation': {
      if (s.vacation) return fail('Sei già in vacanza.');
      const days = Math.floor(a.days);
      if (days < K.vacationMinDays) return fail(M('La vacanza dura almeno {n} giorni.', { n: K.vacationMinDays }));
      const left = vacationDaysLeft(s);
      if (days > left) return fail(M('Ti restano {n} giorni di vacanza quest\'anno.', { n: left }));
      if (s.missions.length) return fail('Aspetta che tornino tutte le crew in giro.');
      if (owned(s).some(c => c.gang.incoming)) return fail('C\'è un attacco in arrivo: non puoi sparire adesso.');
      s.vacation = { start: s.time, until: s.time + days * 24 * H };
      (s.vacationLog ??= []).push({ start: s.time, days });
      log(s, 'info', M('Modalità vacanza per {n} giorni: niente entrate, niente attacchi, tutto fermo.', { n: days }));
      return okm(M('In vacanza per {n} giorni.', { n: days }));
    }
    case 'invest': {
      const amt = Math.floor(a.amount);
      if (amt < K.investMin) return fail(M('Si investe almeno {money}.', { money: { money: K.investMin } }));
      if (amt > s.res.pulito) return fail('Non hai abbastanza contante pulito.');
      s.res.pulito -= amt; s.investments = (s.investments ?? 0) + amt; s.stats.invested += amt;
      log(s, 'good', M('Investiti {money} puliti: le rendite salgono del {pct}% in tutto.', { money: { money: amt }, pct: Math.round(investBonus(s) * 100) }));
      return { ok: true };
    }
    case 'posture': s.posture = { auto: !!a.auto, share: Math.min(0.8, Math.max(0, a.share)) }; return { ok: true };
  }
}
const fail = (msg: string | Msg): Result => (typeof msg === 'string' ? { ok: false, msg, m: { k: msg } } : { ok: false, msg: render(msg, 'it'), m: msg });
/** Esito positivo con messaggio traducibile. */
const okm = (m: Msg): Result => ({ ok: true, msg: render(m, 'it'), m });

/** Giorni di vacanza ancora disponibili negli ultimi 365 giorni. */
export function vacationDaysLeft(s: GameState) {
  const used = (s.vacationLog ?? []).filter(v => s.time - v.start < 365 * 24 * H).reduce((a, v) => a + v.days, 0);
  return Math.max(0, K.vacationDaysPerYear - used);
}
/** Fine vacanza: tutto quello che aveva una scadenza slitta della durata della vacanza. */
function endVacation(s: GameState) {
  const v = s.vacation!; const d = v.until - v.start; s.vacation = null;
  if (s.researchQueue) { s.researchQueue.start += d; s.researchQueue.end += d; }
  if (s.heir) { s.heir.start += d; s.heir.end += d; }
  for (const c of owned(s)) {
    if (c.buildQueue) { c.buildQueue.start += d; c.buildQueue.end += d; }
    for (const j of c.unitQueue) j.nextAt += d;
    for (const e of c.effects) e.until += d;
    for (const k of Object.keys(c.cooldowns)) c.cooldowns[k] = (c.cooldowns[k] ?? 0) + d;
    for (const l of c.lots) if (l) { if (l.closedUntil) l.closedUntil += d; if (l.protectedUntil) l.protectedUntil += d; }
    if (c.move) c.move.end += d;
    if (c.campaign) c.campaign.ends += d;
    c.gang.nextAttackAt = Math.max(c.gang.nextAttackAt + d, s.time + 12 * H);
  }
  if (s.mayor) s.mayor.termEnds += d;
  log(s, 'info', N('Sei tornato dalla vacanza. Le bande hanno dodici ore prima di accorgersene.'));
}
/** Postura difensiva: all'avviso di un attacco recluta da sola quanto serve a coprirlo. */
export function autoDefend(s: GameState, c: CityState, att: number, kind: 'razzia' | 'sabotaggio' = 'razzia') {
  if (!s.posture?.auto || s.vacation) return 0;
  const have = kind === 'razzia' ? power(s, c.units, 'def') + 10 * buildingLevel(c, 'qg') : power(s, { ...c.guards, guardie: c.units.guardie }, 'def');
  const need = att * 1.2 - have; if (need <= 0) return 0;
  const soldier = buildingLevel(c, 'armeria') > 0;
  const id: UnitId = soldier ? 'soldati' : 'picchiatori'; const u = UNITS.find(x => x.id === id)!;
  const n = Math.min(Math.ceil(need / (u.def * (1 + 0.1 * s.research.tattica))), Math.floor(s.res.sporco * s.posture.share / (u.cost.sporco ?? 1)));
  if (n <= 0) return 0;
  const r = act(s, { t: 'recruit', city: c.id, id, n });
  if (r.ok) log(s, 'info', M('{city}: postura difensiva, reclutati {units} in fretta.', { city: cityName(c.id), units: unitCount(n, id) }), c.id);
  return r.ok ? n : 0;
}

// ---------------------------------------------------------------- utilità per l'interfaccia
/** Ora di gioco: "Giorno 3, 14:05" (in inglese "Day 3, 14:05"). Italiano se non indichi la lingua. */
export function clock(time: number, lang: Lang = 'it') {
  const day = Math.floor(time / 86400) + 1, hh = Math.floor((time % 86400) / 3600), mm = Math.floor((time % 3600) / 60);
  return t('Giorno {day}, {hm}', { day: String(day), hm: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` }, lang);
}
/** Durata: "2h 5m", "3m 20s", "45s". Le sigle h/m/s sono le stesse in italiano e in inglese: lang c'è per simmetria con clock. */
export function duration(sec: number, _lang: Lang = 'it') {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = sec % 60;
  return h ? `${h}h ${m}m` : m ? (s2 ? `${m}m ${s2}s` : `${m}m`) : `${s2}s`;
}
