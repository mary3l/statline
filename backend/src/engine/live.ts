import { FIBA } from './fiba.js';
import type { FoulKind, GameEvent, Side } from './types.js';

/**
 * What a courtside recorder needs to know right now, rebuilt from the event list:
 * who is on court, personal and team fouls, and timeouts used.
 * (Scores and player lines come from computeBoxScore.)
 */
export interface LiveState {
  /** Players on court per side, in the order they entered (a sub takes the place of the player going out). */
  onCourt: Record<Side, number[]>;
  /** Personal fouls per player. */
  fouls: Map<number, number>;
  /** Team fouls per side, keyed by foul period (see foulPeriod). */
  teamFouls: Record<Side, Map<number, number>>;
  /** Timeouts used per side, keyed by timeout window (see timeoutWindow). */
  timeoutsUsed: Record<Side, Map<string, number>>;
  /** Highest period that has any event, or 1. */
  lastPeriod: number;
  /** Periods that have a period_end event. */
  endedPeriods: Set<number>;
  /** Periods that have a period_start event. */
  startedPeriods: Set<number>;
}

export interface LineupPlayer {
  playerId: number;
  side: Side;
  starter: boolean;
}

/** Team fouls are counted per quarter; overtime counts with Q4. */
export function foulPeriod(period: number): number {
  return Math.min(period, FIBA.regulationPeriods);
}

/** FIBA timeouts: 2 in the first half, 3 in the second half, 1 in each overtime. */
export function timeoutWindow(period: number): { key: string; limit: number; label: string } {
  if (period <= 2) return { key: 'h1', limit: 2, label: '1st half' };
  if (period <= FIBA.regulationPeriods) return { key: 'h2', limit: 3, label: '2nd half' };
  return { key: `ot${period}`, limit: 1, label: 'this overtime' };
}

/** Free throws awarded for a foul. `penalty` = the fouling team already had 4 team fouls this period. */
export function freeThrowsFor(kind: FoulKind, penalty: boolean): number {
  switch (kind) {
    case 'shoot3':
      return 3;
    case 'shoot2':
    case 'unsport':
      return 2;
    case 'and1':
      return 1;
    case 'personal':
      return penalty ? 2 : 0;
    case 'offensive':
      return 0;
  }
}

export function computeLiveState(lineup: LineupPlayer[], events: GameEvent[]): LiveState {
  const state: LiveState = {
    onCourt: { home: [], away: [] },
    fouls: new Map(),
    teamFouls: { home: new Map(), away: new Map() },
    timeoutsUsed: { home: new Map(), away: new Map() },
    lastPeriod: 1,
    endedPeriods: new Set(),
    startedPeriods: new Set(),
  };
  for (const p of lineup) if (p.starter) state.onCourt[p.side].push(p.playerId);

  const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    state.lastPeriod = Math.max(state.lastPeriod, e.period);
    switch (e.type) {
      case 'pf':
        if (e.playerId !== null) bump(state.fouls, e.playerId);
        if (e.side) bump(state.teamFouls[e.side], foulPeriod(e.period));
        break;
      case 'timeout':
        if (e.side) bump(state.timeoutsUsed[e.side], timeoutWindow(e.period).key);
        break;
      case 'sub': {
        if (!e.side) break;
        const court = state.onCourt[e.side];
        const i = court.indexOf(e.outId);
        if (i >= 0) court[i] = e.inId;
        else if (!court.includes(e.inId)) court.push(e.inId);
        break;
      }
      case 'period_start':
        state.startedPeriods.add(e.period);
        break;
      case 'period_end':
        state.endedPeriods.add(e.period);
        break;
      default:
        break;
    }
  }
  return state;
}

export function teamFoulsIn(state: LiveState, side: Side, period: number): number {
  return state.teamFouls[side].get(foulPeriod(period)) ?? 0;
}

/** True once the team has 4 team fouls this period: from the next foul, a personal foul gives 2 free throws. */
export function inPenalty(state: LiveState, side: Side, period: number): boolean {
  return teamFoulsIn(state, side, period) >= FIBA.teamFoulPenaltyAt;
}

export function timeoutsLeft(state: LiveState, side: Side, period: number): number {
  const w = timeoutWindow(period);
  return w.limit - (state.timeoutsUsed[side].get(w.key) ?? 0);
}

export function isFouledOut(state: LiveState, playerId: number): boolean {
  return (state.fouls.get(playerId) ?? 0) >= FIBA.foulOutAt;
}

/** The team that missed the last shot or free throw while its rebound is still open (no rebound yet), else null. */
export function openMissSide(events: GameEvent[]): Side | null {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const e = ordered[i]!;
    if ((e.type === 'shot' || e.type === 'ft') && !e.made) return e.side;
    if (e.type === 'shot' || e.type === 'ft' || e.type === 'reb') return null;
  }
  return null;
}

/**
 * Offensive or defensive is decided by who got the ball: the team that missed = offensive rebound,
 * the other team = defensive. With no open miss (the miss wasn't recorded), it counts as defensive.
 */
export function isOffensiveRebound(events: GameEvent[], side: Side): boolean {
  return openMissSide(events) === side;
}
