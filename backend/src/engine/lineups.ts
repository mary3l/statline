import type { RosterPlayer } from './boxscore.js';
import { FIBA, gameTime } from './fiba.js';
import type { GameEvent, Side } from './types.js';

/** One five-player unit's time together in a game (or a season, once added up). */
export interface LineupUnit {
  side: Side;
  /** Player ids, sorted, so the same five always make the same key. */
  playerIds: number[];
  seconds: number;
  ptsFor: number;
  ptsAgainst: number;
}

export const unitKey = (ids: number[]) => [...ids].sort((a, b) => a - b).join('-');

/**
 * Splits a game into the units each team had on court: how long each unit played,
 * and the points scored for and against it. Built from the starters and substitutions, like minutes and +/-.
 */
export function computeLineups(roster: RosterPlayer[], events: GameEvent[], opts: { final?: boolean } = {}): LineupUnit[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const onCourt: Record<Side, number[]> = { home: [], away: [] };
  for (const r of roster) if (r.starter) onCourt[r.side].push(r.playerId);

  const units = new Map<string, LineupUnit>();
  const unitFor = (side: Side) => {
    const ids = [...onCourt[side]].sort((a, b) => a - b);
    const key = `${side}:${ids.join('-')}`;
    let u = units.get(key);
    if (!u) {
      u = { side, playerIds: ids, seconds: 0, ptsFor: 0, ptsAgainst: 0 };
      units.set(key, u);
    }
    return u;
  };

  let lastTime = 0;
  const runClockTo = (t: number) => {
    if (t <= lastTime) return;
    for (const side of ['home', 'away'] as const) unitFor(side).seconds += t - lastTime;
    lastTime = t;
  };
  const scored = (side: Side, pts: number) => {
    unitFor(side).ptsFor += pts;
    unitFor(side === 'home' ? 'away' : 'home').ptsAgainst += pts;
  };

  for (const e of ordered) {
    runClockTo(gameTime(e.period, e.clock));
    if (!e.side) continue;
    if (e.type === 'shot' && e.made) scored(e.side, e.pts);
    else if (e.type === 'ft' && e.made) scored(e.side, 1);
    else if (e.type === 'sub') {
      const court = onCourt[e.side];
      const i = court.indexOf(e.outId);
      if (i >= 0) court[i] = e.inId;
      else if (!court.includes(e.inId)) court.push(e.inId);
    }
  }
  if (opts.final) {
    const periods = Math.max(FIBA.regulationPeriods, ...ordered.map((e) => e.period));
    runClockTo(gameTime(periods, 0));
  }

  // A unit that never played a second nor saw a point (e.g. the moment between two subs) is noise.
  return [...units.values()].filter((u) => u.seconds > 0 || u.ptsFor > 0 || u.ptsAgainst > 0);
}
