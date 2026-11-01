# Racket King Online — messa online su Railway

Un solo servizio fa tutto: serve il gioco, gestisce gli account e fa girare il mondo (WebSocket).
I dati stanno in PostgreSQL. Il tempo del mondo scorre 1:1 con quello reale.

## 1. Codice su GitHub
Il repository deve contenere questa cartella (con `Dockerfile` e `railway.json`).

## 2. Progetto su Railway
1. Vai su https://railway.com, accedi con GitHub.
2. **New Project → Deploy from GitHub repo** e scegli il repository.
3. Nel progetto: **+ New → Database → PostgreSQL**.
4. Apri il servizio del gioco → **Variables** → aggiungi
   `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Railway te lo propone già).
5. **Settings → Networking → Generate Domain**: ottieni un indirizzo tipo `racket-king.up.railway.app`
   (poi puoi collegare un tuo dominio, es. `racketking.it`, dalla stessa schermata).
6. Al deploy, apri `https://<indirizzo>/api/health`: deve rispondere `{"ok":true,...}`.

Importante: il servizio deve avere **una sola replica** (è già impostato in `railway.json`):
il mondo vive nella memoria di un processo e viene salvato nel database ogni 30 secondi e alla chiusura.

## 3. Variabili d'ambiente (Variables)
| Variabile | A cosa serve |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `PUBLIC_URL` | Opzionale. L'indirizzo pubblico (es. `https://racketking.it`). Se manca usa il dominio Railway. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Accesso con Google (vedi sotto). Senza, il pulsante non compare. |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | Accesso con Facebook (vedi sotto). Senza, il pulsante non compare. |
| `RESEND_API_KEY`, `MAIL_FROM` | Email per il recupero password. Senza, il link finisce nei log del server. |
| `ADMIN_PASSWORD` | Password della pagina `/admin` (lista della closed alpha). |
| `ALPHA_MODE` | `closed` (predefinito): si entra solo con alfa key. `open`: registrazione libera. |
| `SECRET` | Chiave per firmare le verifiche antibot (Render la genera da sola). |
| `WORLD_START` | Opzionale. Data di apertura del mondo (es. `2026-12-01T18:00:00Z`). Senza, parte al primo avvio. |

## Closed alpha
- La home è la landing della closed alpha: chi arriva lascia l'email (con doppia conferma se le email sono configurate).
- Vai su `https://<indirizzo>/admin`, entra con `ADMIN_PASSWORD`: vedi gli iscritti. **Give alfa key** manda la mail di accettazione
  con un link personale (vale 30 giorni, una volta, solo per quell'email). Senza email configurata, il pannello ti mostra il link da mandare a mano.
- Chi ha la chiave crea il boss dal link; poi rientra dalla home con **Ho un accesso alfa**.
- Difese: prova di calcolo nel browser, campo trappola, tempo minimo, limiti per IP, domini usa e getta e controllo MX.
  Per aggiungere Cloudflare Turnstile: crea un widget su https://dash.cloudflare.com → Turnstile e metti `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET`.
- Per aprire a tutti: `ALPHA_MODE=open`.

## 4. Accesso con Google
1. https://console.cloud.google.com → crea un progetto → **APIs & Services → OAuth consent screen**:
   tipo *External*, nome "Racket King Online", email di supporto, dominio.
2. **Credentials → Create credentials → OAuth client ID** → *Web application*.
3. **Authorized redirect URIs**: `https://<indirizzo>/api/auth/google/callback`
4. Copia *Client ID* e *Client secret* in `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.
5. Finché l'app è "in test", possono entrare solo gli utenti di test che aggiungi; per aprirla a tutti, **Publish app**.

## 5. Accesso con Facebook
1. https://developers.facebook.com/apps → **Create app** → *Authenticate and request data from users with Facebook Login*.
2. **Facebook Login → Settings → Valid OAuth Redirect URIs**: `https://<indirizzo>/api/auth/facebook/callback`
3. **App settings → Basic**: copia *App ID* e *App Secret* in `FACEBOOK_APP_ID` e `FACEBOOK_APP_SECRET`.
   Servono anche l'URL della privacy policy e dei termini di servizio.
4. Metti l'app in modalità **Live** per aprirla a tutti.

## 6. Email (recupero password)
1. https://resend.com → crea un account → **Domains**: aggiungi il tuo dominio e i record DNS che ti indica.
2. **API Keys** → crea una chiave → `RESEND_API_KEY`.
3. `MAIL_FROM` = `Racket King Online <noreply@tuodominio.it>` (deve essere del dominio verificato).

## 7. Costi indicativi (beta chiusa, fino a qualche centinaio di giocatori)
Railway Hobby: 5 $/mese inclusi nel piano, poi a consumo. Server + Postgres per una beta: circa 5–20 $/mese.
Resend: gratis fino a 3.000 email al mese.

## 8. Manutenzione
- **Stato del server**: `/api/health` (giorno del mondo, giocatori, collegati, tempi di calcolo).
- **Backup**: Railway → Postgres → *Backups*. Le tabelle importanti sono `users`, `world`, `slots`.
- **Nuova versione**: ogni push su GitHub fa ripartire il servizio; il mondo viene salvato prima di chiudere.
- **Ricominciare il mondo da zero** (es. fine della beta): svuota le tabelle `world` e `slots` e azzera `users.player_id`.

## Sviluppo locale
```
npm install
npm run build        # client in dist/
npm run server       # http://localhost:8080 (database PGlite in ./data)
npm test             # motore, mondo multiplayer, traduzioni
node scripts/bots.mjs http://localhost:8080 40 120   # giocatori finti (con AUTH_RATE=100000 sul server)
```
Per i test si può accelerare il tempo del mondo con `TIME_SCALE=3600` (un'ora di gioco al secondo). Mai in produzione.
