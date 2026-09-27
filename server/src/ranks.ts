// Grades (paramétrés dans Gestion → Hiérarchie) et droits qui en découlent.
// Les grades sont peu nombreux et lus à chaque requête : ils restent en mémoire, rechargés après chaque modification.
import { prisma } from './db.js';
import type { Member, Rank } from './generated/prisma/client.js';

let ranks: Rank[] = [];   // du sommet à la base

export async function loadRanks(): Promise<void> {
  ranks = await prisma.rank.findMany({ orderBy: [{ position: 'asc' }, { label: 'asc' }] });
}
export const allRanks = (): readonly Rank[] => ranks;
export const rankOf = (key: string | null | undefined): Rank | undefined => ranks.find(r => r.key === key);
// rang dans la hiérarchie (sans grade = après tous les grades), pour trier
export const rankIndex = (key: string | null | undefined): number => {
  const i = ranks.findIndex(r => r.key === key);
  return i < 0 ? ranks.length : i;
};

// grade tel qu'exposé aux pages
export const publicRank = (r: Rank) => ({
  key: r.key, label: r.label, position: r.position, color: r.color, description: r.description, featured: r.featured,
  canAdmin: r.canAdmin, canManage: r.canManage, isDefault: r.isDefault, discordRoleId: r.discordRoleId,
});
// grade d'un membre tel qu'exposé aux pages (null = sans grade)
export const rankInfo = (key: string | null | undefined) => {
  const r = rankOf(key);
  return { rank: r?.key ?? null, rankLabel: r?.label ?? null, rankColor: r?.color || null, rankFeatured: !!r?.featured };
};

// ---------- droits ----------
type WithRank = Pick<Member, 'rankKey' | 'isOwner'>;
// propriétaire du site = propriétaire du serveur Discord (vérifié à chaque connexion) : pouvoirs complets quel que soit le grade
export const canManage = (m: WithRank): boolean => m.isOwner || !!rankOf(m.rankKey)?.canManage;
export const canAdmin = (m: WithRank): boolean => canManage(m) || !!rankOf(m.rankKey)?.canAdmin;
// un grade à pouvoirs complets ne s'attribue / ne se retire que par quelqu'un qui les a lui-même
export const managesRank = (key: string | null | undefined): boolean => !!rankOf(key)?.canManage;
