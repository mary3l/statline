import { and, asc, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HttpError } from '../app.js';
import type { DB } from '../db/index.js';
import { schema } from '../db/index.js';
import type { ServerResponse } from 'node:http';
import { onGameChanged } from '../services/gameEvents.js';
import { buildBoxScore } from '../services/games.js';
import { resolveSeason } from '../services/seasons.js';

const { gameParticipants, games, leagues, players, teams } = schema;

/** Calendar month of tip-off in Davao (UTC+8, no daylight saving), e.g. '2026-10'. */
const gameMonth = sql<string>`to_char((${games.scheduledAt} at time zone 'UTC') + interval '8 hours', 'YYYY-MM')`;

const homeTeam = alias(teams, 'home_team');
const awayTeam = alias(teams, 'away_team');

export function gameQuery(db: DB) {
  return db
    .select({
      id: games.id,
      seasonId: games.seasonId,
      gameNumber: games.gameNumber,
      scheduledAt: games.scheduledAt,
      venue: games.venue,
      status: games.status,
      forfeitedBy: games.forfeitedBy,
      periods: games.periods,
      leagueId: leagues.id,
      leagueName: leagues.name,
      homeId: homeTeam.id,
      homeName: homeTeam.name,
      homeShort: homeTeam.shortName,
      homeScore: games.homeScore,
      awayId: awayTeam.id,
      awayName: awayTeam.name,
      awayShort: awayTeam.shortName,
      awayScore: games.awayScore,
    })
    .from(games)
    .innerJoin(leagues, eq(leagues.id, games.leagueId))
    .innerJoin(homeTeam, eq(homeTeam.id, games.homeTeamId))
    .innerJoin(awayTeam, eq(awayTeam.id, games.awayTeamId));
}

type GameRow = Awaited<ReturnType<ReturnType<typeof gameQuery>['execute']>>[number];

export function shapeGame(g: GameRow) {
  return {
    id: g.id,
    seasonId: g.seasonId,
    gameNumber: g.gameNumber,
    scheduledAt: g.scheduledAt,
    venue: g.venue,
    status: g.status,
    forfeitedBy: g.forfeitedBy,
    periods: g.periods,
    league: { id: g.leagueId, name: g.leagueName },
    home: { id: g.homeId, name: g.homeName, shortName: g.homeShort, score: g.homeScore },
    away: { id: g.awayId, name: g.awayName, shortName: g.awayShort, score: g.awayScore },
  };
}

export const gameRoutes: FastifyPluginAsyncZod = async (app) => {
  // Open live streams are ended on shutdown, so a restart doesn't wait on them.
  const streams = new Set<ServerResponse>();
  app.addHook('preClose', async () => {
    for (const res of streams) res.end();
  });

  /** Server-sent events: one `change` message whenever the game's plays or status change. Public, like the box score. */
  app.get('/:id/stream', { schema: { params: z.object({ id: z.coerce.number().int().positive() }) } }, async (req, reply) => {
    const [game] = await app.db.select({ id: games.id }).from(games).where(eq(games.id, req.params.id));
    if (!game) throw new HttpError(404, 'Game not found.');
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    streams.add(res);
    const off = onGameChanged(game.id, () => res.write(`event: change\ndata: ${Date.now()}\n\n`));
    // Comment lines keep proxies from closing an idle stream.
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      off();
      streams.delete(res);
    });
  });

  app.get(
    '/',
    {
      schema: {
        querystring: z.object({
          seasonId: z.coerce.number().int().optional(),
          leagueId: z.coerce.number().int().optional(),
          teamId: z.coerce.number().int().optional(),
          status: z.enum(['scheduled', 'live', 'final', 'forfeit']).optional(),
          /** YYYY-MM, in Davao time. */
          month: z
            .string()
            .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
            .optional(),
        }),
      },
    },
    async (req) => {
      const db = app.db;
      const f = req.query;
      const season = await resolveSeason(db, f.seasonId);
      const conds: SQL[] = [eq(games.seasonId, season.id)];
      if (f.leagueId) conds.push(eq(games.leagueId, f.leagueId));
      if (f.status) conds.push(eq(games.status, f.status));
      if (f.teamId) conds.push(or(eq(games.homeTeamId, f.teamId), eq(games.awayTeamId, f.teamId))!);

      // Months are taken before the month filter, so the picker always lists every month with games.
      const [monthRows, rows] = await Promise.all([
        db
          .selectDistinct({ month: gameMonth })
          .from(games)
          .where(and(...conds))
          .orderBy(desc(gameMonth)),
        gameQuery(db)
          .where(and(...conds, ...(f.month ? [eq(gameMonth, f.month)] : [])))
          .orderBy(desc(games.scheduledAt), desc(games.gameNumber)),
      ]);
      return {
        season: { id: season.id, year: season.year },
        months: monthRows.map((r) => r.month),
        items: rows.map(shapeGame),
      };
    },
  );

  app.get(
    '/:id/boxscore',
    { schema: { params: z.object({ id: z.coerce.number().int().positive() }) } },
    async (req) => {
      const db = app.db;
      const [row] = await gameQuery(db).where(eq(games.id, req.params.id));
      if (!row) throw new HttpError(404, 'Game not found.');
      const game = shapeGame(row);

      if (game.status === 'scheduled' || game.status === 'forfeit') return { game, box: null };

      const [box, roster] = await Promise.all([
        buildBoxScore(db, game.id, game.status === 'final'),
        db
          .select({
            playerId: gameParticipants.playerId,
            jersey: gameParticipants.jersey,
            firstName: players.firstName,
            lastName: players.lastName,
            position: players.position,
          })
          .from(gameParticipants)
          .innerJoin(players, eq(players.id, gameParticipants.playerId))
          .where(eq(gameParticipants.gameId, game.id))
          .orderBy(asc(gameParticipants.side)),
      ]);
      const byId = new Map(roster.map((r) => [r.playerId, r]));

      const playersOut = box.players
        .map((p) => {
          const r = byId.get(p.playerId);
          return {
            ...p,
            jersey: r?.jersey ?? '?',
            name: r ? `${r.firstName} ${r.lastName}` : `Player ${p.playerId}`,
            lastName: r?.lastName ?? `Player ${p.playerId}`,
            position: r?.position ?? null,
          };
        })
        // Starters first, then by minutes, as on a printed box score.
        .sort((a, b) => Number(b.starter) - Number(a.starter) || b.seconds - a.seconds);

      return {
        game,
        box: {
          periods: box.periods,
          score: box.score,
          lineScore: box.lineScore,
          totals: box.totals,
          players: playersOut,
          shots: box.shots,
        },
      };
    },
  );
};
