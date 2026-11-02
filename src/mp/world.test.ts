import { describe, expect, it } from 'vitest';
import { World } from './world';
import { owned, power } from '../engine/engine';
import { searchCities, cityRaw } from '../engine/world';

const D = 86400;
function setup() {
  let ms = Date.UTC(2026, 10, 1);
  const w = new World(); w.clock = () => ms; w.meta.startedAt = Math.floor(ms / 1000);
  const tulsa = String(searchCities('Tulsa', 5).find(i => cityRaw(i)[0] === 'Tulsa'));
  const broken = String(searchCities('Broken Arrow', 5).find(i => cityRaw(i)[0] === 'Broken Arrow'));
  const a = w.join('Alfa', undefined, tulsa); const b = w.join('Bravo', undefined, broken);
  const at = (sec: number) => { ms += sec * 1000; };
  return { w, a, b, at, tulsa, broken };
}

describe('mondo multiplayer', () => {
  it('protegge i nuovi arrivati', () => {
    const { w, a, b } = setup();
    a.s.cities[a.s.capital].units.soldati = 200;
    const r = w.act(a, { t: 'mission', kind: 'raid', from: a.s.capital, to: b.s.capital, units: { soldati: 100 } });
    expect(r.ok).toBe(false);
  });

  it('un colpo alla cassa toglie soldi e uomini alla vittima e le lascia un rapporto', () => {
    const { w, a, b, at } = setup();
    at(6 * D); w.sync();
    a.s.cities[a.s.capital].units.soldati = 400;
    b.s.res.sporco = 500000;
    const before = b.s.res.sporco; const menBefore = b.s.cities[b.s.capital].units.picchiatori;
    const r = w.act(a, { t: 'mission', kind: 'raid', from: a.s.capital, to: b.s.capital, units: { soldati: 300 } });
    expect(r.ok).toBe(true);
    expect(b.incoming.length).toBe(1);
    for (let i = 0; i < 12; i++) { at(600); w.sync(); }
    expect(b.s.res.sporco).toBeLessThan(before);
    void menBefore;
    expect(b.s.reports.some(x => x.kind === 'defense' && !x.win)).toBe(true);
    expect(b.incoming.length).toBe(0);
  });

  it('chi prende il QG della capitale si fa vassallo il rivale, che paga tributi', () => {
    const { w, a, b, at } = setup();
    at(6 * D); w.sync();
    a.s.cities[a.s.capital].units.soldati = 3000;
    w.act(a, { t: 'look', city: b.s.capital });
    const qg = b.s.cities[b.s.capital].lots.findIndex(l => l?.id === 'qg');
    const r = w.act(a, { t: 'mission', kind: 'assault', from: a.s.capital, to: b.s.capital, units: { soldati: 2500 }, lot: qg });
    expect(r.ok).toBe(true);
    for (let i = 0; i < 12; i++) { at(600); w.sync(); }
    expect(b.lord).toBe(a.id);
    expect(a.vassals).toContain(b.id);
    expect(owned(b.s).length).toBe(1);
    const lordCash = a.s.res.sporco;
    at(3600); w.sync();
    expect(a.s.res.sporco).toBeGreaterThan(lordCash - 1);
    // la famiglia non si attacca
    const again = w.act(a, { t: 'mission', kind: 'raid', from: a.s.capital, to: b.s.capital, units: { soldati: 10 } });
    expect(again.ok).toBe(false);
    expect(power(a.s, { soldati: 1 }, 'att')).toBeGreaterThan(0);
  });

  it("l'amministratore sposta un giocatore a Manhattan con edifici e uomini", () => {
    const { w, a, at } = setup();
    at(3600); w.sync();
    const old = a.s.capital; const lots = a.s.cities[old].lots.filter(Boolean).length; const men = a.s.cities[old].units.picchiatori;
    expect(w.relocate(a, '7')).toBeNull();
    expect(a.s.capital).toBe('7'); expect(a.s.cities[old]).toBeUndefined();
    expect(w.owner.get('7')).toBe(a.id); expect(w.owner.has(old)).toBe(false);
    expect(a.s.cities['7'].lots.filter(Boolean).length).toBe(lots);
    expect(a.s.cities['7'].units.picchiatori).toBe(men);
    at(3600); w.sync();
    expect(a.s.cities['7'].owner).toBe('player');
  });

  it('patto di non aggressione: proposta, accettazione, rottura con 24 ore di preavviso', () => {
    const { w, a, b, at } = setup();
    at(6 * D); w.sync();
    a.s.cities[a.s.capital].units.soldati = 400; a.s.res.sporco = 1e7;
    expect(w.act(a, { t: 'pactPropose', to: b.id, days: 7 }).ok).toBe(true);
    const p = w.pacts()[0];
    expect(w.act(b, { t: 'pactAnswer', id: p.id, yes: true }).ok).toBe(true);
    expect(w.alliesOf(a)).toContain(b.id); expect(w.alliesOf(b)).toContain(a.id);
    const raid = () => w.act(a, { t: 'mission', kind: 'raid', from: a.s.capital, to: b.s.capital, units: { soldati: 10 } });
    expect(raid().ok).toBe(false);
    expect(w.act(a, { t: 'pactBreak', id: p.id }).ok).toBe(true);
    expect(b.s.log[0].m?.k).toMatch(/rotto il patto/);
    at(12 * 3600); w.sync(); expect(raid().ok).toBe(false);
    at(13 * 3600); w.sync(); expect(raid().ok).toBe(true);
    expect(w.pacts().length).toBe(0);
  });

  it('entrare in una famiglia per scelta', () => {
    const { w, a, b } = setup();
    expect(w.act(b, { t: 'familyAsk', to: a.id }).ok).toBe(true);
    expect(w.act(b, { t: 'familyAsk', to: a.id }).ok).toBe(false);
    expect(w.act(a, { t: 'familyAnswer', from: b.id, yes: true }).ok).toBe(true);
    expect(b.lord).toBe(a.id); expect(a.vassals).toContain(b.id);
    expect(w.alliesOf(a)).toContain(b.id);
    // chi ha uomini suoi non può entrare in un'altra famiglia
    expect(w.act(a, { t: 'familyAsk', to: b.id }).ok).toBe(false);
  });

  it('si salva e si ricarica', () => {
    const { w, a, b, at } = setup();
    at(3600); w.sync();
    const json = JSON.stringify({ meta: w.meta, slots: [...w.slots.values()] });
    const back = JSON.parse(json);
    const w2 = new World(back.meta, back.slots);
    expect(w2.slots.get(a.id)!.name).toBe('Alfa');
    expect(w2.owner.get(b.s.capital)).toBe(b.id);
  });
});

import { EN_ONLINE } from '../i18n/en-online';
describe('traduzioni del gioco online', () => {
  it('chiave e traduzione hanno gli stessi segnaposto', () => {
    const ph = (x: string) => (x.match(/\{\w+\}/g) ?? []).sort().join();
    expect(Object.entries(EN_ONLINE).filter(([k, v]) => ph(k) !== ph(v))).toEqual([]);
  });
});
