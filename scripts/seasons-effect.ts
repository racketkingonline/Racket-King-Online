// Effetto delle stagioni in un playtest multiplayer: confronta i 21 giorni dell'evento con i 21 giorni prima.
import { readFileSync } from 'node:fs';
const W = JSON.parse(readFileSync(`${process.argv[2]}/world.json`, 'utf8')).daily;
const P = readFileSync(`${process.argv[2]}/players.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const at = (d: number) => W[d - 1];
const perDay = (k: string, a: number, b: number) => (at(b)[k] - at(a)[k]) / (b - a);
const avg = (k: string, a: number, b: number) => { let s = 0; for (let d = a + 1; d <= b; d++) s += at(d)[k]; return s / (b - a); };
const out: any = {};
for (const [id, day] of [['proibizionismo', 90], ['cartelli', 180], ['giroDiVite', 270]] as [string, number][]) {
  const pre = [day - 21, day], dur = [day, day + 21], post = [day + 21, day + 42];
  out[id] = {
    sporcoTot_pre: Math.round(avg('sporcoTot', pre[0], pre[1])), sporcoTot_dur: Math.round(avg('sporcoTot', dur[0], dur[1])), sporcoTot_post: Math.round(avg('sporcoTot', post[0], post[1])),
    retateGiorno_pre: +perDay('retate', pre[0], pre[1]).toFixed(1), retateGiorno_dur: +perDay('retate', dur[0], dur[1]).toFixed(1),
    npcGiorno_pre: +perDay('conquisteNpc', pre[0], pre[1]).toFixed(2), npcGiorno_dur: +perDay('conquisteNpc', dur[0], dur[1]).toFixed(2), npcGiorno_post: +perDay('conquisteNpc', post[0], post[1]).toFixed(2),
    riscattiGiorno_pre: +perDay('riscatti', pre[0], pre[1]).toFixed(1), riscattiGiorno_dur: +perDay('riscatti', dur[0], dur[1]).toFixed(1),
    cittaPerseGiorno_pre: +perDay('cittaPerse', pre[0], pre[1]).toFixed(1), cittaPerseGiorno_dur: +perDay('cittaPerse', dur[0], dur[1]).toFixed(1),
    retateTopGiorno_pre: +perDay('retateTop', pre[0], pre[1]).toFixed(2), retateTopGiorno_dur: +perDay('retateTop', dur[0], dur[1]).toFixed(2),
    vassalli_dur_fine: at(day + 21).vassalli, cittaGiocatori_pre: at(day).cittaGiocatori, cittaGiocatori_post: at(day + 21).cittaGiocatori,
  };
}
// giro di vite: i primi 10% restano in cima?
const top = P.filter(r => r.ev.giroDiVite);
const rank = (d: number) => { const s = P.filter(r => r.daily.some((x: number[]) => x[0] === d)).map(r => ({ id: r.p.id, sc: r.daily.find((x: number[]) => x[0] === d)[11] })).sort((a, b) => b.sc - a.sc); return new Map(s.map((x, i) => [x.id, i + 1])); };
const r0 = rank(270), r1 = rank(Math.min(W.length, 330));
out.giroDiVite.topRestanoTop30_dopo60g = top.filter(r => (r1.get(r.p.id) ?? 999) <= 30).length + ' su ' + top.length;
out.giroDiVite.rangoMedianoTop_prima = (() => { const v = top.map(r => r0.get(r.p.id) ?? 999).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; })();
out.giroDiVite.rangoMedianoTop_dopo60g = (() => { const v = top.map(r => r1.get(r.p.id) ?? 999).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; })();
out.vacanze = { giocatoriCheLaUsano: P.filter(r => r.ev.vacanze > 0).length, giorniMedi: +(P.reduce((a, r) => a + r.ev.giorniVacanza, 0) / Math.max(1, P.filter(r => r.ev.vacanze > 0).length)).toFixed(1) };
out.postura = { recluteMedie: +(P.reduce((a, r) => a + r.ev.posturaReclute, 0) / P.length).toFixed(1) };
out.vassallaggio = { indipendenze: P.reduce((a, r) => a + r.ev.indipendenze, 0), riscatti: P.reduce((a, r) => a + r.ev.riscatti, 0), sottomissioni: P.reduce((a, r) => a + (r.ev.sottomissioni ?? 0), 0), maiVassalli: P.filter(r => !r.ev.vassallo).length };
console.log(JSON.stringify(out, null, 1));
