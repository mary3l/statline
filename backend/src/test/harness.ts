import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { buildApp } from '../app.js';
import { SESSION_COOKIE, type Role } from '../auth.js';
import { config } from '../config.js';
import { schema, type DB } from '../db/index.js';

/**
 * A real API on a random local port, backed by a throwaway in-memory database and a temp upload folder.
 * Never touches the dev data in .data/. (Real HTTP because light-my-request can't load on Node < 20.19.)
 */
export async function createTestApi() {
  const client = new PGlite();
  const pg = drizzle(client, { schema, casing: 'snake_case' });
  await migrate(pg, { migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle') });
  const db = pg as unknown as DB;
  const uploads = mkdtempSync(path.join(tmpdir(), 'statline-test-uploads-'));
  config.UPLOAD_DIR = uploads;

  const app = await buildApp(db, { logger: false });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });

  const cookies = new Map<Role, string>();
  for (const role of ['admin', 'organizer', 'scorer'] as const) {
    const [u] = await db.insert(schema.users).values({ email: `${role}@test`, name: role, passwordHash: 'x', role }).returning();
    cookies.set(role, `${SESSION_COOKIE}=${app.jwt.sign({ sub: u!.id, email: u!.email, name: role, role })}`);
  }

  async function request(url: string, init: { method?: string; body?: unknown; as?: Role } = {}) {
    const res = await fetch(`${base}${url}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.as ? { cookie: cookies.get(init.as)! } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      statusCode: res.status,
      headers: res.headers,
      body: buf,
      json: () => JSON.parse(buf.toString('utf8')),
    };
  }

  /** One season, one league, two teams of 7 (the 7th suspended) and one scheduled game. */
  async function seedLeague() {
    const [season] = await db.insert(schema.seasons).values({ year: 2026, name: '2026 season', isCurrent: true }).returning();
    const [league] = await db.insert(schema.leagues).values({ slug: 'test', name: 'Test League', level: 'Open' }).returning();
    const teams = await db
      .insert(schema.teams)
      .values([
        { leagueId: league!.id, name: 'Home Hawks', shortName: 'HAW', color: '#E8742A' },
        { leagueId: league!.id, name: 'Away Owls', shortName: 'OWL', color: '#9CC6F7' },
      ])
      .returning();
    const ids = { home: [] as number[], away: [] as number[] };
    for (const [i, side] of (['home', 'away'] as const).entries()) {
      for (let j = 0; j < 7; j++) {
        const [p] = await db
          .insert(schema.players)
          .values({ firstName: `P${j}`, lastName: `${side}${j}`, birthdate: '2000-01-01', gender: 'M', position: 'SF', status: j === 6 ? 'suspended' : 'available' })
          .returning();
        await db.insert(schema.rosterEntries).values({ playerId: p!.id, teamId: teams[i]!.id, seasonId: season!.id, jersey: String(j + 4) });
        ids[side].push(p!.id);
      }
    }
    const [game] = await db
      .insert(schema.games)
      .values({ seasonId: season!.id, leagueId: league!.id, gameNumber: 1, scheduledAt: new Date('2026-10-20T06:00:00Z'), homeTeamId: teams[0]!.id, awayTeamId: teams[1]!.id })
      .returning();
    return { season: season!, league: league!, home: teams[0]!, away: teams[1]!, ids, gameId: game!.id };
  }

  return {
    db,
    app,
    base,
    request,
    seedLeague,
    uploads,
    close: async () => {
      await app.close();
      await client.close();
      rmSync(uploads, { recursive: true, force: true });
    },
  };
}

export type TestApi = Awaited<ReturnType<typeof createTestApi>>;
