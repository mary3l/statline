import { and, count, eq, inArray, isNull, max, notInArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HttpError } from '../app.js';
import type { DB } from '../db/index.js';
import { schema } from '../db/index.js';
import { periodLength } from '../engine/fiba.js';
import { toRow, type GameEvent, type Side } from '../engine/types.js';
import { buildBoxScore, loadEvents, recomputeGame } from '../services/games.js';
import { gameQuery, shapeGame } from './games.js';

const { events, gameParticipants, games, players, rosterEntries } = schema;

const idParams = z.object({ id: z.coerce.number().int().positive() });
/** First key of the per-game advisory lock taken while numbering new plays. */
const ADVISORY_EVENTS = 7301;
const eventParams = idParams.extend({ eventId: z.string().uuid() });

const side = z.enum(['home', 'away']);
const coord = z.number().min(0).max(1).nullable();
const base = {
  id: z.string().uuid(),
  /** Ignored when adding: the server numbers plays as they arrive. */
  seq: z.number().int().positive(),
  period: z.number().int().min(1).max(14),
  clock: z.number().int().min(0).max(600),
  side: side.nullable(),
  playerId: z.number().int().positive().nullable(),
};
const plain = (type: 'ast' | 'stl' | 'tov' | 'fd' | 'timeout' | 'period_start' | 'period_end') =>
  z.object({ ...base, type: z.literal(type) });

/** Event schema v1 (engine/types.ts). Unknown fields are dropped. */
const eventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('shot'), pts: z.union([z.literal(2), z.literal(3)]), made: z.boolean(), x: coord, y: coord }),
  z.object({ ...base, type: z.literal('ft'), made: z.boolean() }),
  z.object({ ...base, type: z.literal('reb'), off: z.boolean() }),
  z.object({ ...base, type: z.literal('blk'), shotId: z.string().uuid().optional() }),
  z.object({ ...base, type: z.literal('pf'), kind: z.enum(['personal', 'shoot2', 'shoot3', 'and1', 'offensive', 'unsport']) }),
  z.object({ ...base, type: z.literal('sub'), outId: z.number().int().positive(), inId: z.number().int().positive() }),
  plain('ast'),
  plain('stl'),
  plain('tov'),
  plain('fd'),
  plain('timeout'),
  plain('period_start'),
  plain('period_end'),
]);

/** Plays credited to one player: side and player are required. */
const PLAYER_TYPES = new Set(['shot', 'ft', 'ast', 'stl', 'blk', 'tov', 'fd', 'pf']);

type Participants = Map<number, Side>;

async function loadGame(db: DB, id: number) {
  const [game] = await db.select().from(games).where(eq(games.id, id));
  if (!game) throw new HttpError(404, 'Game not found.');
  return game;
}

/** Plays recorded so far, not counting the clock's period markers (which only mean the clock ran). */
async function countPlays(db: DB, gameId: number): Promise<number> {
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(events)
    .where(and(eq(events.gameId, gameId), isNull(events.deletedAt), notInArray(events.type, ['period_start', 'period_end'])));
  return n;
}

async function participantSides(db: DB, gameId: number): Promise<Participants> {
  const rows = await db
    .select({ playerId: gameParticipants.playerId, side: gameParticipants.side })
    .from(gameParticipants)
    .where(eq(gameParticipants.gameId, gameId));
  return new Map(rows.map((r) => [r.playerId, r.side]));
}

/** Checks the parts of an event the schema can't: clock range, and that every player dressed for that side. */
function checkEvent(e: GameEvent, sides: Participants) {
  const fail = (msg: string): never => {
    throw new HttpError(400, msg, { eventId: e.id });
  };
  if (e.clock > periodLength(e.period)) fail('The clock is past the length of the period.');
  const onSide = (id: number, s: Side) => sides.get(id) === s;

  if (e.type === 'period_start' || e.type === 'period_end') {
    if (e.side !== null || e.playerId !== null) fail('Period markers have no team or player.');
    return;
  }
  if (!e.side) return fail('Pick the team for this play.');
  if (PLAYER_TYPES.has(e.type) && e.playerId === null) fail('Pick the player for this play.');
  if ((e.type === 'timeout' || e.type === 'sub') && e.playerId !== null) fail('Timeouts and substitutions have no single player.');
  if (e.playerId !== null && !onSide(e.playerId, e.side)) fail('That player is not dressed for this team.');
  if (e.type === 'sub') {
    if (e.outId === e.inId) fail('A player cannot substitute for themself.');
    if (!onSide(e.outId, e.side) || !onSide(e.inId, e.side)) fail('Both players in a substitution must be dressed for the team.');
  }
}

function requireStatus(game: { status: string }, allowed: string[], message: string) {
  if (!allowed.includes(game.status)) throw new HttpError(409, message);
}

/**
 * Courtside recording: set up who dressed, then append, fix and delete plays while the game is live.
 * The event list stays the only source of truth; every write recomputes the game's cached score.
 */
export const recorderRoutes: FastifyPluginAsyncZod = async (app) => {
  const canRecord = app.requireRole('admin', 'organizer', 'scorer');

  app.get('/:id/recorder', { onRequest: canRecord, schema: { params: idParams } }, async (req) => {
    const db = app.db;
    const [row] = await gameQuery(db).where(eq(games.id, req.params.id));
    if (!row) throw new HttpError(404, 'Game not found.');
    const game = await loadGame(db, row.id);
    const sideOfTeam = new Map<number, Side>([
      [game.homeTeamId, 'home'],
      [game.awayTeamId, 'away'],
    ]);

    const [rostered, dressed, evts, [seqRow]] = await Promise.all([
      db
        .select({
          playerId: rosterEntries.playerId,
          teamId: rosterEntries.teamId,
          jersey: rosterEntries.jersey,
          firstName: players.firstName,
          lastName: players.lastName,
          position: players.position,
          status: players.status,
        })
        .from(rosterEntries)
        .innerJoin(players, eq(players.id, rosterEntries.playerId))
        .where(
          and(
            inArray(rosterEntries.teamId, [game.homeTeamId, game.awayTeamId]),
            eq(rosterEntries.seasonId, game.seasonId),
            isNull(rosterEntries.leftOn),
          ),
        ),
      db
        .select({
          playerId: gameParticipants.playerId,
          side: gameParticipants.side,
          jersey: gameParticipants.jersey,
          starter: gameParticipants.starter,
          firstName: players.firstName,
          lastName: players.lastName,
          position: players.position,
          status: players.status,
        })
        .from(gameParticipants)
        .innerJoin(players, eq(players.id, gameParticipants.playerId))
        .where(eq(gameParticipants.gameId, game.id)),
      loadEvents(db, game.id),
      // Deleted plays keep their seq, so the next one must come after them too.
      db.select({ last: max(events.seq) }).from(events).where(eq(events.gameId, game.id)),
    ]);

    // Everyone who dressed, then the rest of each team's current roster (for the lineup screen).
    const out = new Map<number, { playerId: number; side: Side; jersey: string; firstName: string; lastName: string; position: string; status: string; dressed: boolean; starter: boolean }>();
    for (const p of dressed) out.set(p.playerId, { ...p, dressed: true });
    for (const r of rostered) {
      if (out.has(r.playerId)) continue;
      out.set(r.playerId, { ...r, side: sideOfTeam.get(r.teamId)!, dressed: false, starter: false });
    }
    const byJersey = (a: { jersey: string }, b: { jersey: string }) => Number(a.jersey) - Number(b.jersey) || a.jersey.localeCompare(b.jersey);
    const list = [...out.values()];

    return {
      game: shapeGame(row),
      roster: {
        home: list.filter((p) => p.side === 'home').sort(byJersey),
        away: list.filter((p) => p.side === 'away').sort(byJersey),
      },
      events: evts,
      nextSeq: (seqRow?.last ?? 0) + 1,
    };
  });

  app.post(
    '/:id/start',
    {
      onRequest: canRecord,
      schema: {
        params: idParams,
        body: z.object({
          participants: z
            .array(z.object({ playerId: z.number().int().positive(), side, starter: z.boolean() }))
            .min(10)
            .max(60),
        }),
      },
    },
    async (req) => {
      const db = app.db;
      const game = await loadGame(db, req.params.id);
      if (!(game.status === 'scheduled' || (game.status === 'live' && (await countPlays(db, game.id)) === 0))) {
        throw new HttpError(409, 'The lineup can only be changed before the first play is recorded.');
      }

      const list = req.body.participants;
      if (new Set(list.map((p) => p.playerId)).size !== list.length) throw new HttpError(400, 'A player is listed twice.');

      const teamFor: Record<Side, number> = { home: game.homeTeamId, away: game.awayTeamId };
      const rostered = await db
        .select({ playerId: rosterEntries.playerId, teamId: rosterEntries.teamId, jersey: rosterEntries.jersey, status: players.status, lastName: players.lastName })
        .from(rosterEntries)
        .innerJoin(players, eq(players.id, rosterEntries.playerId))
        .where(
          and(
            inArray(rosterEntries.teamId, [game.homeTeamId, game.awayTeamId]),
            eq(rosterEntries.seasonId, game.seasonId),
            isNull(rosterEntries.leftOn),
          ),
        );
      const entry = new Map(rostered.map((r) => [r.playerId, r]));

      for (const s of ['home', 'away'] as const) {
        const mine = list.filter((p) => p.side === s);
        const label = s === 'home' ? 'The home team' : 'The away team';
        if (mine.length < 5) throw new HttpError(400, `${label} needs at least 5 players.`);
        if (mine.filter((p) => p.starter).length !== 5) throw new HttpError(400, `${label} needs exactly 5 starters.`);
        for (const p of mine) {
          const r = entry.get(p.playerId);
          if (!r || r.teamId !== teamFor[s]) throw new HttpError(400, `${label} roster doesn't include player ${p.playerId}.`);
          if (r.status === 'suspended') throw new HttpError(400, `${r.lastName} is suspended and can't play.`);
        }
      }

      await db.transaction(async (tx) => {
        await tx.delete(gameParticipants).where(eq(gameParticipants.gameId, game.id));
        await tx.insert(gameParticipants).values(
          list.map((p) => ({ gameId: game.id, playerId: p.playerId, side: p.side, starter: p.starter, jersey: entry.get(p.playerId)!.jersey })),
        );
        await tx.update(games).set({ status: 'live' }).where(eq(games.id, game.id));
      });
      await recomputeGame(db, game.id);
      return { ok: true };
    },
  );

  app.post(
    '/:id/participants',
    {
      onRequest: canRecord,
      schema: { params: idParams, body: z.object({ playerId: z.number().int().positive(), side }) },
    },
    async (req) => {
      const db = app.db;
      const game = await loadGame(db, req.params.id);
      requireStatus(game, ['live'], 'Players can only be added to a live game.');
      const { playerId, side: s } = req.body;
      const teamId = s === 'home' ? game.homeTeamId : game.awayTeamId;
      const [r] = await db
        .select({ jersey: rosterEntries.jersey, status: players.status, lastName: players.lastName })
        .from(rosterEntries)
        .innerJoin(players, eq(players.id, rosterEntries.playerId))
        .where(
          and(
            eq(rosterEntries.playerId, playerId),
            eq(rosterEntries.teamId, teamId),
            eq(rosterEntries.seasonId, game.seasonId),
            isNull(rosterEntries.leftOn),
          ),
        );
      if (!r) throw new HttpError(400, 'That player is not on this team’s roster.');
      if (r.status === 'suspended') throw new HttpError(400, `${r.lastName} is suspended and can't play.`);
      // Arrived late: dressed from now on, starting on the bench. Already listed = nothing to do.
      await db
        .insert(gameParticipants)
        .values({ gameId: game.id, playerId, side: s, jersey: r.jersey, starter: false })
        .onConflictDoNothing();
      return { ok: true };
    },
  );

  app.post(
    '/:id/events',
    {
      onRequest: canRecord,
      schema: { params: idParams, body: z.object({ events: z.array(eventSchema).min(1).max(100) }) },
    },
    async (req) => {
      const db = app.db;
      const game = await loadGame(db, req.params.id);
      requireStatus(game, ['live'], 'Plays can only be added while the game is live.');
      const evts = req.body.events as GameEvent[];
      const sides = await participantSides(db, game.id);
      for (const e of evts) checkEvent(e, sides);

      // The server numbers plays in the order they arrive, so several devices can record one game.
      // A per-game lock keeps two requests from taking the same numbers; re-sent plays (same id) keep theirs.
      const saved = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_EVENTS}, ${game.id})`);
        const ids = evts.map((e) => e.id);
        const existing = await tx
          .select({ id: events.id, seq: events.seq, gameId: events.gameId })
          .from(events)
          .where(inArray(events.id, ids));
        if (existing.some((r) => r.gameId !== game.id)) throw new HttpError(409, 'A play with that id belongs to another game.');
        const seqOf = new Map(existing.map((r) => [r.id, r.seq]));
        const [{ last } = { last: 0 }] = await tx.select({ last: max(events.seq) }).from(events).where(eq(events.gameId, game.id));
        let next = (last ?? 0) + 1;
        const fresh = evts.filter((e) => !seqOf.has(e.id));
        for (const e of fresh) seqOf.set(e.id, next++);
        if (fresh.length) {
          await tx.insert(events).values(fresh.map((e) => ({ ...toRow({ ...e, seq: seqOf.get(e.id)! }), gameId: game.id, createdBy: req.user.sub })));
        }
        return evts.map((e) => ({ id: e.id, seq: seqOf.get(e.id)! }));
      });
      await recomputeGame(db, game.id);
      return { saved: saved.length, events: saved };
    },
  );

  app.put(
    '/:id/events/:eventId',
    { onRequest: canRecord, schema: { params: eventParams, body: eventSchema } },
    async (req) => {
      const db = app.db;
      const game = await loadGame(db, req.params.id);
      requireStatus(game, ['live', 'final'], 'Plays can only be fixed in a live or finished game.');
      const e = req.body as GameEvent;
      if (e.id !== req.params.eventId) throw new HttpError(400, 'The play id does not match the address.');

      const [existing] = await db
        .select({ type: events.type, seq: events.seq })
        .from(events)
        .where(and(eq(events.id, e.id), eq(events.gameId, game.id), isNull(events.deletedAt)));
      if (!existing) throw new HttpError(404, 'That play is not in this game (it may have been deleted).');
      if (existing.type !== e.type) throw new HttpError(400, 'A play cannot change its type. Delete it and record a new one.');
      checkEvent(e, await participantSides(db, game.id));

      const { id: _id, seq: _seq, ...row } = toRow(e);
      await db.update(events).set(row).where(eq(events.id, e.id));
      await recomputeGame(db, game.id);
      return { ok: true };
    },
  );

  app.delete('/:id/events/:eventId', { onRequest: canRecord, schema: { params: eventParams } }, async (req) => {
    const db = app.db;
    const game = await loadGame(db, req.params.id);
    requireStatus(game, ['live', 'final'], 'Plays can only be deleted in a live or finished game.');
    // Soft delete keeps the seq taken, and deleting twice is harmless.
    await db
      .update(events)
      .set({ deletedAt: new Date() })
      .where(and(eq(events.id, req.params.eventId), eq(events.gameId, game.id), isNull(events.deletedAt)));
    await recomputeGame(db, game.id);
    return { ok: true };
  });

  app.post('/:id/finish', { onRequest: canRecord, schema: { params: idParams } }, async (req) => {
    const db = app.db;
    const game = await loadGame(db, req.params.id);
    requireStatus(game, ['live'], 'Only a live game can be finished.');
    const box = await buildBoxScore(db, game.id, true);
    if (box.score.home === box.score.away) {
      throw new HttpError(409, `The score is tied ${box.score.home}–${box.score.away}. FIBA games can't end in a tie: play overtime.`);
    }
    await db.update(games).set({ status: 'final' }).where(eq(games.id, game.id));
    await recomputeGame(db, game.id);
    return { ok: true };
  });

  app.post(
    '/:id/reset',
    { onRequest: app.requireRole('admin', 'organizer'), schema: { params: idParams } },
    async (req) => {
      const db = app.db;
      const game = await loadGame(db, req.params.id);
      requireStatus(game, ['live'], 'Only a live game can be reset. Reopen a finished game first.');
      // Started by mistake: back to scheduled, with its plays and lineup removed for good.
      await db.transaction(async (tx) => {
        await tx.delete(events).where(eq(events.gameId, game.id));
        await tx.delete(gameParticipants).where(eq(gameParticipants.gameId, game.id));
        await tx.update(games).set({ status: 'scheduled' }).where(eq(games.id, game.id));
      });
      await recomputeGame(db, game.id);
      return { ok: true };
    },
  );

  app.post(
    '/:id/reopen',
    { onRequest: app.requireRole('admin', 'organizer'), schema: { params: idParams } },
    async (req) => {
      const db = app.db;
      const game = await loadGame(db, req.params.id);
      requireStatus(game, ['final'], 'Only a finished game can be reopened.');
      const [{ n } = { n: 0 }] = await db
        .select({ n: count() })
        .from(gameParticipants)
        .where(eq(gameParticipants.gameId, game.id));
      if (n === 0) throw new HttpError(409, 'This game has no lineup to record against.');
      await db.update(games).set({ status: 'live' }).where(eq(games.id, game.id));
      await recomputeGame(db, game.id);
      return { ok: true };
    },
  );
};
