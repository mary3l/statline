import { Box, Button, MenuItem, Pagination, Snackbar, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMe, useMeta, usePlayers, type PlayerFilters } from '../api/queries';
import type { Gender, PlayerStatus } from '../api/types';
import { Card, ErrorState, Loading, Muted, PageHeader, Pill, StatTile, StatusChip, TableScroll, TileGrid, tableSx } from '../components/ui';
import { GENDER_LABEL, initials } from '../lib/format';
import { tokens } from '../theme';
import { RegisterPlayerForm } from './RegisterPlayerForm';

const PAGE_SIZE = 25;

export function PlayersPage() {
  const { data: user } = useMe();
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  const [created, setCreated] = useState<{ id: number; name: string } | null>(null);
  const [search, setSearch] = useState(params.get('q') ?? '');

  const filters: PlayerFilters = {
    q: params.get('q') ?? undefined,
    gender: (params.get('gender') as Gender) || undefined,
    leagueId: params.get('league') ? Number(params.get('league')) : undefined,
    ageGroup: params.get('group') ?? undefined,
    status: (params.get('status') as PlayerStatus) || undefined,
    sort: params.get('sort') === 'recent' ? 'recent' : 'name',
    page: Number(params.get('page') ?? 1),
    pageSize: PAGE_SIZE,
  };
  const players = usePlayers(filters);

  const update = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== search.trim()) update({ q: search.trim() || undefined });
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const canRegister = user?.role === 'admin' || user?.role === 'organizer';
  const data = players.data;
  const seasonYear = data?.season.year ?? new Date().getFullYear();

  const select = (id: string, label: string, value: string, options: { v: string; label: string }[], key: string) => (
    <TextField
      id={id}
      select
      label={label}
      value={value}
      onChange={(e) => update({ [key]: e.target.value || undefined })}
      sx={{ flex: '1 1 150px' }}
    >
      <MenuItem value="">All</MenuItem>
      {options.map((o) => (
        <MenuItem key={o.v} value={o.v}>{o.label}</MenuItem>
      ))}
    </TextField>
  );

  const anyFilter = !!(filters.q || filters.gender || filters.leagueId || filters.ageGroup || filters.status);

  return (
    <>
      <PageHeader
        title="Player registry"
        subtitle={`Every registered player across all leagues · ${seasonYear} season`}
        action={
          canRegister && (
            <Button
              variant="contained"
              color="inherit"
              onClick={() => setShowForm((s) => !s)}
              aria-expanded={showForm}
              sx={{ bgcolor: tokens.ink, color: '#FFFFFF', '&:hover': { bgcolor: '#2A2E37' } }}
              startIcon={
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  {showForm ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M12 5v14M5 12h14" />}
                </svg>
              }
            >
              {showForm ? 'Close form' : 'Register player'}
            </Button>
          )
        }
      />

      <TileGrid>
        <StatTile label="Registered" value={data?.summary.registered ?? '–'} />
        <StatTile label="Women" value={data?.summary.women ?? '–'} />
        <StatTile label="Men" value={data?.summary.men ?? '–'} />
        <StatTile label="Available" value={data?.summary.available ?? '–'} />
        <StatTile label="Injured or suspended" value={data?.summary.unavailable ?? '–'} />
      </TileGrid>

      {showForm && meta.data && (
        <RegisterPlayerForm
          meta={meta.data}
          seasonYear={seasonYear}
          onDone={(p) => {
            setShowForm(false);
            setCreated(p);
            setSearch('');
            setParams(new URLSearchParams({ sort: 'recent' }), { replace: true });
          }}
        />
      )}

      <Box component="section" aria-label="Filters" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-end' }}>
        <TextField
          id="q"
          type="search"
          label="Search"
          placeholder="Name, team or jersey #"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: '2 1 240px' }}
        />
        {select('f-gender', 'Gender', filters.gender ?? '', [{ v: 'F', label: 'Female' }, { v: 'M', label: 'Male' }], 'gender')}
        {select('f-league', 'League', filters.leagueId ? String(filters.leagueId) : '', (meta.data?.leagues ?? []).map((l) => ({ v: String(l.id), label: l.name })), 'league')}
        {select('f-group', 'Age group', filters.ageGroup ?? '', (meta.data?.ageGroups ?? []).map((g) => ({ v: g, label: g })), 'group')}
        {select('f-status', 'Status', filters.status ?? '', [
          { v: 'available', label: 'Available' },
          { v: 'injured', label: 'Injured' },
          { v: 'suspended', label: 'Suspended' },
        ], 'status')}
        <TextField
          id="f-sort"
          select
          label="Sort"
          value={filters.sort}
          onChange={(e) => update({ sort: e.target.value === 'recent' ? 'recent' : undefined })}
          sx={{ flex: '1 1 170px' }}
        >
          <MenuItem value="name">Last name A–Z</MenuItem>
          <MenuItem value="recent">Recently registered</MenuItem>
        </TextField>
      </Box>

      <Card sx={{ p: { xs: '8px 0 4px', sm: '8px 0 4px' } }} aria-labelledby="plist">
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1, p: '12px 20px 8px' }}>
          <Box component="h2" id="plist" sx={{ m: 0, fontSize: 14, fontWeight: 600, color: tokens.muted }}>
            {data ? (anyFilter ? `${data.total} of ${data.summary.registered} players` : `All ${data.total} players`) : 'Players'}
          </Box>
          {anyFilter && (
            <Button size="small" onClick={() => { setSearch(''); setParams(new URLSearchParams(), { replace: true }); }}>
              Clear filters
            </Button>
          )}
        </Box>
        {players.isPending ? (
          <Box sx={{ px: 2.5 }}><Loading /></Box>
        ) : players.error ? (
          <Box sx={{ p: 2.5 }}><ErrorState error={players.error} onRetry={() => players.refetch()} /></Box>
        ) : (
          <>
            <TableScroll>
              <Box component="table" sx={[tableSx, { opacity: players.isPlaceholderData ? 0.6 : 1, '& th:first-of-type, & td:first-of-type': { pl: 2.5 }, '& th:last-of-type, & td:last-of-type': { pr: 2.5 } }]}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th scope="col">Player</th>
                    <th scope="col">Age</th>
                    <th scope="col">Gender</th>
                    <th scope="col">Age group</th>
                    <th scope="col">Height · Weight</th>
                    <th scope="col">Current team</th>
                    <th scope="col">Leagues played</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.items.map((p) => (
                    <tr key={p.id}>
                      <th scope="row">
                        <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Box component="span" aria-hidden="true" sx={{ width: 38, height: 38, flex: '0 0 38px', borderRadius: '50%', bgcolor: tokens.avatar, color: tokens.homeDark, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>
                            {initials(p.firstName, p.lastName)}
                          </Box>
                          <Box component="span" sx={{ display: 'flex', flexDirection: 'column' }}>
                            <Link to={`/players/${p.id}`}>{p.firstName} {p.lastName}</Link>
                            <Box component="span" sx={{ fontSize: 12, color: tokens.muted, fontWeight: 400 }}>
                              {p.jersey ? `#${p.jersey} · ` : ''}{p.position}
                            </Box>
                          </Box>
                        </Box>
                      </th>
                      <td>{p.age}</td>
                      <td>{GENDER_LABEL[p.gender]}</td>
                      <td><Pill outlined>{p.ageGroup}</Pill></td>
                      <td>{p.heightCm ? `${p.heightCm} cm` : '—'} · {p.weightKg ? `${p.weightKg} kg` : '—'}</td>
                      <td>{p.team?.name ?? <Box component="span" sx={{ color: tokens.muted }}>Free agent</Box>}</td>
                      <td>
                        <Box component="span" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: 320, whiteSpace: 'normal' }}>
                          {p.leagues.length ? p.leagues.map((l) => <Pill key={l.id}>{l.name}</Pill>) : <Pill>None yet</Pill>}
                        </Box>
                      </td>
                      <td><StatusChip status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </Box>
            </TableScroll>
            {data!.items.length === 0 && (
              <Box component="p" sx={{ m: 0, p: '28px 20px', color: tokens.muted, fontSize: 14 }}>No players match these filters.</Box>
            )}
            {data!.total > PAGE_SIZE && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
                <Pagination
                  count={Math.ceil(data!.total / PAGE_SIZE)}
                  page={filters.page}
                  onChange={(_, page) => update({ page: page > 1 ? String(page) : undefined })}
                />
              </Box>
            )}
          </>
        )}
      </Card>

      <Muted>
        Age group follows birth year: the age a player reaches in {seasonYear} decides the category (U12, U14, U16, U18, Open, Masters 35+).
      </Muted>

      <Snackbar
        open={!!created}
        autoHideDuration={8000}
        onClose={() => setCreated(null)}
        message={created ? `${created.name} is registered.` : ''}
        action={
          created && (
            <Button component={Link} to={`/players/${created.id}`} size="small" sx={{ color: '#F5B85A', minHeight: 32 }}>
              View profile
            </Button>
          )
        }
      />
    </>
  );
}
