// Confronto tra versioni del playtest multiplayer allo stesso giorno.
// Uso: npx tsx scripts/compare.ts <giorno> <cartella>...   (ogni cartella: world.json + players.jsonl)
import { readFileSync } from 'node:fs';
const DAY = Number(process.argv[2]); const dirs = process.argv.slice(3);
const med = (a: number[]) => { const b = a.filter(x => !isNaN(x)).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const rows: any[] = [];
for (const dir of dirs) {
  const W = JSON.parse(readFileSync(`${dir}/world.json`, 'utf8')).daily;
  const P = readFileSync(`${dir}/players.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.daily.length);
  const w = W[Math.min(DAY, W.length) - 1];
  const at = (r: any) => { let b = null; for (const x of r.daily) { if (x[0] <= DAY) b = x; else break; } return b; };
  const rs = P.map(at).filter(Boolean) as number[][];
  const loss = (r: any) => r.history.find((h: any) => (h.what === 'perde' || h.what === 'sottomesso') && h.day <= DAY);
  const late = P.filter(r => r.p.joinDay >= 30 && r.p.joinDay + 7 <= DAY);
  const lateLost7 = late.filter(r => { const h = loss(r); return h && h.day - (r.p.joinDay + 1) <= 7; }).length / Math.max(1, late.length);
  const early = P.filter(r => r.p.joinDay < 3);
  const lost30 = early.filter(r => { const h = loss(r); return h && h.day <= 30; }).length / Math.max(1, early.length);
  const npc = w.conquisteNpc ?? P.reduce((a, r) => a + r.history.filter((h: any) => h.what === 'conquista' && h.day <= DAY).length, 0);
  rows.push({
    run: dir.split('/').slice(-2).join('/'), giorno: Math.min(DAY, W.length),
    vassalliPct: +(100 * w.vassalli / w.attivi).toFixed(1), cittaPerse: w.cittaPerse, cittaDeiGiocatori: w.cittaGiocatori, conquisteNpc: npc,
    perseEntro30_iniziali: +(100 * lost30).toFixed(1), perseEntro7_ritardatari: +(100 * lateLost7).toFixed(1), ritardatari: late.length,
    redditoMediano: med(rs.map(x => x[3])), esercitoMediano: med(rs.map(x => x[25])), pulitoMediano: med(rs.map(x => x[2])),
    indipendenze: w.indipendenze ?? 0, riscatti: w.riscatti ?? 0,
    ...(() => {
      // famiglie al giorno DAY, ricostruite dalla storia
      const lordOf = new Map<number, number>(); const durs: number[] = []; const open = new Map<number, number>();
      for (const r of P) for (const h of r.history) { if (h.day > DAY) continue;
        if (h.what === 'vassallo') { lordOf.set(r.p.id, h.other); if (!open.has(r.p.id)) open.set(r.p.id, h.day); }
        if (String(h.what).startsWith('libero')) { lordOf.delete(r.p.id); const st = open.get(r.p.id); if (st !== undefined) { durs.push(h.day - st); open.delete(r.p.id); } } }
      const size = new Map<number, number>(); for (const l of lordOf.values()) size.set(l, (size.get(l) ?? 0) + 1);
      const fams = [...size.values()];
      return { famiglieDa2: fams.filter(x => x >= 2).length, famigliaMax: Math.max(0, ...fams), durataVassallaggioMediana: med(durs) };
    })(),
    bonusInvestimentiMediano: med(rs.map(x => x[26] ?? 0)),
    // questi sono cumulati a fine partita (non al giorno richiesto)
    fineRun: W.length, conDiserzioniPct: +(100 * P.filter(r => r.ev.diserzioni > 0).length / P.length).toFixed(1),
    controlliAlGiorno: +(P.reduce((a, r) => a + r.ev.controlli, 0) / P.length / W.length).toFixed(2), retateAnno: +(P.reduce((a, r) => a + r.ev.retate, 0) / P.length * 365 / W.length).toFixed(1),
  });
}
console.table(rows);
console.log(JSON.stringify(rows));
