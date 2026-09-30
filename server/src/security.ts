// En-têtes de sécurité (helmet) et limites de requêtes (express-rate-limit).
import crypto from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { config } from './config.js';

const https = config.baseUrl.startsWith('https');

// Jeton à usage unique (nonce) par réponse : seuls les <script> des pages du site, marqués par site.ts, s'exécutent.
// Un script injecté (contenu d'un membre mal échappé, par exemple) n'a pas le jeton et reste inerte.
export const cspNonce: RequestHandler = (_req, res, next) => { res.locals.cspNonce = crypto.randomBytes(16).toString('base64'); next(); };

// Politique de contenu : uniquement ce que les pages chargent réellement (Google Fonts, cdnjs pour three.js et
// SortableJS, avatars Discord, stockage d'images en prod). Scripts en ligne : seulement avec le jeton de la réponse ;
// styles en ligne autorisés (attributs style des pages, sans risque d'exécution de code).
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", (_req, res) => `'nonce-${(res as Response).locals.cspNonce}'`, 'https://cdnjs.cloudflare.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'blob:', 'https://cdn.discordapp.com', ...(config.storage.url ? [new URL(config.storage.url).origin] : [])],
      'connect-src': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': https ? [] : null,   // en dev (http://localhost), pas de passage forcé en https
    },
  },
  strictTransportSecurity: https ? { maxAge: 31536000 } : false,
  crossOriginEmbedderPolicy: false,
});

// Clé des limites : le membre connecté si possible (une adresse peut être partagée), sinon l'adresse IP.
export const byMember = (req: Request) => (req.session?.memberId ? `m${req.session.memberId}` : ipKeyGenerator(req.ip ?? ''));
// skip : requêtes non comptées (ex. lecture du bot servie par le cache)
export const limiter = (windowMin: number, limit: number, error: string, key?: (req: Request) => string, skip?: (req: Request) => boolean) => rateLimit({
  windowMs: windowMin * 60_000, limit, standardHeaders: 'draft-8', legacyHeaders: false,
  ...(key && { keyGenerator: key }),
  ...(skip && { skip }),
  message: { error },
});

export const limits = {
  // toute l'API : large, contre les scripts qui s'emballent
  api: limiter(1, 240, 'Trop de requêtes, réessaie dans une minute.', byMember),
  // connexion (Discord, bot) : par adresse
  auth: limiter(15, 30, 'Trop de tentatives de connexion, réessaie dans quelques minutes.'),
  // envoi de photos (15 Mo max chacune, traitées en mémoire)
  upload: limiter(10, 10, 'Trop de photos envoyées d’un coup, réessaie dans quelques minutes.', byMember),
  // messages du chat
  chat: limiter(1, 20, 'Tu envoies trop de messages, ralentis un peu.', byMember),
  // (lectures relayées au bot : limite définie dans routes/bot.ts, qui ne compte que les vrais appels au bot)
};
