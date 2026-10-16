import { Alert, Box, Button, Menu, MenuItem, TextField } from '@mui/material';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDeleteGame, useForfeit, useSaveGame, useScheduleConflicts } from '../../api/admin';
import { useGames, useMeta } from '../../api/queries';
import type { Game } from '../../api/types';
import { Card, ErrorState, Loading, Muted } from '../../components/ui';
import { formatDate, formatTime, fromManila, manilaParts } from '../../lib/format';
import { tokens } from '../../theme';
import { FormDialog } from './FormDialog';

const STATUS = { scheduled: 'Scheduled', live: 'Live', final: 'Final', forfeit: 'Forfeit' } as const;

function GameForm({ leagueId, seasonId, game, onClose }: { leagueId: number; seasonId: number; game?: Game; onClose: () => void }) {
  const meta = useMeta();
  const save = useSaveGame();
  const teams = (meta.data?.teams ?? []).filter((t) => t.leagueId === leagueId);
  const start = game ? manilaParts(game.scheduledAt) : { date: '', time: '14:00' };
  const [home, setHome] = useState(game ? String(game.home.id) : '');
  const [away, setAway] = useState(game ? String(game.away.id) : '');
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [venue, setVenue] = useState(game?.venue ?? '');
  const [problem, setProblem] = useState('');
  const locked = !!game && game.status !== 'scheduled';

  const conflicts = useScheduleConflicts([Number(home), Number(away)], date, game?.id);
  const nameOf = (id: number) => teams.find((t) => t.id === id)?.name ?? 'A team';
  const clashes = (conflicts.data?.games ?? []).map((g) => {
    const who = [g.homeTeamId, g.awayTeamId].filter((id) => id === Number(home) || id === Number(away)).map(nameOf).join(' and ');
    return `${who} already play${who.includes(' and ') ? '' : 's'} at ${formatTime(g.scheduledAt)} that day.`;
  });

  const submit = () => {
    if (!home || !away) return setProblem('Pick both teams.');
    if (home === away) return setProblem('A team cannot play itself.');
    if (!date || !time) return setProblem('Set the date and tip-off time.');
    setProblem('');
    save.mutate(
      { id: game?.id, leagueId, seasonId, homeTeamId: Number(home), awayTeamId: Number(away), scheduledAt: fromManila(date, time), venue: venue.trim() || null },
      { onSuccess: onClose },
    );
  };

  return (
    <FormDialog open title={game ? `Edit game ${game.gameNumber}` : 'Add a game'} onClose={onClose} onSubmit={submit} pending={save.isPending} error={save.error}>
      {locked && <Alert severity="info">This game has started, so only the date, time and venue can change.</Alert>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        <TextField select label="Home team" value={home} onChange={(e) => setHome(e.target.value)} disabled={locked} required>
          {teams.map((t) => <MenuItem key={t.id} value={String(t.id)}>{t.name}</MenuItem>)}
        </TextField>
        <TextField select label="Away team" value={away} onChange={(e) => setAway(e.target.value)} disabled={locked} required>
          {teams.map((t) => <MenuItem key={t.id} value={String(t.id)} disabled={String(t.id) === home}>{t.name}</MenuItem>)}
        </TextField>
        <TextField type="date" label="Date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <TextField type="time" label="Tip-off (Davao time)" value={time} onChange={(e) => setTime(e.target.value)} required />
      </Box>
      <TextField label="Venue" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Matina Covered Court" />
      {clashes.length > 0 && <Alert severity="warning">{clashes.join(' ')}</Alert>}
      {problem && <Alert severity="error">{problem}</Alert>}
    </FormDialog>
  );
}

function GameActions({ g, onEdit }: { g: Game; onEdit: () => void }) {
  const del = useDeleteGame();
  const forfeit = useForfeit();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const error = del.error ?? forfeit.error;
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <Button size="small" variant="outlined" onClick={onEdit} sx={{ minHeight: 36 }}>Edit</Button>
      {g.status === 'scheduled' && (
        <>
          <Button size="small" variant="outlined" onClick={(e) => setAnchor(e.currentTarget)} sx={{ minHeight: 36 }} aria-haspopup="menu">
            Forfeit…
          </Button>
          <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
            {(['home', 'away'] as const).map((side) => (
              <MenuItem key={side} onClick={() => { setAnchor(null); forfeit.mutate({ id: g.id, forfeitedBy: side }); }}>
                {g[side].name} forfeited (recorded 0–20)
              </MenuItem>
            ))}
          </Menu>
          <Button
            size="small"
            color="error"
            onClick={() => window.confirm(`Delete game ${g.gameNumber}, ${g.home.name} vs ${g.away.name}?`) && del.mutate(g.id)}
            sx={{ minHeight: 36 }}
          >
            Delete
          </Button>
        </>
      )}
      {g.status === 'forfeit' && (
        <Button size="small" onClick={() => forfeit.mutate({ id: g.id, forfeitedBy: null })} sx={{ minHeight: 36 }}>Undo forfeit</Button>
      )}
      {error && <Box role="alert" sx={{ width: '100%', textAlign: 'right', fontSize: 12, color: tokens.negative }}>{error.message}</Box>}
    </Box>
  );
}

export function ScheduleTab({ seasonId, leagueId }: { seasonId: number; leagueId: number }) {
  const games = useGames({ seasonId, leagueId });
  const [editing, setEditing] = useState<Game | 'new' | null>(null);
  const list = [...(games.data?.items ?? [])].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.gameNumber - b.gameNumber);

  return (
    <Card sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box component="h2" sx={{ m: 0, fontSize: 15, fontWeight: 600 }}>Schedule · {list.length} game{list.length === 1 ? '' : 's'}</Box>
        <Button variant="contained" onClick={() => setEditing('new')}>Add game</Button>
      </Box>
      {games.isPending ? (
        <Loading />
      ) : games.error ? (
        <ErrorState error={games.error} onRetry={() => games.refetch()} />
      ) : list.length === 0 ? (
        <Muted>No games scheduled in this league yet.</Muted>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {list.map((g) => (
            <Box component="li" key={g.id} sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', py: 1.25, borderTop: `1px solid ${tokens.row}`, '&:first-of-type': { borderTop: 'none' } }}>
              <Box sx={{ flex: '1 1 300px', minWidth: 0 }}>
                <Box sx={{ fontSize: 12, color: tokens.muted }}>
                  Game {g.gameNumber} · {formatDate(g.scheduledAt)} · {formatTime(g.scheduledAt)} · {g.venue ?? 'Venue to be announced'}
                </Box>
                <Box sx={{ fontWeight: 600 }}>
                  <Link to={`/games/${g.id}`}>{g.home.name} vs {g.away.name}</Link>
                  <Box component="span" sx={{ ml: 1, fontSize: 12, fontWeight: 500, color: g.status === 'live' ? tokens.home : tokens.muted }}>
                    {STATUS[g.status]}{g.status !== 'scheduled' && g.home.score !== null ? ` ${g.home.score}–${g.away.score}` : ''}
                  </Box>
                </Box>
              </Box>
              <GameActions g={g} onEdit={() => setEditing(g)} />
            </Box>
          ))}
        </Box>
      )}
      {editing && <GameForm leagueId={leagueId} seasonId={seasonId} game={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}
