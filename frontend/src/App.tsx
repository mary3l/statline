import { Box, Button } from '@mui/material';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { PageHeader } from './components/ui';
import { AdminPage } from './pages/admin/AdminPage';
import { BoxScorePage } from './pages/BoxScorePage';
import { GamesPage } from './pages/GamesPage';
import { LeadersPage } from './pages/LeadersPage';
import { LineupsPage } from './pages/LineupsPage';
import { LoginPage } from './pages/LoginPage';
import { MatchupPage } from './pages/MatchupPage';
import { PlayerProfilePage } from './pages/PlayerProfilePage';
import { PlayersPage } from './pages/PlayersPage';
import { RecorderPage } from './pages/RecorderPage';
import { ScorerHomePage } from './pages/ScorerHomePage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* The courtside recorder is full screen, outside the office layout. */}
      <Route path="/games/:id/record" element={<RequireAuth><RecorderPage /></RequireAuth>} />
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/games" replace />} />
        <Route path="/players" element={<RequireAuth><PlayersPage /></RequireAuth>} />
        <Route path="/players/:id" element={<RequireAuth><PlayerProfilePage /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
        <Route path="/record" element={<RequireAuth><ScorerHomePage /></RequireAuth>} />
        <Route path="/games" element={<GamesPage />} />
        <Route path="/games/:id" element={<BoxScorePage />} />
        <Route path="/leaders" element={<LeadersPage />} />
        <Route path="/lineups" element={<LineupsPage />} />
        <Route path="/matchup" element={<MatchupPage />} />
        <Route
          path="*"
          element={
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
              <PageHeader title="Page not found" subtitle="That address doesn't match any STATLINE page." />
              <Button component={Link} to="/games" variant="contained">Go to box scores</Button>
            </Box>
          }
        />
      </Route>
    </Routes>
  );
}
