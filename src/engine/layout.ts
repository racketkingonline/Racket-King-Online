// Disposizione di una città: isolati su una griglia, quartieri, lotti edificabili,
// centrale di polizia e municipio. Deterministica: stessa città, stessa disposizione.
// Usata sia dal motore (quartieri, vicinanze) sia dalla vista 3D.

import { LOTS_BY_TIER, type Zone } from './data';
import { cityDef } from './world';

export type DecoKind = 'office' | 'apartments' | 'houses' | 'warehouse' | 'park' | 'containers';
export type Block = {
  gx: number; gy: number; zone: Zone;
  kind: 'lot' | 'civic' | 'police' | 'mayor';
  /** extra = lotto riservato al sindaco: finché non sei sindaco resta un edificio dei cittadini. */
  lot?: number; extra?: boolean; deco?: DecoKind; h: number; seed: number;
};
export type Layout = {
  n: number; blocks: Block[]; lots: number[]; police: number; mayor: number; portSide: number | null; rail: number | null;
  /** Ronde fisse: strade percorse dalle volanti. 'h:i' = strada orizzontale i (0..n), 'v:j' = verticale j. */
  routeMain: string[]; routeHigh: string[];
  /** Tutti i lotti: prima quelli normali, poi i 2 del sindaco. */
  lotBlocks: number[]; extraLots: number[];
  /** Isolati dove si possono piazzare i giri (case, uffici, magazzini, parchi, porto). */
  turf: number[];
};

const SIZE = { 'Paese': 4, 'Cittadina': 5, 'Città': 6, 'Grande città': 7, 'Metropoli': 8 } as const;

function rng(seed: number) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash(s: string) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }

const cache = new Map<string, Layout>();
export function layout(cityId: string): Layout {
  const hit = cache.get(cityId); if (hit) return hit;
  const d = cityDef(cityId); const n = SIZE[d.tier]; const r = rng(hash('layout:' + cityId));
  const c = (n - 1) / 2;
  const indSide = Math.floor(r() * 4);
  const hasPort = d.tier !== 'Paese' && r() < 0.35;
  const portSide = hasPort ? (indSide + 1 + Math.floor(r() * 3)) % 4 : null;
  const onSide = (gx: number, gy: number, side: number) => side === 0 ? gy === 0 : side === 1 ? gx === n - 1 : side === 2 ? gy === n - 1 : gx === 0;
  const blocks: Block[] = [];
  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
    const dist = Math.max(Math.abs(gx - c), Math.abs(gy - c));
    let zone: Zone = dist <= Math.max(0.5, n * 0.18) ? 'centro' : 'periferia';
    if (zone !== 'centro' && onSide(gx, gy, indSide)) zone = 'industriale';
    if (portSide !== null && onSide(gx, gy, portSide)) zone = 'porto';
    blocks.push({ gx, gy, zone, kind: 'civic', h: 0, seed: Math.floor(r() * 1e9) });
  }
  const idx = (gx: number, gy: number) => gy * n + gx;
  // municipio: l'isolato più centrale; polizia: vicino al centro
  const mayor = idx(Math.floor(c), Math.floor(c));
  blocks[mayor].kind = 'mayor'; blocks[mayor].zone = 'centro';
  const ring = blocks.map((b, i) => ({ b, i })).filter(({ b, i }) => i !== mayor && Math.max(Math.abs(b.gx - c), Math.abs(b.gy - c)) <= Math.max(1.5, n * 0.3));
  const police = ring[Math.floor(r() * ring.length)].i;
  blocks[police].kind = 'police';
  // lotti: quote per quartiere
  const L = LOTS_BY_TIER[d.tier];
  const free = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.kind === 'civic');
  for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
  const quota: Record<Zone, number> = { centro: Math.round(L * 0.3), industriale: Math.round(L * 0.2), porto: portSide !== null ? Math.max(1, Math.round(L * 0.12)) : 0, periferia: 0 };
  quota.periferia = L - quota.centro - quota.industriale - quota.porto;
  const lots: number[] = [];
  for (const z of ['centro', 'industriale', 'porto', 'periferia'] as Zone[]) {
    for (const f of free) { if (quota[z] <= 0) break; if (f.b.zone === z && f.b.kind === 'civic') { f.b.kind = 'lot'; lots.push(f.i); quota[z]--; } }
  }
  for (const f of free) { if (lots.length >= L) break; if (f.b.kind === 'civic') { f.b.kind = 'lot'; lots.push(f.i); } }
  lots.sort((a, b) => a - b);
  lots.forEach((bi, li) => { blocks[bi].lot = li; });
  // edifici dei cittadini
  const tall = { 'Paese': 0.6, 'Cittadina': 1, 'Città': 1.6, 'Grande città': 2.4, 'Metropoli': 3.2 }[d.tier];
  for (const b of blocks) {
    if (b.kind !== 'civic') continue;
    const x = r();
    if (b.zone === 'centro') { b.deco = x < 0.12 ? 'park' : x < 0.75 ? 'office' : 'apartments'; b.h = (6 + r() * 10) * tall; }
    else if (b.zone === 'industriale') { b.deco = x < 0.8 ? 'warehouse' : 'park'; b.h = 3 + r() * 2; }
    else if (b.zone === 'porto') { b.deco = x < 0.5 ? 'containers' : 'warehouse'; b.h = 3 + r() * 2; }
    else { b.deco = x < 0.12 ? 'park' : x < 0.55 ? 'houses' : 'apartments'; b.h = (3 + r() * 5) * Math.max(0.8, tall * 0.7); }
  }
  const rail = d.tier === 'Città' || d.tier === 'Grande città' || d.tier === 'Metropoli' ? Math.floor(r() * (n - 1)) : null;
  // ronde: la principale passa accanto alla centrale, quella "alta" si accende con molto calore
  const P = blocks[police];
  const routeMain = [`h:${P.gy + 1}`, `v:${P.gx}`];
  if (n >= 6) routeMain.push(`v:${(P.gx + Math.ceil(n / 2)) % (n + 1)}`);
  const all: string[] = []; for (let i = 0; i <= n; i++) all.push(`h:${i}`, `v:${i}`);
  const rest = all.filter(r => !routeMain.includes(r));
  const routeHigh: string[] = [];
  while (routeHigh.length < (n >= 6 ? 3 : 2)) { const k = rest.splice(Math.floor(r() * rest.length), 1)[0]; routeHigh.push(k); }
  // due lotti in più per il sindaco, vicino al municipio
  const M = blocks[mayor];
  const extraLots = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.kind === 'civic')
    .sort((A, B) => (Math.abs(A.b.gx - M.gx) + Math.abs(A.b.gy - M.gy)) - (Math.abs(B.b.gx - M.gx) + Math.abs(B.b.gy - M.gy)) || A.b.seed - B.b.seed).slice(0, 2).map(x => x.i);
  extraLots.forEach((bi, k) => { blocks[bi].lot = lots.length + k; blocks[bi].extra = true; });
  const lotBlocks = [...lots, ...extraLots];
  const turf = blocks.map((b, i) => (b.kind === 'civic' && !b.extra ? i : -1)).filter(i => i >= 0);
  const out: Layout = { n, blocks, lots, police, mayor, portSide, rail, routeMain, routeHigh, turf, lotBlocks, extraLots };
  cache.set(cityId, out); return out;
}

export const lotZone = (cityId: string, lot: number): Zone => { const L = layout(cityId); return L.blocks[L.lotBlocks[lot]].zone; };
export function lotsAdjacent(cityId: string, a: number, b: number) {
  const L = layout(cityId); const A = L.blocks[L.lotBlocks[a]], B = L.blocks[L.lotBlocks[b]];
  return Math.max(Math.abs(A.gx - B.gx), Math.abs(A.gy - B.gy)) <= 1;
}
export function nearPolice(cityId: string, lot: number) {
  const L = layout(cityId); const A = L.blocks[L.lotBlocks[lot]], P = L.blocks[L.police];
  return Math.max(Math.abs(A.gx - P.gx), Math.abs(A.gy - P.gy)) <= 1;
}

export const blockRoads = (b: Block) => [`h:${b.gy}`, `h:${b.gy + 1}`, `v:${b.gx}`, `v:${b.gx + 1}`];

/** Quanto un isolato è adatto a un racket (moltiplicatore della resa del giro). */
const FIT: Record<DecoKind, Partial<Record<string, number>>> = {
  houses: { usura: 1.3, narcotici: 1.3, pizzo: 1.0, bische: 0.9, ricettazione: 1.0 },
  apartments: { usura: 1.3, narcotici: 1.3, pizzo: 1.0, bische: 1.0 },
  office: { pizzo: 1.3, bische: 1.3, usura: 1.0, narcotici: 0.9 },
  warehouse: { ricettazione: 1.4, armi: 1.3, contrabbando: 1.1 },
  containers: { contrabbando: 1.5, armi: 1.2, ricettazione: 1.1 },
  park: { narcotici: 1.4, bische: 0.8 },
};
export const blockFit = (cityId: string, block: number, racket: string) => {
  const b = layout(cityId).blocks[block]; return b.deco ? FIT[b.deco][racket] ?? 0.8 : 0;
};
export const DECO_LABEL: Record<DecoKind, string> = { office: 'Uffici e negozi', apartments: 'Palazzi', houses: 'Case', warehouse: 'Magazzini', containers: 'Banchine del porto', park: 'Parco' };
