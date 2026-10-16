import { and, asc, count, eq, isNull, max, ne, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HttpError } from '../app.js';
import type { DB } from '../db/index.js';
import { schema } from '../db/index.js';
import { leagueIneligibility } from '../engine/ageGroup.js';
import { FIBA } from '../engine/fiba.js';
import { recomputeGame } from '../services/games.js';
import { resolveSeason, todayManila } from '../services/seasons.js';

const { events, gameParticipants, games, leagues, playerLeagues, players, rosterEntries, seasons, teams } = schema;

const idParams = z.object({ id: z.coerce.number().int().positive() });
const name = z.string().trim().min(2).max(80);
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a colour like #B5480E.');
const jersey = z.string().trim().regex(/^(0|00|[1-9]\d?)$/, 'Jersey numbers are 0, 00 or 1–99.');
const age = z.number().int().min(5).max(80).nullable();
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

const leagueBody = z
  .object({
    name,
    level: z.string().trim().min(2).max(40),
    gender: z.enum(['F', 'M']).nullable(),
    minAge: age,
    maxAge: age,
  })
  .refine((b) => b.minAge === null || b.maxAge === null || b.minAge <= b.maxAge, { message: 'The minimum age is above the maximum.', path: ['maxAge'] });

const teamBody = z.object({ name, shortName: z.string().trim().min(2).max(5).transform((s) => s.toUpperCase()), color });

const gameBody = z.object({
  leagueId: z.number().int().positive(),
  seasonId: z.number().int().positive().optional(),
  homeTeamId: z.number().int().positive(),
  awayTeamId: z.number().int().positive(),
  /** ISO date-time with offset, e.g. 2026-10-24T14:00:00+08:00. */
  scheduledAt: z.string().datetime({ offset: true }),
  venue: z.string().trim().max(80).nullable(),
});

async function one<T>(rows: Promise<T[]>, message: string): Promise<T> {
  const [row] = await rows;
  if (!row) throw new HttpError(404, message);
  return row;
}

async function checkTeams(db: DB, leagueId: number, homeTeamId: number, awayTeamId: number) {
  if (homeTeamId === awayTeamId) throw new HttpError(400, 'A team cannot play itself.');
  for (const id of [homeTeamId, awayTeamId]) {
    const t = await one(db.select().from(teams).where(eq(teams.id, id)), 'Team not found.');
    if (t.leagueId !== leagueId) throw new HttpError(400, `${t.name} is not in this league.`);
  }
}

/** League office set-up: seasons, leagues, teams and rosters, and the schedule. Admins and organizers only. */
export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.requireRole('admin', 'organizer'));

  // ---------------------------------------------------------------- seasons
  app.post(
    '/seasons',
    { schema: { body: z.object({ year: z.number().int().min(2000).max(2100), name: z.string().trim().max(60).optional(), isCurrent: z.boolean().default(false) }) } },
    async (req, reply) => {
      const db = app.db;
      const b = req.body;
      const created = await db.transaction(async (tx) => {
        if (b.isCurrent) await tx.update(seasons).set({ isCurrent: false });
        const [s] = await tx.insert(seasons).values({ year: b.year, name: b.name || `${b.year} season`, isCurrent: b.isCurrent }).returning();
        return s!;
      });
      return reply.code(201).send(created);
    },
  );

  app.patch(
    '/seasons/:id',
    { schema: { params: idParams, body: z.object({ name: z.string().trim().min(2).max(60).optional(), isCurrent: z.literal(true).optional() }) } },
    async (req) => {
      const db = app.db;
      await one(db.select().from(seasons).where(eq(seasons.id, req.params.id)), 'Season not found.');
      await db.transaction(async (tx) => {
        if (req.body.isCurrent) await tx.update(seasons).set({ isCurrent: false });
        await tx
          .update(seasons)
          .set({ ...(req.body.name ? { name: req.body.name } : {}), ...(req.body.isCurrent ? { isCurrent: true } : {}) })
          .where(eq(seasons.id, req.params.id));
      });
      return { ok: true };
    },
  );

  // ---------------------------------------------------------------- leagues
  app.post('/leagues', { schema: { body: leagueBody } }, async (req, reply) => {
    const db = app.db;
    const b = req.body;
    const [{ last } = { last: 0 }] = await db.select({ last: max(leagues.sortOrder) }).from(leagues);
    let slug = slugify(b.name) || 'league';
    const [taken] = await db.select({ id: leagues.id }).from(leagues).where(eq(leagues.slug, slug));
    if (taken) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const [l] = await db.insert(leagues).values({ ...b, slug, sortOrder: (last ?? 0) + 1 }).returning();
    return reply.code(201).send(l);
  });

  app.patch('/leagues/:id', { schema: { params: idParams, body: leagueBody } }, async (req) => {
    const db = app.db;
    await one(db.select().from(leagues).where(eq(leagues.id, req.params.id)), 'League not found.');
    await db.update(leagues).set(req.body).where(eq(leagues.id, req.params.id));
    return { ok: true };
  });

  // ---------------------------------------------------------------- teams
  app.post('/teams', { schema: { body: teamBody.extend({ leagueId: z.number().int().positive() }) } }, async (req, reply) => {
    const db = app.db;
    await one(db.select().from(leagues).where(eq(leagues.id, req.body.leagueId)), 'League not found.');
    const [t] = await db.insert(teams).values(req.body).returning();
    return reply.code(201).send(t);
  });

  app.patch('/teams/:id', { schema: { params: idParams, body: teamBody } }, async (req) => {
    const db = app.db;
    await one(db.select().from(teams).where(eq(teams.id, req.params.id)), 'Team not found.');
    await db.update(teams).set(req.body).where(eq(teams.id, req.params.id));
    return { ok: true };
  });

  // ---------------------------------------------------------------- rosters
  app.get(
    '/teams/:id/roster',
    { schema: { params: idParams, querystring: z.object({ seasonId: z.coerce.number().int().positive().optional() }) } },
    async (req) => {
      const db = app.db;
      const team = await one(db.select().from(teams).where(eq(teams.id, req.params.id)), 'Team not found.');
      const season = await resolveSeason(db, req.query.seasonId);
      const rows = await db
        .select({
          entryId: rosterEntries.id,
          playerId: players.id,
          firstName: players.firstName,
          lastName: players.lastName,
          position: players.position,
          status: players.status,
          jersey: rosterEntries.jersey,
          joinedOn: rosterEntries.joinedOn,
          leftOn: rosterEntries.leftOn,
        })
        .from(rosterEntries)
        .innerJoin(players, eq(players.id, rosterEntries.playerId))
        .where(and(eq(rosterEntries.teamId, team.id), eq(rosterEntries.seasonId, season.id)))
        .orderBy(asc(rosterEntries.leftOn), asc(players.lastName));
      return { team, season: { id: season.id, year: season.year }, players: rows };
    },
  );

  app.post(
    '/teams/:id/roster',
    {
      schema: {
        params: idParams,
        body: z.object({ playerId: z.number().int().positive(), jersey, seasonId: z.number().int().positive().optional() }),
      },
    },
    async (req, reply) => {
      const db = app.db;
      const team = await one(db.select().from(teams).where(eq(teams.id, req.params.id)), 'Team not found.');
      const league = await one(db.select().from(leagues).where(eq(leagues.id, team.leagueId)), 'League not found.');
      const season = await resolveSeason(db, req.body.seasonId);
      const player = await one(db.select().from(players).where(eq(players.id, req.body.playerId)), 'Player not found.');

      const reason = leagueIneligibility(player, league, season.year);
      if (reason) throw new HttpError(422, `Not eligible for ${league.name}: ${reason}`);

      const [current] = await db
        .select({ teamName: teams.name })
        .from(rosterEntries)
        .innerJoin(teams, eq(teams.id, rosterEntries.teamId))
        .where(and(eq(rosterEntries.playerId, player.id), eq(rosterEntries.seasonId, season.id), isNull(rosterEntries.leftOn)));
      if (current) throw new HttpError(409, `${player.firstName} ${player.lastName} is on ${current.teamName} this season. Release them there first.`);

      const [clash] = await db
        .select({ firstName: players.firstName, lastName: players.lastName })
        .from(rosterEntries)
        .innerJoin(players, eq(players.id, rosterEntries.playerId))
        .where(and(eq(rosterEntries.teamId, team.id), eq(rosterEntries.seasonId, season.id), eq(rosterEntries.jersey, req.body.jersey), isNull(rosterEntries.leftOn)));
      if (clash) throw new HttpError(409, `#${req.body.jersey} is already worn by ${clash.firstName} ${clash.lastName}.`);

      await db.transaction(async (tx) => {
        await tx.insert(rosterEntries).values({ playerId: player.id, teamId: team.id, seasonId: season.id, jersey: req.body.jersey, joinedOn: todayManila() });
        await tx.insert(playerLeagues).values({ playerId: player.id, leagueId: league.id }).onConflictDoNothing();
      });
      return reply.code(201).send({ ok: true });
    },
  );

  /** Release: the entry stays (history, past box scores) but is closed today. */
  app.delete('/roster/:id', { schema: { params: idParams } }, async (req) => {
    const db = app.db;
    const entry = await one(db.select().from(rosterEntries).where(eq(rosterEntries.id, req.params.id)), 'Roster entry not found.');
    if (entry.leftOn) return { ok: true };
    await db.update(rosterEntries).set({ leftOn: todayManila() }).where(eq(rosterEntries.id, entry.id));
    return { ok: true };
  });

  // ---------------------------------------------------------------- schedule
  app.post('/games', { schema: { body: gameBody } }, async (req, reply) => {
    const db = app.db;
    const b = req.body;
    await one(db.select().from(leagues).where(eq(leagues.id, b.leagueId)), 'League not found.');
    const season = await resolveSeason(db, b.seasonId);
    await checkTeams(db, b.leagueId, b.homeTeamId, b.awayTeamId);
    const [{ last } = { last: 0 }] = await db
      .select({ last: max(games.gameNumber) })
      .from(games)
      .where(and(eq(games.leagueId, b.leagueId), eq(games.seasonId, season.id)));
    const [g] = await db
      .insert(games)
      .values({
        seasonId: season.id,
        leagueId: b.leagueId,
        gameNumber: (last ?? 0) + 1,
        scheduledAt: new Date(b.scheduledAt),
        venue: b.venue || null,
        homeTeamId: b.homeTeamId,
        awayTeamId: b.awayTeamId,
      })
      .returning();
    return reply.code(201).send(g);
  });

  app.patch('/games/:id', { schema: { params: idParams, body: gameBody.omit({ leagueId: true, seasonId: true }) } }, async (req) => {
    const db = app.db;
    const g = await one(db.select().from(games).where(eq(games.id, req.params.id)), 'Game not found.');
    const b = req.body;
    const teamsChanged = b.homeTeamId !== g.homeTeamId || b.awayTeamId !== g.awayTeamId;
    // Date, time and venue can always be corrected; the teams only before tip-off.
    if (teamsChanged && g.status !== 'scheduled') throw new HttpError(409, 'The teams can only be changed before the game starts.');
    if (teamsChanged) await checkTeams(db, g.leagueId, b.homeTeamId, b.awayTeamId);
    await db
      .update(games)
      .set({ scheduledAt: new Date(b.scheduledAt), venue: b.venue || null, homeTeamId: b.homeTeamId, awayTeamId: b.awayTeamId })
      .where(eq(games.id, g.id));
    return { ok: true };
  });

  app.delete('/games/:id', { schema: { params: idParams } }, async (req) => {
    const db = app.db;
    const g = await one(db.select().from(games).where(eq(games.id, req.params.id)), 'Game not found.');
    if (g.status !== 'scheduled') throw new HttpError(409, 'Only a game that hasn’t started can be deleted. Reset a live game first.');
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(events).where(eq(events.gameId, g.id));
    if (n > 0) throw new HttpError(409, 'This game has recorded plays and can’t be deleted.');
    await db.transaction(async (tx) => {
      await tx.delete(gameParticipants).where(eq(gameParticipants.gameId, g.id));
      await tx.delete(games).where(eq(games.id, g.id));
    });
    return { ok: true };
  });

  /** FIBA forfeit: recorded 20–0 for the team that was ready; the forfeiting team gets 0 standing points. */
  app.post(
    '/games/:id/forfeit',
    { schema: { params: idParams, body: z.object({ forfeitedBy: z.enum(['home', 'away']).nullable() }) } },
    async (req) => {
      const db = app.db;
      const g = await one(db.select().from(games).where(eq(games.id, req.params.id)), 'Game not found.');
      const by = req.body.forfeitedBy;
      if (by === null) {
        // Undo a forfeit entered by mistake.
        if (g.status !== 'forfeit') throw new HttpError(409, 'This game is not a forfeit.');
        await db.update(games).set({ status: 'scheduled', forfeitedBy: null, homeScore: null, awayScore: null }).where(eq(games.id, g.id));
      } else {
        if (g.status !== 'scheduled') throw new HttpError(409, 'Only a game that hasn’t started can be recorded as a forfeit.');
        const win = FIBA.forfeitScore;
        await db
          .update(games)
          .set({ status: 'forfeit', forfeitedBy: by, homeScore: by === 'home' ? 0 : win, awayScore: by === 'away' ? 0 : win })
          .where(eq(games.id, g.id));
      }
      await recomputeGame(db, g.id);
      return { ok: true };
    },
  );

  /** Teams' other games around a time, to warn about double bookings in the schedule form. */
  app.get(
    '/games/conflicts',
    {
      schema: {
        querystring: z.object({
          teamIds: z.string().regex(/^\d+(,\d+)*$/),
          day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          excludeId: z.coerce.number().int().optional(),
        }),
      },
    },
    async (req) => {
      const ids = req.query.teamIds.split(',').map(Number);
      const from = new Date(`${req.query.day}T00:00:00+08:00`);
      const to = new Date(from.getTime() + 24 * 3600_000);
      const rows = await app.db
        .select({ id: games.id, scheduledAt: games.scheduledAt, homeTeamId: games.homeTeamId, awayTeamId: games.awayTeamId })
        .from(games)
        .where(
          and(
            ...(req.query.excludeId ? [ne(games.id, req.query.excludeId)] : []),
            or(...ids.flatMap((id) => [eq(games.homeTeamId, id), eq(games.awayTeamId, id)])),
          ),
        );
      return { games: rows.filter((g) => g.scheduledAt >= from && g.scheduledAt < to) };
    },
  );
};
