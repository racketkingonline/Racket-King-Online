// Analisi del playtest multiplayer (scripts/mp.ts).
import { readFileSync, writeFileSync } from 'node:fs';
const DIR = process.argv[2] ?? '/home/claude/playtest/mp';
const W = JSON.parse(readFileSync(`${DIR}/world.json`, 'utf8'));
const P = readFileSync(`${DIR}/players.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.daily.length);
const DAYS = W.daily.length;
const med = (a: number[]) => { const b = a.filter(x => x !== undefined && !isNaN(x)).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const q = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; };
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const pct = (a: any[], f: (x: any) => boolean) => a.length ? a.filter(f).length / a.length : NaN;
const dayRow = (r: any, d: number) => { let best = null; for (const x of r.daily) { if (x[0] <= d) best = x; else break; } return best; };
const gini = (v: number[]) => { const b = [...v].sort((x, y) => x - y); const n = b.length; const s = b.reduce((a, x) => a + x, 0); let c = 0; b.forEach((x, i) => c += (2 * (i + 1) - n - 1) * x); return s ? c / (n * s) : 0; };
const out: any = { players: P.length, days: DAYS, region: W.region };

// --- mondo nel tempo
const CK = [1, 3, 7, 14, 21, 30, 45, 60, 90, 120, 150, 180, 240, 300, 365].filter(d => d <= DAYS);
out.mondo = CK.map(d => {
  const w = W.daily[d - 1]; const rows = P.map(r => dayRow(r, d)).filter(Boolean) as number[][];
  const cities = rows.map(x => x[5]); const scores = rows.map(x => x[11]);
  const sorted = [...cities].sort((a, b) => b - a); const tot = cities.reduce((a, b) => a + b, 0);
  const prev = d > 7 ? W.daily[d - 8] : { pvpSubiti: 0, pvpPersi: 0, cittaPerse: 0 };
  return {
    d, attivi: w.attivi, vassalliPct: w.vassalli / w.attivi, cittaGiocatori: w.cittaGiocatori,
    top10quota: sorted.slice(0, 10).reduce((a, b) => a + b, 0) / Math.max(1, tot), maxCitta: sorted[0], mediaCitta: mean(cities),
    giniCitta: gini(cities), giniScore: gini(scores),
    pvpSubiti7: (w.pvpSubiti - prev.pvpSubiti) / w.attivi, cittaPerse7: w.cittaPerse - prev.cittaPerse,
    sporcoH: med(rows.map(x => x[3])), pulitoStock: med(rows.map(x => x[2])), score: med(scores), score90: q(scores, 0.9), score10: q(scores, 0.1),
    heat: med(rows.map(x => x[8])), idle7: mean(P.map(r => { const a = dayRow(r, d), b = dayRow(r, d - 7); if (!a) return NaN; const ch = a[18] - (b?.[18] ?? 0); return ch > 0 ? (a[17] - (b?.[17] ?? 0)) / ch : NaN; }).filter(x => !isNaN(x))),
    lotti: mean(rows.map(x => x[6] / Math.max(1, x[7]))), att: med(rows.map(x => x[25])), def: med(rows.map(x => x[10])),
  };
});

// --- la prima settimana di un giocatore: quanto spesso la perde
function firstLoss(r: any) { const h = r.history.find((x: any) => x.what === 'perde'); const j = r.p.joinDay + 1; return h ? h.day - j : null; }
const groups: Record<string, (r: any) => string> = {
  assiduita: r => r.p.assiduita, testa: r => r.p.testa, ritmo: r => r.p.ritmo, costanza: r => r.p.discontinuo ? 'discontinuo' : 'costante',
  ingresso: r => r.p.joinDay < 3 ? 'giorni 1-3' : r.p.joinDay < 30 ? 'giorni 4-30' : 'giorni 31-120', tutti: () => 'tutti',
};
out.gruppi = Object.fromEntries(Object.entries(groups).map(([gk, f]) => {
  const g: Record<string, any[]> = {}; for (const r of P) (g[f(r)] ??= []).push(r);
  return [gk, Object.fromEntries(Object.entries(g).map(([k, rs]) => {
    const last = rs.map(r => r.daily.at(-1));
    return [k, {
      n: rs.length,
      persaEntro7: pct(rs, r => { const x = firstLoss(r); return x !== null && x <= 7; }), persaEntro30: pct(rs, r => { const x = firstLoss(r); return x !== null && x <= 30; }),
      maiPersa: pct(rs, r => firstLoss(r) === null), vassalloFine: pct(rs, r => r.lord !== null), cittaFine: mean(last.map((x: number[]) => x[5])),
      conVassalli: pct(rs, r => r.vassals.length > 0), vassalliMedi: mean(rs.map(r => r.vassals.length)),
      cittaPerse: mean(rs.map(r => r.ev.cittaPerse)), conquistePvp: mean(rs.map(r => r.ev.conquistePvp)), conquisteNpc: mean(rs.map(r => r.ev.conquisteNpc)),
      pvpSubiti: mean(rs.map(r => r.ev.pvpSubiti)), pvpPersi: mean(rs.map(r => r.ev.pvpPersi)), pvpFatti: mean(rs.map(r => r.ev.pvpFatti)), pvpVintiPct: mean(rs.filter(r => r.ev.pvpFatti).map(r => r.ev.pvpVinti / r.ev.pvpFatti)),
      bottinoPerso: med(rs.map(r => r.ev.pvpBottinoPerso)), bottinoPreso: med(rs.map(r => r.ev.pvpBottinoPreso)), tributoPagato: med(rs.map(r => r.ev.tributoPagato)), tributoRicevuto: mean(rs.map(r => r.ev.tributoRicevuto)),
      score: med(last.map((x: number[]) => x[11])), sporcoH: med(last.map((x: number[]) => x[3])),
      npcAttacchiPersi: mean(rs.map(r => r.ev.attLost / Math.max(1, r.ev.attRecv))), retate: mean(rs.map(r => r.ev.retate)), indagini: mean(rs.map(r => r.ev.indagini)), controlli: mean(rs.map(r => r.ev.controlli)),
      diserzioni: mean(rs.map(r => r.ev.diserzioni)), conDiserzioni: pct(rs, r => r.ev.diserzioni > 0), sindaco: pct(rs, r => r.ev.sindaco > 0), scandali: mean(rs.map(r => r.ev.scandali)),
      idle: mean(rs.map(r => r.ev.idleChecks / Math.max(1, r.ev.checks))), oreOnline: mean(rs.map(r => r.ev.onlineMin / 60)), avvisiOffline: mean(rs.map(r => r.ev.warnOffline / Math.max(1, r.ev.avvisi))),
      spieKo: mean(rs.map(r => r.ev.spieKo)), assaltiKo: mean(rs.map(r => r.ev.assaltiKo)), assaltiCieco: mean(rs.map(r => r.ev.assaltiCieco)), blocked: mean(rs.map(r => r.ev.expandBlocked)), conflitti: mean(rs.map(r => r.ev.conflitti)),
    }];
  }))];
}));

// --- città che passano di mano per mese, conquiste NPC vs PvP
const ev = P.flatMap(r => r.history.map((h: any) => ({ ...h, p: r.p.id })));
const months = Math.ceil(DAYS / 30);
out.perMese = Array.from({ length: months }, (_, m) => ({
  mese: m + 1, conquisteNpc: ev.filter(e => e.what === 'conquista' && e.day > m * 30 && e.day <= (m + 1) * 30).length,
  conquistePvp: ev.filter(e => e.what === 'conquistaPvp' && e.day > m * 30 && e.day <= (m + 1) * 30).length,
  nuoviVassalli: ev.filter(e => e.what === 'vassallo' && e.day > m * 30 && e.day <= (m + 1) * 30).length,
}));
out.ultimaConquistaNpc = Math.max(0, ...ev.filter(e => e.what === 'conquista').map(e => e.day));
out.vassallaggiRipetuti = (() => { const c: Record<number, number> = {}; for (const e of ev) if (e.what === 'vassallo') c[e.p] = (c[e.p] ?? 0) + 1; const v = Object.values(c); return { almenoUnaVolta: v.length, piuDiUna: v.filter(x => x > 1).length, max: Math.max(0, ...v) }; })();
// --- i primi 10 alla fine: chi sono
const fin = P.map(r => ({ id: r.p.id, prof: `${r.p.assiduita}/${r.p.ritmo}/${r.p.testa}${r.p.discontinuo ? '/disc' : ''}`, join: r.p.joinDay, citta: r.daily.at(-1)[5], vassalli: r.vassals.length, score: r.daily.at(-1)[11], lord: r.lord })).sort((a, b) => b.citta - a.citta || b.score - a.score);
out.top10 = fin.slice(0, 10);
// gerarchie: dimensione delle "famiglie" (capo + vassalli diretti)
const fam = P.filter(r => r.lord === null && r.vassals.length).map(r => r.vassals.length).sort((a, b) => b - a);
out.famiglie = { capi: fam.length, top5: fam.slice(0, 5), indipendentiSenzaVassalli: P.filter(r => r.lord === null && !r.vassals.length).length, vassalli: P.filter(r => r.lord !== null).length };
// chi ha preso le città di chi: la preda tipica
const prey = ev.filter(e => e.what === 'perde').map(e => { const v = P.find(r => r.p.id === e.p); const a = P.find(r => r.p.id === e.other); const vr = dayRow(v, e.day - 1); const ar = dayRow(a, e.day - 1); return { gapScore: ar && vr ? ar[11] / Math.max(1, vr[11]) : NaN, etaVittima: e.day - v.p.joinDay - 1, assVittima: v.p.assiduita, testaVittima: v.p.testa }; });
out.prede = { n: prey.length, rapportoScoreMediano: med(prey.map(x => x.gapScore)), etaVittimaMediana: med(prey.map(x => x.etaVittima)), vittimeEntro3giorni: pct(prey, x => x.etaVittima <= 3),
  perAssiduita: Object.fromEntries(['hardcore', 'regolare', 'casual', 'sporadico'].map(k => [k, prey.filter(x => x.assVittima === k).length])) };

console.log(JSON.stringify(out, null, 1));
writeFileSync(`${DIR}/summary.json`, JSON.stringify(out, null, 1));
const head = ['id', 'assiduita', 'ritmo', 'testa', 'discontinuo', 'giorno_ingresso', 'citta_finali', 'vassallo_di', 'vassalli', 'score', 'sporco_h', 'citta_perse', 'conquiste_pvp', 'conquiste_npc', 'attacchi_pvp_subiti', 'attacchi_pvp_persi', 'bottino_perso', 'bottino_preso', 'tributo_pagato', 'tributo_ricevuto', 'retate', 'indagini', 'controlli', 'ore_online'];
writeFileSync(`${DIR}/giocatori.csv`, [head.join(','), ...P.map(r => { const l = r.daily.at(-1); return [r.p.id, r.p.assiduita, r.p.ritmo, r.p.testa, r.p.discontinuo ? 1 : 0, r.p.joinDay + 1, l[5], r.lord ?? '', r.vassals.length, l[11], l[3], r.ev.cittaPerse, r.ev.conquistePvp, r.ev.conquisteNpc, r.ev.pvpSubiti, r.ev.pvpPersi, Math.round(r.ev.pvpBottinoPerso), Math.round(r.ev.pvpBottinoPreso), Math.round(r.ev.tributoPagato), Math.round(r.ev.tributoRicevuto), r.ev.retate, r.ev.indagini, r.ev.controlli, Math.round(r.ev.onlineMin / 60)].join(','); })].join('\n'));
writeFileSync(`${DIR}/mondo.csv`, ['giorno,' + Object.keys(W.daily[0]).slice(1).join(','), ...W.daily.map((w: any) => Object.values(w).join(','))].join('\n'));
