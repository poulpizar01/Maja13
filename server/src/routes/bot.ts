// Bot Discord (géré à part) : La Casa lit ses données via son API REST, en lecture seule.
// Le bot n'accepte que des jetons personnels, obtenus par sa propre connexion Discord :
//   /auth/bot → <bot>/auth/login?guild=… → Discord → <bot>/auth/callback
//   → site externe configuré dans Discord (/config site-externe set …/casa/bot-callback.html) avec #token=…
//   → POST /api/bot/link : jeton vérifié puis gardé dans la session (jamais exposé au navigateur ensuite).
// Les droits (admin, taxes) sont décidés par le bot à chaque requête, d'après les rôles Discord.
import { Router, type Request } from 'express';
import { config } from '../config.js';
import { body, member } from '../http.js';
import { byMember, limiter } from '../security.js';

export const bot = Router();

type BotMe = { id: string; username: string; isAdmin: boolean; isTaxes: boolean; guildId: string };

// ---------- cache en mémoire vive des lectures réussies ----------
// L'API du bot limite tout le site à 300 requêtes / 15 min : une réponse déjà lue est resservie quelques minutes.
// Rien sur disque ni en base, tout disparaît au redémarrage ; un cache par membre (ses droits dans le bot).
const cache = new Map<string, { expires: number; data: unknown }>();
const MAX_ENTRIES = 5000;
const ttl = (path: string) => (/[?&]week=/.test(path) ? 24 * 3600e3 : 5 * 60e3);   // semaine passée : figée ; le reste : 5 min
const cacheKey = (req: Request, path: string) => `${req.session.memberId}|${path}`;
function cached(req: Request, path: string): unknown {
  const key = cacheKey(req, path), hit = cache.get(key);
  if (hit && hit.expires < Date.now()) cache.delete(key);
  else return hit?.data;
}
function remember(req: Request, path: string, data: unknown) {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);   // la plus ancienne
  cache.set(cacheKey(req, path), { expires: Date.now() + ttl(path), data });
}
function forget(req: Request) {
  const prefix = `${req.session.memberId}|`;
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}

// appel à l'API du bot avec le jeton du membre ; un jeton refusé est oublié, avec ce qui a été lu grâce à lui
async function botGet(req: Request, path: string): Promise<{ status: number; data: unknown }> {
  const r = await fetch(`${config.botApiUrl}/api/${path}`, {
    headers: { Authorization: `Bearer ${req.session.botToken}` }, signal: AbortSignal.timeout(15000),
  });
  if (r.status === 401) { delete req.session.botToken; forget(req); }
  return { status: r.status, data: await r.json().catch(() => ({ error: `bot ${r.status}` })) };
}
// lecture avec cache (réponses 200 uniquement)
async function botRead(req: Request, path: string): Promise<{ status: number; data: unknown }> {
  const hit = cached(req, path);
  if (hit !== undefined) return { status: 200, data: hit };
  const res = await botGet(req, path);
  if (res.status === 200) remember(req, path, res.data);
  return res;
}

// retour après connexion : une page de La Casa uniquement
const safeReturn = (v: unknown) => (typeof v === 'string' && /^\/casa\/[\w.-]*$/.test(v) ? v : '/casa/perfil.html');

bot.get('/auth/bot', ...member, (req, res) => {
  if (!config.botApiUrl) { res.redirect('/casa/perfil.html'); return; }
  req.session.botReturn = safeReturn(req.query.next);
  res.redirect(`${config.botApiUrl}/auth/login?guild=${encodeURIComponent(config.discord.guildId)}`);
});

// jeton reçu par bot-callback.html : il doit être celui du membre connecté, pour le serveur Discord de La Maja
bot.post('/api/bot/link', ...member, async (req, res) => {
  const token = body(req).token;
  if (!config.botApiUrl || typeof token !== 'string' || !token) { res.status(400).json({ error: 'jeton manquant' }); return; }
  req.session.botToken = token;
  forget(req);   // nouveau jeton : les droits ont pu changer
  const { status, data } = await botGet(req, 'me');
  const me = data as BotMe;
  if (status !== 200 || me.id !== req.member.discordId || me.guildId !== config.discord.guildId) {
    console.warn(`[bot] liaison refusée pour le membre ${req.member.id} : bot HTTP ${status}, compte bot ${me.id ?? '?'} / attendu ${req.member.discordId}, serveur ${me.guildId ?? '?'} / attendu ${config.discord.guildId}`);
    delete req.session.botToken;
    res.status(403).json({ error: 'Ce jeton ne correspond pas à ton compte Discord sur le serveur de la familia.' });
    return;
  }
  const next = req.session.botReturn ?? '/casa/perfil.html';
  delete req.session.botReturn;
  res.json({ ok: true, next });
});

bot.post('/api/bot/unlink', ...member, (req, res) => {
  delete req.session.botToken;
  forget(req);
  res.json({ ok: true });
});

// configured : le site connaît l'API du bot ; linked : le membre y est connecté (jeton encore valide)
bot.get('/api/bot/status', ...member, async (req, res) => {
  if (!config.botApiUrl) { res.json({ configured: false, linked: false }); return; }
  if (!req.session.botToken) { res.json({ configured: true, linked: false }); return; }
  try {
    const { status, data } = await botRead(req, 'me');
    if (status !== 200) { res.json({ configured: true, linked: false }); return; }
    const me = data as BotMe;
    res.json({ configured: true, linked: true, isAdmin: me.isAdmin, isTaxes: me.isTaxes });
  } catch { res.json({ configured: true, linked: false, error: 'unreachable' }); }
});

// lecture relayée : GET /api/bot/data/<rubrique>/… → <bot>/api/<rubrique>/… (mêmes paramètres ?week=, ?status=…)
const SECTIONS = ['me', 'users', 'stocks', 'quotas', 'taxes', 'armurerie', 'ventes'];
// chemin relayé : rubrique autorisée, et aucun segment qui ferait remonter l'adresse hors de /api/<rubrique> ; null sinon
function dataPath(req: Request): string | null {
  const segments = (req.params as { path: string[] }).path;
  if (!SECTIONS.includes(segments[0]) || segments.some(s => !s || s === '.' || s.includes('..') || s.includes('/'))) return null;
  return segments.map(encodeURIComponent).join('/') + new URL(req.originalUrl, 'http://casa').search;
}
// chaque membre a sa part des 300 requêtes / 15 min du bot ; les réponses servies par le cache ne comptent pas
const botLimit = limiter(15, 150, 'Trop de lectures vers le bot, réessaie dans quelques minutes.', byMember, req => {
  const path = req.session.botToken ? dataPath(req) : null;
  return path !== null && cached(req, path) !== undefined;
});
bot.get('/api/bot/data/*path', ...member, botLimit, async (req, res) => {
  if (!config.botApiUrl) { res.status(503).json({ error: 'bot-off' }); return; }
  const path = dataPath(req);
  if (!path) { res.status(404).json({ error: 'not-found' }); return; }
  if (!req.session.botToken) { res.status(401).json({ error: 'bot-unlinked' }); return; }
  try {
    const { status, data } = await botRead(req, path);
    res.status(status).json(status === 401 ? { error: 'bot-unlinked' } : data);
  } catch (e) {
    console.error('[bot]', (e as Error).message);
    res.status(502).json({ error: 'Le bot ne répond pas.' });
  }
});
