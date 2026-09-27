// Configuration de la CLI Prisma (migrations, génération du client).
// L'URL n'est exigée que par les commandes qui touchent la base (migrate) : la génération du client s'en passe.
import { defineConfig } from 'prisma/config';
import { databaseUrl } from './src/database-url.js';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: databaseUrl(false) },
});
