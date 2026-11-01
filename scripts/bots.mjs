// Carico di prova: N giocatori finti si registrano, si collegano via WebSocket e giocano in modo semplice.
// Uso: node scripts/bots.mjs <url> <n> <secondi>
import WebSocket from 'ws';
const [URL = 'http://localhost:8090', N = '30', SECS = '120'] = process.argv.slice(2);
const stats = { states: 0, bytes: 0, ok: 0, ko: 0, attacks: 0, errors: {}, defense: 0, vassals: 0 };
async function reg(i) {
  const r = await fetch(URL + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `bot${i}@test.it`, password: 'segreto123', name: `Bot ${i}` }) });
  let ck = r.headers.get('set-cookie');
  if (!r.ok) { const l = await fetch(URL + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `bot${i}@test.it`, password: 'segreto123' }) }); ck = l.headers.get('set-cookie'); }
  return ck.split(';')[0];
}
function bot(i, cookie) {
  const ws = new WebSocket(URL.replace('http', 'ws') + '/ws', { headers: { cookie } });
  let s = null, me = null, world = null, id = 1, busy = false; const seenRep = new Set();
  const act = a => { busy = true; ws.send(JSON.stringify({ type: 'act', id: id++, action: a })); };
  ws.on('message', d => {
    const m = JSON.parse(d.toString()); stats.bytes += d.length;
    if (m.type === 'state') { s = m.state; me = m.me; stats.states++; if (s.reports) for (const r of s.reports) if ((r.kind === 'defense' || r.kind === 'sabotage') && !seenRep.has(r.id)) { seenRep.add(r.id); stats.defense++; } }
    else if (m.type === 'world') world = m;
    else if (m.type === 'result') { busy = false; if (m.ok) stats.ok++; else { stats.ko++; stats.errors[m.msg] = (stats.errors[m.msg] ?? 0) + 1; } }
  });
  const think = () => {
    if (!s || busy || ws.readyState !== 1) return;
    const cap = s.cities[s.capital]; if (!cap) return;
    if (!s.introSeen) return act({ t: 'introSeen' });
    const free = cap.lots.findIndex(l => !l);
    const opts = [['racket', 'bische'], ['front', 'bar'], ['front', 'lavanderia']].filter(([k, x]) => !cap.lots.some(l => l && l.kind === k && l.id === x));
    const pick = opts[Math.floor(Math.random() * opts.length)];
    if (!cap.buildQueue && free >= 0 && pick && s.res.sporco > 4000) return act({ t: 'build', city: cap.id, lot: free, kind: pick[0], id: pick[1] });
    const qg = cap.lots.findIndex(l => l && l.id === 'qg');
    if (!cap.buildQueue && !pick && qg >= 0 && s.res.sporco > 20000 && Math.random() < 0.3) return act({ t: 'upgrade', city: cap.id, lot: qg });
    if (!cap.unitQueue.length && s.res.sporco > 2500) return act({ t: 'recruit', city: cap.id, id: 'picchiatori', n: 4 });
    const men = cap.units.picchiatori + cap.units.soldati;
    if (world && men >= 3 && s.time > 5.2 * 86400 && !s.missions.length && Math.random() < 0.3) {
      const rivals = Object.entries(world.owners).map(([c]) => c);
      const to = rivals[Math.floor(Math.random() * rivals.length)];
      if (to) { stats.attacks++; return act({ t: 'mission', kind: 'raid', from: cap.id, to, units: { picchiatori: Math.floor(cap.units.picchiatori * 0.7) } }); }
    }
  };
  setInterval(think, 1500 + Math.random() * 1500);
  return ws;
}
const t0 = Date.now();
const socks = [];
for (let i = 0; i < Number(N); i++) socks.push(bot(i, await reg(i)));
console.log(`${N} bot collegati in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const iv = setInterval(async () => {
  const h = await (await fetch(URL + '/api/health')).json();
  console.log(`giorno ${h.day} | online ${h.online} | sync ${h.syncMs}ms | stati ricevuti ${stats.states} (${(stats.bytes / 1e6).toFixed(1)}MB) | azioni ok ${stats.ok} ko ${stats.ko} | attacchi ${stats.attacks} | rapporti di difesa ${stats.defense} | vassalli ${h.vassals ?? '?'}`);
}, 10000);
setTimeout(() => { clearInterval(iv); console.log('errori:', stats.errors); for (const w of socks) w.close(); process.exit(0); }, Number(SECS) * 1000);
