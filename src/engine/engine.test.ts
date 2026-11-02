import { describe, expect, it } from 'vitest';
import {
  act, autoDefend, buildingLevel, buildOptions, isMayorOf, usableLots, whereIs, exposure, gangBlocks, giriPlaced, giriTotal, protectUsed, tileRisk, cityLimit, def, efficiency, fortDefense, freeLots, influenceNeeded, lotCount,
  materialize, newGame, owned, racketLevel, rates, tick, upgradeCost, type GameState,
} from './engine';
import { BUILDINGS, CATEGORY_LABEL, FRONTS, K, LOTS_BY_TIER, PAYROLL, RACKETS, RESEARCH, UNITS, ZONE_DESC, ZONE_LABEL } from './data';
import { DECO_LABEL } from './layout';
import { clock, duration, gangNameMsg, MAYOR, peekCity, POLICE, squadText, whereIs as where, type Action, type Result } from './engine';
import { FLAVOR, gangName } from './world';
import { MISSING, render, t, type Msg } from '../i18n';
import { EN_ENGINE } from '../i18n/en-engine';
import { EN_DATA } from '../i18n/en-data';
import { layout } from './layout';
import { CITIES_BY_STATE, CITY_COUNT, STATES } from './world';

const H = 3600;
const home = (s: GameState) => s.cities[s.capital];
const npc = (s: GameState) => {
  const me = def(s.capital);
  const ids = CITIES_BY_STATE[me.stateIdx].map(String).filter(id => id !== s.capital);
  ids.sort((a, b) => Math.hypot(def(a).x - me.x, def(a).y - me.y) - Math.hypot(def(b).x - me.x, def(b).y - me.y));
  return materialize(s, ids[0]);
};
const lotOf = (s: GameState, kind: string, id: string) => home(s).lots.findIndex(l => l?.kind === kind && l.id === id);

describe('motore', () => {
  it('è deterministico con lo stesso seme', () => {
    const a = newGame(42), b = newGame(42);
    tick(a, 72 * H); tick(b, 72 * H);
    expect(a).toEqual(b);
  });

  it('la mappa ha tutti gli stati e migliaia di città; si parte da una sola', () => {
    expect(STATES.length).toBe(51);
    expect(CITY_COUNT).toBeGreaterThan(15000);
    const s = newGame(1);
    expect(owned(s).length).toBe(1);
    expect(['Cittadina', 'Città']).toContain(def(s.capital).tier);
  });

  it('ogni città ha una disposizione con polizia, municipio e lotti in base alla fascia', () => {
    for (const id of ['0', '5', '500', '5000', '15000']) {
      const L = layout(id); const d = def(id);
      expect(L.lots.length).toBe(LOTS_BY_TIER[d.tier]);
      expect(L.blocks[L.police].kind).toBe('police');
      expect(L.blocks[L.mayor].kind).toBe('mayor');
      expect(layout(id)).toBe(L);
    }
    expect(JSON.stringify(layout('10').blocks.map(b => b.kind))).not.toBe(JSON.stringify(layout('11').blocks.map(b => b.kind)));
  });

  it('si parte con QG, pizzo e cassaforte sui lotti', () => {
    const s = newGame(1);
    expect(buildingLevel(home(s), 'qg')).toBe(1);
    expect(racketLevel(home(s), 'pizzo')).toBe(1);
    expect(freeLots(home(s)).length).toBe(lotCount(s.capital) - 3);
  });

  it('si costruisce su un lotto libero; doppioni sì per i front, no per i racket', () => {
    const s = newGame(2); const c = s.capital; s.res.sporco = 1e6;
    const [l1, l2, l3] = freeLots(home(s));
    expect(act(s, { t: 'build', city: c, lot: l1, kind: 'front', id: 'bar' }).ok).toBe(true);
    expect(act(s, { t: 'build', city: c, lot: l2, kind: 'front', id: 'bar' }).ok).toBe(false); // cantiere occupato
    tick(s, 2 * H);
    expect(act(s, { t: 'build', city: c, lot: l2, kind: 'front', id: 'bar' }).ok).toBe(true);
    tick(s, 2 * H);
    expect(home(s).lots.filter(l => l?.id === 'bar').length).toBe(2);
    expect(act(s, { t: 'build', city: c, lot: l3, kind: 'racket', id: 'pizzo' }).ok).toBe(false);
    expect(buildOptions(s, home(s)).find(o => o.id === 'qg')!.blocked).toBeTruthy();
  });

  it('potenziare un lotto lo paga e ne alza il livello', () => {
    const s = newGame(3); const c = s.capital; const lot = lotOf(s, 'racket', 'pizzo');
    const before = s.res.sporco; const cost = upgradeCost('racket', 'pizzo', 2).sporco!;
    expect(act(s, { t: 'upgrade', city: c, lot }).ok).toBe(true);
    expect(s.res.sporco).toBe(before - cost);
    tick(s, 2 * H);
    expect(racketLevel(home(s), 'pizzo')).toBe(2);
  });

  it('i doppioni rendono sempre meno (saturazione per categoria)', () => {
    const s = newGame(4); const free = freeLots(home(s));
    home(s).lots[free[0]] = { kind: 'front', id: 'bar', level: 6 };
    const one = rates(s).clean;
    home(s).lots[free[1]] = { kind: 'front', id: 'bar', level: 6 };
    expect(rates(s).clean).toBeLessThan(one * 2);
  });

  it('il lavaggio trasforma sporco in pulito con la commissione', () => {
    const s = newGame(5); const free = freeLots(home(s));
    home(s).lots[free[0]] = { kind: 'front', id: 'lavanderia', level: 3 };
    home(s).lots[lotOf(s, 'racket', 'pizzo')]!.level = 6; s.res.sporco = 100000; s.launderShare = 1;
    const clean = rates(s).clean;
    tick(s, H);
    expect(s.stats.laundered).toBeGreaterThan(0);
    expect(s.res.pulito - clean).toBeLessThan(s.stats.laundered);
  });

  it('l\'influenza è della città e cresce con le attività legali', () => {
    const s = newGame(6); const free = freeLots(home(s));
    home(s).lots[free[0]] = { kind: 'front', id: 'bar', level: 5 };
    tick(s, 10 * H);
    expect(home(s).influence).toBeGreaterThan(0);
    expect(home(s).influence).toBeLessThanOrEqual(K.influenceCap);
  });

  it('libro paga e bustarella abbassano il calore', () => {
    const s = newGame(7); s.res.sporco = 1e6; const c = home(s);
    c.heat = 50;
    expect(act(s, { t: 'police', city: s.capital, id: 'bustarella' }).ok).toBe(true);
    expect(c.heat).toBe(50 - K.bustarellaHeat);
    expect(act(s, { t: 'police', city: s.capital, id: 'bustarella' }).ok).toBe(false);
    const p0 = rates(s).cities[s.capital].pressure.total;
    home(s).lots[lotOf(s, 'racket', 'pizzo')]!.level = 10;
    const before = rates(s).cities[s.capital].pressure.total;
    act(s, { t: 'payroll', city: s.capital, level: 3 });
    expect(rates(s).cities[s.capital].pressure.total).toBeLessThan(before);
    expect(p0).toBeGreaterThanOrEqual(0);
  });

  it('arrivano tre avvisi prima di una retata', () => {
    const s = newGame(8); const free = freeLots(home(s));
    home(s).lots[free[0]] = { kind: 'racket', id: 'narcotici', level: 8 };
    home(s).lots[free[1]] = { kind: 'racket', id: 'armi', level: 4 };
    home(s).gang.nextAttackAt = 1e12;
    tick(s, 72 * H);
    const log = [...s.log].reverse();
    const warn = ['si parla di te', 'auto civetta', 'stanno preparando una retata'];
    const first = log.findIndex(l => l.text.includes('RETATA'));
    const before = log.slice(0, first < 0 ? log.length : first).filter(l => warn.some(w => l.text.includes(w)));
    expect(before.length).toBe(3);
    expect(before[2].t - before[0].t).toBeGreaterThanOrEqual(2 * K.warnGapHours * H);
  });

  it('il rivale locale attacca dopo la protezione, con preavviso', () => {
    const s = newGame(9);
    tick(s, (K.protectionHours + K.rivalAttackMax + 1) * H);
    const texts = s.log.map(l => l.text).join('\n');
    expect(texts).toMatch(/gli informatori avvisano/);
    expect(texts).toMatch(/razziato|respinto|sabotaggio/);
  });

  it('un colpo in un\'altra città porta bottino e indebolisce la banda', () => {
    const s = newGame(10); const t = npc(s);
    home(s).units.soldati = 500; home(s).units.corrieri = 5;
    const share = t.gang.share;
    expect(act(s, { t: 'mission', kind: 'raid', from: s.capital, to: t.id, units: { soldati: 500, corrieri: 5 } }).ok).toBe(true);
    tick(s, 8 * H);
    expect(s.stats.looted).toBeGreaterThan(0);
    expect(t.gang.share).toBeLessThan(share);
  });

  it('la conquista eredita il 20% di influenza e calore nello stesso stato', () => {
    const s = newGame(11); const t = npc(s);
    home(s).units.enforcer = 250; home(s).influence = 300; home(s).heat = 100; home(s).gang.nextAttackAt = 1e12;
    home(s).units.delfino = 1; act(s, { t: 'mission', kind: 'assault', from: s.capital, to: t.id, units: { enforcer: 250, delfino: 1 }, lot: whereIs(t, 'qg')!.lot });
    const arrive = s.missions[0].arriveAt;
    tick(s, arrive - s.time + 1);
    expect(t.owner).toBe('player');
    expect(t.influence).toBeCloseTo(home(s).influence > 0 ? 60 : 60, -1);
    expect(buildingLevel(t, 'qg')).toBe(1);
    expect(fortDefense(t)).toBeGreaterThan(0);
  });

  it('le bande del server sono deboli e uguali nel tempo: 20-30 picchiatori, 5-10 soldati, 3-6 enforcer', () => {
    const s = newGame(51);
    const ids = [...CITIES_BY_STATE[def(s.capital).stateIdx].slice(0, 40).map(String)];
    const check = (id: string) => { const g = peekCity(s, id).gang.units;
      expect(g.picchiatori).toBeGreaterThanOrEqual(20); expect(g.picchiatori).toBeLessThanOrEqual(30);
      expect(g.soldati).toBeGreaterThanOrEqual(5); expect(g.soldati).toBeLessThanOrEqual(10);
      expect(g.enforcer).toBeGreaterThanOrEqual(3); expect(g.enforcer).toBeLessThanOrEqual(6); };
    ids.forEach(check);
    s.time = 60 * 86400; ids.filter(id => !s.cities[id]).forEach(check);
    const f = ids.map(id => fortDefense(peekCity(s, id)));
    expect(Math.min(...f)).toBeGreaterThan(150); expect(Math.max(...f)).toBeLessThan(400);
  });

  it('senza Delfino niente conquista; col Delfino la città è tua e lui resta a reggerla', () => {
    const s = newGame(11); const t = npc(s);
    home(s).units.soldati = 120; home(s).influence = 300; home(s).gang.nextAttackAt = 1e12; s.res.sporco = 1e7;
    const lot = whereIs(t, 'qg')!.lot;
    const no = act(s, { t: 'mission', kind: 'assault', from: s.capital, to: t.id, units: { soldati: 120 }, lot });
    expect(no.ok).toBe(false); expect(no.m?.k ?? no.msg).toMatch(/Delfino/);
    expect(act(s, { t: 'recruit', city: s.capital, id: 'delfino', n: 1 }).ok).toBe(true);
    expect(act(s, { t: 'recruit', city: s.capital, id: 'delfino', n: 1 }).ok).toBe(false);
    tick(s, 36 * H + 60);
    expect(home(s).units.delfino).toBe(1);
    home(s).units.soldati = 120;
    expect(act(s, { t: 'mission', kind: 'raid', from: s.capital, to: t.id, units: { soldati: 10, delfino: 1 } }).ok).toBe(false);
    expect(act(s, { t: 'mission', kind: 'assault', from: s.capital, to: t.id, units: { soldati: 120, delfino: 1 }, lot }).ok).toBe(true);
    tick(s, s.missions[0].arriveAt - s.time + 1);
    expect(t.owner).toBe('player');
    expect(t.units.delfino).toBe(1); expect(home(s).units.delfino).toBe(0);
    expect(rates(s).upkeepSporco).toBeGreaterThanOrEqual(3000);
    // niente tregua: si può subito colpire un'altra banda
    const other = CITIES_BY_STATE[def(s.capital).stateIdx].map(String).find(id => id !== s.capital && id !== t.id)!;
    home(s).units.soldati = 50;
    expect(act(s, { t: 'mission', kind: 'raid', from: s.capital, to: other, units: { soldati: 50 } }).ok).toBe(true);
    // il Delfino reggente non si muove
    t.units.soldati = 10;
    expect(act(s, { t: 'mission', kind: 'assault', from: t.id, to: other, units: { soldati: 10, delfino: 1 } }).ok).toBe(false);
  });

  it('se l\'assalto fallisce il Delfino muore', () => {
    const s = newGame(12); const t = npc(s);
    home(s).units.picchiatori = 3; home(s).units.delfino = 1; home(s).influence = 300; home(s).gang.nextAttackAt = 1e12; s.res.sporco = 1e7;
    expect(act(s, { t: 'mission', kind: 'assault', from: s.capital, to: t.id, units: { picchiatori: 3, delfino: 1 }, lot: whereIs(t, 'qg')!.lot }).ok).toBe(true);
    tick(s, 24 * H);
    expect(t.owner).toBe('npc'); expect(home(s).units.delfino).toBe(0);
  });

  it('colpo alla cassa: la stessa città si ripulisce una volta al giorno', () => {
    const s = newGame(14); const t = npc(s);
    home(s).units.soldati = 100; home(s).gang.nextAttackAt = 1e12; s.res.sporco = 1e7;
    expect(act(s, { t: 'mission', kind: 'raid', from: s.capital, to: t.id, units: { soldati: 50 } }).ok).toBe(true);
    tick(s, s.missions[0].arriveAt - s.time + 1);
    const no = act(s, { t: 'mission', kind: 'raid', from: s.capital, to: t.id, units: { soldati: 10 } });
    expect(no.ok).toBe(false);
    tick(s, 24 * H);
    expect(act(s, { t: 'mission', kind: 'raid', from: s.capital, to: t.id, units: { soldati: 10 } }).ok).toBe(true);
  });

  it('la capitale si sposta in una città conquistata, una volta a settimana; il Delfino lì si fa da parte', () => {
    const s = newGame(15); const t = npc(s); const old = s.capital;
    t.owner = 'player'; t.units.delfino = 1;
    expect(act(s, { t: 'setCapital', city: t.id }).ok).toBe(true);
    expect(s.capital).toBe(t.id); expect(t.units.delfino).toBe(0);
    expect(act(s, { t: 'setCapital', city: old }).ok).toBe(false);
    tick(s, 7 * 24 * H + 60);
    expect(act(s, { t: 'setCapital', city: old }).ok).toBe(true);
    s.cities[old].taken = true; s.capitalMovedAt = -1e9;
    expect(act(s, { t: 'setCapital', city: t.id }).ok).toBe(true);
    expect(act(s, { t: 'setCapital', city: old }).ok).toBe(false);
  });

  it('per uscire dallo stato serve influenza nella città di partenza', () => {
    const s = newGame(13); const me = def(s.capital);
    let far = 0; while (def(String(far)).stateAbbr === me.stateAbbr) far++;
    expect(influenceNeeded(s, String(far))).toBe(K.stateInfluenceBase);
    home(s).units.soldati = 10;
    expect(act(s, { t: 'mission', kind: 'raid', from: s.capital, to: String(far), units: { soldati: 5 } }).ok).toBe(false);
    home(s).influence = K.stateInfluenceBase;
    expect(act(s, { t: 'mission', kind: 'raid', from: s.capital, to: String(far), units: { soldati: 5 } }).ok).toBe(true);
  });

  it('oltre il limite di gestione la resa cala', () => {
    const s = newGame(14);
    expect(cityLimit(s)).toBe(1);
    npc(s).owner = 'player';
    expect(efficiency(s)).toBeCloseTo(1 - K.overPenalty);
    s.research.gestione = 1;
    expect(efficiency(s)).toBe(1);
  });

  it('l\'acquisizione richiede una banda indebolita e influenza nella città che paga', () => {
    const s = newGame(15); const t = npc(s);
    s.res.pulito = 1e6; home(s).influence = 300; home(s).units.delfino = 1;
    expect(act(s, { t: 'acquire', from: s.capital, city: t.id }).ok).toBe(false);
    t.gang.share = 0.4;
    expect(act(s, { t: 'acquire', from: s.capital, city: t.id }).ok).toBe(true);
    expect(t.owner).toBe('player');
  });

  it('municipio: la licenza sblocca il casinò solo in quella città', () => {
    const s = newGame(16); home(s).influence = 300;
    expect(buildOptions(s, home(s)).find(o => o.id === 'casino')!.blocked).toMatch(/Licenza/);
    expect(act(s, { t: 'mayor', city: s.capital, id: 'licenzaCasino' }).ok).toBe(true);
    expect(buildOptions(s, home(s)).find(o => o.id === 'casino')!.blocked ?? '').not.toMatch(/Licenza/);
  });

  it('giri: uno ogni 2 livelli, piazzati in automatico, massimo 3 per isolato', () => {
    const s = newGame(20); const c = home(s);
    expect(giriTotal(c, 'pizzo')).toBe(1); expect(giriPlaced(c, 'pizzo')).toBe(1);
    c.lots[lotOf(s, 'racket', 'pizzo')]!.level = 6;
    expect(giriTotal(c, 'pizzo')).toBe(3);
    const free = layout(c.id).turf.find(b => !gangBlocks(c).has(b) && !c.turf[b])!;
    expect(act(s, { t: 'turf', city: c.id, block: free, racket: 'pizzo', op: 'add' }).ok).toBe(true);
    expect(act(s, { t: 'turf', city: c.id, block: free, racket: 'pizzo', op: 'add' }).ok).toBe(true);
    expect(act(s, { t: 'turf', city: c.id, block: free, racket: 'pizzo', op: 'add' }).ok).toBe(false); // giri finiti
    c.lots[lotOf(s, 'racket', 'pizzo')]!.level = 10;
    act(s, { t: 'turf', city: c.id, block: free, racket: 'pizzo', op: 'add' });
    expect(act(s, { t: 'turf', city: c.id, block: free, racket: 'pizzo', op: 'add' }).ok).toBe(false); // isolato pieno
  });

  it('senza giri il racket non rende; nelle tue città non ci sono bande', () => {
    const s = newGame(21); const c = home(s);
    expect(rates(s).dirty).toBeGreaterThan(0);
    c.turf = {};
    expect(rates(s).dirty).toBe(0);
    expect(gangBlocks(c).size).toBe(0);
    expect(c.gang.share).toBe(0);
    c.units.soldati = 5;
    expect(act(s, { t: 'mission', kind: 'raid', from: c.id, to: c.id, units: { soldati: 5 } }).ok).toBe(false);
  });

  it('dopo la conquista la città è tutta tua', () => {
    const s = newGame(24); const t = npc(s);
    home(s).units.enforcer = 250; home(s).gang.nextAttackAt = 1e12;
    home(s).units.delfino = 1; act(s, { t: 'mission', kind: 'assault', from: s.capital, to: t.id, units: { enforcer: 250, delfino: 1 }, lot: whereIs(t, 'qg')!.lot });
    tick(s, s.missions[0].arriveAt - s.time + 1);
    expect(t.owner).toBe('player');
    expect(t.gang.share).toBe(0);
    expect(gangBlocks(t).size).toBe(0);
  });

  it('il libro paga dà punti protezione che abbassano il grado di un isolato', () => {
    const s = newGame(22); const c = home(s); s.res.sporco = 1e6;
    const b = Number(Object.keys(c.turf)[0]);
    const g0 = tileRisk(c, b).grade;
    expect(act(s, { t: 'protect', city: c.id, block: b, delta: 1 }).ok).toBe(false);
    act(s, { t: 'payroll', city: c.id, level: 2 });
    expect(act(s, { t: 'protect', city: c.id, block: b, delta: 1 }).ok).toBe(true);
    expect(tileRisk(c, b).grade).toBe(g0 - 1);
    act(s, { t: 'payroll', city: c.id, level: 0 });
    expect(protectUsed(c)).toBe(0);
  });

  it('giri ammucchiati sulla ronda con calore alto portano controlli', () => {
    const s = newGame(23); const c = home(s); s.res.sporco = 1e6; c.gang.nextAttackAt = 1e15;
    c.lots[lotOf(s, 'racket', 'pizzo')]!.level = 6; c.units.picchiatori = 50;
    const L = layout(c.id);
    const b = L.turf.filter(x => !gangBlocks(c).has(x)).sort((x, y) => exposure(c, y) - exposure(c, x))[0];
    c.turf = { [b]: ['pizzo', 'pizzo', 'pizzo'] }; c.heat = 70; c.heatSpike = 40;
    expect(tileRisk(c, b).level).toBeGreaterThanOrEqual(3);
    tick(s, 120 * H);
    expect(s.log.some(l => l.text.includes('CONTROLLO'))).toBe(true);
  });

  it('trasloco: il QG si nasconde in un\'attività e libera il lotto', () => {
    const s = newGame(30); const c = home(s); s.res.sporco = 1e6;
    const bar = freeLots(c)[0]; c.lots[bar] = { kind: 'front', id: 'bar', level: 2 };
    const qgLot = whereIs(c, 'qg')!.lot; const freeBefore = freeLots(c).length;
    expect(act(s, { t: 'move', city: c.id, what: 'qg', toLot: bar }).ok).toBe(true);
    expect(buildingLevel(c, 'qg')).toBe(0); // in trasloco non lavora
    expect(c.lots[qgLot]).toBeNull();
    tick(s, (K.moveHours + 0.1) * H);
    expect(whereIs(c, 'qg')).toMatchObject({ lot: bar, hosted: true });
    expect(buildingLevel(c, 'qg')).toBe(1);
    expect(freeLots(c).length).toBe(freeBefore + 1);
    expect(act(s, { t: 'demolish', city: c.id, lot: bar }).ok).toBe(false); // dentro c'è il QG
  });

  it('le città delle bande hanno QG, cassaforte e attività sui lotti', () => {
    const s = newGame(31); const t = npc(s);
    expect(whereIs(t, 'qg')).not.toBeNull();
    expect(whereIs(t, 'cassaforte')).not.toBeNull();
    expect(t.lots.filter(l => l?.kind === 'racket').length).toBeGreaterThanOrEqual(2);
  });

  it('spia, poi colpisci un edificio visto: resta chiuso qualche ora', () => {
    const s = newGame(32); const t = npc(s); const c = home(s);
    c.units.soldati = 600; c.units.informatori = 6; c.gang.nextAttackAt = 1e12; s.res.sporco = 1e7;
    const target = t.lots.findIndex(l => l?.kind === 'front' || l?.kind === 'racket');
    expect(act(s, { t: 'mission', kind: 'strike', from: c.id, to: t.id, units: { soldati: 10 }, lot: target }).ok).toBe(false); // niente rapporto
    act(s, { t: 'mission', kind: 'spy', from: c.id, to: t.id, units: { informatori: 6 } });
    tick(s, 3 * H);
    if (!t.gang.intel) return; // informatori scoperti: capita
    expect(t.gang.intel.lots?.length).toBe(t.lots.length);
    const res = act(s, { t: 'mission', kind: 'strike', from: c.id, to: t.id, units: { soldati: 600 }, lot: target });
    expect(res.ok).toBe(true);
    tick(s, s.missions[0].arriveAt - s.time + 1);
    expect(t.lots[target]!.closedUntil).toBeGreaterThan(s.time);
  });

  it('assalto sull\'edificio sbagliato: niente conquista, banda in allerta', () => {
    const s = newGame(33); const t = npc(s); const c = home(s);
    c.units.enforcer = 250; c.units.delfino = 1; c.gang.nextAttackAt = 1e12;
    const wrong = t.lots.findIndex((l, i) => l && i !== whereIs(t, 'qg')!.lot);
    act(s, { t: 'mission', kind: 'assault', from: c.id, to: t.id, units: { enforcer: 80, delfino: 1 }, lot: wrong });
    tick(s, s.missions[0].arriveAt - s.time + 1);
    expect(t.owner).toBe('npc');
    expect(t.alertUntil).toBeGreaterThan(s.time);
  });

  it('conquistando il QG le attività della banda passano a te', () => {
    const s = newGame(34); const t = npc(s); const c = home(s);
    c.units.enforcer = 300; c.units.delfino = 1; c.gang.nextAttackAt = 1e12;
    const theirs = t.lots.filter(Boolean).length;
    act(s, { t: 'mission', kind: 'assault', from: c.id, to: t.id, units: { enforcer: 300, delfino: 1 }, lot: whereIs(t, 'qg')!.lot });
    tick(s, s.missions[0].arriveAt - s.time + 1);
    expect(t.owner).toBe('player');
    expect(t.lots.filter(Boolean).length).toBe(theirs);
    expect(buildingLevel(t, 'qg')).toBeGreaterThan(0);
  });

  it('sindaco: campagna di 48 ore, una sola città, due lotti in più', () => {
    const s = newGame(35); const c = home(s); s.res.pulito = 1e7; c.gang.nextAttackAt = 1e12;
    expect(act(s, { t: 'campaign', city: c.id }).ok).toBe(false); // serve influenza piena
    c.influence = K.influenceCap; c.heat = 0;
    const before = usableLots(s, c);
    expect(act(s, { t: 'campaign', city: c.id }).ok).toBe(true);
    tick(s, (K.campaignHours + 1) * H);
    expect(isMayorOf(s, c.id)).toBe(true);
    expect(usableLots(s, c)).toBe(before + 2);
    const other = npc(s); other.owner = 'player'; other.influence = K.influenceCap;
    expect(act(s, { t: 'campaign', city: other.id }).ok).toBe(false);
  });

  it('lo stato sopravvive a JSON (salvataggio)', () => {
    const s = newGame(17);
    act(s, { t: 'recruit', city: s.capital, id: 'picchiatori', n: 3 });
    act(s, { t: 'build', city: s.capital, lot: freeLots(home(s))[0], kind: 'front', id: 'bar' });
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    tick(s, 30 * H); tick(copy, 30 * H);
    expect(copy).toEqual(s);
  });

  it('il lavaggio lascia sempre la cassa degli stipendi', () => {
    const s = newGame(41); const c = home(s); c.gang.nextAttackAt = 1e15;
    c.units.picchiatori = 40; s.res.sporco = 0; s.launderShare = 1;
    c.lots[freeLots(c)[0]] = { kind: 'front', id: 'lavanderia', level: 8 };
    expect(rates(s).dirty).toBeGreaterThan(rates(s).upkeepSporco);
    tick(s, 12 * H);
    expect(s.log.some(l => l.text.includes('per gli stipendi'))).toBe(false);
  });

  it('vacanza: tutto fermo, poi le scadenze slittano', () => {
    const s = newGame(42); const c = home(s); s.res.sporco = 1e5;
    const before = s.res.sporco; const next = c.gang.nextAttackAt;
    expect(act(s, { t: 'vacation', days: 3 }).ok).toBe(true);
    tick(s, 2 * 24 * H);
    expect(s.res.sporco).toBe(before);
    tick(s, 2 * 24 * H);
    expect(s.vacation).toBeNull();
    expect(c.gang.nextAttackAt).toBeGreaterThanOrEqual(next + 3 * 24 * H - 1);
    expect(act(s, { t: 'vacation', days: 19 }).ok).toBe(false);
  });

  it('interrompere: arruolamenti (restano i già fatti), missioni richiamate, coda', () => {
    const s = newGame(45); const c = home(s); s.res.sporco = 1e7; s.res.pulito = 1e7; c.units.picchiatori = 0;
    expect(act(s, { t: 'recruit', city: c.id, id: 'picchiatori', n: 10 }).ok).toBe(true);
    expect(act(s, { t: 'recruit', city: c.id, id: 'picchiatori', n: 5 }).ok).toBe(true);
    expect(c.unitQueue.length).toBe(2);
    const per = c.unitQueue[0].per;
    tick(s, per * 3 + 1);
    const done = c.unitQueue[0].done; expect(done).toBeGreaterThan(0);
    const money = s.res.sporco + s.res.pulito;
    expect(act(s, { t: 'cancelUnits', city: c.id, index: 1 }).ok).toBe(true);
    expect(c.unitQueue.length).toBe(1);
    expect(act(s, { t: 'cancelUnits', city: c.id, index: 0 }).ok).toBe(true);
    expect(c.unitQueue.length).toBe(0);
    expect(c.units.picchiatori).toBe(done);
    expect(s.res.sporco + s.res.pulito).toBeGreaterThan(money);
    // missione richiamata: niente scontro, gli uomini tornano
    const t = npc(s); c.units.soldati = 100;
    expect(act(s, { t: 'mission', kind: 'raid', from: s.capital, to: t.id, units: { soldati: 100 } }).ok).toBe(true);
    const m = s.missions[s.missions.length - 1]; const share = t.gang.share;
    tick(s, 60);
    expect(act(s, { t: 'recall', mission: m.id }).ok).toBe(true);
    expect(act(s, { t: 'recall', mission: m.id }).ok).toBe(false);
    expect(m.returnAt - s.time).toBeLessThanOrEqual(120);
    tick(s, m.returnAt - s.time + 1);
    expect(t.gang.share).toBe(share);
    expect(c.units.soldati).toBe(100);
    expect(s.missions.find(x => x.id === m.id)).toBeUndefined();
  });

  it('postura difensiva: all\'avviso recluta da sola', () => {
    const s = newGame(43); const c = home(s); s.res.sporco = 1e5; c.units.picchiatori = 0;
    expect(autoDefend(s, c, 200)).toBe(0);
    act(s, { t: 'posture', auto: true, share: 0.5 });
    expect(autoDefend(s, c, 200)).toBeGreaterThan(0);
    expect(c.unitQueue.length).toBe(1);
  });

  it('stagioni: calendario vuoto; con un evento in calendario arriva l\'annuncio 7 giorni prima', async () => {
    const { syncSeasonSingle, seasonAt, applySeasonMods, setSeasonCalendar, SEASON_DRAFTS } = await import('./seasons');
    expect(seasonAt(95)).toBeNull(); // calendario vuoto di default
    setSeasonCalendar(SEASON_DRAFTS);
    const s = newGame(44); s.time = 83 * 24 * H; syncSeasonSingle(s);
    expect(s.log[0].text).toMatch(/Tra 7 giorni: Proibizionismo/);
    expect(seasonAt(95)?.id).toBe('proibizionismo'); expect(seasonAt(111)).toBeNull();
    s.time = 90 * 24 * H; syncSeasonSingle(s);
    expect(s.log[0].text).toMatch(/Comincia: Proibizionismo/);
    applySeasonMods(null); setSeasonCalendar([]);
  });

  it('retate: avvisi distanziati e tregua dopo il colpo', () => {
    const s = newGame(45); const c = home(s); c.gang.nextAttackAt = 1e15; s.res.sporco = 1e6;
    c.heat = 90; c.heatSpike = 200;
    tick(s, 3 * H);
    expect(s.log.filter(l => /RETATA|INDAGINE/.test(l.text)).length).toBe(0); // tre avvisi servono almeno 12 ore
    tick(s, 30 * 24 * H);
    const hits = s.log.filter(l => /RETATA|INDAGINE/.test(l.text)).length;
    expect(hits).toBeGreaterThan(0); expect(hits).toBeLessThanOrEqual(12);
  });

  it('investimenti: il pulito diventa rendita in più', () => {
    const s = newGame(46); s.res.pulito = 2e7;
    const before = rates(s).dirty;
    expect(act(s, { t: 'invest', amount: 1e7 }).ok).toBe(true);
    expect(rates(s).dirty).toBeGreaterThan(before * 1.15);
  });
});

// ---------------------------------------------------------------- traduzioni
/** Una partita movimentata: cantieri, ricerche, reclute, missioni, polizia, municipio, calore alto, vacanza ed errori voluti. */
function busyGame(seed: number) {
  const s = newGame(seed);
  const results: Result[] = []; const seen = new Set<object>(); const log: GameState['log'] = []; const reports: GameState['reports'] = [];
  const harvest = () => { for (const l of s.log) if (!seen.has(l)) { seen.add(l); log.push(l); } for (const r of s.reports) if (!seen.has(r)) { seen.add(r); reports.push(r); } };
  const go = (sec: number) => { for (let left = sec; left > 0; left -= 2 * H) { tick(s, Math.min(2 * H, left)); harvest(); } };
  const run = (a: Action) => { const r = act(s, a); results.push(r); harvest(); return r; };
  const me = home;
  const near = () => { const d = def(s.capital); return CITIES_BY_STATE[d.stateIdx].map(String).filter(id => id !== s.capital && s.cities[id]?.owner !== 'player').sort((a, b) => Math.hypot(def(a).x - d.x, def(a).y - d.y) - Math.hypot(def(b).x - d.x, def(b).y - d.y)); };
  harvest();
  run({ t: 'build', city: '999999', lot: 0, kind: 'front', id: 'bar' });
  run({ t: 'demolish', city: s.capital, lot: where(me(s), 'qg')!.lot });
  run({ t: 'mission', kind: 'raid', from: s.capital, to: near()[0], units: {} });
  run({ t: 'mission', kind: 'spy', from: s.capital, to: near()[0], units: { picchiatori: 1 } });
  run({ t: 'vacation', days: 1 }); run({ t: 'invest', amount: 10 }); run({ t: 'campaign', city: s.capital });
  run({ t: 'research', id: 'tattica' }); run({ t: 'recruit', city: s.capital, id: 'enforcer', n: 1 });
  run({ t: 'acquire', from: s.capital, city: near()[0] });
  s.res.sporco = 3e6; s.res.pulito = 3e6;
  const build = (kind: 'racket' | 'front' | 'building', id: string) => { const f = freeLots(me(s), s); if (f.length) { run({ t: 'build', city: s.capital, lot: f[0], kind, id }); go(4 * H); } };
  build('front', 'bar'); build('building', 'armeria'); build('racket', 'bische');
  for (let i = 0; i < 3; i++) { run({ t: 'upgrade', city: s.capital, lot: where(me(s), 'qg')!.lot }); go(6 * H); }
  for (let i = 0; i < 2; i++) { run({ t: 'upgrade', city: s.capital, lot: me(s).lots.findIndex(l => l?.id === 'armeria') }); go(6 * H); }
  build('racket', 'usura');
  for (const r of RESEARCH) { run({ t: 'research', id: r.id }); run({ t: 'cancel', queue: 'research' }); run({ t: 'research', id: r.id }); go(8 * H); }
  for (const u of UNITS) run({ t: 'recruit', city: s.capital, id: u.id, n: u.id === 'delfino' ? 1 : u.id === 'soldati' ? 60 : u.id === 'enforcer' ? 20 : u.id === 'corrieri' ? 1 : 8 });
  go(24 * H);
  run({ t: 'payroll', city: s.capital, level: 2 }); run({ t: 'police', city: s.capital, id: 'bustarella' }); run({ t: 'police', city: s.capital, id: 'bustarella' });
  run({ t: 'police', city: s.capital, id: 'occhio' }); run({ t: 'police', city: s.capital, id: 'soffiata', target: near()[1] });
  run({ t: 'promote', city: s.capital, racket: 'pizzo' }); run({ t: 'mayor', city: s.capital, id: 'boxe' }); run({ t: 'mayor', city: s.capital, id: 'fiera' });
  run({ t: 'posture', auto: true, share: 0.3 }); run({ t: 'invest', amount: 100000 });
  run({ t: 'move', city: s.capital, what: 'cassaforte', toLot: me(s).lots.findIndex(l => l?.id === 'bar') }); go(4 * H);
  for (let round = 0; round < 3; round++) {
    const targets = near().slice(0, 2);
    for (const to of targets) { materialize(s, to); run({ t: 'mission', kind: 'spy', from: s.capital, to, units: { informatori: Math.min(2, me(s).units.informatori) } }); }
    go(3 * H);
    for (const to of targets) {
      run({ t: 'mission', kind: 'raid', from: s.capital, to, units: { picchiatori: Math.min(3, me(s).units.picchiatori), corrieri: Math.min(1, me(s).units.corrieri) } });
      const lots = peekCity(s, to).gang.intel?.lots; const lot = lots ? lots.findIndex(l => l && !(l.kind === 'building' && l.id === 'qg')) : -1;
      if (lot >= 0) run({ t: 'mission', kind: 'strike', from: s.capital, to, units: { soldati: Math.min(5, me(s).units.soldati) }, lot });
      run({ t: 'mission', kind: 'assault', from: s.capital, to, units: { soldati: Math.min(round ? 30 : 2, me(s).units.soldati), enforcer: Math.min(round ? 15 : 0, me(s).units.enforcer), delfino: Math.min(1, me(s).units.delfino) } });
      run({ t: 'setCapital', city: owned(s).find(c => c.id !== s.capital)?.id ?? s.capital });
    }
    go(12 * H);
    for (const u of UNITS) run({ t: 'recruit', city: s.capital, id: u.id, n: u.id === 'delfino' ? 1 : u.id === 'soldati' ? 40 : u.id === 'enforcer' ? 15 : 5 });
    s.res.sporco += 1e6; s.res.pulito += 1e6;
    const other = owned(s).find(c => c.id !== s.capital);
    if (other) run({ t: 'mission', kind: 'transfer', from: s.capital, to: other.id, units: { picchiatori: 1 } });
    go(12 * H);
  }
  for (const to of near().slice(0, 3)) { const c = materialize(s, to); c.gang.share = 0.3; me(s).influence = 300; if (run({ t: 'acquire', from: s.capital, city: to }).ok) break; }
  me(s).influence = 300; me(s).heat = 0; run({ t: 'campaign', city: s.capital }); go(50 * H);
  run({ t: 'mayor', city: s.capital, id: 'zonizzazione' }); run({ t: 'mayor', city: s.capital, id: 'zonizzazione' });
  me(s).heat = 99; go(2 * H);
  for (const c of owned(s)) { const f = freeLots(c, s); if (f[0] !== undefined) c.lots[f[0]] = { kind: 'racket', id: 'narcotici', level: 12 }; c.payroll = 0; }
  run({ t: 'autoTurf', city: s.capital }); go(4 * 24 * H);
  s.res.sporco = 0; s.res.pulito = 0; go(4 * H); s.res.sporco = 1e6; s.res.pulito = 1e6;
  run({ t: 'vacation', days: 2 }); go(3 * 24 * H);
  return { s, log, reports, results };
}
const placeholders = (x: string) => [...new Set(x.match(/\{\w+\}/g) ?? [])].sort();
/** Tutte le chiavi usate da un messaggio, compresi i messaggi annidati nei parametri. */
function keysOf(m: Msg, out = new Set<string>()) {
  out.add(m.k);
  for (const v of Object.values(m.p ?? {})) if (typeof v === 'object' && 'k' in v) keysOf(v, out);
  return out;
}

describe('traduzioni', () => {
  it('ogni messaggio di una partita lunga ha la traduzione inglese', () => {
    const { log, reports, results } = busyGame(7);
    const msgs: Msg[] = [
      ...log.map(l => { expect(l.m, l.text).toBeTruthy(); expect(render(l.m!, 'it')).toBe(l.text); return l.m!; }),
      ...reports.flatMap(r => [r.m!.title, ...r.m!.lines, r.m!.advice]),
      ...results.filter(r => r.msg).map(r => { expect(r.m, r.msg).toBeTruthy(); return r.m!; }),
    ];
    expect(log.length).toBeGreaterThan(100); expect(reports.length).toBeGreaterThan(5);
    const keys = new Set<string>(); for (const m of msgs) keysOf(m, keys);
    MISSING.clear();
    for (const m of msgs) render(m, 'en');
    expect([...MISSING].filter(k => keys.has(k))).toEqual([]);
    expect([...keys].filter(k => !(k in EN_ENGINE) && !(k in EN_DATA))).toEqual([]);
  });

  it('chiave e traduzione hanno gli stessi segnaposto', () => {
    const bad = [...Object.entries(EN_ENGINE), ...Object.entries(EN_DATA)].filter(([k, v]) => placeholders(k).join() !== placeholders(v).join());
    expect(bad).toEqual([]);
  });

  it('i cataloghi del gioco hanno tutti il nome inglese', () => {
    const texts = [
      ...[...RACKETS, ...FRONTS, ...BUILDINGS, ...RESEARCH, ...UNITS].flatMap(d => [d.name, d.desc]),
      ...RACKETS.map(d => d.name.toLowerCase()), ...UNITS.map(d => d.name.toLowerCase()), ...BUILDINGS.map(d => d.name.toLowerCase()),
      ...Object.values(CATEGORY_LABEL), ...Object.values(ZONE_LABEL), ...Object.values(ZONE_DESC), ...PAYROLL, ...Object.values(DECO_LABEL),
      ...Object.keys(LOTS_BY_TIER), ...Object.values(FLAVOR).flat(),
      ...POLICE.flatMap(p => [p.name, p.desc]), ...MAYOR.flatMap(p => [p.name, p.name.toLowerCase(), p.desc]),
    ];
    expect(texts.filter(x => !(x in EN_DATA))).toEqual([]);
  });

  it('nomi delle bande, ora e squadre in inglese', () => {
    for (const id of ['0', '1', '2', '3', '50', '777', '4000']) {
      expect(EN_DATA[gangName(id)], gangName(id)).toBeTruthy();
      expect(render(gangNameMsg(id), 'en')).not.toMatch(/^(i|gli|la) /);
    }
    expect(t('la crew di Ma Byrne', undefined, 'en')).toBe("Ma Byrne's crew");
    expect(t('i Moreno', undefined, 'en')).toBe('the Morenos');
    expect(t('i Cruz', undefined, 'en')).toBe('the Cruzes');
    expect(clock(2 * 86400 + 14 * 3600 + 5 * 60)).toBe('Giorno 3, 14:05');
    expect(clock(2 * 86400 + 14 * 3600 + 5 * 60, 'en')).toBe('Day 3, 14:05');
    expect(duration(2 * 3600 + 5 * 60, 'en')).toBe('2h 5m');
    expect(squadText({ picchiatori: 3, soldati: 1 })).toBe('3 picchiatori, 1 soldati');
    expect(squadText({ picchiatori: 3, soldati: 1 }, 'en')).toBe('3 thugs, 1 soldier');
    expect(squadText({}, 'en')).not.toBe('nessuno');
  });
});
