// Bot Discord (géré à part) : La Casa lit ses données via son API REST, en lecture seule.
// Le bot n'accepte que des jetons personnels, obtenus par sa propre connexion Discord :
//   /auth/bot → <bot>/auth/login?guild=… → Discord → <bot>/auth/callback
//   → site externe configuré dans Discord (/config site-externe set …/casa/bot-callback.html) avec #token=…
//   → POST /api/bot/link : jeton vérifié puis gardé dans la session (jamais exposé au navigateur ensuite).
// Les droits (admin, taxes) sont décidés par le bot à chaque requête, d'après les rôles Discord.
import { Router, type Request } from 'express';
import { config } from '../config.js';
import { body, member } from '../http.js';
import { limits } from '../security.js';

export const bot = Router();

type BotMe = { id: string; username: string; isAdmin: boolean; isTaxes: boolean; guildId: string };

// appel à l'API du bot avec le jeton du membre ; un jeton refusé est oublié
async function botGet(req: Request, path: string): Promise<{ status: number; data: unknown }> {
  const r = await fetch(`${config.botApiUrl}/api/${path}`, {
    headers: { Authorization: `Bearer ${req.session.botToken}` }, signal: AbortSignal.timeout(15000),
  });
  if (r.status === 401) delete req.session.botToken;
  return { status: r.status, data: await r.json().catch(() => ({ error: `bot ${r.status}` })) };
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
  res.json({ ok: true });
});

// configured : le site connaît l'API du bot ; linked : le membre y est connecté (jeton encore valide)
bot.get('/api/bot/status', ...member, async (req, res) => {
  if (!config.botApiUrl) { res.json({ configured: false, linked: false }); return; }
  if (!req.session.botToken) { res.json({ configured: true, linked: false }); return; }
  try {
    const { status, data } = await botGet(req, 'me');
    if (status !== 200) { res.json({ configured: true, linked: false }); return; }
    const me = data as BotMe;
    res.json({ configured: true, linked: true, isAdmin: me.isAdmin, isTaxes: me.isTaxes });
  } catch { res.json({ configured: true, linked: false, error: 'unreachable' }); }
});

// lecture relayée : GET /api/bot/data/<rubrique>/… → <bot>/api/<rubrique>/… (mêmes paramètres ?week=, ?status=…)
const SECTIONS = ['me', 'users', 'stocks', 'quotas', 'taxes', 'armurerie', 'ventes'];
bot.get('/api/bot/data/*path', ...member, limits.bot, async (req, res) => {
  const segments = (req.params as { path: string[] }).path;
  if (!config.botApiUrl) { res.status(503).json({ error: 'bot-off' }); return; }
  // rubrique autorisée, et pas de segment qui ferait remonter l'adresse hors de /api/<rubrique>
  if (!SECTIONS.includes(segments[0]) || segments.some(s => !s || s === '.' || s.includes('..') || s.includes('/'))) { res.status(404).json({ error: 'not-found' }); return; }
  if (!req.session.botToken) { res.status(401).json({ error: 'bot-unlinked' }); return; }
  const query = new URL(req.originalUrl, 'http://casa').search;
  try {
    const { status, data } = await botGet(req, segments.map(encodeURIComponent).join('/') + query);
    res.status(status).json(status === 401 ? { error: 'bot-unlinked' } : data);
  } catch (e) {
    console.error('[bot]', (e as Error).message);
    res.status(502).json({ error: 'Le bot ne répond pas.' });
  }
});
