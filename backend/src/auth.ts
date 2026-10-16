import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';

export type Role = 'admin' | 'organizer' | 'scorer';

export interface SessionUser {
  sub: string;
  email: string;
  name: string;
  role: Role;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionUser;
    user: SessionUser;
  }
}

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
  interface FastifyInstance {
    /** onRequest guard: any signed-in user. Runs before body validation. */
    requireUser: Guard;
    /** onRequest guard: a signed-in user with one of these roles. */
    requireRole: (...roles: Role[]) => Guard;
  }
}

export const SESSION_COOKIE = 'statline_session';
export const SESSION_DAYS = 7;

export async function registerAuth(app: FastifyInstance) {
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    cookie: { cookieName: SESSION_COOKIE, signed: false },
    sign: { expiresIn: `${SESSION_DAYS}d` },
  });

  const requireUser: Guard = async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ message: 'Sign in to continue.' });
    }
  };

  app.decorate('requireUser', requireUser);
  app.decorate('requireRole', (...roles: Role[]): Guard => async (req, reply) => {
    await requireUser(req, reply);
    if (reply.sent) return;
    if (!roles.includes(req.user.role)) {
      return reply.code(403).send({ message: 'Your account cannot do this.' });
    }
  });
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}
