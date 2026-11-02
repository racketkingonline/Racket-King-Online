// Dati di bilanciamento. Tutti i numeri sono valori di partenza da tarare
// ("raddoppia e dimezza"). Il motore non contiene numeri magici: stanno qui.

export type Cost = { sporco?: number; pulito?: number; influenza?: number };

export type Category =
  | 'protezione' | 'scommesse' | 'prestiti' | 'auto' | 'contrabbando' | 'merce' | 'armi'
  | 'ristorazione' | 'servizi' | 'notte' | 'trasporti' | 'edilizia' | 'immobiliare' | 'media' | 'gioco';

export const CATEGORY_LABEL: Record<Category, string> = {
  protezione: 'Protezione', scommesse: 'Scommesse', prestiti: 'Prestiti', auto: 'Auto',
  contrabbando: 'Contrabbando', merce: 'Merce', armi: 'Armi', ristorazione: 'Ristorazione',
  servizi: 'Servizi', notte: 'Vita notturna', trasporti: 'Trasporti', edilizia: 'Edilizia',
  immobiliare: 'Immobiliare', media: 'Media', gioco: 'Gioco legale',
};

export type Requirement = { building?: Partial<Record<BuildingId, number>>; research?: Partial<Record<ResearchId, number>>; flag?: FlagId };

// ---------- Racket ----------
export type RacketId = 'pizzo' | 'bische' | 'usura' | 'ricettazione' | 'contrabbando' | 'narcotici' | 'armi';
export type RacketDef = {
  id: RacketId; name: string; desc: string; category: Category;
  baseCost: number; costGrowth: number; baseIncome: number; heatPerLevel: number; req?: Requirement;
};
export const RACKETS: RacketDef[] = [
  { id: 'pizzo', name: 'Pizzo', desc: 'Protezione ai negozi del quartiere. Poco ma sicuro.', category: 'protezione', baseCost: 1500, costGrowth: 1.6, baseIncome: 600, heatPerLevel: 0.6 },
  { id: 'bische', name: 'Bische e scommesse', desc: 'Tavoli nel retro e allibratori.', category: 'scommesse', baseCost: 3000, costGrowth: 1.6, baseIncome: 900, heatPerLevel: 1.0 },
  { id: 'usura', name: 'Usura', desc: 'Prestiti a chi la banca ha già detto di no.', category: 'prestiti', baseCost: 4500, costGrowth: 1.6, baseIncome: 1100, heatPerLevel: 1.2, req: { building: { qg: 2 } } },
  { id: 'ricettazione', name: 'Ricettazione e furti d\'auto', desc: 'Auto rubate, smontate e rivendute a pezzi.', category: 'auto', baseCost: 6000, costGrowth: 1.6, baseIncome: 1300, heatPerLevel: 1.5, req: { building: { qg: 2 } } },
  { id: 'contrabbando', name: 'Contrabbando', desc: 'Sigarette e alcol senza accise.', category: 'contrabbando', baseCost: 15000, costGrowth: 1.6, baseIncome: 2000, heatPerLevel: 2.0, req: { building: { qg: 3 }, research: { logistica: 1 } } },
  { id: 'narcotici', name: 'Merce', desc: 'Il giro più ricco e più pericoloso della città.', category: 'merce', baseCost: 30000, costGrowth: 1.6, baseIncome: 3000, heatPerLevel: 3.5, req: { building: { qg: 4, armeria: 2 } } },
  { id: 'armi', name: 'Traffico d\'armi', desc: 'Si vende a chiunque paghi.', category: 'armi', baseCost: 60000, costGrowth: 1.6, baseIncome: 4500, heatPerLevel: 5.0, req: { building: { qg: 6, armeria: 5 } } },
];

// ---------- Attività legali ----------
export type FrontId = 'bar' | 'lavanderia' | 'concessionaria' | 'nightclub' | 'logistica' | 'edilizia' | 'immobiliare' | 'media' | 'casino';
export type FrontDef = {
  id: FrontId; name: string; desc: string; category: Category;
  baseCost: Cost; costGrowth: number;
  launder: number; clean: number; influence: number; cover: number;
  synergy?: RacketId[]; req?: Requirement;
};
export const FRONTS: FrontDef[] = [
  { id: 'bar', name: 'Bar e ristorante', desc: 'Il primo front: il bancone vede passare di tutto.', category: 'ristorazione', baseCost: { sporco: 4000 }, costGrowth: 1.6, launder: 800, clean: 200, influence: 0.1, cover: 0.15, synergy: ['pizzo', 'bische'] },
  { id: 'lavanderia', name: 'Lavanderia e autolavaggio', desc: 'Il front classico: lava tanto, rende poco.', category: 'servizi', baseCost: { sporco: 6000 }, costGrowth: 1.6, launder: 2500, clean: 80, influence: 0, cover: 0.3 },
  { id: 'concessionaria', name: 'Concessionaria', desc: 'Auto usate, provenienza discutibile.', category: 'auto', baseCost: { sporco: 12000, pulito: 4000 }, costGrowth: 1.6, launder: 1500, clean: 400, influence: 0.2, cover: 0.15, synergy: ['ricettazione'], req: { building: { qg: 2 } } },
  { id: 'nightclub', name: 'Night club', desc: 'Musica alta, domande poche.', category: 'notte', baseCost: { sporco: 15000, pulito: 8000 }, costGrowth: 1.6, launder: 1800, clean: 500, influence: 0.2, cover: 0.15, synergy: ['narcotici'], req: { building: { qg: 3 } } },
  { id: 'logistica', name: 'Trasporti e logistica', desc: 'Camion che vanno ovunque.', category: 'trasporti', baseCost: { sporco: 10000, pulito: 20000 }, costGrowth: 1.6, launder: 1500, clean: 600, influence: 0.3, cover: 0.15, synergy: ['contrabbando'], req: { building: { qg: 3 } } },
  { id: 'edilizia', name: 'Impresa edile', desc: 'Cemento, appalti, amici in comune.', category: 'edilizia', baseCost: { pulito: 40000 }, costGrowth: 1.6, launder: 4000, clean: 1200, influence: 1, cover: 0.2, req: { building: { qg: 4 } } },
  { id: 'immobiliare', name: 'Immobiliare', desc: 'Affitti puliti e una città che cresce.', category: 'immobiliare', baseCost: { pulito: 60000 }, costGrowth: 1.6, launder: 500, clean: 1500, influence: 0.8, cover: 0.2, req: { building: { qg: 5 } } },
  { id: 'media', name: 'Media locale', desc: 'Radio e giornale: decidi tu cosa fa notizia.', category: 'media', baseCost: { pulito: 30000 }, costGrowth: 1.7, launder: 0, clean: 200, influence: 3, cover: 0.8, req: { building: { qg: 4 } } },
  { id: 'casino', name: 'Casinò', desc: 'Il front definitivo. Serve la licenza.', category: 'gioco', baseCost: { pulito: 250000, sporco: 50000 }, costGrowth: 1.7, launder: 15000, clean: 4000, influence: 2, cover: 0.25, synergy: ['bische'], req: { building: { qg: 6 }, flag: 'licenzaCasino' } },
];

// ---------- Strutture ----------
export type BuildingId = 'qg' | 'cassaforte' | 'armeria';
export type BuildingDef = { id: BuildingId; name: string; desc: string; baseCost: Cost; costGrowth: number; req?: Requirement; unique?: boolean };
export const BUILDINGS: BuildingDef[] = [
  { id: 'qg', name: 'Quartier generale', desc: 'Velocizza i lavori e sblocca le attività più grandi. Uno per città.', baseCost: { sporco: 2000 }, costGrowth: 1.8, unique: true },
  { id: 'cassaforte', name: 'Cassaforte', desc: 'Il contante sporco qui dentro non si razzia e non si sequestra.', baseCost: { sporco: 3000 }, costGrowth: 1.7 },
  { id: 'armeria', name: 'Armeria', desc: 'Velocizza il reclutamento e sblocca i giri pesanti.', baseCost: { sporco: 5000 }, costGrowth: 1.8 },
];

// ---------- Know-how ----------
export type ResearchId = 'contabilita' | 'corruzione' | 'tattica' | 'logistica' | 'cifrate' | 'gestione';
export type ResearchDef = { id: ResearchId; name: string; desc: string; baseCost: Cost; costGrowth: number; req?: Requirement };
export const RESEARCH: ResearchDef[] = [
  { id: 'contabilita', name: 'Contabilità creativa', desc: 'Commissione di lavaggio −2% e capacità +10% per livello.', baseCost: { sporco: 3000, pulito: 3000 }, costGrowth: 2, req: { building: { qg: 2 } } },
  { id: 'corruzione', name: 'Corruzione', desc: 'Poliziotti a libro paga +20% di efficacia per livello.', baseCost: { sporco: 6000 }, costGrowth: 2, req: { building: { qg: 2 } } },
  { id: 'tattica', name: 'Tattica', desc: 'Attacco e difesa della crew +10% per livello.', baseCost: { sporco: 8000 }, costGrowth: 2, req: { building: { armeria: 2 } } },
  { id: 'logistica', name: 'Logistica', desc: 'Spostamenti −10% di tempo per livello. Sblocca il contrabbando.', baseCost: { sporco: 5000, pulito: 2000 }, costGrowth: 2, req: { building: { qg: 2 } } },
  { id: 'gestione', name: 'Gestione', desc: 'Una città in più gestibile senza perdite per livello.', baseCost: { sporco: 10000, pulito: 10000 }, costGrowth: 2.2, req: { building: { qg: 3 } } },
  { id: 'cifrate', name: 'Comunicazioni cifrate', desc: 'Spionaggio più efficace; calore dagli attacchi −10% per livello.', baseCost: { pulito: 6000 }, costGrowth: 2, req: { building: { qg: 3 } } },
];

// ---------- Crew ----------
export type UnitId = 'picchiatori' | 'soldati' | 'enforcer' | 'informatori' | 'corrieri' | 'avvocati' | 'contabili' | 'guardie' | 'delfino';
export type UnitDef = {
  id: UnitId; name: string; desc: string; branch: 'criminale' | 'legale';
  cost: Cost; upkeep: Cost; att: number; def: number; carry: number; hours?: number; req?: Requirement;
};
export const UNITS: UnitDef[] = [
  { id: 'picchiatori', name: 'Picchiatori', desc: 'Economici. Fanno numero.', branch: 'criminale', cost: { sporco: 500 }, upkeep: { sporco: 8 }, att: 2, def: 3, carry: 300 },
  { id: 'soldati', name: 'Soldati', desc: 'Armati. Il grosso di attacchi e difese.', branch: 'criminale', cost: { sporco: 2000 }, upkeep: { sporco: 30 }, att: 8, def: 8, carry: 300, req: { building: { armeria: 1 } } },
  { id: 'enforcer', name: 'Enforcer', desc: 'Pesanti. Sfondano qualunque porta.', branch: 'criminale', cost: { sporco: 6000 }, upkeep: { sporco: 90 }, att: 25, def: 15, carry: 300, req: { building: { armeria: 3 } } },
  { id: 'informatori', name: 'Informatori', desc: 'Spiano i rivali e avvisano degli attacchi.', branch: 'criminale', cost: { sporco: 1000 }, upkeep: { sporco: 12 }, att: 0, def: 0, carry: 0 },
  { id: 'corrieri', name: 'Corrieri', desc: 'Portano a casa il bottino.', branch: 'criminale', cost: { sporco: 800 }, upkeep: { sporco: 8 }, att: 0, def: 1, carry: 5000 },
  { id: 'avvocati', name: 'Avvocati', desc: 'Riducono sequestri, arresti e calore.', branch: 'legale', cost: { pulito: 3000 }, upkeep: { pulito: 40 }, att: 0, def: 0, carry: 0, req: { building: { qg: 2 } } },
  { id: 'contabili', name: 'Contabili', desc: 'Lavano di più e trattengono meno.', branch: 'legale', cost: { pulito: 2000 }, upkeep: { pulito: 30 }, att: 0, def: 0, carry: 0 },
  { id: 'guardie', name: 'Guardie giurate', desc: 'Proteggono i front senza calore, ma sono deboli.', branch: 'legale', cost: { pulito: 1500 }, upkeep: { pulito: 15 }, att: 0, def: 4, carry: 0 },
  { id: 'delfino', name: 'Delfino', desc: "L'erede che governa le città che prendi. Si arruola solo nella capitale, uno alla volta.", branch: 'criminale', cost: { sporco: 300000 }, upkeep: { sporco: 3000 }, att: 0, def: 0, carry: 0, hours: 36 },
];

export type FlagId = 'licenzaCasino' | 'zonizzazione';

// ---------- Lotti e quartieri ----------
export type Zone = 'centro' | 'periferia' | 'industriale' | 'porto';
export const ZONE_LABEL: Record<Zone, string> = { centro: 'Centro', periferia: 'Periferia', industriale: 'Zona industriale', porto: 'Porto' };
export const ZONE_DESC: Record<Zone, string> = {
  centro: 'Attività legali +25% di reddito e +20% di influenza; racket +30% di calore.',
  periferia: 'Racket −25% di calore; attività legali −15% di reddito.',
  industriale: 'Racket +10% di rendita e −15% di calore; attività legali −10% di reddito.',
  porto: 'Contrabbando +40% di rendita; trasporti e logistica +20% di reddito.',
};
export const LOTS_BY_TIER = { 'Paese': 7, 'Cittadina': 9, 'Città': 13, 'Grande città': 18, 'Metropoli': 25 } as const;
export const PAYROLL = ['Nessuno', 'Un agente', 'Un sergente', 'Un tenente', 'Il capitano', 'Il commissario'];

// ---------- Città ----------
// Le città vere e proprie sono in world.ts (generate dai dati geografici).
export type CityDef = {
  id: string; name: string; state: string; stateAbbr: string; county: string; stateIdx: number; countyIdx: number;
  tier: 'Paese' | 'Cittadina' | 'Città' | 'Grande città' | 'Metropoli';
  pop: number; population: number; x: number; y: number;
  police: number; corruptible: number; legalGambling: boolean;
  demand: Partial<Record<Category, number>>; desc: string;
};

export const RIVAL_NAMES = ['i fratelli Kowalski', 'la banda di Duke Harlan', 'i Calloway', 'la crew di Ma Delgado', 'gli Okafor', 'i Vance', 'la banda del Messicano', 'i Lindqvist', 'gli Ortega', 'i Mahoney'];
export const REGION = 'la Regione';

// ---------- Costanti di gioco ----------
export const K = {
  start: { sporco: 15000, pulito: 0, influenza: 0, units: { picchiatori: 6 } as Partial<Record<UnitId, number>> },
  demandToCash: 120, // $/h di mercato per punto di domanda per unità di popolazione
  rivalShareStart: 0.4, wageReserveHours: 12, conquestKeep: 0.75, vacationDaysPerYear: 21, vacationMinDays: 2,
  warnGapHours: 6, retataCooldownHours: 48, indagineCooldownHours: 72, controlCooldownHours: 24, investMax: 0.3, investScale: 10_000_000, investMin: 50_000,
  // Calore
  heatScale: 40, heatApproachPerHour: 0.12, spikeDecayPerHour: 0.1,
  exposedPressurePer: 50000, guardPressure: 0.5,
  libroPagaMitigation: 1.5, libroPagaUpkeep: 150,
  thresholds: { controlli: 30, retata: 60, indagine: 85 },
  retataChancePerHour: 0.15, indagineChancePerHour: 0.12, controlliChancePerHour: 0.2,
  // Lavaggio
  launderFeeBase: 0.3, launderFeeMin: 0.1,
  influenceCap: 300, qgInfluence: 0.5, // influenza di base all'ora per livello del QG (il rispetto in città)
  // Tempi (ore)
  buildDivisor: 25000, unitDivisor: 20000, travelHours: 0.5,
  // Rivali
  protectionHours: 24, rivalAttackMin: 18, rivalAttackMax: 30,
  attackMin: 0.6, attackMax: 1.25, attackFloorBase: 20, attackFloorPerDay: 8, repelPauseHours: 12, warningBaseMin: 60, warningPerInformer: 30, warningMaxMin: 360,
  attackHeatSpike: 6, defendHeatSpike: 3,
  rivalBase: 40, rivalGrowth: 25, rivalExp: 0.95, rivalCap: 6000,
  // Bande del server: poche decine di uomini (si razziano presto); per prendere la città serve un Delfino.
  npcSquad: { picchiatori: [20, 30], soldati: [5, 10], enforcer: [3, 6] } as Partial<Record<UnitId, [number, number]>>,
  npcFort: 30,
  // Dopo un colpo alla cassa, la stessa città non si ripulisce per un giorno.
  raidCooldownHours: 24,
  // La capitale si sposta al massimo una volta a settimana.
  capitalMoveDays: 7,
  // Mappa e conquista
  travelBase: 0.25, travelSpeed: 100, // ore fisse + unità di mappa all'ora (mappa larga 975 ≈ 4.500 km)
  fortBase: 20, fortPerPop: 40, // difesa del quartier generale di una banda
  overPenalty: 0.15, overFloor: 0.4, // perdita di resa per ogni città oltre il limite di gestione
  federalDrop: 5, federalFloor: 65, // la soglia d'indagine scende di 5 per città in più
  acquireMaxShare: 0.5, acquirePulito: 150000, acquireInfluenza: 80,
  conquestHeat: 12, residualShare: 0.3,
  // Uscire dallo stato: influenza minima (nella città di partenza) per operare in uno stato dove non hai città
  stateInfluenceBase: 100, stateInfluenceStep: 75,
  inheritSameState: 0.2, inheritOtherState: 0.1,
  policeAdjHeat: 1.4, adjSynergy: 0.12,
  payrollBase: 8000, payrollGrowth: 1.8,
  bustarellaHeat: 10, bustarellaCooldown: 12,
  // Giri sugli isolati e ronde
  levelsPerGiro: 2, maxGiriPerBlock: 3, presidioPerBlock: 2, gangTurfShare: 0.6,
  highRouteHeat: 50, patrolBase: 0.5, patrolPerHeat: 1 / 40, heatPerPass: 0.1,
  // Trasloco, chiusure, spionaggio
  moveHours: 3, moveCostPerLevel: 3000, closeMin: 6, closeMax: 12, hitProtectHours: 24, reopenFactor: 0.25,
  alertHours: 12, alertMult: 1.2, completeBase: 0.25,
  // Sindaco
  campaignHours: 48, termDays: 7, campaignPulito: 60000, mayorUpkeep: 2, mayorDefense: 1.5, mayorDiscount: 0.5,
  mayorPressure: -8, mayorFederal: 5, reelectInfluence: 250,
  riskYellow: 1, riskOrange: 2.5, riskRed: 5, controlOrange: 0.02, controlRed: 0.075, controlHours: 4,
  safeBase: 10000, safeGrowth: 1.35,
};

export const SPEEDS = [0, 1, 10, 60, 600, 3600] as const;
