import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, sum, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { schema } from '../db/index.js';
import {
  AGE_GROUPS,
  ageGroup,
  ageInSeason,
  ageRange,
  currentAge,
  eligibility,
  leagueIneligibility,
} from '../engine/ageGroup.js';
import { resolveSeason, todayManila } from '../services/seasons.js';

const { availabilityEvents, awards, games, leagues, playerGameLines, playerLeagues, players, rosterEntries, seasons, teams } =
  schema;

const genderSchema = z.enum(['F', 'M']);
const positionSchema = z.enum(['PG', 'SG', 'SF', 'PF', 'C']);
const statusSchema = z.enum(['available', 'injured', 'suspended']);
const idParams = z.object({ id: z.coerce.number().int().positive() });

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const playerRoutes: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------------- registry
  app.get(
    '/',
    {
      onRequest: app.requireUser,
      schema: {
        querystring: z.object({
          q: z.string().trim().max(80).optional(),
          gender: genderSchema.optional(),
          leagueId: z.coerce.number().int().optional(),
          ageGroup: z.enum(AGE_GROUPS).optional(),
          status: statusSchema.optional(),
          sort: z.enum(['name', 'recent']).default('name'),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(25),
        }),
      },
    },
    async (req) => {
      const db = app.db;
      const f = req.query;
      const season = await resolveSeason(db);

      const current = db
        .select({ playerId: rosterEntries.playerId, teamId: rosterEntries.teamId, jersey: rosterEntries.jersey })
        .from(rosterEntries)
        .where(and(eq(rosterEntries.seasonId, season.id), isNull(rosterEntries.leftOn)))
        .as('current');

      const conds: SQL[] = [];
      if (f.q) {
        const like = `%${escapeLike(f.q)}%`;
        conds.push(
          or(
            sql`(${players.firstName} || ' ' || ${players.lastName}) ilike ${like}`,
            ilike(teams.name, like),
            eq(current.jersey, f.q.replace(/^#/, '')),
          )!,
        );
      }
      if (f.gender) conds.push(eq(players.gender, f.gender));
      if (f.status) conds.push(eq(players.status, f.status));
      if (f.leagueId) {
        conds.push(
          inArray(
            players.id,
            db.select({ id: playerLeagues.playerId }).from(playerLeagues).where(eq(playerLeagues.leagueId, f.leagueId)),
          ),
        );
      }
      if (f.ageGroup) {
        const { min, max } = ageRange(f.ageGroup);
        const age = sql`(${season.year} - extract(year from ${players.birthdate})::int)`;
        if (min !== null) conds.push(sql`${age} >= ${min}`);
        if (max !== null) conds.push(sql`${age} <= ${max}`);
      }
      const where = conds.length ? and(...conds) : undefined;

      const [rows, [{ total } = { total: 0 }], [summary]] = await Promise.all([
        db
          .select({
            id: players.id,
            firstName: players.firstName,
            lastName: players.lastName,
            birthdate: players.birthdate,
            gender: players.gender,
            position: players.position,
            heightCm: players.heightCm,
            weightKg: players.weightKg,
            status: players.status,
            teamId: teams.id,
            teamName: teams.name,
            jersey: current.jersey,
          })
          .from(players)
          .leftJoin(current, eq(current.playerId, players.id))
          .leftJoin(teams, eq(teams.id, current.teamId))
          .where(where)
          .orderBy(
            ...(f.sort === 'recent'
              ? [desc(players.createdAt), desc(players.id)]
              : [asc(players.lastName), asc(players.firstName), asc(players.id)]),
          )
          .limit(f.pageSize)
          .offset((f.page - 1) * f.pageSize),
        db
          .select({ total: count() })
          .from(players)
          .leftJoin(current, eq(current.playerId, players.id))
          .leftJoin(teams, eq(teams.id, current.teamId))
          .where(where),
        db
          .select({
            registered: count(),
            women: sql<number>`count(*) filter (where ${players.gender} = 'F')`.mapWith(Number),
            men: sql<number>`count(*) filter (where ${players.gender} = 'M')`.mapWith(Number),
            available: sql<number>`count(*) filter (where ${players.status} = 'available')`.mapWith(Number),
            unavailable: sql<number>`count(*) filter (where ${players.status} <> 'available')`.mapWith(Number),
          })
          .from(players),
      ]);

      const ids = rows.map((r) => r.id);
      const leagueRows = ids.length
        ? await db
            .select({ playerId: playerLeagues.playerId, id: leagues.id, name: leagues.name })
            .from(playerLeagues)
            .innerJoin(leagues, eq(leagues.id, playerLeagues.leagueId))
            .where(inArray(playerLeagues.playerId, ids))
            .orderBy(asc(leagues.sortOrder))
        : [];

      return {
        season: { id: season.id, year: season.year },
        summary,
        total,
        page: f.page,
        pageSize: f.pageSize,
        items: rows.map(({ birthdate, teamId, teamName, ...r }) => ({
          ...r,
          age: currentAge(birthdate),
          ageGroup: ageGroup(birthdate, season.year),
          team: teamId !== null && teamName !== null ? { id: teamId, name: teamName } : null,
          leagues: leagueRows.filter((l) => l.playerId === r.id).map(({ id, name }) => ({ id, name })),
        })),
      };
    },
  );

  // ---------------------------------------------------------------- register
  app.post(
    '/',
    {
      onRequest: app.requireRole('admin', 'organizer'),
      schema: {
        body: z
          .object({
            firstName: z.string().trim().min(1).max(60),
            lastName: z.string().trim().min(1).max(60),
            birthdate: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
              .refine((d) => !Number.isNaN(Date.parse(d)) && d >= '1930-01-01' && d <= todayManila(), {
                message: 'Enter a real birthdate in the past.',
              }),
            gender: genderSchema,
            position: positionSchema,
            heightCm: z.number().int().min(100).max(250).nullish(),
            weightKg: z.number().int().min(20).max(200).nullish(),
            teamId: z.number().int().positive().nullish(),
            jersey: z
              .string()
              .trim()
              .regex(/^(0|00|[1-9]\d?)$/, 'Jersey numbers are 0, 00 or 1–99.')
              .nullish(),
            leagueIds: z.array(z.number().int().positive()).max(20).default([]),
          })
          .refine((b) => !b.teamId || !!b.jersey, { message: 'Add a jersey number for the team.', path: ['jersey'] }),
      },
    },
    async (req, reply) => {
      const db = app.db;
      const b = req.body;
      const season = await resolveSeason(db);

      const [dup] = await db
        .select({ id: players.id })
        .from(players)
        .where(
          and(
            eq(sql`lower(${players.firstName})`, b.firstName.toLowerCase()),
            eq(sql`lower(${players.lastName})`, b.lastName.toLowerCase()),
            eq(players.birthdate, b.birthdate),
          ),
        );
      if (dup) {
        throw new HttpError(409, 'A player with this name and birthdate is already registered.', { duplicateId: dup.id });
      }

      let team: { id: number; name: string; leagueId: number } | undefined;
      if (b.teamId) {
        const [row] = await db
          .select({ id: teams.id, name: teams.name, leagueId: teams.leagueId, league: leagues })
          .from(teams)
          .innerJoin(leagues, eq(leagues.id, teams.leagueId))
          .where(eq(teams.id, b.teamId));
        if (!row) throw new HttpError(422, 'That team does not exist.');
        const reason = leagueIneligibility(b, row.league, season.year);
        if (reason) throw new HttpError(422, `Not eligible for ${row.league.name}: ${reason}`);
        const [taken] = await db
          .select({ firstName: players.firstName, lastName: players.lastName })
          .from(rosterEntries)
          .innerJoin(players, eq(players.id, rosterEntries.playerId))
          .where(
            and(
              eq(rosterEntries.teamId, row.id),
              eq(rosterEntries.seasonId, season.id),
              eq(rosterEntries.jersey, b.jersey!),
              isNull(rosterEntries.leftOn),
            ),
          );
        if (taken) {
          throw new HttpError(409, `#${b.jersey} is already worn by ${taken.firstName} ${taken.lastName} on ${row.name}.`);
        }
        team = row;
      }

      const id = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(players)
          .values({
            firstName: b.firstName,
            lastName: b.lastName,
            birthdate: b.birthdate,
            gender: b.gender,
            position: b.position,
            heightCm: b.heightCm ?? null,
            weightKg: b.weightKg ?? null,
          })
          .returning({ id: players.id });
        const playerId = created!.id;
        if (team) {
          await tx.insert(rosterEntries).values({
            playerId,
            teamId: team.id,
            seasonId: season.id,
            jersey: b.jersey!,
            joinedOn: todayManila(),
          });
        }
        const leagueIds = [...new Set([...b.leagueIds, ...(team ? [team.leagueId] : [])])];
        if (leagueIds.length) {
          await tx.insert(playerLeagues).values(leagueIds.map((leagueId) => ({ playerId, leagueId })));
        }
        return playerId;
      });

      return reply.code(201).send({ id });
    },
  );

  // ---------------------------------------------------------------- profile
  app.get('/:id', { onRequest: app.requireUser, schema: { params: idParams } }, async (req) => {
    const db = app.db;
    const id = req.params.id;
    const [player] = await db.select().from(players).where(eq(players.id, id));
    if (!player) throw new HttpError(404, 'Player not found.');
    const season = await resolveSeason(db);

    const homeTeam = alias(teams, 'home_team');
    const awayTeam = alias(teams, 'away_team');

    const [roster, leagueRows, awardRows, availability, seasonRows, recent] = await Promise.all([
      db
        .select({
          seasonYear: seasons.year,
          seasonId: seasons.id,
          jersey: rosterEntries.jersey,
          leftOn: rosterEntries.leftOn,
          teamId: teams.id,
          teamName: teams.name,
          leagueId: leagues.id,
          leagueName: leagues.name,
        })
        .from(rosterEntries)
        .innerJoin(teams, eq(teams.id, rosterEntries.teamId))
        .innerJoin(leagues, eq(leagues.id, teams.leagueId))
        .innerJoin(seasons, eq(seasons.id, rosterEntries.seasonId))
        .where(eq(rosterEntries.playerId, id))
        .orderBy(desc(seasons.year)),
      db
        .select({ id: leagues.id, name: leagues.name })
        .from(playerLeagues)
        .innerJoin(leagues, eq(leagues.id, playerLeagues.leagueId))
        .where(eq(playerLeagues.playerId, id))
        .orderBy(asc(leagues.sortOrder)),
      db
        .select({ id: awards.id, year: awards.year, title: awards.title, leagueName: leagues.name })
        .from(awards)
        .leftJoin(leagues, eq(leagues.id, awards.leagueId))
        .where(eq(awards.playerId, id))
        .orderBy(desc(awards.year), desc(awards.id)),
      db
        .select()
        .from(availabilityEvents)
        .where(eq(availabilityEvents.playerId, id))
        .orderBy(desc(availabilityEvents.startedOn)),
      db
        .select({
          seasonId: playerGameLines.seasonId,
          year: seasons.year,
          leagueId: playerGameLines.leagueId,
          leagueName: leagues.name,
          teamId: playerGameLines.teamId,
          teamName: teams.name,
          gp: count(),
          seconds: sum(playerGameLines.seconds).mapWith(Number),
          pts: sum(playerGameLines.pts).mapWith(Number),
          reb: sql<number>`sum(${playerGameLines.oreb} + ${playerGameLines.dreb})`.mapWith(Number),
          ast: sum(playerGameLines.ast).mapWith(Number),
          stl: sum(playerGameLines.stl).mapWith(Number),
          blk: sum(playerGameLines.blk).mapWith(Number),
          pir: sum(playerGameLines.pir).mapWith(Number),
          fgm: sql<number>`sum(${playerGameLines.fg2m} + ${playerGameLines.fg3m})`.mapWith(Number),
          fga: sql<number>`sum(${playerGameLines.fg2a} + ${playerGameLines.fg3a})`.mapWith(Number),
          fg3m: sum(playerGameLines.fg3m).mapWith(Number),
          fg3a: sum(playerGameLines.fg3a).mapWith(Number),
          ftm: sum(playerGameLines.ftm).mapWith(Number),
          fta: sum(playerGameLines.fta).mapWith(Number),
        })
        .from(playerGameLines)
        .innerJoin(seasons, eq(seasons.id, playerGameLines.seasonId))
        .innerJoin(leagues, eq(leagues.id, playerGameLines.leagueId))
        .innerJoin(teams, eq(teams.id, playerGameLines.teamId))
        .where(eq(playerGameLines.playerId, id))
        .groupBy(
          playerGameLines.seasonId,
          seasons.year,
          playerGameLines.leagueId,
          leagues.name,
          leagues.sortOrder,
          playerGameLines.teamId,
          teams.name,
        )
        .orderBy(desc(seasons.year), asc(leagues.sortOrder)),
      db
        .select({
          gameId: games.id,
          scheduledAt: games.scheduledAt,
          teamId: playerGameLines.teamId,
          homeTeamId: games.homeTeamId,
          homeName: homeTeam.name,
          awayName: awayTeam.name,
          homeScore: games.homeScore,
          awayScore: games.awayScore,
          seconds: playerGameLines.seconds,
          pts: playerGameLines.pts,
          reb: sql<number>`${playerGameLines.oreb} + ${playerGameLines.dreb}`.mapWith(Number),
          ast: playerGameLines.ast,
          pir: playerGameLines.pir,
          plusMinus: playerGameLines.plusMinus,
        })
        .from(playerGameLines)
        .innerJoin(games, eq(games.id, playerGameLines.gameId))
        .innerJoin(homeTeam, eq(homeTeam.id, games.homeTeamId))
        .innerJoin(awayTeam, eq(awayTeam.id, games.awayTeamId))
        .where(eq(playerGameLines.playerId, id))
        .orderBy(desc(games.scheduledAt))
        .limit(5),
    ]);

    const current = roster.find((r) => r.seasonId === season.id && r.leftOn === null) ?? null;
    const thisSeason = seasonRows.filter((r) => r.seasonId === season.id).sort((a, b) => b.gp - a.gp)[0] ?? null;
    const career = seasonRows.reduce(
      (acc, r) => {
        for (const k of ['gp', 'seconds', 'pts', 'reb', 'ast', 'stl', 'blk', 'pir'] as const) acc[k] += r[k];
        return acc;
      },
      { gp: 0, seconds: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, pir: 0 },
    );

    return {
      id: player.id,
      firstName: player.firstName,
      lastName: player.lastName,
      birthdate: player.birthdate,
      /** Bumps when a new photo is uploaded, so the image URL changes and caches refresh. */
      photoVersion: player.photoType && player.photoUpdatedAt ? player.photoUpdatedAt.getTime() : null,
      birthCert: player.birthCertType && player.birthCertUploadedAt ? { type: player.birthCertType, uploadedAt: player.birthCertUploadedAt } : null,
      gender: player.gender,
      position: player.position,
      secondaryPosition: player.secondaryPosition,
      heightCm: player.heightCm,
      weightKg: player.weightKg,
      dominantHand: player.dominantHand,
      status: player.status,
      birthCertVerifiedOn: player.birthCertVerifiedOn,
      age: currentAge(player.birthdate),
      season: { id: season.id, year: season.year },
      ageInSeason: ageInSeason(player.birthdate, season.year),
      ageGroup: ageGroup(player.birthdate, season.year),
      eligibility: eligibility(player.birthdate, season.year),
      current: current && {
        teamId: current.teamId,
        teamName: current.teamName,
        leagueId: current.leagueId,
        leagueName: current.leagueName,
        jersey: current.jersey,
      },
      leagues: leagueRows,
      awards: awardRows,
      availability,
      thisSeason,
      seasons: seasonRows,
      career: { ...career, leagues: new Set(seasonRows.map((r) => r.leagueId)).size, teams: new Set(seasonRows.map((r) => r.teamId)).size },
      recentGames: recent.map((g) => {
        const isHome = g.teamId === g.homeTeamId;
        const own = isHome ? g.homeScore : g.awayScore;
        const opp = isHome ? g.awayScore : g.homeScore;
        return {
          gameId: g.gameId,
          scheduledAt: g.scheduledAt,
          opponent: isHome ? g.awayName : g.homeName,
          home: isHome,
          result: own === null || opp === null ? null : `${own > opp ? 'W' : 'L'} ${own}–${opp}`,
          seconds: g.seconds,
          pts: g.pts,
          reb: g.reb,
          ast: g.ast,
          pir: g.pir,
          plusMinus: g.plusMinus,
        };
      }),
    };
  });

  // ---------------------------------------------------------------- availability
  app.post(
    '/:id/status',
    {
      onRequest: app.requireRole('admin', 'organizer'),
      schema: {
        params: idParams,
        body: z
          .object({
            status: statusSchema,
            title: z.string().trim().max(120).optional(),
            detail: z.string().trim().max(500).optional(),
          })
          .refine((b) => b.status === 'available' || !!b.title, {
            message: 'Say what the injury or suspension is.',
            path: ['title'],
          }),
      },
    },
    async (req) => {
      const db = app.db;
      const { id } = req.params;
      const { status, title, detail } = req.body;
      const [player] = await db.select({ id: players.id }).from(players).where(eq(players.id, id));
      if (!player) throw new HttpError(404, 'Player not found.');
      const today = todayManila();

      await db.transaction(async (tx) => {
        // Any change closes what was open; a new injury or suspension then opens its own entry.
        await tx
          .update(availabilityEvents)
          .set({ endedOn: today })
          .where(and(eq(availabilityEvents.playerId, id), isNull(availabilityEvents.endedOn)));
        if (status !== 'available') {
          await tx.insert(availabilityEvents).values({
            playerId: id,
            kind: status === 'injured' ? 'injury' : 'suspension',
            title: title!,
            detail: detail || null,
            startedOn: today,
          });
        }
        await tx.update(players).set({ status }).where(eq(players.id, id));
      });
      return { ok: true };
    },
  );
};
