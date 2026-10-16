/**
 * Plays out a whole game possession by possession and returns its event list,
 * so the demo box scores, leaders and standings come out of the real engine.
 * The numbers are made up; they only need to look like basketball.
 */
import { COURT, isBeyondArc } from '../engine/court.js';
import { FIBA, periodLength } from '../engine/fiba.js';
import type { FoulKind, GameEvent, Side } from '../engine/types.js';
import type { Rng } from './rng.js';

type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

export interface SimPlayer {
  playerId: number;
  position: Position;
  /** Roughly 0.8 (deep bench) to 1.25 (star). */
  skill: number;
}

export interface SimTeam {
  /** First five are the starters. */
  players: SimPlayer[];
}

interface Profile {
  usage: number;
  three: number;
  fg2: number;
  fg3: number;
  ft: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  paint: number;
}

const PROFILES: Record<Position, Profile> = {
  PG: { usage: 1.0, three: 0.4, fg2: 0.47, fg3: 0.33, ft: 0.78, reb: 0.5, ast: 2.4, stl: 1.3, blk: 0.2, paint: 0.35 },
  SG: { usage: 1.1, three: 0.45, fg2: 0.46, fg3: 0.35, ft: 0.8, reb: 0.6, ast: 1.1, stl: 1.1, blk: 0.3, paint: 0.35 },
  SF: { usage: 1.0, three: 0.3, fg2: 0.48, fg3: 0.32, ft: 0.74, reb: 0.9, ast: 0.8, stl: 1.0, blk: 0.6, paint: 0.45 },
  PF: { usage: 0.9, three: 0.15, fg2: 0.51, fg3: 0.3, ft: 0.68, reb: 1.4, ast: 0.6, stl: 0.8, blk: 1.1, paint: 0.6 },
  C: { usage: 0.85, three: 0.03, fg2: 0.55, fg3: 0.25, ft: 0.6, reb: 1.8, ast: 0.5, stl: 0.6, blk: 1.8, paint: 0.75 },
};

type EventInput = { type: GameEvent['type']; side: Side | null; playerId: number | null } & Record<string, unknown>;

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

export function simulateGame(rng: Rng, teams: Record<Side, SimTeam>): GameEvent[] {
  const events: GameEvent[] = [];
  let seq = 0;
  let period = 1;
  let clock = periodLength(1);

  const roster = { home: teams.home.players, away: teams.away.players };
  const onCourt: Record<Side, SimPlayer[]> = { home: roster.home.slice(0, 5), away: roster.away.slice(0, 5) };
  const stint = new Map<number, number>();
  const played = new Map<number, number>();
  const fouls = new Map<number, number>();
  const teamFouls: Record<Side, number> = { home: 0, away: 0 };
  const timeoutsLeft: Record<Side, number> = { home: 2, away: 2 };
  const score: Record<Side, number> = { home: 0, away: 0 };

  const prof = (p: SimPlayer) => PROFILES[p.position];
  const starters = new Set([...roster.home.slice(0, 5), ...roster.away.slice(0, 5)].map((p) => p.playerId));

  const emit = (e: EventInput) => {
    const ev = { id: rng.uuid(), seq: ++seq, period, clock, ...e } as GameEvent;
    events.push(ev);
    return ev;
  };

  const run = (dt: number) => {
    const used = Math.min(dt, clock);
    clock -= used;
    for (const side of ['home', 'away'] as const) {
      for (const p of onCourt[side]) {
        stint.set(p.playerId, (stint.get(p.playerId) ?? 0) + used);
        played.set(p.playerId, (played.get(p.playerId) ?? 0) + used);
      }
    }
  };

  const available = (side: Side) =>
    roster[side].filter((p) => (fouls.get(p.playerId) ?? 0) < FIBA.foulOutAt && !onCourt[side].includes(p));

  const substitute = (side: Side, out: SimPlayer) => {
    const bench = available(side);
    if (!bench.length) return;
    // The fresh player is whoever is furthest below their share of the minutes.
    const target = (p: SimPlayer) => (starters.has(p.playerId) ? 1 : 0.5) * p.skill;
    const inc = bench.reduce((best, p) =>
      (played.get(p.playerId) ?? 0) / target(p) < (played.get(best.playerId) ?? 0) / target(best) ? p : best,
    );
    emit({ type: 'sub', side, playerId: null, outId: out.playerId, inId: inc.playerId });
    onCourt[side] = onCourt[side].map((p) => (p === out ? inc : p));
    stint.set(inc.playerId, 0);
  };

  const rotate = () => {
    for (const side of ['home', 'away'] as const) {
      if (!rng.chance(0.45)) continue;
      const limit = (p: SimPlayer) => (starters.has(p.playerId) ? 420 : 210) * p.skill;
      const tired = onCourt[side].reduce((a, b) => ((stint.get(a.playerId) ?? 0) / limit(a) >= (stint.get(b.playerId) ?? 0) / limit(b) ? a : b));
      if ((stint.get(tired.playerId) ?? 0) > limit(tired)) substitute(side, tired);
    }
  };

  const foul = (side: Side, fouler: SimPlayer, kind: FoulKind, fouled: SimPlayer | null) => {
    emit({ type: 'pf', side, playerId: fouler.playerId, kind });
    if (fouled) emit({ type: 'fd', side: other(side), playerId: fouled.playerId });
    if (kind !== 'offensive') teamFouls[side]++;
    const n = (fouls.get(fouler.playerId) ?? 0) + 1;
    fouls.set(fouler.playerId, n);
    return n >= FIBA.foulOutAt;
  };

  const pickBy = (side: Side, weight: (p: SimPlayer) => number, except?: SimPlayer) =>
    rng.weighted(
      onCourt[side].filter((p) => p !== except),
      (p) => weight(p) * p.skill,
    );

  const scored = (side: Side, pts: number) => {
    score[side] += pts;
  };

  /** Free throws one at a time; returns whether the last one went in. */
  const freeThrows = (side: Side, shooter: SimPlayer, n: number) => {
    let made = false;
    for (let i = 0; i < n; i++) {
      made = rng.chance(Math.min(0.95, prof(shooter).ft * (0.9 + shooter.skill * 0.1)));
      emit({ type: 'ft', side, playerId: shooter.playerId, made });
      if (made) scored(side, 1);
    }
    return made;
  };

  const shotSpot = (shooter: SimPlayer, three: boolean) => {
    for (let tries = 0; tries < 50; tries++) {
      let mx: number;
      let my: number;
      if (three) {
        if (rng.chance(0.22)) {
          mx = rng.chance(0.5) ? rng.range(0.25, 0.85) : rng.range(14.15, 14.75);
          my = rng.range(0.3, 2.9);
        } else {
          const a = rng.range(0.12 * Math.PI, 0.88 * Math.PI);
          const r = rng.range(6.95, 8.3);
          mx = COURT.basket.x + r * Math.cos(a);
          my = COURT.basket.y + r * Math.sin(a);
        }
      } else if (rng.chance(prof(shooter).paint)) {
        mx = COURT.basket.x + rng.range(-2.3, 2.3) * rng.next();
        my = rng.range(0.4, 5.6) * (0.4 + 0.6 * rng.next());
      } else {
        const a = rng.range(0.05 * Math.PI, 0.95 * Math.PI);
        const r = rng.range(2.6, 6.5);
        mx = COURT.basket.x + r * Math.cos(a);
        my = COURT.basket.y + r * Math.sin(a);
      }
      if (mx < 0.2 || mx > 14.8 || my < 0.2 || my > 13.5) continue;
      if (isBeyondArc(mx, my) !== three) continue;
      return { x: Math.round((mx / COURT.width) * 1000) / 1000, y: Math.round((my / COURT.length) * 1000) / 1000 };
    }
    return { x: null, y: null };
  };

  /** Rebound after a miss. Returns true when the shooting side keeps the ball. */
  const rebound = (off: Side, offChance: number) => {
    const offensive = rng.chance(offChance);
    const side = offensive ? off : other(off);
    if (rng.chance(0.06)) {
      emit({ type: 'reb', side, playerId: null, off: offensive });
    } else {
      const p = pickBy(side, (x) => prof(x).reb);
      emit({ type: 'reb', side, playerId: p.playerId, off: offensive });
    }
    return offensive;
  };

  const afterFoul = (side: Side, fouler: SimPlayer, fouledOut: boolean) => {
    if (fouledOut) substitute(side, fouler);
    rotate();
  };

  /** One possession; returns when the ball changes hands or the period ends. */
  const possession = (off: Side) => {
    const def = other(off);
    let afterOffReb = false;

    while (true) {
      if (clock <= 0) return;
      run(afterOffReb ? rng.int(3, 10) : rng.int(8, 22));
      if (clock <= 0 && rng.chance(0.6)) return;
      afterOffReb = false;
      const r = rng.next();

      if (r < 0.004) {
        const fouler = pickBy(def, () => 1);
        const fouled = pickBy(off, (p) => prof(p).usage);
        const out = foul(def, fouler, 'unsport', fouled);
        freeThrows(off, fouled, 2);
        afterFoul(def, fouler, out);
        continue; // unsportsmanlike: shots plus possession
      }

      if (r < 0.13) {
        const loser = pickBy(off, (p) => prof(p).usage);
        if (rng.chance(0.12)) {
          const drawn = pickBy(def, () => 1);
          const out = foul(off, loser, 'offensive', drawn);
          emit({ type: 'tov', side: off, playerId: loser.playerId });
          afterFoul(off, loser, out);
        } else {
          if (rng.chance(0.55)) emit({ type: 'stl', side: def, playerId: pickBy(def, (p) => prof(p).stl).playerId });
          emit({ type: 'tov', side: off, playerId: loser.playerId });
        }
        return;
      }

      if (r < 0.2) {
        const fouler = pickBy(def, () => 1);
        const fouled = pickBy(off, (p) => prof(p).usage);
        const inPenalty = teamFouls[def] >= FIBA.teamFoulPenaltyAt;
        const out = foul(def, fouler, 'personal', fouled);
        afterFoul(def, fouler, out);
        if (!inPenalty) continue; // side-line throw-in, same possession
        if (freeThrows(off, fouled, 2)) return;
        if (rebound(off, 0.15)) {
          afterOffReb = true;
          continue;
        }
        return;
      }

      const shooter = pickBy(off, (p) => prof(p).usage);
      const p = prof(shooter);
      const three = rng.chance(p.three);
      const pct = (three ? p.fg3 : p.fg2) * (0.85 + shooter.skill * 0.15);
      const spot = shotSpot(shooter, three);

      if (rng.chance(0.09)) {
        const fouler = pickBy(def, () => 1);
        const made = rng.chance(pct * 0.45);
        if (made) {
          emit({ type: 'shot', side: off, playerId: shooter.playerId, pts: three ? 3 : 2, made: true, ...spot });
          scored(off, three ? 3 : 2);
        }
        const out = foul(def, fouler, made ? 'and1' : three ? 'shoot3' : 'shoot2', shooter);
        const lastMade = freeThrows(off, shooter, made ? 1 : three ? 3 : 2);
        afterFoul(def, fouler, out);
        if (lastMade) return;
        if (rebound(off, 0.15)) {
          afterOffReb = true;
          continue;
        }
        return;
      }

      const made = rng.chance(pct);
      const shot = emit({ type: 'shot', side: off, playerId: shooter.playerId, pts: three ? 3 : 2, made, ...spot });
      if (made) {
        scored(off, three ? 3 : 2);
        if (rng.chance(three ? 0.8 : 0.55)) {
          emit({ type: 'ast', side: off, playerId: pickBy(off, (x) => prof(x).ast, shooter).playerId });
        }
        return;
      }
      if (!three && rng.chance(0.1)) {
        emit({ type: 'blk', side: def, playerId: pickBy(def, (x) => prof(x).blk).playerId, shotId: shot.id });
      }
      if (rebound(off, 0.27)) {
        afterOffReb = true;
        continue;
      }
      return;
    }
  };

  let possessionSide: Side = rng.chance(0.5) ? 'home' : 'away';

  while (true) {
    clock = periodLength(period);
    if (period === 3) {
      timeoutsLeft.home = 3;
      timeoutsLeft.away = 3;
    } else if (period > FIBA.regulationPeriods) {
      timeoutsLeft.home = 1;
      timeoutsLeft.away = 1;
    }
    // Team fouls reset each quarter; overtime carries on from Q4.
    if (period <= FIBA.regulationPeriods) {
      teamFouls.home = 0;
      teamFouls.away = 0;
    }
    emit({ type: 'period_start', side: null, playerId: null });
    if (period > 1) rotate();

    while (clock > 0) {
      possession(possessionSide);
      possessionSide = other(possessionSide);
      if (clock > 0 && rng.chance(0.03) && timeoutsLeft[possessionSide] > 0) {
        timeoutsLeft[possessionSide]--;
        emit({ type: 'timeout', side: possessionSide, playerId: null });
        rotate();
      } else if (rng.chance(0.25)) {
        rotate();
      }
    }
    clock = 0;
    emit({ type: 'period_end', side: null, playerId: null });

    if (period >= FIBA.regulationPeriods && score.home !== score.away) break;
    if (period >= FIBA.regulationPeriods + 4) {
      // Practically never happens; settle it so the demo data always has a winner.
      const side = rng.chance(0.5) ? 'home' : 'away';
      const shooter = onCourt[side][0]!;
      emit({ type: 'ft', side, playerId: shooter.playerId, made: true });
      break;
    }
    period++;
  }

  return events;
}
