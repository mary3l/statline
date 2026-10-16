import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApi, type TestApi } from '../test/harness.js';

/** Runs the recorder API against a throwaway in-memory database (never the dev data in .data/). */
let t: TestApi;
let gameId: number;
const ids = { home: [] as number[], away: [] as number[] };

beforeAll(async () => {
  t = await createTestApi();
  const seeded = await t.seedLeague();
  gameId = seeded.gameId;
  ids.home = seeded.ids.home;
  ids.away = seeded.ids.away;
});

afterAll(async () => {
  await t?.close();
});

const request = (url: string) => t.request(url);
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, as: 'scorer' | 'organizer' = 'scorer') =>
  t.request(`/api/games/${gameId}${url}`, { method, body, as });

let seq = 0;
const ev = (e: Record<string, unknown>) => ({ id: crypto.randomUUID(), seq: ++seq, period: 1, clock: 590, side: 'home', playerId: null, ...e });
const lineup = (side: 'home' | 'away', n = 6) => ids[side].slice(0, n).map((playerId, i) => ({ playerId, side, starter: i < 5 }));

describe('recorder API', () => {
  it('needs a signed-in recorder', async () => {
    const res = await request(`/api/games/${gameId}/recorder`);
    expect(res.statusCode).toBe(401);
  });

  it('lists both rosters before tip-off', async () => {
    const res = await call('GET', '/recorder');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.game.status).toBe('scheduled');
    expect(body.roster.home).toHaveLength(7);
    expect(body.roster.home.every((p: { dressed: boolean }) => !p.dressed)).toBe(true);
    expect(body.nextSeq).toBe(1);
  });

  it('checks the lineup before starting', async () => {
    const noStarters = [...lineup('home'), ...lineup('away')].map((p) => ({ ...p, starter: false }));
    expect((await call('POST', '/start', { participants: noStarters })).json().message).toMatch(/exactly 5 starters/);

    const suspended = [...lineup('home', 7), ...lineup('away')];
    expect((await call('POST', '/start', { participants: suspended })).json().message).toMatch(/suspended/);

    const wrongTeam = [...lineup('home'), ...lineup('away').map((p) => ({ ...p, side: 'home' as const }))];
    expect((await call('POST', '/start', { participants: wrongTeam })).statusCode).toBe(400);

    const ok = await call('POST', '/start', { participants: [...lineup('home'), ...lineup('away')] });
    expect(ok.statusCode).toBe(200);
  });

  const [h, a] = [() => ids.home, () => ids.away];
  let shot: ReturnType<typeof ev>;
  let assist: ReturnType<typeof ev>;
  let newest: ReturnType<typeof ev>;

  it('saves plays, and a re-sent batch is not counted twice', async () => {
    shot = ev({ type: 'shot', playerId: h()[0], pts: 3, made: true, x: 0.1, y: 0.1 });
    assist = ev({ type: 'ast', playerId: h()[1] });
    const batch = [
      ev({ type: 'period_start', side: null, clock: 600 }),
      shot,
      assist,
      ev({ type: 'shot', side: 'away', playerId: a()[0], pts: 2, made: false, x: 0.5, y: 0.15 }),
      ev({ type: 'reb', playerId: h()[2], off: false }),
      ev({ type: 'pf', side: 'away', playerId: a()[1], kind: 'shoot2' }),
      ev({ type: 'fd', playerId: h()[0] }),
      ev({ type: 'ft', playerId: h()[0], made: true }),
      ev({ type: 'ft', playerId: h()[0], made: false }),
      ev({ type: 'sub', outId: h()[4], inId: h()[5] }),
      ev({ type: 'timeout', side: 'away' }),
    ];
    newest = batch.at(-1)!;
    expect((await call('POST', '/events', { events: batch })).statusCode).toBe(200);
    expect((await call('POST', '/events', { events: batch })).statusCode).toBe(200);

    const box = (await call('GET', '/boxscore')).json();
    expect(box.game.status).toBe('live');
    expect(box.box.score).toEqual({ home: 4, away: 0 });
    expect(box.box.players.find((p: { playerId: number }) => p.playerId === h()[0])).toMatchObject({ pts: 4, fd: 1, fta: 2 });
  });

  it('rejects plays that don’t fit the lineup', async () => {
    const wrongSide = await call('POST', '/events', { events: [ev({ type: 'ast', playerId: a()[0] })] });
    expect(wrongSide.statusCode).toBe(400);
    expect(wrongSide.json().message).toMatch(/not dressed for this team/);
    const noPlayer = await call('POST', '/events', { events: [ev({ type: 'stl' })] });
    expect(noPlayer.statusCode).toBe(400);
    const badClock = await call('POST', '/events', { events: [ev({ type: 'tov', playerId: h()[0], period: 5, clock: 400 })] });
    expect(badClock.json().message).toMatch(/past the length/);
  });

  it('numbers plays on arrival, so two devices can record the same game', async () => {
    // Both devices think the next number is 12; the server gives each its own, in arrival order.
    const one = ev({ type: 'tov', playerId: h()[0], seq: 12 });
    const two = ev({ type: 'stl', side: 'away', playerId: a()[2], seq: 12 });
    const [ra, rb] = await Promise.all([
      call('POST', '/events', { events: [one] }),
      t.request(`/api/games/${gameId}/events`, { method: 'POST', body: { events: [two] }, as: 'organizer' }),
    ]);
    expect(ra.statusCode).toBe(200);
    expect(rb.statusCode).toBe(200);
    const seqs = [ra.json().events[0].seq, rb.json().events[0].seq].sort((x, y) => x - y);
    expect(seqs).toEqual([12, 13]);
    // A retry keeps the number it was given.
    expect((await call('POST', '/events', { events: [one] })).json().events[0].seq).toBe(ra.json().events[0].seq);
    for (const id of [one.id, two.id]) await call('DELETE', `/events/${id}`);
  });

  it('fixes and deletes plays', async () => {
    const fixed = await call('PUT', `/events/${shot.id}`, { ...shot, pts: 2 });
    expect(fixed.statusCode).toBe(200);
    const typeChange = await call('PUT', `/events/${shot.id}`, { ...shot, type: 'ft', made: true });
    expect(typeChange.statusCode).toBe(400);
    expect((await call('DELETE', `/events/${assist.id}`)).statusCode).toBe(200);
    expect((await call('DELETE', `/events/${assist.id}`)).statusCode).toBe(200);

    const box = (await call('GET', '/boxscore')).json().box;
    expect(box.score.home).toBe(3);
    expect(box.totals.home.ast).toBe(0);

    // Deleted plays keep their seq, so the next play can't reuse the newest one's.
    expect((await call('DELETE', `/events/${newest.id}`)).statusCode).toBe(200);
    const rec = (await call('GET', '/recorder')).json();
    const kept = rec.events.map((e: { id: string }) => e.id);
    expect(kept).not.toContain(assist.id);
    expect(kept).not.toContain(newest.id);
    expect(rec.nextSeq).toBeGreaterThan(newest.seq as number);
  });

  it('won’t change the lineup once plays exist', async () => {
    const res = await call('POST', '/start', { participants: [...lineup('home'), ...lineup('away')] });
    expect(res.statusCode).toBe(409);
  });

  it('finishes the game (not on a tie), and only organizers reopen it', async () => {
    expect((await call('POST', '/events', { events: [ev({ type: 'shot', side: 'away', playerId: a()[0], pts: 3, made: true, x: 0.9, y: 0.6 })] })).statusCode).toBe(200);
    const tied = await call('POST', '/finish');
    expect(tied.statusCode).toBe(409);
    expect(tied.json().message).toMatch(/tied/);

    await call('POST', '/events', { events: [ev({ type: 'ft', playerId: h()[0], made: true })] });
    expect((await call('POST', '/finish')).statusCode).toBe(200);
    expect((await call('POST', '/events', { events: [ev({ type: 'ast', playerId: h()[1] })] })).statusCode).toBe(409);

    expect((await call('POST', '/reopen')).statusCode).toBe(403);
    expect((await call('POST', '/reopen', undefined, 'organizer')).statusCode).toBe(200);
    expect((await call('GET', '/boxscore')).json().game.status).toBe('live');
  });

  it('lets an organizer reset a live game back to scheduled', async () => {
    expect((await call('POST', '/reset')).statusCode).toBe(403);
    expect((await call('POST', '/reset', undefined, 'organizer')).statusCode).toBe(200);
    const rec = (await call('GET', '/recorder')).json();
    expect(rec.game.status).toBe('scheduled');
    expect(rec.game.home.score).toBeNull();
    expect(rec.events).toHaveLength(0);
    expect(rec.nextSeq).toBe(1);
  });
});
