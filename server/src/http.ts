// Contrôles d'accès communs aux routes.
import type { Request, RequestHandler } from 'express';
import { prisma } from './db.js';
import type { Member } from './generated/prisma/client.js';
import { canAdmin, canManage } from './ranks.js';

declare module 'express-session' {
  interface SessionData {
    memberId: number;
    oauthState: string;
    botToken: string;    // jeton personnel de l'API du bot (connexion via le bot)
    botReturn: string;   // page de La Casa où revenir après cette connexion
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
export const requireApproved: RequestHandler = async (req, res, next) => {
  const m = await prisma.member.findUnique({ where: { id: req.session.memberId } });
  if (!m) { req.session.destroy(() => res.status(401).json({ error: 'unauthenticated' })); return; }
  if (m.status !== 'approved') { res.status(403).json({ error: 'pending', status: m.status }); return; }
  req.member = m;
  next();
};

// accès à la Gestion (membres, tableau de bord, taxes, armurerie)
export const requireAdmin: RequestHandler = (req, res, next) => {
  if (canAdmin(req.member)) next();
  else res.status(403).json({ error: 'forbidden' });
};

// pouvoirs complets (grades, hiérarchie)
export const requireManage: RequestHandler = (req, res, next) => {
  if (canManage(req.member)) next();
  else res.status(403).json({ error: 'manage-only' });
};

export const member = [requireAuth, requireApproved];
export const admin = [requireAuth, requireApproved, requireAdmin];
export const manager = [requireAuth, requireApproved, requireManage];

// corps JSON d'une requête (absent = objet vide) et champ texte nettoyé
export const body = (req: Request): Record<string, unknown> => (req.body && typeof req.body === 'object' ? req.body : {});
export const text = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);
export const intParam = (req: Request, name: string): number => Number.parseInt(String(req.params[name]), 10);

