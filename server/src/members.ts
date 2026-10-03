// Présentation des comptes pour les pages.
import type { Member } from './generated/prisma/client.js';
import { canAdmin, canManage, canMember, rankIndex, rankInfo } from './ranks.js';

export const avatarUrl = (m: Pick<Member, 'discordId' | 'avatar'>): string | null =>
  m.avatar ? `https://cdn.discordapp.com/avatars/${m.discordId}/${m.avatar}.${m.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256` : null;

export const publicMember = (m: Member) => ({
  id: m.id, discordId: m.discordId, username: m.username, avatarUrl: avatarUrl(m),
  displayName: m.displayName, ...rankInfo(m.rankKey), bio: m.bio, phoneRp: m.phoneRp,
  isMember: canMember(m), isAdmin: canAdmin(m), canManage: canManage(m), status: m.status,
  joinedAt: m.joinedAt, lastLogin: m.lastLogin, approvedAt: m.approvedAt,
});

// auteur d'un message ou d'une photo
export const author = (m: Pick<Member, 'id' | 'displayName' | 'username' | 'rankKey' | 'discordId' | 'avatar'>) => ({
  id: m.id, displayName: m.displayName, username: m.username, ...rankInfo(m.rankKey), avatarUrl: avatarUrl(m),
});

// tri par grade (du sommet à la base, sans grade en dernier) puis par nom
export const byRankThenName = (a: Pick<Member, 'rankKey' | 'displayName'>, b: Pick<Member, 'rankKey' | 'displayName'>): number =>
  rankIndex(a.rankKey) - rankIndex(b.rankKey) || (a.displayName ?? '').localeCompare(b.displayName ?? '');
