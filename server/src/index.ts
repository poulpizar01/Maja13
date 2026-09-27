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
import { auth } from './routes/auth.js';
import { members } from './routes/members.js';
import { hierarchy } from './routes/hierarchy.js';
import { gallery } from './routes/gallery.js';
import { chat } from './routes/chat.js';
import { bot } from './routes/bot.js';

await loadRanks();

const app = express();
app.set('trust proxy', 1);                     // derrière nginx
app.use(express.json({ limit: '32kb' }));
app.use(session({
  store: new (connectPg(session))({ pool, tableName: 'session' }),
  name: 'maja13.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.baseUrl.startsWith('https'), maxAge: 30 * 24 * 3600 * 1000 },
}));

app.use(auth, members, hierarchy, gallery, chat, bot);

// ---------- site statique (racine du dépôt) ----------
app.use((req, res, next) => { if (req.path.startsWith('/server/')) res.status(404).end(); else next(); });
app.use(express.static(config.root, { extensions: ['html'], index: 'index.html', dotfiles: 'ignore' }));
app.use((_req, res) => { res.status(404).sendFile(join(config.root, '404.html'), err => { if (err) res.send('404'); }); });

// erreur imprévue dans une route : journalisée, réponse générique
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'erreur serveur' });
};
app.use(onError);

console.log(`Stockage des images : ${storage.kind === 'cdn' ? 'CDN' : `local (${storage.dir})`}`);
app.listen(config.port, '0.0.0.0', () => console.log(`La Maja 13 en écoute sur le port ${config.port} (${config.baseUrl})`));
