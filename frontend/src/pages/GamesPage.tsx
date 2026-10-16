import { Box, MenuItem, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useGames, useMeta } from '../api/queries';
import type { Game } from '../api/types';
import { ErrorState, Loading, Muted, PageHeader } from '../components/ui';
import { formatDate, formatTime, MONTH_NAMES } from '../lib/format';
import { display, tokens } from '../theme';

const STATUS_LABEL = { scheduled: 'Scheduled', live: 'Live', final: 'Final', forfeit: 'Forfeit' } as const;

function GameRow({ g }: { g: Game }) {
  const played = g.status === 'final' || g.status === 'forfeit' || g.status === 'live';
  const homeWon = played && (g.home.score ?? 0) > (g.away.score ?? 0);
  const team = (t: Game['home'], color: string, won: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
      <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: won ? 700 : 500, minWidth: 0 }}>
        <Box component="span" aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: color, flex: '0 0 8px' }} />
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</Box>
      </Box>
      <Box component="span" sx={{ fontFamily: display, fontSize: 26, fontWeight: 700, lineHeight: 1, color: won ? tokens.ink : tokens.muted }}>
        {played ? t.score : ''}
      </Box>
    </Box>
  );
  return (
    <Box
      component={Link}
      to={`/games/${g.id}`}
      aria-label={`${g.home.name} vs ${g.away.name}, ${STATUS_LABEL[g.status]}${played ? `, ${g.home.score}–${g.away.score}` : ''}`}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        p: '14px 16px',
        bgcolor: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: '14px',
        color: tokens.ink,
        textDecoration: 'none',
        '&:hover': { borderColor: tokens.input, boxShadow: '0 1px 0 rgba(21,23,28,.04)' },
        '&:focus-visible': { outline: `2px solid ${tokens.home}`, outlineOffset: 2 },
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, fontSize: 12, color: tokens.muted }}>
        <span>
          <Box component="span" sx={{ fontWeight: 600, color: g.status === 'live' ? tokens.home : g.status === 'scheduled' ? tokens.muted : tokens.ink }}>
            {STATUS_LABEL[g.status]}
            {g.status === 'final' && g.periods && g.periods > 4 ? ` (${g.periods === 5 ? 'OT' : `${g.periods - 4}OT`})` : ''}
          </Box>
          {' · '}Game {g.gameNumber}
        </span>
        <span>{formatTime(g.scheduledAt)}</span>
      </Box>
      {team(g.home, tokens.home, homeWon)}
      {team(g.away, tokens.away, played && !homeWon)}
      <Box sx={{ fontSize: 12, color: tokens.muted }}>{g.venue ?? 'Venue to be announced'}</Box>
    </Box>
  );
}

export function GamesPage() {
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  // The URL carries the year (e.g. ?year=2026); each year is one season in the data.
  const seasonId = meta.data?.seasons.find((s) => String(s.year) === params.get('year'))?.id ?? meta.data?.currentSeasonId;
  const leagueId = params.get('league') ? Number(params.get('league')) : undefined;
  const status = params.get('status') ?? undefined;
  // The URL keeps just the month number (1–12); the year comes from the Year picker.
  const monthParam = Number(params.get('month'));
  const month = monthParam >= 1 && monthParam <= 12 ? monthParam : undefined;
  const seasonYear = meta.data?.seasons.find((s) => s.id === seasonId)?.year;
  const [monthsWithGames, setMonthsWithGames] = useState<string[]>([]);
  const mm = month ? String(month).padStart(2, '0') : undefined;
  // A season that runs past December has that month in the next year; use the year the games are in.
  const apiMonth = mm && seasonYear ? (monthsWithGames.find((m) => m.endsWith(`-${mm}`)) ?? `${seasonYear}-${mm}`) : undefined;
  const games = useGames({ seasonId, leagueId, status, month: apiMonth });
  useEffect(() => {
    if (games.data) setMonthsWithGames(games.data.months);
  }, [games.data]);
  const hasGames = new Set(monthsWithGames.map((m) => Number(m.slice(5, 7))));

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    // A month belongs to one year, so picking another year clears it.
    if (k === 'year') next.delete('month');
    setParams(next, { replace: true });
  };

  const byDay = new Map<string, Game[]>();
  for (const g of games.data?.items ?? []) {
    const day = formatDate(g.scheduledAt, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    byDay.set(day, [...(byDay.get(day) ?? []), g]);
  }
  const leaguesWithTeams = (meta.data?.leagues ?? []).filter((l) => meta.data?.teams.some((t) => t.leagueId === l.id));

  return (
    <>
      <PageHeader title="Box scores" subtitle={`${games.data?.season.year ?? ''} · every game, newest first`} />

      <Box component="section" aria-label="Filters" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        <TextField select label="Year" value={seasonYear ? String(seasonYear) : ''} onChange={(e) => set('year', e.target.value)} sx={{ flex: '1 1 150px' }}>
          {(meta.data?.seasons ?? []).map((s) => (
            <MenuItem key={s.id} value={String(s.year)}>{s.year}</MenuItem>
          ))}
        </TextField>
        <TextField select label="League" value={leagueId ? String(leagueId) : ''} onChange={(e) => set('league', e.target.value)} sx={{ flex: '2 1 220px' }}>
          <MenuItem value="">All leagues</MenuItem>
          {leaguesWithTeams.map((l) => (
            <MenuItem key={l.id} value={String(l.id)}>{l.name}</MenuItem>
          ))}
        </TextField>
        <TextField select label="Status" value={status ?? ''} onChange={(e) => set('status', e.target.value)} sx={{ flex: '1 1 150px' }}>
          <MenuItem value="">All</MenuItem>
          <MenuItem value="live">Live</MenuItem>
          <MenuItem value="final">Final</MenuItem>
          <MenuItem value="scheduled">Scheduled</MenuItem>
          <MenuItem value="forfeit">Forfeit</MenuItem>
        </TextField>
        <TextField select label="Month" value={month ? String(month) : ''} onChange={(e) => set('month', e.target.value)} sx={{ flex: '1 1 160px' }}>
          <MenuItem value="">All months</MenuItem>
          {MONTH_NAMES.map((name, i) => {
            const n = i + 1;
            const empty = !hasGames.has(n);
            return (
              // Months without games stay visible but can't be picked (unless already chosen in the URL).
              <MenuItem key={n} value={String(n)} disabled={empty && n !== month}>
                {name}
                {empty && (
                  <Box component="span" sx={{ ml: 1, fontSize: 12, color: tokens.muted }}>
                    no games
                  </Box>
                )}
              </MenuItem>
            );
          })}
        </TextField>
      </Box>

      {games.isPending ? (
        <Loading />
      ) : games.error ? (
        <ErrorState error={games.error} onRetry={() => games.refetch()} />
      ) : byDay.size === 0 ? (
        <Muted>No games match these filters.</Muted>
      ) : (
        [...byDay.entries()].map(([day, list]) => {
          const leagues = [...new Set(list.map((g) => g.league.name))];
          return (
            <Box component="section" key={day} aria-label={day} sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Box component="h2" sx={{ m: 0, fontSize: 15, fontWeight: 600, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'baseline' }}>
                {day}
                <Box component="span" sx={{ fontSize: 12, fontWeight: 400, color: tokens.muted }}>{leagues.join(' · ')}</Box>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1.5 }}>
                {list.map((g) => <GameRow key={g.id} g={g} />)}
              </Box>
            </Box>
          );
        })
      )}
    </>
  );
}
