import { asc, count, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { schema } from '../db/index.js';
import { AGE_GROUPS } from '../engine/ageGroup.js';
import { resolveSeason } from '../services/seasons.js';

const { games, leagues, seasons, teams } = schema;

/** Reference data every screen needs: seasons, leagues (with rules), teams and option lists. */
export const metaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/meta', async () => {
    const db = app.db;
    const [current, seasonRows, leagueRows, teamRows, gameCounts] = await Promise.all([
      resolveSeason(db),
      db.select().from(seasons).orderBy(asc(seasons.year)),
      db.select().from(leagues).orderBy(asc(leagues.sortOrder)),
      db.select().from(teams).orderBy(asc(teams.name)),
      db
        .select({ leagueId: games.leagueId, seasonId: games.seasonId, played: count() })
        .from(games)
        .where(inArray(games.status, ['final', 'forfeit']))
        .groupBy(games.leagueId, games.seasonId),
    ]);

    return {
      currentSeasonId: current.id,
      seasons: seasonRows,
      leagues: leagueRows.map((l) => ({
        ...l,
        /** Season ids in which this league has finished games (used for the Leaders tabs). */
        seasonsWithGames: gameCounts.filter((g) => g.leagueId === l.id && g.played > 0).map((g) => g.seasonId),
      })),
      teams: teamRows,
      positions: schema.positionEnum.enumValues,
      statuses: schema.playerStatusEnum.enumValues,
      ageGroups: AGE_GROUPS,
    };
  });
};
