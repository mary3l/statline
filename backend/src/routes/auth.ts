import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SESSION_COOKIE, setSessionCookie, type SessionUser } from '../auth.js';
import { schema } from '../db/index.js';

// Compared against when the email is unknown, so both paths take the same time.
const DUMMY_HASH = bcrypt.hashSync('statline-timing-guard', 10);

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: z.object({ email: z.string().trim().email(), password: z.string().min(1) }),
      },
    },
    async (req, reply) => {
      const [user] = await app.db
        .select()
        .from(schema.users)
        .where(eq(sql`lower(${schema.users.email})`, req.body.email.toLowerCase()));
      const ok = await bcrypt.compare(req.body.password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !ok) return reply.code(401).send({ message: 'Email or password is incorrect.' });

      const session: SessionUser = { sub: user.id, email: user.email, name: user.name, role: user.role };
      setSessionCookie(reply, await reply.jwtSign(session));
      return { user: session };
    },
  );

  app.post('/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** Returns { user: null } instead of a 401 so the app can ask "am I signed in?" quietly. */
  app.get('/me', async (req) => {
    try {
      await req.jwtVerify();
      const { sub, email, name, role } = req.user;
      return { user: { sub, email, name, role } };
    } catch {
      return { user: null };
    }
  });
};
