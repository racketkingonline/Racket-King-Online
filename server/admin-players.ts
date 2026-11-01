// Pannello admin → Giocatori: cerca un boss, aggiungi o togli contante, cambia nome, sposta la capitale.
import type { FastifyInstance } from 'fastify';
import type { Db } from './db';
import type { Game } from './game';
import { baseUrl, deny, h, isAdmin, STYLE } from './alpha';
import { NAME_RE } from './auth';
import { randomBytes } from 'node:crypto';
import { migrate, owned, rates, type UseKind } from '../src/engine/engine';
import { BUILDINGS, FRONTS, K, PAYROLL, RACKETS, RESEARCH, UNITS } from '../src/engine/data';
import type { Slot } from '../src/mp/world';
import { CITY_COUNT, cityRaw, searchCities } from '../src/engine/world';

type U = { id: number; email: string | null; name: string | null; player_id: number | null; last_login: string | null };
const cityLabel = (id: string) => { const r = cityRaw(Number(id)); return r ? r[0] : id; };
const money = (n: number) => '$' + Math.round(n).toLocaleString('it-IT');

export function playerAdminRoutes(app: FastifyInstance, db: Db, game: Game) {
  app.get('/admin/giocatori', async (req, reply) => {
    if (!isAdmin(req)) return deny(reply);
    const q = req.query as Record<string, string>;
    const find = (q.q ?? '').trim().toLowerCase();
    const users = await db.query<U>(`select id, email, name, player_id, last_login from users order by id desc limit 2000`);
    const rows = users.filter(u => !find || (u.email ?? '').includes(find) || (u.name ?? '').toLowerCase().includes(find));
    const w = game.world; const now = w.now();
    const body = rows.map(u => {
      const sl = u.player_id ? w.slots.get(u.player_id) : undefined;
      const s = sl?.s;
      const actions = sl ? `
<form method=post action=/admin/player/money><input type=hidden name=id value=${sl.id}><input name=amount type=number step=1 placeholder="es. 2000" style=width:100px required>
<select name=kind><option value=sporco>sporco</option><option value=pulito>pulito</option></select> <button>Aggiungi $</button></form>
<form method=post action=/admin/player/rename><input type=hidden name=id value=${sl.id}><input name=name value="${h(u.name ?? '')}" style=width:150px required> <button>Rinomina</button></form>
<form method=post action=/admin/player/move><input type=hidden name=id value=${sl.id}><input name=city placeholder="città (es. Manhattan)" style=width:150px required> <button>Sposta capitale</button></form>` : '<span class=muted>non è ancora entrato nel mondo</span>';
      return `<tr><td>${h(u.name ?? '—')}<div class=muted>${h(u.email ?? '(Google/Facebook)')}</div></td>
<td>${s ? `${h(cityLabel(s.capital))}<div class=muted>${owned(s).length} città</div>` : ''}</td>
<td>${s ? `${money(s.res.sporco)} sporco<div class=muted>${money(s.res.pulito)} pulito</div>` : ''}</td>
<td>${sl ? (now - sl.lastOnline < 120 ? '<span class=ok>online</span>' : `${Math.round((now - sl.lastOnline) / 3600)} h fa`) : ''}</td>
<td class=acts>${sl ? `<a class=btnlink href=/admin/giocatore/${sl.id}>Modifica tutto →</a>` : ''}${actions}</td></tr>`;
    }).join('');
    const msg = q.ok ? `<div class="box new">${h(q.ok)}</div>` : q.err ? `<div class="box no">${h(q.err)}</div>` : '';
    return reply.type('text/html').send(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content=noindex><title>Giocatori · Racket King Online</title>
<style>${STYLE} .acts form{margin:0 0 6px} a.btnlink{display:inline-block;margin:0 0 8px;font-weight:600} select{font:inherit;color:inherit;background:#0d1315;border:1px solid rgba(170,200,210,.42);padding:7px 6px}</style>
<main><h1>Racket King Online · giocatori</h1><p><a href=/admin>← closed alpha</a></p>${msg}
<form class=box method=get action=/admin/giocatori><input name=q value="${h(q.q ?? '')}" placeholder="cerca per email o nome" style=width:320px> <button>Cerca</button></form>
<div class=box><table><tr><th>Boss</th><th>Capitale</th><th>Contante</th><th>Ultimo accesso</th><th>Azioni</th></tr>${body}</table></div></main>`);
  });

  const back = (q: string, ok: string | null, err?: string) => `/admin/giocatori?${new URLSearchParams({ ...(q ? { q } : {}), ...(ok ? { ok } : {}), ...(err ? { err } : {}) })}`;
  const slotOf = (raw: unknown) => { const id = Number(raw); return Number.isInteger(id) ? game.world.slots.get(id) : undefined; };

  app.post('/admin/player/money', async (req, reply) => {
    if (!isAdmin(req)) return deny(reply);
    const b = (req.body ?? {}) as Record<string, string>; const sl = slotOf(b.id);
    const amount = Math.round(Number(b.amount)); const kind = b.kind === 'pulito' ? 'pulito' : 'sporco';
    if (!sl || !Number.isFinite(amount) || Math.abs(amount) > 1e9) return reply.redirect(back('', null, 'Giocatore o importo non valido.'));
    game.edit(sl.id, s => { s.res[kind] = Math.max(0, s.res[kind] + amount); });
    return reply.redirect(back(sl.name, `${sl.name}: ${amount >= 0 ? '+' : ''}${money(amount)} di contante ${kind}.`));
  });

  app.post('/admin/player/rename', async (req, reply) => {
    if (!isAdmin(req)) return deny(reply);
    const b = (req.body ?? {}) as Record<string, string>; const sl = slotOf(b.id);
    const name = String(b.name ?? '').trim().replace(/\s+/g, ' ');
    if (!sl) return reply.redirect(back('', null, 'Giocatore non trovato.'));
    if (!NAME_RE.test(name)) return reply.redirect(back(sl.name, null, 'Nome non valido: da 3 a 20 caratteri, lettere, numeri e spazi.'));
    if ((await db.query(`select 1 from users where lower(name) = lower($1) and player_id <> $2`, [name, sl.id])).length) return reply.redirect(back(sl.name, null, `"${name}" è già il nome di un altro boss.`));
    const old = sl.name;
    await db.query(`update users set name = $1 where player_id = $2`, [name, sl.id]);
    game.edit(sl.id, () => { sl.name = name; });
    game.broadcastWorld();
    return reply.redirect(back(name, `${old} ora si chiama ${name}.`));
  });

  app.post('/admin/player/move', async (req, reply) => {
    if (!isAdmin(req)) return deny(reply);
    const b = (req.body ?? {}) as Record<string, string>; const sl = slotOf(b.id);
    if (!sl) return reply.redirect(back('', null, 'Giocatore non trovato.'));
    const q = String(b.city ?? '').trim();
    const id = /^\d+$/.test(q) && Number(q) < CITY_COUNT ? Number(q) : searchCities(q, 1)[0];
    if (id === undefined) return reply.redirect(back(sl.name, null, `Nessuna città trovata per "${q}".`));
    let err: string | null = null;
    game.edit(sl.id, () => { err = game.world.relocate(sl, String(id)); });
    if (err) return reply.redirect(back(sl.name, null, err));
    game.broadcastWorld();
    const r = cityRaw(id);
    return reply.redirect(back(sl.name, `${sl.name} ora ha la capitale a ${r[0]} (${r[5].toLocaleString('it-IT')} abitanti).`));
  });

  // ---------------------------------------------------------------- scheda completa di un giocatore
  app.get('/admin/giocatore/:id', async (req, reply) => {
    if (!isAdmin(req)) return deny(reply);
    const sl = slotOf((req.params as { id: string }).id); if (!sl) return reply.redirect(back('', null, 'Giocatore non trovato.'));
    game.world.advance(sl);
    const q = req.query as Record<string, string>;
    const u = (await db.query<U>(`select id, email, name, player_id, last_login from users where player_id = $1`, [sl.id]))[0];
    return reply.type('text/html').send(playerPage(sl, u, game, q));
  });

  app.post('/admin/giocatore/:id', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    if (!isAdmin(req)) return deny(reply);
    const sl = slotOf((req.params as { id: string }).id); if (!sl) return reply.redirect(back('', null, 'Giocatore non trovato.'));
    const b = (req.body ?? {}) as Record<string, string>;
    const url = (ok?: string, err?: string) => `/admin/giocatore/${sl.id}?${new URLSearchParams({ ...(ok ? { ok } : {}), ...(err ? { err } : {}) })}`;
    const num = (k: string, min = 0, max = 1e12) => { const v = Number(b[k]); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined; };
    const w = game.world; const now = w.now();

    // stato completo in JSON: sostituisce tutto il resto
    if (b.apply_json === 'on' && b.json?.trim()) {
      try {
        const next = migrate(JSON.parse(b.json)); rates(next);
        game.edit(sl.id, () => { sl.s = next; });
        for (const id of Object.keys(w.meta.owner)) if (w.meta.owner[id] === sl.id && next.cities[id]?.owner !== 'player') { delete w.meta.owner[id]; w.owner.delete(id); }
        for (const c of owned(next)) if (!w.owner.has(c.id)) { w.owner.set(c.id, sl.id); w.meta.owner[c.id] = sl.id; }
        game.broadcastWorld();
        return reply.redirect(url('Stato sostituito dal JSON.'));
      } catch (e) { return reply.redirect(url(undefined, 'JSON non valido: ' + (e as Error).message)); }
    }

    // account
    const name = String(b.name ?? '').trim().replace(/\s+/g, ' ');
    if (name && name !== sl.name) {
      if (!NAME_RE.test(name)) return reply.redirect(url(undefined, 'Nome non valido: da 3 a 20 caratteri, lettere, numeri e spazi.'));
      if ((await db.query(`select 1 from users where lower(name) = lower($1) and player_id <> $2`, [name, sl.id])).length) return reply.redirect(url(undefined, `"${name}" è già il nome di un altro boss.`));
      await db.query(`update users set name = $1 where player_id = $2`, [name, sl.id]); sl.name = name;
    }
    const email = String(b.email ?? '').trim().toLowerCase();
    if (email) {
      if ((await db.query(`select 1 from users where email = $1 and player_id <> $2`, [email, sl.id])).length) return reply.redirect(url(undefined, `${email} è già usata da un altro account.`));
      await db.query(`update users set email = $1 where player_id = $2`, [email, sl.id]);
    }
    let resetLink = '';
    if (b.reset === 'on') {
      const u = (await db.query<{ id: number }>(`select id from users where player_id = $1`, [sl.id]))[0];
      if (u) { const t = randomBytes(24).toString('base64url'); await db.query(`insert into resets (token, user_id, expires_at) values ($1, $2, now() + interval '7 days')`, [t, u.id]); resetLink = `${baseUrl(req)}/?reset=${t}`; }
    }

    game.edit(sl.id, s => {
      // risorse e know-how
      for (const k of ['sporco', 'pulito'] as const) { const v = num('res_' + k); if (v !== undefined) s.res[k] = v; }
      const inv = num('investments'); if (inv !== undefined) s.investments = inv;
      for (const r of RESEARCH) { const v = num('research_' + r.id, 0, 50); if (v !== undefined) s.research[r.id] = Math.floor(v); }
      // città
      for (const c of owned(s)) {
        const p = (k: string) => `c_${c.id}_${k}`;
        const inf = num(p('influence'), 0, K.influenceCap); if (inf !== undefined) c.influence = inf;
        const heat = num(p('heat'), 0, 100); if (heat !== undefined) c.heat = heat;
        const pay = num(p('payroll'), 0, PAYROLL.length - 1); if (pay !== undefined) c.payroll = Math.floor(pay);
        for (const un of UNITS) { const v = num(p('u_' + un.id), 0, 1e7); if (v !== undefined) c.units[un.id] = Math.floor(v); }
        c.lots.forEach((l, i) => {
          const what = b[p('lot_' + i)]; const lv = Math.max(1, Math.min(50, Math.floor(Number(b[p('lv_' + i)]) || 1)));
          if (what === undefined) return;
          if (!what) { if (l && !(l.kind === 'building' && l.id === 'qg') && !l.hosted) c.lots[i] = null; return; }
          const [kind, id] = what.split(':') as [UseKind, string];
          if (l && l.kind === kind && l.id === id) l.level = lv;
          else if (!l?.hosted && !(l?.kind === 'building' && l.id === 'qg')) c.lots[i] = { kind, id, level: lv };
          if (c.lots[i]?.closedUntil && b[p('open_' + i)] === 'on') delete c.lots[i]!.closedUntil;
        });
      }
      // multiplayer
      const shield = num('shield_h', 0, 24 * 365); if (shield !== undefined) sl.shieldUntil = shield > 0 ? now + shield * 3600 : 0;
      if (b.vacation_end === 'on' && s.vacation) s.vacation = { ...s.vacation, until: s.time };
    });
    if (b.free === 'on' && sl.lord !== null) { const lord = w.slots.get(sl.lord); if (lord) lord.vassals = lord.vassals.filter(x => x !== sl.id); sl.lord = null; sl.allies = []; }
    const move = String(b.move ?? '').trim();
    if (move) {
      const id = /^\d+$/.test(move) && Number(move) < CITY_COUNT ? Number(move) : searchCities(move, 1)[0];
      if (id === undefined) return reply.redirect(url(undefined, `Nessuna città trovata per "${move}".`));
      let err: string | null = null; game.edit(sl.id, () => { err = w.relocate(sl, String(id)); });
      if (err) return reply.redirect(url(undefined, err));
    }
    game.broadcastWorld();
    return reply.redirect(url('Salvato.' + (resetLink ? ` Link per la nuova password (vale 7 giorni): ${resetLink}` : '')));
  });
}

const ALL_USES: { v: string; label: string }[] = [
  ...BUILDINGS.map(x => ({ v: `building:${x.id}`, label: `Struttura · ${x.name}` })),
  ...RACKETS.map(x => ({ v: `racket:${x.id}`, label: `Racket · ${x.name}` })),
  ...FRONTS.map(x => ({ v: `front:${x.id}`, label: `Attività · ${x.name}` })),
];
function playerPage(sl: Slot, u: U | undefined, game: Game, q: Record<string, string>) {
  const s = sl.s; const w = game.world; const now = w.now();
  const n = (name: string, v: number, step = 1, width = 110) => `<input type=number name="${name}" value="${Math.round(v * 100) / 100}" step=${step} style="width:${width}px">`;
  const lord = sl.lord !== null ? w.slots.get(sl.lord)?.name : null;
  const cities = owned(s).map(c => {
    const p = (k: string) => `c_${c.id}_${k}`;
    const lots = c.lots.map((l, i) => {
      const locked = l && ((l.kind === 'building' && l.id === 'qg') || l.hosted);
      const sel = `<select name="${p('lot_' + i)}"${locked ? ' disabled' : ''}><option value="">— libero —</option>${ALL_USES.map(o => `<option value="${o.v}"${l && `${l.kind}:${l.id}` === o.v ? ' selected' : ''}>${h(o.label)}</option>`).join('')}</select>`;
      return `<tr><td>${i}</td><td>${sel}${locked ? `<input type=hidden name="${p('lot_' + i)}" value="${l!.kind}:${l!.id}">` : ''}${l?.hosted ? ` <span class=muted>(dentro: ${h(l.hosted.id)} liv. ${l.hosted.level})</span>` : ''}</td><td>liv. ${n(p('lv_' + i), l?.level ?? 1, 1, 70)}</td>
<td>${l?.closedUntil && l.closedUntil > now ? `<label><input type=checkbox name="${p('open_' + i)}"> riapri (chiuso)</label>` : ''}</td></tr>`;
    }).join('');
    return `<div class=box><h2 style="margin-top:0">${h(cityLabel(c.id))}${c.id === s.capital ? ' · capitale' : ''} <span class=muted style="font-size:12px">id ${c.id}</span></h2>
<p><label>Influenza ${n(p('influence'), c.influence)}</label> <label>Calore ${n(p('heat'), c.heat, 0.1)}</label> <label>Libro paga (0–${PAYROLL.length - 1}) ${n(p('payroll'), c.payroll, 1, 70)}</label></p>
<p>${UNITS.map(un => `<label>${h(un.name)} ${n(p('u_' + un.id), c.units[un.id] ?? 0, 1, 90)}</label>`).join(' ')}</p>
<details><summary>Lotti (${c.lots.filter(Boolean).length}/${c.lots.length} occupati)</summary><table><tr><th>#</th><th>Edificio</th><th>Livello</th><th></th></tr>${lots}</table>
<p class=muted>Il QG e gli edifici che nascondono QG o cassaforte non si cambiano da qui (usa il JSON).</p></details></div>`;
  }).join('');
  const json = JSON.stringify(s, null, 1);
  const msg = q.ok ? `<div class="box new">${h(q.ok)}</div>` : q.err ? `<div class="box no">${h(q.err)}</div>` : '';
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content=noindex><title>${h(sl.name)} · admin</title>
<style>${STYLE} select{font:inherit;color:inherit;background:#0d1315;border:1px solid rgba(170,200,210,.42);padding:6px} label{display:inline-block;margin:0 14px 8px 0} details summary{cursor:pointer;color:#c8b082;margin:6px 0}
.save{position:sticky;bottom:0;background:#06090aee;padding:12px 0;border-top:1px solid rgba(150,180,190,.25)} textarea{width:100%;height:360px;background:#0d1315;color:#e8edef;border:1px solid rgba(170,200,210,.42);font:12px/1.4 ui-monospace,monospace}</style>
<main><h1>${h(sl.name)}</h1><p><a href=/admin/giocatori>← tutti i giocatori</a> · <a href=/admin>closed alpha</a></p>${msg}
<form method=post>
<div class=box><h2 style="margin-top:0">Account</h2>
<p><label>Nome del boss <input name=name value="${h(sl.name)}" style=width:200px></label> <label>Email <input name=email value="${h(u?.email ?? '')}" style=width:260px></label></p>
<p><label><input type=checkbox name=reset> crea un link per scegliere una nuova password (lo vedrai qui dopo il salvataggio)</label></p>
<p class=muted>Ultimo accesso: ${now - sl.lastOnline < 120 ? 'online adesso' : Math.round((now - sl.lastOnline) / 3600) + ' ore fa'} · nel mondo dal giorno ${Math.floor(sl.joinedAt / 86400) + 1}</p></div>

<div class=box><h2 style="margin-top:0">Risorse e know-how</h2>
<p><label>Contante sporco $ ${n('res_sporco', s.res.sporco, 1, 140)}</label> <label>Contante pulito $ ${n('res_pulito', s.res.pulito, 1, 140)}</label> <label>Investito $ ${n('investments', s.investments ?? 0, 1, 140)}</label></p>
<p>${RESEARCH.map(r => `<label>${h(r.name)} ${n('research_' + r.id, s.research[r.id], 1, 60)}</label>`).join(' ')}</p></div>

${cities}

<div class=box><h2 style="margin-top:0">Multiplayer</h2>
<p><label>Sposta la capitale in <input name=move placeholder="es. Manhattan" style=width:180px></label> <span class=muted>edifici, uomini e influenza vengono con lui; la città deve essere libera</span></p>
<p><label>Tregua (ore da adesso, 0 = nessuna) ${n('shield_h', Math.max(0, (sl.shieldUntil - now) / 3600), 1, 80)}</label>
${lord ? `<label><input type=checkbox name=free> liberalo dalla famiglia di ${h(lord)}</label>` : '<span class=muted>Non ha un capo.</span>'}
${s.vacation ? ' <label><input type=checkbox name=vacation_end> fai finire la vacanza</label>' : ''}</p>
<p class=muted>Uomini nella famiglia: ${sl.vassals.map(v => h(w.slots.get(v)?.name ?? v)).join(', ') || 'nessuno'}</p></div>

<details class=box><summary>Avanzato: stato completo (JSON)</summary><p class=muted>Se spunti la casella in fondo e salvi, questo testo sostituisce tutto lo stato del giocatore e gli altri campi vengono ignorati.</p>
<textarea name=json spellcheck=false>${h(json)}</textarea><p><label><input type=checkbox name=apply_json> usa questo JSON al salvataggio</label></p></details>
<div class=save><button>Salva le modifiche</button> <a href="/admin/giocatore/${sl.id}">annulla</a></div>
</form></main>`;
}
