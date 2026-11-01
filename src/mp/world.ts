// Il mondo multiplayer: tanti giocatori sullo stesso server, ognuno con il proprio stato del motore.
// Le città degli altri giocatori gli appaiono come "proxy" (difese, edifici, contante esposto del proprietario).
// Periodicamente sync() riporta sui proprietari veri quello che i rivali hanno fatto alle loro città:
// perdite, bottini, chiusure, città perse, sottomissioni (vassallaggio), tributi, indipendenza.
// Stesse regole del playtest multiplayer (scripts/mp.ts), qui in forma riusabile e serializzabile per il server.
import {
  act as engineAct, autoDefend, migrate, newGame, owned, peekCity, power, rates, exposed, report, tick, log,
  type Action, type GameState, type MissionKind, type Result, type Squad,
} from '../engine/engine';
import { M } from '../i18n';
import type { UnitId } from '../engine/data';
import { CITY_COUNT, cityRaw, searchCities } from '../engine/world';

const H = 3600, D = 86400;

export const RULES = {
  newbieDays: 5,          // protezione dei nuovi arrivati
  weakShare: 0.2,         // non si colpisce chi ha meno del 20% del tuo punteggio...
  inactiveDays: 7,        // ...salvo che sia inattivo da una settimana
  shieldHours: 72,        // dopo aver perso una città, 72 ore di tregua
  independenceDays: 30,   // vassallo per 30 giorni senza perdere città: torna libero
  ransomAfterDays: 7,     // il riscatto si può pagare solo dopo una settimana
  familyGuard: 0.25,      // il capo manda in difesa dei vassalli un quarto della difesa della sua capitale
  ransomBase: 150000,     // riscatto in pulito: base + una settimana del proprio reddito
  tribute: 0.15,          // quota del reddito sporco che un vassallo versa al suo capo
  citiesPerPlayer: 1.8,   // densità della regione di partenza
  minRegion: 300,
};

/** Com'era la città di un rivale l'ultima volta che l'abbiamo copiata: serve a capire cosa le è successo. */
export type Snap = { units: Squad; stash: number; closed: (number | undefined)[]; owner: number };
/** Un attacco di un altro giocatore in arrivo: solo per l'interfaccia della vittima. */
export type PvpIncoming = { key: string; from: string; to: string; by: number; byName: string; kind: MissionKind; arriveAt: number; att: number; units?: Squad };

export type Slot = {
  id: number; name: string;
  s: GameState;
  lord: number | null; vassals: number[]; allies: number[];
  shieldUntil: number; vassalSince: number; lastOnline: number; joinedAt: number;
  proxies: Record<string, Snap>;
  seen: string[];              // missioni già notificate (avvisi e rapporti per la vittima)
  incoming: PvpIncoming[];
  history: { t: number; what: string; city?: string; other?: number }[];
};

export type WorldMeta = { version: 1; startedAt: number; center: string; owner: Record<string, number>; nextId: number; lastSync: number };

export type PublicPlayer = { id: number; name: string; avatar?: string; capital: string; cities: number; score: number; lord: number | null; vassals: number[] };

const dist2 = (a: string, b: string) => { const x = cityRaw(Number(a)), y = cityRaw(Number(b)); return (x[3] - y[3]) ** 2 + (x[4] - y[4]) ** 2; };

export class World {
  meta: WorldMeta;
  slots = new Map<number, Slot>();
  owner = new Map<string, number>();
  private byDistance: string[] | null = null;
  private rateCache = new Map<number, { t: number; r: ReturnType<typeof rates>; exp: number }>();
  /** Chiamata quando lo stato di un giocatore cambia per mano del mondo (per salvarlo e avvisare il client). */
  onChange: (id: number) => void = () => {};
  /** Orologio reale in millisecondi (sostituibile nei test). */
  clock: () => number = () => Date.now();

  constructor(meta?: WorldMeta, slots: Slot[] = []) {
    if (!meta) {
      const tulsa = searchCities('Tulsa', 5).find(i => cityRaw(i)[0] === 'Tulsa') ?? searchCities('Tulsa')[0];
      meta = { version: 1, startedAt: Math.floor(Date.now() / 1000), center: String(tulsa), owner: {}, nextId: 1, lastSync: 0 };
    }
    this.meta = meta;
    for (const [c, o] of Object.entries(meta.owner)) this.owner.set(c, o);
    for (const sl of slots) this.slots.set(sl.id, sl);
  }

  /** Secondi di gioco dall'apertura del server (il tempo scorre 1:1 con quello reale). */
  now(realMs = this.clock()) { return Math.max(0, Math.floor(realMs / 1000) - this.meta.startedAt); }

  private region(): string[] {
    if (!this.byDistance) this.byDistance = Array.from({ length: CITY_COUNT }, (_, i) => String(i)).sort((a, b) => dist2(a, this.meta.center) - dist2(b, this.meta.center));
    const n = Math.max(RULES.minRegion, Math.ceil(this.slots.size * RULES.citiesPerPlayer * 1.2));
    return this.byDistance.slice(0, n).filter(id => cityRaw(Number(id))[5] >= 2000);
  }
  private setOwner(id: string, o: number | null) { if (o === null) { this.owner.delete(id); delete this.meta.owner[id]; } else { this.owner.set(id, o); this.meta.owner[id] = o; } }

  get(id: number) { const s = this.slots.get(id); if (!s) throw new Error('giocatore sconosciuto ' + id); return s; }
  friend(a: Slot, oi: number | undefined) { return oi !== undefined && (oi === a.id || oi === a.lord || a.vassals.includes(oi) || a.allies.includes(oi)); }
  score(sl: Slot) { return Math.floor(sl.s.stats.invested / 1000); }

  /** Perché questo giocatore non può colpire quella città (null = si può). */
  protectedFrom(att: Slot, vi: number | undefined): string | null {
    if (vi === undefined) return null;
    const v = this.slots.get(vi); if (!v) return null;
    const t = this.now();
    if (this.friend(att, vi)) return 'famiglia';
    if (v.s.vacation) return 'vacanza';
    if (t - v.joinedAt < RULES.newbieDays * D) return 'nuovo';
    if (v.shieldUntil > t) return 'tregua';
    if (this.score(v) < RULES.weakShare * this.score(att) && t - v.lastOnline < RULES.inactiveDays * D) return 'debole';
    return null;
  }

  // ---------------------------------------------------------------- ingresso
  join(name: string, avatar?: string, at?: string): Slot {
    const t = this.now(); const id = this.meta.nextId++;
    const region = this.region(); const free = region.filter(c => !this.owner.has(c));
    const rnd = Math.random;
    let start = at && !this.owner.has(at) ? at : free[Math.floor(rnd() * Math.min(free.length, Math.max(20, Math.floor(free.length * 0.8))))];
    if (!start) start = this.byDistance!.find(c => !this.owner.has(c) && cityRaw(Number(c))[5] >= 2000)!;
    const s = newGame((Date.now() + id * 104729) % 2147483647 | 0, start);
    s.time = t; const h = s.cities[start]; h.gang.nextAttackAt += t; h.since = t; for (const l of s.log) l.t = t;
    s.avatar = avatar;
    const sl: Slot = { id, name, s, lord: null, vassals: [], allies: [], shieldUntil: 0, vassalSince: 0, lastOnline: t, joinedAt: t, proxies: {}, seen: [], incoming: [], history: [{ t, what: 'entra', city: start }] };
    this.slots.set(id, sl); this.setOwner(start, id);
    return sl;
  }

  // ---------------------------------------------------------------- tempo
  /** Porta avanti lo stato di un giocatore fino all'ora del server. */
  advance(sl: Slot, to = this.now()) {
    if (sl.s.time < to) tick(sl.s, to - sl.s.time, 60);
    sl.incoming = sl.incoming.filter(x => x.arriveAt > sl.s.time - 60);
  }

  // ---------------------------------------------------------------- proxy
  private ownerInfo(oi: number) {
    const o = this.get(oi).s; let e = this.rateCache.get(oi);
    if (!e || e.t !== o.time) { e = { t: o.time, r: rates(o), exp: exposed(o) }; this.rateCache.set(oi, e); }
    return e;
  }
  /** Copia (o aggiorna) nella partita di sl la città di un altro giocatore. */
  refreshProxy(sl: Slot, id: string) {
    const oi = this.owner.get(id); if (oi === undefined || oi === sl.id) return;
    const ow = this.get(oi); const oc = ow.s.cities[id]; if (!oc) return;
    const s = sl.s;
    let c = s.cities[id];
    if (!c || c.owner === 'player') { c = peekCity(s, id); s.cities[id] = c; }
    for (const mine of owned(s)) if (mine.gang.incoming?.from === id) { mine.gang.incoming = null; mine.gang.nextAttackAt = s.time + 12 * H; }
    c.proxy = oi; c.owner = 'npc';
    c.lots = JSON.parse(JSON.stringify(oc.lots));
    const units: Squad = {};
    for (const u of ['picchiatori', 'soldati', 'enforcer', 'guardie', 'informatori', 'corrieri'] as UnitId[]) if (oc.units[u]) units[u] = oc.units[u];
    for (const [u, n] of Object.entries(oc.guards)) units[u as UnitId] = (units[u as UnitId] ?? 0) + (n ?? 0);
    const lord = ow.lord !== null ? this.slots.get(ow.lord) : undefined;
    if (lord && lord.s.cities[lord.s.capital]) units.guardie = (units.guardie ?? 0) + Math.floor(RULES.familyGuard * power(lord.s, lord.s.cities[lord.s.capital].units, 'def') / 4);
    const g = c.gang;
    g.name = ow.name; g.units = units; g.share = 1; g.mult = 1; g.nextAttackAt = 1e15; g.lastGrowAt = s.time; g.incoming = null;
    const info = this.ownerInfo(oi);
    const share = id === ow.s.capital ? Math.max(0.5, (info.r.cities[id]?.dirty ?? 0) / Math.max(1, info.r.dirty)) : (info.r.cities[id]?.dirty ?? 0) / Math.max(1, info.r.dirty);
    g.stash = Math.round(info.exp * share);
    c.heat = oc.heat;
    sl.proxies[id] = { units: { ...units }, stash: g.stash, closed: c.lots.map(l => l?.closedUntil), owner: oi };
  }
  private purgeCity(s: GameState, id: string) {
    delete s.cities[id];
    const home = s.cities[s.capital] ?? owned(s)[0];
    s.missions = s.missions.filter(m => {
      if (m.from === id && home) m.from = home.id;
      if (m.to !== id) return true;
      const back = s.cities[m.from] ?? home; if (back) for (const [u, n] of Object.entries(m.units)) if (n) back.units[u as UnitId] += n;
      return false;
    });
  }
  private dropProxy(sl: Slot, id: string) { delete sl.proxies[id]; const c = sl.s.cities[id]; if (c && c.proxy !== undefined) this.purgeCity(sl.s, id); }

  /** Prima di guardare o colpire una città: se è di un altro giocatore, la si vede com'è adesso. */
  look(sl: Slot, id: string) {
    const o = this.owner.get(id);
    if (o !== undefined && o !== sl.id && !this.protectedFrom(sl, o)) this.refreshProxy(sl, id);
    else if (sl.proxies[id] && (o === undefined || o === sl.id || this.protectedFrom(sl, o))) this.dropProxy(sl, id);
  }

  // ---------------------------------------------------------------- azioni dei giocatori
  act(sl: Slot, a: Action | ServerAction): Result {
    const t = this.now(); this.advance(sl, t); sl.lastOnline = t;
    switch (a.t) {
      case 'avatar': sl.s.avatar = a.id; return { ok: true };
      case 'introSeen': sl.s.introSeen = true; return { ok: true };
      case 'seen': for (const r of sl.s.reports) if (a.ids.includes(r.id)) r.seen = true; return { ok: true };
      case 'ransom': return this.ransom(sl);
      case 'look': this.look(sl, a.city); return { ok: true };
    }
    const target = a.t === 'mission' ? a.to : a.t === 'acquire' ? a.city : a.t === 'police' ? a.target : undefined;
    if (target) {
      const o = this.owner.get(target);
      if (o !== undefined && o !== sl.id) {
        if (this.friend(sl, o)) return { ok: false, msg: 'È una città della tua famiglia.', m: M('È una città della tua famiglia.') };
        const why = this.protectedFrom(sl, o);
        if (why) return { ok: false, msg: 'Quel giocatore è protetto.', m: M('{name} è protetto: {why}.', { name: this.get(o).name, why: M(WHY[why] ?? why) }) };
        if (a.t === 'acquire') return { ok: false, msg: 'Le città degli altri giocatori non si comprano.', m: M('Le città degli altri giocatori non si comprano.') };
        if (a.t === 'police' && a.id === 'soffiata') return { ok: false, msg: 'La polizia non tocca le famiglie degli altri boss.', m: M('La polizia non tocca le famiglie degli altri boss.') };
        this.refreshProxy(sl, target);
      }
    }
    const r = engineAct(sl.s, a);
    if (r.ok && a.t === 'mission' && a.kind !== 'transfer') this.notifyIncoming(sl);
    return r;
  }

  private ransom(sl: Slot): Result {
    if (sl.lord === null) return { ok: false, msg: 'Non hai un capo.', m: M('Non hai un capo.') };
    const t = this.now();
    if (t - sl.vassalSince < RULES.ransomAfterDays * D) return { ok: false, msg: 'Troppo presto.', m: M('Il riscatto si può pagare dopo {n} giorni.', { n: RULES.ransomAfterDays }) };
    const cost = this.ransomCost(sl);
    if (sl.s.res.pulito < cost) return { ok: false, msg: 'Non hai abbastanza contante pulito.', m: M('Serve {m} di contante pulito.', { m: { money: cost } }) };
    sl.s.res.pulito -= cost;
    const lord = this.get(sl.lord); lord.s.res.pulito += cost;
    log(lord.s, 'warn', M('{name} ha pagato il riscatto ({m}) e non è più della tua famiglia.', { name: sl.name, m: { money: cost } }));
    this.onChange(lord.id);
    this.freeVassal(sl, 'riscatto');
    log(sl.s, 'good', M('Hai pagato il riscatto: sei di nuovo libero.'));
    return { ok: true };
  }
  ransomCost(sl: Slot) {
    const r = rates(sl.s); const lr = sl.lord !== null ? this.ownerInfo(sl.lord).r : null;
    return Math.round(RULES.ransomBase + 168 * (r.dirty + r.clean) + (lr ? 0.25 * 168 * (lr.dirty + lr.clean) : 0));
  }

  /** Avvisa le vittime delle missioni appena partite contro di loro (e fa reclutare chi ha la postura difensiva). */
  private notifyIncoming(sl: Slot) {
    for (const m of sl.s.missions) {
      if (m.resolved || !(m.kind === 'assault' || m.kind === 'raid' || m.kind === 'strike' || m.kind === 'spy')) continue;
      const snap = sl.proxies[m.to]; if (!snap) continue;
      const key = `${sl.id}:${m.id}`; const v = this.slots.get(snap.owner); if (!v || v.seen.includes('in:' + key)) continue;
      v.seen.push('in:' + key); if (v.seen.length > 400) v.seen.splice(0, v.seen.length - 400);
      const vc = v.s.cities[m.to]; if (!vc || vc.owner !== 'player') continue;
      this.advance(v);
      if (m.kind === 'spy') continue; // le spie non si vedono arrivare
      const att = power(sl.s, m.units, 'att');
      const eyes = vc.units.informatori > 0;
      v.incoming.push({ key, from: m.from, to: m.to, by: sl.id, byName: sl.name, kind: m.kind, arriveAt: m.arriveAt, att: eyes ? Math.round(att) : 0, units: eyes ? { ...m.units } : undefined });
      log(v.s, 'bad', M('{name} sta mandando i suoi uomini contro {city}: arrivano tra {min} minuti.', { name: sl.name, city: cityName(m.to), min: Math.max(1, Math.round((m.arriveAt - v.s.time) / 60)) }), m.to);
      autoDefend(v.s, vc, att, m.kind === 'strike' ? 'sabotaggio' : 'razzia');
      this.onChange(v.id);
    }
  }

  // ---------------------------------------------------------------- vassallaggio
  private becomeVassal(sl: Slot, by: Slot) {
    if (sl.lord !== null) { const old = this.slots.get(sl.lord); if (old) old.vassals = old.vassals.filter(x => x !== sl.id); }
    for (const a of sl.allies) { const x = this.slots.get(a); if (x) x.allies = x.allies.filter(y => y !== sl.id); }
    sl.allies = []; sl.lord = by.id; if (!by.vassals.includes(sl.id)) by.vassals.push(sl.id); sl.vassalSince = this.now();
    for (const v of by.vassals) if (v !== sl.id) { const x = this.slots.get(v); if (x) { if (!x.allies.includes(sl.id)) x.allies.push(sl.id); sl.allies.push(v); } }
    sl.history.push({ t: this.now(), what: 'vassallo', other: by.id });
    log(sl.s, 'bad', M('Sei entrato nella famiglia di {name}: gli versi il {pct}% della rendita sporca. Tra {d} giorni senza perdere città tornerai libero, oppure paga il riscatto.', { name: by.name, pct: RULES.tribute * 100, d: RULES.independenceDays }));
    log(by.s, 'good', M('{name} ora è della tua famiglia: ti versa il {pct}% della sua rendita sporca.', { name: sl.name, pct: RULES.tribute * 100 }));
  }
  private freeVassal(sl: Slot, why: string) {
    if (sl.lord === null) return;
    const lord = this.slots.get(sl.lord); if (lord) lord.vassals = lord.vassals.filter(x => x !== sl.id);
    for (const a of sl.allies) { const x = this.slots.get(a); if (x) x.allies = x.allies.filter(y => y !== sl.id); }
    sl.allies = []; sl.lord = null; sl.history.push({ t: this.now(), what: 'libero:' + why });
    if (why !== 'riscatto') log(sl.s, 'good', M('Sei di nuovo libero: niente più tributi.'));
  }
  private freeCityNear(x: number, y: number): string | undefined {
    const free = this.region().filter(id => !this.owner.has(id));
    const pool = free.map(id => { const r = cityRaw(Number(id)); return { id, d: Math.hypot(r[3] - x, r[4] - y) }; }).sort((a, b) => a.d - b.d).slice(0, 8);
    return pool[Math.floor(Math.random() * pool.length)]?.id ?? free[0];
  }
  private loseCity(victim: Slot, id: string, by: Slot) {
    const s = victim.s; const c = s.cities[id]; if (!c) return;
    const t = this.now();
    victim.shieldUntil = t + RULES.shieldHours * H; victim.vassalSince = t;
    if (s.mayor?.city === id) s.mayor = null;
    victim.history.push({ t, what: 'perde', city: id, other: by.id });
    report(s, { kind: 'defense', city: id, title: M('{city} è caduta: ora è di {name}', { city: cityName(id), name: by.name }), win: false, att: 0, def: 0, defMen: 0, defFort: 0, lostMine: 0, lostTheirs: 0, loot: 0,
      lines: [M('Gli uomini di {name} hanno preso il tuo quartier generale a {city}.', { name: by.name, city: cityName(id) })], advice: M('Hai {h} ore di tregua: nessun giocatore può attaccarti. Usale per rinforzare le difese delle altre città.', { h: RULES.shieldHours }) });
    const left = owned(s).filter(x => x.id !== id);
    if (left.length) {
      if (s.capital === id) s.capital = left.sort((a, b) => b.lots.filter(Boolean).length - a.lots.filter(Boolean).length)[0].id;
    } else {
      this.becomeVassal(victim, by);
      const cap = cityRaw(Number(by.s.capital));
      const nid = this.freeCityNear(cap[3], cap[4]);
      if (nid) {
        const ns = newGame((Date.now() + victim.id * 31) % 2147483647 | 0, nid);
        const home = ns.cities[nid]; home.gang.nextAttackAt = t + 24 * H; home.since = t;
        s.cities[nid] = home; s.capital = nid; this.setOwner(nid, victim.id);
        log(s, 'info', M('Ricominci da {city}, vicino al tuo nuovo capo.', { city: cityName(nid) }), nid);
      }
    }
    this.purgeCity(s, id);
    this.onChange(victim.id);
  }

  // ---------------------------------------------------------------- sync
  /** Da chiamare spesso (es. ogni 30 secondi): porta tutti all'ora del server e riporta gli effetti degli scontri. */
  sync() {
    const t = this.now(); const dt = Math.max(0, t - (this.meta.lastSync || t)); this.meta.lastSync = t;
    for (const sl of this.slots.values()) this.advance(sl, t);
    this.rateCache.clear();
    // 1) conquiste e conflitti
    for (const sl of this.slots.values()) {
      const s = sl.s;
      for (const c of owned(s)) {
        const was = this.owner.get(c.id);
        if (was === sl.id) continue;
        if (was === undefined) {
          delete sl.proxies[c.id]; if (c.proxy !== undefined) delete c.proxy;
          this.setOwner(c.id, sl.id); sl.history.push({ t, what: 'conquista', city: c.id });
          continue;
        }
        const snap = sl.proxies[c.id]; const v = this.slots.get(was);
        if (snap && snap.owner === was && v && !this.friend(sl, was) && v.s.capital === c.id) {
          // capitale presa: non si conquista, si sottomette. Il rivale tiene la città e diventa vassallo.
          const back = owned(s).find(x => x.id !== c.id && this.owner.get(x.id) === sl.id);
          if (back) for (const [u, n] of Object.entries(c.units)) if (n) back.units[u as UnitId] += n;
          this.purgeCity(s, c.id); delete sl.proxies[c.id];
          v.shieldUntil = t + RULES.shieldHours * H; v.vassalSince = t;
          if (v.lord !== sl.id) this.becomeVassal(v, sl);
          report(v.s, { kind: 'defense', city: c.id, title: M('{name} ha preso il tuo QG a {city}', { name: sl.name, city: cityName(c.id) }), win: false, att: 0, def: 0, defMen: 0, defFort: 0, lostMine: 0, lostTheirs: 0, loot: 0,
            lines: [M('La capitale non si perde: resta tua, ma da oggi sei nella famiglia di {name}.', { name: sl.name })], advice: M('Tra {d} giorni senza perdere città torni libero, oppure paga il riscatto dalla Panoramica.', { d: RULES.independenceDays }) });
          log(s, 'good', M('Hai preso il QG di {name} a {city}: la sua famiglia ora risponde a te.', { name: v.name, city: cityName(c.id) }));
          sl.history.push({ t, what: 'sottomette', other: was }); v.history.push({ t, what: 'sottomesso', other: sl.id });
          this.onChange(v.id); this.onChange(sl.id);
        } else if (snap && snap.owner === was && v && !this.friend(sl, was)) {
          delete c.proxy; delete sl.proxies[c.id];
          this.setOwner(c.id, sl.id); sl.history.push({ t, what: 'conquistaPvp', city: c.id, other: was });
          this.loseCity(v, c.id, sl); this.onChange(sl.id);
        } else {
          const back = owned(s).find(x => x.id !== c.id && this.owner.get(x.id) === sl.id);
          if (back) for (const [u, n] of Object.entries(c.units)) if (n) back.units[u as UnitId] += n;
          if (s.capital === c.id && back) s.capital = back.id;
          this.purgeCity(s, c.id);
          log(s, 'warn', M('Qualcun altro ha preso {city} prima di te: i tuoi uomini sono tornati a casa.', { city: cityName(c.id) }));
          this.onChange(sl.id);
        }
      }
    }
    // 2) danni sulle città dei rivali, con il rapporto per chi li subisce
    for (const sl of this.slots.values()) {
      const s = sl.s;
      for (const [id, snap] of Object.entries(sl.proxies)) {
        const c = s.cities[id]; const v = this.slots.get(snap.owner);
        if (!c || c.proxy === undefined || !v || this.owner.get(id) !== snap.owner) continue;
        const vc = v.s.cities[id]; if (!vc) continue;
        let lostMen = 0;
        for (const [u, n0] of Object.entries(snap.units)) {
          const d = (n0 ?? 0) - (c.gang.units[u as UnitId] ?? 0); if (d <= 0) continue;
          let left = d; const g = Math.min(vc.guards[u as UnitId] ?? 0, left); if (g) { vc.guards[u as UnitId] = (vc.guards[u as UnitId] ?? 0) - g; left -= g; }
          const k = Math.min(vc.units[u as UnitId], left); vc.units[u as UnitId] -= k; lostMen += k + g;
        }
        let loot = 0; const lootWant = Math.max(0, snap.stash - c.gang.stash);
        if (lootWant > 1) { loot = Math.min(v.s.res.sporco, lootWant); v.s.res.sporco -= loot; }
        let closed = 0;
        c.lots.forEach((l, i) => { if (l?.closedUntil && !snap.closed[i] && vc.lots[i]) { vc.lots[i]!.closedUntil = l.closedUntil; vc.lots[i]!.protectedUntil = l.protectedUntil; closed++; } });
        // una missione appena risolta contro questa città: rapporto per la vittima
        for (const m of s.missions) {
          if (!m.resolved || m.to !== id) continue;
          const key = 'res:' + sl.id + ':' + m.id; if (v.seen.includes(key)) continue; v.seen.push(key);
          const ar = s.reports.find(r => r.city === id && Math.abs(r.t - m.arriveAt) <= 120 && r.kind !== 'defense');
          v.incoming = v.incoming.filter(x => x.key !== `${sl.id}:${m.id}`);
          if (m.kind === 'spy') {
            if (ar && !ar.win) report(v.s, { kind: 'spy', city: id, title: M('Hai scoperto le spie di {name} a {city}', { name: sl.name, city: cityName(id) }), win: true, att: 0, def: 0, defMen: 0, defFort: 0, lostMine: 0, lostTheirs: ar.lostMine, loot: 0, lines: [M('I tuoi uomini hanno beccato i suoi informatori.')], advice: M('Ti sta studiando: prepara le difese.') });
            continue;
          }
          const won = ar ? !ar.win : lostMen === 0 && loot === 0 && closed === 0;
          const lines = [
            M('Attacco di {name} da {from}.', { name: sl.name, from: cityName(m.from) }),
            ...(lostMen ? [M('Hai perso {n} uomini.', { n: lostMen })] : []),
            ...(ar ? [M('Loro hanno perso {n} uomini.', { n: ar.lostMine })] : []),
            ...(loot ? [M('Ti hanno portato via {m} di contante sporco.', { m: { money: Math.round(loot) } })] : []),
            ...(closed ? [M('Edifici chiusi dal colpo: {n}.', { n: closed })] : []),
          ];
          report(v.s, { kind: m.kind === 'strike' ? 'sabotage' : 'defense', city: id, title: won ? M('Hai respinto {name} a {city}', { name: sl.name, city: cityName(id) }) : M('{name} ti ha colpito a {city}', { name: sl.name, city: cityName(id) }),
            win: won, att: ar?.att ?? 0, def: ar?.def ?? 0, defMen: ar?.defMen ?? 0, defFort: ar?.defFort ?? 0, lostMine: lostMen, lostTheirs: ar?.lostMine ?? 0, loot: Math.round(loot),
            lines, advice: won ? M('Le difese hanno tenuto.') : M('Più uomini a guardia, contante nelle casseforti, informatori per vederli arrivare.') });
        }
        if (v.seen.length > 400) v.seen.splice(0, v.seen.length - 400);
        if (lostMen || loot || closed) this.onChange(v.id);
      }
    }
    // 3) tributi dei vassalli e indipendenza
    for (const sl of this.slots.values()) {
      if (sl.lord === null) continue; const lord = this.slots.get(sl.lord); if (!lord) { sl.lord = null; continue; }
      const tr = Math.min(sl.s.res.sporco, rates(sl.s).dirty * RULES.tribute * dt / 3600);
      sl.s.res.sporco -= tr; lord.s.res.sporco += tr;
      if (t - sl.vassalSince >= RULES.independenceDays * D) this.freeVassal(sl, `${RULES.independenceDays} giorni`);
    }
    // 4) le città dei rivali che conosciamo, aggiornate (e le città neutrali conquistate da altri diventano proxy)
    for (const sl of this.slots.values()) {
      for (const id of Object.keys(sl.proxies)) { const o = this.owner.get(id); if (o === undefined || o === sl.id || this.protectedFrom(sl, o)) this.dropProxy(sl, id); else this.refreshProxy(sl, id); }
      for (const c of Object.values(sl.s.cities)) if (c.owner === 'npc' && c.proxy === undefined) { const o = this.owner.get(c.id); if (o !== undefined && o !== sl.id) { if (this.protectedFrom(sl, o)) this.purgeCity(sl.s, c.id); else this.refreshProxy(sl, c.id); } }
    }
  }

  // ---------------------------------------------------------------- amministrazione
  /** Sposta la capitale di un giocatore in un'altra città libera: edifici, uomini e influenza vengono con lui. */
  relocate(sl: Slot, to: string): string | null {
    if (this.owner.has(to)) return 'Quella città è già di un giocatore.';
    const s = sl.s; const from = s.capital; const old = s.cities[from]; if (!old) return 'Il giocatore non ha una capitale.';
    if (s.cities[to]?.proxy !== undefined) this.dropProxy(sl, to);
    const fresh = newGame((Date.now() + sl.id * 7919) % 2147483647 | 0, to).cities[to];
    fresh.lots = fresh.lots.map(() => null);
    const keep = old.lots.filter(Boolean);
    let i = 0; for (const l of keep) { while (i < fresh.lots.length && fresh.lots[i]) i++; if (i >= fresh.lots.length) break; fresh.lots[i++] = { ...l! }; }
    for (const [u, n] of Object.entries(old.units)) fresh.units[u as UnitId] = n;
    for (const [u, n] of Object.entries(old.guards)) if (n) fresh.units[u as UnitId] += n;
    fresh.guards = {}; fresh.influence = old.influence; fresh.payroll = old.payroll; fresh.heat = 0; fresh.heatSpike = 0;
    fresh.unitQueue = old.unitQueue; fresh.buildQueue = old.buildQueue && old.buildQueue.lot < fresh.lots.length && !fresh.lots[old.buildQueue.lot] ? old.buildQueue : null;
    fresh.since = old.since; fresh.gang.nextAttackAt = old.gang.nextAttackAt; fresh.turf = {}; fresh.protect = {}; fresh.tileWarn = {};
    delete s.cities[from]; delete s.cities[to];
    s.cities[to] = fresh; s.capital = to;
    if (s.mayor?.city === from) s.mayor = null;
    for (const m of s.missions) { if (m.from === from) m.from = to; }
    s.missions = s.missions.filter(m => m.to !== from || m.kind === 'transfer');
    for (const m of s.missions) if (m.to === from) m.to = to;
    this.setOwner(from, null); this.setOwner(to, sl.id);
    migrate(s);
    log(s, 'info', M('Ti sei trasferito a {city}: edifici, uomini e influenza sono venuti con te.', { city: cityName(to) }), to);
    sl.history.push({ t: this.now(), what: 'trasferito', city: to });
    this.onChange(sl.id);
    return null;
  }

  // ---------------------------------------------------------------- viste pubbliche
  publicPlayer(sl: Slot): PublicPlayer {
    return { id: sl.id, name: sl.name, avatar: sl.s.avatar, capital: sl.s.capital, cities: owned(sl.s).length, score: this.score(sl), lord: sl.lord, vassals: sl.vassals };
  }
  ranking(n = 100): PublicPlayer[] {
    return [...this.slots.values()].map(x => this.publicPlayer(x)).sort((a, b) => b.score - a.score || b.cities - a.cities).slice(0, n);
  }
  /** Chi possiede quali città (per la mappa): solo le città dei giocatori. */
  owners(): Record<string, number> { return { ...this.meta.owner }; }
}

export type ServerAction =
  | { t: 'avatar'; id: string }
  | { t: 'introSeen' }
  | { t: 'seen'; ids: number[] }
  | { t: 'ransom' }
  | { t: 'look'; city: string };

const WHY: Record<string, string> = { famiglia: 'è della tua famiglia', vacanza: 'è in vacanza', nuovo: 'è appena arrivato', tregua: 'ha appena perso una città', debole: 'è troppo debole per te' };
const cityName = (id: string) => cityRaw(Number(id))[0];
