// Accès à la base du site : Prisma pour les données, un pool pg pour les sessions (connect-pg-simple).
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { databaseUrl } from './database-url.js';

// délais : une base saturée ou figée fait échouer la requête (500) au lieu de la laisser pendue indéfiniment
export const pool = new pg.Pool({ connectionString: databaseUrl(), connectionTimeoutMillis: 5000, statement_timeout: 10000 });
export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
