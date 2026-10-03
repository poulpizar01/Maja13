// Chat : messages, flux temps réel (SSE), présence, non lus et mentions.
import { Router, type Response } from 'express';
import { prisma } from '../db.js';
import type { Member, Message } from '../generated/prisma/client.js';
import { body, entier, intParam, member, text } from '../http.js';
import { author, byRankThenName } from '../members.js';
import { canAdmin } from '../ranks.js';
import { limits } from '../security.js';

export const chat = Router();

const clients = new Map<Response, Member>();   // flux ouverts → membre connecté
const TAMPON_MAX = 1024 * 1024;   // un onglet qui ne lit plus rien (réseau bloqué) n'accumule pas le chat en mémoire
const broadcast = (event: string, data: unknown) => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients.keys()) {
    if (res.writableLength > TAMPON_MAX) { clients.delete(res); res.destroy(); continue; }
    try { res.write(payload); } catch { clients.delete(res); }
  }
};
// Fin d'un flux décidée par le serveur : l'onglet en est prévenu (« closed ») pour ne pas se reconnecter de lui-même —
// une fin sans préavis relance le navigateur au bout de 3 s. raison : limit (trop d'onglets), access (compte ou session), stop (arrêt du serveur)
const ferme = (res: Response, raison: 'limit' | 'access' | 'stop') => {
  clients.delete(res);
  try { res.end(`event: closed\ndata: "${raison}"\n\n`); } catch { /* déjà fermé */ }
};
const presence = () => [...new Map([...clients.values()].map(m => [m.id, m])).values()].sort(byRankThenName).map(author);

const withAuthor = { member: true } as const;
const messageView = (g: Message & { member: Member }) => ({ id: g.id, content: g.content, createdAt: g.createdAt, author: author(g.member) });

chat.get('/api/chat/messages', ...member, async (req, res) => {
  const before = entier(req.query.before);
  const list = await prisma.message.findMany({
    where: { deletedAt: null, ...(before && { id: { lt: before } }) }, include: withAuthor, orderBy: { id: 'desc' }, take: 60,
  });
  res.json(list.reverse().map(messageView));
});

chat.post('/api/chat/messages', ...member, limits.chat, async (req, res) => {
  const content = text(body(req).content, 1000);
  if (!content) { res.status(400).json({ error: 'vide' }); return; }
  const msg = messageView(await prisma.message.create({ data: { memberId: req.member.id, content }, include: withAuthor }));
  broadcast('message', msg);
  res.status(201).json(msg);
});

chat.delete('/api/chat/messages/:id', ...member, async (req, res) => {
  const g = await prisma.message.findFirst({ where: { id: intParam(req, 'id'), deletedAt: null } });
  if (!g) { res.status(404).json({ error: 'not-found' }); return; }
  if (g.memberId !== req.member.id && !canAdmin(req.member)) { res.status(403).json({ error: 'forbidden' }); return; }
  await prisma.message.update({ where: { id: g.id }, data: { deletedAt: new Date() } });
  broadcast('delete', { id: g.id });
  res.json({ ok: true });
});

// non lus + mentions pour le badge du menu
const mentionRegex = (m: Member) => new RegExp('@(' + [m.displayName, m.username].filter(Boolean)
  .map(s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\w-])', 'i');
// Appelé toutes les 30 s par chaque onglet ouvert : seuls les 300 derniers non lus sont relus, pour le total comme
// pour les mentions (le badge affiche 99+ au-delà ; sans plafond, un membre absent des semaines ferait parcourir
// tout l'historique à chaque rafraîchissement).
chat.get('/api/chat/unread', ...member, async (req, res) => {
  const last = (await prisma.chatRead.findUnique({ where: { memberId: req.member.id } }))?.lastReadId ?? 0;
  const where = { id: { gt: last }, deletedAt: null, memberId: { not: req.member.id } };
  const recents = await prisma.message.findMany({ where, select: { content: true }, orderBy: { id: 'desc' }, take: 300 });
  const re = mentionRegex(req.member);
  res.json({ unread: recents.length, mentions: recents.filter(m => re.test(m.content)).length, lastReadId: last });
});
chat.post('/api/chat/read', ...member, async (req, res) => {
  // borné au dernier message existant : un identifiant inventé, plus grand, masquerait pour toujours les messages à venir
  const dernier = (await prisma.message.aggregate({ _max: { id: true } }))._max.id ?? 0;
  const id = Math.min(entier(body(req).lastId) ?? 0, dernier);
  const current = (await prisma.chatRead.findUnique({ where: { memberId: req.member.id } }))?.lastReadId ?? 0;
  const lastReadId = Math.max(Math.min(current, dernier), id);   // on n'avance jamais à reculons
  await prisma.chatRead.upsert({ where: { memberId: req.member.id }, create: { memberId: req.member.id, lastReadId }, update: { lastReadId } });
  res.json({ ok: true });
});
// membres mentionnables (autocomplétion @)
chat.get('/api/chat/mentions', ...member, async (_req, res) => {
  const list = await prisma.member.findMany({ where: { status: 'approved' }, select: { displayName: true, username: true }, orderBy: { displayName: 'asc' } });
  res.json(list.map(m => ({ name: m.displayName, username: m.username })));
});

// Les droits ne sont vérifiés qu'à l'ouverture d'un flux : un compte refusé ou supprimé (routes/members.ts) voit donc
// ses flux fermés aussitôt, sinon un onglet resté ouvert continuerait de recevoir le chat.
export const fermerFlux = (memberId: number) => {
  for (const [res, m] of clients) if (m.id === memberId) ferme(res, 'access');
};
// arrêt du serveur (index.ts) : tous les flux sont rendus, sinon ils retiendraient la fermeture
export const fermerTousLesFlux = () => { for (const res of [...clients.keys()]) ferme(res, 'stop'); };

// flux ouverts par membre, au plus : au-delà (onglets oubliés, script qui boucle), le plus ancien est fermé
const FLUX_PAR_MEMBRE = 5;
chat.get('/api/chat/stream', ...member, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const siens = [...clients].filter(([, m]) => m.id === req.member.id).map(([r]) => r);
  for (const r of siens.slice(0, Math.max(0, siens.length - FLUX_PAR_MEMBRE + 1))) ferme(r, 'limit');
  clients.set(res, req.member);
  broadcast('presence', presence());
  // le flux ne survit pas à la session : à son échéance, il est fermé
  const fin = req.session.cookie.expires?.getTime() ?? Infinity;
  const ping = setInterval(() => {
    if (Date.now() > fin) { ferme(res, 'access'); return; }
    try { res.write(': ping\n\n'); } catch { /* flux fermé */ }
  }, 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); broadcast('presence', presence()); });
});
