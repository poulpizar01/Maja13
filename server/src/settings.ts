// Réglages du site (table settings), modifiables dans Gestion → Hiérarchie. Lus à chaque requête par les gardes :
// gardés en mémoire, rechargés après chaque modification (même principe que les grades, ranks.ts).
import { prisma } from './db.js';

let reglages = new Map<string, string>();

export async function loadSettings(): Promise<void> {
  reglages = new Map((await prisma.setting.findMany()).map(s => [s.key, s.value]));
}

// Rôle Discord « membre » : sans lui, un compte validé n'a que son profil (voir canMember, ranks.ts). Non renseigné :
// personne n'a ce rôle, seule la Gestion a accès au reste — comme le bot tant que /config role set membre n'est pas fait.
export const memberRoleId = (): string | null => reglages.get('member_role_id') || null;

export async function setMemberRoleId(roleId: string | null): Promise<void> {
  if (roleId) await prisma.setting.upsert({ where: { key: 'member_role_id' }, update: { value: roleId }, create: { key: 'member_role_id', value: roleId } });
  else await prisma.setting.deleteMany({ where: { key: 'member_role_id' } });
  await loadSettings();
}
