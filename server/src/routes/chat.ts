// Le Salon : messages, flux temps réel (SSE), présence, non lus et mentions.
import { Router, type Response } from 'express';
import { prisma } from '../db.js';
import type { Member, Message } from '../generated/prisma/client.js';
import { body, intParam, member, text } from '../http.js';
import { author, byRankThenName } from '../members.js';
import { canAdmin } from '../ranks.js';
import { limits } from '../security.js';

export const chat = Router();

const clients = new Map<Response, Member>();   // flux ouverts → membre connecté
const broadcast = (event: string, data: unknown) => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients.keys()) { try { res.write(payload); } catch { clients.delete(res); } }
};
const presence = () => [...new Map([...clients.values()].map(m => [m.id, m])).values()].sort(byRankThenName).map(author);

const withAuthor = { member: true } as const;
const messageView = (g: Message & { member: Member }) => ({ id: g.id, content: g.content, createdAt: g.createdAt, author: author(g.member) });

chat.get('/api/chat/messages', ...member, async (req, res) => {
  const before = Number(req.query.before) || null;
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
chat.get('/api/chat/unread', ...member, async (req, res) => {
  const last = (await prisma.chatRead.findUnique({ where: { memberId: req.member.id } }))?.lastReadId ?? 0;
  const unread = await prisma.message.findMany({
    where: { id: { gt: last }, deletedAt: null, memberId: { not: req.member.id } }, select: { content: true }, orderBy: { id: 'asc' },
  });
  const re = mentionRegex(req.member);
  res.json({ unread: unread.length, mentions: unread.filter(m => re.test(m.content)).length, lastReadId: last });
});
chat.post('/api/chat/read', ...member, async (req, res) => {
  const id = Number(body(req).lastId) || 0;
  const current = (await prisma.chatRead.findUnique({ where: { memberId: req.member.id } }))?.lastReadId ?? 0;
  const lastReadId = Math.max(current, id);   // on n'avance jamais à reculons
  await prisma.chatRead.upsert({ where: { memberId: req.member.id }, create: { memberId: req.member.id, lastReadId }, update: { lastReadId } });
  res.json({ ok: true });
});
// membres mentionnables (autocomplétion @)
chat.get('/api/chat/mentions', ...member, async (_req, res) => {
  const list = await prisma.member.findMany({ where: { status: 'approved' }, select: { displayName: true, username: true }, orderBy: { displayName: 'asc' } });
  res.json(list.map(m => ({ name: m.displayName, username: m.username })));
});

chat.get('/api/chat/stream', ...member, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  clients.set(res, req.member);
  broadcast('presence', presence());
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* flux fermé */ } }, 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); broadcast('presence', presence()); });
});
