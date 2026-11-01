// Eventi di stagione: l'infrastruttura c'è (calendario, annunci, modificatori globali), il calendario è vuoto.
// Cosa succede nelle stagioni si decide a gioco avviato: il server chiamerà setSeasonCalendar() con gli eventi.
// Regole fisse: durano SEASON_LENGTH giorni e si annunciano SEASON_NOTICE giorni prima (mai catastrofi a sorpresa).
import { M, N } from '../i18n';
import { log, owned, SEASON, type GameState } from './engine';
import type { UnitId } from './data';

export const SEASON_LENGTH = 21;
export const SEASON_NOTICE = 7;
export type SeasonId = 'proibizionismo' | 'cartelli' | 'giroDiVite';
export type SeasonDef = { id: SeasonId; day: number; name: string; text: string };
/** name e text sono in italiano e fanno da chiave di traduzione (vedi en-engine). */
/** Bozze provate nel playtest del 1 novembre (vedi report): non sono in calendario. */
export const SEASON_DRAFTS: SeasonDef[] = [
  { id: 'proibizionismo', day: 90, name: 'Proibizionismo', text: 'Lo Stato vieta gli alcolici: per 21 giorni il contrabbando rende il doppio e le scommesse una volta e mezza, ma il contrabbando scalda di più.' },
  { id: 'cartelli', day: 180, name: 'Guerra tra cartelli', text: 'I cartelli del Sud si fanno la guerra: per 21 giorni le bande locali sono decimate e il riscatto dei vassalli costa la metà.' },
  { id: 'giroDiVite', day: 270, name: 'Giro di vite federale', text: 'L\'FBI punta i pesci grossi: per 21 giorni le soglie di polizia dei primi 10% in classifica scendono di 15 punti.' },
];
/** Calendario attivo: vuoto finché non si decide cosa mettere nelle stagioni. */
export let SEASONS: SeasonDef[] = [];
export function setSeasonCalendar(list: SeasonDef[]) { SEASONS = [...list].sort((a, b) => a.day - b.day); }

/** Evento attivo in un certo giorno (0 = primo giorno). Il calendario si ripete ogni 360 giorni. */
export function seasonAt(day: number) {
  const d = day % 360;
  return SEASONS.find(e => d >= e.day && d < e.day + SEASON_LENGTH) ?? null;
}
export function nextSeason(day: number) {
  if (!SEASONS.length) return null;
  const d = day % 360;
  const e = SEASONS.find(x => x.day > d) ?? SEASONS[0];
  return { ...e, inDays: e.day > d ? e.day - d : 360 - d + e.day };
}

/** Imposta i modificatori globali per il giorno dato. */
export function applySeasonMods(id: SeasonId | null) {
  SEASON.id = id; SEASON.income = {}; SEASON.heat = {}; SEASON.npc = 1;
  if (id === 'proibizionismo') { SEASON.income = { contrabbando: 2, scommesse: 1.5 }; SEASON.heat = { contrabbando: 1.5 }; }
  if (id === 'cartelli') SEASON.npc = 0.4;
}

/** Versione per il prototipo a un giocatore: annunci, modificatori e "pesce grosso" se hai almeno 3 città. */
export function syncSeasonSingle(s: GameState & { seasonSeen?: string[] }) {
  const day = Math.floor(s.time / 86400);
  const cur = seasonAt(day);
  if ((SEASON.id ?? null) !== (cur?.id ?? null)) applySeasonMods(cur?.id ?? null);
  s.policeShift = cur?.id === 'giroDiVite' && owned(s).length >= 3 ? -15 : 0;
  const seen = (s.seasonSeen ??= []);
  const nx = nextSeason(day); const cycle = Math.floor(day / 360);
  if (!nx) return;
  const keyNotice = `${cycle}:${nx.id}:avviso`;
  if (nx.inDays <= SEASON_NOTICE && !cur && !seen.includes(keyNotice)) { seen.push(keyNotice); log(s, 'warn', M('Tra {n} giorni: {name}. {text}', { n: nx.inDays, name: N(nx.name), text: N(nx.text) })); }
  if (cur) {
    const keyStart = `${cycle}:${cur.id}:inizio`;
    if (!seen.includes(keyStart)) {
      seen.push(keyStart); log(s, 'warn', M('Comincia: {name}. {text}', { name: N(cur.name), text: N(cur.text) }));
      if (cur.id === 'cartelli') for (const c of Object.values(s.cities)) if (c.owner === 'npc' && c.proxy === undefined) for (const u of Object.keys(c.gang.units) as UnitId[]) c.gang.units[u] = Math.floor((c.gang.units[u] ?? 0) * 0.4);
    }
  }
}
