import { Box, MenuItem, TextField } from '@mui/material';
import { Link } from 'react-router-dom';
import { useMatchup, useMeta } from '../api/queries';
import type { MatchupKey, MatchupResponse } from '../api/types';
import { Card, ErrorState, Loading, Muted, PageHeader, SectionTitle } from '../components/ui';
import { formatDate } from '../lib/format';
import { useUrlState } from '../lib/useUrlState';
import { display, tokens } from '../theme';

const A = tokens.home;
const B = tokens.away;

/** Rows as in the reference app: shooting as made-attempted (%), then counting stats. The bar splits by the first number. */
const ROWS: { label: string; made: MatchupKey; att?: MatchupKey }[] = [
  { label: 'FGM-A', made: 'fgm', att: 'fga' },
  { label: '3PM-A', made: 'fg3m', att: 'fg3a' },
  { label: 'FTM-A', made: 'ftm', att: 'fta' },
  { label: 'Points', made: 'pts' },
  { label: 'Rebounds', made: 'reb' },
  { label: 'Offensive rebounds', made: 'oreb' },
  { label: 'Defensive rebounds', made: 'dreb' },
  { label: 'Fouls', made: 'pf' },
  { label: 'Steals', made: 'stl' },
  { label: 'Turnovers', made: 'tov' },
  { label: 'Blocks', made: 'blk' },
  { label: 'Assists', made: 'ast' },
  { label: 'Team PIR', made: 'pir' },
];

function Bar({ row, data, perGame }: { row: (typeof ROWS)[number]; data: MatchupResponse; perGame: boolean }) {
  const div = perGame && data.played ? data.played : 1;
  const val = (side: 'a' | 'b', k: MatchupKey) => {
    const v = data.totals[side][k] / div;
    return perGame ? Math.round(v * 10) / 10 : v;
  };
  const text = (side: 'a' | 'b') => {
    const made = val(side, row.made);
    if (!row.att) return <span>{made}</span>;
    const att = val(side, row.att);
    const pct = data.totals[side][row.att] ? Math.round((data.totals[side][row.made] / data.totals[side][row.att]) * 100) : null;
    return (
      <span>
        {made}-{att}{' '}
        <Box component="span" sx={{ color: tokens.muted }}>({pct === null ? '—' : `${pct}%`})</Box>
      </span>
    );
  };
  const a = Math.max(0, data.totals.a[row.made]);
  const b = Math.max(0, data.totals.b[row.made]);
  const share = a + b ? (a / (a + b)) * 100 : 50;
  return (
    <Box component="li" sx={{ display: 'grid', gridTemplateColumns: 'minmax(84px, 120px) 1fr minmax(84px, 120px)', alignItems: 'end', gap: { xs: 1, sm: 2 }, py: 1.1 }}>
      <Box sx={{ textAlign: 'right', fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{text('a')}</Box>
      <Box>
        <Box sx={{ textAlign: 'center', fontSize: 13, color: tokens.muted, mb: 0.5 }}>{row.label}</Box>
        <Box aria-hidden="true" sx={{ display: 'flex', gap: '6px', height: 6 }}>
          <Box sx={{ width: `${share}%`, bgcolor: A, borderRadius: 3 }} />
          <Box sx={{ flex: 1, bgcolor: B, borderRadius: 3 }} />
        </Box>
      </Box>
      <Box sx={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{text('b')}</Box>
    </Box>
  );
}

/** Team vs team over the season's head-to-head games: record and split comparison bars (from the box scores). */
export function MatchupPage() {
  const meta = useMeta();
  const { params, set } = useUrlState();

  const seasonId = meta.data?.seasons.find((s) => String(s.year) === params.get('year'))?.id ?? meta.data?.currentSeasonId;
  const seasonYear = meta.data?.seasons.find((s) => s.id === seasonId)?.year;
  const leagues = (meta.data?.leagues ?? []).filter((l) => (meta.data?.teams.filter((t) => t.leagueId === l.id).length ?? 0) >= 2);
  const fromUrl = meta.data?.teams.find((t) => String(t.id) === params.get('a'));
  const leagueId = fromUrl?.leagueId ?? leagues.find((l) => String(l.id) === params.get('league'))?.id ?? leagues[0]?.id;
  const leagueTeams = (meta.data?.teams ?? []).filter((t) => t.leagueId === leagueId);
  const teamA = fromUrl?.id ?? leagueTeams[0]?.id;
  const teamB = leagueTeams.find((t) => String(t.id) === params.get('b') && t.id !== teamA)?.id ?? leagueTeams.find((t) => t.id !== teamA)?.id;
  const perGame = params.get('view') === 'avg';

  const q = useMatchup(teamA, teamB, seasonId);
  const d = q.data;

  return (
    <>
      <PageHeader title="Season matchup" subtitle={`${seasonYear ?? ''} · head-to-head games between two teams`} />

      <Box component="section" aria-label="Filters" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        <TextField select label="Year" value={seasonYear ? String(seasonYear) : ''} onChange={(e) => set({ year: e.target.value })} sx={{ flex: '1 1 110px' }}>
          {(meta.data?.seasons ?? []).map((s) => <MenuItem key={s.id} value={String(s.year)}>{s.year}</MenuItem>)}
        </TextField>
        <TextField select label="League" value={leagueId ? String(leagueId) : ''} onChange={(e) => set({ league: e.target.value, a: undefined, b: undefined })} sx={{ flex: '2 1 200px' }}>
          {leagues.map((l) => <MenuItem key={l.id} value={String(l.id)}>{l.name}</MenuItem>)}
        </TextField>
        <TextField select label="Team" value={teamA ? String(teamA) : ''} onChange={(e) => set({ a: e.target.value, b: e.target.value === String(teamB) ? undefined : teamB ? String(teamB) : undefined })} sx={{ flex: '2 1 200px' }}>
          {leagueTeams.map((t) => <MenuItem key={t.id} value={String(t.id)}>{t.name}</MenuItem>)}
        </TextField>
        <TextField select label="Against" value={teamB ? String(teamB) : ''} onChange={(e) => set({ a: teamA ? String(teamA) : undefined, b: e.target.value })} sx={{ flex: '2 1 200px' }}>
          {leagueTeams.filter((t) => t.id !== teamA).map((t) => <MenuItem key={t.id} value={String(t.id)}>{t.name}</MenuItem>)}
        </TextField>
        <TextField select label="Show" value={perGame ? 'avg' : 'tot'} onChange={(e) => set({ view: e.target.value === 'avg' ? 'avg' : undefined })} sx={{ flex: '1 1 150px' }}>
          <MenuItem value="tot">Totals</MenuItem>
          <MenuItem value="avg">Per game</MenuItem>
        </TextField>
      </Box>

      {meta.isPending || (q.isPending && !!teamB) ? (
        <Loading />
      ) : !teamB ? (
        <Muted>This league needs at least two teams.</Muted>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : d ? (
        <>
          <Card component="header" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: { xs: 2, sm: 5 }, flexWrap: 'wrap', textAlign: 'center' }}>
            <Box sx={{ fontFamily: display, fontSize: { xs: 26, sm: 36 }, fontWeight: 700, color: A }}>{d.a.name}</Box>
            <Box>
              <Box sx={{ fontSize: 13, color: tokens.muted }}>vs</Box>
              <Box sx={{ fontFamily: display, fontSize: 30, fontWeight: 700, lineHeight: 1 }} aria-label={`Record ${d.wins.a} wins to ${d.wins.b}`}>
                {d.wins.a}-{d.wins.b}
              </Box>
            </Box>
            <Box sx={{ fontFamily: display, fontSize: { xs: 26, sm: 36 }, fontWeight: 700, color: B }}>{d.b.name}</Box>
          </Card>

          {d.played === 0 ? (
            <Muted>{d.games.length ? 'Their only meeting was a forfeit, so there are no stats to compare.' : `These teams haven't played each other in ${d.season.year} yet.`}</Muted>
          ) : (
            <Card aria-labelledby="bars">
              <SectionTitle id="bars" aside={`${d.played} game${d.played === 1 ? '' : 's'} with a box score${perGame ? ' · per game' : ''}`}>Head to head</SectionTitle>
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {ROWS.map((r) => <Bar key={r.label} row={r} data={d} perGame={perGame} />)}
              </Box>
            </Card>
          )}

          {d.games.length > 0 && (
            <Card aria-labelledby="meetings">
              <SectionTitle id="meetings">Meetings</SectionTitle>
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {d.games.map((g) => (
                  <Box component="li" key={g.id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', py: 1.1, borderTop: `1px solid ${tokens.row}`, '&:first-of-type': { borderTop: 'none' }, fontSize: 14 }}>
                    <span>{formatDate(g.scheduledAt)} · {g.aHome ? `${d.a.shortName} home` : `${d.b.shortName} home`}{g.status === 'forfeit' ? ' · forfeit' : ''}</span>
                    <Link to={`/games/${g.id}`}>
                      <Box component="span" sx={{ color: g.aScore > g.bScore ? A : tokens.muted, fontWeight: 600 }}>{d.a.shortName} {g.aScore}</Box>
                      {' – '}
                      <Box component="span" sx={{ color: g.bScore > g.aScore ? B : tokens.muted, fontWeight: 600 }}>{g.bScore} {d.b.shortName}</Box>
                    </Link>
                  </Box>
                ))}
              </Box>
            </Card>
          )}
        </>
      ) : null}
    </>
  );
}
