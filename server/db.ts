// Database: PostgreSQL in produzione (DATABASE_URL, es. Railway), PGlite su disco in locale.
// Espone solo query(sql, params) → righe: il resto del server non sa quale dei due sta usando.
import pg from 'pg';

export type Db = { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>; close(): Promise<void> };

export async function openDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  let db: Db;
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 10, ssl: /localhost|127\.0\.0\.1|\.railway\.internal/.test(url) ? undefined : { rejectUnauthorized: false } });
    db = { query: async (sql, params) => (await pool.query(sql, params as unknown[])).rows, close: () => pool.end() };
  } else {
    if (process.env.NODE_ENV === 'production') console.warn('ATTENZIONE: DATABASE_URL non impostata, uso un database locale (i dati si perdono a ogni deploy). Aggiungi Postgres su Railway.');
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
];
async function migrate(db: Db) { for (const m of MIGRATIONS) await db.query(m); }
