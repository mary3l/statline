import { Alert, Box, Button, FormControlLabel, MenuItem, Switch, TextField } from '@mui/material';
import { useState } from 'react';
import { useCreateSeason, useMakeCurrentSeason, useSaveLeague } from '../../api/admin';
import { useMeta } from '../../api/queries';
import type { Gender, League } from '../../api/types';
import { Card, Muted } from '../../components/ui';
import { tokens } from '../../theme';
import { FormDialog } from './FormDialog';

const rule = (l: League) => {
  const parts = [l.gender === 'F' ? 'Women' : l.gender === 'M' ? 'Men' : 'Any gender'];
  if (l.minAge !== null && l.maxAge !== null) parts.push(`ages ${l.minAge}–${l.maxAge}`);
  else if (l.maxAge !== null) parts.push(`${l.maxAge} or younger`);
  else if (l.minAge !== null) parts.push(`${l.minAge} or older`);
  else parts.push('any age');
  return parts.join(' · ');
};

function LeagueForm({ league, onClose }: { league?: League; onClose: () => void }) {
  const save = useSaveLeague();
  const [name, setName] = useState(league?.name ?? '');
  const [level, setLevel] = useState(league?.level ?? '');
  const [gender, setGender] = useState<string>(league?.gender ?? '');
  const [minAge, setMin] = useState(league?.minAge?.toString() ?? '');
  const [maxAge, setMax] = useState(league?.maxAge?.toString() ?? '');
  const num = (v: string) => (v.trim() ? Number(v) : null);
  return (
    <FormDialog
      open
      title={league ? `Edit ${league.name}` : 'Add a league'}
      onClose={onClose}
      onSubmit={() =>
        save.mutate(
          { id: league?.id, name: name.trim(), level: level.trim(), gender: (gender || null) as Gender | null, minAge: num(minAge), maxAge: num(maxAge) },
          { onSuccess: onClose },
        )
      }
      pending={save.isPending}
      error={save.error}
    >
      <TextField label="League name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      <TextField label="Level" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="e.g. Barangay, Collegiate, Youth" required />
      <TextField select label="Who can play" value={gender} onChange={(e) => setGender(e.target.value)}>
        <MenuItem value="">Anyone</MenuItem>
        <MenuItem value="F">Women only</MenuItem>
        <MenuItem value="M">Men only</MenuItem>
      </TextField>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        <TextField type="number" label="Minimum age" value={minAge} onChange={(e) => setMin(e.target.value)} helperText="Age reached in the season year" />
        <TextField type="number" label="Maximum age" value={maxAge} onChange={(e) => setMax(e.target.value)} helperText="e.g. 18 for an U18 league" />
      </Box>
      {league && <Alert severity="info">New age or gender rules apply to new registrations and roster moves; players already on rosters stay.</Alert>}
    </FormDialog>
  );
}

export function LeaguesTab() {
  const meta = useMeta();
  const [editing, setEditing] = useState<League | 'new' | null>(null);
  const leagues = meta.data?.leagues ?? [];
  return (
    <Card sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
        <Box component="h2" sx={{ m: 0, fontSize: 15, fontWeight: 600 }}>Leagues · {leagues.length}</Box>
        <Button variant="contained" onClick={() => setEditing('new')}>Add league</Button>
      </Box>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {leagues.map((l) => (
          <Box component="li" key={l.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1, borderTop: `1px solid ${tokens.row}`, '&:first-of-type': { borderTop: 'none' } }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ fontWeight: 600, fontSize: 14 }}>{l.name}</Box>
              <Box sx={{ fontSize: 12, color: tokens.muted }}>
                {l.level} · {rule(l)} · {(meta.data?.teams ?? []).filter((t) => t.leagueId === l.id).length} teams
              </Box>
            </Box>
            <Button size="small" onClick={() => setEditing(l)} sx={{ minHeight: 36 }}>Edit</Button>
          </Box>
        ))}
      </Box>
      {editing && <LeagueForm league={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

export function SeasonsTab() {
  const meta = useMeta();
  const create = useCreateSeason();
  const makeCurrent = useMakeCurrentSeason();
  const [open, setOpen] = useState(false);
  const seasons = [...(meta.data?.seasons ?? [])].sort((a, b) => b.year - a.year);
  const [year, setYear] = useState(String(Math.max(new Date().getFullYear(), ...seasons.map((s) => s.year + 1))));
  const [current, setCurrent] = useState(false);
  return (
    <Card sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 640 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
        <Box component="h2" sx={{ m: 0, fontSize: 15, fontWeight: 600 }}>Seasons</Box>
        <Button variant="contained" onClick={() => setOpen(true)}>Add season</Button>
      </Box>
      <Muted>The current season is the one the registry, rosters, schedule and age groups use by default. Age groups follow the age a player reaches in the season year.</Muted>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {seasons.map((s) => (
          <Box component="li" key={s.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1, borderTop: `1px solid ${tokens.row}`, '&:first-of-type': { borderTop: 'none' } }}>
            <Box sx={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{s.name}</Box>
            {s.isCurrent ? (
              <Box component="span" sx={{ fontSize: 12, fontWeight: 600, color: tokens.away, bgcolor: '#E3ECF7', borderRadius: 999, px: 1.25, py: '3px' }}>Current</Box>
            ) : (
              <Button size="small" onClick={() => makeCurrent.mutate(s.id)} disabled={makeCurrent.isPending} sx={{ minHeight: 36 }}>Make current</Button>
            )}
          </Box>
        ))}
      </Box>
      {makeCurrent.error && <Alert severity="error">{makeCurrent.error.message}</Alert>}
      <FormDialog
        open={open}
        title="Add a season"
        onClose={() => setOpen(false)}
        onSubmit={() => create.mutate({ year: Number(year), isCurrent: current }, { onSuccess: () => setOpen(false) })}
        pending={create.isPending}
        error={create.error}
      >
        <TextField type="number" label="Year" value={year} onChange={(e) => setYear(e.target.value)} required />
        <FormControlLabel control={<Switch checked={current} onChange={(e) => setCurrent(e.target.checked)} />} label="Make it the current season" />
      </FormDialog>
    </Card>
  );
}
