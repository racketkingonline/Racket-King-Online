// La città in 3D isometrico, stile "plastico scuro": argilla color ardesia, linee da cartografia, acqua che brilla.
// Ogni città ha la sua disposizione (layout.ts); qui la si costruisce con forme semplici.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { layout, type Block } from '../engine/layout';
import type { LotUse } from '../engine/engine';

const BLOCK = 10, ROAD = 4.5, STEP = BLOCK + ROAD;
// Palette scura, presa dalla UI: ardesia verde-azzurra, linee ciano tenui, oro per ciò che è tuo.
const C = {
  ground: 0x111a1d, white: 0x5d6e73, light: 0x50606a, mid: 0x414f56, dark: 0x252f34, paper: 0xc9d3d6,
  slab: 0x2e3b40, slabLot: 0x29353a, edge: 0xa9d2db, tree: 0x34504a,
  gold: 0xc8b082, green: 0x4caf6a, police: 0x2f5fa8, red: 0xe04848, blue: 0x3b82f6, water: 0x1747a8, glass: 0x5d7f8f,
  lamp: 0xffcf7a,
};
const SLAB_SEL = 0x5c4a1e, SLAB_HOVER = 0x3a3a2c;

export type TurfView = { tiles: Record<string, { giri: string[]; protect: number; level: number }>; gang: number[]; routeMain: string[]; routeHigh: string[]; highActive: boolean };
export const RACKET_COLOR: Record<string, number> = { pizzo: 0xd2a64e, bische: 0x8b5cf6, usura: 0x10b981, ricettazione: 0xf97316, contrabbando: 0x0ea5e9, narcotici: 0xef4444, armi: 0x475569 };
const RISK_COLOR = [0, 0x7fb38f, 0xe8c547, 0xf08a3c, 0xe04848];
export type Look = 'owner' | 'partial' | 'complete';
type Props = {
  cityId: string; lots: (LotUse | null)[]; building: number | null; heat: number; turf: TurfView;
  look?: Look; qgKnown?: boolean; mayor?: boolean; now?: number;
  selected: number | null; onSelect: (block: number | null) => void;
};

// ---------------------------------------------------------------- materiali e utilità
const mats = new Map<string, THREE.Material>();
function mat(color: number, opts: Partial<THREE.MeshLambertMaterialParameters> = {}) {
  const k = color + JSON.stringify(opts);
  if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color, ...opts }));
  return mats.get(k)!;
}
// facciate: finestre scure, qualcuna accesa (calda) per dare vita alla notte
let winTex: { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } | null = null;
function windowsTexture() {
  if (winTex) return winTex;
  const S = 128; const r = rnd(7);
  const a = document.createElement('canvas'); a.width = a.height = S; const g = a.getContext('2d')!;
  const b = document.createElement('canvas'); b.width = b.height = S; const e = b.getContext('2d')!;
  g.fillStyle = '#5d6e73'; g.fillRect(0, 0, S, S); e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  for (let y = 6; y < S; y += 16) for (let x = 4; x < S; x += 12) {
    const lit = r() < 0.1;
    g.fillStyle = lit ? '#e9c27a' : '#3a474c'; g.fillRect(x, y, 8, 8);
    if (lit) { e.fillStyle = r() < 0.7 ? '#ffc76a' : '#bfe3ff'; e.fillRect(x, y, 8, 8); }
  }
  const mk = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; };
  winTex = { map: mk(a), glow: mk(b) };
  return winTex;
}
function windowsMat(w: number, h: number) {
  const W = windowsTexture(); const rx = Math.max(1, Math.round(w / 6)) , ry = Math.max(0.5, h / 6.4);
  const t = W.map.clone(); t.needsUpdate = true; t.repeat.set(rx, ry);
  const gl = W.glow.clone(); gl.needsUpdate = true; gl.repeat.set(rx, ry);
  return new THREE.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: gl, emissiveIntensity: 0.8 });
}
function labelTexture(text: string, bg: string, fg: string) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d')!; g.fillStyle = bg; g.fillRect(0, 0, 256, 64);
  g.fillStyle = fg; g.font = 'bold 34px Inter, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// contorni sottili sugli spigoli, come nei plastici da cartografia
const edgeMat = new THREE.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.32 });
let EDGES = true;
function outline<T extends THREE.Mesh>(o: T, threshold = 30): T {
  if (EDGES) { const l = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, threshold), edgeMat); l.raycast = () => {}; o.add(l); }
  return o;
}
function rnd(seed: number) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y + h / 2, z); o.castShadow = true; o.receiveShadow = true; return outline(o);
}
function cyl(r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 16) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); o.position.set(x, y + h / 2, z); o.castShadow = true; o.receiveShadow = true; return outline(o, 40);
}
function tree(x: number, z: number, s = 1) {
  const g = new THREE.Group();
  g.add(cyl(0.18 * s, 0.8 * s, mat(C.dark), x, 0.3, z, 6));
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.75 * s, 10, 8), mat(C.tree)); top.position.set(x, 1.5 * s + 0.3, z); top.castShadow = true; g.add(top);
  return g;
}
function car(color: number, stripe?: number) {
  const g = new THREE.Group(); EDGES = false;
  g.add(box(1.0, 0.55, 2.0, mat(color), 0, 0.15, 0));
  g.add(box(0.85, 0.4, 1.0, mat(C.glass), 0, 0.7, -0.1));
  if (stripe !== undefined) g.add(box(1.02, 0.12, 1.4, mat(stripe), 0, 0.42, 0));
  g.add(box(0.8, 0.12, 0.06, mat(C.lamp, { emissive: C.lamp, emissiveIntensity: 1 }), 0, 0.35, 1.02));
  EDGES = true; return g;
}
function towerWithWindows(w: number, h: number, d: number, x = 0, z = 0, y = 0) {
  const m = windowsMat(Math.max(w, d), h);
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [m, m, mat(C.white), mat(C.white), m, m]);
  o.position.set(x, y + h / 2, z); o.castShadow = true; o.receiveShadow = true;
  // dettagli sul tetto: condizionatori, cisterne, antenne
  const r = rnd(Math.round(x * 131 + z * 71 + h * 997 + w * 13)); const top = h / 2;
  const k = Math.floor(r() * 3);
  for (let i = 0; i < k; i++) o.add(box(0.7 + r() * 0.6, 0.45, 0.6 + r() * 0.5, mat(C.light), (r() - 0.5) * (w - 1.4), top, (r() - 0.5) * (d - 1.4)));
  if (r() < 0.3 && w > 3) { const t = new THREE.Group(); t.add(cyl(0.55, 0.9, mat(C.mid), 0, 0.5, 0, 12)); for (const [a2, b2] of [[-0.35, -0.35], [0.35, 0.35]]) t.add(cyl(0.05, 0.5, mat(C.dark), a2, 0, b2, 4)); t.position.set((r() - 0.5) * (w - 1.6), top, (r() - 0.5) * (d - 1.6)); o.add(t); }
  if (r() < 0.25) o.add(cyl(0.04, 1.4 + r() * 1.2, mat(C.dark), (r() - 0.5) * (w - 1), top, (r() - 0.5) * (d - 1), 4));
  return outline(o);
}
function warehouse(w: number, d: number, n: number, x = 0, z = 0) {
  const g = new THREE.Group(); const h = 2.4;
  g.add(box(w, h, d, mat(C.white), x, 0, z));
  for (let i = 0; i < n; i++) {
    const r = (w / n) / 2; const roof = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d, 16, 1, false, 0, Math.PI), mat(C.light));
    roof.rotation.z = Math.PI / 2; roof.rotation.y = Math.PI / 2; roof.rotation.x = Math.PI / 2;
    roof.rotation.set(Math.PI / 2, 0, -Math.PI / 2); roof.position.set(x - w / 2 + r + i * 2 * r, h, z); roof.castShadow = true; g.add(roof);
  }
  return g;
}

// ---------------------------------------------------------------- edifici dei cittadini
function civic(b: Block): THREE.Object3D {
  const r = rnd(b.seed); const g = new THREE.Group();
  if (b.deco === 'office') {
    const w = 5 + r() * 3, d = 5 + r() * 3; g.add(towerWithWindows(w, b.h, d, (r() - 0.5) * 1.5, (r() - 0.5) * 1.5));
    if (r() < 0.5) g.add(box(w * 0.6, 1.2, d * 0.6, mat(C.light), 0, b.h, 0));
  } else if (b.deco === 'apartments') {
    const k = 2 + Math.floor(r() * 2);
    for (let i = 0; i < k; i++) { const h = b.h * (0.6 + r() * 0.5); g.add(towerWithWindows(3.4, h, 3.4, -2.5 + (i % 2) * 5, -2.5 + Math.floor(i / 2) * 5 + (k === 2 ? 2.5 : 0))); }
  } else if (b.deco === 'houses') {
    for (let i = 0; i < 4; i++) {
      const x = -2.4 + (i % 2) * 4.8, z = -2.4 + Math.floor(i / 2) * 4.8;
      g.add(box(3, 1.8, 3, mat(C.white), x, 0, z));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.3, 4), mat(C.light)); roof.rotation.y = Math.PI / 4; roof.position.set(x, 2.45, z); roof.castShadow = true; g.add(roof);
    }
  } else if (b.deco === 'warehouse') {
    g.add(warehouse(8, 5, 3, 0, -1)); if (r() < 0.6) { const t = car(C.white); t.scale.set(1.3, 1.3, 1.6); t.position.set(-2.5, 0, 3.4); t.rotation.y = Math.PI / 2; g.add(t); }
  } else if (b.deco === 'containers') {
    const cols = [C.white, C.light, C.mid];
    for (let i = 0; i < 6; i++) for (let k = 0; k < 1 + Math.floor(r() * 3); k++) g.add(box(2.2, 1.1, 1.1, mat(cols[Math.floor(r() * 3)]), -2.5 + (i % 3) * 2.5, k * 1.1, -2 + Math.floor(i / 3) * 3));
  } else {
    for (let i = 0; i < 7; i++) g.add(tree(-3.5 + r() * 7, -3.5 + r() * 7, 0.8 + r() * 0.5));
    g.add(cyl(1.4, 0.35, mat(C.light))); g.add(cyl(0.5, 0.9, mat(C.white))); g.add(cyl(0.9, 0.15, mat(C.light), 0, 0.9));
  }
  return g;
}

// ---------------------------------------------------------------- edifici speciali
function policeStation(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(towerWithWindows(8, 4.2, 6, 0, -0.5));
  g.add(box(8.1, 0.7, 6.1, mat(C.police), 0, 4.2, -0.5));
  const lightR = box(0.8, 0.45, 0.6, mat(C.red, { emissive: C.red, emissiveIntensity: 0.9 }), -0.5, 4.9, -0.5);
  const lightB = box(0.8, 0.45, 0.6, mat(C.blue, { emissive: C.blue, emissiveIntensity: 0.9 }), 0.5, 4.9, -0.5);
  lightR.name = 'lightR'; lightB.name = 'lightB'; g.add(lightR, lightB);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), new THREE.MeshBasicMaterial({ map: labelTexture('RKPD', '#2f5fa8', '#ffffff') }));
  sign.position.set(0, 3.2, 2.52); g.add(sign);
  for (let i = 0; i < 3; i++) { const c = car(C.paper, C.police); c.position.set(-2.6 + i * 2.6, 0, 3.8); g.add(c); }
  return g;
}
function cityHall(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(box(9, 0.5, 7.5, mat(C.light), 0, 0, 0));
  g.add(box(8, 0.4, 6.5, mat(C.white), 0, 0.5, 0));
  g.add(box(7, 3.6, 4.6, mat(C.white), 0, 0.9, -0.6));
  for (let i = 0; i < 6; i++) g.add(cyl(0.25, 3.2, mat(C.white), -2.9 + i * 1.16, 0.9, 2.1, 10));
  g.add(box(7.4, 0.55, 1.2, mat(C.light), 0, 4.1, 2.0));
  g.add(box(6.6, 0.35, 0.9, mat(C.white), 0, 4.65, 1.9));
  g.add(cyl(1.6, 1.2, mat(C.white), 0, 4.5, -0.6));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.7, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(C.light)); dome.position.set(0, 5.7, -0.6); dome.castShadow = true; g.add(dome);
  g.add(cyl(0.06, 2.4, mat(C.dark), 0, 7.3, -0.6, 6));
  const flag = box(1.1, 0.6, 0.05, mat(C.gold), 0.6, 9.0, -0.6); flag.name = 'flag'; g.add(flag);
  for (let i = 0; i < 4; i++) g.add(tree(-3.8 + i * 2.5, 3.6, 0.6));
  return g;
}

// ---------------------------------------------------------------- edifici del giocatore
function disguised(level: number, seed: number): THREE.Object3D {
  const g = new THREE.Group(); const h = 4 + level * 0.6 + (seed % 3);
  g.add(towerWithWindows(3.6, h, 3.6, -2.4, -1.2)); g.add(towerWithWindows(3.6, h * 0.8, 3.6, 2.4, 1.2)); return g;
}
function closedMark(top: number) {
  const g = new THREE.Group(); const m = mat(C.red, { emissive: C.red, emissiveIntensity: 0.4 });
  const a = box(4, 0.3, 0.5, m, 0, top + 1.2, 0); a.rotation.y = Math.PI / 4; const b = box(4, 0.3, 0.5, m, 0, top + 1.2, 0); b.rotation.y = -Math.PI / 4;
  g.add(a, b); g.name = 'closed'; return g;
}
function playerBuilding(u: LotUse, look: Look = 'owner', qgKnown = true, closed = false, seed = 0): THREE.Object3D {
  const hidden = look === 'partial' && (u.kind === 'racket' || (u.kind === 'building' && (u.id === 'qg' || u.id === 'cassaforte') && !qgKnown));
  if (hidden) { const d = disguised(u.level, seed); if (closed) d.add(closedMark(6)); return d; }
  const g = new THREE.Group(); const lv = 1 + 0.18 * (u.level - 1);
  const add = (o: THREE.Object3D) => { g.add(o); return o; };
  const k = `${u.kind}:${u.id}`;
  let top = 3, w = 6, d = 6;
  switch (k) {
    case 'building:qg': { top = 6.5 * lv; add(towerWithWindows(3.6, top, 3.6, -2.4, -1.2)); add(towerWithWindows(3.6, top * 0.8, 3.6, 2.4, 1.2)); g.add(box(3.75, 0.35, 3.75, mat(C.red), -2.4, top, -1.2)); g.add(box(3.75, 0.35, 3.75, mat(C.red), 2.4, top * 0.8, 1.2)); if (closed) g.add(closedMark(top)); return g; }
    case 'building:cassaforte': { top = 5 * lv; add(towerWithWindows(3.6, top, 3.6, -2.4, 1.2)); add(towerWithWindows(3.6, top * 0.75, 3.6, 2.4, -1.2)); g.add(box(3.75, 0.35, 3.75, mat(C.green), -2.4, top, 1.2)); g.add(box(3.75, 0.35, 3.75, mat(C.green), 2.4, top * 0.75, -1.2)); if (closed) g.add(closedMark(top)); return g; }
    case 'building:armeria': { top = 2.2; add(box(7, 2.2, 5, mat(C.mid))); for (let i = 0; i < 4; i++) add(box(1, 0.25, 0.1, mat(C.dark), -2.4 + i * 1.6, 1.4, 2.52)); w = 7; d = 5; break; }
    case 'front:bar': { top = 3; add(box(6, 3, 4.5, mat(C.white), 0, 0, -0.5)); add(box(6.2, 0.15, 1.6, mat(C.gold), 0, 2.1, 2.3)); for (let i = 0; i < 3; i++) add(cyl(0.45, 0.8, mat(C.light), -2 + i * 2, 0, 3.8, 10)); w = 6; d = 4.5; break; }
    case 'front:lavanderia': { top = 3; add(box(6.5, 3, 5, mat(C.white))); for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), mat(C.glass)); p.position.set(-2 + i * 2, 1.4, 2.51); add(p); } w = 6.5; d = 5; break; }
    case 'front:concessionaria': { top = 3; add(box(7, 3, 4, new THREE.MeshLambertMaterial({ color: C.glass, transparent: true, opacity: 0.6 }), 0, 0, -1.5)); for (let i = 0; i < 3; i++) { const c = car(i === 1 ? C.mid : C.white); c.position.set(-2.4 + i * 2.4, 0, 2.6); add(c); } w = 7; d = 4; break; }
    case 'front:nightclub': { top = 3.6 * lv; add(box(6.5, top, 5.5, mat(C.dark))); add(box(6.7, 0.5, 0.3, mat(C.gold, { emissive: C.gold, emissiveIntensity: 0.4 }), 0, top - 1, 2.8)); w = 6.5; d = 5.5; break; }
    case 'front:logistica': { add(warehouse(8, 5, 2, 0, -1)); for (let i = 0; i < 2; i++) { const t = car(C.white); t.scale.set(1.4, 1.4, 2); t.position.set(-2 + i * 4, 0, 3.4); add(t); } top = 3.2; w = 8; d = 5; break; }
    case 'front:edilizia': { top = 6 * lv; const frame = new THREE.Mesh(new THREE.BoxGeometry(5, top, 5), new THREE.MeshBasicMaterial({ color: C.dark, wireframe: true })); frame.position.y = top / 2; add(frame); add(box(5, 0.3, 5, mat(C.white), 0, top * 0.5, 0)); add(cyl(0.2, top + 5, mat(C.gold), 3.5, 0, 3.5, 6)); add(box(7, 0.3, 0.3, mat(C.gold), 1.5, top + 4.6, 3.5)); w = 5; d = 5; break; }
    case 'front:immobiliare': { top = 12 * lv; add(towerWithWindows(4.5, top, 4.5)); add(box(6.5, 1.5, 6.5, mat(C.light))); w = 4.5; d = 4.5; break; }
    case 'front:media': { top = 4 * lv; add(towerWithWindows(6, top, 5)); add(cyl(0.12, 6, mat(C.dark), 1.8, top, 0, 6)); const dish = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 3), mat(C.white)); dish.position.set(-1.5, top + 0.4, 0); dish.rotation.x = -0.6; add(dish); w = 6; d = 5; break; }
    case 'front:casino': { top = 4.5 * lv; add(box(8.5, top, 6.5, mat(C.white))); add(box(8.7, 0.6, 0.3, mat(C.gold, { emissive: C.gold, emissiveIntensity: 0.5 }), 0, top - 1.2, 3.3)); const dm = new THREE.Mesh(new THREE.SphereGeometry(2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(C.gold)); dm.position.y = top; add(dm); top += 2; w = 8.5; d = 6.5; break; }
    // racket: mimetizzati, sembrano edifici qualunque
    case 'racket:pizzo': { top = 2.6; for (let i = 0; i < 3; i++) add(box(2.2, 2.6, 4, mat(i === 1 ? C.light : C.white), -2.4 + i * 2.4, 0, 0)); w = 7; d = 4; break; }
    case 'racket:bische': { top = 3; add(box(5.5, 3, 5, mat(C.white))); add(box(5.6, 0.15, 1.2, mat(C.mid), 0, 2.2, 3)); w = 5.5; d = 5; break; }
    case 'racket:usura': { top = 4.5; add(towerWithWindows(4.5, 4.5, 4.5)); w = 4.5; d = 4.5; break; }
    case 'racket:ricettazione': { top = 2.8; add(box(7, 2.8, 4.5, mat(C.light), 0, 0, -1)); add(box(2.4, 2, 0.1, mat(C.dark), -1.6, 0, 1.26)); add(box(2.4, 2, 0.1, mat(C.dark), 1.6, 0, 1.26)); const c = car(C.mid); c.position.set(0, 0, 3.2); c.rotation.y = 0.4; add(c); w = 7; d = 4.5; break; }
    case 'racket:contrabbando': { add(warehouse(8, 6, 3)); top = 3.4; w = 8; d = 6; break; }
    case 'racket:narcotici': { top = 7 * lv; add(towerWithWindows(5, top, 4)); w = 5; d = 4; break; }
    case 'racket:armi': { top = 2.6; add(box(7, 2.6, 5.5, mat(C.mid))); for (let i = 0; i < 8; i++) add(box(0.1, 1.6, 0.1, mat(C.dark), -4 + i * (8 / 7), 0, 3.6)); add(box(8, 0.06, 0.06, mat(C.dark), 0, 1.5, 3.6)); w = 7; d = 5.5; break; }
  }
  g.add(box(w + 0.15, 0.3, d + 0.15, mat(closed ? C.dark : C.gold), 0, top, 0));
  if (u.hosted && look === 'owner') g.add(box(Math.min(w, 2.4), 0.5, Math.min(d, 2.4), mat(u.hosted.id === 'qg' ? C.red : C.green), 0, top + 0.3, 0));
  if (closed) g.add(closedMark(top));
  return g;
}
function emptyLot(): THREE.Object3D {
  const g = new THREE.Group();
  const pts: THREE.Vector3[] = []; const s = 4.3;
  [[-s, -s], [s, -s], [s, s], [-s, s], [-s, -s]].forEach(([x, z]) => pts.push(new THREE.Vector3(x, 0.05, z)));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: C.gold, dashSize: 0.8, gapSize: 0.5 }));
  line.computeLineDistances(); g.add(line);
  const plus = new THREE.Group(); plus.add(box(1.6, 0.12, 0.35, mat(C.gold))); plus.add(box(0.35, 0.12, 1.6, mat(C.gold))); plus.name = 'plus'; plus.position.y = 0.6; g.add(plus);
  return g;
}
function scaffolding(): THREE.Object3D {
  const g = new THREE.Group();
  const f = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6), new THREE.MeshBasicMaterial({ color: C.gold, wireframe: true })); f.position.y = 2; g.add(f);
  g.add(cyl(0.15, 8, mat(C.gold), 3.3, 0, -3.3, 6)); g.add(box(6, 0.25, 0.25, mat(C.gold), 1, 7.8, -3.3));
  return g;
}

// ---------------------------------------------------------------- scena
type Built = { group: THREE.Group; pick: THREE.Mesh[]; slabs: THREE.Mesh[]; roads: { x0: number; z0: number; x1: number; z1: number }[]; patrolRoads: number[]; train?: THREE.Object3D; trainSpan?: number; size: number };

function buildCity(cityId: string, lots: (LotUse | null)[], building: number | null, turf: TurfView, look: Look, qgKnown: boolean, mayor: boolean, now: number): Built {
  const L = layout(cityId); const n = L.n; const off = -((n - 1) * STEP) / 2; const size = n * STEP + ROAD;
  const group = new THREE.Group(); const pick: THREE.Mesh[] = []; const slabs: THREE.Mesh[] = [];
  // il plastico: una lastra spessa, con il bordo segnato
  const G = size + 8, TH = 5;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(G, TH, G), [mat(0x0b1012), mat(0x0b1012), mat(C.ground), mat(0x070a0b), mat(0x0d1315), mat(0x0d1315)]);
  plinth.position.y = -TH / 2; plinth.receiveShadow = true; group.add(plinth);
  { const pe = new THREE.LineSegments(new THREE.EdgesGeometry(plinth.geometry), new THREE.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.35 })); pe.position.copy(plinth.position); group.add(pe); }
  if (L.portSide !== null) {
    // canale d'acqua incassato lungo un lato, che brilla come nella cartografia
    const W = 16, e = G / 2 + W / 2; const vert = L.portSide === 1 || L.portSide === 3;
    const sx = vert ? W : G, sz = vert ? G : W;
    const pos = [[0, -e], [e, 0], [0, e], [-e, 0]][L.portSide];
    const bed = new THREE.Mesh(new THREE.BoxGeometry(sx, TH - 2, sz), mat(0x081a3a)); bed.position.set(pos[0], -TH / 2 - 1, pos[1]); group.add(bed);
    const water = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.2, sz), new THREE.MeshLambertMaterial({ color: C.water, emissive: C.water, emissiveIntensity: 0.3, transparent: true, opacity: 0.95 }));
    water.position.set(pos[0], -1.3, pos[1]); water.name = 'water'; group.add(water);
    const shore = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, 0.2, sz)), new THREE.LineBasicMaterial({ color: 0x7fb2ff, transparent: true, opacity: 0.6 }));
    shore.position.copy(water.position); group.add(shore);
    { const mid = vert ? [new THREE.Vector3(pos[0], -1.15, -G / 2), new THREE.Vector3(pos[0], -1.15, G / 2)] : [new THREE.Vector3(-G / 2, -1.15, pos[1]), new THREE.Vector3(G / 2, -1.15, pos[1])];
      const ml = new THREE.Line(new THREE.BufferGeometry().setFromPoints(mid), new THREE.LineDashedMaterial({ color: 0x9cc4ff, transparent: true, opacity: 0.45, dashSize: 2, gapSize: 1.6 })); ml.computeLineDistances(); group.add(ml); }
    // banchine e bitte
    for (let k = -G / 2 + 6; k < G / 2 - 4; k += 9) {
      const bx = vert ? pos[0] - Math.sign(pos[0]) * (W / 2 - 0.6) : k, bz = vert ? k : pos[1] - Math.sign(pos[1]) * (W / 2 - 0.6);
      group.add(cyl(0.35, 1.6, mat(C.mid), bx, -1.3, bz, 8));
    }
  }
  // curve di livello attorno al plastico: il "resto della mappa"
  const loopMat = (o: number) => new THREE.LineDashedMaterial({ color: C.edge, transparent: true, opacity: o, dashSize: 1.6, gapSize: 1.2 });
  [7, 15, 26, 40].forEach((d, i) => {
    const h = G / 2 + d + (L.portSide !== null ? 16 : 0), r = 4 + d * 0.5; const sh = new THREE.Shape();
    sh.moveTo(-h + r, -h); sh.lineTo(h - r, -h); sh.quadraticCurveTo(h, -h, h, -h + r); sh.lineTo(h, h - r); sh.quadraticCurveTo(h, h, h - r, h);
    sh.lineTo(-h + r, h); sh.quadraticCurveTo(-h, h, -h, h - r); sh.lineTo(-h, -h + r); sh.quadraticCurveTo(-h, -h, -h + r, -h);
    const pts = sh.getPoints(12).map(p => new THREE.Vector3(p.x, -TH - 0.2 - i * 0.4, p.y));
    const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), loopMat(0.22 - i * 0.04)); ln.computeLineDistances(); group.add(ln);
  });
  // segnaletica stradale
  const roads: Built['roads'] = []; const dashGeo = new THREE.BoxGeometry(1.2, 0.04, 0.16); const dashes: THREE.Matrix4[] = [];
  for (let i = 0; i <= n; i++) {
    const p = off - STEP / 2 + i * STEP;
    roads.push({ x0: off - STEP / 2, z0: p, x1: off - STEP / 2 + n * STEP, z1: p }, { x0: p, z0: off - STEP / 2, x1: p, z1: off - STEP / 2 + n * STEP });
    for (let t = off - STEP / 2 + 1; t < off - STEP / 2 + n * STEP; t += 3) {
      dashes.push(new THREE.Matrix4().makeTranslation(t, 0.03, p));
      dashes.push(new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(p, 0.03, t));
    }
  }
  const im = new THREE.InstancedMesh(dashGeo, mat(0x55646a), dashes.length); dashes.forEach((m, i) => im.setMatrixAt(i, m)); group.add(im);

  // lampioni agli incroci
  {
    const posts: THREE.Matrix4[] = [];
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const px = off - STEP / 2 + i * STEP, pz = off - STEP / 2 + j * STEP;
      posts.push(new THREE.Matrix4().makeTranslation(px + 2.55, 0, pz + 2.55));
    }
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.09, 2.4, 6).translate(0, 1.55, 0), mat(C.dark), posts.length);
    const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6).translate(0, 2.8, 0), new THREE.MeshBasicMaterial({ color: C.lamp }), posts.length);
    posts.forEach((m, i) => { pm.setMatrixAt(i, m); bm.setMatrixAt(i, m); });
    pm.castShadow = true; group.add(pm, bm);
  }
  L.blocks.forEach((b, bi) => {
    const x = off + b.gx * STEP, z = off + b.gy * STEP;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(BLOCK, 0.35, BLOCK), new THREE.MeshLambertMaterial({ color: b.kind === 'lot' ? C.slabLot : C.slab }));
    slab.position.set(x, 0.17, z); slab.receiveShadow = true; group.add(slab); slabs[bi] = slab;
    const se = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), b.kind === 'lot' ? new THREE.LineBasicMaterial({ color: C.gold, transparent: true, opacity: 0.35 }) : edgeMat);
    se.position.copy(slab.position); group.add(se);
    let obj: THREE.Object3D; let pickH = 2;
    if (b.kind === 'police') { obj = policeStation(); pickH = 6; }
    else if (b.kind === 'mayor') { obj = cityHall(); pickH = 8; }
    else if (b.kind === 'lot' || (b.extra && mayor)) {
      const u = lots[b.lot!];
      obj = building === b.lot && !u ? scaffolding() : u ? playerBuilding(u, look, qgKnown, !!u.closedUntil && u.closedUntil > now, b.seed) : look === 'owner' ? emptyLot() : new THREE.Group();
      if (building === b.lot && u) obj.add(scaffolding());
      pickH = 6;
    } else obj = civic(b.deco ? b : { ...b, deco: 'apartments', h: 6 });
    obj.position.set(x, 0.35, z); obj.userData.block = bi; group.add(obj);
    {
      const p = new THREE.Mesh(new THREE.BoxGeometry(BLOCK, pickH, BLOCK), new THREE.MeshBasicMaterial({ visible: false }));
      p.position.set(x, pickH / 2, z); p.userData.block = bi; group.add(p); pick.push(p);
    }
  });
  // giri, rischio, protezioni e isolati della banda
  const gang = new Set(turf.gang);
  L.blocks.forEach((b, bi) => {
    const x = off + b.gx * STEP, z = off + b.gy * STEP;
    if (gang.has(bi)) {
      const o = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK, BLOCK), new THREE.MeshBasicMaterial({ color: 0x9a1f1f, transparent: true, opacity: 0.3, depthWrite: false }));
      o.rotation.x = -Math.PI / 2; o.position.set(x, 0.37, z); group.add(o);
      const flag = new THREE.Group(); flag.add(cyl(0.08, 2.2, mat(C.dark), 0, 0, 0, 6)); flag.add(box(1.1, 0.6, 0.05, mat(0x7a1d1d), 0.55, 1.6, 0));
      flag.position.set(x - BLOCK / 2 + 0.8, 0.35, z - BLOCK / 2 + 0.8); group.add(flag);
    }
    const t = turf.tiles[bi]; if (!t || !t.giri.length) return;
    const col = RISK_COLOR[t.level] || RISK_COLOR[1]; const fm = mat(col, { emissive: col, emissiveIntensity: 0.35 });
    const half = BLOCK / 2 - 0.2;
    group.add(box(BLOCK, 0.14, 0.6, fm, x, 0.35, z - half)); group.add(box(BLOCK, 0.14, 0.6, fm, x, 0.35, z + half));
    group.add(box(0.6, 0.14, BLOCK, fm, x - half, 0.35, z)); group.add(box(0.6, 0.14, BLOCK, fm, x + half, 0.35, z));
    t.giri.forEach((g, k) => group.add(cyl(1.0, 0.55, mat(RACKET_COLOR[g] ?? C.gold, { emissive: RACKET_COLOR[g] ?? C.gold, emissiveIntensity: 0.25 }), x + BLOCK / 2 - 1.5, 0.35 + k * 0.62, z + BLOCK / 2 - 1.5, 16)));
    for (let k = 0; k < t.protect; k++) group.add(box(1.1, 0.4, 1.1, mat(C.blue, { emissive: C.blue, emissiveIntensity: 0.3 }), x + BLOCK / 2 - 4, 0.35 + k * 0.45, z + BLOCK / 2 - 1.5));
  });
  // ronde fisse: strisce blu sulle strade pattugliate (quella "alta" sbiadita finché il calore non la accende)
  const roadOf = (r: string) => { const [d, i] = r.split(':'); return Number(i) * 2 + (d === 'v' ? 1 : 0); };
  const routeMat = (on: boolean) => new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: on ? 0.55 : 0.16, depthWrite: false });
  const drawRoute = (list: string[], on: boolean) => list.forEach(r => {
    const rd = roads[roadOf(r)]; const horiz = rd.z0 === rd.z1; const len = horiz ? rd.x1 - rd.x0 : rd.z1 - rd.z0;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(horiz ? len : 1.6, horiz ? 1.6 : len), routeMat(on));
    m.rotation.x = -Math.PI / 2; m.position.set((rd.x0 + rd.x1) / 2, 0.05, (rd.z0 + rd.z1) / 2); group.add(m);
  });
  drawRoute(turf.routeMain, true); drawRoute(turf.routeHigh.filter(r => !turf.routeMain.includes(r)), turf.highActive);
  const patrolRoads = [...turf.routeMain, ...(turf.highActive ? turf.routeHigh : [])].map(roadOf);

  // ferrovia sopraelevata nelle città più grandi
  let train: THREE.Object3D | undefined, trainSpan: number | undefined;
  if (L.rail !== null) {
    const zr = off + L.rail * STEP + STEP / 2; const len = n * STEP + 20;
    group.add(box(len, 0.5, 2.6, mat(C.mid), 0, 4, zr));
    group.add(box(len, 0.15, 0.15, mat(C.dark), 0, 4.5, zr - 0.6)); group.add(box(len, 0.15, 0.15, mat(C.dark), 0, 4.5, zr + 0.6));
    for (let x = -len / 2 + 3; x < len / 2; x += 9) group.add(box(0.9, 4, 0.9, mat(C.light), x, 0, zr));
    const t = new THREE.Group();
    for (let i = 0; i < 3; i++) { t.add(box(5, 1.6, 2, mat(C.paper), i * 5.3, 4.6, 0)); t.add(box(5.02, 0.4, 2.02, mat(C.lamp, { emissive: C.lamp, emissiveIntensity: 0.6 }), i * 5.3, 5.4, 0)); }
    t.position.z = zr; group.add(t); train = t; trainSpan = len;
  }
  return { group, pick, slabs, roads, patrolRoads, train, trainSpan, size };
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mt = m.material as THREE.Material | THREE.Material[] | undefined; if (mt && !Array.isArray(mt) && !mats.has(String((mt as THREE.MeshLambertMaterial).color?.getHex?.()))) { /* materiali condivisi restano */ } });
}

export default function City3D({ cityId, lots, building, heat, turf, selected, onSelect, look = 'owner', qgKnown = true, mayor = false, now = 0 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera; controls: OrbitControls; built: Built | null; cars: { obj: THREE.Object3D; road: number; t: number; v: number; police: boolean }[]; hover: number | null; heat: number; selected: number | null; onSelect: Props['onSelect'] } | null>(null);
  const key = cityId + '|' + JSON.stringify(lots) + '|' + building + '|' + JSON.stringify(turf) + '|' + look + qgKnown + mayor + '|' + lots.map(l => (l?.closedUntil ?? 0) > now ? 1 : 0).join('');

  // inizializzazione una sola volta
  useEffect(() => {
    const el = host.current!; const w = el.clientWidth, h = el.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio)); renderer.setSize(w, h);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x070b0c, 190, 360);
    scene.add(new THREE.HemisphereLight(0xc6dde3, 0x05080a, 1.5));
    const rim = new THREE.DirectionalLight(0x5fb3c9, 0.9); rim.position.set(80, 40, -90); scene.add(rim);
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.9); sun.position.set(-60, 110, 50); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 300 }); sun.shadow.bias = -0.0005; sun.shadow.radius = 3;
    scene.add(sun);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 1000);
    camera.position.set(100, 100, 100); camera.lookAt(0, 0, 0);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.minPolarAngle = controls.maxPolarAngle = Math.PI / 3.4;
    controls.minZoom = 0.7; controls.maxZoom = 4; controls.screenSpacePanning = true;
    three.current = { renderer, scene, camera, controls, built: null, cars: [], hover: null, heat, selected, onSelect };

    const resize = () => { const W = el.clientWidth, Hh = el.clientHeight; renderer.setSize(W, Hh); fit(); };
    const ro = new ResizeObserver(resize); ro.observe(el);

    const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2();
    const pickAt = (e: PointerEvent) => {
      const T = three.current!; if (!T.built) return null;
      const r = renderer.domElement.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera); const hit = ray.intersectObjects(T.built.pick, false)[0];
      return hit ? (hit.object.userData.block as number) : null;
    };
    let down: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => { const T = three.current!; const b = pickAt(e); T.hover = b; renderer.domElement.style.cursor = b !== null ? 'pointer' : 'grab'; };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => { if (down && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) < 5) three.current!.onSelect(pickAt(e)); down = null; };
    renderer.domElement.addEventListener('pointermove', onMove); renderer.domElement.addEventListener('pointerdown', onDown); renderer.domElement.addEventListener('pointerup', onUp);

    let raf = 0; let last = performance.now();
    const loop = (now: number) => {
      const T = three.current!; const dt = Math.min(0.05, (now - last) / 1000); last = now;
      controls.update();
      if (T.built) {
        T.built.slabs.forEach((sl, i) => {
          const m = sl.material as THREE.MeshLambertMaterial; const L = layout(cityId);
          const base = L.blocks[i].kind === 'lot' ? C.slabLot : C.slab;
          m.color.setHex(i === T.selected ? SLAB_SEL : i === T.hover ? SLAB_HOVER : base);
        });
        for (const c of T.cars) {
          const r = T.built.roads[c.road]; c.t += c.v * dt; if (c.t > 1 || c.t < 0) { c.v = -c.v; c.t = Math.max(0, Math.min(1, c.t)); }
          const x = r.x0 + (r.x1 - r.x0) * c.t, z = r.z0 + (r.z1 - r.z0) * c.t; const horiz = r.z0 === r.z1;
          c.obj.position.set(x + (horiz ? 0 : (c.v > 0 ? 1 : -1)), 0, z + (horiz ? (c.v > 0 ? 1 : -1) : 0));
          c.obj.rotation.y = horiz ? (c.v > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.v > 0 ? 0 : Math.PI);
        }
        if (T.built.train && T.built.trainSpan) { const tr = T.built.train; tr.position.x += dt * 6; if (tr.position.x > T.built.trainSpan / 2) tr.position.x = -T.built.trainSpan / 2 - 16; }
        const blink = Math.floor(now / 400) % 2 === 0;
        T.built.group.traverse(o => { if (o.name === 'lightR') (o as THREE.Mesh).visible = blink; if (o.name === 'lightB') (o as THREE.Mesh).visible = !blink; if (o.name === 'plus') o.position.y = 0.6 + Math.sin(now / 350) * 0.25; if (o.name === 'water') ((o as THREE.Mesh).material as THREE.MeshLambertMaterial).emissiveIntensity = 0.3 + Math.sin(now / 900) * 0.06; });
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener('pointermove', onMove); renderer.domElement.removeEventListener('pointerdown', onDown); renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.dispose(); el.removeChild(renderer.domElement); three.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId]);

  function fit() {
    const T = three.current; if (!T) return; const el = host.current!; const aspect = el.clientWidth / el.clientHeight;
    const s = (T.built?.size ?? 80) * 0.44;
    T.camera.left = -s * aspect; T.camera.right = s * aspect; T.camera.top = s; T.camera.bottom = -s; T.camera.updateProjectionMatrix();
  }

  // ricostruzione quando cambiano i lotti
  useEffect(() => {
    const T = three.current; if (!T) return;
    if (T.built) { T.scene.remove(T.built.group); disposeGroup(T.built.group); }
    T.built = buildCity(cityId, lots, building, turf, look, qgKnown, mayor, now); T.scene.add(T.built.group); fit();
    syncCars(T.heat, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function syncCars(h: number, force = false) {
    const T = three.current; if (!T?.built) return;
    const want = 1 + Math.floor(h / 15); const civ = Math.round(T.built.roads.length * 0.6);
    const policeNow = T.cars.filter(c => c.police).length;
    if (!force && policeNow === want) return;
    for (const c of T.cars) T.built.group.remove(c.obj);
    T.cars = [];
    const r = rnd(cityId.length * 977 + T.built.roads.length);
    for (let i = 0; i < civ + want; i++) {
      const police = i >= civ; const o = police ? car(C.paper, C.police) : car([C.white, C.light, C.mid][i % 3]);
      if (police) { const l = box(0.6, 0.18, 0.3, mat(C.red, { emissive: C.red, emissiveIntensity: 1 }), 0, 0.95, 0); l.name = i % 2 ? 'lightR' : 'lightB'; o.add(l); }
      T.built.group.add(o);
      T.cars.push({ obj: o, road: police && T.built.patrolRoads.length ? T.built.patrolRoads[i % T.built.patrolRoads.length] : Math.floor(r() * T.built.roads.length), t: r(), v: (0.04 + r() * 0.05) * (r() < 0.5 ? 1 : -1), police });
    }
  }

  useEffect(() => { const T = three.current; if (!T) return; T.heat = heat; syncCars(heat); }, [heat]);
  useEffect(() => { const T = three.current; if (T) { T.selected = selected; T.onSelect = onSelect; } }, [selected, onSelect]);

  return <div ref={host} className="city3d" />;
}
