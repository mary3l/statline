import { and, count, eq, inArray, sql, sum } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { schema } from '../db/index.js';
import { computeStandings } from '../engine/standings.js';
import { resolveSeason } from '../services/seasons.js';

const { games, leagues, playerGameLines, players, teams } = schema;

const leagueSeasonQuery = z.object({
  leagueId: z.coerce.number().int().positive(),
  seasonId: z.coerce.number().int().positive().optional(),
});

export const leagueRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/standings', { schema: { querystring: leagueSeasonQuery } }, async (req) => {
    const db = app.db;
    const season = await resolveSeason(db, req.query.seasonId);
    const [league] = await db.select().from(leagues).where(eq(leagues.id, req.query.leagueId));
    if (!league) throw new HttpError(404, 'League not found.');

    const seasonGames = await db
      .select()
      .from(games)
      .where(and(eq(games.leagueId, league.id), eq(games.seasonId, season.id)));

    // Teams with at least one game (played or scheduled) in this league-season.
    const teamIds = [...new Set(seasonGames.flatMap((g) => [g.homeTeamId, g.awayTeamId]))];
    const teamRows = teamIds.length ? await db.select().from(teams).where(inArray(teams.id, teamIds)) : [];
    const teamById = new Map(teamRows.map((t) => [t.id, t]));

    const decided = seasonGames
      .filter((g) => (g.status === 'final' || g.status === 'forfeit') && g.homeScore !== null && g.awayScore !== null)
      .map((g) => ({
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        homeScore: g.homeScore!,
        awayScore: g.awayScore!,
        forfeitedBy: g.forfeitedBy,
      }));

    const rows = computeStandings(teamIds, decided).map((r) => {
      const t = teamById.get(r.teamId)!;
      return { ...r, team: { id: t.id, name: t.name, shortName: t.shortName } };
    });
    return { season: { id: season.id, year: season.year }, league: { id: league.id, name: league.name }, rows };
  });

  app.get(
    '/leaders',
    { schema: { querystring: leagueSeasonQuery.extend({ limit: z.coerce.number().int().min(1).max(20).default(5) }) } },
    async (req) => {
      const db = app.db;
      const season = await resolveSeason(db, req.query.seasonId);
      const leagueId = req.query.leagueId;

      const finals = await db
        .select({ homeTeamId: games.homeTeamId, awayTeamId: games.awayTeamId })
        .from(games)
        .where(and(eq(games.leagueId, leagueId), eq(games.seasonId, season.id), eq(games.status, 'final')));
      const teamGames = new Map<number, number>();
      for (const g of finals) {
        for (const id of [g.homeTeamId, g.awayTeamId]) teamGames.set(id, (teamGames.get(id) ?? 0) + 1);
      }

      const totals = await db
        .select({
          playerId: playerGameLines.playerId,
          teamId: playerGameLines.teamId,
          firstName: players.firstName,
          lastName: players.lastName,
          teamName: teams.name,
          gp: count(),
          pts: sum(playerGameLines.pts).mapWith(Number),
          reb: sql<number>`sum(${playerGameLines.oreb} + ${playerGameLines.dreb})`.mapWith(Number),
          ast: sum(playerGameLines.ast).mapWith(Number),
          pir: sum(playerGameLines.pir).mapWith(Number),
        })
        .from(playerGameLines)
        .innerJoin(players, eq(players.id, playerGameLines.playerId))
        .innerJoin(teams, eq(teams.id, playerGameLines.teamId))
        .where(and(eq(playerGameLines.leagueId, leagueId), eq(playerGameLines.seasonId, season.id)))
        .groupBy(playerGameLines.playerId, playerGameLines.teamId, players.firstName, players.lastName, teams.name);

      // To qualify, a player must have played at least half of the team's games.
      const qualified = totals.filter((t) => t.gp * 2 >= (teamGames.get(t.teamId) ?? 0));

      const boards = (
        [
          ['pts', 'Points per game'],
          ['reb', 'Rebounds per game'],
          ['ast', 'Assists per game'],
          ['pir', 'PIR per game'],
        ] as const
      ).map(([key, title]) => ({
        key,
        title,
        leaders: qualified
          .map((t) => ({
            playerId: t.playerId,
            name: `${t.firstName} ${t.lastName}`,
            teamName: t.teamName,
            gp: t.gp,
            value: t[key] / t.gp,
          }))
          .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
          .slice(0, req.query.limit)
          .map((r, i) => ({ rank: i + 1, ...r, value: Math.round(r.value * 10) / 10 })),
      }));

      return { season: { id: season.id, year: season.year }, qualifiedPlayers: qualified.length, boards };
    },
  );
};
