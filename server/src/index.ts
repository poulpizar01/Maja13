/* La Maja 13 — serveur : site vitrine + La Casa (espace membre)
   Express + PostgreSQL (Prisma) + Discord OAuth2. Les routes sont rangées par domaine dans routes/. */
import { join } from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import { config } from './config.js';
import { pool } from './db.js';
import { loadRanks } from './ranks.js';
import { storage } from './storage.js';
import { limits, securityHeaders } from './security.js';
import { auth } from './routes/auth.js';
import { members } from './routes/members.js';
import { hierarchy } from './routes/hierarchy.js';
import { gallery } from './routes/gallery.js';
import { chat } from './routes/chat.js';
import { bot } from './routes/bot.js';

await loadRanks();

const app = express();
app.set('trust proxy', 1);                     // derrière nginx (adresse IP réelle pour les limites de requêtes)
app.use(securityHeaders);
app.use(express.json({ limit: '32kb' }));
// session uniquement pour l'API et la connexion : les fichiers du site (css, js, images) ne lisent pas la base.
// disableTouch : pas d'écriture en base à chaque requête (le cookie n'est pas prolongé non plus, rolling désactivé).
app.use(['/api', '/auth'], session({
  store: new (connectPg(session))({ pool, tableName: 'session', disableTouch: true }),
  name: 'maja13.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.baseUrl.startsWith('https'), maxAge: 30 * 24 * 3600 * 1000 },
}));

app.use('/auth', limits.auth);
app.use('/api', limits.api);
app.use(auth, members, hierarchy, gallery, chat, bot);

// ---------- site statique : uniquement ce qui est public ----------
// casa/ et assets/, plus les fichiers de la racine du site (pages, css, js, robots.txt, sitemap.xml) ;
// jamais le reste du dépôt (code du serveur, compose.yaml, README…), quelle que soit l'écriture de l'adresse.
const pages: Parameters<typeof express.static>[1] = { extensions: ['html'], index: 'index.html', dotfiles: 'ignore' };
app.use('/casa', express.static(join(config.root, 'casa'), pages));
app.use('/assets', express.static(join(config.root, 'assets'), { dotfiles: 'ignore', maxAge: '7d' }));
const rootFiles = express.static(config.root, pages);
app.use((req, res, next) => { if (/^\/([\w-]+\.(html|css|js|txt|xml))?$/.test(req.path)) rootFiles(req, res, next); else next(); });
app.use((_req, res) => { res.status(404).sendFile(join(config.root, '404.html'), err => { if (err) res.send('404'); }); });

// erreur imprévue dans une route : journalisée, réponse générique
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'erreur serveur' });
};
app.use(onError);

console.log(`Stockage des images : ${storage.kind === 'cdn' ? 'CDN' : `local (${storage.dir})`}`);
app.listen(config.port, '0.0.0.0', () => console.log(`La Maja 13 en écoute sur le port ${config.port} (${config.baseUrl})`));
