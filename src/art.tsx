// Illustrazioni del gioco: file in public/art/<id>.jpg (copiati accanto a index.html nella build).
// Se un file manca l'immagine sparisce senza rompere nulla.
import type { BattleReport } from './engine/engine';

export const AVATARS = [
  'avatar-01-vecchio-boss', 'avatar-02-donna-affari', 'avatar-03-ragazzo-strada', 'avatar-04-ex-poliziotto',
  'avatar-05-ragioniere', 'avatar-06-cowboy', 'avatar-07-vedova', 'avatar-08-pugile',
  'avatar-09-latina', 'avatar-10-motociclista', 'avatar-11-nerd', 'avatar-12-consigliera',
  'avatar-13-nero-elegante', 'avatar-14-asiatico', 'avatar-15-ragazza-bar', 'avatar-16-padrino-sud',
] as const;

export const artUrl = (id: string) => `art/${id}.jpg`;

/** Illustrazione di un racket, di un'attività o di una struttura. */
export function lotArt(kind: string, id: string) {
  return kind === 'racket' ? `racket-${id}` : kind === 'front' ? `front-${id}` : `struttura-${id}`;
}

/** Ritratto del capo di una banda: sempre lo stesso per la stessa città. */
export function bossArt(cityId: string) {
  let h = 0; for (const ch of cityId) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return `boss-${String((Math.abs(h) % 10) + 1).padStart(2, '0')}`;
}

/** Intestazione di un rapporto. */
export function reportArt(r: BattleReport): string | null {
  switch (r.kind) {
    case 'police': return /indagine/i.test(r.title) ? 'evento-indagine' : 'evento-retata';
    case 'defense': return r.win ? null : 'evento-razzia-subita';
    case 'sabotage': return 'evento-sabotaggio';
    case 'assault': return r.win ? 'evento-conquista' : null;
    case 'raid': return r.win ? 'evento-liberazione' : null;
    case 'strike': return r.win ? 'evento-sabotaggio' : null;
    case 'spy': return r.win ? null : 'evento-spia-scoperta';
    case 'mayor': return r.win ? 'evento-elezione' : /campagna/i.test(r.title) ? 'evento-scandalo' : 'evento-citta-persa';
  }
  return null;
}

/** Volto accanto a una riga della cronaca. */
export function logArt(text: string): string | null {
  if (/INDAGINE FEDERALE|grand jury|contabile è stato convocato/.test(text)) return 'personaggio-agente-federale';
  if (/giornalista/.test(text)) return 'personaggio-giornalista';
  if (/RETATA|CONTROLLO su un tuo isolato|volanti passano/.test(text)) return 'personaggio-commissario';
  if (/si parla di te|auto civetta|preparando una retata|Soffiata|Più pattuglie|fa domande al bar|fermano due dei tuoi/.test(text)) return 'personaggio-uomo-in-polizia';
  if (/hai vinto le elezioni|rieletto sindaco|non sei più il sindaco|campagna elettorale/.test(text)) return 'personaggio-sindaco';
  if (/gli informatori avvisano/.test(text)) return 'crew-informatori';
  if (/Investiti|Know-how acquisito/.test(text)) return 'personaggio-consigliere';
  return null;
}

export function Art({ id, className, alt = '' }: { id: string | null | undefined; className?: string; alt?: string }) {
  if (!id) return null;
  return <img className={`art ${className ?? ''}`} src={artUrl(id)} alt={alt} loading="lazy" decoding="async"
    onError={e => { e.currentTarget.style.display = 'none'; }} />;
}

// ---------------------------------------------------------------- icone piatte (public/icons/<id>.svg)
export function Ico({ id, size = 'md', className }: { id: string | null | undefined; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  if (!id) return null;
  return <img className={`ico ${size} ${className ?? ''}`} src={`icons/${id}.svg`} alt="" aria-hidden="true" draggable={false}
    onError={e => { e.currentTarget.style.display = 'none'; }} />;
}

/** Icona di un rapporto di battaglia, spionaggio o polizia. */
export function reportIcon(r: BattleReport): string {
  switch (r.kind) {
    case 'raid': return 'missione-razzia';
    case 'spy': return 'missione-spia';
    case 'assault': return 'missione-assalto';
    case 'strike': case 'sabotage': return 'missione-colpo';
    case 'defense': return 'missione-difesa';
    case 'mayor': return 'politica-sindaco';
    case 'police': return /indagine/i.test(r.title) ? 'polizia-indagine' : 'polizia-retata';
  }
  return 'esito-nonletto';
}

/** Icona di un racket, di un'attività o di una struttura (o del lotto libero). */
export function lotIcon(kind?: string, id?: string) {
  if (!kind || !id) return 'lotto-libero';
  return kind === 'racket' ? `racket-${id}` : kind === 'front' ? `front-${id}` : `struttura-${id}`;
}

export const TAB_ICON: Record<string, string> = { 'Città': 'tab-citta', 'Panoramica': 'tab-panoramica', 'Crew': 'tab-crew', 'Know-how': 'tab-knowhow', 'Mappa': 'tab-mappa', 'Rapporti': 'tab-rapporti', 'Diplomazia': 'knowhow-corruzione' };
export const ZONE_ICON: Record<string, string> = { centro: 'quartiere-centro', periferia: 'quartiere-periferia', industriale: 'quartiere-industriale', porto: 'quartiere-porto' };
export const MISSION_ICON: Record<string, string> = { raid: 'missione-razzia', spy: 'missione-spia', assault: 'missione-assalto', transfer: 'missione-trasferimento', strike: 'missione-colpo' };
export const FAVOR_ICON: Record<string, string> = { soffiata: 'polizia-soffiata', occhio: 'polizia-occhio', bustarella: 'polizia-bustarella', boxe: 'politica-boxe', fiera: 'politica-fiera', beneficenza: 'politica-beneficenza', zonizzazione: 'politica-zonizzazione', licenzaCasino: 'front-casino' };
