// Database: PostgreSQL in produzione (DATABASE_URL, es. Railway), PGlite su disco in locale.
// Espone solo query(sql, params) → righe: il resto del server non sa quale dei due sta usando.
import pg from 'pg';

export type Db = { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>; close(): Promise<void> };

export async function openDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  let db: Db;
  if (url) {
    // Con o senza SSL a seconda del fornitore: si prova prima senza (reti interne di Render e Railway), poi con.
    const make = (ssl: boolean) => new pg.Pool({ connectionString: url, max: 10, ssl: ssl ? { rejectUnauthorized: false } : undefined, connectionTimeoutMillis: 15000 });
    const wantSsl = /sslmode=require/.test(url) || process.env.PGSSL === '1';
    // il database può essere ancora in avvio (succede al primo deploy): si riprova per un paio di minuti
    let pool = make(wantSsl); let ssl = wantSsl;
    for (let attempt = 1; ; attempt++) {
      try { await pool.query('select 1'); break; }
      catch (e) {
        const msg = (e as Error).message;
        await pool.end().catch(() => {});
        if (/ssl|encryption|pg_hba/i.test(msg)) { ssl = !ssl; console.warn(`database: ${msg} → riprovo ${ssl ? 'con' : 'senza'} SSL`); }
        else if (attempt >= 24) throw e;
        else { console.warn(`database non ancora raggiungibile (${msg}), tentativo ${attempt}/24 tra 5 secondi`); await new Promise(r => setTimeout(r, 5000)); }
        pool = make(ssl);
      }
    }
    console.log('database: PostgreSQL collegato');
    db = { query: async (sql, params) => (await pool.query(sql, params as unknown[])).rows, close: () => pool.end() };
  } else {
    if (process.env.NODE_ENV === 'production') console.warn('ATTENZIONE: DATABASE_URL non impostata, uso un database locale (i dati si perdono a ogni deploy). Collega un database PostgreSQL (DATABASE_URL).');
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR ?? './data/pglite';
    if (dir !== 'memory') (await import('node:fs')).mkdirSync(dir, { recursive: true });
    const lite = dir === 'memory' ? new PGlite() : new PGlite(dir);
    db = { query: async (sql, params) => (await lite.query(sql, params as unknown[])).rows as never, close: () => lite.close() };
  }
  await migrate(db);
  return db;
}

const MIGRATIONS = [
  `create table if not exists users (
     id serial primary key,
     email text unique,
     password_hash text,
     name text unique,
     google_id text unique,
     facebook_id text unique,
     player_id integer unique,
     lang text default 'it',
     created_at timestamptz not null default now(),
     last_login timestamptz
   )`,
  `create table if not exists sessions (token text primary key, user_id integer not null references users(id) on delete cascade, expires_at timestamptz not null)`,
  `create table if not exists resets (token text primary key, user_id integer not null references users(id) on delete cascade, expires_at timestamptz not null)`,
  `create table if not exists world (id integer primary key, meta jsonb not null, updated_at timestamptz not null default now())`,
  `create table if not exists slots (id integer primary key, data jsonb not null, updated_at timestamptz not null default now())`,
  `create index if not exists sessions_user on sessions(user_id)`,
  `create table if not exists invites (
     token text primary key,
     note text,
     max_uses integer not null default 1,
     uses integer not null default 0,
     created_at timestamptz not null default now(),
     expires_at timestamptz,
     revoked boolean not null default false
   )`,
  `create table if not exists invite_uses (token text not null references invites(token) on delete cascade, user_id integer not null references users(id) on delete cascade, used_at timestamptz not null default now())`,
  `create table if not exists waitlist (
     id serial primary key,
     email text not null unique,
     lang text,
     ref text,
     ip_hash text,
     user_agent text,
     created_at timestamptz not null default now(),
     confirm_token text unique,
     confirmed_at timestamptz,
     invite_token text,
     invited_at timestamptz
   )`,
  `alter table users add column if not exists invite_token text`,
  `alter table invites add column if not exists email text`,
];
async function migrate(db: Db) { for (const m of MIGRATIONS) await db.query(m); }
