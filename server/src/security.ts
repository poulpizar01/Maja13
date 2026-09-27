// En-têtes de sécurité (helmet) et limites de requêtes (express-rate-limit).
import type { Request } from 'express';
import helmet from 'helmet';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { config } from './config.js';

const https = config.baseUrl.startsWith('https');

// Politique de contenu : uniquement ce que les pages chargent réellement (Google Fonts, cdnjs pour three.js et
// SortableJS, avatars Discord, stockage d'images en prod). Scripts et styles en ligne autorisés : les pages en ont.
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
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
  // messages du Salon
  chat: limiter(1, 20, 'Tu envoies trop de messages, ralentis un peu.', byMember),
  // (lectures relayées au bot : limite définie dans routes/bot.ts, qui ne compte que les vrais appels au bot)
};
