import { Alert, Box, Button } from '@mui/material';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useBoxScore, useMe } from '../api/queries';
import { useGameStream } from '../api/useGameStream';
import type { BoxPlayer, BoxScoreResponse, Side, TeamTotals } from '../api/types';
import { ShotChart } from '../components/ShotChart';
import { Card, ErrorState, Loading, Muted, SectionTitle, TableScroll, tableSx } from '../components/ui';
import { formatDate, formatTime, minutes, pct, periodLabel, signed } from '../lib/format';
import { display, tokens } from '../theme';

const SIDE_COLOR: Record<Side, string> = { home: tokens.home, away: tokens.away };

type BoxData = NonNullable<BoxScoreResponse['box']>;

function Header({ data }: { data: BoxScoreResponse }) {
  const { game } = data;
  const played = game.status !== 'scheduled';
  const statusText =
    game.status === 'final'
      ? `Final${game.periods && game.periods > 4 ? ` (${game.periods === 5 ? 'OT' : `${game.periods - 4}OT`})` : ''}`
      : game.status === 'forfeit'
        ? 'Forfeit'
        : game.status === 'live'
          ? 'Live'
          : 'Scheduled';
  const team = (side: Side, align: 'left' | 'right') => {
    const t = game[side];
    const name = (
      <Box component="span" sx={{ fontFamily: display, fontSize: { xs: 26, sm: 34 }, fontWeight: 600 }}>
        {t.name}
      </Box>
    );
    const score = played && (
      <Box component="span" sx={{ fontFamily: display, fontSize: { xs: 52, sm: 64 }, fontWeight: 700, color: SIDE_COLOR[side], lineHeight: 1 }}>
        {t.score}
      </Box>
    );
    return (
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
        {align === 'left' ? <>{name}{score}</> : <>{score}{name}</>}
      </Box>
    );
  };
  return (
    <Card component="header" sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: '20px', sm: '24px 28px' } }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', fontSize: 13, color: tokens.muted }}>
        <Box component="span" sx={{ fontWeight: 600, color: tokens.ink }}>{statusText}</Box>
        <span>{game.league.name} · Game {game.gameNumber}</span>
        <span>{formatDate(game.scheduledAt)} · {formatTime(game.scheduledAt)}</span>
        <span>{game.venue ?? 'Venue to be announced'}</span>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: { xs: 1, sm: '16px 32px' } }}>
        {team('home', 'left')}
        <Box component="span" sx={{ fontSize: 18, color: tokens.muted }}>–</Box>
        {team('away', 'right')}
      </Box>
    </Card>
  );
}

function LineScore({ data, box }: { data: BoxScoreResponse; box: BoxData }) {
  return (
    <Card aria-labelledby="ls">
      <SectionTitle id="ls">Line score</SectionTitle>
      <TableScroll>
        <Box component="table" sx={[tableSx, { '& tr': { textAlign: 'right' } }]}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: 'left' }}>Team</th>
              {box.lineScore.home.map((_, i) => <th key={i} scope="col">{periodLabel(i)}</th>)}
              <th scope="col" style={{ color: tokens.ink, fontWeight: 600 }}>Final</th>
            </tr>
          </thead>
          <tbody>
            {(['home', 'away'] as const).map((side) => (
              <tr key={side}>
                <th scope="row">
                  <Box component="span" aria-hidden="true" sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '2px', bgcolor: SIDE_COLOR[side], mr: 1 }} />
                  {data.game[side].name}
                </th>
                {box.lineScore[side].map((n, i) => <td key={i}>{n}</td>)}
                <td style={{ fontWeight: 700 }}>{box.score[side]}</td>
              </tr>
            ))}
          </tbody>
        </Box>
      </TableScroll>
    </Card>
  );
}

function Comparison({ data, box }: { data: BoxScoreResponse; box: BoxData }) {
  const h = box.totals.home;
  const a = box.totals.away;
  const ratio = (t: TeamTotals, m: 'fg' | 'tp' | 'ft') =>
    m === 'fg' ? (t.fga ? t.fgm / t.fga : 0) : m === 'tp' ? (t.fg3a ? t.fg3m / t.fg3a : 0) : t.fta ? t.ftm / t.fta : 0;
  // [label, home shown, away shown, home value, away value] — higher value wins (turnovers are negated).
  const rows: [string, string | number, string | number, number, number][] = [
    ['FG%', `${pct(h.fgm, h.fga)}%`, `${pct(a.fgm, a.fga)}%`, ratio(h, 'fg'), ratio(a, 'fg')],
    ['3P%', `${pct(h.fg3m, h.fg3a)}%`, `${pct(a.fg3m, a.fg3a)}%`, ratio(h, 'tp'), ratio(a, 'tp')],
    ['FT%', `${pct(h.ftm, h.fta)}%`, `${pct(a.ftm, a.fta)}%`, ratio(h, 'ft'), ratio(a, 'ft')],
    ['Rebounds', h.reb, a.reb, h.reb, a.reb],
    ['Assists', h.ast, a.ast, h.ast, a.ast],
    ['Steals', h.stl, a.stl, h.stl, a.stl],
    ['Blocks', h.blk, a.blk, h.blk, a.blk],
    ['Turnovers', h.tov, a.tov, -h.tov, -a.tov],
    ['Team PIR', h.pir, a.pir, h.pir, a.pir],
  ];
  return (
    <Card aria-labelledby="tc">
      <SectionTitle id="tc">Team comparison</SectionTitle>
      <Box component="table" sx={tableSx}>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: 'left', color: tokens.home }}>{data.game.home.shortName}</th>
            <th scope="col" style={{ textAlign: 'center' }}>Stat</th>
            <th scope="col" style={{ textAlign: 'right', color: tokens.away }}>{data.game.away.shortName}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, hs, as, hv, av]) => (
            <tr key={k}>
              <td style={{ fontWeight: hv > av ? 700 : 400 }}>{hs}</td>
              <th scope="row" style={{ textAlign: 'center', color: tokens.muted, fontSize: 13 }}>{k}</th>
              <td style={{ textAlign: 'right', fontWeight: av > hv ? 700 : 400 }}>{as}</td>
            </tr>
          ))}
        </tbody>
      </Box>
      <Box sx={{ mt: 1.5 }}>
        <Muted>PIR (FIBA Performance Index Rating) = PTS + REB + AST + STL + BLK + fouls drawn − missed FG − missed FT − turnovers − fouls committed.</Muted>
      </Box>
    </Card>
  );
}

function Shots({ box }: { box: BoxData }) {
  const shooters = box.players.filter((p) => p.fga > 0).sort((a, b) => (a.side === b.side ? 0 : a.side === 'home' ? -1 : 1));
  const top = [...shooters].sort((a, b) => b.pts - a.pts)[0];
  const [pick, setPick] = useState<number | null>(top?.playerId ?? null);
  const player = box.players.find((p) => p.playerId === pick) ?? top;
  if (!player) return null;
  const shots = box.shots.filter((s) => s.playerId === player.playerId);
  const unplotted = shots.filter((s) => s.x === null).length;
  const zone = (z: 'paint' | 'mid' | 'three') => {
    const list = shots.filter((s) => s.zone === z);
    const made = list.filter((s) => s.made).length;
    return { ma: `${made}/${list.length}`, pct: list.length ? `${Math.round((made / list.length) * 100)}%` : '—' };
  };
  const color = SIDE_COLOR[player.side];

  return (
    <Card aria-labelledby="sc" sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
      <SectionTitle id="sc" aside={`FG ${player.fgm}/${player.fga} · 3PT ${player.fg3m}/${player.fg3a}`}>
        Shot chart · #{player.jersey} {player.name}
      </SectionTitle>
      <Box role="group" aria-label="Choose player" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {shooters.map((p) => {
          const on = p.playerId === player.playerId;
          const c = SIDE_COLOR[p.side];
          return (
            <Box
              key={p.playerId}
              component="button"
              type="button"
              aria-pressed={on}
              onClick={() => setPick(p.playerId)}
              sx={{ minHeight: 34, px: 1.25, borderRadius: 999, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', border: `1px solid ${c}`, bgcolor: on ? c : tokens.card, color: on ? '#FFFFFF' : c }}
            >
              #{p.jersey} {p.lastName}
            </Box>
          );
        })}
      </Box>
      <ShotChart shots={shots} color={color} label={`Shot chart for ${player.name}`} />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, fontSize: 12, color: tokens.muted }}>
        <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box component="span" sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: color }} />Made
        </Box>
        <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box component="span" sx={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${tokens.muted}`, boxSizing: 'border-box', bgcolor: '#FFFFFF' }} />Missed
        </Box>
        {unplotted > 0 && <span>{unplotted} shot{unplotted > 1 ? 's' : ''} entered without a court spot</span>}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.25 }}>
        {([['Paint', 'paint'], ['Mid-range', 'mid'], ['Three', 'three']] as const).map(([label, key]) => {
          const z = zone(key);
          return (
            <Box key={key} sx={{ bgcolor: tokens.page, borderRadius: '10px', p: '10px 12px' }}>
              <Box sx={{ fontSize: 12, color: tokens.muted }}>{label}</Box>
              <Box sx={{ fontFamily: display, fontSize: 24, fontWeight: 600 }}>{z.ma}</Box>
              <Box sx={{ fontSize: 12, color: tokens.muted }}>{z.pct}</Box>
            </Box>
          );
        })}
      </Box>
    </Card>
  );
}

const STAT_COLS = ['MIN', 'PTS', 'FGM-A', 'FG%', '3PM-A', '3P%', 'FTM-A', 'FT%', 'OR', 'DR', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'FD', '+/-', 'PIR'];

function statCells(s: BoxPlayer | TeamTotals, isTotal = false) {
  return [
    isTotal ? '' : minutes(s.seconds),
    s.pts,
    `${s.fgm}-${s.fga}`,
    pct(s.fgm, s.fga),
    `${s.fg3m}-${s.fg3a}`,
    pct(s.fg3m, s.fg3a),
    `${s.ftm}-${s.fta}`,
    pct(s.ftm, s.fta),
    s.oreb,
    s.dreb,
    s.reb,
    s.ast,
    s.stl,
    s.blk,
    s.tov,
    s.pf,
    s.fd,
    'plusMinus' in s ? signed(s.plusMinus) : '',
    s.pir,
  ];
}

function TeamBox({ side, data, box, linkPlayers }: { side: Side; data: BoxScoreResponse; box: BoxData; linkPlayers: boolean }) {
  const players = box.players.filter((p) => p.side === side);
  const totals = box.totals[side];
  const teamReb = totals.teamOreb + totals.teamDreb;
  const muted = new Set(['FG%', '3P%', 'FT%']);
  const bold = new Set(['PTS', 'PIR']);
  return (
    <Card aria-label={`${data.game[side].name} box score`}>
      <Box component="h2" sx={{ m: '0 0 12px', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box component="span" aria-hidden="true" sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: SIDE_COLOR[side] }} />
        {data.game[side].name}
      </Box>
      <TableScroll>
        <Box component="table" sx={[tableSx, { fontSize: 13, '& th, & td': { padding: '9px 6px' }, '& tr': { textAlign: 'right' }, '& thead tr': { fontSize: 11, letterSpacing: '.04em' } }]}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: 'left' }}>#</th>
              <th scope="col" style={{ textAlign: 'left' }}>Player</th>
              {STAT_COLS.map((c) => (
                <th key={c} scope="col" style={bold.has(c) ? { color: tokens.ink, fontWeight: 600 } : undefined}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const tags = [p.starter && 'Starter', p.fouledOut && 'Fouled out'].filter(Boolean).join(' · ');
              return (
                <tr key={p.playerId}>
                  <td style={{ textAlign: 'left', color: tokens.muted }}>{p.jersey}</td>
                  <th scope="row">
                    {linkPlayers ? <Link to={`/players/${p.playerId}`}>{p.name}</Link> : p.name}{' '}
                    {tags && <Box component="span" sx={{ fontSize: 11, color: tokens.muted, fontWeight: 400 }}>{tags}</Box>}
                  </th>
                  {statCells(p).map((v, i) => {
                    const col = STAT_COLS[i]!;
                    const pfOut = col === 'PF' && p.fouledOut;
                    return (
                      <td
                        key={col}
                        style={{
                          color: pfOut ? tokens.home : muted.has(col) ? tokens.muted : undefined,
                          fontWeight: bold.has(col) || pfOut ? 700 : undefined,
                        }}
                      >
                        {v}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {teamReb > 0 && (
              <tr>
                <td />
                <th scope="row" style={{ color: tokens.muted, fontWeight: 400 }}>Team</th>
                {STAT_COLS.map((c) => (
                  <td key={c} style={{ color: tokens.muted }}>
                    {c === 'OR' ? totals.teamOreb : c === 'DR' ? totals.teamDreb : c === 'REB' ? teamReb : ''}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <th scope="row" style={{ textAlign: 'left' }}>Team totals</th>
              {statCells(totals, true).map((v, i) => <td key={STAT_COLS[i]}>{v}</td>)}
            </tr>
          </tfoot>
        </Box>
      </TableScroll>
    </Card>
  );
}

export function BoxScorePage() {
  const id = Number(useParams().id);
  const q = useBoxScore(id);
  const { data: user } = useMe();
  const status = q.data?.game.status;
  useGameStream(id, status === 'live' || status === 'scheduled');

  const back = (
    <Box component={Link} to="/games" sx={{ fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 0.75, minHeight: 32, textDecoration: 'none', alignSelf: 'flex-start' }}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      All box scores
    </Box>
  );

  if (q.isPending) return <>{back}<Loading /></>;
  if (q.error) return <>{back}<ErrorState error={q.error} onRetry={() => q.refetch()} /></>;
  const data = q.data;
  const box = data.box;
  const recordable = !!user && (data.game.status === 'scheduled' || data.game.status === 'live');

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        {back}
        {recordable && (
          <Button component={Link} to={`/games/${data.game.id}/record`} variant={data.game.status === 'live' ? 'contained' : 'outlined'}>
            {data.game.status === 'live' ? 'Continue recording' : 'Record this game'}
          </Button>
        )}
      </Box>
      <Header data={data} />
      {box && (
        <Box component="nav" aria-label="More for these teams" sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', fontSize: 14, mt: -1 }}>
          <Link to={`/matchup?a=${data.game.home.id}&b=${data.game.away.id}&year=${new Date(data.game.scheduledAt).getUTCFullYear()}`}>Season matchup</Link>
          <Link to={`/lineups?team=${data.game.home.id}`}>{data.game.home.name} lineups</Link>
          <Link to={`/lineups?team=${data.game.away.id}`}>{data.game.away.name} lineups</Link>
        </Box>
      )}
      {data.game.status === 'live' && (
        <Alert severity="info">This game is being recorded now. The numbers update as each play is recorded; they count in standings and leaders once the game is final.</Alert>
      )}
      {!box ? (
        <Alert severity="info">
          {data.game.status === 'forfeit'
            ? `${data.game[data.game.forfeitedBy ?? 'away'].name} forfeited. FIBA records a forfeit as 20–0; no box score is kept and the forfeiting team gets 0 standing points.`
            : 'This game has not been played yet. Its box score will appear here once the game is recorded.'}
        </Alert>
      ) : (
        <>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            <Box sx={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <LineScore data={data} box={box} />
              <Comparison data={data} box={box} />
            </Box>
            <Box sx={{ flex: '1 1 420px', minWidth: 0 }}>
              <Shots key={data.game.id} box={box} />
            </Box>
          </Box>
          <TeamBox side="home" data={data} box={box} linkPlayers={!!user} />
          <TeamBox side="away" data={data} box={box} linkPlayers={!!user} />
          <Muted>Every number on this page is calculated from the game's play-by-play event list.</Muted>
        </>
      )}
    </>
  );
}
