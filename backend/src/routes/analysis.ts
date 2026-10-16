import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { schema } from '../db/index.js';
import { computeLineups, unitKey } from '../engine/lineups.js';
import type { Side } from '../engine/types.js';
import { buildBoxScore, loadEvents, loadParticipants } from '../services/games.js';
import { resolveSeason } from '../services/seasons.js';

const { games, players, teams } = schema;

const MATCHUP_KEYS = ['pts', 'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'pf', 'pir'] as const;
type MatchupKey = (typeof MATCHUP_KEYS)[number];

/** Season views built from the event lists: five-player lineups and team-vs-team matchups. Public, like box scores. */
export const analysisRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/lineups',
    {
      schema: {
        querystring: z.object({
          teamId: z.coerce.number().int().positive(),
          seasonId: z.coerce.number().int().positive().optional(),
          /** One game instead of the whole season. */
          gameId: z.coerce.number().int().positive().optional(),
        }),
      },
    },
    async (req) => {
      const db = app.db;
      const { teamId, gameId } = req.query;
      const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
      if (!team) throw new HttpError(404, 'Team not found.');
      const season = await resolveSeason(db, req.query.seasonId);

      const teamGames = await db
        .select()
        .from(games)
        .where(
          gameId
            ? and(eq(games.id, gameId), or(eq(games.homeTeamId, teamId), eq(games.awayTeamId, teamId)))
            : and(
                eq(games.seasonId, season.id),
                eq(games.status, 'final'),
                or(eq(games.homeTeamId, teamId), eq(games.awayTeamId, teamId)),
              ),
        )
        .orderBy(asc(games.scheduledAt));
      if (gameId && !teamGames.length) throw new HttpError(404, 'That team did not play in this game.');

      const units = new Map<string, { playerIds: number[]; games: Set<number>; seconds: number; ptsFor: number; ptsAgainst: number }>();
      const jersey = new Map<number, string>();
      for (const g of teamGames) {
        if (g.status !== 'final' && g.status !== 'live') continue;
        const side: Side = g.homeTeamId === teamId ? 'home' : 'away';
        const [parts, evts] = await Promise.all([loadParticipants(db, g.id), loadEvents(db, g.id)]);
        for (const p of parts) if (p.side === side) jersey.set(p.playerId, p.jersey);
        const lineups = computeLineups(parts.map((p) => ({ playerId: p.playerId, side: p.side, starter: p.starter })), evts, {
          final: g.status === 'final',
        });
        for (const u of lineups) {
          if (u.side !== side) continue;
          const key = unitKey(u.playerIds);
          const acc = units.get(key) ?? { playerIds: u.playerIds, games: new Set<number>(), seconds: 0, ptsFor: 0, ptsAgainst: 0 };
          acc.games.add(g.id);
          acc.seconds += u.seconds;
          acc.ptsFor += u.ptsFor;
          acc.ptsAgainst += u.ptsAgainst;
          units.set(key, acc);
        }
      }

      const ids = [...new Set([...units.values()].flatMap((u) => u.playerIds))];
      const names = ids.length
        ? await db.select({ id: players.id, firstName: players.firstName, lastName: players.lastName }).from(players).where(inArray(players.id, ids))
        : [];
      const byId = new Map(names.map((n) => [n.id, n]));

      return {
        team: { id: team.id, name: team.name, shortName: team.shortName, leagueId: team.leagueId },
        season: { id: season.id, year: season.year },
        games: teamGames.filter((g) => g.status === 'final' || g.status === 'live').length,
        units: [...units.values()]
          .map((u) => ({
            players: u.playerIds
              .map((id) => ({
                playerId: id,
                jersey: jersey.get(id) ?? '?',
                firstName: byId.get(id)?.firstName ?? '',
                lastName: byId.get(id)?.lastName ?? `Player ${id}`,
              }))
              .sort((a, b) => Number(a.jersey) - Number(b.jersey)),
            games: u.games.size,
            seconds: u.seconds,
            ptsFor: u.ptsFor,
            ptsAgainst: u.ptsAgainst,
            plusMinus: u.ptsFor - u.ptsAgainst,
          }))
          .sort((a, b) => b.plusMinus - a.plusMinus || b.seconds - a.seconds),
      };
    },
  );

  app.get(
    '/matchup',
    {
      schema: {
        querystring: z.object({
          teamA: z.coerce.number().int().positive(),
          teamB: z.coerce.number().int().positive(),
          seasonId: z.coerce.number().int().positive().optional(),
        }),
      },
    },
    async (req) => {
      const db = app.db;
      const { teamA, teamB } = req.query;
      if (teamA === teamB) throw new HttpError(400, 'Pick two different teams.');
      const teamRows = await db.select().from(teams).where(inArray(teams.id, [teamA, teamB]));
      const a = teamRows.find((t) => t.id === teamA);
      const b = teamRows.find((t) => t.id === teamB);
      if (!a || !b) throw new HttpError(404, 'Team not found.');
      const season = await resolveSeason(db, req.query.seasonId);

      const meetings = await db
        .select()
        .from(games)
        .where(
          and(
            eq(games.seasonId, season.id),
            inArray(games.status, ['final', 'forfeit']),
            or(
              and(eq(games.homeTeamId, teamA), eq(games.awayTeamId, teamB)),
              and(eq(games.homeTeamId, teamB), eq(games.awayTeamId, teamA)),
            ),
          ),
        )
        .orderBy(asc(games.scheduledAt));

      const zero = () => Object.fromEntries(MATCHUP_KEYS.map((k) => [k, 0])) as Record<MatchupKey, number>;
      const totals = { a: zero(), b: zero() };
      const wins = { a: 0, b: 0 };
      const list = [];
      let played = 0;
      for (const g of meetings) {
        const aSide: Side = g.homeTeamId === teamA ? 'home' : 'away';
        const bSide: Side = aSide === 'home' ? 'away' : 'home';
        const score = { home: g.homeScore ?? 0, away: g.awayScore ?? 0 };
        if (score[aSide] > score[bSide]) wins.a++;
        else if (score[bSide] > score[aSide]) wins.b++;
        list.push({ id: g.id, scheduledAt: g.scheduledAt, status: g.status, aScore: score[aSide], bScore: score[bSide], aHome: aSide === 'home' });
        // A forfeit counts in the record but has no plays.
        if (g.status !== 'final') continue;
        played++;
        const box = await buildBoxScore(db, g.id, true);
        for (const k of MATCHUP_KEYS) {
          totals.a[k] += box.totals[aSide][k];
          totals.b[k] += box.totals[bSide][k];
        }
      }

      const team = (t: typeof a) => ({ id: t.id, name: t.name, shortName: t.shortName, leagueId: t.leagueId });
      return { season: { id: season.id, year: season.year }, a: team(a), b: team(b), wins, played, totals, games: list };
    },
  );
};
