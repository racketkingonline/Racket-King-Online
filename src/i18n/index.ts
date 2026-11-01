// Multilingua, stile gettext: il testo italiano è la chiave, i dizionari danno la traduzione.
// - t('Contante sporco') → 'Dirty cash' in inglese, il testo italiano se manca la traduzione.
// - Parametri: t('Arrivo tra {d}', { d: '3h' }). I parametri possono essere numeri, denaro o altri messaggi.
// - Il motore salva i messaggi come Msg (chiave + parametri), così la cronaca si ritraduce quando cambi lingua.
import { EN_UI } from './en-ui';
import { EN_ENGINE } from './en-engine';
import { EN_DATA } from './en-data';
import { EN_ONLINE } from './en-online';

export type Lang = 'it' | 'en';
export const LANGS: { id: Lang; label: string }[] = [{ id: 'it', label: 'IT' }, { id: 'en', label: 'EN' }];

/** Parametro di un messaggio: testo già pronto, numero, importo in dollari o un altro messaggio da tradurre. */
export type Param = string | number | Msg | { money: number } | { num: number };
export type Msg = { k: string; p?: Record<string, Param> };

const DICT: Record<Lang, Record<string, string>> = { it: {}, en: { ...EN_DATA, ...EN_ENGINE, ...EN_ONLINE, ...EN_UI } };
const KEY = 'impero-lang';

function initial(): Lang {
  try { const v = localStorage.getItem(KEY); if (v === 'it' || v === 'en') return v; } catch { /* niente storage */ }
  try { return typeof navigator !== 'undefined' && !navigator.language.toLowerCase().startsWith('it') ? 'en' : 'it'; } catch { return 'it'; }
}
let lang: Lang = typeof window === 'undefined' ? 'it' : initial();
const listeners = new Set<() => void>();

export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* niente storage */ }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  for (const f of listeners) f();
}
export function onLang(f: () => void) { listeners.add(f); return () => listeners.delete(f); }

/** Testi che mancano nel dizionario della lingua attiva (per controllare la copertura). */
export const MISSING = new Set<string>();

export const locale = (l: Lang = lang) => (l === 'en' ? 'en-US' : 'it-IT');
/** Numero intero con i separatori delle migliaia della lingua (sempre, anche sopra 999: 1.234 / 1,234). */
export const fmtNum = (x: number, l: Lang = lang) => {
  const n = Math.round(x), a = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, l === 'en' ? ',' : '.');
  return (n < 0 ? '−' : '') + a;
};
export const fmtMoney = (x: number, l: Lang = lang) => (x < 0 ? '−$' : '$') + fmtNum(Math.abs(x), l);

function lookup(it: string, l: Lang) {
  if (l === 'it') return it;
  const v = DICT[l][it];
  if (v === undefined) { MISSING.add(it); return it; }
  return v;
}
function param(v: Param, l: Lang): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return fmtNum(v, l);
  if ('money' in v) return fmtMoney(v.money, l);
  if ('num' in v) return fmtNum(v.num, l);
  return render(v, l);
}
/** Traduce un testo italiano nella lingua attiva (o in quella indicata). */
export function t(it: string, p?: Record<string, Param>, l: Lang = lang): string {
  const base = lookup(it, l);
  if (!p) return base;
  return base.replace(/\{(\w+)\}/g, (m, k: string) => (p[k] === undefined ? m : param(p[k], l)));
}
export const render = (m: Msg, l: Lang = lang) => t(m.k, m.p, l);
/** Costruisce un messaggio da salvare: si traduce quando lo si mostra. */
export const M = (k: string, p?: Record<string, Param>): Msg => (p ? { k, p } : { k });
/** Frammento da tradurre usato come parametro (il nome di un racket, un'unità…). */
export const N = (k: string): Msg => ({ k });
