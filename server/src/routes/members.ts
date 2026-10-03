// Profil du membre connecté, la liste des membres, et administration des comptes (Gestion).
import { Router } from 'express';
import { prisma } from '../db.js';
import type { MemberStatus, Prisma } from '../generated/prisma/client.js';
import { admin, approved, body, intParam, manager, member, requireAuth, text } from '../http.js';
import { avatarUrl, byRankThenName, publicMember } from '../members.js';
import { rankInfo, rankOf } from '../ranks.js';
import { fermerFlux } from './chat.js';
import { retirerFichiers } from './gallery.js';

export const members = Router();

members.get('/api/me', requireAuth, async (req, res) => {
  const m = await prisma.member.findUnique({ where: { id: req.session.memberId } });
  if (!m) { req.session.destroy(() => res.status(401).json({ error: 'unauthenticated' })); return; }
  res.json(publicMember(m));
});

members.patch('/api/me', ...approved, async (req, res) => {
  const b = body(req);
  const displayName = text(b.displayName, 64);
  if (!displayName) { res.status(400).json({ error: 'displayName requis' }); return; }
  const m = await prisma.member.update({
    where: { id: req.member.id },
    data: { displayName, bio: text(b.bio, 600) || null, phoneRp: text(b.phoneRp, 32) || null },
  });
  res.json(publicMember(m));
});

// annuaire des membres validés (pseudo Discord, grade) : page Membres, réservée à la Gestion
members.get('/api/membres', ...admin, async (_req, res) => {
  const list = (await prisma.member.findMany({ where: { status: 'approved' } })).sort(byRankThenName);
  res.json(list.map(m => ({ discordId: m.discordId, displayName: m.displayName, username: m.username, ...rankInfo(m.rankKey), avatarUrl: avatarUrl(m) })));
});

// noms RP et avatars seulement, pour afficher les joueurs dans les pages du rôle membre (classement) sans l'annuaire
members.get('/api/membres/noms', ...member, async (_req, res) => {
  const list = await prisma.member.findMany({ where: { status: 'approved' }, select: { discordId: true, displayName: true, avatar: true } });
  res.json(list.map(m => ({ discordId: m.discordId, displayName: m.displayName, avatarUrl: avatarUrl(m) })));
});

// ---------- administration (pouvoirs complets : valider, refuser, nom RP, grade, suppression) ----------
members.get('/api/admin/members', ...manager, async (_req, res) => {
  const list = await prisma.member.findMany({ include: { approvedBy: { select: { displayName: true } } } });
  list.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || byRankThenName(a, b));
  res.json(list.map(m => ({ ...publicMember(m), approvedByName: m.approvedBy?.displayName ?? null })));
});

const STATUSES: MemberStatus[] = ['pending', 'approved', 'rejected'];
members.patch('/api/admin/members/:id', ...manager, async (req, res) => {
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
  const m = await prisma.member.update({ where: { id: target.id }, data });
  if (m.status !== 'approved') fermerFlux(m.id);
  res.json(publicMember(m));
});

// Suppression d'un compte : ses messages et ses photos partent avec lui (cascade en base) ; les fichiers des photos
// sont retirés du stockage, sinon ils y resteraient orphelins, et ses flux du chat sont fermés.
async function supprimerCompte(id: number) {
  const photos = await prisma.photo.findMany({ where: { memberId: id }, select: { file: true, url: true, thumb: true, thumbUrl: true } });
  await prisma.member.deleteMany({ where: { id } });
  fermerFlux(id);
  for (const p of photos) await retirerFichiers(p);
}

members.delete('/api/admin/members/:id', ...manager, async (req, res) => {
  const id = intParam(req, 'id');
  if (id === req.member.id) { res.status(400).json({ error: 'self' }); return; }
  await supprimerCompte(id);
  res.json({ ok: true });
});

// chacun peut supprimer son propre compte, validé ou non (une nouvelle connexion Discord en recréerait un, en attente)
members.delete('/api/me', requireAuth, async (req, res) => {
  await supprimerCompte(req.session.memberId!);
  req.session.destroy(() => res.clearCookie('site.sid').json({ ok: true }));
});
