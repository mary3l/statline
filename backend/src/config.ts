import { existsSync } from 'node:fs';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(3001),
  /** Postgres connection string. Leave empty to use the embedded PGlite database in PGLITE_DIR. */
  DATABASE_URL: z.string().optional().transform((v) => (v ? v : undefined)),
  PGLITE_DIR: z.string().default('./.data/pglite'),
  /** Player photos and birth certificates. Keep it out of the web root and back it up with the database. */
  UPLOAD_DIR: z.string().default('./.data/uploads'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
  /** Shared password for the organizer@ and scorer@statline.test accounts (development only). */
  SEED_DEMO_PASSWORD: z.string().min(8).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment. Copy .env.example to .env and fill it in.');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  COOKIE_SECURE: parsed.data.COOKIE_SECURE ?? parsed.data.NODE_ENV === 'production',
};
