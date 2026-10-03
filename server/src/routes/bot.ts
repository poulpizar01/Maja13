// Bot Discord (géré à part) : l'espace membre lit ses données via son API REST, en lecture seule.
// Le bot n'accepte que des jetons personnels, obtenus par sa propre connexion Discord :
//   /auth/bot → <bot>/auth/login?guild=… → Discord → <bot>/auth/callback
//   → site externe configuré dans Discord (/config site-externe set …/espace/bot-callback.html) avec #token=…
//   → POST /api/bot/link : jeton vérifié puis gardé dans la session (jamais exposé au navigateur ensuite).
// Les droits (admin) sont décidés par le bot à chaque requête, d'après les rôles Discord.
import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { config } from '../config.js';
import { body, member } from '../http.js';
import { canAdmin, canManage } from '../ranks.js';
import { byMember, limiter } from '../security.js';

export const bot = Router();

type BotMe = { id: string; username: string; isAdmin: boolean; guildId: string };
type Reponse = { status: number; data: unknown };

// ---------- cache en mémoire vive des lectures réussies ----------
// L'API du bot limite tout le site à 300 requêtes / 15 min : une réponse déjà lue est resservie quelques minutes.
// Rien sur disque ni en base, tout disparaît au redémarrage ; un cache par membre et par jeton (ses droits dans le bot).
// Borné en octets, pas en nombre d'entrées : la mémoire de Node est plafonnée (APP_NODE_HEAP), une réponse peut peser lourd.
const cache = new Map<string, { expires: number; data: unknown; octets: number }>();
const MAX_OCTETS = 48 * 1024 * 1024;
let octets = 0;
const retire = (key: string) => { const e = cache.get(key); if (e) { octets -= e.octets; cache.delete(key); } };
// le jeton fait partie de la clé : une lecture lancée avec l'ancien jeton ne retombe pas dans le cache du nouveau
const empreinte = (token: string) => crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
const cacheKey = (req: Request, path: string) => `${req.session.memberId}|${empreinte(req.session.botToken ?? '')}|${path}`;
// Durée : 5 min ; une semaine passée est figée, donc gardée 24 h pour les données du membre lui-même, 1 h pour celles
// d'un autre (lues avec des droits d'admin du bot, qui peuvent lui être retirés entre-temps).
const ttl = (req: Request, path: string) => !/[?&]week=/.test(path) ? 5 * 60e3 : path.includes(req.member.discordId) ? 24 * 3600e3 : 3600e3;
// jamais gardé : le détail d'une taxe (téléphone, mot de passe)
const sansCache = (path: string) => /^taxes\/\d+(\?|$)/.test(path);
function cached(req: Request, path: string): unknown {
  const key = cacheKey(req, path), hit = cache.get(key);
  if (hit && hit.expires < Date.now()) retire(key);
  else return hit?.data;
}
function remember(req: Request, path: string, data: unknown) {
  if (sansCache(path)) return;
  const taille = Buffer.byteLength(JSON.stringify(data) ?? '');
  if (taille > MAX_OCTETS / 8) return;
  const key = cacheKey(req, path);
  retire(key);
  for (const ancienne of cache.keys()) { if (octets + taille <= MAX_OCTETS) break; retire(ancienne); }   // les plus anciennes d'abord
  cache.set(key, { expires: Date.now() + ttl(req, path), data, octets: taille });
  octets += taille;
}
function forget(req: Request) {
  const prefix = `${req.session.memberId}|`;
  for (const key of cache.keys()) if (key.startsWith(prefix)) retire(key);
}
// une entrée expirée que personne ne relit resterait en mémoire : balayage régulier
setInterval(() => { const now = Date.now(); for (const [key, e] of cache) if (e.expires < now) retire(key); }, 5 * 60e3).unref();

// ---------- partage des 300 requêtes / 15 min que le bot accorde à tout le site ----------
// Sans partage, deux membres à leur limite personnelle (150) privent tous les autres du bot. Une fois BUDGET appels
// faits par le site dans le quart d'heure, ceux qui en ont déjà fait PART attendent : le reste va aux autres membres.
const FENETRE = 15 * 60e3, BUDGET = 240, PART = 60;
let debut = Date.now(), total = 0;
const parMembre = new Map<number, number>();
const fenetre = () => { if (Date.now() - debut > FENETRE) { debut = Date.now(); total = 0; parMembre.clear(); } };
const partEpuisee = (req: Request) => { fenetre(); return total >= BUDGET && (parMembre.get(req.session.memberId!) ?? 0) >= PART; };
const SATURE = 'Le bot est très sollicité en ce moment, réessaie dans quelques minutes.';

// appel à l'API du bot ; un jeton refusé est oublié avec ce qui a été lu grâce à lui — s'il est encore celui de la
// session (une reliaison a pu le remplacer pendant l'appel)
async function botGet(req: Request, path: string, token = req.session.botToken): Promise<Reponse> {
  fenetre(); total++; parMembre.set(req.session.memberId!, (parMembre.get(req.session.memberId!) ?? 0) + 1);
  const r = await fetch(`${config.botApiUrl}/api/${path}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  });
  if (r.status === 401 && req.session.botToken === token) { forget(req); delete req.session.botToken; }
  return { status: r.status, data: await r.json().catch(() => ({ error: `Le bot a répondu ${r.status}` })) };
}
// lecture avec cache (réponses 200 uniquement) ; deux demandes identiques en même temps ne font qu'un appel au bot
const enCours = new Map<string, Promise<Reponse>>();
async function botRead(req: Request, path: string): Promise<Reponse> {
  const hit = cached(req, path);
  if (hit !== undefined) return { status: 200, data: hit };
  const key = cacheKey(req, path);
  let appel = enCours.get(key);
  if (!appel) {
    appel = botGet(req, path).then(res => { if (res.status === 200) remember(req, path, res.data); return res; }).finally(() => enCours.delete(key));
    enCours.set(key, appel);
  }
  return appel;
}

// retour après connexion : une page de l'espace membre uniquement
const safeReturn = (v: unknown) => (typeof v === 'string' && /^\/espace\/[\w.-]*$/.test(v) ? v : '/espace/profil.html');

bot.get('/auth/bot', ...member, (req, res) => {
  if (!config.botApiUrl) { res.redirect('/espace/profil.html'); return; }
  req.session.botReturn = safeReturn(req.query.next);
  res.redirect(`${config.botApiUrl}/auth/login?guild=${encodeURIComponent(config.discord.guildId)}`);
});

// Jeton reçu par bot-callback.html : il doit être celui du membre connecté, pour le serveur Discord du site.
// Chaque essai fait un vrai appel au bot, hors cache : limite propre, sinon un seul membre épuiserait le quota du site.
// Le jeton n'entre en session qu'une fois vérifié ; en cas d'échec, celui déjà en place est gardé.
const linkLimit = limiter(15, 5, 'Trop d’essais de connexion au bot, réessaie dans quelques minutes.', byMember);
const JETON = /^[\w-]+\.[\w-]+\.[\w-]+$/;   // forme d'un jeton du bot (JWT) : rien d'autre ne part vers le bot ni dans les journaux
bot.post('/api/bot/link', ...member, linkLimit, async (req, res) => {
  const token = body(req).token;
  if (!config.botApiUrl || typeof token !== 'string' || !JETON.test(token)) { res.status(400).json({ error: 'jeton manquant' }); return; }
  let rep: Reponse;
  try { rep = await botGet(req, 'me', token); }
  catch { res.status(503).json({ error: 'Le bot ne répond pas, réessaie dans quelques minutes.' }); return; }
  if (rep.status === 429 || rep.status >= 500) { res.status(503).json({ error: SATURE }); return; }
  const me = (rep.data && typeof rep.data === 'object' ? rep.data : {}) as Partial<BotMe>;
  if (rep.status !== 200 || me.id !== req.member.discordId || me.guildId !== config.discord.guildId) {
    console.warn(`[bot] liaison refusée pour le membre ${req.member.id} : bot HTTP ${rep.status}, compte bot ${me.id ?? '?'} / attendu ${req.member.discordId}, serveur ${me.guildId ?? '?'} / attendu ${config.discord.guildId}`);
    res.status(403).json({ error: rep.status === 403
      ? 'Le bot refuse ce compte : il n’est plus sur le serveur Discord du groupe, ou n’a pas le rôle requis.'
      : 'Ce jeton ne correspond pas à ton compte Discord sur le serveur Discord du groupe.' });
    return;
  }
  forget(req);   // nouveau jeton : les droits ont pu changer
  req.session.botToken = token;
  const next = req.session.botReturn ?? '/espace/profil.html';
  delete req.session.botReturn;
  res.json({ ok: true, next });
});

bot.post('/api/bot/unlink', ...member, (req, res) => {
  forget(req);
  delete req.session.botToken;
  res.json({ ok: true });
});

// configured : le site connaît l'API du bot ; linked : le membre y a un jeton. Seul un jeton refusé (401) le délie :
// un bot saturé, coupé ou qui refuse ce compte donne « error », pour ne pas inviter à une reconnexion inutile.
//   busy : bot saturé ou en erreur · unreachable : bot injoignable · refused : compte refusé par le bot (403)
const adminConnu = new Map<number, boolean>();
bot.get('/api/bot/status', ...member, async (req, res) => {
  if (!config.botApiUrl) { res.json({ configured: false, linked: false }); return; }
  if (!req.session.botToken) { res.json({ configured: true, linked: false }); return; }
  try {
    const { status, data } = await botRead(req, 'me');
    if (status === 401) { res.json({ configured: true, linked: false }); return; }
    if (status !== 200) { res.json({ configured: true, linked: true, error: status === 403 ? 'refused' : 'busy' }); return; }
    const me = data as BotMe;
    // droits d'admin du bot changés depuis la dernière lecture : ce qui a été lu avec les anciens est oublié
    if (adminConnu.has(req.member.id) && adminConnu.get(req.member.id) !== me.isAdmin) forget(req);
    adminConnu.set(req.member.id, me.isAdmin);
    res.json({ configured: true, linked: true, isAdmin: me.isAdmin });
  } catch { res.json({ configured: true, linked: true, error: 'unreachable' }); }
});

// lecture relayée : GET /api/bot/data/<rubrique>/… → <bot>/api/<rubrique>/… (paramètres connus uniquement)
const SECTIONS = ['me', 'users', 'stocks', 'quotas', 'taxes', 'armurerie', 'ventes', 'garages', 'roles'];
const PARAMS = ['channelId', 'item', 'limit', 'q', 'status', 'type', 'week'];
// rubriques dont la page est réservée à la Gestion du site (Garage) ou aux pouvoirs complets (rôles du serveur Discord,
// pour la page Hiérarchie) ; le bot ajoute ses propres règles d'admin
const GESTION = ['garages'], POUVOIRS_COMPLETS = ['roles'];
// chemin relayé : rubrique autorisée, aucun segment qui ferait remonter l'adresse hors de /api/<rubrique>, et seuls
// les paramètres que le bot connaît, dans un ordre fixe (un paramètre de fantaisie ferait une entrée de cache de plus) ; null sinon
function dataPath(req: Request): string | null {
  const segments = (req.params as { path: string[] }).path;
  if (!SECTIONS.includes(segments[0]) || segments.some(s => !s || s === '.' || s.includes('..') || s.includes('/'))) return null;
  const recus = new URL(req.originalUrl, 'http://site').searchParams, gardes = new URLSearchParams();
  for (const nom of PARAMS) { const v = recus.get(nom); if (v !== null) gardes.set(nom, v.slice(0, 100)); }
  const query = gardes.toString();
  return segments.map(encodeURIComponent).join('/') + (query ? `?${query}` : '');
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
  const rubrique = path.split(/[/?]/)[0];
  if ((GESTION.includes(rubrique) && !canAdmin(req.member)) || (POUVOIRS_COMPLETS.includes(rubrique) && !canManage(req.member))) { res.status(403).json({ error: 'Réservé à la Gestion.' }); return; }
  if (!req.session.botToken) { res.status(401).json({ error: 'bot-unlinked' }); return; }
  if (cached(req, path) === undefined && partEpuisee(req)) { res.status(429).json({ error: SATURE }); return; }
  try {
    const { status, data } = await botRead(req, path);
    res.status(status).json(status === 401 ? { error: 'bot-unlinked' } : status === 429 ? { error: SATURE } : data);
  } catch (e) {
    console.error('[bot]', (e as Error).message);
    res.status(502).json({ error: 'Le bot ne répond pas.' });
  }
});
