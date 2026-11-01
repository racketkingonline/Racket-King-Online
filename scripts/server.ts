// Playtest automatico: un "server" di N giocatori bot con profili diversi, per D giorni.
// Ogni giocatore gioca nella propria istanza del motore (il prototipo è ancora single player):
// le interazioni tra giocatori si stimano dopo, incrociando le città conquistate.
// Uso: npx tsx scripts/server.ts <da> <a> <giorni> <file.jsonl>
import { appendFileSync, writeFileSync } from 'node:fs';
import { CITIES_BY_STATE, CITY_COUNT, cityRaw } from '../src/engine/world';
import {
  act, buildOptions, canAfford, cityLimit, def, fortDefense, freeLots, influenceNeeded, isMayorOf, missingReq, newGame, owned,
  peekCity, power, rates, researchCost, safeCap, thresholds, tick, upgradeCost, type CityState, type GameState,
} from '../src/engine/engine';
import { K, RESEARCH, type ResearchId, type UnitId } from '../src/engine/data';

const [FROM, TO, DAYS, OUT] = [Number(process.argv[2] ?? 0), Number(process.argv[3] ?? 4), Number(process.argv[4] ?? 30), process.argv[5] ?? '/tmp/server.jsonl'];
const H = 3600, D = 86400;

// ---------------------------------------------------------------- profili
function mulberry(seed: number) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
type Profile = {
  id: number; assiduita: 'hardcore' | 'regolare' | 'casual' | 'sporadico'; ritmo: 'lento' | 'normale' | 'veloce';
  testa: 'stratega' | 'equilibrato' | 'impulsivo'; discontinuo: boolean;
  sessionsPerDay: number; sessionMin: number; offDay: number; breakProb: number; actionsPerCheck: number;
};
function profile(i: number): Profile {
  const r = mulberry(1000 + i * 7919);
  const a = r(); const assiduita = a < 0.1 ? 'hardcore' : a < 0.45 ? 'regolare' : a < 0.85 ? 'casual' : 'sporadico';
  const b = r(); const ritmo = b < 0.3 ? 'lento' : b < 0.75 ? 'normale' : 'veloce';
  const c = r(); const testa = c < 0.3 ? 'stratega' : c < 0.7 ? 'equilibrato' : 'impulsivo';
  const discontinuo = r() < 0.35;
  const base = { hardcore: [10, 40], regolare: [4, 20], casual: [2, 12], sporadico: [0.7, 10] }[assiduita];
  return {
    id: i, assiduita, ritmo, testa, discontinuo,
    sessionsPerDay: base[0], sessionMin: base[1] * (ritmo === 'lento' ? 1.4 : ritmo === 'veloce' ? 0.7 : 1),
    offDay: (discontinuo ? 0.3 : 0.05) + (assiduita === 'sporadico' ? 0.3 : 0),
    breakProb: discontinuo ? 0.02 : 0.003, // probabilità al giorno di sparire per 3-21 giorni
    actionsPerCheck: ritmo === 'lento' ? 1 : ritmo === 'normale' ? 3 : 6,
  };
}

// ---------------------------------------------------------------- metriche
type Ev = Record<string, number>;
const EV_KEYS = ['attRecv', 'attLost', 'lootLost', 'sabotaggi', 'retate', 'indagini', 'controlli', 'diserzioni', 'avvisi',
  'assaltiOk', 'assaltiKo', 'assaltiCieco', 'colpi', 'colpiKo', 'spieOk', 'spieKo', 'conquiste', 'acquisti', 'campagne', 'sindaco', 'sindacoPerso',
  'expandBlocked', 'expandNoArmory', 'checks', 'idleChecks', 'actions', 'onlineMin', 'sessions', 'warnOnline', 'warnOffline'] as const;
function scanLog(s: GameState, since: number, ev: Ev, online: boolean) {
  for (const e of s.log) {
    if (e.t <= since) break;
    const x = e.text;
    if (/ti hanno razziato/.test(x)) { ev.attRecv++; ev.attLost++; }
    else if (/sabotaggio riuscito/.test(x)) { ev.attRecv++; ev.attLost++; ev.sabotaggi++; }
    else if (/hai respinto/.test(x)) ev.attRecv++;
    else if (/affonda in uno scandalo/.test(x)) ev.scandali = (ev.scandali ?? 0) + 1;
    else if (/RETATA/.test(x)) ev.retate++;
    else if (/INDAGINE FEDERALE/.test(x)) ev.indagini++;
    else if (/CONTROLLO su un tuo isolato/.test(x)) ev.controlli++;
    else if (/gli informatori avvisano/.test(x)) { ev.avvisi++; online ? ev.warnOnline++ : ev.warnOffline++; }
    else if (/è tua: preso il quartier generale/.test(x)) { ev.assaltiOk++; ev.conquiste++; }
    else if (/^Assalto fallito/.test(x)) ev.assaltiKo++;
    else if (/^Assalto a .*: Il QG non era lì/.test(x) || /^Assalto a /.test(x)) ev.assaltiCieco++;
    else if (/^Colpo (alla cassa )?riuscito|^Colpo a /.test(x)) ev.colpi++;
    else if (/^Colpo (alla cassa )?fallito/.test(x)) ev.colpiKo++;
    else if (/informatori sono stati scoperti/.test(x)) ev.spieKo++;
    else if (/^Acquisizione:/.test(x)) { ev.acquisti++; ev.conquiste++; }
    else if (/hai vinto le elezioni/.test(x)) ev.sindaco++;
    else if (/non sei più il sindaco/.test(x)) ev.sindacoPerso++;
    else if (/per gli stipendi/.test(x)) ev.diserzioni++;
  }
}

// ---------------------------------------------------------------- bot
type Mem = { saving?: boolean; cands: string[]; lastAttack: number; nextExpandCheck: number; spied: Record<string, number>; conquered: { id: string; day: number; how: string }[] };

function nearby(s: GameState, from: string, n: number, sameState = true): string[] {
  const me = def(from); const out: { id: string; d: number }[] = [];
  const pool = sameState ? CITIES_BY_STATE[me.stateIdx] : null;
  const scan = (i: number) => { const r = cityRaw(i); const id = String(i); if (id === from || s.cities[id]?.owner === 'player') return; out.push({ id, d: Math.hypot(r[3] - me.x, r[4] - me.y) }); };
  if (pool) pool.forEach(scan); else for (let i = 0; i < CITY_COUNT; i += 1) scan(i);
  return out.sort((a, b) => a.d - b.d).slice(0, n).map(x => x.id);
}

function tryAct(s: GameState, a: Parameters<typeof act>[1], ev: Ev) { const r = act(s, a); if (r.ok) ev.actions++; return r.ok; }

function economy(s: GameState, p: Profile, c: CityState, ev: Ev, budget: { n: number }) {
  if (budget.n <= 0 || c.buildQueue) return false;
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
    if (o.kind === 'building' && o.id !== 'armeria') continue;
    if (o.kind === 'building' && c.lots.some(l => l?.id === 'armeria')) continue;
    if (o.kind === 'front' && c.lots.some(l => l?.id === o.id) && smart > 0.5) continue;
    const w = o.kind === 'racket' ? 1.8 : o.kind === 'front' ? (needLaunder ? 2.5 : 0.9) : 1.4;
    opts.push({ a: { t: 'build', city: c.id, lot: free[0], kind: o.kind, id: o.id }, score: w / Math.max(1, (o.cost.sporco ?? 0) + (o.cost.pulito ?? 0)) });
  }
  if (!opts.length) return false;
  opts.sort((a, b) => b.score - a.score);
  // l'impulsivo sceglie spesso a caso tra le opzioni possibili
  const pick = Math.random() < smart ? opts[0] : opts[Math.floor(Math.random() * opts.length)];
  if (tryAct(s, pick.a, ev)) { budget.n--; return true; }
  return false;
}

function research(s: GameState, p: Profile, ev: Ev, budget: { n: number }) {
  if (s.researchQueue || budget.n <= 0) return false;
  const order: ResearchId[] = p.testa === 'impulsivo' ? ['tattica', 'gestione', 'logistica', 'contabilita', 'corruzione', 'cifrate']
    : owned(s).length >= cityLimit(s) ? ['gestione', 'contabilita', 'corruzione', 'tattica', 'cifrate', 'logistica'] : ['contabilita', 'corruzione', 'gestione', 'tattica', 'cifrate', 'logistica'];
  for (const id of order) {
    const d = RESEARCH.find(r => r.id === id)!; if (missingReq(s, null, d.req).length) continue;
    const k = researchCost(id, s.research[id] + 1);
    if (canAfford(s, k) && (k.sporco ?? 0) <= s.res.sporco * 0.5 && (k.pulito ?? 0) <= s.res.pulito * 0.7) { if (tryAct(s, { t: 'research', id }, ev)) { budget.n--; return true; } }
  }
  return false;
}

function heatCare(s: GameState, p: Profile, c: CityState, ev: Ev, budget: { n: number }) {
  if (budget.n <= 0) return false;
  const lim = p.testa === 'stratega' ? 30 : p.testa === 'equilibrato' ? 42 : 58;
  if (c.heat > lim && c.payroll < 5 && (p.testa !== 'impulsivo' || Math.random() < 0.4)) { if (tryAct(s, { t: 'payroll', city: c.id, level: c.payroll + 1 }, ev)) { budget.n--; return true; } }
  if (c.heat > thresholds(s).retata - 8 && p.testa !== 'impulsivo') { if (tryAct(s, { t: 'police', city: c.id, id: 'bustarella' }, ev)) { budget.n--; return true; } }
  return false;
}

function defense(s: GameState, p: Profile, c: CityState, mem: Mem, ev: Ev, budget: { n: number }) {
  if (budget.n <= 0 || c.unitQueue.length) return false;
  const inc = c.gang.incoming;
  const est = inc ? power(null, inc.units, 'att') : Math.max(mem.lastAttack, K.attackFloorBase + K.attackFloorPerDay * s.time / D);
  const want = est * (p.testa === 'stratega' ? 1.4 : p.testa === 'equilibrato' ? 1.0 : 0.5);
  const have = power(s, c.units, 'def') + 10 * (c.lots.find(l => l?.id === 'qg')?.level ?? 0);
  if (have >= want) return false;
  const soldier = c.lots.some(l => l?.id === 'armeria');
  const id: UnitId = soldier ? 'soldati' : 'picchiatori'; const per = soldier ? 2000 : 500; const dv = soldier ? 8 : 3;
  const n = Math.min(Math.ceil((want - have) / dv), Math.floor(s.res.sporco * 0.4 / per));
  if (n > 0 && tryAct(s, { t: 'recruit', city: c.id, id, n }, ev)) { budget.n--; return true; }
  return false;
}

function expand(s: GameState, p: Profile, mem: Mem, ev: Ev, budget: { n: number }) {
  if (budget.n <= 0 || s.time < mem.nextExpandCheck) return false;
  mem.nextExpandCheck = s.time + (p.testa === 'impulsivo' ? 3 : 8) * H;
  const mine = owned(s);
  const limit = cityLimit(s) + (p.testa === 'impulsivo' ? 1 : 0);
  if (mine.length >= limit) return false;
  if (s.missions.some(m => m.kind === 'assault' || m.kind === 'spy')) return false;
  const home = mine.slice().sort((a, b) => power(s, b.units, 'att') - power(s, a.units, 'att'))[0];
  if (!mem.cands.length || s.time % (7 * D) < 8 * H) mem.cands = nearby(s, s.capital, 12);
  let cands = mem.cands.filter(id => s.cities[id]?.owner !== 'player');
  if (!cands.length && home.influence >= influenceNeeded(s, nearby(s, home.id, 1, false)[0] ?? home.id)) cands = nearby(s, home.id, 8, false);
  if (!cands.length) return false;
  const view = cands.map(id => ({ id, c: peekCity(s, id) })).filter(x => home.influence >= influenceNeeded(s, x.id));
  if (!view.length) return false;
  const noise = p.testa === 'impulsivo' ? 0.6 + Math.random() * 0.8 : 1;
  const t = view.sort((a, b) => fortDefense(a.c) - fortDefense(b.c))[0];
  const fd = fortDefense(t.c) * noise;
  if (process.env.DBG) console.log('day', (s.time/D).toFixed(1), 'lim', limit, 'own', mine.length, 'tgt', t.id, 'fd', Math.round(fd), 'share', t.c.gang.share.toFixed(2), 'att', Math.round(power(s, { soldati: home.units.soldati, picchiatori: home.units.picchiatori, enforcer: home.units.enforcer }, 'att')), 'inf', home.units.informatori, 'intel', t.c.gang.intel?.quality, t.c.gang.intel?.qgKnown, 'sporco', Math.round(s.res.sporco), 'armeria', home.lots.some(l => l?.id === 'armeria'));
  // acquisto pacifico: se la banda è debole e c'è pulito
  if (p.testa !== 'impulsivo' && t.c.gang.share <= K.acquireMaxShare && tryAct(s, { t: 'acquire', from: home.id, city: t.id }, ev)) { budget.n--; return true; }
  const att = power(s, { soldati: home.units.soldati, picchiatori: home.units.picchiatori, enforcer: home.units.enforcer }, 'att');
  const margin = p.testa === 'stratega' ? 1.5 : p.testa === 'equilibrato' ? 1.25 : 1.0;
  const qgKnown = !!t.c.gang.intel?.qgKnown && s.time - (t.c.gang.intel?.at ?? 0) < 24 * H;
  if (p.testa !== 'impulsivo' && !qgKnown) {
    // prima si spia
    if (home.units.informatori < 3) { if (!home.unitQueue.length && tryAct(s, { t: 'recruit', city: home.id, id: 'informatori', n: 3 - home.units.informatori }, ev)) budget.n--; return false; }
    if (tryAct(s, { t: 'mission', kind: 'spy', from: home.id, to: t.id, units: { informatori: Math.min(home.units.informatori, 4) } }, ev)) { budget.n--; return true; }
    return false;
  }
  if (att >= fd * margin) {
    const keep = p.testa === 'stratega' ? 0.25 : p.testa === 'equilibrato' ? 0.15 : 0;
    const units = { soldati: Math.floor(home.units.soldati * (1 - keep)), picchiatori: Math.floor(home.units.picchiatori * (1 - keep)), enforcer: home.units.enforcer };
    if (tryAct(s, { t: 'mission', kind: 'assault', from: home.id, to: t.id, units }, ev)) { mem.saving = false; budget.n--; return true; }
  } else if (home.lots.some(l => l?.id === 'armeria')) {
    // quanto manca? Se è raggiungibile in due giorni di entrate si risparmia per l'esercito
    const per = 8 * (1 + 0.1 * s.research.tattica);
    const need = Math.ceil((fd * margin - att) / per); const cost = need * 2000;
    const income = Math.max(1, rates(s).dirty);
    if (cost > income * 48) { ev.expandBlocked++; mem.saving = false; return false; }
    mem.saving = p.testa !== 'impulsivo';
    if (!home.unitQueue.length) {
      const n = Math.min(need, Math.floor(s.res.sporco * (p.testa === 'impulsivo' ? 0.6 : 0.8) / 2000));
      if (n > 0 && tryAct(s, { t: 'recruit', city: home.id, id: 'soldati', n }, ev)) { budget.n--; return true; }
    }
  } else ev.expandNoArmory++;
  return false;
}

function mayor(s: GameState, p: Profile, ev: Ev, budget: { n: number }) {
  if (budget.n <= 0 || s.mayor || p.testa === 'impulsivo') return false;
  for (const c of owned(s)) if (c.influence >= K.influenceCap && c.heat < thresholds(s).retata - 15) { if (tryAct(s, { t: 'campaign', city: c.id }, ev)) { ev.campagne++; budget.n--; return true; } }
  return false;
}

function check(s: GameState, p: Profile, mem: Mem, ev: Ev) {
  ev.checks++;
  const budget = { n: p.actionsPerCheck }; const before = budget.n;
  const mine = owned(s);
  for (const c of mine) heatCare(s, p, c, ev, budget);
  for (const c of mine) defense(s, p, c, mem, ev, budget);
  expand(s, p, mem, ev, budget);
  if (owned(s).length > mine.length) mem.saving = false;
  for (const c of owned(s)) { if (!mem.saving || s.res.sporco > 400000) economy(s, p, c, ev, budget); if (Math.random() < 0.2) act(s, { t: 'autoTurf', city: c.id }); }
  research(s, p, ev, budget);
  mayor(s, p, ev, budget);
  if (p.testa === 'stratega') act(s, { t: 'launder', share: rates(s).launderCap < rates(s).dirty ? 1 : 0.7 });
  if (budget.n === before) ev.idleChecks++;
}

// ---------------------------------------------------------------- partita
function runPlayer(i: number, startId: string) {
  const p = profile(i);
  const s = newGame(5000 + i * 104729, startId);
  const rr = mulberry(77 + i * 31);
  const real = Math.random; Math.random = rr; // decisioni del bot riproducibili
  const ev: Ev = Object.fromEntries(EV_KEYS.map(k => [k, 0]));
  const mem: Mem = { cands: [], lastAttack: 0, nextExpandCheck: 0, spied: {}, conquered: [] };
  const daily: number[][] = [];
  let lastLog = -1; let seenRep = 0; let away = 0;
  const ownedBefore = new Set([startId]);
  let queueIdle = 0, queueSamples = 0;
  const advance = (sec: number, online: boolean) => {
    let left = sec;
    while (left > 0) {
      const dt = Math.min(H, left); tick(s, dt); left -= dt;
      for (const c of owned(s)) { queueSamples++; if (!c.buildQueue && freeOrUpgradable(s, c)) queueIdle++; }
      scanLog(s, lastLog, ev, online); lastLog = s.time;
      for (const r of s.reports) { if (r.id <= seenRep) break; if (r.kind === 'defense' || r.kind === 'sabotage') mem.lastAttack = Math.max(mem.lastAttack * 0.7, r.att); }
      seenRep = s.reports[0]?.id ?? seenRep;
    }
  };
  for (let day = 0; day < DAYS; day++) {
    const dayStart = day * D;
    // sessioni di oggi
    const sessions: number[] = [];
    if (away > 0) away--;
    else if (rr() < p.breakProb) away = 3 + Math.floor(rr() * 18);
    else if (rr() >= p.offDay) {
      const n = Math.max(1, Math.round(p.sessionsPerDay * (0.6 + rr() * 0.8)));
      for (let k = 0; k < n; k++) sessions.push(dayStart + (7 + rr() * 17) * H);
      sessions.sort((a, b) => a - b);
    }
    for (const at of sessions) {
      if (at > s.time) advance(at - s.time, false);
      ev.sessions++;
      const len = p.sessionMin * (0.5 + rr()) * 60; ev.onlineMin += len / 60;
      const end = s.time + len;
      while (s.time < end) { check(s, p, mem, ev); advance(Math.min(5 * 60, end - s.time), true); }
    }
    advance(dayStart + D - s.time, false);
    for (const c of owned(s)) if (!ownedBefore.has(c.id)) { ownedBefore.add(c.id); mem.conquered.push({ id: c.id, day: day + 1, how: '' }); }
    const r = rates(s); const mine = owned(s);
    daily.push([day + 1, Math.round(s.res.sporco), Math.round(s.res.pulito), Math.round(r.dirty), Math.round(r.clean + r.laundering * (1 - r.launderFee)),
      mine.length, mine.reduce((a, c) => a + c.lots.filter(Boolean).length, 0), mine.reduce((a, c) => a + c.lots.length, 0),
      Math.round(Math.max(...mine.map(c => c.heat))), Math.round(Math.max(...mine.map(c => c.influence))),
      Math.round(mine.reduce((a, c) => a + power(s, c.units, 'def'), 0)), Math.round(s.stats.invested / 1000),
      Object.values(s.research).reduce((a, b) => a + b, 0), s.mayor ? 1 : 0, Math.round(ev.attLost), Math.round(ev.retate + ev.indagini), Math.round(ev.conquiste), Math.round(ev.idleChecks), Math.round(ev.checks),
      Math.round(mine.reduce((a, c) => a + c.lots.reduce((x, l) => x + (l?.level ?? 0), 0), 0))]);
  }
  Math.random = real;
  ev.lootLost = s.stats.seized; // sequestri (polizia)
  return { p, start: startId, state: def(startId).stateAbbr, pop: def(startId).population, ev, daily, conquered: mem.conquered, queueIdle: queueIdle / Math.max(1, queueSamples), mayorCity: s.mayor?.city ?? null, cities: owned(s).map(c => c.id), research: s.research };
}
function freeOrUpgradable(s: GameState, c: CityState) { return c.lots.some((l, i) => l ? canAfford(s, upgradeCost(l.kind, l.id, l.level + 1), c) : i < c.lots.length && freeLots(c, s).length > 0); }

// posizioni di partenza: 300 città distinte, come farebbe un server (pop 10k–250k)
const starts: string[] = [];
{ const r = mulberry(424242); const seen = new Set<string>();
  while (starts.length < 300) { const i = Math.floor(r() * CITY_COUNT); const pop = cityRaw(i)[5]; const id = String(i); if (pop >= 10000 && pop < 250000 && !seen.has(id)) { seen.add(id); starts.push(id); } } }

if (FROM === 0) writeFileSync(OUT, '');
for (let i = FROM; i < TO; i++) {
  const t0 = Date.now();
  const res = runPlayer(i, starts[i]);
  appendFileSync(OUT, JSON.stringify(res) + '\n');
  const last = res.daily[res.daily.length - 1];
  console.log(`#${i} ${res.p.assiduita}/${res.p.ritmo}/${res.p.testa}${res.p.discontinuo ? '/disc' : ''} città ${last[5]} score ${last[11]} attLost ${last[14]} polizia ${last[15]} conq ${last[16]} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
