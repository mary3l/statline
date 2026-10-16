import { FIBA } from './fiba.js';

export interface StandingsGame {
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
  /** Side that forfeited, if the game was a forfeit. */
  forfeitedBy: 'home' | 'away' | null;
}

export interface StandingsRow {
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
}

interface Tally {
  gp: number;
  w: number;
  l: number;
  forfeits: number;
  pf: number;
  pa: number;
  pts: number;
}

function tally(teamIds: number[], games: StandingsGame[]): Map<number, Tally> {
  const t = new Map<number, Tally>(teamIds.map((id) => [id, { gp: 0, w: 0, l: 0, forfeits: 0, pf: 0, pa: 0, pts: 0 }]));
  for (const g of games) {
    const home = t.get(g.homeTeamId);
    const away = t.get(g.awayTeamId);
    if (!home || !away) continue;
    const homeWon = g.homeScore > g.awayScore;
    const sides = [
      [home, g.homeScore, g.awayScore, homeWon, g.forfeitedBy === 'home'],
      [away, g.awayScore, g.homeScore, !homeWon, g.forfeitedBy === 'away'],
    ] as const;
    for (const [row, forScore, againstScore, won, forfeited] of sides) {
      row.gp++;
      row.pf += forScore;
      row.pa += againstScore;
      if (won) {
        row.w++;
        row.pts += FIBA.standingPoints.win;
      } else {
        row.l++;
        if (forfeited) {
          row.forfeits++;
          row.pts += FIBA.standingPoints.forfeitLoss;
        } else {
          row.pts += FIBA.standingPoints.loss;
        }
      }
    }
  }
  return t;
}

/**
 * Orders teams by standing points (2 per win, 1 per loss, 0 per forfeit loss).
 * Ties are broken FIBA-style using only the games between the tied teams:
 * their standing points, then point difference, then points scored;
 * then overall point difference and overall points scored.
 * (FIBA re-applies the criteria to any smaller group still tied; this applies them once.)
 */
export function computeStandings(teamIds: number[], games: StandingsGame[]): StandingsRow[] {
  const overall = tally(teamIds, games);

  const byPts = new Map<number, number[]>();
  for (const id of teamIds) {
    const pts = overall.get(id)!.pts;
    byPts.set(pts, [...(byPts.get(pts) ?? []), id]);
  }

  const ordered: number[] = [];
  for (const pts of [...byPts.keys()].sort((a, b) => b - a)) {
    const group = byPts.get(pts)!;
    if (group.length === 1) {
      ordered.push(group[0]!);
      continue;
    }
    const inGroup = new Set(group);
    const h2h = tally(
      group,
      games.filter((g) => inGroup.has(g.homeTeamId) && inGroup.has(g.awayTeamId)),
    );
    group.sort((a, b) => {
      const ha = h2h.get(a)!;
      const hb = h2h.get(b)!;
      const oa = overall.get(a)!;
      const ob = overall.get(b)!;
      return (
        hb.pts - ha.pts ||
        hb.pf - hb.pa - (ha.pf - ha.pa) ||
        hb.pf - ha.pf ||
        ob.pf - ob.pa - (oa.pf - oa.pa) ||
        ob.pf - oa.pf ||
        a - b
      );
    });
    ordered.push(...group);
  }

  return ordered.map((teamId, i) => {
    const r = overall.get(teamId)!;
    return { rank: i + 1, teamId, ...r, diff: r.pf - r.pa };
  });
}
