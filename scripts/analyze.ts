// Analisi del playtest simulato: legge i JSONL di scripts/server.ts e stampa aggregati + scrive CSV.
import { readFileSync, writeFileSync } from 'node:fs';
import { def } from '../src/engine/engine';

const files = process.argv.slice(2);
const P = files.flatMap(f => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)));
const N = P.length; const DAYS = P[0].daily.length;
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
const q = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; };
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const at = (r: any, day: number) => r.daily[Math.min(DAYS, day) - 1];
const out: any = { N, DAYS };

// --- profili
const cnt = (k: string) => Object.entries(P.reduce((m: any, r) => (m[r.p[k]] = (m[r.p[k]] ?? 0) + 1, m), {}));
out.profili = { assiduita: cnt('assiduita'), ritmo: cnt('ritmo'), testa: cnt('testa'), discontinuo: P.filter(r => r.p.discontinuo).length };

// --- serie nel tempo (mediane e quantili su tutti)
const checkpoints = [1, 3, 7, 14, 21, 30, 45, 60, 90, 120, 150, 180, 240, 300, 365].filter(d => d <= DAYS);
out.tempo = checkpoints.map(d => {
  const rows = P.map(r => at(r, d)); const prev = P.map(r => at(r, Math.max(1, d - 7)));
  return {
    d, dirtyH: med(rows.map(x => x[3])), cleanH: med(rows.map(x => x[4])), pulito: med(rows.map(x => x[2])), sporco: med(rows.map(x => x[1])),
    score_p10: q(rows.map(x => x[11]), 0.1), score_p50: med(rows.map(x => x[11])), score_p90: q(rows.map(x => x[11]), 0.9),
    lotti: mean(rows.map(x => x[6] / Math.max(1, x[7]))), citta: mean(rows.map(x => x[5])), multi: rows.filter(x => x[5] >= 2).length / N,
    heat: med(rows.map(x => x[8])), mayor: rows.filter(x => x[13]).length / N,
    idle7: mean(P.map((r, i) => { const a = at(r, d), b = d > 7 ? at(r, d - 7) : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; const ch = a[18] - b[18]; return ch > 0 ? (a[17] - b[17]) / ch : NaN; }).filter(x => !isNaN(x))),
    attLost7: mean(P.map((r) => at(r, d)[14] - (d > 7 ? at(r, d - 7)[14] : 0))), polizia7: mean(P.map((r) => at(r, d)[15] - (d > 7 ? at(r, d - 7)[15] : 0))),
    levels: med(rows.map(x => x[19])),
  };
});

// --- per gruppo
function group(key: string, pick: (r: any) => string) {
  const g: Record<string, any[]> = {}; for (const r of P) (g[pick(r)] ??= []).push(r);
  return Object.fromEntries(Object.entries(g).map(([k, rs]) => [k, {
    n: rs.length, score30: med(rs.map(r => at(r, 30)[11])), score365: med(rs.map(r => at(r, DAYS)[11])),
    citta: mean(rs.map(r => at(r, DAYS)[5])), multi: rs.filter(r => at(r, DAYS)[5] >= 2).length / rs.length,
    primaConquista: med(rs.filter(r => r.conquered.length).map(r => r.conquered[0].day)), conquistatori: rs.filter(r => r.conquered.length).length / rs.length,
    attRecv: mean(rs.map(r => r.ev.attRecv)), attLostPct: mean(rs.map(r => r.ev.attLost / Math.max(1, r.ev.attRecv))),
    retate: mean(rs.map(r => r.ev.retate)), indagini: mean(rs.map(r => r.ev.indagini)), controlli: mean(rs.map(r => r.ev.controlli)), sequestri: med(rs.map(r => r.ev.lootLost)),
    diserzioni: mean(rs.map(r => r.ev.diserzioni)), conDiserzioni: rs.filter(r => r.ev.diserzioni > 0).length / rs.length,
    idle: mean(rs.map(r => r.ev.idleChecks / Math.max(1, r.ev.checks))), onlineH: mean(rs.map(r => r.ev.onlineMin / 60)),
    sindaco: rs.filter(r => r.ev.sindaco > 0).length / rs.length, scandali: mean(rs.map(r => r.ev.scandali ?? 0)),
    warnOffline: mean(rs.map(r => r.ev.warnOffline / Math.max(1, r.ev.avvisi))), assaltiKo: mean(rs.map(r => r.ev.assaltiKo)), assaltiCieco: mean(rs.map(r => r.ev.assaltiCieco)), assaltiOk: mean(rs.map(r => r.ev.assaltiOk)),
    spieKo: mean(rs.map(r => r.ev.spieKo)), acquisti: mean(rs.map(r => r.ev.acquisti)), blocked: mean(rs.map(r => r.ev.expandBlocked)), noArmory: mean(rs.map(r => r.ev.expandNoArmory)),
    pulito365: med(rs.map(r => at(r, DAYS)[2])), queueIdle: mean(rs.map(r => r.queueIdle)),
  }]));
}
out.assiduita = group('assiduita', r => r.p.assiduita);
out.testa = group('testa', r => r.p.testa);
out.ritmo = group('ritmo', r => r.p.ritmo);
out.discontinuo = group('disc', r => r.p.discontinuo ? 'discontinuo' : 'costante');
out.tutti = group('tutti', () => 'tutti').tutti;

// --- conquiste nel tempo
const conq = P.flatMap(r => r.conquered.map((c: any) => ({ p: r.p.id, ...c })));
out.conquisteTot = conq.length;
out.conquistePerMese = Array.from({ length: Math.ceil(DAYS / 30) }, (_, m) => conq.filter(c => c.day > m * 30 && c.day <= (m + 1) * 30).length);
out.ultimaConquista = conq.length ? Math.max(...conq.map(c => c.day)) : null;
out.conquisteDopo60 = conq.filter(c => c.day > 60).length;

// --- incontri stimati: città contese e vicinanza tra territori
const byCity: Record<string, number[]> = {}; for (const r of P) for (const id of [r.start, ...r.conquered.map((c: any) => c.id)]) (byCity[id] ??= []).push(r.p.id);
out.cittaContese = Object.values(byCity).filter(v => v.length > 1).length;
const terr = P.map(r => [r.start, ...r.conquered.map((c: any) => c.id)].map(id => def(id)));
const sameState: Record<string, number> = {}; for (const r of P) sameState[r.state] = (sameState[r.state] ?? 0) + 1;
out.giocatoriPerStato = { stati: Object.keys(sameState).length, max: Math.max(...Object.values(sameState)), med: med(Object.values(sameState)), soli: Object.values(sameState).filter(v => v === 1).length };
const nn = terr.map((t, i) => Math.min(...terr.map((u, j) => i === j ? Infinity : Math.min(...t.flatMap(a => u.map(b => Math.hypot(a.x - b.x, a.y - b.y)))))));
out.vicinoPiuVicino = { p10: q(nn, 0.1), med: med(nn), p90: q(nn, 0.9) };
const raid = P.map(r => r.conquered.length ? Math.max(...r.conquered.map((c: any) => Math.hypot(def(c.id).x - def(r.start).x, def(c.id).y - def(r.start).y))) : 0).filter(x => x > 0);
out.raggioEspansione = { med: med(raid), max: raid.length ? Math.max(...raid) : 0 };
out.contattiEntroRaggio = nn.filter(d => d <= (out.raggioEspansione.med || 0) * 2).length;

// --- disuguaglianza
const s365 = P.map(r => at(r, DAYS)[11]);
out.giniScore = (() => { const b = [...s365].sort((x, y) => x - y); const n = b.length; let c = 0; b.forEach((x, i) => c += (2 * (i + 1) - n - 1) * x); return c / (n * b.reduce((a, x) => a + x, 0)); })();

console.log(JSON.stringify(out, null, 1));
writeFileSync('/home/claude/playtest/summary.json', JSON.stringify(out, null, 1));
// CSV per giocatore
const head = ['id', 'assiduita', 'ritmo', 'testa', 'discontinuo', 'stato', 'citta_finali', 'score_365', 'sporco_h', 'pulito_h', 'pulito_stock', 'prima_conquista', 'attacchi_ricevuti', 'attacchi_persi', 'retate', 'indagini', 'controlli', 'sequestrato', 'diserzioni', 'sindaco', 'ore_online', 'check_a_vuoto_pct'];
writeFileSync('/home/claude/playtest/giocatori.csv', [head.join(','), ...P.map(r => { const l = at(r, DAYS); return [r.p.id, r.p.assiduita, r.p.ritmo, r.p.testa, r.p.discontinuo ? 1 : 0, r.state, l[5], l[11], l[3], l[4], l[2], r.conquered[0]?.day ?? '', r.ev.attRecv, r.ev.attLost, r.ev.retate, r.ev.indagini, r.ev.controlli, Math.round(r.ev.lootLost), r.ev.diserzioni, r.ev.sindaco > 0 ? 1 : 0, Math.round(r.ev.onlineMin / 60), Math.round(100 * r.ev.idleChecks / Math.max(1, r.ev.checks))].join(','); })].join('\n'));
// CSV serie
writeFileSync('/home/claude/playtest/serie.csv', ['giorno,' + Object.keys(out.tempo[0]).slice(1).join(','), ...out.tempo.map((t: any) => Object.values(t).map((v: any) => typeof v === 'number' ? +v.toFixed(3) : v).join(','))].join('\n'));
