import { describe, expect, it } from 'vitest';
import { forcedSub, onSwipe, onText, type FlowContext, type FlowPlayer, type Question } from './phoneFlow.js';

const pl = (playerId: number, side: 'home' | 'away', jersey: string, onCourt = true, fouls = 0): FlowPlayer => ({
  playerId,
  side,
  jersey,
  onCourt,
  fouls,
  name: `P${playerId}`,
});

const players = [
  pl(1, 'home', '7'),
  pl(2, 'home', '4'),
  pl(3, 'home', '10'),
  pl(4, 'home', '12'),
  pl(5, 'home', '30'),
  pl(6, 'home', '8', false),
  pl(11, 'away', '21'),
  pl(12, 'away', '2'),
  pl(13, 'away', '5', true, 4),
  pl(14, 'away', '7'),
  pl(15, 'away', '9'),
  pl(16, 'away', '24', false),
];

const ctx = (over: Partial<FlowContext> = {}): FlowContext => ({
  players,
  teamName: { home: 'Mavericks', away: 'Bulls' },
  penalty: { home: false, away: false },
  timeoutsLeft: { home: 2, away: 0 },
  lastMissSide: null,
  options: { sideWords: { home: ['mavericks'], away: ['bulls'] } },
  ...over,
});

describe('phone flow', () => {
  it('records a made shot, then asks for the assist', () => {
    const r = onText('10 three made', null, ctx());
    expect(r.plays).toEqual([{ type: 'shot', side: 'home', playerId: 3, pts: 3, made: true, x: null, y: null }]);
    expect(r.clock).toEqual({ shot: 24 });
    expect(r.next).toEqual({ k: 'assist', side: 'home', scorerId: 3 });
    expect(r.buzz).toBe('question');
    expect(r.say).toMatch(/number 10.*three made.*Assisted by/);

    const a = onText('4', r.next, ctx());
    expect(a.plays).toEqual([{ type: 'ast', side: 'home', playerId: 2 }]);
    expect(a.next).toBeNull();
    expect(onSwipe('left', r.next, ctx())).toMatchObject({ plays: [], next: null, say: 'No assist.' });
    // The scorer cannot assist their own basket.
    expect(onText('10', r.next, ctx()).buzz).toBe('error');
  });

  it('decides offensive or defensive from the team that missed', () => {
    const miss = onText('21 two missed', null, ctx());
    expect(miss.next).toEqual({ k: 'rebound', shotSide: 'away' });
    expect(onText('12', miss.next, ctx()).plays).toEqual([{ type: 'reb', side: 'home', playerId: 4, off: false }]);
    expect(onText('9', miss.next, ctx()).plays).toEqual([{ type: 'reb', side: 'away', playerId: 15, off: true }]);
    expect(onText('9', miss.next, ctx()).clock).toEqual({ shot: 14 });
    // #7 is on court for both teams: o/d settles it.
    expect(onText('7', miss.next, ctx()).buzz).toBe('error');
    expect(onText('7 o', miss.next, ctx()).plays[0]).toMatchObject({ playerId: 14, off: true });
  });

  it('runs a foul: kind, who was fouled, then each free throw', () => {
    const pen = ctx({ penalty: { home: false, away: true } });
    const f = onText('5 foul', null, pen);
    expect(f.next).toEqual({ k: 'foulKind', foulerId: 13 });
    // Personal in the penalty: two free throws. The fifth foul is announced.
    const pf = onSwipe('right', f.next, pen);
    expect(pf.plays).toEqual([{ type: 'pf', side: 'away', playerId: 13, kind: 'personal' }]);
    expect(pf.clock).toEqual({ stop: true });
    expect(pf.say).toMatch(/fifth foul/);
    expect(pf.next).toEqual({ k: 'fouled', side: 'home', kind: 'personal', n: 2, foulerId: 13 });
    // Free throws are due, so "who was fouled" can't be skipped.
    expect(onSwipe('left', pf.next, ctx()).buzz).toBe('error');

    const fd = onText('12', pf.next, ctx());
    expect(fd.plays).toEqual([{ type: 'fd', side: 'home', playerId: 4 }]);
    expect(fd.next).toEqual({ k: 'ft', shooterId: 4, n: 2, i: 1 });
    const ft1 = onSwipe('left', fd.next, ctx());
    expect(ft1.next).toEqual({ k: 'ft', shooterId: 4, n: 2, i: 2 });
    const ft2 = onText('missed', ft1.next, ctx());
    expect(ft2.plays).toEqual([{ type: 'ft', side: 'home', playerId: 4, made: false }]);
    expect(ft2.next).toEqual({ k: 'rebound', shotSide: 'home' });
  });

  it('types the foul kind, and an offensive foul is also a turnover', () => {
    const q: Question = { k: 'foulKind', foulerId: 1 };
    expect(onText('shooting 3', q, ctx()).next).toMatchObject({ k: 'fouled', n: 3 });
    const off = onText('offensive', q, ctx());
    expect(off.plays.map((p) => p.type)).toEqual(['pf', 'tov']);
    expect(off.next).toMatchObject({ k: 'fouled', side: 'away', n: 0 });
    expect(onSwipe('left', off.next, ctx())).toMatchObject({ next: null, buzz: 'saved' });
    expect(onSwipe('left', q, ctx())).toMatchObject({ plays: [], say: 'Foul cancelled.' });
  });

  it('asks which team when both have the jersey on court', () => {
    const r = onText('7 two made', null, ctx());
    expect(r.next).toEqual({ k: 'whichTeam', text: '7 two made' });
    expect(onSwipe('left', r.next, ctx()).plays[0]).toMatchObject({ side: 'away', playerId: 14 });
    expect(onText('home', r.next, ctx()).plays[0]).toMatchObject({ side: 'home', playerId: 1 });
    expect(onText('bulls 7 two made', null, ctx()).plays[0]).toMatchObject({ playerId: 14 });
  });

  it('handles steals, subs, timeouts and controls', () => {
    const stl = onText('2 steal', null, ctx());
    expect(stl.next).toEqual({ k: 'stealVictim', side: 'home' });
    expect(onText('30', stl.next, ctx()).plays).toEqual([{ type: 'tov', side: 'home', playerId: 5 }]);

    // A turnover asks who stole it; "no steal" (swipe left) for travels and bad passes.
    const tov = onText('30 turnover', null, ctx());
    expect(tov.plays).toEqual([{ type: 'tov', side: 'home', playerId: 5 }]);
    expect(tov.clock).toEqual({ shot: 24, stop: true });
    expect(tov.next).toEqual({ k: 'stealer', side: 'away' });
    expect(onText('2', tov.next, ctx()).plays).toEqual([{ type: 'stl', side: 'away', playerId: 12 }]);
    expect(onSwipe('left', tov.next, ctx())).toMatchObject({ plays: [], next: null, say: 'No steal.' });
    // Both halves in one line.
    expect(onText('2 steal 30', null, ctx())).toMatchObject({ next: null, plays: [{ type: 'stl', playerId: 12 }, { type: 'tov', side: 'home', playerId: 5 }] });
    expect(onText('30 turnover 2', null, ctx())).toMatchObject({ next: null, plays: [{ type: 'tov', playerId: 5 }, { type: 'stl', side: 'away', playerId: 12 }] });
    expect(onText('30 turnover 99', null, ctx()).buzz).toBe('error');

    expect(onText('8 in 30 out', null, ctx()).plays).toEqual([{ type: 'sub', side: 'home', playerId: null, outId: 5, inId: 6 }]);
    expect(onText('30 in 8 out', null, ctx()).buzz).toBe('error');
    expect(onText('timeout bulls', null, ctx())).toMatchObject({ buzz: 'error', say: expect.stringMatching(/no timeouts/) });
    expect(onText('timeout home', null, ctx()).plays).toEqual([{ type: 'timeout', side: 'home', playerId: null }]);
    expect(onText('undo', { k: 'assist', side: 'home', scorerId: 1 }, ctx())).toMatchObject({ control: 'undo', next: null });
    expect(onText('score', { k: 'rebound', shotSide: 'home' }, ctx())).toMatchObject({ control: 'readout', next: { k: 'rebound' } });
    expect(onText('99 two made', null, ctx()).buzz).toBe('error');
  });

  it('asks for a substitute when someone on court has five fouls', () => {
    const fouledOut = players.map((p) => (p.playerId === 13 ? { ...p, fouls: 5 } : p));
    const q = forcedSub(ctx({ players: fouledOut }));
    expect(q).toEqual({ k: 'forcedSub', outId: 13, side: 'away' });
    expect(onText('5 two made', null, ctx({ players: fouledOut })).buzz).toBe('error');
    expect(onText('24', q, ctx({ players: fouledOut })).plays).toEqual([{ type: 'sub', side: 'away', playerId: null, outId: 13, inId: 16 }]);
    expect(forcedSub(ctx())).toBeNull();
  });
});
