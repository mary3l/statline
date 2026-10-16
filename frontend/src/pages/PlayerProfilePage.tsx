import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMe, usePlayer, useSetStatus } from '../api/queries';
import { BirthCertificate, PlayerPhoto } from '../components/PlayerFiles';
import type { PlayerProfile, PlayerStatus } from '../api/types';
import { Card, ErrorState, Loading, Muted, Pill, SectionTitle, StatTile, StatusChip, TableScroll, TileGrid, tableSx } from '../components/ui';
import { formatDate, formatDay, GENDER_LABEL, minutes, perGame, POSITION_LABEL, signed } from '../lib/format';
import { display, tokens } from '../theme';

function BackLink() {
  return (
    <Box component={Link} to="/players" sx={{ fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 0.75, minHeight: 32, textDecoration: 'none', alignSelf: 'flex-start' }}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      All players
    </Box>
  );
}

function DefRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 1.25, borderTop: `1px solid ${tokens.row}` }}>
      <Box component="dt" sx={{ color: tokens.muted, fontSize: 14 }}>{label}</Box>
      <Box component="dd" sx={{ m: 0, fontWeight: 600, textAlign: 'right' }}>{value}</Box>
    </Box>
  );
}

function StatusDialog({ player, open, onClose }: { player: PlayerProfile; open: boolean; onClose: () => void }) {
  const setStatus = useSetStatus(player.id);
  const [status, setStatusValue] = useState<PlayerStatus>(player.status === 'available' ? 'injured' : 'available');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const needsTitle = status !== 'available';

  const save = () =>
    setStatus.mutate(
      { status, title: needsTitle ? title.trim() : undefined, detail: detail.trim() || undefined },
      { onSuccess: onClose },
    );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Change availability</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <TextField select label="Status" value={status} onChange={(e) => setStatusValue(e.target.value as PlayerStatus)}>
          <MenuItem value="available">Available (clears the open injury or suspension)</MenuItem>
          <MenuItem value="injured">Injured</MenuItem>
          <MenuItem value="suspended">Suspended</MenuItem>
        </TextField>
        {needsTitle && (
          <TextField
            label={status === 'injured' ? 'Injury' : 'Suspension'}
            placeholder={status === 'injured' ? 'e.g. Ankle sprain' : 'e.g. 2 games'}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        )}
        <TextField label="Notes (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} multiline minRows={2} />
        {setStatus.error && <Alert severity="error">{setStatus.error.message}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={setStatus.isPending || (needsTitle && !title.trim())}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function PlayerProfilePage() {
  const id = Number(useParams().id);
  const { data: user } = useMe();
  const player = usePlayer(id);
  const [editing, setEditing] = useState(false);

  if (player.isPending) return <><BackLink /><Loading /></>;
  if (player.error) return <><BackLink /><ErrorState error={player.error} onRetry={() => player.refetch()} /></>;
  const p = player.data;
  const canEdit = user?.role === 'admin' || user?.role === 'organizer';
  const s = p.thisSeason;
  const name = `${p.firstName} ${p.lastName}`;

  return (
    <>
      <BackLink />

      <Card component="header" sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', p: { xs: '20px', sm: '24px 28px' } }}>
        <PlayerPhoto p={p} canEdit={canEdit} />
        <Box sx={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
            <Box component="h1" sx={{ m: 0, fontFamily: display, fontSize: { xs: 36, sm: 44 }, fontWeight: 700, lineHeight: 1 }}>{name}</Box>
            <StatusChip status={p.status} />
            {canEdit && (
              <Button size="small" variant="outlined" onClick={() => setEditing(true)} sx={{ minHeight: 32 }}>
                Change status
              </Button>
            )}
          </Box>
          <Box sx={{ fontSize: 15, color: tokens.muted }}>
            {[p.current ? `#${p.current.jersey}` : null, POSITION_LABEL[p.position], p.current?.teamName ?? 'Free agent'].filter(Boolean).join(' · ')}
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, pt: 0.5 }}>
            {p.leagues.map((l) => <Pill key={l.id}>{l.name}</Pill>)}
          </Box>
        </Box>
        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 32px', flex: '1 1 280px' }}>
          {[
            ['Age', p.age],
            ['Gender', GENDER_LABEL[p.gender]],
            ['Birthdate', formatDay(p.birthdate)],
            ['Age group', p.ageGroup],
          ].map(([k, v]) => (
            <Box key={k}>
              <Box component="dt" sx={{ fontSize: 12, color: tokens.muted }}>{k}</Box>
              <Box component="dd" sx={{ m: '2px 0 0', fontSize: 18, fontWeight: 600 }}>{v}</Box>
            </Box>
          ))}
        </Box>
      </Card>

      <Box component="section" aria-labelledby="avg">
        <SectionTitle id="avg">
          {p.season.year} season{s ? ` · ${s.leagueName}` : ''}
        </SectionTitle>
        {s ? (
          <TileGrid min={150}>
            <StatTile size={36} label="Games" value={s.gp} />
            <StatTile size={36} label="Minutes / game" value={perGame(s.seconds / 60, s.gp)} />
            <StatTile size={36} label="Points / game" value={perGame(s.pts, s.gp)} />
            <StatTile size={36} label="Rebounds / game" value={perGame(s.reb, s.gp)} />
            <StatTile size={36} label="Assists / game" value={perGame(s.ast, s.gp)} />
            <StatTile size={36} label="PIR / game" value={perGame(s.pir, s.gp)} />
          </TileGrid>
        ) : (
          <Muted>No games played this season yet.</Muted>
        )}
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        <Card aria-labelledby="phys" sx={{ flex: '1 1 300px' }}>
          <SectionTitle id="phys">Physical profile</SectionTitle>
          <Box component="dl" sx={{ m: 0 }}>
            <DefRow label="Height" value={p.heightCm ? `${p.heightCm} cm` : '—'} />
            <DefRow label="Weight" value={p.weightKg ? `${p.weightKg} kg` : '—'} />
            <DefRow label="Position" value={p.secondaryPosition ? `${p.position} / ${p.secondaryPosition}` : p.position} />
            <DefRow label="Dominant hand" value={p.dominantHand ?? '—'} />
            <DefRow label="Jersey" value={p.current ? `#${p.current.jersey}` : '—'} />
          </Box>
        </Card>

        <Card aria-labelledby="elig" sx={{ flex: '1 1 300px' }}>
          <Box component="h2" id="elig" sx={{ m: '0 0 4px', fontSize: 15, fontWeight: 600 }}>Age-group eligibility · {p.season.year}</Box>
          <Box component="p" sx={{ m: '0 0 12px', fontSize: 13, color: tokens.muted }}>
            Reaches age {p.ageInSeason} in {p.season.year} (born {p.birthdate.slice(0, 4)}).
          </Box>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {p.eligibility.map((e) => (
              <Box component="li" key={e.group} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.1, borderTop: `1px solid ${tokens.row}`, fontSize: 14 }}>
                <Box component="span" sx={{ display: 'flex', flexDirection: 'column' }}>
                  <Box component="span" sx={{ fontWeight: 500 }}>{e.group}</Box>
                  <Box component="span" sx={{ fontSize: 12, color: tokens.muted }}>{e.rule}</Box>
                </Box>
                <Box component="span" sx={{ fontSize: 12, fontWeight: 600, px: 1.25, py: '3px', borderRadius: 999, bgcolor: e.eligible ? '#E3ECF7' : tokens.page, color: e.eligible ? tokens.away : tokens.muted }}>
                  {e.eligible ? 'Eligible' : 'Not eligible'}
                </Box>
              </Box>
            ))}
          </Box>
          <BirthCertificate p={p} canEdit={canEdit} />
        </Card>

        <Card sx={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Box>
            <SectionTitle>Awards</SectionTitle>
            {p.awards.length ? (
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1.25, fontSize: 14 }}>
                {p.awards.map((a) => (
                  <Box component="li" key={a.id} sx={{ display: 'flex', gap: 1.5 }}>
                    <Box component="span" sx={{ fontFamily: display, fontWeight: 600, color: tokens.home, width: 40, flex: '0 0 40px' }}>{a.year}</Box>
                    <span>{a.title}{a.leagueName ? ` · ${a.leagueName}` : ''}</span>
                  </Box>
                ))}
              </Box>
            ) : (
              <Muted>No awards yet.</Muted>
            )}
          </Box>
          <Box>
            <SectionTitle>Availability history</SectionTitle>
            {p.availability.length ? (
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1.25, fontSize: 14 }}>
                {p.availability.map((a) => (
                  <Box component="li" key={a.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, pl: 1.5, borderLeft: `3px solid ${a.kind === 'injury' ? tokens.ball : tokens.muted}` }}>
                    <Box component="span" sx={{ fontWeight: 500 }}>
                      {a.kind === 'injury' ? 'Injury' : 'Suspension'} · {a.title}
                    </Box>
                    <Box component="span" sx={{ fontSize: 12, color: tokens.muted }}>
                      {formatDay(a.startedOn, { month: 'short', day: 'numeric', year: 'numeric' })}
                      {a.endedOn ? ` – ${formatDay(a.endedOn)}` : ' · ongoing'}
                      {a.detail ? ` · ${a.detail}` : ''}
                    </Box>
                  </Box>
                ))}
              </Box>
            ) : (
              <Muted>No injuries or suspensions on record.</Muted>
            )}
          </Box>
        </Card>
      </Box>

      <Card aria-labelledby="hist">
        <SectionTitle id="hist">Team history &amp; career stats</SectionTitle>
        {p.seasons.length ? (
          <TableScroll>
            <Box component="table" sx={[tableSx, { '& thead tr, & tbody tr, & tfoot tr': { textAlign: 'right' } }]}>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: 'left' }}>Season</th>
                  <th scope="col" style={{ textAlign: 'left' }}>League</th>
                  <th scope="col" style={{ textAlign: 'left' }}>Team</th>
                  <th scope="col">GP</th>
                  <th scope="col">MPG</th>
                  <th scope="col">PPG</th>
                  <th scope="col">RPG</th>
                  <th scope="col">APG</th>
                  <th scope="col">FG%</th>
                  <th scope="col" style={{ color: tokens.ink, fontWeight: 600 }}>PIR / G</th>
                </tr>
              </thead>
              <tbody>
                {p.seasons.map((r) => (
                  <tr key={`${r.seasonId}-${r.leagueId}-${r.teamId}`}>
                    <th scope="row" style={{ fontWeight: 600 }}>{r.year}</th>
                    <td style={{ textAlign: 'left' }}>{r.leagueName}</td>
                    <td style={{ textAlign: 'left' }}>{r.teamName}</td>
                    <td>{r.gp}</td>
                    <td>{perGame(r.seconds / 60, r.gp)}</td>
                    <td>{perGame(r.pts, r.gp)}</td>
                    <td>{perGame(r.reb, r.gp)}</td>
                    <td>{perGame(r.ast, r.gp)}</td>
                    <td>{r.fga ? ((r.fgm / r.fga) * 100).toFixed(1) : '—'}</td>
                    <td style={{ fontWeight: 700 }}>{perGame(r.pir, r.gp)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" style={{ textAlign: 'left' }}>Career</th>
                  <td style={{ textAlign: 'left' }}>{p.career.leagues} league{p.career.leagues === 1 ? '' : 's'}</td>
                  <td style={{ textAlign: 'left' }}>{p.career.teams} team{p.career.teams === 1 ? '' : 's'}</td>
                  <td>{p.career.gp}</td>
                  <td>{perGame(p.career.seconds / 60, p.career.gp)}</td>
                  <td>{perGame(p.career.pts, p.career.gp)}</td>
                  <td>{perGame(p.career.reb, p.career.gp)}</td>
                  <td>{perGame(p.career.ast, p.career.gp)}</td>
                  <td />
                  <td>{perGame(p.career.pir, p.career.gp)}</td>
                </tr>
              </tfoot>
            </Box>
          </TableScroll>
        ) : (
          <Muted>No recorded games yet.</Muted>
        )}
        <Box sx={{ mt: 1.5 }}>
          <Muted>Each row rolls up from that season's box scores.</Muted>
        </Box>
      </Card>

      {p.recentGames.length > 0 && (
        <Card aria-labelledby="recent">
          <SectionTitle id="recent">Recent games</SectionTitle>
          <TableScroll>
            <Box component="table" sx={[tableSx, { '& tbody tr, & thead tr': { textAlign: 'right' } }]}>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: 'left' }}>Date</th>
                  <th scope="col" style={{ textAlign: 'left' }}>Opponent</th>
                  <th scope="col" style={{ textAlign: 'left' }}>Result</th>
                  <th scope="col">MIN</th>
                  <th scope="col">PTS</th>
                  <th scope="col">REB</th>
                  <th scope="col">AST</th>
                  <th scope="col">+/-</th>
                  <th scope="col" style={{ color: tokens.ink, fontWeight: 600 }}>PIR</th>
                </tr>
              </thead>
              <tbody>
                {p.recentGames.map((g) => (
                  <tr key={g.gameId}>
                    <th scope="row">
                      <Link to={`/games/${g.gameId}`}>{formatDate(g.scheduledAt, { month: 'short', day: 'numeric' })}</Link>
                    </th>
                    <td style={{ textAlign: 'left' }}>{g.home ? 'vs' : '@'} {g.opponent}</td>
                    <td style={{ textAlign: 'left', color: g.result?.startsWith('W') ? tokens.away : tokens.negative, fontWeight: 600 }}>{g.result ?? '—'}</td>
                    <td>{minutes(g.seconds)}</td>
                    <td>{g.pts}</td>
                    <td>{g.reb}</td>
                    <td>{g.ast}</td>
                    <td>{signed(g.plusMinus)}</td>
                    <td style={{ fontWeight: 700 }}>{g.pir}</td>
                  </tr>
                ))}
              </tbody>
            </Box>
          </TableScroll>
        </Card>
      )}

      {editing && <StatusDialog player={p} open={editing} onClose={() => setEditing(false)} />}
    </>
  );
}
