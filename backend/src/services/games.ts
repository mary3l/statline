import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { schema } from '../db/index.js';
import { computeBoxScore, type BoxScore } from '../engine/boxscore.js';
import { fromRow, type GameEvent } from '../engine/types.js';
import { notifyGameChanged } from './gameEvents.js';

const { events, gameParticipants, games, playerGameLines } = schema;

export async function loadEvents(db: DB, gameId: number): Promise<GameEvent[]> {
  const rows = await db
    .select({
      id: events.id,
      seq: events.seq,
      period: events.period,
      clock: events.clock,
      side: events.side,
      playerId: events.playerId,
      type: events.type,
      details: events.details,
    })
    .from(events)
    .where(and(eq(events.gameId, gameId), isNull(events.deletedAt)))
    .orderBy(asc(events.seq));
  return rows.map(fromRow);
}

export async function loadParticipants(db: DB, gameId: number) {
  return db.select().from(gameParticipants).where(eq(gameParticipants.gameId, gameId));
}

export async function buildBoxScore(db: DB, gameId: number, final: boolean): Promise<BoxScore> {
  const [participants, evts] = await Promise.all([loadParticipants(db, gameId), loadEvents(db, gameId)]);
  return computeBoxScore(
    participants.map((p) => ({ playerId: p.playerId, side: p.side, starter: p.starter })),
    evts,
    { final },
  );
}

/**
 * Rebuilds a game's cached score and saved player lines from its events.
 * Call after any change to a game's events or status. Player lines are saved for final games only.
 */
export async function recomputeGame(db: DB, gameId: number): Promise<void> {
  await rebuildGame(db, gameId);
  notifyGameChanged(gameId);
}

async function rebuildGame(db: DB, gameId: number): Promise<void> {
  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  if (!game) throw new Error(`Game ${gameId} not found`);

  await db.delete(playerGameLines).where(eq(playerGameLines.gameId, gameId));

  if (game.status === 'scheduled' || game.status === 'forfeit') {
    if (game.status === 'scheduled') {
      await db.update(games).set({ homeScore: null, awayScore: null, periods: null }).where(eq(games.id, gameId));
    }
    return;
  }

  const box = await buildBoxScore(db, gameId, game.status === 'final');
  await db
    .update(games)
    .set({ homeScore: box.score.home, awayScore: box.score.away, periods: box.periods })
    .where(eq(games.id, gameId));

  // A live game shows its score, but its player lines only count (leaders, profiles) once it is final.
  if (game.status !== 'final') return;

  const teamFor = { home: game.homeTeamId, away: game.awayTeamId };
  const rows = box.players
    .filter((p) => p.seconds > 0 || p.fga + p.fta + p.reb + p.ast + p.stl + p.blk + p.tov + p.pf + p.fd > 0)
    .map((p) => ({
      gameId,
      playerId: p.playerId,
      teamId: teamFor[p.side],
      seasonId: game.seasonId,
      leagueId: game.leagueId,
      starter: p.starter,
      seconds: p.seconds,
      pts: p.pts,
      fg2m: p.fg2m,
      fg2a: p.fg2a,
      fg3m: p.fg3m,
      fg3a: p.fg3a,
      ftm: p.ftm,
      fta: p.fta,
      oreb: p.oreb,
      dreb: p.dreb,
      ast: p.ast,
      stl: p.stl,
      blk: p.blk,
      tov: p.tov,
      pf: p.pf,
      fd: p.fd,
      pir: p.pir,
      plusMinus: p.plusMinus,
    }));
  if (rows.length) await db.insert(playerGameLines).values(rows);
}
