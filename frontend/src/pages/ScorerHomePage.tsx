import { Box, Button } from '@mui/material';
import { Link } from 'react-router-dom';
import { useGames } from '../api/queries';
import type { Game } from '../api/types';
import { Card, ErrorState, Loading, Muted, PageHeader, SectionTitle } from '../components/ui';
import { formatDate, formatTime } from '../lib/format';
import { display, tokens } from '../theme';

function GameLine({ g, action }: { g: Game; action: string }) {
  const live = g.status === 'live';
  return (
    <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', py: 1.5, borderTop: `1px solid ${tokens.row}`, '&:first-of-type': { borderTop: 'none' } }}>
      <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
        <Box sx={{ fontSize: 12, color: tokens.muted }}>
          {formatDate(g.scheduledAt)} · {formatTime(g.scheduledAt)} · {g.league.name} · Game {g.gameNumber}
        </Box>
        <Box sx={{ fontWeight: 600, fontSize: 15 }}>
          <Box component="span" sx={{ color: tokens.home }}>{g.home.name}</Box>
          {live ? (
            <Box component="span" sx={{ fontFamily: display, fontSize: 20, mx: 1 }}>{g.home.score ?? 0} – {g.away.score ?? 0}</Box>
          ) : (
            <Box component="span" sx={{ color: tokens.muted, fontWeight: 400, mx: 1 }}>vs</Box>
          )}
          <Box component="span" sx={{ color: tokens.away }}>{g.away.name}</Box>
        </Box>
        <Box sx={{ fontSize: 12, color: tokens.muted }}>{g.venue ?? 'Venue to be announced'}</Box>
      </Box>
      <Button component={Link} to={`/games/${g.id}/record`} variant={live ? 'contained' : 'outlined'}>
        {action}
      </Button>
    </Box>
  );
}

/** Courtside entry point: games being recorded now, then games still to be played. */
export function ScorerHomePage() {
  const live = useGames({ status: 'live' });
  const scheduled = useGames({ status: 'scheduled' });
  // The API lists newest first; upcoming games read better soonest first.
  const upcoming = [...(scheduled.data?.items ?? [])].reverse();

  return (
    <>
      <PageHeader
        title="Live scorer"
        subtitle="Record a game courtside on a tablet. Every play is saved as it happens, and the box score fills in live."
      />
      <Card aria-labelledby="live-now">
        <SectionTitle id="live-now" aside="Continue where the scorer left off">Live now</SectionTitle>
        {live.isPending ? (
          <Loading />
        ) : live.error ? (
          <ErrorState error={live.error} onRetry={() => live.refetch()} />
        ) : live.data.items.length === 0 ? (
          <Muted>No game is being recorded right now.</Muted>
        ) : (
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {live.data.items.map((g) => <GameLine key={g.id} g={g} action="Continue recording" />)}
          </Box>
        )}
      </Card>
      <Card aria-labelledby="to-play">
        <SectionTitle id="to-play" aside="Set the lineups, then start">Scheduled games</SectionTitle>
        {scheduled.isPending ? (
          <Loading />
        ) : scheduled.error ? (
          <ErrorState error={scheduled.error} onRetry={() => scheduled.refetch()} />
        ) : upcoming.length === 0 ? (
          <Muted>There are no scheduled games this season.</Muted>
        ) : (
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {upcoming.map((g) => <GameLine key={g.id} g={g} action="Record this game" />)}
          </Box>
        )}
      </Card>
      <Muted>Works best on a tablet in landscape. Plays recorded while the Wi-Fi drops are kept on the device and sent when it comes back.</Muted>
    </>
  );
}
