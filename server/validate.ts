// Controllo delle azioni che arrivano dai client: forma, tipi, intervalli e id ammessi.
// Il motore si fida dei suoi chiamanti; qui si scarta tutto quello che un client manomesso potrebbe inventare.
import { BUILDINGS, FRONTS, RACKETS, RESEARCH, UNITS } from '../src/engine/data';
import { CITY_COUNT } from '../src/engine/world';
import type { Action } from '../src/engine/engine';
import type { ServerAction } from '../src/mp/world';

const UNIT = new Set(UNITS.map(u => u.id as string));
const RACKET = new Set(RACKETS.map(r => r.id as string));
const RESEARCH_ID = new Set(RESEARCH.map(r => r.id as string));
const USE: Record<string, Set<string>> = { racket: RACKET, front: new Set(FRONTS.map(f => f.id as string)), building: new Set(BUILDINGS.map(b => b.id as string)) };
const MISSION = new Set(['raid', 'spy', 'assault', 'transfer', 'strike']);
const POLICE = new Set(['soffiata', 'occhio', 'bustarella']);
const MAYOR = new Set(['boxe', 'fiera', 'beneficenza', 'zonizzazione', 'licenzaCasino']);

type Any = Record<string, unknown>;
const isInt = (x: unknown, min: number, max: number) => typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
const isNum = (x: unknown, min: number, max: number) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
const isCity = (x: unknown) => typeof x === 'string' && /^\d{1,6}$/.test(x) && Number(x) < CITY_COUNT;
const isSquad = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x) && Object.entries(x as Any).every(([k, v]) => UNIT.has(k) && isInt(v, 0, 1e7));

/** Restituisce l'azione ripulita (solo i campi previsti) o null se non è valida. */
export function cleanAction(raw: unknown): Action | ServerAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Any; const t = a.t;
  const pick = <T>(o: T) => o;
  switch (t) {
    case 'build': return isCity(a.city) && isInt(a.lot, 0, 99) && typeof a.kind === 'string' && USE[a.kind]?.has(a.id as string) ? pick({ t, city: a.city as string, lot: a.lot as number, kind: a.kind as never, id: a.id as string }) : null;
    case 'upgrade': case 'demolish': case 'reopen': return isCity(a.city) && isInt(a.lot, 0, 99) ? { t, city: a.city as string, lot: a.lot as number } : null;
    case 'research': return RESEARCH_ID.has(a.id as string) ? { t, id: a.id as never } : null;
    case 'cancel': return (a.queue === 'build' || a.queue === 'research') && (a.city === undefined || isCity(a.city)) ? { t, queue: a.queue, city: a.city as string | undefined } : null;
    case 'recruit': return isCity(a.city) && UNIT.has(a.id as string) && isInt(a.n, 1, 100000) ? { t, city: a.city as string, id: a.id as never, n: a.n as number } : null;
    case 'guard': return isCity(a.city) && UNIT.has(a.id as string) && isInt(a.n, 0, 1e7) ? { t, city: a.city as string, id: a.id as never, n: a.n as number } : null;
    case 'mission': return MISSION.has(a.kind as string) && isCity(a.from) && isCity(a.to) && isSquad(a.units) && (a.lot === undefined || isInt(a.lot, 0, 99))
      ? { t, kind: a.kind as never, from: a.from as string, to: a.to as string, units: a.units as never, lot: a.lot as number | undefined } : null;
    case 'acquire': return isCity(a.from) && isCity(a.city) ? { t, from: a.from as string, city: a.city as string } : null;
    case 'payroll': return isCity(a.city) && isInt(a.level, 0, 10) ? { t, city: a.city as string, level: a.level as number } : null;
    case 'police': return isCity(a.city) && POLICE.has(a.id as string) && (a.target === undefined || isCity(a.target)) ? { t, city: a.city as string, id: a.id as never, target: a.target as string | undefined } : null;
    case 'mayor': return isCity(a.city) && MAYOR.has(a.id as string) ? { t, city: a.city as string, id: a.id as never } : null;
    case 'promote': return isCity(a.city) && RACKET.has(a.racket as string) ? { t, city: a.city as string, racket: a.racket as never } : null;
    case 'turf': return isCity(a.city) && isInt(a.block, 0, 999) && RACKET.has(a.racket as string) && (a.op === 'add' || a.op === 'remove') ? { t, city: a.city as string, block: a.block as number, racket: a.racket as never, op: a.op } : null;
    case 'protect': return isCity(a.city) && isInt(a.block, 0, 999) && isInt(a.delta, -1, 1) ? { t, city: a.city as string, block: a.block as number, delta: a.delta as number } : null;
    case 'autoTurf': case 'campaign': return isCity(a.city) ? { t, city: a.city as string } : null;
    case 'move': return isCity(a.city) && (a.what === 'qg' || a.what === 'cassaforte') && isInt(a.toLot, 0, 99) ? { t, city: a.city as string, what: a.what, toLot: a.toLot as number } : null;
    case 'launder': return isNum(a.share, 0, 1) ? { t, share: a.share as number } : null;
    case 'vacation': return isInt(a.days, 1, 60) ? { t, days: a.days as number } : null;
    case 'posture': return typeof a.auto === 'boolean' && isNum(a.share, 0, 1) ? { t, auto: a.auto, share: a.share as number } : null;
    case 'invest': return isNum(a.amount, 1, 1e13) ? { t, amount: a.amount as number } : null;
    case 'cancelUnits': return isCity(a.city) && isInt(a.index, 0, 99) ? { t, city: a.city as string, index: a.index as number } : null;
    case 'recall': return isInt(a.mission, 1, 1e9) ? { t, mission: a.mission as number } : null;
    case 'cancelMove': case 'cancelCampaign': return isCity(a.city) ? { t, city: a.city as string } : null;
    // azioni del server
    case 'avatar': return typeof a.id === 'string' && /^avatar-\d\d-[a-z-]+$/.test(a.id) ? { t, id: a.id } : null;
    case 'introSeen': case 'ransom': return { t };
    case 'seen': return Array.isArray(a.ids) && a.ids.length <= 100 && a.ids.every(x => isInt(x, 0, 1e9)) ? { t, ids: a.ids as number[] } : null;
    case 'look': return isCity(a.city) ? { t, city: a.city as string } : null;
    case 'pactPropose': return isInt(a.to, 1, 1e9) && (a.days === 3 || a.days === 7 || a.days === 14) ? { t, to: a.to as number, days: a.days as number } : null;
    case 'pactAnswer': return isInt(a.id, 1, 1e9) && typeof a.yes === 'boolean' ? { t, id: a.id as number, yes: a.yes } : null;
    case 'pactBreak': return isInt(a.id, 1, 1e9) ? { t, id: a.id as number } : null;
    case 'familyAsk': case 'familyCancel': return isInt(a.to, 1, 1e9) ? { t, to: a.to as number } : null;
    case 'familyAnswer': return isInt(a.from, 1, 1e9) && typeof a.yes === 'boolean' ? { t, from: a.from as number, yes: a.yes } : null;
  }
  return null;
}
