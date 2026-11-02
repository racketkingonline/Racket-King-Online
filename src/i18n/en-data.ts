// Traduzioni inglesi: chiave = testo italiano esatto (con i segnaposto {nome}).
// Nomi e descrizioni dei cataloghi (data.ts, layout.ts, world.ts, POLICE/MAYOR in engine.ts).
// Le versioni in minuscolo servono quando il nome compare dentro una frase ("reclutati 3 picchiatori").
import { K } from '../engine/data';
import { GANG_FORMS, gangNameOf, SURNAMES } from '../engine/world';

/** Nomi delle bande: "i Moreno" → "the Morenos", "la crew di Ma Byrne" → "Ma Byrne's crew" (anche con l'iniziale maiuscola). */
const plural = (s: string) => (/(s|x|z|ch|sh)$/.test(s) ? s + 'es' : s + 's');
const GANG_EN: ((s: string) => string)[] = [
  s => `the ${s} brothers`, // i fratelli %
  s => `Duke ${s}'s gang`, // la banda di Duke %
  s => `the ${plural(s)}`, // i %
  s => `Ma ${s}'s crew`, // la crew di Ma %
  s => `${s}'s men`, // gli uomini di %
  s => `the ${s} family`, // la famiglia %
];
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const GANGS: Record<string, string> = {};
for (const s of SURNAMES) GANG_FORMS.forEach((_, f) => {
  const it = gangNameOf(s, f), en = GANG_EN[f](s);
  GANGS[it] = en; GANGS[cap(it)] = cap(en);
});
if (GANG_EN.length !== GANG_FORMS.length) throw new Error('en-data: GANG_EN e GANG_FORMS non sono allineati');

export const EN_DATA: Record<string, string> = {
  ...GANGS,
  'la banda del Messicano': "the Mexican's gang",
  'La banda del Messicano': "The Mexican's gang",
  'la Regione': 'the Region',

  // ---------- fasce delle città
  'Paese': 'Village',
  'Cittadina': 'Town',
  'Città': 'City',
  'Grande città': 'Big city',
  'Metropoli': 'Metropolis',

  // ---------- descrizioni delle città (world.ts, FLAVOR)
  'Pochi abitanti e tutti si conoscono.': 'A handful of folks, and everybody knows everybody.',
  'Un distributore, una chiesa, un bar. E nessuno che guarda.': "A gas station, a church, a bar. And nobody watching.",
  "Campi a perdita d'occhio e uno sceriffo stanco.": 'Fields as far as the eye can see and a tired sheriff.',
  'Una via principale e vecchie famiglie.': 'One Main Street and a few old families.',
  'Fabbriche chiuse e gente indebitata.': 'Shuttered factories and people up to their necks in debt.',
  'Tranquilla in superficie.': 'Quiet on the surface.',
  'Abbastanza grande per sparire, abbastanza piccola per farsi notare.': 'Big enough to disappear in, small enough to get noticed.',
  'Quartieri che cambiano padrone ogni inverno.': 'Neighborhoods that change hands every winter.',
  'Un porto, un mercato, qualche sindacato.': 'A port, a market, a few unions.',
  'Soldi veri e polizia vera.': 'Real money and real cops.',
  'Ogni quartiere ha già un padrone.': 'Every neighborhood already has an owner.',
  'Politica, cemento e appalti.': 'Politics, concrete and contracts.',
  'Il gioco grande. Qui si entra solo con un esercito o con un senatore.': 'The big game. You only get in here with an army or a senator.',
  'Tutte le famiglie del paese hanno un piede qui.': 'Every family in the country has a foot in the door here.',

  // ---------- categorie
  'Protezione': 'Protection',
  'Scommesse': 'Betting',
  'Prestiti': 'Loans',
  'Auto': 'Cars',
  'Contrabbando': 'Smuggling',
  'Merce': 'Product',
  'Armi': 'Weapons',
  'Ristorazione': 'Food & drink',
  'Servizi': 'Services',
  'Vita notturna': 'Nightlife',
  'Trasporti': 'Transport',
  'Edilizia': 'Construction',
  'Immobiliare': 'Real estate',
  'Media': 'Media',
  'Gioco legale': 'Legal gambling',

  // ---------- racket
  'Pizzo': 'Protection racket',
  'pizzo': 'protection racket',
  'Protezione ai negozi del quartiere. Poco ma sicuro.': "Protection for the neighborhood shops. Not much, but it's steady.",
  'Bische e scommesse': 'Card games & bookmaking',
  'bische e scommesse': 'card games & bookmaking',
  'Tavoli nel retro e allibratori.': 'Tables in the back room and bookies.',
  'Usura': 'Loansharking',
  'usura': 'loansharking',
  'Prestiti a chi la banca ha già detto di no.': 'Loans for people the bank already turned down.',
  "Ricettazione e furti d'auto": 'Fencing & car theft',
  "ricettazione e furti d'auto": 'fencing & car theft',
  'Auto rubate, smontate e rivendute a pezzi.': 'Stolen cars, stripped and sold for parts.',
  'contrabbando': 'smuggling',
  'Sigarette e alcol senza accise.': 'Cigarettes and booze, no tax stamps.',
  'merce': 'product',
  'Il giro più ricco e più pericoloso della città.': 'The richest and most dangerous racket in town.',
  "Traffico d'armi": 'Gunrunning',
  "traffico d'armi": 'gunrunning',
  'Si vende a chiunque paghi.': 'Sold to anyone who pays.',

  // ---------- attività legali (front)
  'Bar e ristorante': 'Bar & grill',
  'Il primo front: il bancone vede passare di tutto.': 'The first front: everything goes across that counter.',
  'Lavanderia e autolavaggio': 'Laundromat & car wash',
  'Il front classico: lava tanto, rende poco.': 'The classic front: washes a lot, earns little.',
  'Concessionaria': 'Car dealership',
  'Auto usate, provenienza discutibile.': 'Used cars, questionable provenance.',
  'Night club': 'Nightclub',
  'Musica alta, domande poche.': 'Loud music, few questions.',
  'Trasporti e logistica': 'Trucking & logistics',
  'Camion che vanno ovunque.': 'Trucks that go anywhere.',
  'Impresa edile': 'Construction company',
  'Cemento, appalti, amici in comune.': 'Concrete, contracts, mutual friends.',
  'Affitti puliti e una città che cresce.': 'Clean rents and a growing town.',
  'Media locale': 'Local media',
  'Radio e giornale: decidi tu cosa fa notizia.': 'Radio and the paper: you decide what makes the news.',
  'Casinò': 'Casino',
  'Il front definitivo. Serve la licenza.': 'The ultimate front. Needs a license.',

  // ---------- strutture
  'Quartier generale': 'Headquarters',
  'quartier generale': 'the HQ',
  'Velocizza i lavori e sblocca le attività più grandi. Uno per città.': 'Speeds up construction and unlocks the bigger businesses. One per city.',
  'Cassaforte': 'Safe',
  'cassaforte': 'the safe',
  'Il contante sporco qui dentro non si razzia e non si sequestra.': "Dirty cash in here can't be raided or seized.",
  'Armeria': 'Armory',
  'armeria': 'the armory',
  'Velocizza il reclutamento e sblocca i giri pesanti.': 'Speeds up recruiting and unlocks the heavy rackets.',

  // ---------- know-how
  'Contabilità creativa': 'Creative accounting',
  'Commissione di lavaggio −2% e capacità +10% per livello.': 'Laundering fee −2% and capacity +10% per level.',
  'Corruzione': 'Corruption',
  'Poliziotti a libro paga +20% di efficacia per livello.': 'Cops on the payroll +20% effectiveness per level.',
  'Tattica': 'Tactics',
  'Attacco e difesa della crew +10% per livello.': 'Crew attack and defense +10% per level.',
  'Logistica': 'Logistics',
  'Spostamenti −10% di tempo per livello. Sblocca il contrabbando.': 'Travel time −10% per level. Unlocks smuggling.',
  'Gestione': 'Management',
  'Una città in più gestibile senza perdite per livello.': 'One more city you can run without losses, per level.',
  'Comunicazioni cifrate': 'Encrypted communications',
  'Spionaggio più efficace; calore dagli attacchi −10% per livello.': 'Better scouting; heat from attacks −10% per level.',

  // ---------- crew
  'Picchiatori': 'Thugs',
  'picchiatori': 'thugs',
  'Economici. Fanno numero.': 'Cheap. They make up the numbers.',
  'Soldati': 'Soldiers',
  'soldati': 'soldiers',
  'Armati. Il grosso di attacchi e difese.': 'Armed. The backbone of attack and defense.',
  'Enforcer': 'Enforcers',
  'enforcer': 'enforcers',
  'Pesanti. Sfondano qualunque porta.': 'Heavy hitters. They kick down any door.',
  'Informatori': 'Informants',
  'informatori': 'informants',
  'Spiano i rivali e avvisano degli attacchi.': 'They spy on rivals and warn you of attacks.',
  'Corrieri': 'Couriers',
  'corrieri': 'couriers',
  'Portano a casa il bottino.': 'They haul the loot home.',
  'Avvocati': 'Lawyers',
  'avvocati': 'lawyers',
  'Riducono sequestri, arresti e calore.': 'They cut seizures, arrests and heat.',
  'Contabili': 'Accountants',
  'contabili': 'accountants',
  'Lavano di più e trattengono meno.': 'They launder more and skim less.',
  'Guardie giurate': 'Security guards',
  'guardie giurate': 'security guards',
  'Proteggono i front senza calore, ma sono deboli.': 'They guard your fronts without drawing heat, but they are weak.',
  'Delfino': 'Heir',
  'delfino': 'heirs',
  "L'erede che governa le città che prendi. Si arruola solo nella capitale, uno alla volta.": 'The heir who runs the cities you take. Recruited only in your capital, one at a time.',

  // una sola unità (squadre e reclutamenti: "1 soldati" → "1 soldier")
  '1 picchiatori': '1 thug',
  '1 soldati': '1 soldier',
  '1 enforcer': '1 enforcer',
  '1 informatori': '1 informant',
  '1 corrieri': '1 courier',
  '1 avvocati': '1 lawyer',
  '1 contabili': '1 accountant',
  '1 guardie giurate': '1 security guard',
  '1 delfino': '1 heir',

  // ---------- requisiti speciali
  'Licenza per il casinò (municipio)': 'Casino license (City Hall)',
  'Zonizzazione': 'Zoning',

  // ---------- quartieri e isolati
  'Centro': 'Downtown',
  'Periferia': 'Outskirts',
  'Zona industriale': 'Industrial district',
  'Porto': 'Docks',
  'Attività legali +25% di reddito e +20% di influenza; racket +30% di calore.': 'Fronts +25% income and +20% influence; rackets +30% heat.',
  'Racket −25% di calore; attività legali −15% di reddito.': 'Rackets −25% heat; fronts −15% income.',
  'Racket +10% di rendita e −15% di calore; attività legali −10% di reddito.': 'Rackets +10% take and −15% heat; fronts −10% income.',
  'Contrabbando +40% di rendita; trasporti e logistica +20% di reddito.': 'Smuggling +40% take; trucking & logistics +20% income.',
  'Uffici e negozi': 'Offices & shops',
  'Palazzi': 'Apartment blocks',
  'Case': 'Houses',
  'Magazzini': 'Warehouses',
  'Banchine del porto': 'Wharves',
  'Parco': 'Park',

  // ---------- libro paga
  'Nessuno': 'Nobody',
  'Un agente': 'A patrolman',
  'Un sergente': 'A sergeant',
  'Un tenente': 'A lieutenant',
  'Il capitano': 'The captain',
  'Il commissario': 'The commissioner',

  // ---------- centrale di polizia (POLICE)
  'Soffiata su una banda': 'Rat out a gang',
  "La polizia arresta un quarto della banda; la sua presa scende del 5%. Si può puntare questa città o un'altra.": 'The cops lock up a quarter of the gang; its grip drops 5%. Target this city or another one.',
  'Chiudere un occhio': 'Look the other way',
  'Il comando guarda altrove: pressione del calore −15 per 24 ore.': 'The precinct looks elsewhere: heat pressure −15 for 24 hours.',
  'Il comando chiude un occhio': 'The precinct looks the other way',
  'Bustarella': 'Bribe',
  [`Calore −${K.bustarellaHeat} subito. Si può fare ogni ${K.bustarellaCooldown} ore.`]: `Heat −${K.bustarellaHeat} right away. Can be done every ${K.bustarellaCooldown} hours.`,

  // ---------- municipio (MAYOR) ed effetti
  'Incontro di boxe': 'Boxing match',
  'incontro di boxe': 'boxing match',
  'Domanda di scommesse +40% per 24 ore.': 'Betting demand +40% for 24 hours.',
  'Fiera di contea': 'County fair',
  'fiera di contea': 'county fair',
  'Ristorazione e vita notturna +30% per 24 ore.': 'Food & drink and nightlife +30% for 24 hours.',
  'Fiera (ristorazione)': 'Fair (food & drink)',
  'Fiera (vita notturna)': 'Fair (nightlife)',
  'Serata di beneficenza': 'Charity gala',
  'serata di beneficenza': 'charity gala',
  '+10 influenza in questa città; calore temporaneo −5.': '+10 influence in this city; temporary heat −5.',
  'Zonizzazione notturna': 'Late-night zoning',
  'zonizzazione notturna': 'late-night zoning',
  'Locali aperti fino a tardi: vita notturna +25% per sempre in questa città.': 'Bars open late: nightlife +25% for good in this city.',
  'Licenza per il casinò': 'Casino license',
  'licenza per il casinò': 'casino license',
  'Permette di aprire un casinò in questa città.': 'Lets you open a casino in this city.',
};
