/* Serveur du site : vitrine + espace membre.
   Express + PostgreSQL (Prisma) + Discord OAuth2. Les routes sont rangées par domaine dans routes/. */
import { join } from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import { config } from './config.js';
import { pool, prisma } from './db.js';
import { planifierPurge } from './purge.js';
import { loadRanks } from './ranks.js';
import { storage } from './storage.js';
import { cspNonce, limits, securityHeaders } from './security.js';
import { site, pages, renderFile, withNonce } from './site.js';
import { auth } from './routes/auth.js';
import { members } from './routes/members.js';
import { hierarchy } from './routes/hierarchy.js';
import { gallery } from './routes/gallery.js';
import { chat } from './routes/chat.js';
import { bot } from './routes/bot.js';

await loadRanks();
planifierPurge();

const app = express();
app.set('trust proxy', 1);                     // derrière nginx (adresse IP réelle pour les limites de requêtes)
app.use(cspNonce, securityHeaders);
app.use(express.json({ limit: '32kb' }));

// santé du site (contrôle Docker) : le serveur répond et la base aussi ; hors limites de requêtes et sans session
app.get('/healthz', async (_req, res) => {
  try { await pool.query('select 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
});

// Session : seulement pour l'API, la connexion et l'accueil de l'espace membre — jamais pour les fichiers du site
// (css, js, images), qui sans ça coûteraient chacun une lecture en base. disableTouch : pas d'écriture en base à
// chaque requête (la session expire à date fixe). 7 jours : la connexion Discord, qui revérifie l'appartenance au
// serveur, le grade et la propriété, a lieu au moins chaque semaine (même rythme que la connexion au bot).
const sessions = session({
  store: new (connectPg(session))({ pool, tableName: 'session', disableTouch: true }),
  name: 'site.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.baseUrl.startsWith('https'), maxAge: 7 * 24 * 3600 * 1000 },
});
app.use(['/api', '/auth'], sessions);

app.use('/auth', limits.auth);
app.use('/api', limits.api);
app.use(auth, members, hierarchy, gallery, chat, bot);

// ---------- site statique : uniquement ce qui est public ----------
// espace/ et assets/, plus les fichiers de la racine du site (pages, css, js, robots.txt, sitemap.xml) ;
// jamais le reste du dépôt (code du serveur, compose.yaml, README…), quelle que soit l'écriture de l'adresse.
// Les pages (.html, .txt, .xml) passent par site.ts, qui y insère l'identité du site (site.json).
const statics: Parameters<typeof express.static>[1] = { index: false, dotfiles: 'ignore' };
// session déjà ouverte : /espace/ mène droit au profil (ou à l'attente), sans afficher la page de connexion
// qui redirigeait elle-même en JavaScript — un second chargement, visible, juste après l'arrivée
app.get(['/espace', '/espace/', '/espace/index.html'], sessions, async (req, res, next) => {
  if (!req.session.memberId) return next();
  const m = await prisma.member.findUnique({ where: { id: req.session.memberId }, select: { status: true } });
  if (!m) return next();
  res.redirect(m.status === 'approved' ? '/espace/profil.html' : '/espace/attente.html');
});
app.use('/espace', pages(join(config.root, 'espace')), express.static(join(config.root, 'espace'), statics));
// images gardées 7 jours par les navigateurs en production ; en dev, toujours revalidées (un visuel changé s'affiche aussitôt)
app.use('/assets', express.static(join(config.root, 'assets'), { dotfiles: 'ignore', maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0 }));
const rootPages = pages(config.root), rootFiles = express.static(config.root, statics);
app.use((req, res, next) => {
  if (!/^\/([\w-]+(\.(html|css|js|txt|xml))?)?$/.test(req.path)) return next();
  rootPages(req, res, () => rootFiles(req, res, next));
});
app.use((_req, res) => {
  try { res.status(404).type('html').send(withNonce(renderFile(join(config.root, '404.html')), res)); } catch { res.status(404).send('404'); }
});

// erreur imprévue dans une route : journalisée, réponse générique
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'erreur serveur' });
};
app.use(onError);

console.log(`Stockage des images : ${storage.kind === 'cdn' ? 'CDN' : storage.kind === 'local' ? `local, dev uniquement (${storage.dir})` : 'aucun (envoi désactivé)'}`);
app.listen(config.port, '0.0.0.0', () => console.log(`${site.nom} en écoute sur le port ${config.port} (${config.baseUrl})`));
