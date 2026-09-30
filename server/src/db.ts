// Accès à la base du site : Prisma pour les données, un pool pg pour les sessions (connect-pg-simple).
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { databaseUrl } from './database-url.js';

export const pool = new pg.Pool({ connectionString: databaseUrl() });
export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
