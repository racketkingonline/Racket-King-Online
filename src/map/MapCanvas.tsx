// Mappa degli Stati Uniti su canvas: stati, contee e ~17.000 città, con zoom e spostamento.
import { useEffect, useMemo, useRef, useState } from 'react';
import { geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import atlasJson from './atlas.json';
import { CITY_COUNT, cityRaw, COUNTIES, STATES, tierOf } from '../engine/world';
import { t } from '../i18n';

const atlas = atlasJson as unknown as Topology<{ states: GeometryCollection; counties: GeometryCollection; nation: GeometryCollection }>;
const W = 975, HGT = 610;

// Path2D costruiti una volta sola (coordinate già proiettate).
function toPath(geo: Parameters<ReturnType<typeof geoPath>>[0]) {
  const p = new Path2D();
  const ctx = { beginPath() {}, moveTo: (x: number, y: number) => p.moveTo(x, y), lineTo: (x: number, y: number) => p.lineTo(x, y), closePath: () => p.closePath(), arc: (x: number, y: number, r: number, a: number, b: number) => p.arc(x, y, r, a, b) };
  geoPath(null, ctx as unknown as CanvasRenderingContext2D)(geo);
  return p;
}
let cached: { nation: Path2D; states: Path2D[]; stateMesh: Path2D; countyMesh: Path2D } | null = null;
function paths() {
  if (cached) return cached;
  const states = (feature(atlas, atlas.objects.states) as unknown as GeoJSON.FeatureCollection).features;
  const byFips = new Map(states.map(f => [String(f.id), f]));
  cached = {
    nation: toPath(feature(atlas, atlas.objects.nation) as unknown as GeoJSON.FeatureCollection),
    states: STATES.map(s => toPath(byFips.get(s.fips)!)),
    stateMesh: toPath(mesh(atlas, atlas.objects.states, (a, b) => a !== b)),
    countyMesh: toPath(mesh(atlas, atlas.objects.counties, (a, b) => a !== b && String(a.id).slice(0, 2) === String(b.id).slice(0, 2))),
  };
  return cached;
}

export type MapMission = { from: string; to: string; p: number; kind: string };
const EMPTY = new Set<string>();
type Props = {
  owned: Set<string>; known: Set<string>; rivals?: Set<string>; allies?: Set<string>; capital: string; selected: string; heldStates: Set<number>;
  missions: MapMission[]; focus: { id: string; n: number } | null; onSelect: (id: string) => void;
};
type View = { k: number; x: number; y: number };
const TIER_R: Record<string, number> = { 'Metropoli': 5.5, 'Grande città': 4.2, 'Città': 3.1, 'Cittadina': 2.3, 'Paese': 1.7 };

export default function MapCanvas({ owned, known, rivals = EMPTY, allies = EMPTY, capital, selected, heldStates, missions, focus, onSelect }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 900, h: 560 });
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<{ id: string; sx: number; sy: number } | null>(null);
  const visible = useRef<[number, number, number][]>([]);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const base = size.w / W;

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => { const w = el.clientWidth; setSize({ w, h: Math.round(Math.min(window.innerHeight * 0.72, w * (HGT / W))) }); });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // centra sulla città richiesta (ricerca, "vai alla capitale")
  useEffect(() => {
    if (!focus) return;
    const r = cityRaw(Number(focus.id)); const k = Math.max(view.k, 7);
    setView({ k, x: size.w / 2 - r[3] * base * k, y: size.h / 2 - r[4] * base * k });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);

  const thresholds = useMemo(() => {
    const k = view.k;
    return { dot: k < 1.8 ? 100000 : k < 3.5 ? 20000 : k < 7 ? 5000 : 0, label: k < 1.8 ? 600000 : k < 3.5 ? 150000 : k < 7 ? 30000 : k < 14 ? 5000 : 0 };
  }, [view.k]);

  useEffect(() => {
    const c = cv.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== size.w * dpr || c.height !== size.h * dpr) { c.width = size.w * dpr; c.height = size.h * dpr; }
    const ctx = c.getContext('2d')!;
    const P = paths(); const { k, x, y } = view; const s = base * k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#121110'; ctx.fillRect(0, 0, size.w, size.h);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * x, dpr * y);
    ctx.fillStyle = '#1e1c19'; ctx.fill(P.nation);
    ctx.fillStyle = 'rgba(201,164,92,0.10)';
    heldStates.forEach(i => ctx.fill(P.states[i]));
    if (k >= 1.6) { ctx.strokeStyle = `rgba(120,110,98,${Math.min(0.55, 0.15 + k * 0.04)})`; ctx.lineWidth = 0.5 / s; ctx.stroke(P.countyMesh); }
    ctx.strokeStyle = '#5a534a'; ctx.lineWidth = 1.1 / s; ctx.stroke(P.stateMesh);
    ctx.strokeStyle = '#6a6259'; ctx.lineWidth = 1.2 / s; ctx.stroke(P.nation);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // nomi degli stati a zoom basso
    if (k < 3) {
      ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(154,145,135,0.55)';
      for (const st of STATE_LABELS) ctx.fillText(st.abbr, st.x * s + x, st.y * s + y);
    }
    // città
    const vis: [number, number, number][] = [];
    const sc = Math.min(1.7, 0.85 + k * 0.05);
    for (let i = 0; i < CITY_COUNT; i++) {
      const r = cityRaw(i); const id = String(i);
      const special = owned.has(id) || known.has(id) || rivals.has(id) || allies.has(id) || id === selected;
      if (r[5] < thresholds.dot && !special) continue;
      const sx = r[3] * s + x, sy = r[4] * s + y;
      if (sx < -10 || sy < -10 || sx > size.w + 10 || sy > size.h + 10) continue;
      vis.push([i, sx, sy]);
      const rad = TIER_R[tierOf(r[5])] * sc * (owned.has(id) ? 1.5 : 1);
      ctx.beginPath(); ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      ctx.fillStyle = owned.has(id) ? '#c8b082' : rivals.has(id) ? '#e0473b' : allies.has(id) ? '#4f8fe8' : known.has(id) ? '#ffffff' : '#c9c6c0';
      ctx.fill();
      if (owned.has(id)) { ctx.strokeStyle = '#f3e3c0'; ctx.lineWidth = 1.2; ctx.stroke(); } else if (rivals.has(id) || allies.has(id)) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.stroke(); }
    }
    visible.current = vis;
    // missioni
    for (const m of missions) {
      const a = cityRaw(Number(m.from)), b = cityRaw(Number(m.to));
      const ax = a[3] * s + x, ay = a[4] * s + y, bx = b[3] * s + x, by = b[4] * s + y;
      ctx.setLineDash([5, 5]); ctx.strokeStyle = m.kind === 'transfer' ? '#7fb38f' : m.kind === 'spy' ? '#9a8fd6' : '#d4664f'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(ax + (bx - ax) * m.p, ay + (by - ay) * m.p, 4, 0, Math.PI * 2); ctx.fillStyle = '#ece6dc'; ctx.fill();
    }
    // selezione
    if (selected) {
      const r = cityRaw(Number(selected)); const sx = r[3] * s + x, sy = r[4] * s + y;
      ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.strokeStyle = '#ece6dc'; ctx.lineWidth = 1.6; ctx.stroke();
    }
    // etichette, senza sovrapposizioni
    const taken: [number, number, number, number][] = [];
    const label = (i: number, sx: number, sy: number, strong: boolean) => {
      const r = cityRaw(i); const txt = r[0] + (String(i) === capital ? ' ★' : '');
      ctx.font = `${strong ? 600 : 500} ${strong ? 13 : 11.5}px Inter, system-ui, sans-serif`;
      const w = ctx.measureText(txt).width, x0 = sx + 6, y0 = sy - 7, box: [number, number, number, number] = [x0 - 2, y0 - 11, x0 + w + 2, y0 + 3];
      if (!strong && taken.some(tk => !(box[2] < tk[0] || box[0] > tk[2] || box[3] < tk[1] || box[1] > tk[3]))) return;
      taken.push(box);
      ctx.textAlign = 'left'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(18,17,16,0.85)'; ctx.strokeText(txt, x0, y0);
      ctx.fillStyle = owned.has(String(i)) ? '#e8c987' : strong ? '#ece6dc' : '#c9c1b6'; ctx.fillText(txt, x0, y0);
    };
    for (const [i, sx, sy] of vis) if (owned.has(String(i)) || String(i) === selected) label(i, sx, sy, true);
    for (const [i, sx, sy] of vis) if (cityRaw(i)[5] >= thresholds.label && !owned.has(String(i))) label(i, sx, sy, false);
  });

  const toLocal = (e: { clientX: number; clientY: number }) => { const b = cv.current!.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const nearest = (px: number, py: number) => {
    let best = -1, bd = 12 * 12;
    for (const [i, sx, sy] of visible.current) { const d = (sx - px) ** 2 + (sy - py) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
  };
  const zoomAt = (px: number, py: number, f: number) => setView(v => {
    const k = Math.max(1, Math.min(80, v.k * f)); const r = k / v.k;
    return clamp({ k, x: px - (px - v.x) * r, y: py - (py - v.y) * r }, size);
  });

  useEffect(() => {
    const c = cv.current; if (!c) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const p = toLocal(e); zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015)); };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  });

  const hv = hover ? cityRaw(Number(hover.id)) : null;
  return (
    <div ref={wrap} className="mapcanvas" style={{ height: size.h }}>
      <canvas
        ref={cv} style={{ width: size.w, height: size.h, cursor: drag.current?.moved ? 'grabbing' : hover ? 'pointer' : 'grab' }}
        onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); const p = toLocal(e); drag.current = { x: p.x, y: p.y, vx: view.x, vy: view.y, moved: false }; }}
        onPointerMove={e => {
          const p = toLocal(e); const d = drag.current;
          if (d) { const dx = p.x - d.x, dy = p.y - d.y; if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true; if (d.moved) { setView(v => clamp({ k: v.k, x: d.vx + dx, y: d.vy + dy }, size)); return; } }
          const i = nearest(p.x, p.y); setHover(i >= 0 ? { id: String(i), sx: p.x, sy: p.y } : null);
        }}
        onPointerUp={e => { const d = drag.current; drag.current = null; if (d && !d.moved) { const p = toLocal(e); const i = nearest(p.x, p.y); if (i >= 0) onSelect(String(i)); } }}
        onPointerLeave={() => setHover(null)}
      />
      <div className="zoom">
        <button onClick={() => zoomAt(size.w / 2, size.h / 2, 1.6)} aria-label={t('Ingrandisci')} title={t('Ingrandisci')}>+</button>
        <button onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.6)} aria-label={t('Riduci')} title={t('Riduci')}>−</button>
        <button onClick={() => setView({ k: 1, x: 0, y: 0 })} aria-label={t('Vista intera')} title={t('Vista intera')}>⤢</button>
      </div>
      {hv && hover && (
        <div className="maptip" style={{ left: Math.min(hover.sx + 14, size.w - 220), top: hover.sy + 14 }}>
          <b>{hv[0]}</b><br />{COUNTIES[hv[2]].name} County, {STATES[hv[1]].abbr}<br /><span className="muted">{t(tierOf(hv[5]))} · {t('{n} ab.', { n: hv[5] })}</span>
        </div>
      )}
      <div className="legend">
        <span><i style={{ background: '#c8b082' }} />{t('tue')}</span>
        {rivals.size + allies.size > 0 && <><span><i style={{ background: '#e0473b' }} />{t('altri boss')}</span>
        <span><i style={{ background: '#4f8fe8' }} />{t('alleati')}</span></>}
        <span><i style={{ background: '#ffffff' }} />{t('bande che conosci')}</span>
        <span><i style={{ background: '#c9c6c0' }} />{t('bande')}</span>
        <span className="muted">{t('rotellina o +/− per lo zoom, trascina per spostarti')}</span>

      </div>
    </div>
  );
}

function clamp(v: View, size: { w: number; h: number }): View {
  const mw = size.w * v.k, mh = (size.w * HGT / W) * v.k;
  return { k: v.k, x: Math.min(size.w * 0.5, Math.max(size.w * 0.5 - mw, v.x)), y: Math.min(size.h * 0.5, Math.max(size.h * 0.5 - mh, v.y)) };
}

// posizione delle sigle degli stati: baricentro delle sue città
const STATE_LABELS = STATES.map((st, si) => {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < CITY_COUNT; i++) { const r = cityRaw(i); if (r[1] === si) { sx += r[3]; sy += r[4]; n++; } }
  return { abbr: st.abbr, x: n ? sx / n : 0, y: n ? sy / n : 0 };
});
