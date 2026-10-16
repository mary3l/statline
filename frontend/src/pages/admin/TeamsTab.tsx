import { Alert, Box, Button, TextField } from '@mui/material';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAddToRoster, useReleaseFromRoster, useSaveTeam, useTeamRoster } from '../../api/admin';
import { useMeta, usePlayers } from '../../api/queries';
import type { Team } from '../../api/types';
import { Card, ErrorState, Loading, Muted, StatusChip } from '../../components/ui';
import { formatDay } from '../../lib/format';
import { display, tokens } from '../../theme';
import { FormDialog } from './FormDialog';

function TeamForm({ leagueId, team, onClose }: { leagueId: number; team?: Team; onClose: () => void }) {
  const save = useSaveTeam();
  const [name, setName] = useState(team?.name ?? '');
  const [shortName, setShort] = useState(team?.shortName ?? '');
  const [color, setColor] = useState(team?.color ?? '#B5480E');
  return (
    <FormDialog
      open
      title={team ? `Edit ${team.name}` : 'Add a team'}
      onClose={onClose}
      onSubmit={() => save.mutate({ id: team?.id, leagueId, name: name.trim(), shortName: shortName.trim(), color }, { onSuccess: onClose })}
      pending={save.isPending}
      error={save.error}
    >
      <TextField label="Team name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        <TextField label="Short name (2–5 letters)" value={shortName} onChange={(e) => setShort(e.target.value.toUpperCase().slice(0, 5))} required helperText="Shown on scoreboards, e.g. MAV" />
        <TextField type="color" label="Team colour" value={color} onChange={(e) => setColor(e.target.value)} />
      </Box>
    </FormDialog>
  );
}

function AddPlayer({ teamId, seasonId }: { teamId: number; seasonId: number }) {
  const [q, setQ] = useState('');
  const [jersey, setJersey] = useState<Record<number, string>>({});
  const players = usePlayers({ q: q.trim(), pageSize: 8 }, q.trim().length >= 2);
  const add = useAddToRoster(teamId);
  const [done, setDone] = useState('');
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <TextField label="Add a registered player" placeholder="Search by name" value={q} onChange={(e) => { setQ(e.target.value); setDone(''); }} />
      {q.trim().length >= 2 && (
        players.isPending ? (
          <Loading label="Searching…" />
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {(players.data?.items ?? []).map((p) => (
              <Box component="li" key={p.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75, flexWrap: 'wrap' }}>
                <Box sx={{ flex: '1 1 200px', fontSize: 14 }}>
                  {p.firstName} {p.lastName}
                  <Box component="span" sx={{ color: tokens.muted, fontSize: 12 }}> · {p.ageGroup} · {p.team ? `on ${p.team.name}` : 'free agent'}</Box>
                </Box>
                <TextField
                  size="small"
                  label="Jersey"
                  value={jersey[p.id] ?? ''}
                  onChange={(e) => setJersey({ ...jersey, [p.id]: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) })}
                  sx={{ width: 90 }}
                />
                <Button
                  size="small"
                  variant="outlined"
                  disabled={!jersey[p.id] || add.isPending}
                  onClick={() => add.mutate({ playerId: p.id, jersey: jersey[p.id]!, seasonId }, { onSuccess: () => { setDone(`${p.firstName} ${p.lastName} added as #${jersey[p.id]}.`); setQ(''); } })}
                  sx={{ minHeight: 40 }}
                >
                  Add
                </Button>
              </Box>
            ))}
            {players.data?.items.length === 0 && <Muted>No registered player matches. Register them first on the Players page.</Muted>}
          </Box>
        )
      )}
      {done && <Alert severity="success">{done}</Alert>}
      {add.error && <Alert severity="error">{add.error.message}</Alert>}
    </Box>
  );
}

function Roster({ team, seasonId }: { team: Team; seasonId: number }) {
  const roster = useTeamRoster(team.id, seasonId);
  const release = useReleaseFromRoster();
  const active = (roster.data?.players ?? []).filter((p) => !p.leftOn).sort((a, b) => Number(a.jersey) - Number(b.jersey));
  const gone = (roster.data?.players ?? []).filter((p) => p.leftOn);
  return (
    <Card sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box component="h2" sx={{ m: 0, fontSize: 15, fontWeight: 600 }}>
        {team.name} roster · {roster.data?.season.year ?? ''} · {active.length} player{active.length === 1 ? '' : 's'}
      </Box>
      {roster.isPending ? (
        <Loading />
      ) : roster.error ? (
        <ErrorState error={roster.error} onRetry={() => roster.refetch()} />
      ) : (
        <>
          {active.length === 0 && <Muted>No one on this roster yet.</Muted>}
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {active.map((p) => (
              <Box component="li" key={p.entryId} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75, borderTop: `1px solid ${tokens.row}`, '&:first-of-type': { borderTop: 'none' } }}>
                <Box sx={{ fontFamily: display, fontSize: 22, fontWeight: 700, width: 36, textAlign: 'center', color: team.color }}>{p.jersey}</Box>
                <Box sx={{ flex: 1, minWidth: 0, fontSize: 14 }}>
                  <Link to={`/players/${p.playerId}`}>{p.firstName} {p.lastName}</Link>
                  <Box component="span" sx={{ color: tokens.muted, fontSize: 12 }}> · {p.position}</Box>
                </Box>
                {p.status !== 'available' && <StatusChip status={p.status} />}
                <Button
                  size="small"
                  color="error"
                  onClick={() => window.confirm(`Release ${p.firstName} ${p.lastName} from ${team.name}? Their past games stay in the records.`) && release.mutate(p.entryId)}
                  sx={{ minHeight: 36 }}
                >
                  Release
                </Button>
              </Box>
            ))}
          </Box>
          {gone.length > 0 && (
            <Muted>Released this season: {gone.map((p) => `#${p.jersey} ${p.firstName} ${p.lastName} (${formatDay(p.leftOn!)})`).join(', ')}</Muted>
          )}
          {release.error && <Alert severity="error">{release.error.message}</Alert>}
          <AddPlayer teamId={team.id} seasonId={seasonId} />
        </>
      )}
    </Card>
  );
}

export function TeamsTab({ seasonId, leagueId }: { seasonId: number; leagueId: number }) {
  const meta = useMeta();
  const teams = (meta.data?.teams ?? []).filter((t) => t.leagueId === leagueId);
  const [editing, setEditing] = useState<Team | 'new' | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const team = teams.find((t) => t.id === selected) ?? teams[0];

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1.4fr)' }, gap: 3, alignItems: 'start' }}>
      <Card sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
          <Box component="h2" sx={{ m: 0, fontSize: 15, fontWeight: 600 }}>Teams · {teams.length}</Box>
          <Button variant="contained" onClick={() => setEditing('new')}>Add team</Button>
        </Box>
        {teams.length === 0 && <Muted>No teams in this league yet.</Muted>}
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {teams.map((t) => (
            <Box component="li" key={t.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.75, borderTop: `1px solid ${tokens.row}`, '&:first-of-type': { borderTop: 'none' } }}>
              <Box aria-hidden="true" sx={{ width: 14, height: 14, borderRadius: '4px', bgcolor: t.color, flex: 'none' }} />
              <Box
                component="button"
                type="button"
                aria-pressed={team?.id === t.id}
                onClick={() => setSelected(t.id)}
                sx={{ flex: 1, minHeight: 40, textAlign: 'left', border: 'none', bgcolor: team?.id === t.id ? tokens.page : 'transparent', borderRadius: '8px', px: 1, font: 'inherit', fontSize: 14, fontWeight: team?.id === t.id ? 600 : 400, cursor: 'pointer', color: tokens.ink }}
              >
                {t.name} <Box component="span" sx={{ color: tokens.muted, fontSize: 12 }}>· {t.shortName}</Box>
              </Box>
              <Button size="small" onClick={() => setEditing(t)} sx={{ minHeight: 36 }}>Edit</Button>
            </Box>
          ))}
        </Box>
      </Card>
      {team && <Roster key={`${team.id}-${seasonId}`} team={team} seasonId={seasonId} />}
      {editing && <TeamForm leagueId={leagueId} team={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </Box>
  );
}
