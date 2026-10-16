import { describe, expect, it } from 'vitest';
import { ageGroup, eligibility, leagueIneligibility } from './ageGroup.js';
import { computeStandings, type StandingsGame } from './standings.js';

const g = (homeTeamId: number, awayTeamId: number, homeScore: number, awayScore: number, forfeitedBy: StandingsGame['forfeitedBy'] = null) => ({
  homeTeamId,
  awayTeamId,
  homeScore,
  awayScore,
  forfeitedBy,
});

describe('computeStandings', () => {
  it('gives 2 points per win, 1 per loss and 0 for a forfeit loss', () => {
    const rows = computeStandings([1, 2], [g(1, 2, 70, 60), g(2, 1, 20, 0, 'away')]);
    expect(rows.find((r) => r.teamId === 1)).toMatchObject({ w: 1, l: 1, forfeits: 1, pts: 2 });
    expect(rows.find((r) => r.teamId === 2)).toMatchObject({ w: 1, l: 1, pts: 3 });
    expect(rows[0]!.teamId).toBe(2);
  });

  it('breaks ties on head-to-head before overall point difference', () => {
    // 1, 2 and 3 all go 2–1 against each other plus a win over 4.
    // Team 3 has the best overall difference (it crushed 4), but loses the head-to-head mini-table.
    const rows = computeStandings(
      [1, 2, 3, 4],
      [
        g(1, 2, 80, 70), // 1 +10
        g(2, 3, 80, 70), // 2 +10
        g(3, 1, 72, 70), // 3 +2
        g(1, 4, 61, 60),
        g(2, 4, 61, 60),
        g(3, 4, 100, 50),
      ],
    );
    // Head-to-head diff: 1 = +8, 2 = 0, 3 = −8.
    expect(rows.map((r) => r.teamId)).toEqual([1, 2, 3, 4]);
  });
});

describe('age groups', () => {
  it('uses the age reached in the season year', () => {
    expect(ageGroup('2002-03-14', 2026)).toBe('Open');
    expect(ageGroup('2008-12-31', 2026)).toBe('U18');
    expect(ageGroup('2007-01-01', 2026)).toBe('Open');
    expect(ageGroup('2014-09-09', 2026)).toBe('U12');
    expect(ageGroup('1991-06-01', 2026)).toBe('Masters 35+');
  });

  it('lists eligibility like the prototype profile', () => {
    const rows = eligibility('2002-03-14', 2026);
    expect(rows.filter((r) => r.eligible).map((r) => r.group)).toEqual(['Open']);
    expect(eligibility('2013-05-05', 2026).filter((r) => r.eligible).map((r) => r.group)).toEqual(['U14', 'U16', 'U18', 'Open']);
  });

  it('checks league rules', () => {
    const youth = { gender: null, minAge: null, maxAge: 18 };
    expect(leagueIneligibility({ birthdate: '2008-01-01', gender: 'M' }, youth, 2026)).toBeNull();
    expect(leagueIneligibility({ birthdate: '2007-12-31', gender: 'M' }, youth, 2026)).toMatch(/18 or younger/);
    expect(leagueIneligibility({ birthdate: '2000-01-01', gender: 'M' }, { gender: 'F', minAge: null, maxAge: null }, 2026)).toMatch(
      /women/,
    );
  });
});
