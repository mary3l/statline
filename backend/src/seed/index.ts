/**
 * Loads the demo data: leagues, teams, players, schedules, and full event lists for every finished game.
 *   npm run db:seed    seed an empty database
 *   npm run db:reset   wipe everything, then seed
 * Stop the API first when using the embedded database (PGlite allows one process at a time).
 */
import { count, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { getConnection, schema, type DB } from '../db/index.js';
import { toRow, type Side } from '../engine/types.js';
import { recomputeGame } from '../services/games.js';
import { todayManila } from '../services/seasons.js';
import { upsertAccounts } from './accounts.js';
import { AVAILABILITY, AWARDS, FIRST_NAMES, LAST_NAMES, LEAGUES, ROSTER_POSITIONS, TEAMS, type TeamSeed } from './data.js';
import { Rng } from './rng.js';
import { simulateGame, type SimPlayer } from './simulate.js';

type Position = SimPlayer['position'];

interface SeededPlayer {
  id: number;
  name: string;
  position: Position;
  jersey: string;
  skill: number;
  missesLast: number;
}

const HEIGHT: Record<Position, [number, number]> = {
  PG: [168, 180],
  SG: [172, 184],
  SF: [178, 189],
  PF: [183, 195],
  C: [188, 203],
};

const reset = process.argv.includes('--reset');

const conn = await getConnection();
const db = conn.db;

if (reset) {
  console.log('Wiping the database…');
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
}
await conn.migrate();

const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(schema.seasons);
if (n > 0) {
  console.error('The database already has data. Run `npm run db:reset` to wipe it and seed again.');
  await conn.close();
  process.exit(1);
}

if (!config.SEED_ADMIN_EMAIL || !config.SEED_ADMIN_PASSWORD) {
  console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env first (see .env.example).');
  await conn.close();
  process.exit(1);
}

const rng = new Rng(20261013);
const today = todayManila();
const started = Date.now();

await seed(db);

console.log(`Seeded in ${((Date.now() - started) / 1000).toFixed(1)} s using ${conn.label}.`);
console.log('Passwords for these accounts are in backend/.env (SEED_ADMIN_PASSWORD, SEED_DEMO_PASSWORD).');
await conn.close();

async function seed(db: DB) {
  for (const a of await upsertAccounts(db)) console.log(`  account: ${a.role} ${a.email}`);

  const [s2025, s2026] = await db
    .insert(schema.seasons)
    .values([
      { year: 2025, name: '2025 season', isCurrent: false },
      { year: 2026, name: '2026 season', isCurrent: true },
    ])
    .returning();

  const leagueRows = await db
    .insert(schema.leagues)
    .values(LEAGUES.map((l, i) => ({ ...l, sortOrder: i })))
    .returning();
  const leagueId = (slug: string) => leagueRows.find((l) => l.slug === slug)!.id;

  const usedNames = new Set(TEAMS.flatMap((t) => t.named.map((p) => `${p.first} ${p.last}`)));
  const rosters = new Map<number, SeededPlayer[]>();
  const teamIds = new Map<string, number>();
  const playerIdByName = new Map<string, number>();

  for (const t of TEAMS) {
    const [team] = await db
      .insert(schema.teams)
      .values({ leagueId: leagueId(t.league), name: t.name, shortName: t.shortName, color: t.color })
      .returning();
    teamIds.set(t.name, team!.id);
    rosters.set(team!.id, await seedRoster(db, t, team!.id, s2026!.id, t.in2025 ? s2025!.id : null, leagueId, usedNames, playerIdByName));
  }

  for (const a of AWARDS) {
    await db.insert(schema.awards).values({ playerId: playerIdByName.get(a.player)!, year: a.year, title: a.title, leagueId: leagueId(a.league) });
  }
  for (const a of AVAILABILITY) {
    await db.insert(schema.availabilityEvents).values({
      playerId: playerIdByName.get(a.player)!,
      kind: a.kind,
      title: a.title,
      detail: a.detail,
      startedOn: a.startedOn,
      endedOn: a.endedOn,
    });
  }

  const teamsOf = (league: string) => TEAMS.filter((t) => t.league === league && t.schedule).map((t) => teamIds.get(t.name)!);

  const cityOpen = { leagueId: leagueId('city-open'), teams: teamsOf('city-open'), venue: 'Covered Court' };
  await seedSchedule(db, { ...cityOpen, seasonId: s2025!.id, legs: 1, firstDay: '2025-08-16', current: false }, rosters);
  await seedSchedule(db, { ...cityOpen, seasonId: s2026!.id, legs: 2, firstDay: '2026-08-15', current: true }, rosters);
  await seedSchedule(
    db,
    { seasonId: s2026!.id, leagueId: leagueId('womens'), teams: teamsOf('womens'), legs: 2, firstDay: '2026-08-30', venue: 'Gym', current: true },
    rosters,
  );
  await seedSchedule(
    db,
    {
      seasonId: s2026!.id,
      leagueId: leagueId('youth-u18'),
      teams: teamsOf('youth-u18'),
      legs: 2,
      firstDay: '2026-09-06',
      venue: 'Sports Complex',
      current: true,
      forfeitRound: 2,
    },
    rosters,
  );
}

async function seedRoster(
  db: DB,
  t: TeamSeed,
  teamId: number,
  seasonId: number,
  pastSeasonId: number | null,
  leagueId: (slug: string) => number,
  usedNames: Set<string>,
  playerIdByName: Map<string, number>,
): Promise<SeededPlayer[]> {
  const size = Math.max(8, t.named.length);
  const usedJerseys = new Set(t.named.map((p) => p.jersey));
  const youth = t.league === 'youth-u18';
  const out: SeededPlayer[] = [];

  for (let i = 0; i < size; i++) {
    const named = t.named[i];
    const position: Position = named?.position ?? ROSTER_POSITIONS[i] ?? 'SF';
    let first = named?.first;
    let last = named?.last;
    while (!first || !last || (!named && usedNames.has(`${first} ${last}`))) {
      first = rng.pick(FIRST_NAMES[t.gender]);
      last = rng.pick(LAST_NAMES);
    }
    usedNames.add(`${first} ${last}`);

    let jersey = named?.jersey;
    while (!jersey || (!named && usedJerseys.has(jersey))) jersey = String(rng.int(0, 55));
    usedJerseys.add(jersey);

    const birthdate =
      named?.birthdate ??
      `${rng.int(t.born[0], t.born[1])}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`;
    const shrink = (t.gender === 'F' ? 12 : 0) + (youth ? 8 : 0);
    const [hMin, hMax] = HEIGHT[position];
    const heightCm = named?.heightCm ?? rng.int(hMin - shrink, hMax - shrink);
    const weightKg = named?.weightKg ?? Math.round(heightCm - 105 + rng.range(-8, 8) - (youth ? 8 : 0));
    const skill = named?.skill ?? (i < 5 ? rng.range(0.98, 1.12) : rng.range(0.8, 0.95));
    const year = Number(birthdate.slice(0, 4));

    const [p] = await db
      .insert(schema.players)
      .values({
        firstName: first,
        lastName: last,
        birthdate,
        gender: t.gender,
        position,
        secondaryPosition: named?.first === 'Joaquin' ? 'SG' : null,
        heightCm,
        weightKg,
        dominantHand: rng.chance(0.88) ? 'Right' : 'Left',
        status: named?.status ?? 'available',
        birthCertVerifiedOn:
          named?.first === 'Joaquin'
            ? '2023-01-10'
            : rng.chance(0.75)
              ? `${rng.int(2023, 2026)}-0${rng.int(1, 9)}-${String(rng.int(1, 28)).padStart(2, '0')}`
              : null,
      })
      .returning({ id: schema.players.id });
    const id = p!.id;
    playerIdByName.set(`${first} ${last}`, id);

    const rosterRows = [{ playerId: id, teamId, seasonId, jersey, joinedOn: null as string | null }];
    if (pastSeasonId) rosterRows.push({ playerId: id, teamId, seasonId: pastSeasonId, jersey, joinedOn: null });
    await db.insert(schema.rosterEntries).values(rosterRows);

    const leagues = new Set([t.league, ...(named?.alsoPlays ?? [])]);
    if (!named && t.league === 'city-open') {
      if (2026 - year <= 23 && rng.chance(0.4)) leagues.add('collegiate');
      if (rng.chance(0.3)) leagues.add('inter-barangay');
    }
    if (2026 - year >= 35) leagues.add('masters');
    await db.insert(schema.playerLeagues).values([...leagues].map((slug) => ({ playerId: id, leagueId: leagueId(slug) })));

    out.push({ id, name: `${first} ${last}`, position, jersey, skill, missesLast: named?.missesLast ?? 0 });
  }
  return out;
}

/** Circle-method round robin: each round pairs every team once. */
function roundRobin(teams: number[]): [number, number][][] {
  const list = [...teams];
  if (list.length % 2) list.push(-1);
  const rounds: [number, number][][] = [];
  for (let r = 0; r < list.length - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < list.length / 2; i++) {
      const a = list[i]!;
      const b = list[list.length - 1 - i]!;
      if (a !== -1 && b !== -1) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()!);
  }
  return rounds;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function seedSchedule(
  db: DB,
  opts: {
    seasonId: number;
    leagueId: number;
    teams: number[];
    legs: 1 | 2;
    firstDay: string;
    venue: string;
    /** Current season: players who are out now also missed the team's last few games. */
    current: boolean;
    forfeitRound?: number;
  },
  rosters: Map<number, SeededPlayer[]>,
) {
  const teamRows = await db.select().from(schema.teams);
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]));

  const firstLeg = roundRobin(opts.teams);
  const rounds = opts.legs === 2 ? [...firstLeg, ...firstLeg.map((r) => r.map(([h, a]) => [a, h] as [number, number]))] : firstLeg;
  const finishedRounds = rounds.filter((_, i) => addDays(opts.firstDay, i * 7) < today).length;

  let gameNumber = 0;
  for (const [ri, round] of rounds.entries()) {
    const day = addDays(opts.firstDay, ri * 7);
    const finished = day < today;
    for (const [gi, [home, away]] of round.entries()) {
      gameNumber++;
      const scheduledAt = new Date(`${day}T${String(14 + gi * 2).padStart(2, '0')}:00:00+08:00`);
      const forfeit = finished && opts.forfeitRound === ri && gi === 0;
      const [game] = await db
        .insert(schema.games)
        .values({
          seasonId: opts.seasonId,
          leagueId: opts.leagueId,
          gameNumber,
          scheduledAt,
          venue: `${teamName.get(home)!.split(' ')[0]} ${opts.venue}`,
          homeTeamId: home,
          awayTeamId: away,
          status: forfeit ? 'forfeit' : finished ? 'final' : 'scheduled',
          forfeitedBy: forfeit ? 'away' : null,
          homeScore: forfeit ? 20 : null,
          awayScore: forfeit ? 0 : null,
        })
        .returning({ id: schema.games.id });
      if (!finished || forfeit) continue;

      const dressed = (teamId: number) =>
        rosters.get(teamId)!.filter((p) => !opts.current || ri < finishedRounds - p.missesLast);
      const sides: Record<Side, SeededPlayer[]> = { home: dressed(home), away: dressed(away) };

      await db.insert(schema.gameParticipants).values(
        (['home', 'away'] as const).flatMap((side) =>
          sides[side].map((p, i) => ({ gameId: game!.id, playerId: p.id, side, jersey: p.jersey, starter: i < 5 })),
        ),
      );

      const toSim = (list: SeededPlayer[]) => ({
        players: list.map((p) => ({ playerId: p.id, position: p.position, skill: p.skill })),
      });
      const evts = simulateGame(rng, { home: toSim(sides.home), away: toSim(sides.away) });
      const rows = evts.map((e) => ({ ...toRow(e), gameId: game!.id }));
      for (let i = 0; i < rows.length; i += 500) {
        await db.insert(schema.events).values(rows.slice(i, i + 500));
      }
      await recomputeGame(db, game!.id);
    }
  }
  console.log(`  ${opts.legs === 2 ? 'double' : 'single'} round robin, ${gameNumber} games, league ${opts.leagueId}, season ${opts.seasonId}`);
}
