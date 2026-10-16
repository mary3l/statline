import { FIBA, gameTime } from './fiba.js';
import { shotZone, type Zone } from './court.js';
import type { GameEvent, Side } from './types.js';

export interface RosterPlayer {
  playerId: number;
  side: Side;
  starter: boolean;
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
}

export interface Derived {
  fgm: number;
  fga: number;
  reb: number;
  pir: number;
}

export interface PlayerLine extends CountingStats, Derived {
  playerId: number;
  side: Side;
  starter: boolean;
  plusMinus: number;
  fouledOut: boolean;
}

export interface TeamTotals extends CountingStats, Derived {
  /** Team rebounds (num: null in the event list) are in reb/oreb/dreb but not in any player's line. */
  teamOreb: number;
  teamDreb: number;
}

export interface ShotRecord {
  eventId: string;
  playerId: number | null;
  side: Side;
  period: number;
  clock: number;
  pts: 2 | 3;
  made: boolean;
  x: number | null;
  y: number | null;
  zone: Zone | null;
}

export interface BoxScore {
  periods: number;
  score: Record<Side, number>;
  /** Points per period, index 0 = Q1. */
  lineScore: Record<Side, number[]>;
  players: PlayerLine[];
  totals: Record<Side, TeamTotals>;
  shots: ShotRecord[];
}

const COUNTING_KEYS = [
  'seconds',
  'pts',
  'fg2m',
  'fg2a',
  'fg3m',
  'fg3a',
  'ftm',
  'fta',
  'oreb',
  'dreb',
  'ast',
  'stl',
  'blk',
  'tov',
  'pf',
  'fd',
] as const satisfies readonly (keyof CountingStats)[];

function zeroCounting(): CountingStats {
  return Object.fromEntries(COUNTING_KEYS.map((k) => [k, 0])) as unknown as CountingStats;
}

/** FIBA Performance Index Rating: PTS + REB + AST + STL + BLK + FD − missed FG − missed FT − TO − PF. */
export function pir(s: CountingStats): number {
  const fgm = s.fg2m + s.fg3m;
  const fga = s.fg2a + s.fg3a;
  return (
    s.pts + s.oreb + s.dreb + s.ast + s.stl + s.blk + s.fd - (fga - fgm) - (s.fta - s.ftm) - s.tov - s.pf
  );
}

function derive(s: CountingStats): Derived {
  return { fgm: s.fg2m + s.fg3m, fga: s.fg2a + s.fg3a, reb: s.oreb + s.dreb, pir: pir(s) };
}

const other = (side: Side): Side => (side === 'home' ? 'away' : 'home');

/**
 * Rebuilds every total for a game from its event list.
 * Minutes come from the starters and the substitutions; +/- from the score while each player is on court.
 * Pass `final: true` to run the clock out to the end of the last period played.
 */
export function computeBoxScore(roster: RosterPlayer[], events: GameEvent[], opts: { final?: boolean } = {}): BoxScore {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);

  const lines = new Map<number, CountingStats & { side: Side; starter: boolean; plusMinus: number }>();
  const onCourt: Record<Side, Set<number>> = { home: new Set(), away: new Set() };

  const lineFor = (playerId: number, side: Side) => {
    let line = lines.get(playerId);
    if (!line) {
      line = { ...zeroCounting(), side, starter: false, plusMinus: 0 };
      lines.set(playerId, line);
    }
    return line;
  };

  for (const r of roster) {
    lines.set(r.playerId, { ...zeroCounting(), side: r.side, starter: r.starter, plusMinus: 0 });
    if (r.starter) onCourt[r.side].add(r.playerId);
  }

  const periods = Math.max(FIBA.regulationPeriods, ...ordered.map((e) => e.period));
  const lineScore: Record<Side, number[]> = {
    home: Array.from({ length: periods }, () => 0),
    away: Array.from({ length: periods }, () => 0),
  };
  const score: Record<Side, number> = { home: 0, away: 0 };
  const team = { home: { oreb: 0, dreb: 0 }, away: { oreb: 0, dreb: 0 } };
  const shots: ShotRecord[] = [];

  let lastTime = 0;
  const runClockTo = (t: number) => {
    if (t <= lastTime) return;
    const dt = t - lastTime;
    for (const side of ['home', 'away'] as const) {
      for (const id of onCourt[side]) lineFor(id, side).seconds += dt;
    }
    lastTime = t;
  };

  const scored = (side: Side, period: number, pts: number) => {
    score[side] += pts;
    lineScore[side][period - 1] = (lineScore[side][period - 1] ?? 0) + pts;
    for (const id of onCourt[side]) lineFor(id, side).plusMinus += pts;
    for (const id of onCourt[other(side)]) lineFor(id, other(side)).plusMinus -= pts;
  };

  for (const e of ordered) {
    runClockTo(gameTime(e.period, e.clock));
    const side = e.side;
    const line = e.playerId !== null && side ? lineFor(e.playerId, side) : undefined;

    switch (e.type) {
      case 'shot': {
        if (!side) break;
        if (line) {
          if (e.pts === 3) {
            line.fg3a++;
            if (e.made) line.fg3m++;
          } else {
            line.fg2a++;
            if (e.made) line.fg2m++;
          }
          if (e.made) line.pts += e.pts;
        }
        if (e.made) scored(side, e.period, e.pts);
        shots.push({
          eventId: e.id,
          playerId: e.playerId,
          side,
          period: e.period,
          clock: e.clock,
          pts: e.pts,
          made: e.made,
          x: e.x,
          y: e.y,
          zone: shotZone(e.pts, e.x, e.y),
        });
        break;
      }
      case 'ft':
        if (!side) break;
        if (line) {
          line.fta++;
          if (e.made) {
            line.ftm++;
            line.pts += 1;
          }
        }
        if (e.made) scored(side, e.period, 1);
        break;
      case 'reb':
        if (!side) break;
        if (line) {
          if (e.off) line.oreb++;
          else line.dreb++;
        } else if (e.off) team[side].oreb++;
        else team[side].dreb++;
        break;
      case 'ast':
        if (line) line.ast++;
        break;
      case 'stl':
        if (line) line.stl++;
        break;
      case 'blk':
        if (line) line.blk++;
        break;
      case 'tov':
        if (line) line.tov++;
        break;
      case 'fd':
        if (line) line.fd++;
        break;
      case 'pf':
        if (line) line.pf++;
        break;
      case 'sub':
        if (!side) break;
        onCourt[side].delete(e.outId);
        onCourt[side].add(e.inId);
        lineFor(e.inId, side);
        break;
      case 'timeout':
      case 'period_start':
      case 'period_end':
        break;
    }
  }

  if (opts.final) runClockTo(gameTime(periods, 0));

  const players: PlayerLine[] = [...lines.entries()].map(([playerId, l]) => ({
    ...l,
    ...derive(l),
    playerId,
    fouledOut: l.pf >= FIBA.foulOutAt,
  }));

  const totals = {} as Record<Side, TeamTotals>;
  for (const side of ['home', 'away'] as const) {
    const sum = zeroCounting();
    let pirSum = 0;
    for (const p of players) {
      if (p.side !== side) continue;
      for (const k of COUNTING_KEYS) sum[k] += p[k];
      pirSum += p.pir;
    }
    sum.oreb += team[side].oreb;
    sum.dreb += team[side].dreb;
    totals[side] = {
      ...sum,
      ...derive(sum),
      // Team PIR is the sum of the players' PIR, as in the prototype; team rebounds are not credited.
      pir: pirSum,
      teamOreb: team[side].oreb,
      teamDreb: team[side].dreb,
    };
  }

  return { periods, score, lineScore, players, totals, shots };
}
