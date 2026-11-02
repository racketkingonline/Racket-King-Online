// Il mondo di gioco: stati, contee e città degli Stati Uniti.
// Geografia reale (us-atlas, GeoNames); i parametri di gioco di ogni città
// (domanda, polizia, corruttibilità) sono generati in modo deterministico dal suo id.

import world from '../map/world.json';
import type { Category, CityDef } from './data';

type Raw = { states: { fips: string; name: string; abbr: string }[]; counties: [string, number][]; cities: [string, number, number, number, number, number][] };
const W = world as unknown as Raw;

export const STATES = W.states;
export const COUNTIES = W.counties.map(([name, state], i) => ({ i, name, state }));
export const CITY_COUNT = W.cities.length;
export const cityRaw = (i: number) => W.cities[i];

/** Città per contea e per stato (indici). */
export const CITIES_BY_COUNTY: number[][] = COUNTIES.map(() => []);
export const CITIES_BY_STATE: number[][] = STATES.map(() => []);
W.cities.forEach((c, i) => { CITIES_BY_COUNTY[c[2]].push(i); CITIES_BY_STATE[c[1]].push(i); });

export type Tier = CityDef['tier'];
export function tierOf(pop: number): Tier {
  return pop >= 1e6 ? 'Metropoli' : pop >= 250000 ? 'Grande città' : pop >= 50000 ? 'Città' : pop >= 10000 ? 'Cittadina' : 'Paese';
}
export const TIER_FACTOR: Record<Tier, number> = { 'Paese': 0.6, 'Cittadina': 1, 'Città': 2, 'Grande città': 3.5, 'Metropoli': 6 };

// hash deterministico (FNV-1a) → [0,1)
export function hash01(str: string) { return h(str); }
function h(str: string) { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967296; }

const CASINO_STATES = new Set(['NV', 'NJ', 'MS', 'LA']);
const CATS: Category[] = ['protezione', 'scommesse', 'prestiti', 'auto', 'contrabbando', 'merce', 'armi', 'ristorazione', 'servizi', 'notte', 'trasporti', 'edilizia', 'immobiliare', 'media', 'gioco'];
/** Descrizioni delle città per fascia (testi italiani = chiavi di traduzione in en-data). */
export const FLAVOR: Record<Tier, string[]> = {
  'Paese': ['Pochi abitanti e tutti si conoscono.', 'Un distributore, una chiesa, un bar. E nessuno che guarda.', 'Campi a perdita d\'occhio e uno sceriffo stanco.'],
  'Cittadina': ['Una via principale e vecchie famiglie.', 'Fabbriche chiuse e gente indebitata.', 'Tranquilla in superficie.'],
  'Città': ['Abbastanza grande per sparire, abbastanza piccola per farsi notare.', 'Quartieri che cambiano padrone ogni inverno.', 'Un porto, un mercato, qualche sindacato.'],
  'Grande città': ['Soldi veri e polizia vera.', 'Ogni quartiere ha già un padrone.', 'Politica, cemento e appalti.'],
  'Metropoli': ['Il gioco grande. Qui si entra solo con un esercito o con un senatore.', 'Tutte le famiglie del paese hanno un piede qui.'],
};

const cache = new Map<string, CityDef>();
export function cityDef(id: string): CityDef {
  const hit = cache.get(id); if (hit) return hit;
  const i = Number(id); const [name, si, ci, x, y, pop] = W.cities[i];
  const st = STATES[si]; const tier = tierOf(pop);
  const sh = h(st.abbr), ch = (k: string) => h(id + ':' + k);
  const demand: Partial<Record<Category, number>> = {};
  for (const k of CATS) demand[k] = Math.round(30 + 50 * ch(k) + (k === 'gioco' && CASINO_STATES.has(st.abbr) ? 25 : 0));
  const fl = FLAVOR[tier];
  const d: CityDef = {
    id, name, state: st.name, stateAbbr: st.abbr, county: COUNTIES[ci].name, stateIdx: si, countyIdx: ci,
    tier, pop: TIER_FACTOR[tier], population: pop, x, y,
    police: Math.round((0.8 + 0.4 * sh + 0.15 * (TIER_FACTOR[tier] - 1) / 5) * 100) / 100,
    corruptible: Math.round((0.8 + 0.5 * h(st.abbr + 'c')) * 100) / 100,
    legalGambling: CASINO_STATES.has(st.abbr),
    demand, desc: fl[Math.floor(ch('d') * fl.length)],
  };
  cache.set(id, d); return d;
}

/** Ricerca per nome (prefisso, poi contenuto), le più popolose prima. */
export function searchCities(q: string, n = 8): number[] {
  const t = q.trim().toLowerCase(); if (t.length < 2) return [];
  const pre: number[] = [], mid: number[] = [];
  for (let i = 0; i < W.cities.length && pre.length < n; i++) {
    const nm = W.cities[i][0].toLowerCase();
    if (nm.startsWith(t)) pre.push(i); else if (mid.length < n && nm.includes(t)) mid.push(i);
  }
  return [...pre, ...mid].slice(0, n);
}

export const SURNAMES = ['Kowalski', 'Harlan', 'Calloway', 'Delgado', 'Okafor', 'Vance', 'Lindqvist', 'Ortega', 'Mahoney', 'Russo', 'Petrov', 'Nakamura', 'Doyle', 'Moreno', 'Sullivan', 'Bianchi', 'Kaminski', 'Reyes', 'Byrne', 'Novak', 'Castellano', 'Whitaker', 'Duarte', 'Brennan', 'Volkov', 'Santoro', 'McCready', 'Haddad', 'Esposito', 'Cruz'];
export const GANG_FORMS = ['i fratelli %', 'la banda di Duke %', 'i %', 'la crew di Ma %', 'gli uomini di %', 'la famiglia %'];
/** Nome italiano di una banda da cognome e forma (indice in GANG_FORMS). Il nome è anche la chiave per tradurlo (vedi en-data). */
export function gangNameOf(s: string, form: number) {
  const name = GANG_FORMS[form].replace('%', s);
  return name.startsWith('gli') && !/^[AEIOU]/.test(s) ? name.replace('gli ', 'i ') : name.startsWith('i ') && /^[AEIOU]/.test(s) ? name.replace('i ', 'gli ') : name;
}
export function gangName(id: string) {
  return gangNameOf(SURNAMES[Math.floor(h(id + 'g') * SURNAMES.length)], Math.floor(h(id + 'f') * GANG_FORMS.length));
}
