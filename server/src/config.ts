// Configuration lue dans l'environnement (.env en prod, compose.override.yaml en dev).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const env = process.env;
const baseUrl = env.BASE_URL ?? fail('Variable manquante dans .env : BASE_URL');

// connexion de dev sans Discord : uniquement en local (DEV_LOGIN=1 + BASE_URL sur localhost)
const devLogin = env.DEV_LOGIN === '1';
if (devLogin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) fail('DEV_LOGIN=1 refusé : BASE_URL doit être http://localhost');

const required = (name: string): string => env[name] || (devLogin ? '' : fail(`Variable manquante dans .env : ${name}`));

// racine du dépôt (index.html, styles.css, casa/…) : dist/ ou src/ → server/ → racine
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const config = {
  port: Number(env.PORT) || 3000,
  baseUrl,
  devLogin,
  // compte de dev : ID Discord réel (DEV_DISCORD_ID) pour pouvoir le connecter au bot, sinon un identifiant fictif
  devDiscordId: env.DEV_DISCORD_ID || 'dev-local',
  sessionSecret: env.SESSION_SECRET ?? fail('Variable manquante dans .env : SESSION_SECRET'),
  discord: {
    clientId: required('DISCORD_CLIENT_ID'),
    clientSecret: required('DISCORD_CLIENT_SECRET'),
    guildId: required('DISCORD_GUILD_ID'),
  },
  root,
  storage: {
    url: env.STORAGE_URL || '',
    token: env.STORAGE_TOKEN || '',
    prefix: env.STORAGE_PREFIX ?? 'maja13/',
    dir: env.UPLOAD_DIR || join(root, 'uploads'),
  },
  // API REST du bot Discord (géré à part) ; vide = pages liées au bot désactivées
  botApiUrl: (env.BOT_API_URL || '').replace(/\/+$/, ''),
};
