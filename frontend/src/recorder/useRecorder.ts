import { computeBoxScore } from '@engine/boxscore';
import { periodLength } from '@engine/fiba';
import { computeLiveState, type LineupPlayer } from '@engine/live';
import type { GameEvent } from '@engine/types';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { keys } from '../api/queries';
import type { RecorderData, RecorderPlayer } from '../api/types';
import { readJson, uuid, writeJson } from './storage';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A play as the screens build it; the recorder stamps id, seq, period and clock. */
export type NewEvent = DistributiveOmit<GameEvent, 'id' | 'seq' | 'period' | 'clock'>;

/** A change waiting to reach the server, kept in localStorage so a reload or dropped Wi-Fi loses nothing. */
type Op = { kind: 'add'; events: GameEvent[] } | { kind: 'put'; event: GameEvent } | { kind: 'del'; id: string };

export interface SyncState {
  status: 'saved' | 'saving' | 'offline' | 'error';
  pending: number;
  message?: string;
}

export interface RecordOptions {
  /** Reset the shot clock (capped by the game clock). */
  shot?: 24 | 14;
  /** Stop the game clock. */
  stop?: boolean;
  /** Undo can take it back (period markers can't). Default true. */
  undoable?: boolean;
  /** Stamp at another moment than now (period_end at 0:00). */
  at?: { period: number; clock: number };
}

/** Running clocks are stored as the value at `since`, in milliseconds, so stopping and starting never drifts. */
interface ClockCore {
  period: number;
  clockMs: number;
  shotMs: number;
  since: number | null;
}

const UNDO_DEPTH = 30;
const BATCH = 100;
const RETRY_MS = 3000;

/**
 * The server's plays in its order, then this device's unsent changes on top.
 * The server numbers plays as they arrive (several devices may record one game), so unsent plays always come last.
 */
function derive(base: GameEvent[], ops: Op[]): GameEvent[] {
  let list = [...base].sort((a, b) => a.seq - b.seq);
  let next = (list.at(-1)?.seq ?? 0) + 1;
  for (const op of ops) {
    if (op.kind === 'add') {
      const have = new Set(list.map((e) => e.id));
      list = [...list, ...op.events.filter((e) => !have.has(e.id)).map((e) => ({ ...e, seq: next++ }))];
    } else if (op.kind === 'put') list = list.map((e) => (e.id === op.event.id ? { ...op.event, seq: e.seq } : e));
    else list = list.filter((e) => e.id !== op.id);
  }
  return list;
}

function read(c: ClockCore, now = Date.now()) {
  const el = c.since === null ? 0 : now - c.since;
  return { clockMs: Math.max(0, c.clockMs - el), shotMs: Math.max(0, c.shotMs - el) };
}

/** Whole seconds as a scoreboard shows them: 0:00 only once time has really run out. */
const secs = (ms: number) => Math.ceil(ms / 1000);

/** True while nothing but the clock's period markers has been recorded (the lineup can still change). */
export function onlyClockMarkers(events: GameEvent[]) {
  return events.every((e) => e.type === 'period_start' || e.type === 'period_end');
}

export function shortName(p: Pick<RecorderPlayer, 'firstName' | 'lastName'>) {
  return `${p.firstName[0] ?? ''}. ${p.lastName}`;
}

export function useRecorder(data: RecorderData) {
  const gameId = data.game.id;
  const outboxKey = `statline:outbox:${gameId}`;
  const clockKey = `statline:clock:${gameId}`;

  const lineup: LineupPlayer[] = useMemo(
    () =>
      [...data.roster.home, ...data.roster.away]
        .filter((p) => p.dressed)
        .map((p) => ({ playerId: p.playerId, side: p.side, starter: p.starter })),
    [data],
  );
  const players = useMemo(
    () => ({
      home: data.roster.home.filter((p) => p.dressed),
      away: data.roster.away.filter((p) => p.dressed),
    }),
    [data],
  );
  const byId = useMemo(() => new Map([...players.home, ...players.away].map((p) => [p.playerId, p])), [players]);

  // ---- Event list: the server's, plus anything still waiting in the outbox ----
  const [savedOutbox] = useState(() => readJson<Op[]>(outboxKey) ?? []);
  const outboxRef = useRef<Op[]>(savedOutbox);
  const [events, setEvents] = useState(() => derive(data.events, outboxRef.current));
  const eventsRef = useRef(events);
  /** Plays the server confirmed that its latest list (fetched a moment earlier) may not include yet. */
  const acked = useRef(new Map<string, GameEvent>());
  const undoRef = useRef<string[][]>([]);
  const [undoDepth, setUndoDepth] = useState(0);

  const commitEvents = (next: GameEvent[]) => {
    eventsRef.current = next;
    setEvents(next);
  };

  const box = useMemo(() => computeBoxScore(lineup, events), [lineup, events]);
  const live = useMemo(() => computeLiveState(lineup, events), [lineup, events]);

  // ---- Sync ----
  const [sync, setSync] = useState<SyncState>({ status: outboxRef.current.length ? 'saving' : 'saved', pending: outboxRef.current.length });
  const flushing = useRef(false);
  const retryTimer = useRef<number>();
  const alive = useRef(true);

  const persistOutbox = () => writeJson(outboxKey, outboxRef.current.length ? outboxRef.current : null);

  const flush = useCallback(async () => {
    if (flushing.current || !alive.current) return;
    flushing.current = true;
    window.clearTimeout(retryTimer.current);
    try {
      while (outboxRef.current.length && alive.current) {
        const queue = outboxRef.current;
        setSync({ status: 'saving', pending: queue.length });
        const head = queue[0]!;
        let take = 1;
        try {
          if (head.kind === 'add') {
            // Send consecutive additions together.
            const batch = [...head.events];
            while (take < queue.length && queue[take]!.kind === 'add') {
              const next = (queue[take] as Extract<Op, { kind: 'add' }>).events;
              if (batch.length + next.length > BATCH) break;
              batch.push(...next);
              take++;
            }
            const res = await api<{ events: { id: string; seq: number }[] }>(`/games/${gameId}/events`, { method: 'POST', body: { events: batch } });
            const seqOf = new Map(res.events.map((e) => [e.id, e.seq]));
            for (const e of batch) acked.current.set(e.id, { ...e, seq: seqOf.get(e.id) ?? e.seq });
          } else if (head.kind === 'put') {
            await api(`/games/${gameId}/events/${head.event.id}`, { method: 'PUT', body: head.event });
            const a = acked.current.get(head.event.id);
            if (a) acked.current.set(a.id, { ...head.event, seq: a.seq });
          } else {
            await api(`/games/${gameId}/events/${head.id}`, { method: 'DELETE' });
            acked.current.delete(head.id);
          }
        } catch (err) {
          const pending = outboxRef.current.length;
          // Fixing a play another device already deleted: nothing left to do.
          const gone = err instanceof ApiError && err.status === 404 && head.kind !== 'add';
          if (gone) {
            outboxRef.current = outboxRef.current.slice(take);
            persistOutbox();
            continue;
          }
          if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
            const message =
              err.status === 401 ? 'Your sign-in has ended. Sign in again in another tab, then press Retry.' : err.message;
            setSync({ status: 'error', pending, message });
          } else {
            setSync({ status: 'offline', pending });
            retryTimer.current = window.setTimeout(() => void flush(), RETRY_MS);
          }
          return;
        }
        outboxRef.current = outboxRef.current.slice(take);
        persistOutbox();
      }
      setSync({ status: 'saved', pending: 0 });
    } finally {
      flushing.current = false;
    }
  }, [gameId]);

  const enqueue = (op: Op) => {
    outboxRef.current = [...outboxRef.current, op];
    persistOutbox();
    setSync((s) => ({ ...s, status: s.status === 'error' ? 'error' : 'saving', pending: outboxRef.current.length }));
    void flush();
  };

  useEffect(() => {
    alive.current = true;
    void flush();
    const retry = () => void flush();
    window.addEventListener('online', retry);
    const warn = (e: BeforeUnloadEvent) => {
      if (outboxRef.current.length) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      alive.current = false;
      window.clearTimeout(retryTimer.current);
      window.removeEventListener('online', retry);
      window.removeEventListener('beforeunload', warn);
    };
  }, [flush]);

  // ---- Other devices: the live stream says the game changed; fetch it and lay this device's unsent changes on top ----
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/games/${gameId}/stream`);
    let timer: number | undefined;
    es.addEventListener('change', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => qc.invalidateQueries({ queryKey: keys.recorder(gameId) }), 800);
    });
    return () => {
      window.clearTimeout(timer);
      es.close();
    };
  }, [gameId, qc]);

  const shownData = useRef(data);
  useEffect(() => {
    if (shownData.current === data) return;
    shownData.current = data;
    const have = new Set(data.events.map((e) => e.id));
    for (const id of [...acked.current.keys()]) if (have.has(id)) acked.current.delete(id);
    commitEvents(derive([...data.events, ...acked.current.values()], outboxRef.current));
  }, [data]);

  // ---- Clocks ----
  const [initialClock] = useState<ClockCore>(() => {
    const saved = readJson<{ period: number; clock: number; shot: number }>(clockKey);
    if (saved && saved.period >= 1) return { period: saved.period, clockMs: saved.clock * 1000, shotMs: saved.shot * 1000, since: null };
    // No saved clock on this device: pick up where the event list stops.
    const period = Math.max(1, ...data.events.map((e) => e.period));
    const inPeriod = data.events.filter((e) => e.period === period).map((e) => e.clock);
    const clock = inPeriod.length ? Math.min(...inPeriod) : periodLength(period);
    return { period, clockMs: clock * 1000, shotMs: Math.min(24, clock) * 1000, since: null };
  });
  const coreRef = useRef<ClockCore>(initialClock);
  const [, render] = useReducer((n: number) => n + 1, 0);

  const setCore = (next: ClockCore) => {
    coreRef.current = next;
    const r = read(next);
    writeJson(clockKey, { period: next.period, clock: secs(r.clockMs), shot: secs(r.shotMs) });
    render();
  };

  const stopNow = (now = Date.now()) => {
    const c = coreRef.current;
    if (c.since === null) return;
    setCore({ ...c, ...read(c, now), since: null });
  };

  // ---- Recording ----
  const record = useCallback((list: NewEvent[], opts: RecordOptions = {}): string[] => {
    const now = Date.now();
    const c = coreRef.current;
    const r = read(c, now);
    const period = opts.at?.period ?? c.period;
    const clock = opts.at?.clock ?? secs(r.clockMs);
    // Provisional numbers after everything known; the server gives the real ones.
    const last = eventsRef.current.at(-1)?.seq ?? 0;
    const full = list.map((e, i) => ({ ...e, id: uuid(), seq: last + i + 1, period, clock }) as GameEvent);
    commitEvents([...eventsRef.current, ...full]);
    enqueue({ kind: 'add', events: full });
    if (opts.undoable !== false) {
      undoRef.current = [...undoRef.current.slice(-(UNDO_DEPTH - 1)), full.map((e) => e.id)];
      setUndoDepth(undoRef.current.length);
    }
    if (opts.stop) {
      setCore({ ...c, ...r, since: null });
    }
    if (opts.shot) {
      const cc = coreRef.current;
      const el = cc.since === null ? 0 : now - cc.since;
      // Stored relative to `since`, so it reads exactly the reset value now.
      setCore({ ...cc, shotMs: Math.min(opts.shot * 1000, read(cc, now).clockMs) + el });
    }
    return full.map((e) => e.id);
  }, []);

  const update = (event: GameEvent) => {
    commitEvents(eventsRef.current.map((e) => (e.id === event.id ? event : e)));
    enqueue({ kind: 'put', event });
  };

  const remove = (id: string) => {
    if (!eventsRef.current.some((e) => e.id === id)) return;
    commitEvents(eventsRef.current.filter((e) => e.id !== id));
    enqueue({ kind: 'del', id });
  };

  const undo = () => {
    const group = undoRef.current.pop();
    setUndoDepth(undoRef.current.length);
    if (!group) return null;
    const gone = eventsRef.current.filter((e) => group.includes(e.id));
    for (const e of gone) remove(e.id);
    return gone;
  };

  // ---- Clock controls ----
  const startClock = () => {
    const c = coreRef.current;
    if (c.since !== null || c.clockMs <= 0) return;
    const state = computeLiveState(lineup, eventsRef.current);
    if (!state.startedPeriods.has(c.period)) {
      record([{ type: 'period_start', side: null, playerId: null }], { undoable: false });
    }
    // If the shot clock already ran out, a new possession starts with 24.
    const shotMs = c.shotMs <= 0 ? Math.min(24_000, c.clockMs) : c.shotMs;
    setCore({ ...coreRef.current, shotMs, since: Date.now() });
  };

  const toggleClock = () => (coreRef.current.since === null ? startClock() : stopNow());

  const resetShot = (value: 24 | 14) => {
    const c = coreRef.current;
    const now = Date.now();
    const el = c.since === null ? 0 : now - c.since;
    setCore({ ...c, shotMs: Math.min(value * 1000, read(c, now).clockMs) + el });
  };

  /** Moves to another period. Moving on closes the current one at 0:00 (once). */
  const setPeriod = (p: number) => {
    const c = coreRef.current;
    if (p === c.period) return;
    stopNow();
    if (p > c.period) {
      const state = computeLiveState(lineup, eventsRef.current);
      if (!state.endedPeriods.has(c.period)) {
        record([{ type: 'period_end', side: null, playerId: null }], { undoable: false, at: { period: c.period, clock: 0 } });
      }
      setCore({ period: p, clockMs: periodLength(p) * 1000, shotMs: 24_000, since: null });
    } else {
      const clocks = eventsRef.current.filter((e) => e.period === p && e.type !== 'period_end').map((e) => e.clock);
      const clock = clocks.length ? Math.min(...clocks) : periodLength(p);
      setCore({ period: p, clockMs: clock * 1000, shotMs: Math.min(24, clock) * 1000, since: null });
    }
  };

  /** Sets the game clock by hand (stopped), e.g. to match the arena scoreboard. */
  const setClock = (seconds: number) => {
    const c = coreRef.current;
    const clockMs = Math.max(0, Math.min(periodLength(c.period), seconds)) * 1000;
    setCore({ ...c, ...read(c), clockMs, since: null });
  };

  // Tick while running; stop at 0:00 (closing the period) or when the shot clock runs out.
  const running = coreRef.current.since !== null;
  useEffect(() => {
    if (!running) return;
    let lastShown = -1;
    const id = window.setInterval(() => {
      const c = coreRef.current;
      if (c.since === null) return;
      const now = Date.now();
      const r = read(c, now);
      if (r.clockMs <= 0) {
        setCore({ ...c, clockMs: 0, shotMs: r.shotMs, since: null });
        const state = computeLiveState(lineup, eventsRef.current);
        if (!state.endedPeriods.has(c.period)) {
          record([{ type: 'period_end', side: null, playerId: null }], { undoable: false, at: { period: c.period, clock: 0 } });
        }
        return;
      }
      if (r.shotMs <= 0) {
        setCore({ ...c, ...r, shotMs: 0, since: null });
        return;
      }
      const shown = secs(r.clockMs) * 100 + secs(r.shotMs);
      if (shown !== lastShown) {
        lastShown = shown;
        writeJson(clockKey, { period: c.period, clock: secs(r.clockMs), shot: secs(r.shotMs) });
        render();
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [running, lineup]);

  const r = read(coreRef.current);
  const clock = secs(r.clockMs);

  return {
    game: data.game,
    players,
    byId,
    events,
    box,
    live,
    period: coreRef.current.period,
    clock,
    /** Shot clock in whole seconds; null when it is switched off (less game time left than shot time). */
    shot: secs(r.shotMs) > clock ? null : secs(r.shotMs),
    running,
    toggleClock,
    resetShot,
    setPeriod,
    setClock,
    record,
    update,
    remove,
    undo,
    canUndo: undoDepth > 0,
    sync,
    retrySync: () => void flush(),
    /** Throws away the change the server refused, then reloads from the server. */
    discardBlocked: () => {
      outboxRef.current = outboxRef.current.slice(1);
      persistOutbox();
      window.location.reload();
    },
  };
}

export type Recorder = ReturnType<typeof useRecorder>;
