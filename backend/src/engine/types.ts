/**
 * Event schema v1. A game is stored as an ordered list of these; nothing else is stored.
 *
 * Changes from the prototype's schema (README §7):
 * - `playerId` sits beside the jersey number, because a jersey can change between games.
 * - `id` is a UUID generated where the play is recorded, plus a per-game `seq` for ordering.
 * - timeout is `timeout` (the prototype used `to`, too close to turnover `tov`).
 * - `blk` can point to the shot it blocked; period_start / period_end mark the clock edges.
 */

export type Side = 'home' | 'away';

export type FoulKind = 'personal' | 'shoot2' | 'shoot3' | 'and1' | 'offensive' | 'unsport';

interface Base {
  id: string;
  seq: number;
  period: number;
  /** Seconds left on the game clock. */
  clock: number;
  side: Side | null;
  playerId: number | null;
}

export type GameEvent =
  | (Base & {
      type: 'shot';
      pts: 2 | 3;
      made: boolean;
      /** Court spot from 0 to 1 (x across the baseline, y from the baseline to half court); null when entered by voice. */
      x: number | null;
      y: number | null;
    })
  | (Base & { type: 'ft'; made: boolean })
  /** playerId null = team rebound */
  | (Base & { type: 'reb'; off: boolean })
  | (Base & { type: 'ast' })
  | (Base & { type: 'stl' })
  | (Base & { type: 'blk'; shotId?: string })
  | (Base & { type: 'tov' })
  | (Base & { type: 'fd' })
  | (Base & { type: 'pf'; kind: FoulKind })
  | (Base & { type: 'sub'; outId: number; inId: number })
  | (Base & { type: 'timeout' })
  | (Base & { type: 'period_start' })
  | (Base & { type: 'period_end' });

export type EventType = GameEvent['type'];

export const EVENT_TYPES: readonly EventType[] = [
  'shot',
  'ft',
  'reb',
  'ast',
  'stl',
  'blk',
  'tov',
  'fd',
  'pf',
  'sub',
  'timeout',
  'period_start',
  'period_end',
];

/** Splits an event into the columns stored in the `events` table and its type-specific `details`. */
export function toRow(e: GameEvent) {
  const { id, seq, period, clock, side, playerId, type, ...details } = e;
  return { id, seq, period, clock, side, playerId, type, details: details as Record<string, unknown> };
}

export function fromRow(row: {
  id: string;
  seq: number;
  period: number;
  clock: number;
  side: Side | null;
  playerId: number | null;
  type: string;
  details: Record<string, unknown>;
}): GameEvent {
  if (!EVENT_TYPES.includes(row.type as EventType)) throw new Error(`Unknown event type ${row.type}`);
  return {
    ...row.details,
    id: row.id,
    seq: row.seq,
    period: row.period,
    clock: row.clock,
    side: row.side,
    playerId: row.playerId,
    type: row.type,
  } as GameEvent;
}
