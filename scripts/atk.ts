// Simulazione di bilanciamento: un bot gioca da solo per 21 giorni.
// Uso: npx tsx scripts/sim.ts [bilanciata|sporco|espansione] [seme]
import { CITIES_BY_STATE } from '../src/engine/world';
import {
  act, buildOptions, canAfford, cityLimit, def, efficiency, fortDefense, freeLots, missingReq, newGame, owned, peekCity, power,
  rates, researchCost, tick, upgradeCost, type CityState, type GameState,
} from '../src/engine/engine';
import { RESEARCH } from '../src/engine/data';

const strategy = process.argv[2] ?? 'bilanciata';
const s = newGame(Number(process.argv[3] ?? 7));
const H = 3600;

function buildIn(s: GameState, c: CityState) {
  if (c.buildQueue) return;
  const r = rates(s);
  const opts: { a: Parameters<typeof act>[1]; score: number }[] = [];
  c.lots.forEach((l, lot) => {
    if (!l) return;
    const k = upgradeCost(l.kind, l.id, l.level + 1); if (!canAfford(s, k, c)) return;
    let w = l.kind === 'racket' ? (strategy === 'sporco' ? 2 : 1) : l.kind === 'front' ? (strategy === 'sporco' ? 0 : r.launderCap < r.dirty ? 3 : 0.7) : l.id === 'qg' ? 1.2 : l.id === 'cassaforte' && s.res.sporco > 50000 ? 1.5 : 0.5;
    opts.push({ a: { t: 'upgrade', city: c.id, lot }, score: w / Math.max(1, (k.sporco ?? 0) + (k.pulito ?? 0)) });
  });
  const free = freeLots(c);
  if (free.length) for (const o of buildOptions(s, c)) {
    if (o.blocked || !canAfford(s, o.cost, c)) continue;
    if (strategy === 'sporco' && o.kind === 'front') continue;
    if (o.kind === 'building' && o.id !== 'armeria') continue;
    if (o.kind === 'front' && c.lots.some(l => l?.id === o.id)) continue;
    const w = o.kind === 'racket' ? 1.6 : o.kind === 'front' ? (r.launderCap < r.dirty ? 2.5 : 0.8) : (c.lots.some(l => l?.id === 'armeria') ? 0 : strategy === 'espansione' ? 50 : 1.2);
    opts.push({ a: { t: 'build', city: c.id, lot: free[0], kind: o.kind, id: o.id }, score: w / Math.max(1, (o.cost.sporco ?? 0) + (o.cost.pulito ?? 0)) });
  }
  opts.sort((a, b) => b.score - a.score);
  if (opts[0]) act(s, opts[0].a);
  if (c.heat > 40 && c.payroll < 5) act(s, { t: 'payroll', city: c.id, level: c.payroll + 1 });
}

function bot(s: GameState) {
  for (const c of owned(s)) buildIn(s, c);
  if (!s.researchQueue) {
    const order = strategy === 'espansione' ? ['gestione', ...RESEARCH.map(r => r.id)] : RESEARCH.map(r => r.id);
    for (const id of order as any[]) { const d = RESEARCH.find(r => r.id === id)!; if (missingReq(s, null, d.req).length) continue; const k = researchCost(d.id, s.research[d.id] + 1); if (canAfford(s, k) && (k.sporco ?? 0) < s.res.sporco * 0.3) { act(s, { t: 'research', id: d.id }); break; } }
  }
  const home = s.cities[s.capital];
  if (home.unitQueue.length === 0) {
    const want = home.lots.some(l => l?.id === 'armeria') ? 'soldati' : 'picchiatori';
    const myDef = power(s, home.units, 'def'), threat = power(null, home.gang.units, 'att') * 0.7;
    const expand = strategy === 'espansione' && owned(s).length <= cityLimit(s) && want === 'soldati' && s.res.sporco > 30000 && s.time > 2 * 86400;
    if ((myDef < threat || expand) && s.res.sporco > 3000) act(s, { t: 'recruit', city: home.id, id: want, n: Math.max(1, Math.floor(s.res.sporco * (expand ? 0.4 : 0.5) / (want === 'soldati' ? 2000 : 500))) });
  }
  if (strategy === 'espansione' && s.missions.length === 0) {
    const me = def(s.capital);
    const t = CITIES_BY_STATE[me.stateIdx].map(String).filter(id => s.cities[id]?.owner !== 'player').map(id => peekCity(s, id))
      .sort((a, b) => fortDefense(a) + Math.hypot(def(a.id).x - me.x, def(a.id).y - me.y) * 5 - (fortDefense(b) + Math.hypot(def(b.id).x - me.x, def(b.id).y - me.y) * 5))[0];
    const att = power(s, { soldati: home.units.soldati }, 'att');
    if (t && att > fortDefense(t) * 1.4 && owned(s).length <= cityLimit(s)) act(s, { t: 'mission', kind: 'assault', from: home.id, to: t.id, units: { soldati: home.units.soldati } });
  }
}

let last = 0; let seenId = 0; const atk: any[] = [];
function track() { for (const r of [...s.reports].reverse()) if (r.id > seenId) { seenId = r.id; if (r.kind==='defense'||r.kind==='sabotage') atk.push({d:+(r.t/86400).toFixed(1), win:r.win, a:r.att, def:r.def, loot:Math.round(r.loot), lm:r.lostMine}); } }
for (let t = 0; t < 21 * 24 * H; t += 600) {
  if (!process.env.PASSIVE) bot(s); tick(s, 600); track();
  if (s.time - last >= 24 * H) {
    last = s.time; const r = rates(s); const d = Math.round(s.time / 86400);
    if ([3, 5, 7, 10, 14, 21].includes(d)) console.log(`G${d} città ${owned(s).length}/${cityLimit(s)} eff ${efficiency(s).toFixed(2)} | sporco ${Math.round(s.res.sporco)} pulito ${Math.round(s.res.pulito)} | sporco/h ${Math.round(r.dirty)} pulito/h ${Math.round(r.clean + r.laundering * (1 - r.launderFee))} | lotti ${owned(s).map(c => `${c.lots.filter(Boolean).length}/${c.lots.length}`).join(' ')} | calore ${owned(s).map(c => Math.round(c.heat)).join('/')} | infl ${owned(s).map(c => Math.round(c.influence)).join('/')}`);
  }
}
console.log(JSON.stringify(s.stats));
for (const d of [1,3,5,7,10,14,21]) { const a = atk.filter(x=>x.d<=d && x.d>d-(d<=3?d:d<=7?2:d<=14?4:7)); }
const byDay: Record<number, any[]> = {}; for (const x of atk) (byDay[Math.floor(x.d)] ??= []).push(x);
for (const [d, xs] of Object.entries(byDay)) console.log(`giorno ${d}: ${xs.length} attacchi, persi ${xs.filter(x=>!x.win).length}, att medio ${Math.round(xs.reduce((a,x)=>a+x.a,0)/xs.length)} vs dif ${Math.round(xs.reduce((a,x)=>a+x.def,0)/xs.length)}, bottino ${xs.reduce((a,x)=>a+x.loot,0)}, uomini persi ${xs.reduce((a,x)=>a+x.lm,0)}`);
