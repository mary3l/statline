import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { registerAuth } from './auth.js';
import type { DB } from './db/index.js';
import { adminRoutes } from './routes/admin.js';
import { analysisRoutes } from './routes/analysis.js';
import { authRoutes } from './routes/auth.js';
import { gameRoutes } from './routes/games.js';
import { leagueRoutes } from './routes/leagues.js';
import { metaRoutes } from './routes/meta.js';
import { playerRoutes } from './routes/players.js';
import { recorderRoutes } from './routes/recorder.js';
import { uploadRoutes } from './routes/uploads.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
  }
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Postgres error code (e.g. 23505 unique violation). Drizzle wraps driver errors, so the code may sit on `cause`. */
export function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === 'string' ? code : undefined;
}

export async function buildApp(db: DB, opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ?? true,
    // Behind a reverse proxy in production, so trust its X-Forwarded-* headers for rate limiting.
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('db', db);

  app.setErrorHandler((err: FastifyError & { code?: string }, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ message: err.message, ...err.extra });
    }
    if (err.validation) {
      const issues = err.validation.map((v) => `${v.instancePath.replace(/^\//, '') || 'request'}: ${v.message}`);
      return reply.code(400).send({ message: 'Some fields are not valid.', issues });
    }
    if (pgErrorCode(err) === '23505') {
      return reply.code(409).send({ message: 'That record already exists.' });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ message: err.message });
    }
    req.log.error(err);
    return reply.code(500).send({ message: 'Something went wrong on the server.' });
  });

  await app.register(rateLimit, { global: false });
  await registerAuth(app);

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(metaRoutes, { prefix: '/api' });
  await app.register(playerRoutes, { prefix: '/api/players' });
  await app.register(uploadRoutes, { prefix: '/api/players' });
  await app.register(gameRoutes, { prefix: '/api/games' });
  await app.register(recorderRoutes, { prefix: '/api/games' });
  await app.register(leagueRoutes, { prefix: '/api' });
  await app.register(analysisRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api/admin' });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
