// Contrôles d'accès communs aux routes.
import type { Request, RequestHandler } from 'express';
import { prisma } from './db.js';
import type { Member } from './generated/prisma/client.js';
import { canAdmin, canManage, canMember } from './ranks.js';

declare module 'express-session' {
  interface SessionData {
    memberId: number;
    oauthState: string;
    botToken: string;    // jeton personnel de l'API du bot (connexion via le bot)
    botReturn: string;   // page de l'espace membre où revenir après cette connexion
  }
}
declare module 'express-serve-static-core' {
  interface Request { member: Member }   // posé par requireApproved
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (req.session.memberId) next();
  else res.status(401).json({ error: 'unauthenticated' });
};

// charge le membre courant et exige un compte validé
const requireApproved: RequestHandler = async (req, res, next) => {
  const m = await prisma.member.findUnique({ where: { id: req.session.memberId } });
  if (!m) { req.session.destroy(() => res.status(401).json({ error: 'unauthenticated' })); return; }
  if (m.status !== 'approved') { res.status(403).json({ error: 'pending', status: m.status }); return; }
  req.member = m;
  next();
};

// rôle membre : tout l'espace membre hors Gestion (un compte validé sans ce rôle n'a que son profil)
const requireMember: RequestHandler = (req, res, next) => {
  if (canMember(req.member)) next();
  else res.status(403).json({ error: 'member-role' });
};

// accès à la Gestion (membres, administration, tableau de bord, statistiques, garage)
const requireAdmin: RequestHandler = (req, res, next) => {
  if (canAdmin(req.member)) next();
  else res.status(403).json({ error: 'forbidden' });
};

// pouvoirs complets (grades, hiérarchie)
const requireManage: RequestHandler = (req, res, next) => {
  if (canManage(req.member)) next();
  else res.status(403).json({ error: 'manage-only' });
};

// approved : compte validé (son profil) ; member : + rôle membre ; admin : + Gestion ; manager : pouvoirs complets
export const approved = [requireAuth, requireApproved];
export const member = [requireAuth, requireApproved, requireMember];
export const admin = [requireAuth, requireApproved, requireAdmin];
export const manager = [requireAuth, requireApproved, requireManage];

// corps JSON d'une requête (absent = objet vide) et champ texte nettoyé
export const body = (req: Request): Record<string, unknown> => (req.body && typeof req.body === 'object' ? req.body : {});
export const text = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);
// entier strictement positif tenant dans une colonne INTEGER de la base, sinon null (« abc », 1.5, nombre trop grand…)
export const entier = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : /^\d{1,10}$/.test(String(v ?? '')) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
};
// identifiant pris dans l'adresse ; illisible = -1, qui ne correspond à aucune ligne (la route répond alors 404, pas 500)
export const intParam = (req: Request, name: string): number => entier(req.params[name]) ?? -1;

