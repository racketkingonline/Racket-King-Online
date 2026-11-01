// Genera i dati della mappa: stati e contee (us-atlas, già proiettati Albers USA 975×610)
// e le città (GeoNames via cities.json + popolazione da all-the-cities).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geoAlbersUsa } from 'd3-geo';
const require = createRequire(import.meta.url);

const atlas = JSON.parse(readFileSync(require.resolve('us-atlas/counties-albers-10m.json'), 'utf8'));
const raw = JSON.parse(readFileSync(require.resolve('cities.json/cities.json'), 'utf8')).filter(c => c.country === 'US');
const pops = require('all-the-cities').filter(c => c.country === 'US');

const FIPS = { AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',DC:'11',FL:'12',GA:'13',HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',LA:'22',ME:'23',MD:'24',MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',NJ:'34',NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56' };
const ABBR = Object.fromEntries(Object.entries(FIPS).map(([a, f]) => [f, a]));

const states = atlas.objects.states.geometries.map(g => ({ fips: g.id, name: g.properties.name, abbr: ABBR[g.id] })).sort((a, b) => a.name.localeCompare(b.name));
const stateIdx = Object.fromEntries(states.map((s, i) => [s.fips, i]));
const counties = atlas.objects.counties.geometries.map(g => ({ fips: g.id, name: g.properties.name, state: stateIdx[g.id.slice(0, 2)] }));
const countyIdx = Object.fromEntries(counties.map((c, i) => [c.fips, i]));

const proj = geoAlbersUsa().scale(1300).translate([487.5, 305]);
const key = (n, a) => `${a}|${n.toLowerCase()}`;
const popBy = new Map();
for (const p of pops) { const k = key(p.name, p.adminCode); const [lng, lat] = p.loc.coordinates; (popBy.get(k) ?? popBy.set(k, []).get(k)).push({ lng, lat, pop: p.population }); }

const seen = new Set(); const out = []; let noCounty = 0;
for (const c of raw) {
  const f = FIPS[c.admin1]; if (!f) continue;
  const lat = +c.lat, lng = +c.lng; const p = proj([lng, lat]); if (!p) continue;
  const ci = countyIdx[f + c.admin2]; if (ci === undefined) { noCounty++; continue; }
  const dk = `${c.admin1}|${c.name}|${c.admin2}`; if (seen.has(dk)) continue; seen.add(dk);
  const cand = popBy.get(key(c.name, c.admin1)) ?? [];
  let pop = 0, best = 0.3;
  for (const q of cand) { const d = Math.hypot(q.lat - lat, q.lng - lng); if (d < best) { best = d; pop = q.pop; } }
  out.push([c.name, stateIdx[f], ci, Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, pop || 1000]);
}
out.sort((a, b) => b[5] - a[5]);
const cities = out.slice(0, 19500);
writeFileSync('src/map/world.json', JSON.stringify({ states, counties: counties.map(c => [c.name, c.state]), cities }));
writeFileSync('src/map/atlas.json', JSON.stringify(atlas));
const tiers = { met: 0, big: 0, city: 0, town: 0, vil: 0 };
for (const c of cities) { const p = c[5]; if (p >= 1e6) tiers.met++; else if (p >= 250000) tiers.big++; else if (p >= 50000) tiers.city++; else if (p >= 10000) tiers.town++; else tiers.vil++; }
console.log({ states: states.length, counties: counties.length, cities: cities.length, noCounty, tiers, withPop: cities.filter(c => c[5] !== 1000).length });
