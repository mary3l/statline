import { Box, MenuItem, TextField } from '@mui/material';
import { useLineups, useMeta } from '../api/queries';
import type { LineupUnitRow } from '../api/types';
import { Card, ErrorState, Loading, Muted, PageHeader } from '../components/ui';
import { minutes, signed } from '../lib/format';
import { useUrlState } from '../lib/useUrlState';
import { display, tokens } from '../theme';

const SORTS = {
  pm: { label: '+/- (best first)', fn: (a: LineupUnitRow, b: LineupUnitRow) => b.plusMinus - a.plusMinus || b.seconds - a.seconds },
  min: { label: 'Minutes together', fn: (a: LineupUnitRow, b: LineupUnitRow) => b.seconds - a.seconds },
  for: { label: 'Points scored', fn: (a: LineupUnitRow, b: LineupUnitRow) => b.ptsFor - a.ptsFor },
  against: { label: 'Fewest points allowed', fn: (a: LineupUnitRow, b: LineupUnitRow) => a.ptsAgainst - b.ptsAgainst || b.seconds - a.seconds },
  worst: { label: '+/- (worst first)', fn: (a: LineupUnitRow, b: LineupUnitRow) => a.plusMinus - b.plusMinus },
} as const;
type SortKey = keyof typeof SORTS;

const MIN_MINUTES = [0, 2, 5, 10, 20];

/** Five-player units of one team: +/- while those five were on court together (from the substitutions). */
export function LineupsPage() {
  const meta = useMeta();
  const { params, set } = useUrlState();

  const seasonId = meta.data?.seasons.find((s) => String(s.year) === params.get('year'))?.id ?? meta.data?.currentSeasonId;
  const seasonYear = meta.data?.seasons.find((s) => s.id === seasonId)?.year;
  const leagues = (meta.data?.leagues ?? []).filter((l) => meta.data?.teams.some((t) => t.leagueId === l.id));
  const teamParam = Number(params.get('team'));
  const teamFromUrl = meta.data?.teams.find((t) => t.id === teamParam);
  const leagueId = teamFromUrl?.leagueId ?? leagues.find((l) => String(l.id) === params.get('league'))?.id ?? leagues[0]?.id;
  const leagueTeams = (meta.data?.teams ?? []).filter((t) => t.leagueId === leagueId);
  const teamId = teamFromUrl?.id ?? leagueTeams[0]?.id;

  const sort: SortKey = (params.get('sort') as SortKey) in SORTS ? (params.get('sort') as SortKey) : 'pm';
  const minMin = Number(params.get('min') ?? 0) || 0;
  const withPlayer = Number(params.get('player')) || undefined;

  const q = useLineups(teamId, seasonId);
  const allPlayers = new Map<number, string>();
  for (const u of q.data?.units ?? []) for (const p of u.players) allPlayers.set(p.playerId, `#${p.jersey} ${p.firstName} ${p.lastName}`);
  const units = (q.data?.units ?? [])
    .filter((u) => u.seconds >= minMin * 60)
    .filter((u) => !withPlayer || u.players.some((p) => p.playerId === withPlayer))
    .sort(SORTS[sort].fn);

  return (
    <>
      <PageHeader
        title="Lineups"
        subtitle={q.data ? `${q.data.team.name} · ${seasonYear} · ${q.data.games} game${q.data.games === 1 ? '' : 's'} · +/- while each five played together` : 'Five-player units and their +/-'}
      />

      <Box component="section" aria-label="Filters" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        <TextField select label="Year" value={seasonYear ? String(seasonYear) : ''} onChange={(e) => set({ year: e.target.value, player: undefined })} sx={{ flex: '1 1 110px' }}>
          {(meta.data?.seasons ?? []).map((s) => <MenuItem key={s.id} value={String(s.year)}>{s.year}</MenuItem>)}
        </TextField>
        <TextField select label="League" value={leagueId ? String(leagueId) : ''} onChange={(e) => set({ league: e.target.value, team: undefined, player: undefined })} sx={{ flex: '2 1 200px' }}>
          {leagues.map((l) => <MenuItem key={l.id} value={String(l.id)}>{l.name}</MenuItem>)}
        </TextField>
        <TextField select label="Team" value={teamId ? String(teamId) : ''} onChange={(e) => set({ team: e.target.value, player: undefined })} sx={{ flex: '2 1 200px' }}>
          {leagueTeams.map((t) => <MenuItem key={t.id} value={String(t.id)}>{t.name}</MenuItem>)}
        </TextField>
        <TextField select label="With player" value={withPlayer ? String(withPlayer) : ''} onChange={(e) => set({ player: e.target.value })} sx={{ flex: '2 1 200px' }}>
          <MenuItem value="">Anyone</MenuItem>
          {[...allPlayers.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true })).map(([id, name]) => (
            <MenuItem key={id} value={String(id)}>{name}</MenuItem>
          ))}
        </TextField>
        <TextField select label="Played together" value={String(minMin)} onChange={(e) => set({ min: e.target.value === '0' ? undefined : e.target.value })} sx={{ flex: '1 1 150px' }}>
          {MIN_MINUTES.map((m) => <MenuItem key={m} value={String(m)}>{m ? `${m}+ minutes` : 'Any time'}</MenuItem>)}
        </TextField>
        <TextField select label="Sort" value={sort} onChange={(e) => set({ sort: e.target.value === 'pm' ? undefined : e.target.value })} sx={{ flex: '1 1 190px' }}>
          {(Object.keys(SORTS) as SortKey[]).map((k) => <MenuItem key={k} value={k}>{SORTS[k].label}</MenuItem>)}
        </TextField>
      </Box>

      {meta.isPending || q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : units.length === 0 ? (
        <Muted>{q.data.units.length ? 'No lineup matches these filters.' : 'No finished games with play-by-play for this team yet.'}</Muted>
      ) : (
        <Card sx={{ p: 0 }}>
          <Box component="ol" aria-label="Lineups" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {units.map((u) => (
              <Box
                component="li"
                key={u.players.map((p) => p.playerId).join('-')}
                sx={{ display: 'flex', alignItems: 'center', gap: { xs: 2, sm: 3 }, p: { xs: '14px 16px', sm: '16px 24px' }, borderTop: `1px solid ${tokens.row}`, '&:first-of-type': { borderTop: 'none' } }}
              >
                <Box sx={{ width: 72, flex: 'none', textAlign: 'center' }}>
                  <Box sx={{ fontFamily: display, fontSize: 38, fontWeight: 700, lineHeight: 1, color: u.plusMinus > 0 ? tokens.away : u.plusMinus < 0 ? tokens.negative : tokens.ink }}>
                    {signed(u.plusMinus)}
                  </Box>
                  <Box sx={{ fontSize: 11, color: tokens.muted }}>points (+/-)</Box>
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Box sx={{ fontFamily: display, fontSize: { xs: 18, sm: 21 }, fontWeight: 600, lineHeight: 1.25 }}>
                    {u.players.map((p) => (
                      <Box component="span" key={p.playerId} sx={{ mr: 1.25, display: 'inline-block' }}>
                        #{p.jersey} {p.firstName[0]}. {p.lastName}
                      </Box>
                    ))}
                  </Box>
                  <Box sx={{ fontSize: 13, color: tokens.muted, mt: 0.25 }}>
                    {minutes(u.seconds)} min together · scored {u.ptsFor}, allowed {u.ptsAgainst} · {u.games} game{u.games === 1 ? '' : 's'}
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        </Card>
      )}
      <Muted>Lineups come from the starters and every substitution in the play-by-play. Minutes are rounded; units with less than a minute together still count toward the totals.</Muted>
    </>
  );
}
