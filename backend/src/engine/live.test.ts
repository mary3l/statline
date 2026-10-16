import { describe, expect, it } from 'vitest';
import { computeLiveState, freeThrowsFor, inPenalty, isFouledOut, isOffensiveRebound, openMissSide, teamFoulsIn, timeoutsLeft, type LineupPlayer } from './live.js';
import type { GameEvent } from './types.js';

let seq = 0;
const ev = (e: Partial<GameEvent> & Pick<GameEvent, 'type'>): GameEvent =>
  ({ id: `e${++seq}`, seq, period: 1, clock: 600, side: 'home', playerId: null, ...e }) as GameEvent;

const lineup: LineupPlayer[] = [
  ...[1, 2, 3, 4, 5].map((id) => ({ playerId: id, side: 'home' as const, starter: true })),
  { playerId: 6, side: 'home', starter: false },
  ...[11, 12, 13, 14, 15].map((id) => ({ playerId: id, side: 'away' as const, starter: true })),
];

describe('computeLiveState', () => {
  it('tracks who is on court through substitutions, keeping the slot order', () => {
    seq = 0;
    const s = computeLiveState(lineup, [ev({ type: 'sub', outId: 3, inId: 6 })]);
    expect(s.onCourt.home).toEqual([1, 2, 6, 4, 5]);
    expect(s.onCourt.away).toEqual([11, 12, 13, 14, 15]);
  });

  it('counts team fouls per quarter, with overtime counted with Q4', () => {
    seq = 0;
    const fouls = [1, 2, 3, 4].map((p) => ev({ type: 'pf', period: 4, playerId: p, kind: 'personal' }));
    const s = computeLiveState(lineup, [
      ev({ type: 'pf', period: 1, playerId: 1, kind: 'personal' }),
      ...fouls,
      ev({ type: 'pf', period: 5, side: 'away', playerId: 11, kind: 'shoot2' }),
    ]);
    expect(teamFoulsIn(s, 'home', 1)).toBe(1);
    expect(teamFoulsIn(s, 'home', 4)).toBe(4);
    expect(inPenalty(s, 'home', 4)).toBe(true);
    expect(inPenalty(s, 'home', 5)).toBe(true);
    expect(inPenalty(s, 'home', 2)).toBe(false);
    expect(teamFoulsIn(s, 'away', 4)).toBe(1);
  });

  it('fouls a player out at 5 personal fouls', () => {
    seq = 0;
    const s = computeLiveState(
      lineup,
      [1, 1, 2, 3, 3].map((period) => ev({ type: 'pf', period, playerId: 4, kind: 'personal' })),
    );
    expect(s.fouls.get(4)).toBe(5);
    expect(isFouledOut(s, 4)).toBe(true);
    expect(isFouledOut(s, 1)).toBe(false);
  });

  it('allows 2 timeouts in the first half, 3 in the second and 1 per overtime', () => {
    seq = 0;
    const s = computeLiveState(lineup, [
      ev({ type: 'timeout', period: 1 }),
      ev({ type: 'timeout', period: 2 }),
      ev({ type: 'timeout', period: 3, side: 'away' }),
      ev({ type: 'timeout', period: 5 }),
    ]);
    expect(timeoutsLeft(s, 'home', 2)).toBe(0);
    expect(timeoutsLeft(s, 'home', 3)).toBe(3);
    expect(timeoutsLeft(s, 'away', 4)).toBe(2);
    expect(timeoutsLeft(s, 'home', 5)).toBe(0);
    expect(timeoutsLeft(s, 'home', 6)).toBe(1);
  });

  it('remembers which periods started and ended', () => {
    seq = 0;
    const s = computeLiveState(lineup, [
      ev({ type: 'period_start', side: null }),
      ev({ type: 'period_end', side: null, clock: 0 }),
      ev({ type: 'period_start', side: null, period: 2 }),
    ]);
    expect([...s.startedPeriods]).toEqual([1, 2]);
    expect([...s.endedPeriods]).toEqual([1]);
    expect(s.lastPeriod).toBe(2);
  });
});

describe('freeThrowsFor', () => {
  it('awards free throws by foul kind and the penalty', () => {
    expect(freeThrowsFor('personal', false)).toBe(0);
    expect(freeThrowsFor('personal', true)).toBe(2);
    expect(freeThrowsFor('shoot2', false)).toBe(2);
    expect(freeThrowsFor('shoot3', false)).toBe(3);
    expect(freeThrowsFor('and1', true)).toBe(1);
    expect(freeThrowsFor('offensive', true)).toBe(0);
    expect(freeThrowsFor('unsport', false)).toBe(2);
  });
});

describe('rebounds', () => {
  it('are offensive for the team that missed and defensive for the other', () => {
    seq = 0;
    const miss = [ev({ type: 'shot', side: 'home', playerId: 1, pts: 2, made: false, x: 0.5, y: 0.1 })];
    expect(openMissSide(miss)).toBe('home');
    expect(isOffensiveRebound(miss, 'home')).toBe(true);
    expect(isOffensiveRebound(miss, 'away')).toBe(false);
  });

  it('close once the rebound is in, and count as defensive without a recorded miss', () => {
    seq = 0;
    const events = [
      ev({ type: 'shot', side: 'away', playerId: 11, pts: 3, made: false, x: 0.9, y: 0.6 }),
      ev({ type: 'reb', side: 'home', playerId: 4, off: false }),
    ];
    expect(openMissSide(events)).toBeNull();
    expect(isOffensiveRebound(events, 'home')).toBe(false);
    expect(isOffensiveRebound([], 'away')).toBe(false);
    // A missed last free throw is reboundable too; a made one closes it.
    expect(openMissSide([ev({ type: 'ft', side: 'away', playerId: 12, made: false })])).toBe('away');
    expect(openMissSide([ev({ type: 'ft', side: 'away', playerId: 12, made: true })])).toBeNull();
  });
});
