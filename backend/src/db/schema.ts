import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['admin', 'organizer', 'scorer']);
export const genderEnum = pgEnum('gender', ['F', 'M']);
export const positionEnum = pgEnum('position', ['PG', 'SG', 'SF', 'PF', 'C']);
export const playerStatusEnum = pgEnum('player_status', ['available', 'injured', 'suspended']);
export const availabilityKindEnum = pgEnum('availability_kind', ['injury', 'suspension']);
export const gameStatusEnum = pgEnum('game_status', ['scheduled', 'live', 'final', 'forfeit']);
export const sideEnum = pgEnum('side', ['home', 'away']);

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text().notNull(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const seasons = pgTable('seasons', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  year: integer().notNull().unique(),
  name: text().notNull(),
  isCurrent: boolean('is_current').notNull().default(false),
});

/** Eligibility rules live on the league: gender, and the age reached in the season year. */
export const leagues = pgTable('leagues', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  level: text().notNull(),
  gender: genderEnum(),
  minAge: integer('min_age'),
  maxAge: integer('max_age'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const teams = pgTable(
  'teams',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    leagueId: integer('league_id')
      .notNull()
      .references(() => leagues.id),
    name: text().notNull(),
    shortName: text('short_name').notNull(),
    color: text().notNull(),
  },
  (t) => [uniqueIndex('teams_league_name_uq').on(t.leagueId, t.name)],
);

export const players = pgTable(
  'players',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    birthdate: date({ mode: 'string' }).notNull(),
    gender: genderEnum().notNull(),
    position: positionEnum().notNull(),
    secondaryPosition: positionEnum('secondary_position'),
    heightCm: integer('height_cm'),
    weightKg: integer('weight_kg'),
    dominantHand: text('dominant_hand'),
    status: playerStatusEnum().notNull().default('available'),
    birthCertVerifiedOn: date('birth_cert_verified_on', { mode: 'string' }),
    /** Uploaded files live in UPLOAD_DIR; these columns say whether there is one and of what type. */
    photoType: text('photo_type'),
    photoUpdatedAt: timestamp('photo_updated_at', { withTimezone: true }),
    birthCertType: text('birth_cert_type'),
    birthCertUploadedAt: timestamp('birth_cert_uploaded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('players_name_idx').on(t.lastName, t.firstName)],
);

/** Leagues a player has played in, past or present (the registry's "Leagues played"). */
export const playerLeagues = pgTable(
  'player_leagues',
  {
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    leagueId: integer('league_id')
      .notNull()
      .references(() => leagues.id),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.leagueId] })],
);

/** A player on a team for a season, with the jersey worn there. left_on null = still on the team. */
export const rosterEntries = pgTable(
  'roster_entries',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id),
    jersey: text().notNull(),
    joinedOn: date('joined_on', { mode: 'string' }),
    leftOn: date('left_on', { mode: 'string' }),
  },
  (t) => [
    uniqueIndex('roster_active_jersey_uq')
      .on(t.teamId, t.seasonId, t.jersey)
      .where(sql`${t.leftOn} is null`),
    uniqueIndex('roster_active_player_uq')
      .on(t.playerId, t.seasonId)
      .where(sql`${t.leftOn} is null`),
  ],
);

export const availabilityEvents = pgTable(
  'availability_events',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    kind: availabilityKindEnum().notNull(),
    title: text().notNull(),
    detail: text(),
    startedOn: date('started_on', { mode: 'string' }).notNull(),
    endedOn: date('ended_on', { mode: 'string' }),
  },
  (t) => [index('availability_player_idx').on(t.playerId)],
);

export const awards = pgTable(
  'awards',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    year: integer().notNull(),
    title: text().notNull(),
    leagueId: integer('league_id').references(() => leagues.id),
  },
  (t) => [index('awards_player_idx').on(t.playerId)],
);

export const games = pgTable(
  'games',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id),
    leagueId: integer('league_id')
      .notNull()
      .references(() => leagues.id),
    gameNumber: integer('game_number').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    venue: text(),
    homeTeamId: integer('home_team_id')
      .notNull()
      .references(() => teams.id),
    awayTeamId: integer('away_team_id')
      .notNull()
      .references(() => teams.id),
    status: gameStatusEnum().notNull().default('scheduled'),
    /** Set when status = forfeit: the side that forfeited (scored 0–20, earns 0 standing points). */
    forfeitedBy: sideEnum('forfeited_by'),
    /** Cached from the events when a game is recomputed; never edited by hand. */
    homeScore: integer('home_score'),
    awayScore: integer('away_score'),
    periods: integer(),
  },
  (t) => [
    uniqueIndex('games_number_uq').on(t.leagueId, t.seasonId, t.gameNumber),
    index('games_season_league_idx').on(t.seasonId, t.leagueId),
  ],
);

/** Who dressed for a game, with the jersey worn and whether they started (needed for minutes and +/-). */
export const gameParticipants = pgTable(
  'game_participants',
  {
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    side: sideEnum().notNull(),
    jersey: text().notNull(),
    starter: boolean().notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.playerId] })],
);

/**
 * One row per play. The event list is the only source of truth for a game;
 * scores, box scores, leaders and standings are all derived from it.
 * `details` holds the type-specific fields (see engine/types.ts).
 */
export const events = pgTable(
  'events',
  {
    id: uuid().primaryKey(),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    seq: integer().notNull(),
    period: integer().notNull(),
    /** Seconds left on the game clock when the play happened. */
    clock: integer().notNull(),
    type: text().notNull(),
    side: sideEnum(),
    playerId: integer('player_id').references(() => players.id),
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('events_game_seq_uq').on(t.gameId, t.seq)],
);

/** Saved per-player result of the engine for a game, rebuilt whenever that game is recomputed. */
export const playerGameLines = pgTable(
  'player_game_lines',
  {
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id),
    leagueId: integer('league_id')
      .notNull()
      .references(() => leagues.id),
    starter: boolean().notNull(),
    seconds: integer().notNull(),
    pts: integer().notNull(),
    fg2m: integer().notNull(),
    fg2a: integer().notNull(),
    fg3m: integer().notNull(),
    fg3a: integer().notNull(),
    ftm: integer().notNull(),
    fta: integer().notNull(),
    oreb: integer().notNull(),
    dreb: integer().notNull(),
    ast: integer().notNull(),
    stl: integer().notNull(),
    blk: integer().notNull(),
    tov: integer().notNull(),
    pf: integer().notNull(),
    fd: integer().notNull(),
    pir: integer().notNull(),
    plusMinus: integer('plus_minus').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.playerId] }),
    index('pgl_season_league_idx').on(t.seasonId, t.leagueId),
    index('pgl_player_idx').on(t.playerId),
  ],
);
