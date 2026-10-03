// Bot Discord (géré à part) : l'espace membre lit ses données via son API REST, en lecture seule.
// Le bot n'accepte que des jetons personnels, obtenus par sa propre connexion Discord :
//   /auth/bot → <bot>/auth/login?guild=… → Discord → <bot>/auth/callback
//   → site externe configuré dans Discord (/config site-externe set …/espace/bot-callback.html) avec #token=…
//   → POST /api/bot/link : jeton vérifié puis gardé dans la session (jamais exposé au navigateur ensuite).
// Les droits (rôle membre, admin) sont décidés par le bot à chaque requête, d'après les rôles Discord.
import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { config } from '../config.js';
import { body, member } from '../http.js';
import { canAdmin, canManage } from '../ranks.js';
import { byMember, limiter } from '../security.js';

export const bot = Router();

type BotMe = { id: string; username: string; isAdmin: boolean; guildId: string };
// réponse du bot gardée telle quelle (texte JSON) : c'est elle qu'on met en cache et qu'on relaie
type Reponse = { status: number; texte: string };
const lire = (texte: string): unknown => { try { return JSON.parse(texte); } catch { return null; } };
const SATURE = 'Le bot est très sollicité en ce moment, réessaie dans quelques minutes.';
const erreur = (message: string) => JSON.stringify({ error: message });

// ---------- cache en mémoire vive des lectures réussies ----------
// L'API du bot limite tout le site à 300 requêtes / 15 min : une réponse déjà lue est resservie quelques minutes.
// Rien sur disque ni en base, tout disparaît au redémarrage ; un cache par membre et par jeton (ses droits dans le bot).
// On garde le texte JSON reçu, pas l'objet décodé : sa taille est celle qu'il occupe vraiment (un objet décodé pèse
// plusieurs fois son JSON), et le plafond protège donc réellement la mémoire de Node (APP_NODE_HEAP).
const cache = new Map<string, { expires: number; texte: string }>();
const MAX_OCTETS = 48 * 1024 * 1024;
let octets = 0;
const taille = (texte: string) => Buffer.byteLength(texte);
const retire = (key: string) => { const e = cache.get(key); if (e) { octets -= taille(e.texte); cache.delete(key); } };
// le jeton fait partie de la clé : une lecture lancée avec l'ancien jeton ne retombe pas dans le cache du nouveau
const empreinte = (token: string) => crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
const cacheKey = (req: Request, path: string) => `${req.session.memberId}|${empreinte(req.session.botToken ?? '')}|${path}`;
// Durée : 5 min ; une semaine passée est figée, donc gardée 24 h pour les données du membre lui-même, 1 h pour celles
// d'un autre (lues avec des droits d'admin du bot, qui peuvent lui être retirés entre-temps).
const ttl = (req: Request, path: string) => !/[?&]week=/.test(path) ? 5 * 60e3 : path.includes(req.member.discordId) ? 24 * 3600e3 : 3600e3;
// jamais gardé : le détail d'une taxe (téléphone, mot de passe), quelle que soit l'écriture de son identifiant
const sansCache = (path: string) => /^taxes\/(?!(?:types|search)(?:\?|$))[^/?]+/.test(path);
function cached(req: Request, path: string): string | undefined {
  const key = cacheKey(req, path), hit = cache.get(key);
  if (hit && hit.expires < Date.now()) retire(key);
  else return hit?.texte;
}
// Génération par membre : vider son cache l'incrémente, et une lecture lancée avant ne s'y range plus en revenant
// (sinon une réponse lue avec des droits d'admin retirés entre-temps reviendrait aussitôt dans le cache).
const generation = new Map<number, number>();
const gen = (memberId: number) => generation.get(memberId) ?? 0;
function remember(req: Request, path: string, texte: string, genDepart: number) {
  if (sansCache(path) || gen(req.session.memberId!) !== genDepart) return;
  const t = taille(texte);
  if (t > MAX_OCTETS / 8) return;
  const key = cacheKey(req, path);
  retire(key);
  for (const ancienne of cache.keys()) { if (octets + t <= MAX_OCTETS) break; retire(ancienne); }   // les plus anciennes d'abord
  cache.set(key, { expires: Date.now() + ttl(req, path), texte });
  octets += t;
}
const adminConnu = new Map<number, boolean>();
const etatErreur = new Map<number, { jusqua: number; etat: object }>();
// tout ce que le site garde d'un membre pour le bot : à la déconnexion, à la suppression du compte, à un nouveau jeton
export function oublierBot(memberId: number) {
  generation.set(memberId, gen(memberId) + 1);
  const prefix = `${memberId}|`;
  for (const key of cache.keys()) if (key.startsWith(prefix)) retire(key);
  adminConnu.delete(memberId);
  etatErreur.delete(memberId);
}
const forget = (req: Request) => oublierBot(req.session.memberId!);
// une entrée expirée que personne ne relit resterait en mémoire : balayage régulier
setInterval(() => { const now = Date.now(); for (const [key, e] of cache) if (e.expires < now) retire(key); }, 5 * 60e3).unref();

// ---------- partage des requêtes que le bot accorde ----------
// Le bot limite à 300 requêtes / 15 min par serveur Discord ET par adresse IP : des sites hébergés sur un même VPS se
// partagent ces 300 (BOT_BUDGET, .env, à répartir entre eux). Une fois BUDGET appels faits par le site dans le quart
// d'heure, ceux qui en ont déjà fait PART attendent : le reste va aux autres membres.
const FENETRE = 15 * 60e3, BUDGET = config.botBudget, PART = Math.ceil(config.botBudget / 4);
let debut = Date.now(), total = 0;
const parMembre = new Map<number, number>();
const fenetre = () => { if (Date.now() - debut > FENETRE) { debut = Date.now(); total = 0; parMembre.clear(); } };
const partEpuisee = (req: Request) => { fenetre(); return total >= BUDGET && (parMembre.get(req.session.memberId!) ?? 0) >= PART; };
// Le bot a répondu 429 : plus aucun appel jusqu'à l'échéance qu'il annonce (Retry-After, RateLimit-Reset, en secondes),
// au lieu de continuer à frapper un bot déjà saturé — chaque appel refusé compte encore contre la limite.
let pauseJusqua = 0;
const echeance = (r: globalThis.Response) => {
  const s = Number(r.headers.get('retry-after')) || Number(r.headers.get('ratelimit-reset')) || 60;
  return Date.now() + Math.min(Math.max(s, 5), 15 * 60) * 1000;
};

// appel à l'API du bot ; un jeton refusé est oublié avec ce qui a été lu grâce à lui — s'il est encore celui de la
// session (une reliaison a pu le remplacer pendant l'appel)
async function botGet(req: Request, path: string, token = req.session.botToken): Promise<Reponse> {
  if (Date.now() < pauseJusqua) return { status: 429, texte: erreur(SATURE) };
  fenetre(); total++; parMembre.set(req.session.memberId!, (parMembre.get(req.session.memberId!) ?? 0) + 1);
  const r = await fetch(`${config.botApiUrl}/api/${path}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  });
  if (r.status === 429) pauseJusqua = echeance(r);
  if (r.status === 401 && req.session.botToken === token) { forget(req); delete req.session.botToken; }
  const texte = await r.text().catch(() => '');
  return { status: r.status, texte: lire(texte) !== null ? texte : erreur(`Le bot a répondu ${r.status}`) };   // JSON illisible : erreur lisible à la place
}
// lecture avec cache (réponses 200 uniquement) ; deux demandes identiques en même temps ne font qu'un appel au bot
const enCours = new Map<string, Promise<Reponse>>();
async function botRead(req: Request, path: string): Promise<Reponse> {
  const hit = cached(req, path);
  if (hit !== undefined) return { status: 200, texte: hit };
  const key = cacheKey(req, path), genDepart = gen(req.session.memberId!);
  let appel = enCours.get(key);
  if (!appel) {
    appel = botGet(req, path).then(res => { if (res.status === 200) remember(req, path, res.texte, genDepart); return res; }).finally(() => enCours.delete(key));
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
  const lu = lire(rep.texte), me = (lu && typeof lu === 'object' ? lu : {}) as Partial<BotMe>;
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
// Une erreur est retenue une minute : sans cela, chaque page vue rappellerait le bot (les erreurs ne vont pas en cache).
bot.get('/api/bot/status', ...member, async (req, res) => {
  if (!config.botApiUrl) { res.json({ configured: false, linked: false }); return; }
  if (!req.session.botToken) { res.json({ configured: true, linked: false }); return; }
  const retenue = etatErreur.get(req.member.id);
  if (retenue && retenue.jusqua > Date.now()) { res.json(retenue.etat); return; }
  const signale = (etat: object) => { etatErreur.set(req.member.id, { jusqua: Date.now() + 60e3, etat }); res.json(etat); };
  try {
    const { status, texte } = await botRead(req, 'me');
    if (status === 401) { res.json({ configured: true, linked: false }); return; }
    if (status !== 200) { signale({ configured: true, linked: true, error: status === 403 ? 'refused' : 'busy' }); return; }
    etatErreur.delete(req.member.id);
    const me = lire(texte) as BotMe;
    // droits d'admin du bot changés depuis la dernière lecture : ce qui a été lu avec les anciens est oublié
    if (adminConnu.has(req.member.id) && adminConnu.get(req.member.id) !== me.isAdmin) forget(req);
    adminConnu.set(req.member.id, me.isAdmin);
    res.json({ configured: true, linked: true, isAdmin: me.isAdmin });
  } catch { signale({ configured: true, linked: true, error: 'unreachable' }); }
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
// chaque membre a sa part des requêtes du bot ; les réponses servies par le cache ne comptent pas
const botLimit = limiter(15, Math.ceil(config.botBudget / 2), 'Trop de lectures vers le bot, réessaie dans quelques minutes.', byMember, req => {
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
    const { status, texte } = await botRead(req, path);
    if (status === 401) { res.status(401).json({ error: 'bot-unlinked' }); return; }
    if (status === 429) { res.status(429).json({ error: SATURE }); return; }
    res.status(status).type('json').send(texte);
  } catch (e) {
    console.error('[bot]', (e as Error).message);
    res.status(502).json({ error: 'Le bot ne répond pas.' });
  }
});
