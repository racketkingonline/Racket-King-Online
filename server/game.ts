// Il mondo che gira sul server: carica e salva i giocatori, li fa avanzare nel tempo, smista azioni e aggiornamenti.
import type { WebSocket } from 'ws';
import { World, RULES, type Slot, type WorldMeta } from '../src/mp/world';
import { migrate, owned } from '../src/engine/engine';
import type { Db } from './db';
import { cleanAction } from './validate';

const SYNC_MS = Number(process.env.SYNC_MS ?? 15000);
const SAVE_MS = Number(process.env.SAVE_MS ?? 30000);
const PUSH_MIN_MS = 1000;

type Conn = { ws: WebSocket; playerId: number; lastPush: number; pending: boolean; actions: number[] };

export class Game {
  world!: World;
  private conns = new Map<number, Set<Conn>>();
  private dirty = new Set<number>();
  private metaDirty = true;
  private timers: NodeJS.Timeout[] = [];
  private lastFullSave = 0;
  stats = { syncMs: 0, syncs: 0, saves: 0 };

  constructor(private db: Db) {}

  async load() {
    const meta = (await this.db.query<{ meta: WorldMeta }>(`select meta from world where id = 1`))[0]?.meta;
    const rows = await this.db.query<{ data: Slot }>(`select data from slots`);
    const slots = rows.map(r => { const sl = r.data; sl.s = migrate(sl.s); return sl; });
    this.world = new World(meta, slots);
    if (process.env.WORLD_START && !meta) this.world.meta.startedAt = Math.floor(Date.parse(process.env.WORLD_START) / 1000);
    this.world.onChange = id => { this.dirty.add(id); this.schedulePush(id); };
    // solo per i test: il tempo del mondo scorre TIME_SCALE volte più veloce
    const scale = Number(process.env.TIME_SCALE ?? 1);
    if (scale !== 1) { const r0 = Date.now(), w0 = this.world.now() * 1000 + this.world.meta.startedAt * 1000; this.world.clock = () => w0 + (Date.now() - r0) * scale; }
    if (!meta) await this.saveMeta();
    console.log(`mondo caricato: ${slots.length} giocatori, giorno ${Math.floor(this.world.now() / 86400) + 1}`);
  }

  start() {
    this.timers.push(setInterval(() => this.tick(), SYNC_MS));
    this.timers.push(setInterval(() => { void this.save(); }, SAVE_MS));
  }
  async stop() { for (const t of this.timers) clearInterval(t); await this.save(true); }

  private tick() {
    const t0 = performance.now();
    try { this.world.sync(); } catch (e) { console.error('sync fallita', e); }
    this.stats.syncMs = Math.round(performance.now() - t0); this.stats.syncs++;
    this.metaDirty = true;
    for (const id of this.conns.keys()) this.schedulePush(id);
  }

  async save(all = false) {
    const t = Date.now();
    const full = all || t - this.lastFullSave > 5 * 60_000;
    const ids = full ? [...this.world.slots.keys()] : [...this.dirty, ...this.conns.keys()];
    this.dirty.clear();
    if (full) this.lastFullSave = t;
    for (const id of new Set(ids)) {
      const sl = this.world.slots.get(id); if (!sl) continue;
      await this.db.query(`insert into slots (id, data, updated_at) values ($1, $2, now()) on conflict (id) do update set data = excluded.data, updated_at = now()`, [id, JSON.stringify(sl)]);
    }
    if (this.metaDirty || full) await this.saveMeta();
    this.stats.saves++;
  }
  private async saveMeta() {
    this.metaDirty = false;
    await this.db.query(`insert into world (id, meta, updated_at) values (1, $1, now()) on conflict (id) do update set meta = excluded.meta, updated_at = now()`, [JSON.stringify(this.world.meta)]);
  }

  /** Il giocatore di un utente; al primo ingresso nasce nel mondo. */
  async playerFor(user: { id: number; name: string | null; player_id: number | null }): Promise<Slot> {
    if (user.player_id && this.world.slots.has(user.player_id)) return this.world.get(user.player_id);
    const sl = this.world.join(user.name ?? `Boss ${user.id}`);
    await this.db.query(`update users set player_id = $1 where id = $2`, [sl.id, user.id]);
    this.dirty.add(sl.id); await this.save();
    return sl;
  }

  /** Modifica dall'amministrazione: porta il giocatore all'ora del server, applica, salva e avvisa il client. */
  edit(id: number, fn: (s: Slot['s']) => void) {
    const sl = this.world.get(id); this.world.advance(sl); fn(sl.s);
    this.dirty.add(id); this.schedulePush(id, true); void this.save();
  }

  // ---------------------------------------------------------------- connessioni
  attach(ws: WebSocket, playerId: number) {
    const c: Conn = { ws, playerId, lastPush: 0, pending: false, actions: [] };
    let set = this.conns.get(playerId); if (!set) this.conns.set(playerId, set = new Set());
    set.add(c);
    const sl = this.world.get(playerId); this.world.advance(sl); sl.lastOnline = this.world.now();
    this.send(c, this.worldMsg()); this.push(c);
    ws.on('message', data => this.onMessage(c, data.toString()));
    ws.on('close', () => { set!.delete(c); if (!set!.size) this.conns.delete(playerId); });
  }
  online() { return this.conns.size; }

  private onMessage(c: Conn, raw: string) {
    let msg: { type?: string; id?: number; action?: unknown };
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'ping') return this.send(c, { type: 'pong', now: this.world.now() });
    if (msg.type === 'world') return this.send(c, this.worldMsg());
    if (msg.type !== 'act') return;
    const now = Date.now(); c.actions = c.actions.filter(x => now - x < 10_000); c.actions.push(now);
    if (c.actions.length > 60) return this.send(c, { type: 'result', id: msg.id, ok: false, msg: 'Troppe azioni: rallenta.', m: { k: 'Troppe azioni: rallenta.' } });
    const a = cleanAction(msg.action);
    if (!a) return this.send(c, { type: 'result', id: msg.id, ok: false, msg: 'Azione non valida.', m: { k: 'Azione non valida.' } });
    const sl = this.world.get(c.playerId);
    let r;
    try { r = this.world.act(sl, a); } catch (e) { console.error('azione fallita', a, e); r = { ok: false as const, msg: 'Errore del server.', m: { k: 'Errore del server.' } }; }
    this.dirty.add(sl.id);
    this.send(c, { type: 'result', id: msg.id, ...r });
    this.schedulePush(sl.id, true);
  }

  private schedulePush(id: number, now = false) {
    const set = this.conns.get(id); if (!set) return;
    for (const c of set) {
      if (now) { this.push(c); continue; }
      if (c.pending) continue;
      const wait = Math.max(0, PUSH_MIN_MS - (Date.now() - c.lastPush));
      c.pending = true; setTimeout(() => { c.pending = false; this.push(c); }, wait);
    }
  }
  private push(c: Conn) {
    const sl = this.world.slots.get(c.playerId); if (!sl) return;
    this.world.advance(sl);
    c.lastPush = Date.now();
    this.send(c, { type: 'state', now: this.world.now(), state: sl.s, me: this.meView(sl) });
  }
  private meView(sl: Slot) {
    const w = this.world; const t = w.now();
    const lord = sl.lord !== null ? w.slots.get(sl.lord) : undefined;
    return {
      id: sl.id, name: sl.name,
      lord: lord ? { id: lord.id, name: lord.name } : null,
      vassals: sl.vassals.map(v => ({ id: v, name: w.slots.get(v)?.name ?? '?' })),
      incoming: sl.incoming,
      shieldUntil: sl.shieldUntil, newbieUntil: sl.joinedAt + RULES.newbieDays * 86400,
      independenceAt: lord ? sl.vassalSince + RULES.independenceDays * 86400 : null,
      ransomAt: lord ? sl.vassalSince + RULES.ransomAfterDays * 86400 : null,
      ransomCost: lord ? w.ransomCost(sl) : null,
      tribute: RULES.tribute, now: t,
    };
  }
  private worldMsg() {
    const w = this.world;
    const names: Record<number, string> = {}; for (const sl of w.slots.values()) names[sl.id] = sl.name;
    return { type: 'world', now: w.now(), startedAt: w.meta.startedAt, owners: w.owners(), names, ranking: w.ranking(100), players: w.slots.size, online: this.online() };
  }
  /** Classifica e proprietari ogni minuto a tutti. */
  broadcastWorld() { const m = this.worldMsg(); for (const set of this.conns.values()) for (const c of set) this.send(c, m); }
  private send(c: Conn, m: unknown) { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); }

  /** Per il pannello di stato del server. */
  health() {
    const w = this.world;
    return { ok: true, day: Math.floor(w.now() / 86400) + 1, players: w.slots.size, online: this.online(), cities: Object.keys(w.meta.owner).length,
      syncMs: this.stats.syncMs, syncs: this.stats.syncs, saves: this.stats.saves, active24h: [...w.slots.values()].filter(x => w.now() - x.lastOnline < 86400).length,
      biggest: Math.max(0, ...[...w.slots.values()].map(x => owned(x.s).length)), vassals: [...w.slots.values()].filter(x => x.lord !== null).length };
  }
}
