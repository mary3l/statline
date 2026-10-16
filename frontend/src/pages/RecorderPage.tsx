import { Box, Dialog } from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAddLatePlayer, useFinishGame, useMe, useRecorderData, useReopenGame } from '../api/queries';
import type { RecorderData, Side } from '../api/types';
import { ClassicRecorder } from '../recorder/ClassicRecorder';
import { FastRecorder } from '../recorder/FastRecorder';
import { LineupSetup } from '../recorder/LineupSetup';
import { PhoneRecorder } from '../recorder/PhoneRecorder';
import { describe } from '../recorder/PlayByPlay';
import { Scoreboard } from '../recorder/Scoreboard';
import { readJson, writeJson } from '../recorder/storage';
import { bodyFont, C, display, SIDE_COLOR } from '../recorder/theme';
import { Btn, Card, Kicker } from '../recorder/ui';
import { onlyClockMarkers, shortName, useRecorder, type Recorder, type SyncState } from '../recorder/useRecorder';

type Mode = 'fast' | 'classic' | 'phone';
const MODE_KEY = 'statline:recorder-mode';
const MODE_LABEL: Record<Mode, string> = { fast: 'Fast recorder', classic: 'Classic scorer', phone: 'Phone recorder' };
const MODES: Mode[] = ['fast', 'classic', 'phone'];
/** Without a saved choice, a phone-sized screen starts in the phone recorder. */
const defaultMode = (): Mode => readJson<Mode>(MODE_KEY) ?? (window.innerWidth < 700 ? 'phone' : 'fast');

function Shell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = C.bg;
    return () => {
      document.body.style.backgroundColor = prev;
    };
  }, []);
  return (
    <Box
      component="main"
      sx={{
        minHeight: '100dvh',
        height: { md: '100dvh' },
        boxSizing: 'border-box',
        p: { xs: '10px 12px 16px', md: '12px 14px 14px' },
        bgcolor: C.bg,
        color: C.text,
        fontFamily: bodyFont,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        '& a': { color: '#9CC6F7' },
        '& a:hover': { color: '#C9DEFA' },
      }}
    >
      {children}
    </Box>
  );
}

function TopLine({ data, mode, children }: { data: RecorderData; mode?: string; children?: ReactNode }) {
  const g = data.game;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px 16px', flexWrap: 'wrap', fontSize: 12, color: C.muted, minHeight: 32 }}>
      <span>
        <Box component="strong" sx={{ color: C.text, fontFamily: display, fontSize: 16, letterSpacing: '.04em' }}>STATLINE</Box>
        {mode ? ` · ${mode}` : ''} · {g.league.name} · Game {g.gameNumber} · FIBA rules
      </span>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
        {children}
        <Link to={`/games/${g.id}`}>Box score</Link>
        <Link to="/record">Exit</Link>
      </Box>
    </Box>
  );
}

function SyncPill({ sync }: { sync: SyncState }) {
  const map = {
    saved: { color: C.ok, text: 'All plays saved' },
    saving: { color: C.muted, text: `Saving ${sync.pending}…` },
    offline: { color: C.amber, text: `Offline · ${sync.pending} waiting` },
    error: { color: C.warn, text: 'Not saved' },
  } as const;
  const s = map[sync.status];
  return (
    <Box component="span" role="status" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: s.color }}>
      <Box component="span" aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: s.color }} />
      {s.text}
    </Box>
  );
}

function EndGameDialog({ rec, open, onClose }: { rec: Recorder; open: boolean; onClose: () => void }) {
  const finish = useFinishGame(rec.game.id);
  const navigate = useNavigate();
  const { home, away } = rec.box.score;
  const tied = home === away;
  const waiting = rec.sync.pending > 0;
  return (
    <Dialog open={open} onClose={onClose} PaperProps={{ sx: { bgcolor: C.panel, color: C.text, border: `1px solid ${C.panelBorder}`, borderRadius: '16px', p: 3, maxWidth: 440 } }}>
      <Kicker color={C.amber}>End game</Kicker>
      <Box component="h2" sx={{ m: '4px 0 12px', fontFamily: display, fontSize: 32, fontWeight: 600, lineHeight: 1.05 }}>
        <Box component="span" sx={{ color: SIDE_COLOR.home }}>{rec.game.home.shortName} {home}</Box>
        {' – '}
        <Box component="span" sx={{ color: SIDE_COLOR.away }}>{away} {rec.game.away.shortName}</Box>
      </Box>
      <Box sx={{ fontSize: 14, color: C.soft, lineHeight: 1.5 }}>
        {tied
          ? 'The score is tied. FIBA games can’t end in a tie: start an overtime period instead.'
          : 'This makes the result final: standings, leaders and player profiles will count it. An organizer can reopen it later to fix mistakes.'}
      </Box>
      {waiting && <Box sx={{ mt: 1.5, fontSize: 13, color: C.amber }}>Waiting for {rec.sync.pending} unsaved change{rec.sync.pending === 1 ? '' : 's'} to reach the server…</Box>}
      {finish.error && <Box role="alert" sx={{ mt: 1.5, fontSize: 13, color: C.warn }}>{finish.error.message}</Box>}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 3 }}>
        <Btn onClick={onClose} sx={{ bgcolor: 'transparent', border: `1px solid ${C.strongBorder}` }}>Keep recording</Btn>
        <Btn
          disabled={tied || waiting || finish.isPending}
          onClick={() => finish.mutate(undefined, { onSuccess: () => navigate(`/games/${rec.game.id}`) })}
          sx={{ border: 'none', bgcolor: C.amber, color: C.bg, fontWeight: 700 }}
        >
          {finish.isPending ? 'Ending…' : 'End game'}
        </Btn>
      </Box>
    </Dialog>
  );
}

function AddPlayerDialog({ data, open, onClose }: { data: RecorderData; open: boolean; onClose: () => void }) {
  const add = useAddLatePlayer(data.game.id);
  const [added, setAdded] = useState('');
  return (
    <Dialog open={open} onClose={onClose} PaperProps={{ sx: { bgcolor: C.panel, color: C.text, border: `1px solid ${C.panelBorder}`, borderRadius: '16px', p: 3, width: 560, maxWidth: 'calc(100% - 32px)' } }}>
      <Kicker color={C.amber}>Arrived late</Kicker>
      <Box component="h2" sx={{ m: '4px 0 6px', fontFamily: display, fontSize: 30, fontWeight: 600, lineHeight: 1.05 }}>Add a player to the lineup</Box>
      <Box sx={{ fontSize: 13, color: C.muted, mb: 2 }}>They join the bench; bring them in with a substitution.</Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        {(['home', 'away'] as Side[]).map((side) => {
          const list = data.roster[side].filter((p) => !p.dressed);
          return (
            <Box key={side} sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Kicker color={SIDE_COLOR[side]}>{data.game[side].name}</Kicker>
              {list.length === 0 && <Box sx={{ fontSize: 13, color: C.muted }}>Everyone on the roster is dressed.</Box>}
              {list.map((p) => (
                <Btn
                  key={p.playerId}
                  disabled={p.status === 'suspended' || add.isPending}
                  onClick={() => add.mutate({ playerId: p.playerId, side }, { onSuccess: () => setAdded(`#${p.jersey} ${shortName(p)} added to the bench.`) })}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1, textAlign: 'left', minHeight: 48 }}
                >
                  <Box component="span" sx={{ fontFamily: display, fontSize: 24, fontWeight: 700, width: 36, color: SIDE_COLOR[side] }}>{p.jersey}</Box>
                  <Box component="span" sx={{ flex: 1 }}>{shortName(p)}</Box>
                  <Box component="span" sx={{ fontSize: 11, color: C.warn }}>{p.status === 'available' ? '' : p.status}</Box>
                </Btn>
              ))}
            </Box>
          );
        })}
      </Box>
      {added && <Box role="status" sx={{ mt: 2, fontSize: 13, color: C.ok }}>{added}</Box>}
      {add.error && <Box role="alert" sx={{ mt: 2, fontSize: 13, color: C.warn }}>{add.error.message}</Box>}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
        <Btn onClick={() => { setAdded(''); onClose(); }} sx={{ border: 'none', bgcolor: C.text, color: C.bg, fontWeight: 600 }}>Done</Btn>
      </Box>
    </Dialog>
  );
}

function LiveRecorder({ data }: { data: RecorderData }) {
  const rec = useRecorder(data);
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('mode') as Mode | null;
  const mode: Mode = fromUrl && MODES.includes(fromUrl) ? fromUrl : defaultMode();
  const [ending, setEnding] = useState(false);
  const [lineup, setLineup] = useState(false);
  const [undone, setUndone] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!undone) return;
    const t = window.setTimeout(() => setUndone(''), 4000);
    return () => window.clearTimeout(t);
  }, [undone]);

  const switchMode = (m: Mode) => {
    writeJson(MODE_KEY, m);
    setParams({ mode: m }, { replace: true });
  };

  const undo = () => {
    const gone = rec.undo();
    if (gone?.length) setUndone(`Undid: ${gone.map((e) => describe(e, rec)).join(' + ')}`);
  };

  if (lineup) {
    return (
      <>
        <TopLine data={data} mode="Lineup" />
        <LineupSetup data={data} onCancel={() => setLineup(false)} onSaved={() => setLineup(false)} />
      </>
    );
  }

  return (
    <>
      <TopLine data={data} mode={MODE_LABEL[mode]}>
        <Box role="group" aria-label="Recorder" sx={{ display: 'flex', border: `1px solid ${C.buttonBorder}`, borderRadius: '8px', overflow: 'hidden' }}>
          {MODES.map((m) => (
            <Btn key={m} pressed={mode === m} onClick={() => switchMode(m)} sx={{ minHeight: 32, border: 'none', borderRadius: 0, fontSize: 12, bgcolor: mode === m ? C.text : 'transparent', color: mode === m ? C.bg : C.muted }}>
              {{ fast: 'Fast', classic: 'Classic', phone: 'Phone' }[m]}
            </Btn>
          ))}
        </Box>
        <SyncPill sync={rec.sync} />
        {undone && <Box component="span" aria-live="polite" sx={{ color: C.amber }}>{undone}</Box>}
        <Btn onClick={undo} disabled={!rec.canUndo} sx={{ minHeight: 32, fontSize: 12 }}>Undo last entry</Btn>
        {onlyClockMarkers(rec.events) ? (
          <Btn onClick={() => setLineup(true)} sx={{ minHeight: 32, fontSize: 12 }}>Change lineup</Btn>
        ) : (
          <Btn onClick={() => setAdding(true)} sx={{ minHeight: 32, fontSize: 12 }}>Add late player</Btn>
        )}
        <Btn onClick={() => setEnding(true)} sx={{ minHeight: 32, fontSize: 12, bgcolor: 'transparent', borderColor: C.amber, color: C.amber }}>End game</Btn>
      </TopLine>

      {rec.sync.status === 'error' && (
        <Box role="alert" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', p: '10px 12px', borderRadius: '10px', border: `1px solid ${C.warn}`, bgcolor: 'rgba(244,163,154,0.10)', fontSize: 13 }}>
          <Box component="span" sx={{ flex: 1, minWidth: 200 }}>
            The server refused a change, so {rec.sync.pending} change{rec.sync.pending === 1 ? ' is' : 's are'} not saved yet: {rec.sync.message}
          </Box>
          <Btn onClick={rec.retrySync} sx={{ minHeight: 36, fontSize: 12 }}>Retry</Btn>
          <Btn onClick={rec.discardBlocked} sx={{ minHeight: 36, fontSize: 12, bgcolor: 'transparent', borderColor: C.warn, color: C.warn }}>Discard that change and reload</Btn>
        </Box>
      )}

      {mode === 'phone' ? (
        <PhoneRecorder rec={rec} />
      ) : (
        <>
          <Scoreboard rec={rec} />
          {mode === 'fast' ? <FastRecorder rec={rec} /> : <ClassicRecorder rec={rec} />}
        </>
      )}
      <EndGameDialog rec={rec} open={ending} onClose={() => setEnding(false)} />
      <AddPlayerDialog data={data} open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function FinishedGame({ data }: { data: RecorderData }) {
  const { data: user } = useMe();
  const reopen = useReopenGame(data.game.id);
  const navigate = useNavigate();
  const g = data.game;
  const canReopen = g.status === 'final' && (user?.role === 'admin' || user?.role === 'organizer');
  return (
    <>
      <TopLine data={data} />
      <Card sx={{ p: 3, maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Kicker>{g.status === 'forfeit' ? 'Forfeit' : 'Final'}</Kicker>
        <Box component="h1" sx={{ m: 0, fontFamily: display, fontSize: 34, fontWeight: 600, lineHeight: 1.05 }}>
          {g.home.name} {g.home.score} – {g.away.score} {g.away.name}
        </Box>
        <Box sx={{ fontSize: 14, color: C.soft }}>
          {g.status === 'forfeit'
            ? 'This game was forfeited, so there is nothing to record.'
            : 'This game is over. Its plays can no longer be recorded here.'}
          {canReopen && ' As an organizer you can reopen it to fix mistakes; it stops counting in standings and leaders until you end it again.'}
        </Box>
        {reopen.error && <Box role="alert" sx={{ fontSize: 13, color: C.warn }}>{reopen.error.message}</Box>}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Btn onClick={() => navigate(`/games/${g.id}`)} sx={{ border: 'none', bgcolor: C.text, color: C.bg, fontWeight: 600 }}>Open box score</Btn>
          {canReopen && (
            <Btn onClick={() => reopen.mutate(undefined)} disabled={reopen.isPending} sx={{ bgcolor: 'transparent', borderColor: C.amber, color: C.amber }}>
              {reopen.isPending ? 'Reopening…' : 'Reopen game'}
            </Btn>
          )}
        </Box>
      </Card>
    </>
  );
}

export function RecorderPage() {
  const id = Number(useParams().id);
  const q = useRecorderData(id);

  let body: ReactNode;
  if (q.isPending) body = <Box role="status" sx={{ color: C.muted, p: 2 }}>Loading the game…</Box>;
  else if (q.error)
    body = (
      <Card sx={{ p: 3, maxWidth: 560 }}>
        <Box role="alert" sx={{ fontSize: 15, mb: 2 }}>{q.error.message}</Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Btn onClick={() => q.refetch()}>Try again</Btn>
          <Box component={Link} to="/record" sx={{ alignSelf: 'center' }}>Back to games</Box>
        </Box>
      </Card>
    );
  else if (q.data.game.status === 'scheduled')
    body = (
      <>
        <TopLine data={q.data} mode="Lineup" />
        <LineupSetup data={q.data} />
      </>
    );
  else if (q.data.game.status === 'live') body = <LiveRecorder key={q.data.game.id} data={q.data} />;
  else body = <FinishedGame data={q.data} />;

  return <Shell>{body}</Shell>;
}
