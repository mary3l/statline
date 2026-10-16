import { describe, expect, it } from 'vitest';
import type { RosterPlayer } from './boxscore.js';
import { computeLineups, unitKey } from './lineups.js';
import type { GameEvent } from './types.js';

let seq = 0;
const ev = (e: Partial<GameEvent> & Pick<GameEvent, 'type'>): GameEvent =>
  ({ id: `e${++seq}`, seq, period: 1, clock: 600, side: 'home', playerId: null, ...e }) as GameEvent;

const roster: RosterPlayer[] = [
  ...[1, 2, 3, 4, 5].map((id) => ({ playerId: id, side: 'home' as const, starter: true })),
  { playerId: 6, side: 'home', starter: false },
  ...[11, 12, 13, 14, 15].map((id) => ({ playerId: id, side: 'away' as const, starter: true })),
];

describe('computeLineups', () => {
  it('splits time and points between the units on court', () => {
    seq = 0;
    const units = computeLineups(
      roster,
      [
        ev({ type: 'shot', clock: 500, playerId: 1, pts: 2, made: true, x: 0.5, y: 0.1 }),
        ev({ type: 'sub', clock: 300, outId: 5, inId: 6 }),
        ev({ type: 'shot', clock: 200, side: 'away', playerId: 11, pts: 3, made: true, x: 0.5, y: 0.7 }),
        ev({ type: 'ft', clock: 100, playerId: 6, made: true }),
        ev({ type: 'period_end', clock: 0, side: null }),
      ],
      { final: true },
    );
    const home = units.filter((u) => u.side === 'home');
    const starters = home.find((u) => unitKey(u.playerIds) === '1-2-3-4-5')!;
    const second = home.find((u) => unitKey(u.playerIds) === '1-2-3-4-6')!;
    expect(starters).toMatchObject({ seconds: 300, ptsFor: 2, ptsAgainst: 0 });
    // The rest of Q1 plus Q2–Q4 (the clock is run out for a final game).
    expect(second).toMatchObject({ seconds: 300 + 3 * 600, ptsFor: 1, ptsAgainst: 3 });

    const away = units.filter((u) => u.side === 'away');
    expect(away).toHaveLength(1);
    expect(away[0]).toMatchObject({ seconds: 2400, ptsFor: 3, ptsAgainst: 3 });
  });

  it('gives the same key to the same five in any order', () => {
    expect(unitKey([5, 1, 3, 2, 4])).toBe(unitKey([1, 2, 3, 4, 5]));
  });
});
