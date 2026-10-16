import { describe, expect, it } from 'vitest';
import { Rng } from '../seed/rng.js';
import { simulateGame } from '../seed/simulate.js';
import { computeBoxScore, pir, type RosterPlayer } from './boxscore.js';
import { isBeyondArc, toMetres } from './court.js';
import type { GameEvent } from './types.js';

let seq = 0;
const ev = (e: Partial<GameEvent> & Pick<GameEvent, 'type'>): GameEvent =>
  ({ id: `e${++seq}`, seq, period: 1, clock: 600, side: 'home', playerId: null, ...e }) as GameEvent;

// Home 1–5 start, 6 on the bench; away 11–15 start.
const roster: RosterPlayer[] = [
  ...[1, 2, 3, 4, 5].map((id) => ({ playerId: id, side: 'home' as const, starter: true })),
  { playerId: 6, side: 'home', starter: false },
  ...[11, 12, 13, 14, 15].map((id) => ({ playerId: id, side: 'away' as const, starter: true })),
];

describe('computeBoxScore', () => {
  it('derives points, shooting, rebounds and PIR from the events', () => {
    seq = 0;
    const events: GameEvent[] = [
      ev({ type: 'period_start', clock: 600, side: null }),
      ev({ type: 'shot', clock: 580, playerId: 1, pts: 3, made: true, x: 0.5, y: 0.6 }),
      ev({ type: 'ast', clock: 580, playerId: 2 }),
      ev({ type: 'shot', clock: 560, side: 'away', playerId: 11, pts: 2, made: false, x: 0.5, y: 0.2 }),
      ev({ type: 'blk', clock: 560, playerId: 5 }),
      ev({ type: 'reb', clock: 559, playerId: 4, off: false }),
      ev({ type: 'pf', clock: 540, side: 'away', playerId: 12, kind: 'shoot2' }),
      ev({ type: 'fd', clock: 540, playerId: 1 }),
      ev({ type: 'ft', clock: 540, playerId: 1, made: true }),
      ev({ type: 'ft', clock: 540, playerId: 1, made: false }),
      ev({ type: 'reb', clock: 539, side: 'away', playerId: null, off: false }),
      ev({ type: 'stl', clock: 530, playerId: 3 }),
      ev({ type: 'tov', clock: 530, side: 'away', playerId: 13 }),
    ];
    const box = computeBoxScore(roster, events);
    const p1 = box.players.find((p) => p.playerId === 1)!;

    expect(box.score).toEqual({ home: 4, away: 0 });
    expect(box.lineScore.home).toEqual([4, 0, 0, 0]);
    expect(p1).toMatchObject({ pts: 4, fg3m: 1, fg3a: 1, ftm: 1, fta: 2, fd: 1 });
    // 4 PTS + 1 FD − 1 missed FT
    expect(p1.pir).toBe(4);
    expect(box.players.find((p) => p.playerId === 11)!.pir).toBe(-1);
    expect(box.totals.away).toMatchObject({ reb: 1, teamDreb: 1, dreb: 1 });
    expect(box.totals.home.reb).toBe(1);
    expect(box.shots).toHaveLength(2);
    expect(box.shots[1]!.zone).toBe('paint');
  });

  it('counts minutes and +/- from the starters and substitutions', () => {
    seq = 0;
    const events: GameEvent[] = [
      ev({ type: 'shot', clock: 500, playerId: 1, pts: 2, made: true, x: 0.5, y: 0.1 }),
      ev({ type: 'sub', clock: 300, outId: 1, inId: 6 }),
      ev({ type: 'shot', clock: 200, side: 'away', playerId: 11, pts: 3, made: true, x: 0.5, y: 0.7 }),
      ev({ type: 'period_end', clock: 0, side: null }),
    ];
    const box = computeBoxScore(roster, events, { final: true });
    const line = (id: number) => box.players.find((p) => p.playerId === id)!;

    expect(line(1).seconds).toBe(300);
    // Q1's second half on court, then Q2–Q4 still counted as on court for the sub who stayed in.
    expect(line(6).seconds).toBe(300 + 3 * 600);
    expect(line(2).seconds).toBe(4 * 600);
    expect(line(1).plusMinus).toBe(2);
    expect(line(6).plusMinus).toBe(-3);
    expect(line(2).plusMinus).toBe(-1);
    expect(line(11).plusMinus).toBe(1);
  });

  it('flags a player with 5 fouls as fouled out', () => {
    seq = 0;
    const events = Array.from({ length: 5 }, () => ev({ type: 'pf', playerId: 3, kind: 'personal' }));
    expect(computeBoxScore(roster, events).players.find((p) => p.playerId === 3)!.fouledOut).toBe(true);
  });
});

describe('PIR', () => {
  it('matches the README formula', () => {
    const line = { seconds: 0, pts: 21, fg2m: 6, fg2a: 11, fg3m: 3, fg3a: 7, ftm: 0, fta: 0, oreb: 0, dreb: 4, ast: 8, stl: 3, blk: 0, tov: 3, pf: 2, fd: 5 };
    // 21 + 4 + 8 + 3 + 0 + 5 − 9 missed FG − 0 − 3 − 2
    expect(pir(line)).toBe(27);
  });
});

describe('simulated games (seed data)', () => {
  it('produce consistent box scores', () => {
    const rng = new Rng(7);
    const team = (base: number) => ({
      players: (['PG', 'SG', 'SF', 'PF', 'C', 'SG', 'SF', 'C'] as const).map((position, i) => ({
        playerId: base + i,
        position,
        skill: i < 5 ? 1.05 : 0.9,
      })),
    });
    for (let g = 0; g < 20; g++) {
      const events = simulateGame(rng, { home: team(100), away: team(200) });
      const r: RosterPlayer[] = [
        ...team(100).players.map((p, i) => ({ playerId: p.playerId, side: 'home' as const, starter: i < 5 })),
        ...team(200).players.map((p, i) => ({ playerId: p.playerId, side: 'away' as const, starter: i < 5 })),
      ];
      const box = computeBoxScore(r, events, { final: true });

      expect(box.score.home).not.toBe(box.score.away);
      for (const side of ['home', 'away'] as const) {
        expect(box.lineScore[side].reduce((a, b) => a + b, 0)).toBe(box.score[side]);
        expect(box.totals[side].pts).toBe(box.score[side]);
        // Five players on court at all times: team minutes = 5 × game length.
        expect(box.totals[side].seconds).toBe(5 * (2400 + (box.periods - 4) * 300));
        // +/- sums to 5 × the margin.
        const pm = box.players.filter((p) => p.side === side).reduce((a, p) => a + p.plusMinus, 0);
        expect(pm).toBe(5 * (box.score[side] - box.score[side === 'home' ? 'away' : 'home']));
      }
      for (const s of box.shots) {
        if (s.x === null || s.y === null) continue;
        const { mx, my } = toMetres(s.x, s.y);
        expect(isBeyondArc(mx, my)).toBe(s.pts === 3);
      }
      expect(box.players.every((p) => p.pf <= 5)).toBe(true);
    }
  });
});
