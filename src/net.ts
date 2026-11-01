// Collegamento al server di gioco: stato autorevole, azioni, notizie dal mondo. Si riconnette da solo.
import { createContext, useContext } from 'react';
import { rates, type Action, type GameState, type MissionKind, type Squad } from './engine/engine';
import type { Msg } from './i18n';

export type Me = {
  id: number; name: string;
  lord: { id: number; name: string } | null; vassals: { id: number; name: string }[];
  incoming: { key: string; from: string; to: string; by: number; byName: string; kind: MissionKind; arriveAt: number; att: number; units?: Squad }[];
  shieldUntil: number; newbieUntil: number; independenceAt: number | null; ransomAt: number | null; ransomCost: number | null; tribute: number; now: number;
};
export type RankRow = { id: number; name: string; avatar?: string; capital: string; cities: number; score: number; lord: number | null; vassals: number[] };
export type WorldInfo = { now: number; startedAt: number; owners: Record<string, number>; names: Record<number, string>; ranking: RankRow[]; players: number; online: number };
export type Result = { ok: boolean; msg?: string; m?: Msg };
type ServerAction = { t: 'avatar'; id: string } | { t: 'introSeen' } | { t: 'seen'; ids: number[] } | { t: 'ransom' } | { t: 'look'; city: string };

export class Net {
  state: GameState | null = null;
  me: Me | null = null;
  world: WorldInfo | null = null;
  status: 'connecting' | 'online' | 'offline' = 'connecting';
  error: 'auth' | 'name' | null = null;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private waiting = new Map<number, (r: Result) => void>();
  private listeners = new Set<() => void>();
  private retry = 0;
  private flow: { at: number; dirty: number; clean: number } | null = null;

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws; this.status = 'connecting'; this.emit();
    ws.onopen = () => { this.retry = 0; };
    ws.onmessage = ev => this.onMessage(JSON.parse(ev.data as string));
    ws.onclose = ev => {
      this.status = 'offline'; this.emit();
      for (const done of this.waiting.values()) done({ ok: false, msg: 'Connessione persa.', m: { k: 'Connessione persa.' } });
      this.waiting.clear();
      if (ev.code === 4001 || ev.code === 4002) return;
      const wait = Math.min(15000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
  }
  private onMessage(m: { type: string; [k: string]: unknown }) {
    if (m.type === 'state') {
      this.state = m.state as GameState; this.me = m.me as Me; this.status = 'online';
      const r = rates(this.state);
      this.flow = { at: performance.now(), dirty: r.dirty - r.upkeepSporco - r.laundering, clean: r.clean + r.laundering * (1 - r.launderFee) - r.upkeepPulito };
    } else if (m.type === 'world') this.world = m as unknown as WorldInfo;
    else if (m.type === 'result') { const done = this.waiting.get(m.id as number); this.waiting.delete(m.id as number); done?.(m as unknown as Result); }
    else if (m.type === 'error') this.error = m.code as 'auth' | 'name';
    this.emit();
  }
  /** Tra un aggiornamento e l'altro l'orologio e il contante scorrono in locale, senza simulare eventi. */
  interpolate(dt: number) {
    const s = this.state; if (!s || !this.flow || s.vacation) return;
    s.time += dt;
    s.res.sporco = Math.max(0, s.res.sporco + this.flow.dirty * dt / 3600);
    s.res.pulito = Math.max(0, s.res.pulito + this.flow.clean * dt / 3600);
  }
  act(a: Action | ServerAction): Promise<Result> {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return Promise.resolve({ ok: false, msg: 'Non sei collegato al server.', m: { k: 'Non sei collegato al server.' } });
    const id = this.nextId++;
    return new Promise(done => { this.waiting.set(id, done); ws.send(JSON.stringify({ type: 'act', id, action: a })); });
  }
  on(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { for (const fn of this.listeners) fn(); }
  /** Nome del giocatore che possiede una città (null = nessuno o io). */
  ownerName(city: string): string | null {
    const o = this.world?.owners[city]; if (o === undefined || o === this.me?.id) return null;
    return this.world?.names[o] ?? null;
  }
}

export const NetContext = createContext<Net | null>(null);
export const useNet = () => useContext(NetContext);

// ---------------------------------------------------------------- API degli account
export async function api<T = { ok: boolean; msg?: string }>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try { return await r.json() as T; } catch { return { ok: false, msg: `Errore ${r.status}` } as T; }
}
/** C'è un server dietro questa pagina? (no nell'anteprima del prototipo: lì si gioca in locale). */
export async function serverAvailable(): Promise<{ google: boolean; facebook: boolean; email: boolean } | null> {
  if (location.protocol === 'file:') return null;
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch('/api/auth/providers', { signal: ctl.signal }); clearTimeout(tm);
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    return await r.json();
  } catch { return null; }
}
