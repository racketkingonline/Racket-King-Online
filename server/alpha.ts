// Closed alpha: lista d'attesa con doppia conferma, inviti a link unico, difese contro bot e spam.
// Difese (nessun servizio esterno obbligatorio):
// - prova di calcolo (proof of work): il browser cerca un numero il cui hash SHA-256 inizia con N bit a zero (~1 s per una persona, costoso per chi manda migliaia di richieste);
// - la sfida è firmata dal server, scade dopo 10 minuti, si usa una volta sola e non vale se il modulo è stato inviato in meno di 3 secondi;
// - campo trappola nascosto (i bot lo compilano: la richiesta viene scartata in silenzio);
// - limite di richieste per indirizzo IP;
// - email: sintassi, domini usa e getta, dominio che riceve davvero posta (record MX);
// - Cloudflare Turnstile, se ci sono TURNSTILE_SITE_KEY e TURNSTILE_SECRET.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as dns } from 'node:dns';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db';
import { sendMail } from './auth';

const env = (k: string) => process.env[k]?.trim() || undefined;
const SECRET = env('SECRET') ?? randomBytes(32).toString('hex');
export const alphaClosed = () => (env('ALPHA_MODE') ?? 'closed') !== 'open';
const POW_BITS = Number(env('POW_BITS') ?? 19);
const MIN_FILL_MS = 3000;
const hmac = (s: string) => createHmac('sha256', SECRET).update(s).digest('hex');
const sha = (s: string) => createHash('sha256').update(s).digest();
export const ipHash = (ip: string) => hmac('ip:' + ip).slice(0, 16);
export const baseUrl = (req: FastifyRequest) => env('PUBLIC_URL') ?? (env('RAILWAY_PUBLIC_DOMAIN') ? `https://${env('RAILWAY_PUBLIC_DOMAIN')}` : env('RENDER_EXTERNAL_URL') ?? `${req.protocol}://${req.headers.host}`);
const token = (n = 18) => randomBytes(n).toString('base64url');

// ---------------------------------------------------------------- limiti per IP
const buckets = new Map<string, number[]>();
export function limited(key: string, max: number, windowMs: number) {
  const now = Date.now(); const list = (buckets.get(key) ?? []).filter(t => now - t < windowMs); list.push(now); buckets.set(key, list);
  if (buckets.size > 50_000) for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > 3_600_000) buckets.delete(k);
  return list.length > max;
}

// ---------------------------------------------------------------- prova di calcolo
type Pow = { salt: string; bits: number; issued: number; sig: string; nonce?: string };
const used = new Map<string, number>();
export function challenge(): Pow {
  const salt = token(16); const issued = Date.now();
  return { salt, bits: POW_BITS, issued, sig: hmac(`${salt}|${POW_BITS}|${issued}`) };
}
function zeroBits(buf: Buffer) { let n = 0; for (const b of buf) { if (b === 0) { n += 8; continue; } n += Math.clz32(b) - 24; break; } return n; }
export function checkPow(p: unknown): string | null {
  const x = p as Pow | undefined;
  if (!x || typeof x.salt !== 'string' || typeof x.nonce !== 'string' || typeof x.issued !== 'number' || typeof x.bits !== 'number' || typeof x.sig !== 'string') return 'verifica';
  const good = hmac(`${x.salt}|${x.bits}|${x.issued}`);
  if (good.length !== x.sig.length || !timingSafeEqual(Buffer.from(good), Buffer.from(x.sig))) return 'verifica';
  const age = Date.now() - x.issued;
  if (age > 10 * 60_000) return 'scaduta';
  if (age < MIN_FILL_MS) return 'veloce';
  if (x.bits < POW_BITS || zeroBits(sha(`${x.salt}:${x.nonce}`)) < x.bits) return 'verifica';
  if (used.has(x.salt)) return 'verifica';
  used.set(x.salt, Date.now());
  if (used.size > 20_000) { const cut = Date.now() - 11 * 60_000; for (const [k, t] of used) if (t < cut) used.delete(k); }
  return null;
}
async function turnstileOk(tok: unknown, ip: string) {
  const secret = env('TURNSTILE_SECRET'); if (!secret) return true;
  if (typeof tok !== 'string' || !tok) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret, response: tok, remoteip: ip }) });
    return ((await r.json()) as { success?: boolean }).success === true;
  } catch { return true; } // Cloudflare irraggiungibile: restano le altre difese
}

// ---------------------------------------------------------------- email
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const DISPOSABLE = new Set(('mailinator.com guerrillamail.com guerrillamail.net guerrillamail.org sharklasers.com grr.la 10minutemail.com 10minutemail.net temp-mail.org tempmail.com tempmail.net ' +
  'throwawaymail.com yopmail.com yopmail.net yopmail.fr trashmail.com trashmail.de getnada.com nada.email dispostable.com maildrop.cc mailnesia.com mintemail.com mohmal.com ' +
  'fakeinbox.com emailondeck.com tempail.com tempr.email discard.email spamgourmet.com mailcatch.com moakt.com burnermail.io inboxkitten.com mail.tm mail.gw tmpmail.org ' +
  'tmpmail.net emailfake.com fakemail.net mytemp.email tempmailo.com temp-mail.io luxusmail.org owlymail.com spambox.us 33mail.com anonaddy.me trbvm.com byom.de ' +
  'jetable.org mailtemp.info tempinbox.com instaddr.ch spam4.me wegwerfmail.de mvrht.net einrot.com cuvox.de armyspy.com dayrep.com fleckens.hu gustr.com jourrapide.com ' +
  'rhyta.com superrito.com teleworm.us').split(/\s+/));
const mxCache = new Map<string, boolean>();
const KNOWN = new Set('gmail.com googlemail.com outlook.com outlook.it hotmail.com hotmail.it live.com live.it msn.com yahoo.com yahoo.it icloud.com me.com libero.it virgilio.it alice.it tim.it tiscali.it fastwebnet.it email.it proton.me protonmail.com gmx.com gmx.de web.de aol.com'.split(' '));
const timeout = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 3000))]);
/** true = il dominio riceve posta (MX, o almeno un indirizzo); null = DNS lento o irraggiungibile. */
async function lookup(domain: string): Promise<boolean | null> {
  try { const mx = await timeout(dns.resolveMx(domain)); return mx.some(r => r.exchange && r.exchange !== '.'); }
  catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== 'ENOTFOUND' && code !== 'ENODATA') return null;
    try { return (await timeout(dns.resolve4(domain))).length > 0; } catch { return false; }
  }
}
async function domainReceivesMail(domain: string) {
  if (KNOWN.has(domain)) return true;
  if (mxCache.has(domain)) return mxCache.get(domain)!;
  const r = await lookup(domain);
  if (r === null) return true; // DNS lento: non si blocca nessuno
  // se il DNS non risolve nemmeno gmail.com non si può giudicare: si lascia passare (e non si salva)
  if (!r && (await lookup('gmail.com')) !== true) return true;
  mxCache.set(domain, r); if (mxCache.size > 20000) mxCache.clear();
  return r;
}
/** null = email accettabile, altrimenti il motivo (in italiano, tradotto dal client). */
export async function emailProblem(email: string): Promise<string | null> {
  if (!EMAIL_RE.test(email)) return 'Email non valida.';
  const domain = email.split('@')[1];
  if (DISPOSABLE.has(domain)) return 'Usa un indirizzo email vero, non uno usa e getta.';
  if (!(await domainReceivesMail(domain))) return 'Questo dominio non riceve email: controlla l\'indirizzo.';
  return null;
}

/** Tutte le difese insieme. null = passa; 'silenzio' = bot sicuro, rispondere ok senza fare nulla. */
export async function botGuard(req: FastifyRequest, body: Record<string, unknown>, bucket: string, max: number): Promise<string | null> {
  if (typeof body.website === 'string' && body.website.trim()) return 'silenzio';
  if (limited(`${bucket}:${req.ip}`, max, 3_600_000)) return 'Troppi tentativi: riprova tra qualche minuto.';
  const pow = checkPow(body.pow);
  if (pow === 'veloce') return 'silenzio';
  if (pow === 'scaduta') return 'La pagina è aperta da troppo tempo: ricaricala e riprova.';
  if (pow) return 'Verifica antibot non riuscita: ricarica la pagina e riprova.';
  if (!(await turnstileOk(body.turnstile, req.ip))) return 'Verifica antibot non riuscita: ricarica la pagina e riprova.';
  return null;
}

// ---------------------------------------------------------------- inviti
/** L'invito (la "alfa key") se è ancora valido: null altrimenti. email = indirizzo a cui è legato. */
export async function inviteInfo(db: Db, tok: unknown): Promise<{ token: string; email: string | null } | null> {
  if (typeof tok !== 'string' || !/^[\w-]{10,64}$/.test(tok)) return null;
  return (await db.query<{ token: string; email: string | null }>(`select token, email from invites where token = $1 and not revoked and uses < max_uses and (expires_at is null or expires_at > now())`, [tok]))[0] ?? null;
}
export async function inviteValid(db: Db, tok: unknown, email?: string) {
  const i = await inviteInfo(db, tok); if (!i) return false;
  return !i.email || !email || i.email === email.toLowerCase();
}
/** La alfa key ancora valida data a questa email (per chi entra con Google o Facebook). */
export async function keyForEmail(db: Db, email: string | undefined) {
  if (!email) return null;
  return (await db.query<{ token: string }>(`select token from invites where email = $1 and not revoked and uses < max_uses and (expires_at is null or expires_at > now()) order by created_at desc limit 1`, [email.toLowerCase()]))[0]?.token ?? null;
}
/** Consuma un uso dell'invito per l'utente appena creato. false = invito non più valido. */
export async function consumeInvite(db: Db, tok: string, userId: number) {
  const r = await db.query(`update invites set uses = uses + 1 where token = $1 and not revoked and uses < max_uses and (expires_at is null or expires_at > now()) returning token`, [tok]);
  if (!r.length) return false;
  await db.query(`insert into invite_uses (token, user_id) values ($1, $2)`, [tok, userId]);
  await db.query(`update users set invite_token = $1 where id = $2`, [tok, userId]);
  return true;
}
async function createKey(db: Db, email: string) {
  const t = token(12);
  await db.query(`insert into invites (token, note, email, max_uses, expires_at) values ($1, $2, $2, 1, now() + interval '30 days')`, [t, email]);
  return t;
}
async function acceptanceMail(email: string, lang: string, link: string) {
  await sendMail(email, lang === 'en' ? "You're in: Racket King Online closed alpha" : 'Sei dentro: closed alpha di Racket King Online',
    lang === 'en'
      ? `Good news: your spot in the Racket King Online closed alpha is ready.

Create your boss with this link (valid 30 days, only for ${email}):
${link}

After that, come back whenever you like from the home page with "I have alpha access", using this email.`
      : `Buone notizie: il tuo posto nella closed alpha di Racket King Online è pronto.

Crea il tuo boss con questo link (vale 30 giorni, solo per ${email}):
${link}

Poi rientri quando vuoi dalla home con "Ho un accesso alfa", usando questa email.`);
}
/** "Give alfa key": crea (o riusa) la chiave personale e manda la mail di accettazione. Restituisce il link. */
async function giveKey(db: Db, id: number, base: string) {
  const w = (await db.query<{ email: string; lang: string; invite_token: string | null }>(`select email, lang, invite_token from waitlist where id = $1`, [id]))[0]; if (!w) return null;
  const t = w.invite_token && await inviteValid(db, w.invite_token) ? w.invite_token : await createKey(db, w.email);
  await db.query(`update waitlist set invite_token = $1, invited_at = now() where id = $2`, [t, id]);
  const link = `${base}/?chiave=${t}`;
  await acceptanceMail(w.email, w.lang, link);
  return link;
}

// ---------------------------------------------------------------- accesso al pannello
const adminCookie = () => hmac('admin:' + (env('ADMIN_PASSWORD') ?? ''));
export const isAdmin = (req: FastifyRequest) => !!env('ADMIN_PASSWORD') && req.cookies.rk_admin === adminCookie();
export const deny = (reply: FastifyReply) => reply.code(env('ADMIN_PASSWORD') ? 401 : 404).type('text/html').send(env('ADMIN_PASSWORD') ? loginPage() : 'Non trovato');

// ---------------------------------------------------------------- rotte
export function alphaRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/alpha/challenge', async () => ({ ...challenge(), turnstile: env('TURNSTILE_SITE_KEY') ?? null }));

  app.get('/api/invite/:token', async req => { const i = await inviteInfo(db, (req.params as { token: string }).token); return { ok: true, valid: !!i, email: i?.email ?? null, closed: alphaClosed() }; });

  /** "Ho un accesso alfa": cosa può fare questa email. account = entra con la password; mail = gli rimandiamo il link per creare il boss. */
  app.post('/api/alpha/access', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const guard = await botGuard(req, b, 'access', 20);
    if (guard === 'silenzio') return { ok: true, status: 'no' };
    if (guard) return reply.code(400).send({ ok: false, msg: guard });
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return reply.code(400).send({ ok: false, msg: 'Email non valida.' });
    const u = (await db.query<{ password_hash: string | null }>(`select password_hash from users where email = $1`, [email]))[0];
    if (u) return { ok: true, status: u.password_hash ? 'account' : 'social' };
    const w = (await db.query<{ id: number; lang: string; invite_token: string | null }>(`select id, lang, invite_token from waitlist where email = $1`, [email]))[0];
    if (!w) return { ok: true, status: 'no' };
    if (!w.invite_token) return { ok: true, status: 'attesa' };
    if (!limited(`resend:${email}`, 3, 24 * 3_600_000)) {
      const t = await inviteValid(db, w.invite_token) ? w.invite_token : await createKey(db, email);
      if (t !== w.invite_token) await db.query(`update waitlist set invite_token = $1 where id = $2`, [t, w.id]);
      await acceptanceMail(email, w.lang, `${baseUrl(req)}/?chiave=${t}`);
    }
    return { ok: true, status: 'mail' };
  });

  app.post('/api/alpha/join', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const guard = await botGuard(req, b, 'join', 8);
    if (guard === 'silenzio') return { ok: true };
    if (guard) return reply.code(400).send({ ok: false, msg: guard });
    if (b.consent !== true) return reply.code(400).send({ ok: false, msg: 'Serve il consenso per ricevere l\'invito.' });
    const email = String(b.email ?? '').trim().toLowerCase();
    const bad = await emailProblem(email); if (bad) return reply.code(400).send({ ok: false, msg: bad });
    if (limited(`join-email:${email}`, 3, 24 * 3_600_000)) return { ok: true };
    const confirm = token(18);
    const lang = b.lang === 'en' ? 'en' : 'it';
    const ref = typeof b.ref === 'string' ? b.ref.slice(0, 40) : null;
    const r = await db.query<{ confirmed_at: string | null; confirm_token: string | null }>(
      `insert into waitlist (email, lang, ref, ip_hash, user_agent, confirm_token) values ($1, $2, $3, $4, $5, $6)
       on conflict (email) do update set lang = excluded.lang returning confirmed_at, confirm_token`,
      [email, lang, ref, ipHash(req.ip), String(req.headers['user-agent'] ?? '').slice(0, 200), confirm]);
    const row = r[0];
    if (row && !row.confirmed_at) {
      const link = `${baseUrl(req)}/api/alpha/confirm?token=${row.confirm_token}`;
      await sendMail(email, lang === 'en' ? 'Racket King Online — confirm your email' : 'Racket King Online — conferma la tua email',
        lang === 'en'
          ? `Thanks for joining the Racket King Online closed alpha waiting list.\n\nConfirm your email with this link:\n${link}\n\nWhen a spot opens up, we'll send you your personal invite.\nIf you didn't ask for this, just ignore this email.`
          : `Grazie per esserti iscritto alla lista d'attesa della closed alpha di Racket King Online.\n\nConferma la tua email con questo link:\n${link}\n\nQuando si libera un posto ti mandiamo il tuo invito personale.\nSe non sei stato tu, ignora questa email.`);
    }
    return { ok: true, confirm: !!env('RESEND_API_KEY') };
  });

  app.get('/api/alpha/confirm', async (req, reply) => {
    const t = String((req.query as Record<string, string>).token ?? '');
    if (t) await db.query(`update waitlist set confirmed_at = coalesce(confirmed_at, now()) where confirm_token = $1`, [t]);
    return reply.redirect('/?confermato=1');
  });

  // ---------------------------------------------------------------- amministrazione (/admin, password in ADMIN_PASSWORD)

  app.post('/admin/login', async (req, reply) => {
    const pw = String(((req.body ?? {}) as Record<string, unknown>).password ?? '');
    const want = env('ADMIN_PASSWORD');
    if (limited('admin:' + req.ip, 10, 3_600_000) || !want || hmac(pw) !== hmac(want)) return reply.code(401).type('text/html').send(loginPage('Password sbagliata.'));
    reply.setCookie('rk_admin', adminCookie(), { path: '/', httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400 });
    return reply.redirect('/admin');
  });
  app.post('/admin/logout', async (_req, reply) => { reply.clearCookie('rk_admin', { path: '/' }); return reply.redirect('/admin'); });

  app.get('/admin', async (req, reply) => {
    if (!isAdmin(req)) return deny(reply);
    const q = req.query as Record<string, string>;
    const [users] = await db.query<{ n: number }>(`select count(*)::int n from users`);
    const [wl] = await db.query<{ n: number; c: number; i: number }>(`select count(*)::int n, count(confirmed_at)::int c, count(invited_at)::int i from waitlist`);
    const rows = await db.query<Row>(
      `select w.id, w.email, w.lang, w.ref, w.created_at, w.confirmed_at, w.invited_at, w.invite_token, i.uses, i.revoked, u.name boss, u.last_login
       from waitlist w left join invites i on i.token = w.invite_token left join users u on u.email = w.email
       order by (u.id is not null), (w.invited_at is not null), (w.confirmed_at is null), w.created_at limit 2000`);
    const dati = (q.dati ?? '').split(' ').filter(Boolean);
    return reply.type('text/html').send(adminPage({ users: users.n, wl, rows, dati, mail: !!env('RESEND_API_KEY'), base: baseUrl(req) }));
  });

  /** "Give alfa key" su una o più persone della lista. */
  app.post('/admin/key', async (req, reply) => {
    if (!isAdmin(req)) return deny(reply);
    const raw = ((req.body ?? {}) as Record<string, string | string[]>).id;
    const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(Number).filter(Number.isInteger).slice(0, 200);
    const links: string[] = [];
    for (const id of ids) { const l = await giveKey(db, id, baseUrl(req)); if (l) links.push(l); }
    return reply.redirect('/admin?dati=' + encodeURIComponent(links.join(' ')));
  });
  /** Toglie la chiave a chi non l'ha ancora usata. */
  app.post('/admin/revoke', async (req, reply) => {
    if (!isAdmin(req)) return deny(reply);
    const id = Number(((req.body ?? {}) as Record<string, string>).id);
    const w = (await db.query<{ invite_token: string | null }>(`select invite_token from waitlist where id = $1`, [id]))[0];
    if (w?.invite_token) { await db.query(`update invites set revoked = true where token = $1 and uses = 0`, [w.invite_token]); await db.query(`update waitlist set invite_token = null, invited_at = null where id = $1`, [id]); }
    return reply.redirect('/admin');
  });
  app.post('/admin/delete', async (req, reply) => {
    if (!isAdmin(req)) return deny(reply);
    await db.query(`delete from waitlist where id = $1`, [Number(((req.body ?? {}) as Record<string, string>).id)]);
    return reply.redirect('/admin');
  });
  app.get('/admin/waitlist.csv', async (req, reply) => {
    if (!isAdmin(req)) return deny(reply);
    const rows = await db.query<Record<string, unknown>>(`select email, lang, ref, created_at, confirmed_at, invited_at, invite_token from waitlist order by created_at`);
    const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = ['email,lang,ref,iscritto,confermato,invitato,invito', ...rows.map(r => [r.email, r.lang, r.ref, r.created_at, r.confirmed_at, r.invited_at, r.invite_token].map(esc).join(','))].join('\n');
    return reply.header('content-disposition', 'attachment; filename="lista-attesa.csv"').type('text/csv; charset=utf-8').send('﻿' + csv);
  });
}

// ---------------------------------------------------------------- pagine di amministrazione (HTML semplice, senza dipendenze)
export const h = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const day = (d: unknown) => d ? new Date(String(d)).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
export const STYLE = `body{margin:0;background:#06090a;color:#e8edef;font:15px/1.45 system-ui,sans-serif}main{max-width:1100px;margin:0 auto;padding:24px}
h1{font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:#c8b082;margin:0 0 16px}h2{font-weight:500;letter-spacing:.06em;text-transform:uppercase;font-size:16px;margin:28px 0 10px;color:#c8b082}
.box{border:1px solid rgba(150,180,190,.25);background:rgba(13,19,21,.9);padding:16px;margin:12px 0}.stats{display:flex;gap:28px;flex-wrap:wrap}.stats b{display:block;font-size:26px;font-weight:500}
table{border-collapse:collapse;width:100%;font-size:13.5px}td,th{border-bottom:1px solid rgba(150,180,190,.15);padding:6px 8px;text-align:left;vertical-align:top}th{color:#84939a;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.1em}
input,button{font:inherit;color:inherit;background:#0d1315;border:1px solid rgba(170,200,210,.42);padding:7px 10px}button{cursor:pointer;border-color:#c8b082;color:#c8b082;text-transform:uppercase;letter-spacing:.08em;font-size:13px}
button.ghost{border-color:rgba(170,200,210,.3);color:#84939a}code{font-size:12.5px;user-select:all;word-break:break-all}.muted{color:#84939a}.ok{color:#6fcf97}.no{color:#e8584a}.new{background:rgba(200,176,130,.1)}form.inline{display:inline}label{margin-right:10px}a{color:#c8b082}`;
function loginPage(err?: string) {
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content=noindex><title>Admin · Racket King Online</title><style>${STYLE}</style>
<main><h1>Racket King Online · admin</h1><form class=box method=post action=/admin/login><p><input type=password name=password placeholder=Password autofocus required> <button>Entra</button></p>${err ? `<p class=no>${h(err)}</p>` : ''}</form></main>`;
}
type Row = { id: number; email: string; lang: string; ref: string | null; created_at: string; confirmed_at: string | null; invited_at: string | null; invite_token: string | null; uses: number | null; revoked: boolean | null; boss: string | null; last_login: string | null };
type AdminData = { users: number; wl: { n: number; c: number; i: number }; rows: Row[]; dati: string[]; mail: boolean; base: string };
function adminPage(d: AdminData) {
  const status = (r: Row) => r.boss ? `<span class=ok>dentro · ${h(r.boss)}</span>` : r.invited_at ? `chiave data ${day(r.invited_at)}` : r.confirmed_at ? '<span class=ok>email confermata</span>' : '<span class=muted>da confermare</span>';
  const form = (action: string, id: number, label: string, cls = '') => `<form class=inline method=post action=${action}><input type=hidden name=id value=${id}><button class="${cls}">${label}</button></form>`;
  const given = d.dati.length ? `<div class="box new"><b>Alfa key date: ${d.dati.length}</b> — ${d.mail ? 'la mail di accettazione è partita. Se serve, ecco i link:' : '<span class=no>email non configurata (RESEND_API_KEY): manda tu questi link</span>'}
<p><textarea rows=${Math.min(10, d.dati.length + 1)} style="width:100%;background:#0d1315;color:#e8edef;border:1px solid #c8b08288" readonly onclick="this.select()">${d.dati.map(h).join('\n')}</textarea></p></div>` : '';
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content=noindex><title>Admin · Racket King Online</title><style>${STYLE}</style>
<main><h1>Racket King Online · closed alpha</h1>
<div class="box stats"><div><b>${d.wl.n}</b>iscritti</div><div><b>${d.wl.c}</b>email confermate</div><div><b>${d.wl.i}</b>alfa key date</div><div><b>${d.users}</b>boss nel gioco</div></div>
${given}
<p><a href=/admin/giocatori><b>Giocatori →</b></a> · <a href=/admin/waitlist.csv>Scarica la lista (CSV)</a> · ${d.mail ? 'le mail partono da sole' : '<span class=no>email non configurata: la mail di accettazione non parte, ti mostro il link da mandare</span>'}</p>
<form id=bulk method=post action=/admin/key></form>
<div class=box><table><tr><th><input type=checkbox onclick="for(const c of document.querySelectorAll('.pick'))c.checked=this.checked"></th><th>Email</th><th>Lingua</th><th>Iscritto</th><th>Stato</th><th></th></tr>
${d.rows.map(r => `<tr><td>${r.boss ? '' : `<input class=pick type=checkbox form=bulk name=id value=${r.id}>`}</td><td>${h(r.email)}${r.ref ? ` <span class=muted>· da ${h(r.ref)}</span>` : ''}</td><td>${h(r.lang)}</td><td>${day(r.created_at)}</td><td>${status(r)}</td>
<td style="white-space:nowrap">${r.boss ? '' : r.invited_at ? form('/admin/key', r.id, 'Rimanda la mail') + ' ' + form('/admin/revoke', r.id, 'Revoca', 'ghost') : form('/admin/key', r.id, 'Give alfa key') + ' ' + form('/admin/delete', r.id, 'Elimina', 'ghost')}</td></tr>`).join('')}
</table><p><button form=bulk>Give alfa key ai selezionati</button></p></div>
<form method=post action=/admin/logout><button class=ghost>Esci</button></form></main>`;
}
