// Server di Racket King Online: un solo processo serve il gioco (file statici), gli account (API) e il mondo (WebSocket).
// Avvio: npm run server  (variabili: PORT, DATABASE_URL, PUBLIC_URL, GOOGLE_*, FACEBOOK_*, RESEND_API_KEY, MAIL_FROM)
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import compress from '@fastify/compress';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from './db';
import { Auth } from './auth';
import { Game } from './game';
import { alphaRoutes } from './alpha';
import { playerAdminRoutes } from './admin-players';
import formbody from '@fastify/formbody';

const PORT = Number(process.env.PORT ?? 8080);
const DIST = resolve(process.env.DIST_DIR ?? 'dist');

async function main() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true, bodyLimit: 64 * 1024 });
  const db = await openDb();
  const auth = new Auth(db);
  const game = new Game(db);
  await game.load();
  await game.loadUnread();

  await app.register(compress, { global: true, threshold: 2048, encodings: ['br', 'gzip'] });
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 32 * 1024, perMessageDeflate: { threshold: 1024 } } });

  // limite semplice sulle richieste di accesso: 20 ogni 10 minuti per indirizzo
  const hits = new Map<string, number[]>();
  app.addHook('onRequest', async (req, reply) => {
    if ((req.routeOptions.config as { rateLimit?: string } | undefined)?.rateLimit !== 'auth') return;
    const now = Date.now(); const k = req.ip; const list = (hits.get(k) ?? []).filter(x => now - x < 600_000); list.push(now); hits.set(k, list);
    if (list.length > Number(process.env.AUTH_RATE ?? 20)) return reply.code(429).send({ ok: false, msg: 'Troppi tentativi: riprova tra qualche minuto.' });
  });

  await app.register(formbody);
  auth.routes(app);
  alphaRoutes(app, db);
  playerAdminRoutes(app, db, game);

  app.get('/api/health', async () => game.health());

  app.get('/ws', { websocket: true }, async (socket, req) => {
    const user = await auth.userBySession(req.cookies[auth.cookieName()]);
    if (!user) { socket.send(JSON.stringify({ type: 'error', code: 'auth' })); socket.close(4001, 'auth'); return; }
    if (!user.name) { socket.send(JSON.stringify({ type: 'error', code: 'name' })); socket.close(4002, 'name'); return; }
    const sl = await game.playerFor(user);
    game.attach(socket, sl.id);
  });

  if (existsSync(DIST)) {
    await app.register(staticFiles, { root: DIST, index: 'index.html', maxAge: '1h', setHeaders: (res, path) => { if (path.endsWith('index.html')) res.header('cache-control', 'no-cache'); } });
  } else app.log.warn(`cartella del client non trovata (${DIST}): esegui npm run build`);

  game.start();
  const world = setInterval(() => game.broadcastWorld(), 60_000);

  const shutdown = async (sig: string) => {
    app.log.info(`${sig}: salvo il mondo e chiudo`);
    clearInterval(world);
    try { await game.stop(); await app.close(); await db.close(); } finally { process.exit(0); }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: PORT, host: '0.0.0.0' });
}

main().catch(e => { console.error(e); process.exit(1); });
