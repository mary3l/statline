/** Response shapes of the STATLINE API (backend/src/routes). */

export type Gender = 'F' | 'M';
export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
export type PlayerStatus = 'available' | 'injured' | 'suspended';
export type Role = 'admin' | 'organizer' | 'scorer';
export type Side = 'home' | 'away';
export type GameStatus = 'scheduled' | 'live' | 'final' | 'forfeit';
export type AgeGroup = 'U12' | 'U14' | 'U16' | 'U18' | 'Open' | 'Masters 35+';

export interface SessionUser {
  sub: string;
  email: string;
  name: string;
  role: Role;
}

export interface Season {
  id: number;
  year: number;
  name: string;
  isCurrent: boolean;
}

export interface League {
  id: number;
  slug: string;
  name: string;
  level: string;
  gender: Gender | null;
  minAge: number | null;
  maxAge: number | null;
  sortOrder: number;
  seasonsWithGames: number[];
}

export interface Team {
  id: number;
  leagueId: number;
  name: string;
  shortName: string;
  color: string;
}

export interface Meta {
  currentSeasonId: number;
  seasons: Season[];
  leagues: League[];
  teams: Team[];
  positions: Position[];
  statuses: PlayerStatus[];
  ageGroups: AgeGroup[];
}

export interface PlayerListItem {
  id: number;
  firstName: string;
  lastName: string;
  gender: Gender;
  position: Position;
  heightCm: number | null;
  weightKg: number | null;
  status: PlayerStatus;
  jersey: string | null;
  age: number;
  ageGroup: AgeGroup;
  team: { id: number; name: string } | null;
  leagues: { id: number; name: string }[];
}

export interface PlayerList {
  season: { id: number; year: number };
  summary: { registered: number; women: number; men: number; available: number; unavailable: number };
  total: number;
  page: number;
  pageSize: number;
  items: PlayerListItem[];
}

export interface SeasonStatsRow {
  seasonId: number;
  year: number;
  leagueId: number;
  leagueName: string;
  teamId: number;
  teamName: string;
  gp: number;
  seconds: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  pir: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
}

export interface PlayerProfile {
  id: number;
  firstName: string;
  lastName: string;
  birthdate: string;
  gender: Gender;
  position: Position;
  secondaryPosition: Position | null;
  heightCm: number | null;
  weightKg: number | null;
  dominantHand: string | null;
  status: PlayerStatus;
  birthCertVerifiedOn: string | null;
  /** Set when there is a photo; changes with each upload (cache-busting). */
  photoVersion: number | null;
  birthCert: { type: string; uploadedAt: string } | null;
  age: number;
  season: { id: number; year: number };
  ageInSeason: number;
  ageGroup: AgeGroup;
  eligibility: { group: AgeGroup; rule: string; eligible: boolean }[];
  current: { teamId: number; teamName: string; leagueId: number; leagueName: string; jersey: string } | null;
  leagues: { id: number; name: string }[];
  awards: { id: number; year: number; title: string; leagueName: string | null }[];
  availability: {
    id: number;
    kind: 'injury' | 'suspension';
    title: string;
    detail: string | null;
    startedOn: string;
    endedOn: string | null;
  }[];
  thisSeason: SeasonStatsRow | null;
  seasons: SeasonStatsRow[];
  career: { gp: number; seconds: number; pts: number; reb: number; ast: number; stl: number; blk: number; pir: number; leagues: number; teams: number };
  recentGames: {
    gameId: number;
    scheduledAt: string;
    opponent: string;
    home: boolean;
    result: string | null;
    seconds: number;
    pts: number;
    reb: number;
    ast: number;
    pir: number;
    plusMinus: number;
  }[];
}

export interface GameTeam {
  id: number;
  name: string;
  shortName: string;
  score: number | null;
}

export interface Game {
  id: number;
  seasonId: number;
  gameNumber: number;
  scheduledAt: string;
  venue: string | null;
  status: GameStatus;
  forfeitedBy: Side | null;
  periods: number | null;
  league: { id: number; name: string };
  home: GameTeam;
  away: GameTeam;
}

export interface CountingStats {
  seconds: number;
  pts: number;
  fg2m: number;
  fg2a: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  fd: number;
  fgm: number;
  fga: number;
  reb: number;
  pir: number;
}

export interface BoxPlayer extends CountingStats {
  playerId: number;
  side: Side;
  starter: boolean;
  plusMinus: number;
  fouledOut: boolean;
  jersey: string;
  name: string;
  lastName: string;
  position: Position | null;
}

export interface TeamTotals extends CountingStats {
  teamOreb: number;
  teamDreb: number;
}

export interface Shot {
  eventId: string;
  playerId: number | null;
  side: Side;
  period: number;
  clock: number;
  pts: 2 | 3;
  made: boolean;
  x: number | null;
  y: number | null;
  zone: 'paint' | 'mid' | 'three' | null;
}

export interface BoxScoreResponse {
  game: Game;
  box: {
    periods: number;
    score: Record<Side, number>;
    lineScore: Record<Side, number[]>;
    totals: Record<Side, TeamTotals>;
    players: BoxPlayer[];
    shots: Shot[];
  } | null;
}

export interface StandingsResponse {
  season: { id: number; year: number };
  league: { id: number; name: string };
  rows: {
    rank: number;
    teamId: number;
    gp: number;
    w: number;
    l: number;
    forfeits: number;
    pf: number;
    pa: number;
    diff: number;
    pts: number;
    team: { id: number; name: string; shortName: string };
  }[];
}

export interface LeadersResponse {
  season: { id: number; year: number };
  qualifiedPlayers: number;
  boards: {
    key: 'pts' | 'reb' | 'ast' | 'pir';
    title: string;
    leaders: { rank: number; playerId: number; name: string; teamName: string; gp: number; value: number }[];
  }[];
}

export interface RecorderPlayer {
  playerId: number;
  side: Side;
  jersey: string;
  firstName: string;
  lastName: string;
  position: Position;
  status: PlayerStatus;
  /** On the game's lineup (game_participants). Others are the rest of the team's current roster. */
  dressed: boolean;
  starter: boolean;
}

export interface RecorderData {
  game: Game;
  roster: Record<Side, RecorderPlayer[]>;
  events: import('@engine/types').GameEvent[];
  /** Next free event seq (deleted plays keep theirs). */
  nextSeq: number;
}

export interface LineupUnitRow {
  players: { playerId: number; jersey: string; firstName: string; lastName: string }[];
  games: number;
  seconds: number;
  ptsFor: number;
  ptsAgainst: number;
  plusMinus: number;
}

export interface LineupsResponse {
  team: { id: number; name: string; shortName: string; leagueId: number };
  season: { id: number; year: number };
  games: number;
  units: LineupUnitRow[];
}

export type MatchupKey = 'pts' | 'fgm' | 'fga' | 'fg3m' | 'fg3a' | 'ftm' | 'fta' | 'reb' | 'oreb' | 'dreb' | 'ast' | 'stl' | 'blk' | 'tov' | 'pf' | 'pir';

export interface MatchupResponse {
  season: { id: number; year: number };
  a: { id: number; name: string; shortName: string; leagueId: number };
  b: { id: number; name: string; shortName: string; leagueId: number };
  wins: { a: number; b: number };
  /** Meetings with a box score (forfeits count in `wins` only). */
  played: number;
  totals: { a: Record<MatchupKey, number>; b: Record<MatchupKey, number> };
  games: { id: number; scheduledAt: string; status: GameStatus; aScore: number; bScore: number; aHome: boolean }[];
}
