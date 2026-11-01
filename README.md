# Impero — prototipo

Gioco di strategia "alla OGame" a tema impero criminale contemporaneo. Prototipo giocabile in locale, senza server: **gli Stati Uniti interi** (51 stati compreso il Distretto di Columbia, 3.142 contee, 17.122 città) da conquistare partendo da una cittadina.

## Avvio

```bash
npm install
npm run dev        # sviluppo, http://localhost:5173
npm test           # test del motore delle regole
npm run build      # build in un unico file dist/index.html
node scripts/build-map.mjs          # rigenera src/map/*.json dai dati geografici
npx tsx scripts/sim.ts bilanciata   # simulazione di bilanciamento su 21 giorni (anche: sporco, espansione)
```

## Struttura

```
src/engine/data.ts      Tutti i numeri di bilanciamento (racket, front, strutture, know-how, crew, città, costanti)
src/engine/engine.ts    Motore delle regole: stato, tick, azioni, calore, mercato, combattimento, rivale NPC
src/engine/engine.test.ts
src/App.tsx             Interfaccia React
src/engine/seasons.ts   Stagioni: infrastruttura pronta (calendario, annunci, modificatori), calendario vuoto
scripts/sim.ts          Bot che gioca da solo per verificare il bilanciamento
scripts/mp.ts           Playtest multiplayer simulato: N bot sullo stesso server (regole del server v2 incluse)
scripts/analyze-mp.ts   Analisi di un playtest multiplayer
scripts/compare.ts      Confronto tra più playtest allo stesso giorno
```

Playtest multiplayer: `npx tsx scripts/mp.ts 300 90 /tmp/run 0` (300 giocatori, 90 giorni, cartella, seme), poi
`npx tsx scripts/analyze-mp.ts /tmp/run` o `npx tsx scripts/compare.ts 90 /tmp/run1 /tmp/run2`.

Il motore è **TypeScript puro**: non usa DOM, React né orologi di sistema. Il tempo avanza solo con `tick(state, secondi)` e il caso passa da un RNG con seme salvato nello stato. Quindi:

- la stessa partita con lo stesso seme dà sempre lo stesso risultato (testato);
- lo stato è JSON puro e si salva/ricarica senza perdite (testato).

## Collegare il server, dopo

Il motore è pensato per spostarsi sul server senza riscritture:

1. Il server (Node) importa `src/engine` così com'è e diventa l'unica fonte di verità.
2. Il client manda solo **azioni** (`Action`: upgrade, recruit, raid, …); il server le valida con `act()` e fa avanzare il tempo con `tick()`.
3. Il client può continuare a usare `tick()` in locale per l'animazione tra un aggiornamento e l'altro (previsione), riallineandosi allo stato del server.
4. Da sostituire: `localStorage` (oggi in `App.tsx`) con le chiamate al server; il rivale NPC con giocatori veri e città NPC della mappa.

## Vista della città (novità)

- Ogni città ha una disposizione generata dal suo id (`src/engine/layout.ts`): isolati su griglia (4×4 per un paese, fino a 8×8 per una metropoli), quartieri (centro, periferia, zona industriale, porto), lotti edificabili, centrale di polizia e municipio sempre presenti.
- Lotti per fascia: Paese 7, Cittadina 9, Città 13, Grande città 18, Metropoli 25. Gli altri isolati sono uffici, case, magazzini e parchi dei cittadini (non cliccabili).
- Su ogni lotto si costruisce un racket (uno per tipo), un'attività legale o una struttura (doppioni ammessi, tranne il quartier generale). I doppioni rendono sempre meno perché il mercato si satura per categoria.
- Quartieri: centro (legali +25% reddito e +20% influenza, racket +30% calore), periferia (racket −25% calore), zona industriale, porto (contrabbando +40%). Racket accanto alla polizia: +40% calore. Attività legale accanto al racket che potenzia: più sinergia.
- Centrale di polizia: libro paga a livelli (da un agente al commissario), soffiate, "chiudere un occhio", bustarella.
- Municipio: eventi, zonizzazione e licenza del casinò, per città.
- Influenza per città (tetto 300), prodotta da QG e attività legali. Una città conquistata o comprata eredita il 20% di influenza e calore dalla città di partenza (10% se in un altro stato).
- Vista 3D (`src/city/City3D.tsx`, Three.js): isometrica, stile plastico bianco su strade azzurre; i racket sembrano edifici qualunque; auto e pattuglie (più pattuglie con più calore), ferrovia sopraelevata nelle città grandi.

## Giri, ronde e protezioni (novità)

- Ogni 2 livelli di un racket hai un "giro" da piazzare su un isolato dei cittadini (massimo 3 giri per isolato). La resa del racket passa dai giri: ognuno vale quanto l'isolato è adatto (case per usura e spaccio, uffici per pizzo e bische, magazzini per ricettazione e armi, porto per il contrabbando).
- Ogni isolato occupato chiede un presidio di 2 uomini (picchiatori, soldati o enforcer in città); se mancano, i giri rendono meno.
- La banda rivale occupa isolati in proporzione alla sua fetta di mercato: lì non puoi piazzare giri finché non la indebolisci.
- Ronde fisse per città (strisce blu); sopra calore 50 si accende una seconda ronda, anch'essa fissa. Più calore, più passaggi.
- Grado di calore di un isolato = giri − protezioni. Rischio di controlli = grado × strade con ronda intorno × passaggi; il bordo dell'isolato va da verde a rosso. Da arancio in su possono arrivare controlli (sequestro della rendita del giro e arresti del presidio), sempre annunciati nei rapporti. I giri ammucchiati sulle ronde scaldano anche la città.
- Libro paga: ogni grado è un punto protezione da piazzare su un isolato.
- I nuovi giri si piazzano da soli sugli isolati migliori; si spostano a mano cliccando l'isolato.
- Rapporti di battaglia con il dettaglio di forze, perdite e motivo della sconfitta.

## Spionaggio, attacchi mirati, trasloco e sindaco (novità)

- Nelle tue città non ci sono bande: le minacce arrivano dalla banda della città vicina più prossima.
- Le città delle bande hanno edifici veri sui lotti (QG, cassaforte, racket, attività legali, a volte un'armeria) che crescono col tempo.
- Spionaggio graduato: intercettato, parziale (racket, QG e cassaforte sembrano palazzi qualunque) o completo. Il rapporto è una foto della città, visibile in 3D dalla Mappa ("Guarda la città").
- Colpo a un edificio visto nel rapporto: lo chiude per 6–12 ore (e lo protegge da altri colpi per 24 ore). Racket e attività chiuse abbassano la presa della banda; dalla cassaforte si porta via contante.
- Si conquista solo prendendo il quartier generale. Assalto alla cieca su un palazzo sconosciuto: se non è il QG chiudi quell'edificio e la banda va in allerta (+20% di difesa per 12 ore). Con metà dei loro edifici chiusi il QG viene allo scoperto anche in un rapporto parziale. Conquistando il QG le loro attività passano a te a metà livello.
- Il QG (tetto rosso) e la cassaforte (tetto verde) sembrano palazzi d'appartamenti; si possono traslocare su un altro lotto o nasconderli dentro un'attività legale o un racket, che libera un lotto ma ne condivide la sorte (retate, sabotaggi, sequestri).
- I sabotaggi non tolgono livelli: chiudono l'edificio per qualche ora. Si può riaprire subito pagando.
- Sindaco: con influenza al massimo e calore sotto la soglia delle retate ti candidi (campagna di 48 ore, costa contante pulito). Mandato di 7 giorni in una sola città: +2 lotti accanto al municipio, municipio a metà prezzo, −8 di calore, difesa +50%. Costa 2 di influenza all'ora e abbassa di 5 la soglia dell'indagine federale ovunque. Cadi per scandalo (calore oltre la soglia dell'indagine), per influenza finita o se a fine mandato non hai almeno 250 di influenza e calore sotto le retate.

## Cosa c'è in questo prototipo

- Contante sporco, contante pulito, influenza e calore.
- 7 racket con domanda cittadina e saturazione del mercato; 9 attività legali con lavaggio, reddito pulito, influenza, copertura e sinergie.
- Quota di lavaggio regolabile (0–100% della rendita sporca) e commissione.
- Calore con pressioni e mitigazioni, tre soglie (controlli, retate, indagine federale) e tre avvisi prima di ogni catastrofe.
- Cassaforte, quartier generale, armeria, poliziotti a libro paga; 5 rami di know-how.
- 8 tipi di crew con stipendi; criminali a guardia dei front (più difesa, più calore e rischio di sequestro).
- Rivale NPC che cresce, attacca con preavviso (razzie e sabotaggi), si può spiare e colpire.
- Eventi e favori politici (boxe, fiera, beneficenza, capitano a libro paga, soffiata, zonizzazione, licenza del casinò).
- Mappa reale degli Stati Uniti su canvas (zoom, spostamento, ricerca): confini di stati e contee da us-atlas (U.S. Census Bureau), città e popolazioni da GeoNames (CC BY 4.0). Le città con almeno 1.000 abitanti disponibili nei dati sono 17.122.
- Ogni città ha una fascia (Paese, Cittadina, Città, Grande città, Metropoli) che decide forza della banda, fortificazioni e mercato; domanda, polizia e corruttibilità sono generate in modo deterministico dall'id della città.
- Le città mai toccate non occupano spazio nello stato: vengono generate al volo e salvate solo quando le spii, le colpisci o le conquisti.
- Per colpire, assaltare o comprare in uno stato dove non hai città serve un minimo di influenza (100, poi +75 per ogni stato in più); il tetto di influenza sale di 100 per ogni stato in cui sei presente.
- Ogni città ha i suoi racket, attività legali, strutture, uomini, calore e coda di lavori; risorse e know-how sono dell'impero.
- Missioni tra città con tempi di viaggio: spionaggio, colpo (bottino e banda indebolita), assalto al covo (conquista), trasferimento di uomini.
- Acquisizione: compri una città con contante pulito e influenza quando la banda è sotto il 50% di presa, senza calore.
- Limite di città gestibili (know-how Gestione): oltre il limite tutte le città rendono il 15% in meno per città in eccesso.
- La soglia dell'indagine federale scende di 5 punti per ogni città in più.
- Tempo accelerabile (fino a 3600×) e progresso offline (al massimo 12 ore, a velocità 1×).

## Regole v2, dopo il primo playtest multiplayer (novità)

Nel motore (valgono anche nel prototipo):
- **Lavaggio:** non tocca mai le 12 ore di stipendi successive (prima svuotava la cassa e la crew disertava).
- **Controlli sugli isolati:** probabilità dimezzata.
- **Bande del gioco:** crescono più piano e hanno un tetto (6.000), così restano un bersaglio possibile anche a server avanzato.
- **Conquista:** gli edifici della città presa scendono al 75% del livello invece che alla metà.
- **Avvisi di attacco:** 60 minuti più 30 per informatore, fino a 6 ore.
- **Modalità vacanza:** fino a 21 giorni l'anno (almeno 2 alla volta); tutto si ferma e le scadenze slittano.
- **Postura difensiva:** all'avviso di un attacco recluta da sola quanto serve, entro una quota dello sporco.
- **Stagioni:** l'infrastruttura c'è (annuncio 7 giorni prima, 21 giorni di durata, modificatori globali), ma il calendario è vuoto. Le bozze provate nel playtest sono in `SEASON_DRAFTS`; il server le attiverà con `setSeasonCalendar()` quando si deciderà a gioco avviato.

Regole v3 (dopo il secondo playtest):
- **Polizia:** gli avvisi arrivano uno ogni 6 ore (prima potevano arrivare tutti e tre insieme). Dopo una retata 48 ore di tregua, dopo un'indagine 72; un isolato controllato resta tranquillo per 24 ore.
- **Investimenti:** il pulito in eccesso si investe e fa salire tutte le rendite, fino a +30% (circa metà con 7 milioni). Non torna indietro.

Nel server (oggi solo nel simulatore `scripts/mp.ts`):
- **Capitali:** non si conquistano, si sottomettono. Chi viene sottomesso tiene la città e diventa vassallo.
- **Uscita dal vassallaggio:** dopo 30 giorni senza perdere città, oppure con un riscatto in pulito (dopo almeno 7 giorni): 150.000 più una settimana del proprio reddito più un quarto della settimana del capo.
- **Famiglia:** il capo copre i vassalli con un quarto della difesa della sua capitale; i vassalli gli versano il 15% del reddito sporco.
- **Protezioni:** 5 giorni per i nuovi, 72 ore dopo ogni perdita, nessun attacco a chi ha meno del 20% del tuo punteggio (salvo inattivo da 7 giorni), nessun attacco a chi è in vacanza.

## Non ancora presente

Famiglia (città proprie e affidate), alleanze, altri giocatori nel prototipo giocabile (ci sono solo nel simulatore), quadri con nome. Sono descritti nello schema di game design.
