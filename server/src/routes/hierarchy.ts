// Grades et organigramme public : lecture libre, édition réservée aux pouvoirs complets (Gestion → Hiérarchie).
import { Router, type Response } from 'express';
import { prisma } from '../db.js';
import { Prisma } from '../generated/prisma/client.js';
import { body, entier, intParam, manager, member, text } from '../http.js';
import { allRanks, loadRanks, publicRank, rankIndex, rankOf, vitrineRank } from '../ranks.js';
import { memberRoleId, setMemberRoleId } from '../settings.js';

export const hierarchy = Router();

// grades + cases de l'organigramme, dans l'ordre de la hiérarchie. Vitrine (public) : grades sans leurs droits ni
// rôle Discord ; gestion : grades complets.
async function orgPayload(gestion = true) {
  const entries = await prisma.orgEntry.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }] });
  entries.sort((a, b) => rankIndex(a.rankKey) - rankIndex(b.rankKey));   // tri stable : position conservée dans chaque grade
  return {
    ranks: allRanks().map(gestion ? publicRank : vitrineRank),
    entries: entries.map(e => ({ id: e.id, rank: e.rankKey, name: e.name, subtitle: e.subtitle, description: e.description, is_open: e.isOpen, position: e.position })),
  };
}

// grades complets (droits, rôle Discord) : membres validés seulement (page Administration)
hierarchy.get('/api/ranks', ...member, (_req, res) => { res.json(allRanks().map(publicRank)); });
hierarchy.get('/api/org', async (_req, res) => { res.json(await orgPayload(false)); });

// version de gestion : + nombre de comptes par grade (un grade attribué ne peut pas être supprimé)
hierarchy.get('/api/admin/org', ...manager, async (_req, res) => {
  const counts = await prisma.member.groupBy({ by: ['rankKey'], where: { rankKey: { not: null } }, _count: true });
  const byRank = Object.fromEntries(counts.map(c => [c.rankKey, c._count]));
  const data = await orgPayload();
  res.json({ ...data, ranks: data.ranks.map(r => ({ ...r, memberCount: byRank[r.key] ?? 0 })) });
});

// ---------- réglages d'accès ----------
// rôle Discord membre : identifiant du rôle (chiffres) ; vide = aucun (la Gestion seule a accès au-delà du profil)
hierarchy.get('/api/admin/reglages', ...manager, (_req, res) => { res.json({ memberRoleId: memberRoleId() }); });
hierarchy.put('/api/admin/reglages', ...manager, async (req, res) => {
  const id = text(body(req).memberRoleId, 32);
  if (id && !/^\d{5,32}$/.test(id)) { res.status(400).json({ error: 'Identifiant de rôle Discord invalide (des chiffres uniquement)' }); return; }
  await setMemberRoleId(id || null);
  res.json({ memberRoleId: memberRoleId() });
});

// ---------- grades ----------
// champs d'un grade présents dans le corps (PATCH partiel)
function rankFields(b: Record<string, unknown>) {
  const f: Omit<Prisma.RankUncheckedUpdateInput, 'key' | 'position'> = {};
  if (b.label !== undefined) f.label = text(b.label, 40);
  if (b.color !== undefined) f.color = typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color.toLowerCase() : null;
  if (b.description !== undefined) f.description = text(b.description, 600) || null;
  if (b.featured !== undefined) f.featured = !!b.featured;
  if (b.canAdmin !== undefined) f.canAdmin = !!b.canAdmin;
  if (b.canManage !== undefined) f.canManage = !!b.canManage;
  if (b.isDefault !== undefined) f.isDefault = !!b.isDefault;
  if (b.discordRoleId !== undefined) { const id = text(b.discordRoleId, 32); f.discordRoleId = /^\d{5,32}$/.test(id) ? id : null; }
  return f;
}
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16) || 'grade';

// enregistre un grade (création ou modification) ; un seul grade par défaut à la fois
async function saveRank(key: string, f: ReturnType<typeof rankFields>, create: boolean) {
  try {
    await prisma.$transaction(async tx => {
      if (f.isDefault) await tx.rank.updateMany({ where: { key: { not: key } }, data: { isDefault: false } });
      if (create) {
        const last = await tx.rank.aggregate({ _max: { position: true } });
        await tx.rank.create({ data: { ...f, key, label: String(f.label), position: (last._max.position ?? -1) + 1 } as Prisma.RankUncheckedCreateInput });
      } else if (Object.keys(f).length) await tx.rank.update({ where: { key }, data: f });
    });
  } finally { await loadRanks(); }
}
const rankError = (res: Response, e: unknown) => {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') res.status(409).json({ error: 'Ce rôle Discord est déjà associé à un autre grade' });
  else { console.error(e); res.status(500).json({ error: 'erreur serveur' }); }
};

hierarchy.post('/api/admin/ranks', ...manager, async (req, res) => {
  const f = rankFields(body(req));
  if (!f.label) { res.status(400).json({ error: 'nom du grade requis' }); return; }
  const base = slug(String(f.label));
  let key = base;
  for (let n = 2; rankOf(key); n++) key = `${base.slice(0, 13)}-${n}`;
  try { await saveRank(key, f, true); res.status(201).json(await orgPayload()); } catch (e) { rankError(res, e); }
});

// nouvel ordre complet des grades (glisser-déposer), du sommet à la base
hierarchy.put('/api/admin/ranks/order', ...manager, async (req, res) => {
  const keys = body(req).keys;
  const order = Array.isArray(keys) ? keys.map(String) : [];
  const ranks = allRanks();
  if (order.length !== ranks.length || !ranks.every(r => order.includes(r.key))) { res.status(400).json({ error: 'ordre incomplet, recharge la page' }); return; }
  await prisma.$transaction(order.map((key, position) => prisma.rank.update({ where: { key }, data: { position } })));
  await loadRanks();
  res.json(await orgPayload());
});

hierarchy.patch('/api/admin/ranks/:key', ...manager, async (req, res) => {
  const r = rankOf(String(req.params.key));
  if (!r) { res.status(404).json({ error: 'not-found' }); return; }
  const f = rankFields(body(req));
  if (f.label === '') { res.status(400).json({ error: 'nom du grade requis' }); return; }
  // garde-fou : on ne se retire pas à soi-même les pouvoirs complets (sauf le propriétaire, qui les garde de toute façon)
  if (f.canManage === false && req.member.rankKey === r.key && !req.member.isOwner) { res.status(400).json({ error: 'Tu perdrais tes propres pouvoirs complets' }); return; }
  try { await saveRank(r.key, f, false); res.json(await orgPayload()); } catch (e) { rankError(res, e); }
});

hierarchy.delete('/api/admin/ranks/:key', ...manager, async (req, res) => {
  const r = rankOf(String(req.params.key));
  if (!r) { res.status(404).json({ error: 'not-found' }); return; }
  const [m, o] = await Promise.all([prisma.member.count({ where: { rankKey: r.key } }), prisma.orgEntry.count({ where: { rankKey: r.key } })]);
  if (m || o) { res.status(409).json({ error: `Grade encore utilisé (${m} membre(s), ${o} case(s) de l'organigramme) : réattribue-les d'abord` }); return; }
  await prisma.rank.delete({ where: { key: r.key } });
  await loadRanks();
  res.json(await orgPayload());
});

// ---------- cases de l'organigramme ----------
function entryFields(b: Record<string, unknown>) {
  return {
    rankKey: rankOf(String(b.rank ?? ''))?.key ?? null,
    name: text(b.name, 64),
    subtitle: text(b.subtitle, 80) || null,
    description: text(b.description, 600) || null,
    isOpen: !!b.isOpen,
  };
}

hierarchy.post('/api/admin/org', ...manager, async (req, res) => {
  const { rankKey, ...f } = entryFields(body(req));
  if (!rankKey || !f.name) { res.status(400).json({ error: 'grade et nom requis' }); return; }
  const last = await prisma.orgEntry.aggregate({ where: { rankKey }, _max: { position: true } });
  await prisma.orgEntry.create({ data: { ...f, rankKey, position: (last._max.position ?? -1) + 1 } });
  res.status(201).json(await orgPayload());
});

// disposition des cases après glisser-déposer : { tiers: [{ rank, ids: [...] }] } — une case peut changer de grade
hierarchy.put('/api/admin/org/order', ...manager, async (req, res) => {
  const tiers = body(req).tiers;
  if (!Array.isArray(tiers) || tiers.some(t => !rankOf(t?.rank) || !Array.isArray(t?.ids) || t.ids.some((id: unknown) => entier(id) === null))) { res.status(400).json({ error: 'grade inconnu, recharge la page' }); return; }
  await prisma.$transaction((tiers as { rank: string; ids: unknown[] }[]).flatMap(t =>
    t.ids.map((id, position) => prisma.orgEntry.updateMany({ where: { id: entier(id)! }, data: { rankKey: t.rank, position } }))));
  res.json(await orgPayload());
});

hierarchy.patch('/api/admin/org/:id', ...manager, async (req, res) => {
  const { rankKey, ...f } = entryFields(body(req));
  if (!rankKey || !f.name) { res.status(400).json({ error: 'grade et nom requis' }); return; }
  await prisma.orgEntry.updateMany({ where: { id: intParam(req, 'id') }, data: { ...f, rankKey } });
  res.json(await orgPayload());
});

hierarchy.delete('/api/admin/org/:id', ...manager, async (req, res) => {
  await prisma.orgEntry.deleteMany({ where: { id: intParam(req, 'id') } });
  res.json(await orgPayload());
});
