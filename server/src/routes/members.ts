// Profil du membre connecté, la liste des membres, et administration des comptes (Gestion).
import { Router } from 'express';
import { prisma } from '../db.js';
import type { MemberStatus, Prisma } from '../generated/prisma/client.js';
import { admin, body, intParam, member, requireAuth, text } from '../http.js';
import { avatarUrl, byRankThenName, publicMember } from '../members.js';
import { canManage, managesRank, rankInfo, rankOf } from '../ranks.js';
import { retirerFichiers } from './gallery.js';

export const members = Router();

members.get('/api/me', requireAuth, async (req, res) => {
  const m = await prisma.member.findUnique({ where: { id: req.session.memberId } });
  if (!m) { req.session.destroy(() => res.status(401).json({ error: 'unauthenticated' })); return; }
  res.json(publicMember(m));
});

members.patch('/api/me', ...member, async (req, res) => {
  const b = body(req);
  const displayName = text(b.displayName, 64);
  if (!displayName) { res.status(400).json({ error: 'displayName requis' }); return; }
  const m = await prisma.member.update({
    where: { id: req.member.id },
    data: { displayName, bio: text(b.bio, 600) || null, phoneRp: text(b.phoneRp, 32) || null },
  });
  res.json(publicMember(m));
});

// membres validés, visibles par les membres connectés
members.get('/api/membres', ...member, async (_req, res) => {
  const list = (await prisma.member.findMany({ where: { status: 'approved' } })).sort(byRankThenName);
  res.json(list.map(m => ({ discordId: m.discordId, displayName: m.displayName, username: m.username, ...rankInfo(m.rankKey), avatarUrl: avatarUrl(m) })));
});

// ---------- administration (accès Gestion) ----------
members.get('/api/admin/members', ...admin, async (_req, res) => {
  const list = await prisma.member.findMany({ include: { approvedBy: { select: { displayName: true } } } });
  list.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || byRankThenName(a, b));
  res.json(list.map(m => ({ ...publicMember(m), approvedByName: m.approvedBy?.displayName ?? null })));
});

const STATUSES: MemberStatus[] = ['pending', 'approved', 'rejected'];
members.patch('/api/admin/members/:id', ...admin, async (req, res) => {
  const target = await prisma.member.findUnique({ where: { id: intParam(req, 'id') } });
  if (!target) { res.status(404).json({ error: 'not-found' }); return; }
  const b = body(req);
  const data: Prisma.MemberUncheckedUpdateInput = {};
  if (b.displayName !== undefined) {
    const displayName = text(b.displayName, 64);
    if (!displayName) { res.status(400).json({ error: 'displayName requis' }); return; }
    data.displayName = displayName;
  }
  if (b.rank !== undefined) {
    const rank = typeof b.rank === 'string' && b.rank ? b.rank : null;
    if (rank && !rankOf(rank)) { res.status(400).json({ error: 'grade inconnu' }); return; }
    if ((managesRank(rank) || managesRank(target.rankKey)) && !canManage(req.member)) { res.status(403).json({ error: 'manage-only' }); return; }
    data.rankKey = rank;
  }
  if (b.status !== undefined) {
    const status = STATUSES.find(s => s === b.status);
    if (!status) { res.status(400).json({ error: 'statut inconnu' }); return; }
    if (target.id === req.member.id) { res.status(400).json({ error: 'self' }); return; }
    data.status = status;
    data.approvedAt = status === 'approved' ? new Date() : null;
    data.approvedById = status === 'approved' ? req.member.id : null;
  }
  if (!Object.keys(data).length) { res.status(400).json({ error: 'rien à modifier' }); return; }
  res.json(publicMember(await prisma.member.update({ where: { id: target.id }, data })));
});

members.delete('/api/admin/members/:id', ...admin, async (req, res) => {
  const id = intParam(req, 'id');
  if (id === req.member.id) { res.status(400).json({ error: 'self' }); return; }
  const target = await prisma.member.findUnique({ where: { id }, select: { rankKey: true } });
  if (managesRank(target?.rankKey) && !canManage(req.member)) { res.status(403).json({ error: 'manage-only' }); return; }
  // ses photos partent avec lui (cascade en base) : leurs fichiers sont retirés du stockage, sinon ils y resteraient orphelins
  const photos = await prisma.photo.findMany({ where: { memberId: id }, select: { file: true, url: true, thumb: true, thumbUrl: true } });
  await prisma.member.deleteMany({ where: { id } });
  for (const p of photos) await retirerFichiers(p);
  res.json({ ok: true });
});
