import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '../db/index.js';
import { createTestApi, type TestApi } from '../test/harness.js';

let t: TestApi;
let s: Awaited<ReturnType<TestApi['seedLeague']>>;

beforeAll(async () => {
  t = await createTestApi();
  s = await t.seedLeague();
});
afterAll(async () => {
  await t?.close();
});

let seq = 0;
const ev = (e: Record<string, unknown>) => ({ id: crypto.randomUUID(), seq: ++seq, period: 1, clock: 590, side: 'home', playerId: null, ...e });
const five = (side: 'home' | 'away', starters: number[] = [0, 1, 2, 3, 4]) =>
  starters.map((i) => ({ playerId: s.ids[side][i]!, side, starter: true }));
const post = (url: string, body?: unknown, as: 'admin' | 'organizer' | 'scorer' = 'organizer') => t.request(url, { method: 'POST', body, as });

describe('live game extras', () => {
  it('adds a late player to the bench of a live game only', async () => {
    const g = `/api/games/${s.gameId}`;
    expect((await post(`${g}/participants`, { playerId: s.ids.home[5], side: 'home' })).statusCode).toBe(409);
    expect((await post(`${g}/start`, { participants: [...five('home'), ...five('away')] })).statusCode).toBe(200);

    expect((await post(`${g}/participants`, { playerId: s.ids.home[5], side: 'home' }, 'scorer')).statusCode).toBe(200);
    expect((await post(`${g}/participants`, { playerId: s.ids.home[6], side: 'home' })).json().message).toMatch(/suspended/);
    expect((await post(`${g}/participants`, { playerId: s.ids.away[5], side: 'home' })).statusCode).toBe(400);

    const roster = (await t.request(`${g}/recorder`, { as: 'scorer' })).json().roster.home;
    expect(roster.find((p: { playerId: number }) => p.playerId === s.ids.home[5])).toMatchObject({ dressed: true, starter: false });
  });

  it('lets the lineup change while only the clock has run, not after a play', async () => {
    const g = `/api/games/${s.gameId}`;
    await post(`${g}/events`, { events: [ev({ type: 'period_start', side: null, clock: 600 })] }, 'scorer');
    const swapped = [...five('home', [0, 1, 2, 3, 5]), { playerId: s.ids.home[4]!, side: 'home', starter: false }, ...five('away')];
    expect((await post(`${g}/start`, { participants: swapped })).statusCode).toBe(200);
    await post(`${g}/events`, { events: [ev({ type: 'shot', playerId: s.ids.home[0], pts: 2, made: true, x: 0.5, y: 0.1 })] }, 'scorer');
    expect((await post(`${g}/start`, { participants: swapped })).statusCode).toBe(409);
  });

  it('pushes a change event to box-score viewers when a play is recorded', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${t.base}/api/games/${s.gameId}/stream`, { signal: ctrl.signal });
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    await reader.read(); // the retry hint
    const next = reader.read();
    await post(`/api/games/${s.gameId}/events`, { events: [ev({ type: 'ast', playerId: s.ids.home[1] })] }, 'scorer');
    const chunk = new TextDecoder().decode((await next).value);
    expect(chunk).toContain('event: change');
    ctrl.abort();
  });
});

describe('lineups and season matchup', () => {
  it('adds up each five’s minutes and +/- over the season', async () => {
    const g = `/api/games/${s.gameId}`;
    await post(
      `${g}/events`,
      {
        events: [
          ev({ type: 'shot', side: 'away', playerId: s.ids.away[0], pts: 3, made: true, x: 0.9, y: 0.6, clock: 400 }),
          ev({ type: 'sub', outId: s.ids.home[5], inId: s.ids.home[4], clock: 300 }),
          ev({ type: 'shot', playerId: s.ids.home[4], pts: 3, made: true, x: 0.1, y: 0.1, clock: 200 }),
          ev({ type: 'period_end', side: null, clock: 0 }),
        ],
      },
      'scorer',
    );
    expect((await post(`${g}/finish`, undefined, 'scorer')).statusCode).toBe(200);

    const body = (await t.request(`/api/lineups?teamId=${s.home.id}`)).json();
    expect(body.games).toBe(1);
    const total = body.units.reduce((n: number, u: { plusMinus: number }) => n + u.plusMinus, 0);
    expect(total).toBe(5 - 3);
    expect(body.units.reduce((n: number, u: { seconds: number }) => n + u.seconds, 0)).toBe(2400);
    const closers = body.units.find((u: { players: { playerId: number }[] }) => u.players.some((p) => p.playerId === s.ids.home[4]));
    expect(closers).toMatchObject({ ptsFor: 3, ptsAgainst: 0, plusMinus: 3 });
    expect(closers.players).toHaveLength(5);
  });

  it('compares two teams over their head-to-head games', async () => {
    const res = await t.request(`/api/matchup?teamA=${s.home.id}&teamB=${s.away.id}`);
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.wins).toEqual({ a: 1, b: 0 });
    expect(m.played).toBe(1);
    expect(m.totals.a.pts).toBe(5);
    expect(m.totals.b.pts).toBe(3);
    expect(m.totals.a.ast).toBe(1);
    expect((await t.request(`/api/matchup?teamA=${s.home.id}&teamB=${s.home.id}`)).statusCode).toBe(400);
  });
});

describe('league office', () => {
  it('is for organizers and admins only', async () => {
    const res = await post('/api/admin/leagues', { name: 'X League', level: 'Open', gender: null, minAge: null, maxAge: null }, 'scorer');
    expect(res.statusCode).toBe(403);
  });

  it('schedules, edits, forfeits and deletes games', async () => {
    const at = '2026-10-27T14:00:00+08:00';
    const bad = await post('/api/admin/games', { leagueId: s.league.id, homeTeamId: s.home.id, awayTeamId: s.home.id, scheduledAt: at, venue: null });
    expect(bad.statusCode).toBe(400);
    const created = await post('/api/admin/games', { leagueId: s.league.id, homeTeamId: s.away.id, awayTeamId: s.home.id, scheduledAt: at, venue: 'Gym' });
    expect(created.statusCode).toBe(201);
    const game = created.json();
    expect(game.gameNumber).toBe(2);

    const clash = (await t.request(`/api/admin/games/conflicts?teamIds=${s.home.id}&day=2026-10-27`, { as: 'organizer' })).json();
    expect(clash.games.map((g: { id: number }) => g.id)).toContain(game.id);

    const moved = await t.request(`/api/admin/games/${game.id}`, { method: 'PATCH', as: 'organizer', body: { homeTeamId: s.away.id, awayTeamId: s.home.id, scheduledAt: '2026-10-28T16:00:00+08:00', venue: 'Court 2' } });
    expect(moved.statusCode).toBe(200);
    // A finished game can't change teams.
    const swapFinal = await t.request(`/api/admin/games/${s.gameId}`, { method: 'PATCH', as: 'organizer', body: { homeTeamId: s.away.id, awayTeamId: s.home.id, scheduledAt: at, venue: null } });
    expect(swapFinal.statusCode).toBe(409);

    expect((await post(`/api/admin/games/${game.id}/forfeit`, { forfeitedBy: 'home' })).statusCode).toBe(200);
    const standings = (await t.request(`/api/standings?leagueId=${s.league.id}`)).json().rows;
    expect(standings.find((r: { teamId: number }) => r.teamId === s.home.id)).toMatchObject({ w: 2, l: 0 });
    expect((await post(`/api/admin/games/${game.id}/forfeit`, { forfeitedBy: null })).statusCode).toBe(200);

    expect((await t.request(`/api/admin/games/${s.gameId}`, { method: 'DELETE', as: 'organizer' })).statusCode).toBe(409);
    expect((await t.request(`/api/admin/games/${game.id}`, { method: 'DELETE', as: 'organizer' })).statusCode).toBe(200);
  });

  it('manages leagues, teams, rosters and seasons', async () => {
    const league = await post('/api/admin/leagues', { name: 'Youth U16', level: 'Youth', gender: null, minAge: null, maxAge: 16 });
    expect(league.statusCode).toBe(201);
    const team = await post('/api/admin/teams', { leagueId: league.json().id, name: 'Young Guns', shortName: 'yg', color: '#123456' });
    expect(team.json().shortName).toBe('YG');

    // Born 2000: too old for U16.
    const tooOld = await post(`/api/admin/teams/${team.json().id}/roster`, { playerId: s.ids.home[0], jersey: '9' });
    expect(tooOld.statusCode).toBe(422);
    // Already on Home Hawks this season.
    const twice = await post(`/api/admin/teams/${s.away.id}/roster`, { playerId: s.ids.home[0], jersey: '99' });
    expect(twice.json().message).toMatch(/Release them there first/);

    const [rookie] = await t.db
      .insert(schema.players)
      .values({ firstName: 'New', lastName: 'Rookie', birthdate: '2001-05-05', gender: 'M', position: 'PG' })
      .returning();
    expect((await post(`/api/admin/teams/${s.home.id}/roster`, { playerId: rookie!.id, jersey: '4' })).json().message).toMatch(/already worn/);
    expect((await post(`/api/admin/teams/${s.home.id}/roster`, { playerId: rookie!.id, jersey: '44' })).statusCode).toBe(201);

    const roster = (await t.request(`/api/admin/teams/${s.home.id}/roster`, { as: 'organizer' })).json().players;
    const entry = roster.find((r: { playerId: number }) => r.playerId === rookie!.id);
    expect((await t.request(`/api/admin/roster/${entry.entryId}`, { method: 'DELETE', as: 'organizer' })).statusCode).toBe(200);
    const after = (await t.request(`/api/admin/teams/${s.home.id}/roster`, { as: 'organizer' })).json().players;
    expect(after.find((r: { playerId: number }) => r.playerId === rookie!.id).leftOn).not.toBeNull();

    const season = await post('/api/admin/seasons', { year: 2027, isCurrent: true });
    expect(season.statusCode).toBe(201);
    const meta = (await t.request('/api/meta')).json();
    expect(meta.seasons.filter((x: { isCurrent: boolean }) => x.isCurrent).map((x: { year: number }) => x.year)).toEqual([2027]);
    expect((await t.request(`/api/admin/seasons/${s.season.id}`, { method: 'PATCH', as: 'admin', body: { isCurrent: true } })).statusCode).toBe(200);
  });
});

describe('player files', () => {
  // 1×1 PNG and a minimal PDF.
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64')}`;

  it('stores a photo that signed-in users can see', async () => {
    const id = s.ids.away[0]!;
    expect((await t.request(`/api/players/${id}/photo`, { method: 'PUT', as: 'scorer', body: { dataUrl: png } })).statusCode).toBe(403);
    const text = `data:image/png;base64,${Buffer.from('not really an image').toString('base64')}`;
    expect((await t.request(`/api/players/${id}/photo`, { method: 'PUT', as: 'organizer', body: { dataUrl: text } })).statusCode).toBe(415);
    expect((await t.request(`/api/players/${id}/photo`, { method: 'PUT', as: 'organizer', body: { dataUrl: png } })).statusCode).toBe(200);

    expect((await t.request(`/api/players/${id}/photo`)).statusCode).toBe(401);
    const img = await t.request(`/api/players/${id}/photo`, { as: 'scorer' });
    expect(img.statusCode).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.body.subarray(1, 4).toString()).toBe('PNG');
    expect((await t.request(`/api/players/${id}`, { as: 'scorer' })).json().photoVersion).toEqual(expect.any(Number));
  });

  it('keeps birth certificates for organizers, and verification needs a document', async () => {
    const id = s.ids.away[1]!;
    expect((await post(`/api/players/${id}/birth-certificate/verify`, { verified: true })).statusCode).toBe(409);
    expect((await t.request(`/api/players/${id}/birth-certificate`, { method: 'PUT', as: 'organizer', body: { dataUrl: pdf } })).statusCode).toBe(200);
    expect((await t.request(`/api/players/${id}/birth-certificate`, { as: 'scorer' })).statusCode).toBe(403);
    const doc = await t.request(`/api/players/${id}/birth-certificate`, { as: 'organizer' });
    expect(doc.headers.get('content-type')).toBe('application/pdf');
    expect(doc.body.toString('ascii', 0, 5)).toBe('%PDF-');

    expect((await post(`/api/players/${id}/birth-certificate/verify`, { verified: true })).statusCode).toBe(200);
    const profile = (await t.request(`/api/players/${id}`, { as: 'organizer' })).json();
    expect(profile.birthCertVerifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(profile.birthCert.type).toBe('application/pdf');

    // A replacement has to be checked again.
    await t.request(`/api/players/${id}/birth-certificate`, { method: 'PUT', as: 'organizer', body: { dataUrl: png } });
    expect((await t.request(`/api/players/${id}`, { as: 'organizer' })).json().birthCertVerifiedOn).toBeNull();
  });
});
