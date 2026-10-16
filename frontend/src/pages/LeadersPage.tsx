import { Box, MenuItem, TextField } from '@mui/material';
import { Link, useSearchParams } from 'react-router-dom';
import { useLeaders, useMe, useMeta, useStandings } from '../api/queries';
import { Card, ErrorState, Loading, Muted, PageHeader, SectionTitle, TableScroll, tableSx } from '../components/ui';
import { signed } from '../lib/format';
import { display, tokens } from '../theme';

export function LeadersPage() {
  const meta = useMeta();
  const { data: user } = useMe();
  const [params, setParams] = useSearchParams();

  // The URL carries the year (e.g. ?year=2026); each year is one season in the data.
  const seasonId = meta.data?.seasons.find((s) => String(s.year) === params.get('year'))?.id ?? meta.data?.currentSeasonId;
  const tabs = (meta.data?.leagues ?? []).filter((l) => seasonId !== undefined && l.seasonsWithGames.includes(seasonId));
  const leagueId = tabs.find((l) => String(l.id) === params.get('league'))?.id ?? tabs[0]?.id;
  const league = tabs.find((l) => l.id === leagueId);

  const standings = useStandings(leagueId, seasonId);
  const leaders = useLeaders(leagueId, seasonId);
  const seasonYear = meta.data?.seasons.find((s) => s.id === seasonId)?.year;

  const set = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Leaders & standings"
        subtitle={`${seasonYear ?? ''} · per-game averages`}
        action={
          <TextField
            select
            label="Year"
            value={seasonYear ? String(seasonYear) : ''}
            onChange={(e) => set({ year: e.target.value, league: undefined })}
            sx={{ minWidth: 140 }}
          >
            {(meta.data?.seasons ?? []).map((s) => (
              <MenuItem key={s.id} value={String(s.year)}>{s.year}</MenuItem>
            ))}
          </TextField>
        }
      />

      {meta.isPending ? (
        <Loading />
      ) : meta.error ? (
        <ErrorState error={meta.error} onRetry={() => meta.refetch()} />
      ) : tabs.length === 0 ? (
        <Muted>No league has finished games in {seasonYear ?? 'this year'} yet.</Muted>
      ) : (
        <>
          <Box role="tablist" aria-label="League" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {tabs.map((l) => {
              const on = l.id === leagueId;
              return (
                <Box
                  key={l.id}
                  component="button"
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => set({ league: String(l.id) })}
                  sx={{
                    minHeight: 44,
                    px: 2.25,
                    borderRadius: 999,
                    fontSize: 14,
                    fontWeight: 500,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    border: `1px solid ${on ? tokens.ink : tokens.input}`,
                    bgcolor: on ? tokens.ink : tokens.card,
                    color: on ? '#FFFFFF' : tokens.ink,
                    '&:focus-visible': { outline: `2px solid ${tokens.home}`, outlineOffset: 2 },
                  }}
                >
                  {l.name}
                </Box>
              );
            })}
          </Box>

          <Card aria-labelledby="stand" role="tabpanel">
            <SectionTitle id="stand" aside="FIBA ranking points: 2 per win, 1 per loss, 0 for a forfeit">
              Standings · {league?.name}
            </SectionTitle>
            {standings.isPending ? (
              <Loading />
            ) : standings.error ? (
              <ErrorState error={standings.error} onRetry={() => standings.refetch()} />
            ) : (
              <TableScroll>
                <Box component="table" sx={[tableSx, { '& tr': { textAlign: 'right' } }]}>
                  <thead>
                    <tr>
                      <th scope="col" style={{ textAlign: 'left' }}>#</th>
                      <th scope="col" style={{ textAlign: 'left' }}>Team</th>
                      <th scope="col">GP</th>
                      <th scope="col">W</th>
                      <th scope="col">L</th>
                      <th scope="col">Win %</th>
                      <th scope="col">PF</th>
                      <th scope="col">PA</th>
                      <th scope="col">Diff</th>
                      <th scope="col" style={{ color: tokens.ink, fontWeight: 600 }}>Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.data.rows.map((r) => (
                      <tr key={r.teamId}>
                        <td style={{ textAlign: 'left', color: tokens.muted }}>{r.rank}</td>
                        <th scope="row" style={{ fontWeight: 600 }}>
                          <Link to={`/games?league=${leagueId}&year=${seasonYear}`} style={{ fontWeight: 600 }}>{r.team.name}</Link>
                          {r.forfeits > 0 && (
                            <Box component="span" sx={{ ml: 1, fontSize: 11, color: tokens.muted, fontWeight: 400 }}>
                              {r.forfeits} forfeit{r.forfeits > 1 ? 's' : ''}
                            </Box>
                          )}
                        </th>
                        <td>{r.gp}</td>
                        <td>{r.w}</td>
                        <td>{r.l}</td>
                        <td>{r.gp ? (r.w / r.gp).toFixed(3).replace(/^0/, '') : '—'}</td>
                        <td>{r.pf}</td>
                        <td>{r.pa}</td>
                        <td style={{ color: r.diff >= 0 ? tokens.away : tokens.negative }}>{signed(r.diff)}</td>
                        <td style={{ fontWeight: 700 }}>{r.pts}</td>
                      </tr>
                    ))}
                  </tbody>
                </Box>
              </TableScroll>
            )}
            <Box sx={{ mt: 1.5 }}>
              <Muted>Teams level on points are split by their games against each other (points, then point difference, then points scored), then by overall point difference.</Muted>
            </Box>
          </Card>

          <Box component="section" aria-labelledby="lead">
            <SectionTitle id="lead">Statistical leaders · {league?.name}</SectionTitle>
            {leaders.isPending ? (
              <Loading />
            ) : leaders.error ? (
              <ErrorState error={leaders.error} onRetry={() => leaders.refetch()} />
            ) : (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 2 }}>
                {leaders.data.boards.map((b) => {
                  const [top, ...rest] = b.leaders;
                  const name = (id: number, n: string) => (user ? <Link to={`/players/${id}`}>{n}</Link> : n);
                  return (
                    <Card key={b.key} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, p: '18px 20px' }}>
                      <Box component="h3" sx={{ m: '0 0 8px', fontSize: 13, fontWeight: 600, color: tokens.muted, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                        {b.title}
                      </Box>
                      {top ? (
                        <>
                          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, pb: 1.25, borderBottom: `1px solid ${tokens.row}`, '& a': { color: tokens.ink, textDecoration: 'none', fontWeight: 600 } }}>
                            <Box component="span" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, fontSize: 15, fontWeight: 600 }}>
                              {name(top.playerId, top.name)}
                              <Box component="span" sx={{ fontSize: 12, color: tokens.muted, fontWeight: 400 }}>{top.teamName}</Box>
                            </Box>
                            <Box component="span" sx={{ fontFamily: display, fontSize: 40, fontWeight: 700, color: tokens.home, lineHeight: 1 }}>
                              {top.value.toFixed(1)}
                            </Box>
                          </Box>
                          <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, '& a': { color: tokens.ink, textDecoration: 'none' } }}>
                            {rest.map((r) => (
                              <Box component="li" key={r.playerId} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 1, fontSize: 14, borderBottom: `1px solid ${tokens.page}` }}>
                                <Box component="span" sx={{ width: 16, color: tokens.muted, fontSize: 12 }}>{r.rank}</Box>
                                <Box component="span" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                                  <span>{name(r.playerId, r.name)}</span>
                                  <Box component="span" sx={{ fontSize: 12, color: tokens.muted }}>{r.teamName}</Box>
                                </Box>
                                <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{r.value.toFixed(1)}</Box>
                              </Box>
                            ))}
                          </Box>
                        </>
                      ) : (
                        <Muted>No qualified players yet.</Muted>
                      )}
                    </Card>
                  );
                })}
              </Box>
            )}
            <Box sx={{ mt: 1.5 }}>
              <Muted>Leaders need at least half of their team's games to qualify. PIR = FIBA Performance Index Rating.</Muted>
            </Box>
          </Box>
        </>
      )}
    </>
  );
}
