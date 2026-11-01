// Account: email + password, Google, Facebook. Sessioni con cookie httpOnly, recupero password via email.
// Google e Facebook si attivano solo se ci sono le variabili d'ambiente con le credenziali dell'app.
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db';
import { alphaClosed, botGuard, consumeInvite, emailProblem, inviteValid, keyForEmail } from './alpha';

export type User = { id: number; email: string | null; name: string | null; player_id: number | null; lang: string | null; google_id: string | null; facebook_id: string | null };

const SESSION_DAYS = 30;
const COOKIE = 'rk_session';
const env = (k: string) => process.env[k]?.trim() || undefined;
export const providers = () => ({
  google: !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')),
  facebook: !!(env('FACEBOOK_APP_ID') && env('FACEBOOK_APP_SECRET')),
  email: !!env('RESEND_API_KEY'),
  alpha: alphaClosed(),
  turnstile: env('TURNSTILE_SITE_KEY') ?? null,
});
const baseUrl = (req: FastifyRequest) => env('PUBLIC_URL') ?? (env('RAILWAY_PUBLIC_DOMAIN') ? `https://${env('RAILWAY_PUBLIC_DOMAIN')}` : env('RENDER_EXTERNAL_URL') ?? `${req.protocol}://${req.headers.host}`);
const token = () => randomBytes(32).toString('base64url');
const secure = () => process.env.NODE_ENV === 'production';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
/** Nome del boss: 3–20 caratteri, lettere (anche accentate), numeri, spazi, punto, trattino, apostrofo. */
export const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .'\-]{1,18}[\p{L}\p{N}.]$/u;
const BAD_NAME = /admin|moderat|staff|anthropic|racket ?king|sistema|system/i;

export class Auth {
  constructor(private db: Db) {}

  async userBySession(tok: string | undefined): Promise<User | null> {
    if (!tok) return null;
    const r = await this.db.query<User>(`select u.id, u.email, u.name, u.player_id, u.lang, u.google_id, u.facebook_id from sessions s join users u on u.id = s.user_id where s.token = $1 and s.expires_at > now()`, [tok]);
    return r[0] ?? null;
  }
  async userById(id: number) { return (await this.db.query<User>(`select id, email, name, player_id, lang, google_id, facebook_id from users where id = $1`, [id]))[0] ?? null; }
  private async startSession(reply: FastifyReply, userId: number) {
    const t = token();
    await this.db.query(`insert into sessions (token, user_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`, [t, userId]);
    await this.db.query(`update users set last_login = now() where id = $1`, [userId]);
    reply.setCookie(COOKIE, t, { path: '/', httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: SESSION_DAYS * 86400 });
  }
  async nameTaken(name: string, exceptUser?: number) {
    const r = await this.db.query(`select 1 from users where lower(name) = lower($1) and id <> $2`, [name, exceptUser ?? 0]);
    return r.length > 0;
  }
  validName(name: unknown): string | null {
    if (typeof name !== 'string') return 'Scegli un nome.';
    const n = name.trim().replace(/\s+/g, ' ');
    if (!NAME_RE.test(n)) return 'Il nome deve avere da 3 a 20 caratteri: lettere, numeri, spazi.';
    if (BAD_NAME.test(n)) return 'Questo nome non è disponibile.';
    return null;
  }

  routes(app: FastifyInstance) {
    const fail = (reply: FastifyReply, code: number, msg: string) => reply.code(code).send({ ok: false, msg });

    app.get('/api/auth/providers', async () => providers());

    app.get('/api/auth/me', async req => {
      const u = await this.userBySession(req.cookies[COOKIE]);
      return u ? { ok: true, user: { id: u.id, email: u.email, name: u.name, playerId: u.player_id, lang: u.lang } } : { ok: false };
    });

    app.post('/api/auth/register', { config: { rateLimit: 'auth' } }, async (req, reply) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const guard = await botGuard(req, b, 'register', 10);
      if (guard === 'silenzio') return fail(reply, 400, 'Verifica antibot non riuscita: ricarica la pagina e riprova.');
      if (guard) return fail(reply, 400, guard);
      const email = String(b.email ?? '').trim().toLowerCase(); const password = String(b.password ?? ''); const name = String(b.name ?? '').trim().replace(/\s+/g, ' ');
      if (alphaClosed() && !(await inviteValid(this.db, b.invite, email))) return fail(reply, 403, 'Serve una alfa key valida per questa email.');
      if (!EMAIL_RE.test(email)) return fail(reply, 400, 'Email non valida.');
      const emailBad = await emailProblem(email); if (emailBad) return fail(reply, 400, emailBad);
      if (password.length < 8 || password.length > 200) return fail(reply, 400, 'La password deve avere almeno 8 caratteri.');
      const bad = this.validName(name); if (bad) return fail(reply, 400, bad);
      if ((await this.db.query(`select 1 from users where email = $1`, [email])).length) return fail(reply, 409, 'Esiste già un account con questa email.');
      if (await this.nameTaken(name)) return fail(reply, 409, 'Questo nome è già preso da un altro boss.');
      const hash = await bcrypt.hash(password, 10);
      const r = await this.db.query<{ id: number }>(`insert into users (email, password_hash, name, lang) values ($1, $2, $3, $4) returning id`, [email, hash, name, b.lang === 'en' ? 'en' : 'it']);
      if (alphaClosed() && !(await consumeInvite(this.db, String(b.invite), r[0].id))) {
        await this.db.query(`delete from users where id = $1`, [r[0].id]);
        return fail(reply, 403, 'Serve una alfa key valida per questa email.');
      }
      await this.startSession(reply, r[0].id);
      return { ok: true };
    });

    app.post('/api/auth/login', { config: { rateLimit: 'auth' } }, async (req, reply) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const email = String(b.email ?? '').trim().toLowerCase(); const password = String(b.password ?? '');
      const r = await this.db.query<{ id: number; password_hash: string | null }>(`select id, password_hash from users where email = $1`, [email]);
      const u = r[0];
      if (!u || !u.password_hash || !(await bcrypt.compare(password, u.password_hash))) return fail(reply, 401, 'Email o password sbagliate.');
      await this.startSession(reply, u.id);
      return { ok: true };
    });

    app.post('/api/auth/logout', async (req, reply) => {
      const t = req.cookies[COOKIE]; if (t) await this.db.query(`delete from sessions where token = $1`, [t]);
      reply.clearCookie(COOKIE, { path: '/' });
      return { ok: true };
    });

    /** Chi entra con Google o Facebook sceglie il nome del boss al primo accesso. */
    app.post('/api/auth/name', async (req, reply) => {
      const u = await this.userBySession(req.cookies[COOKIE]); if (!u) return fail(reply, 401, 'Accedi prima.');
      if (u.name) return fail(reply, 400, 'Hai già un nome.');
      const name = String(((req.body ?? {}) as Record<string, unknown>).name ?? '').trim().replace(/\s+/g, ' ');
      const bad = this.validName(name); if (bad) return fail(reply, 400, bad);
      if (await this.nameTaken(name, u.id)) return fail(reply, 409, 'Questo nome è già preso da un altro boss.');
      await this.db.query(`update users set name = $1 where id = $2`, [name, u.id]);
      return { ok: true };
    });

    app.post('/api/auth/forgot', { config: { rateLimit: 'auth' } }, async (req, reply) => {
      const fb = (req.body ?? {}) as Record<string, unknown>;
      const guard = await botGuard(req, fb, 'forgot', 6);
      if (guard === 'silenzio') return { ok: true };
      if (guard) return fail(reply, 400, guard);
      const email = String(fb.email ?? '').trim().toLowerCase();
      const u = (await this.db.query<{ id: number }>(`select id from users where email = $1 and password_hash is not null`, [email]))[0];
      if (u) {
        const t = token();
        await this.db.query(`insert into resets (token, user_id, expires_at) values ($1, $2, now() + interval '1 hour')`, [t, u.id]);
        const link = `${baseUrl(req)}/?reset=${t}`;
        await sendMail(email, 'Racket King Online — nuova password', `Per scegliere una nuova password apri questo link entro un'ora:\n\n${link}\n\nSe non l'hai chiesto tu, ignora questa email.`);
      }
      return { ok: true }; // stessa risposta che l'email esista o no
    });

    app.post('/api/auth/reset', { config: { rateLimit: 'auth' } }, async (req, reply) => {
      const b = (req.body ?? {}) as Record<string, unknown>; const t = String(b.token ?? ''); const password = String(b.password ?? '');
      if (password.length < 8 || password.length > 200) return fail(reply, 400, 'La password deve avere almeno 8 caratteri.');
      const r = (await this.db.query<{ user_id: number }>(`delete from resets where token = $1 and expires_at > now() returning user_id`, [t]))[0];
      if (!r) return fail(reply, 400, 'Il link è scaduto o è già stato usato.');
      await this.db.query(`update users set password_hash = $1 where id = $2`, [await bcrypt.hash(password, 10), r.user_id]);
      await this.db.query(`delete from sessions where user_id = $1`, [r.user_id]);
      await this.startSession(reply, r.user_id);
      return { ok: true };
    });

    // ---------------------------------------------------------------- Google e Facebook (OAuth 2, flusso "authorization code")
    const oauth = (name: 'google' | 'facebook') => {
      app.get(`/api/auth/${name}`, async (req, reply) => {
        if (!providers()[name]) return reply.code(404).send('Accesso con ' + name + ' non configurato.');
        const state = token();
        const inv = (req.query as Record<string, string>).invito;
        if (inv && /^[\w-]{10,64}$/.test(inv)) reply.setCookie('rk_invite', inv, { path: '/', httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: 1800 });
        reply.setCookie('rk_oauth', state, { path: '/', httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: 600 });
        const redirect = `${baseUrl(req)}/api/auth/${name}/callback`;
        const url = name === 'google'
          ? `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID')!, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' })}`
          : `https://www.facebook.com/v19.0/dialog/oauth?${new URLSearchParams({ client_id: env('FACEBOOK_APP_ID')!, redirect_uri: redirect, response_type: 'code', scope: 'email,public_profile', state })}`;
        return reply.redirect(url);
      });
      app.get(`/api/auth/${name}/callback`, async (req, reply) => {
        const q = req.query as Record<string, string>;
        if (!q.code || !q.state || q.state !== req.cookies.rk_oauth) return reply.redirect('/?login=errore');
        reply.clearCookie('rk_oauth', { path: '/' });
        const redirect = `${baseUrl(req)}/api/auth/${name}/callback`;
        try {
          let ext: { id: string; email?: string };
          if (name === 'google') {
            const tok = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ code: q.code, client_id: env('GOOGLE_CLIENT_ID')!, client_secret: env('GOOGLE_CLIENT_SECRET')!, redirect_uri: redirect, grant_type: 'authorization_code' }) })).json() as { access_token?: string };
            if (!tok.access_token) throw new Error('token');
            const me = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tok.access_token}` } })).json() as { sub: string; email?: string; email_verified?: boolean };
            ext = { id: me.sub, email: me.email_verified ? me.email : undefined };
          } else {
            const tok = await (await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${new URLSearchParams({ client_id: env('FACEBOOK_APP_ID')!, client_secret: env('FACEBOOK_APP_SECRET')!, redirect_uri: redirect, code: q.code })}`)).json() as { access_token?: string };
            if (!tok.access_token) throw new Error('token');
            const me = await (await fetch(`https://graph.facebook.com/me?fields=id,email&access_token=${encodeURIComponent(tok.access_token)}`)).json() as { id: string; email?: string };
            ext = { id: me.id, email: me.email };
          }
          const col = name === 'google' ? 'google_id' : 'facebook_id';
          let u = (await this.db.query<{ id: number }>(`select id from users where ${col} = $1`, [ext.id]))[0];
          const email = ext.email?.toLowerCase();
          if (!u && email) {
            // stessa email di un account esistente: lo collega
            u = (await this.db.query<{ id: number }>(`update users set ${col} = $1 where email = $2 returning id`, [ext.id, email]))[0];
          }
          if (!u) {
            // closed alpha: entra chi ha una alfa key per la sua email (o un link di invito valido)
            const inv = (await keyForEmail(this.db, email)) ?? req.cookies.rk_invite;
            if (alphaClosed() && !(await inviteValid(this.db, inv, email))) return reply.redirect('/?login=invito');
            u = (await this.db.query<{ id: number }>(`insert into users (email, ${col}) values ($1, $2) returning id`, [email ?? null, ext.id]))[0];
            if (alphaClosed() && !(await consumeInvite(this.db, String(inv), u.id))) { await this.db.query(`delete from users where id = $1`, [u.id]); return reply.redirect('/?login=invito'); }
            reply.clearCookie('rk_invite', { path: '/' });
          }
          await this.startSession(reply, u.id);
          return reply.redirect('/');
        } catch (e) {
          req.log.warn({ err: e }, 'oauth fallito');
          return reply.redirect('/?login=errore');
        }
      });
    };
    oauth('google'); oauth('facebook');
  }
  cookieName() { return COOKIE; }
}

/** Email transazionali con Resend (https://resend.com). Senza chiave, il messaggio finisce nel log del server. */
export async function sendMail(to: string, subject: string, text: string) {
  const key = env('RESEND_API_KEY');
  if (!key) { console.log(`[email non configurata] a ${to}: ${subject}\n${text}`); return; }
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env('MAIL_FROM') ?? 'Racket King Online <noreply@example.com>', to, subject, text }) });
  if (!r.ok) console.warn('invio email fallito', r.status, await r.text());
}
