import { Alert, Box, MenuItem, Tab, Tabs, TextField } from '@mui/material';
import { useMe, useMeta } from '../../api/queries';
import { ErrorState, Loading, PageHeader } from '../../components/ui';
import { useUrlState } from '../../lib/useUrlState';
import { LeaguesTab, SeasonsTab } from './LeaguesSeasonsTabs';
import { ScheduleTab } from './ScheduleTab';
import { TeamsTab } from './TeamsTab';

const TABS = [
  { key: 'schedule', label: 'Schedule' },
  { key: 'teams', label: 'Teams & rosters' },
  { key: 'leagues', label: 'Leagues' },
  { key: 'seasons', label: 'Seasons' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/** League office set-up (M2): the schedule, teams and rosters, leagues and seasons. */
export function AdminPage() {
  const { data: user } = useMe();
  const meta = useMeta();
  const { params, set } = useUrlState();
  const tab: TabKey = TABS.some((t) => t.key === params.get('tab')) ? (params.get('tab') as TabKey) : 'schedule';

  if (user && user.role === 'scorer') {
    return (
      <>
        <PageHeader title="League office" />
        <Alert severity="info">Only league organizers and admins can change the schedule, teams and leagues.</Alert>
      </>
    );
  }
  if (meta.isPending) return <Loading />;
  if (meta.error) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />;

  const seasonId = meta.data.seasons.find((s) => String(s.year) === params.get('year'))?.id ?? meta.data.currentSeasonId;
  const seasonYear = meta.data.seasons.find((s) => s.id === seasonId)?.year;
  const leagueId = meta.data.leagues.find((l) => String(l.id) === params.get('league'))?.id ?? meta.data.leagues[0]?.id;
  const needsLeague = tab === 'schedule' || tab === 'teams';

  return (
    <>
      <PageHeader title="League office" subtitle="Schedule games, manage teams and rosters, and set up leagues and seasons." />
      <Tabs value={tab} onChange={(_, v: TabKey) => set({ tab: v === 'schedule' ? undefined : v })} variant="scrollable" allowScrollButtonsMobile aria-label="League office sections">
        {TABS.map((t) => <Tab key={t.key} value={t.key} label={t.label} />)}
      </Tabs>
      {needsLeague && (
        <Box component="section" aria-label="Filters" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
          <TextField select label="Season" value={seasonYear ? String(seasonYear) : ''} onChange={(e) => set({ year: e.target.value })} sx={{ flex: '1 1 140px' }}>
            {meta.data.seasons.map((s) => <MenuItem key={s.id} value={String(s.year)}>{s.year}{s.isCurrent ? ' (current)' : ''}</MenuItem>)}
          </TextField>
          <TextField select label="League" value={leagueId ? String(leagueId) : ''} onChange={(e) => set({ league: e.target.value })} sx={{ flex: '3 1 240px' }}>
            {meta.data.leagues.map((l) => <MenuItem key={l.id} value={String(l.id)}>{l.name}</MenuItem>)}
          </TextField>
        </Box>
      )}
      {needsLeague && (!seasonId || !leagueId) ? (
        <Alert severity="info">Add a season and a league first.</Alert>
      ) : tab === 'schedule' ? (
        <ScheduleTab key={`${seasonId}-${leagueId}`} seasonId={seasonId!} leagueId={leagueId!} />
      ) : tab === 'teams' ? (
        <TeamsTab key={leagueId} seasonId={seasonId!} leagueId={leagueId!} />
      ) : tab === 'leagues' ? (
        <LeaguesTab />
      ) : (
        <SeasonsTab />
      )}
    </>
  );
}
