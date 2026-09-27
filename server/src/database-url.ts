// URL de la base, partagée par le serveur et la CLI Prisma (prisma.config.ts).
// En Docker, la base s'appelle « maja13-db » et seul POSTGRES_PASSWORD est fourni.
export function databaseUrl(required = true): string {
  const url = process.env.DATABASE_URL
    || (process.env.POSTGRES_PASSWORD && `postgres://maja13:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}@maja13-db:5432/maja13`);
  if (!url && required) throw new Error('Variable manquante dans .env : DATABASE_URL (ou POSTGRES_PASSWORD)');
  return url || '';
}
