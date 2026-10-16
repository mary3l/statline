import { describe, expect, it } from 'vitest';
import { parseCommand, parsePlayerAnswer, resolveJersey } from './commands.js';

const opts = { sideWords: { home: ['mav', 'mavericks'], away: ['bul', 'bulls'] } };
const p = (t: string) => parseCommand(t, opts);

describe('parseCommand', () => {
  it('reads shots with the jersey first', () => {
    expect(p('7 three made')).toEqual({ kind: 'shot', jersey: '7', side: undefined, pts: 3, made: true });
    expect(p('21 two missed')).toMatchObject({ kind: 'shot', jersey: '21', pts: 2, made: false });
    expect(p('#7 3pt good')).toMatchObject({ kind: 'shot', pts: 3, made: true });
    expect(p('12 layup miss')).toMatchObject({ kind: 'shot', jersey: '12', pts: 2, made: false });
    expect(p('twenty one three pointer made')).toMatchObject({ kind: 'shot', jersey: '21', pts: 3 });
    expect(p('00 two made')).toMatchObject({ jersey: '00' });
    expect(p('07 two made')).toMatchObject({ jersey: '7' });
  });

  it('asks for what is missing', () => {
    expect(p('7 three')).toMatchObject({ kind: 'error', message: expect.stringMatching(/made or missed/) });
    expect(p('7 made')).toMatchObject({ kind: 'error', message: expect.stringMatching(/2 or 3/) });
    expect(p('three made')).toMatchObject({ kind: 'error', message: expect.stringMatching(/2 or 3/) });
    expect(p('made')).toMatchObject({ kind: 'error' });
  });

  it('reads free throws, rebounds and single stats', () => {
    expect(p('7 free throw made')).toMatchObject({ kind: 'ft', jersey: '7', made: true });
    expect(p('7 ft miss')).toMatchObject({ kind: 'ft', made: false });
    expect(p('12 defensive rebound')).toMatchObject({ kind: 'reb', jersey: '12', off: false });
    expect(p('12 off reb')).toMatchObject({ kind: 'reb', off: true });
    expect(p('12 rebound')).toMatchObject({ kind: 'reb', off: null });
    expect(p('4 assist')).toMatchObject({ kind: 'stat', stat: 'ast', jersey: '4' });
    expect(p('2 steal')).toMatchObject({ kind: 'stat', stat: 'stl' });
    expect(p('9 block')).toMatchObject({ kind: 'stat', stat: 'blk' });
    expect(p('30 turnover')).toMatchObject({ kind: 'stat', stat: 'tov', jersey: '30' });
    expect(p('30 turnover')).not.toHaveProperty('other');
    expect(p('2 steal 7')).toMatchObject({ kind: 'stat', stat: 'stl', jersey: '2', other: '7' });
    expect(p('30 turnover stolen by 5')).toMatchObject({ kind: 'stat', stat: 'tov', jersey: '30', other: '5' });
    expect(p('7 two blocked')).toMatchObject({ kind: 'shot', made: false });
  });

  it('reads fouls with or without the kind', () => {
    expect(p('5 foul')).toEqual({ kind: 'foul', jersey: '5', side: undefined, foul: undefined });
    expect(p('5 shooting foul')).toMatchObject({ foul: 'shoot2' });
    expect(p('5 shooting foul 3')).toMatchObject({ foul: 'shoot3' });
    expect(p('5 foul and one')).toMatchObject({ foul: 'and1' });
    expect(p('5 offensive foul')).toMatchObject({ foul: 'offensive' });
    expect(p('5 unsportsmanlike foul')).toMatchObject({ foul: 'unsport' });
    expect(p('5 personal foul')).toMatchObject({ foul: 'personal' });
  });

  it('reads sides, substitutions, timeouts and controls', () => {
    expect(p('home 7 three made')).toMatchObject({ side: 'home' });
    expect(p('bulls 7 two missed')).toMatchObject({ side: 'away' });
    expect(p('24 in 5 out')).toMatchObject({ kind: 'sub', inJersey: '24', outJersey: '5' });
    expect(p('in 24 out 5')).toMatchObject({ kind: 'sub', inJersey: '24', outJersey: '5' });
    expect(p('sub 8 for 10 mav')).toMatchObject({ kind: 'sub', inJersey: '8', outJersey: '10', side: 'home' });
    expect(p('timeout home')).toEqual({ kind: 'timeout', side: 'home' });
    expect(p('bulls timeout')).toEqual({ kind: 'timeout', side: 'away' });
    expect(p('timeout')).toMatchObject({ kind: 'error' });
    expect(p('undo')).toEqual({ kind: 'undo' });
    expect(p('score')).toEqual({ kind: 'score' });
    expect(p('start')).toEqual({ kind: 'clock' });
    expect(p('next quarter')).toEqual({ kind: 'nextPeriod' });
  });
});

describe('parsePlayerAnswer', () => {
  it('reads a jersey, a side and o/d, or none', () => {
    expect(parsePlayerAnswer('12', opts)).toEqual({ jersey: '12', side: undefined, off: null });
    expect(parsePlayerAnswer('away 7', opts)).toMatchObject({ jersey: '7', side: 'away' });
    expect(parsePlayerAnswer('12 offensive', opts)).toMatchObject({ jersey: '12', off: true });
    expect(parsePlayerAnswer('12 d', opts)).toMatchObject({ off: false });
    expect(parsePlayerAnswer('none', opts)).toEqual({ none: true });
    expect(parsePlayerAnswer('what', opts)).toBeNull();
  });
});

describe('resolveJersey', () => {
  const players = [
    { playerId: 1, side: 'home' as const, jersey: '7', onCourt: true },
    { playerId: 2, side: 'away' as const, jersey: '7', onCourt: true },
    { playerId: 3, side: 'home' as const, jersey: '12', onCourt: false },
    { playerId: 4, side: 'away' as const, jersey: '12', onCourt: true },
    { playerId: 5, side: 'home' as const, jersey: '0', onCourt: true },
  ];
  it('prefers players on court and asks when both teams match', () => {
    expect(resolveJersey('12', undefined, players)).toEqual({ player: players[3] });
    expect(resolveJersey('7', undefined, players)).toEqual({ ambiguous: [players[0], players[1]] });
    expect(resolveJersey('7', 'away', players)).toEqual({ player: players[1] });
    expect(resolveJersey('12', 'home', players)).toEqual({ player: players[2] });
    expect(resolveJersey('12', 'home', players, { onCourtOnly: true })).toEqual({ missing: true });
    expect(resolveJersey('99', undefined, players)).toEqual({ missing: true });
    expect(resolveJersey('00', undefined, players)).toEqual({ missing: true });
  });
});
