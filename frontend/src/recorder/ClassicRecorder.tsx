import { freeThrowsFor, inPenalty, isFouledOut, isOffensiveRebound, teamFoulsIn, timeoutsLeft, timeoutWindow } from '@engine/live';
import type { FoulKind, GameEvent } from '@engine/types';
import { Box } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import type { RecorderPlayer, Side } from '../api/types';
import { describe, PlayByPlay } from './PlayByPlay';
import { C, display, other, SIDE_COLOR, SIDE_TINT } from './theme';
import { Btn, Card, Kicker, Option, OptionGrid, type OptionKind } from './ui';
import { shortName, type NewEvent, type RecordOptions, type Recorder } from './useRecorder';

/**
 * Classic scorer: tap the player, tap what happened, then answer the question it asks —
 * the same game flow as the Fast recorder (assist, rebound, foul → who was fouled → free throws,
 * steal ↔ turnover, substitutions), answered by tapping players in the rosters.
 */
type Key = '2pm' | '2px' | '3pm' | '3px' | 'ftm' | 'ftx' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov' | 'pf';

const ACTIONS: { key: Key; label: string; sub: string; kind: OptionKind }[] = [
  { key: '2pm', label: '2PT', sub: 'Made', kind: 'made' },
  { key: '2px', label: '2PT', sub: 'Missed', kind: 'miss' },
  { key: '3pm', label: '3PT', sub: 'Made', kind: 'made' },
  { key: '3px', label: '3PT', sub: 'Missed', kind: 'miss' },
  { key: 'ftm', label: 'Free throw', sub: 'Made', kind: 'made' },
  { key: 'ftx', label: 'Free throw', sub: 'Missed', kind: 'miss' },
  { key: 'reb', label: 'Rebound', sub: 'off./def. set for you', kind: 'neutral' },
  { key: 'ast', label: 'Assist', sub: 'AST', kind: 'neutral' },
  { key: 'stl', label: 'Steal', sub: 'then who lost it', kind: 'neutral' },
  { key: 'blk', label: 'Block', sub: 'BLK', kind: 'neutral' },
  { key: 'tov', label: 'Turnover', sub: 'then who stole it', kind: 'neutral' },
  { key: 'pf', label: 'Foul', sub: 'kind, fouled, FTs', kind: 'foul' },
];

const FOUL_KINDS: { kind: FoulKind; label: string; sub: (penalty: boolean) => string }[] = [
  { kind: 'personal', label: 'Personal', sub: (pen) => (pen ? 'penalty · 2 FT' : 'no free throws') },
  { kind: 'shoot2', label: 'Shooting', sub: () => '2 free throws' },
  { kind: 'shoot3', label: 'Shooting', sub: () => '3 free throws' },
  { kind: 'and1', label: 'And-one', sub: () => '1 free throw' },
  { kind: 'offensive', label: 'Offensive', sub: () => 'also a turnover' },
  { kind: 'unsport', label: 'Unsportsmanlike', sub: () => '2 FT + possession' },
];

/** The question the scorer is answering. Player questions are answered by tapping a highlighted roster row. */
type Prompt =
  | { k: 'assist'; scorer: RecorderPlayer }
  | { k: 'rebound'; shotSide: Side }
  | { k: 'foulKind'; fouler: RecorderPlayer }
  | { k: 'fouled'; fouler: RecorderPlayer; kind: FoulKind; n: number }
  | { k: 'ft'; shooter: RecorderPlayer; n: number; i: number }
  | { k: 'stealVictim'; thief: RecorderPlayer }
  | { k: 'stealer'; loser: RecorderPlayer }
  | { k: 'subIn'; out: RecorderPlayer }
  | { k: 'subOut'; inn: RecorderPlayer }
  | { k: 'forcedSub'; out: RecorderPlayer };

const pl = (p: RecorderPlayer) => `#${p.jersey} ${shortName(p)}`;

function RosterRow({
  p,
  rec,
  selected,
  highlight,
  dim,
  onPick,
}: {
  p: RecorderPlayer;
  rec: Recorder;
  selected: boolean;
  highlight: boolean;
  dim: boolean;
  onPick: () => void;
}) {
  const line = rec.box.players.find((l) => l.playerId === p.playerId);
  const pf = rec.live.fouls.get(p.playerId) ?? 0;
  const out = pf >= 5;
  return (
    <Btn
      onClick={onPick}
      pressed={selected}
      label={`#${p.jersey} ${p.firstName} ${p.lastName}, ${line?.pts ?? 0} points, ${out ? 'fouled out' : `${pf} fouls`}`}
      sx={{
        width: '100%',
        minHeight: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        p: '4px 10px 4px 4px',
        textAlign: 'left',
        bgcolor: selected ? SIDE_TINT[p.side] : C.button,
        border: `1.5px solid ${selected ? SIDE_COLOR[p.side] : highlight ? C.amber : C.panelBorder}`,
        opacity: out || dim ? 0.45 : 1,
      }}
    >
      <Box component="span" sx={{ fontFamily: display, fontSize: 26, fontWeight: 700, width: 38, flex: 'none', textAlign: 'center', color: SIDE_COLOR[p.side], lineHeight: 1 }}>{p.jersey}</Box>
      <Box component="span" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Box component="span" sx={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName(p)}</Box>
        <Box component="span" sx={{ fontSize: 11, color: pf >= 4 ? C.amber : C.muted }}>{out ? 'Fouled out' : `PF ${pf}`}</Box>
      </Box>
      <Box component="span" sx={{ fontFamily: display, fontSize: 22, fontWeight: 600, flex: 'none' }}>{line?.pts ?? 0}</Box>
    </Btn>
  );
}

function TeamColumn({
  rec,
  side,
  sel,
  prompt,
  eligible,
  onPick,
}: {
  rec: Recorder;
  side: Side;
  sel: number | null;
  prompt: Prompt | null;
  eligible: (p: RecorderPlayer, onCourt: boolean) => boolean;
  onPick: (p: RecorderPlayer, onCourt: boolean) => void;
}) {
  const court = rec.live.onCourt[side];
  const onCourt = court.map((id) => rec.byId.get(id)).filter((p): p is RecorderPlayer => !!p);
  const bench = rec.players[side].filter((p) => !court.includes(p.playerId));
  const benchAnswers = !!prompt && bench.some((p) => eligible(p, false));
  const row = (p: RecorderPlayer, on: boolean) => {
    const ok = !!prompt && eligible(p, on);
    return <RosterRow key={p.playerId} p={p} rec={rec} selected={sel === p.playerId} highlight={ok} dim={!!prompt && !ok} onPick={() => onPick(p, on)} />;
  };
  return (
    <Card label={`${rec.game[side].name} roster`} sx={{ p: '10px 10px 12px', display: 'flex', flexDirection: 'column', gap: 0.75, overflow: 'auto', minHeight: 0 }}>
      <Box sx={{ fontFamily: display, fontSize: 20, fontWeight: 600, color: SIDE_COLOR[side], px: 0.5 }}>{rec.game[side].name}</Box>
      <Kicker>On court</Kicker>
      {onCourt.map((p) => row(p, true))}
      <Box sx={{ mt: 1 }}>
        <Kicker color={benchAnswers ? C.amber : C.muted}>{benchAnswers ? 'Bench · tap who comes in' : 'Bench · tap to sub in'}</Kicker>
      </Box>
      {bench.map((p) => row(p, false))}
      {bench.length === 0 && <Box sx={{ fontSize: 12, color: C.muted, px: 0.5 }}>No one on the bench.</Box>}
    </Card>
  );
}

export function ClassicRecorder({ rec }: { rec: Recorder }) {
  const [sel, setSel] = useState<number | null>(null);
  const [lastId, setLastId] = useState<number | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [note, setNote] = useState<{ text: string; warn?: boolean } | null>(null);
  /** Fifth-foul players the scorer chose to replace "later" (not asked again until they foul again). */
  const deferred = useRef(new Set<number>());

  const { live } = rec;
  const name = (s: Side) => rec.game[s].name;
  const onCourtNow = (id: number) => live.onCourt.home.includes(id) || live.onCourt.away.includes(id);
  const p = sel !== null ? rec.byId.get(sel) : undefined;
  const shown = p ?? (lastId !== null ? rec.byId.get(lastId) : undefined);
  const line = shown ? rec.box.players.find((l) => l.playerId === shown.playerId) : undefined;

  /** Records plays and says what was saved. */
  const save = (plays: NewEvent[], opts: RecordOptions = {}) => {
    rec.record(plays, opts);
    const who = plays[0] && 'playerId' in plays[0] && plays[0].playerId !== null ? rec.byId.get(plays[0].playerId) : undefined;
    const text = plays.map((e) => describe({ ...e, id: '', seq: 0, period: rec.period, clock: rec.clock } as GameEvent, rec)).join(' + ');
    setNote({ text: `Saved: ${who ? `${pl(who)} — ` : ''}${text}` });
  };

  const done = (next: Prompt | null = null) => {
    setPrompt(next);
    setSel(null);
  };

  // After a play, a player on court with five fouls must be replaced: ask unless another question is open.
  useEffect(() => {
    if (prompt) return;
    for (const s of ['home', 'away'] as const) {
      for (const id of live.onCourt[s]) {
        if (isFouledOut(live, id) && !deferred.current.has(id)) {
          const out = rec.byId.get(id);
          if (out) {
            setPrompt({ k: 'forcedSub', out });
            return;
          }
        }
      }
    }
  }, [rec.events, prompt]);

  // ---- Who may answer the open question ----
  const eligible = (q: RecorderPlayer, on: boolean): boolean => {
    if (!prompt) return false;
    switch (prompt.k) {
      case 'assist':
        return on && q.side === prompt.scorer.side && q.playerId !== prompt.scorer.playerId;
      case 'rebound':
        return on;
      case 'fouled':
        return on && q.side === other(prompt.fouler.side);
      case 'stealVictim':
        return on && q.side === other(prompt.thief.side);
      case 'stealer':
        return on && q.side === other(prompt.loser.side);
      case 'subIn':
      case 'forcedSub':
        return !on && q.side === prompt.out.side && !isFouledOut(live, q.playerId);
      case 'subOut':
        return on && q.side === prompt.inn.side;
      case 'foulKind':
      case 'ft':
        return false;
    }
  };

  const answer = (q: RecorderPlayer) => {
    if (!prompt) return;
    const who = { side: q.side, playerId: q.playerId };
    switch (prompt.k) {
      case 'assist':
        save([{ type: 'ast', ...who }]);
        return done();
      case 'rebound': {
        const off = q.side === prompt.shotSide;
        save([{ type: 'reb', ...who, off }], { shot: off ? 14 : 24 });
        return done();
      }
      case 'fouled':
        save([{ type: 'fd', ...who }]);
        return done(prompt.n ? { k: 'ft', shooter: q, n: prompt.n, i: 1 } : null);
      case 'stealVictim':
        save([{ type: 'tov', ...who }]);
        return done();
      case 'stealer':
        save([{ type: 'stl', ...who }]);
        return done();
      case 'subIn':
      case 'forcedSub':
        save([{ type: 'sub', side: q.side, playerId: null, outId: prompt.out.playerId, inId: q.playerId }], { stop: true });
        setNote({ text: `Sub: ${pl(q)} in for ${pl(prompt.out)}.` });
        return done();
      case 'subOut':
        save([{ type: 'sub', side: q.side, playerId: null, outId: q.playerId, inId: prompt.inn.playerId }], { stop: true });
        setNote({ text: `Sub: ${pl(prompt.inn)} in for ${pl(q)}.` });
        return done();
      default:
        return;
    }
  };

  const pickPlayer = (q: RecorderPlayer, on: boolean) => {
    if (prompt) {
      if (eligible(q, on)) return answer(q);
      setNote({ text: hint(prompt), warn: true });
      return;
    }
    if (!on) {
      // A bench player can only come in: ask who goes out.
      if (isFouledOut(live, q.playerId)) return setNote({ text: `${pl(q)} has 5 fouls and can’t return.`, warn: true });
      setSel(q.playerId);
      setPrompt({ k: 'subOut', inn: q });
      return;
    }
    setNote(null);
    setSel(sel === q.playerId ? null : q.playerId);
  };

  const press = (key: Key) => {
    if (!p || prompt || !onCourtNow(p.playerId) || isFouledOut(live, p.playerId)) return;
    const who = { side: p.side, playerId: p.playerId };
    setLastId(p.playerId);
    switch (key) {
      case '2pm':
      case '2px':
      case '3pm':
      case '3px': {
        const made = key.endsWith('m');
        save([{ type: 'shot', ...who, pts: key.startsWith('3') ? 3 : 2, made, x: null, y: null }], made ? { shot: 24 } : {});
        return done(made ? { k: 'assist', scorer: p } : { k: 'rebound', shotSide: p.side });
      }
      case 'ftm':
      case 'ftx': {
        // A single free throw (e.g. a technical). A miss can be rebounded.
        const made = key === 'ftm';
        save([{ type: 'ft', ...who, made }]);
        return done(made ? null : { k: 'rebound', shotSide: p.side });
      }
      case 'reb': {
        const off = isOffensiveRebound(rec.events, p.side);
        save([{ type: 'reb', ...who, off }], { shot: off ? 14 : 24 });
        return done();
      }
      case 'ast':
      case 'blk':
        save([{ type: key, ...who }]);
        return done();
      case 'stl':
        save([{ type: 'stl', ...who }], { shot: 24 });
        return done({ k: 'stealVictim', thief: p });
      case 'tov':
        save([{ type: 'tov', ...who }], { shot: 24, stop: true });
        return done({ k: 'stealer', loser: p });
      case 'pf':
        return done({ k: 'foulKind', fouler: p });
    }
  };

  const foul = (kind: FoulKind) => {
    if (prompt?.k !== 'foulKind') return;
    const f = prompt.fouler;
    // The penalty uses the team fouls before this one.
    const n = freeThrowsFor(kind, inPenalty(live, f.side, rec.period));
    const plays: NewEvent[] = [{ type: 'pf', side: f.side, playerId: f.playerId, kind }];
    if (kind === 'offensive') plays.push({ type: 'tov', side: f.side, playerId: f.playerId });
    save(plays, { stop: true });
    done({ k: 'fouled', fouler: f, kind, n });
  };

  const freeThrow = (made: boolean) => {
    if (prompt?.k !== 'ft') return;
    const { shooter, n, i } = prompt;
    const last = i === n;
    save([{ type: 'ft', side: shooter.side, playerId: shooter.playerId, made }], last && made ? { shot: 24 } : {});
    // Only the last free throw can be rebounded.
    done(!last ? { k: 'ft', shooter, n, i: i + 1 } : made ? null : { k: 'rebound', shotSide: shooter.side });
  };

  const skip = () => {
    if (prompt?.k === 'forcedSub') deferred.current.add(prompt.out.playerId);
    setNote(null);
    done();
  };

  const timeout = (side: Side) => {
    if (timeoutsLeft(live, side, rec.period) <= 0) return;
    rec.record([{ type: 'timeout', side, playerId: null }], { stop: true });
    setNote({ text: `Timeout ${name(side)}. ${timeoutsLeft(live, side, rec.period) - 1} left in the ${timeoutWindow(rec.period).label}.` });
  };

  const undo = () => {
    const gone = rec.undo();
    done();
    setNote(gone?.length ? { text: `Undid: ${gone.map((e) => describe(e, rec)).join(' + ')}` } : { text: 'Nothing to undo.', warn: true });
  };

  // Players with five fouls who have since been subbed out no longer need asking.
  useEffect(() => {
    for (const id of deferred.current) if (!onCourtNow(id)) deferred.current.delete(id);
  });

  const stats = line
    ? [
        ['PTS', line.pts],
        ['FG', `${line.fgm}/${line.fga}`],
        ['3PT', `${line.fg3m}/${line.fg3a}`],
        ['FT', `${line.ftm}/${line.fta}`],
        ['REB', line.reb],
        ['AST', line.ast],
        ['PF', line.pf],
        ['PIR', line.pir],
      ]
    : [];
  const canStat = !!p && !prompt && onCourtNow(p.playerId) && !isFouledOut(live, p.playerId);

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1.35fr) minmax(0, 1fr)' }, gap: 1.5 }}>
      <TeamColumn rec={rec} side="home" sel={sel} prompt={prompt} eligible={eligible} onPick={pickPlayer} />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minHeight: 0, order: { xs: -1, md: 0 } }}>
        {prompt ? (
          <PromptCard rec={rec} prompt={prompt} onFoul={foul} onFreeThrow={freeThrow} onSkip={skip} onTeamRebound={(s) => {
            if (prompt.k !== 'rebound') return;
            const off = s === prompt.shotSide;
            save([{ type: 'reb', side: s, playerId: null, off }], { shot: off ? 14 : 24 });
            done();
          }} />
        ) : (
          <Card label="Selected player" sx={{ p: '10px 14px', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {shown ? (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                  <Box sx={{ fontFamily: display, fontSize: 38, fontWeight: 700, color: SIDE_COLOR[shown.side], lineHeight: 1 }}>{shown.jersey}</Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ fontSize: 16, fontWeight: 600 }}>{shown.firstName} {shown.lastName}</Box>
                    <Box sx={{ fontSize: 12, color: C.muted }}>
                      {p ? `${name(shown.side)} · selected — tap a stat` : `${name(shown.side)} · last entry · tap a player for the next play`}
                    </Box>
                  </Box>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 0.5, textAlign: 'center' }}>
                  {stats.map(([k, v]) => (
                    <Box key={k}>
                      <Box sx={{ fontSize: 10, color: C.muted, letterSpacing: '.06em' }}>{k}</Box>
                      <Box sx={{ fontFamily: display, fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v}</Box>
                    </Box>
                  ))}
                </Box>
              </>
            ) : (
              <Box sx={{ py: 1.5, fontSize: 14, color: C.muted }}>Tap a player on court, then what happened. Tap a bench player to sub them in.</Box>
            )}
          </Card>
        )}

        <Box role="group" aria-label="Stats" sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 0.75 }}>
          {ACTIONS.map((a) => (
            <Option key={a.key} label={a.label} sub={a.sub} kind={a.kind} height={58} size={19} disabled={!canStat} onClick={() => press(a.key)} />
          ))}
          <Option
            label="Substitute"
            sub="then tap bench"
            height={58}
            size={19}
            disabled={!p || !!prompt || !onCourtNow(p.playerId)}
            onClick={() => p && done({ k: 'subIn', out: p })}
          />
          <Option label="Undo" sub="last entry" kind="warn" height={58} size={19} disabled={!rec.canUndo} onClick={undo} />
          {(['home', 'away'] as const).map((s) => (
            <Option key={s} label="Timeout" sub={`${rec.game[s].shortName} · ${timeoutsLeft(live, s, rec.period)} left`} kind="miss" height={58} size={19} disabled={timeoutsLeft(live, s, rec.period) <= 0} onClick={() => timeout(s)} />
          ))}
        </Box>
        <Box role="status" sx={{ minHeight: 22, fontSize: 12.5, color: note?.warn ? C.warn : note ? C.muted : C.dim, px: 0.5, mt: -0.5 }}>
          {note?.text ?? `Team fouls this period: ${rec.game.home.shortName} ${teamFoulsIn(live, 'home', rec.period)} · ${rec.game.away.shortName} ${teamFoulsIn(live, 'away', rec.period)}`}
        </Box>

        <PlayByPlay rec={rec} />
      </Box>

      <TeamColumn rec={rec} side="away" sel={sel} prompt={prompt} eligible={eligible} onPick={pickPlayer} />
    </Box>
  );
}

/** What to tap when the scorer taps someone who can't answer the open question. */
function hint(q: Prompt): string {
  switch (q.k) {
    case 'assist':
      return `Assist: tap a teammate of ${pl(q.scorer)} on court, or No assist.`;
    case 'rebound':
      return 'Rebound: tap any player on court (lit), or a team rebound.';
    case 'fouled':
      return `Tap the player ${pl(q.fouler)} fouled (lit, on court).`;
    case 'stealVictim':
      return `Tap who lost the ball to ${pl(q.thief)} (lit), or Skip.`;
    case 'stealer':
      return `Tap who stole it from ${pl(q.loser)} (lit), or No steal.`;
    case 'subIn':
    case 'forcedSub':
      return `Tap a bench player to come in for ${pl(q.out)} (lit).`;
    case 'subOut':
      return `Tap the player going out for ${pl(q.inn)} (lit, same team).`;
    case 'foulKind':
      return 'Pick the kind of foul above first.';
    case 'ft':
      return 'Made or missed? Answer the free throw above first.';
  }
}

function PromptCard({
  rec,
  prompt,
  onFoul,
  onFreeThrow,
  onSkip,
  onTeamRebound,
}: {
  rec: Recorder;
  prompt: Prompt;
  onFoul: (k: FoulKind) => void;
  onFreeThrow: (made: boolean) => void;
  onSkip: () => void;
  onTeamRebound: (s: Side) => void;
}) {
  const name = (s: Side) => rec.game[s].name;
  let kicker = '';
  let title = '';
  let sub = '';
  let body: React.ReactNode = null;
  let skip: string | null = 'Skip';

  switch (prompt.k) {
    case 'assist':
      kicker = 'Made basket';
      title = 'Assisted by?';
      sub = `${pl(prompt.scorer)} scored. Tap the passer (lit).`;
      skip = 'No assist';
      break;
    case 'rebound': {
      const s = prompt.shotSide;
      kicker = 'Missed shot';
      title = 'Who got the rebound?';
      sub = `Tap whoever got it: ${name(s)} = offensive, ${name(other(s))} = defensive.`;
      skip = 'No rebound';
      body = (
        <OptionGrid cols={2}>
          {(['home', 'away'] as const).map((t) => (
            <Option key={t} label={`Team · ${rec.game[t].shortName}`} sub={`team ${t === s ? 'offensive' : 'defensive'} rebound`} kind="miss" height={48} size={17} onClick={() => onTeamRebound(t)} />
          ))}
        </OptionGrid>
      );
      break;
    }
    case 'foulKind': {
      const f = prompt.fouler;
      const pen = inPenalty(rec.live, f.side, rec.period);
      kicker = 'Foul';
      title = `${pl(f)} — what kind?`;
      sub = `${name(f.side)} has ${teamFoulsIn(rec.live, f.side, rec.period)} team fouls this period${pen ? ' (penalty)' : ''}.`;
      skip = 'Cancel';
      body = (
        <OptionGrid>
          {FOUL_KINDS.map((k) => (
            <Option key={k.kind} label={k.label} sub={k.sub(pen)} kind="foul" height={54} size={k.kind === 'unsport' ? 16 : 19} onClick={() => onFoul(k.kind)} />
          ))}
        </OptionGrid>
      );
      break;
    }
    case 'fouled':
      kicker = 'Foul drawn';
      title = prompt.kind === 'offensive' ? 'Who drew the offensive foul?' : 'Who was fouled?';
      sub = `Fouled by ${pl(prompt.fouler)}. ${prompt.n ? `They shoot ${prompt.n === 1 ? '1 free throw' : `${prompt.n} free throws`} next.` : 'Tap the player (lit).'}`;
      // Free throws are due: the shooter must be picked (Undo removes the foul if it was a mistake).
      skip = prompt.n ? null : 'Skip';
      break;
    case 'ft':
      kicker = `Free throw ${prompt.i} of ${prompt.n}`;
      title = pl(prompt.shooter);
      sub = prompt.i === prompt.n ? 'Last free throw. A miss goes to the rebound.' : 'Made or missed?';
      skip = null;
      body = (
        <OptionGrid cols={2}>
          <Option label="Made" sub="free throw" kind="made" height={84} size={32} onClick={() => onFreeThrow(true)} />
          <Option label="Missed" sub="free throw" kind="miss" height={84} size={32} onClick={() => onFreeThrow(false)} />
        </OptionGrid>
      );
      break;
    case 'stealVictim':
      kicker = 'Steal';
      title = 'Who lost the ball?';
      sub = `Steal by ${pl(prompt.thief)}. Tap the ${name(other(prompt.thief.side))} player (lit); their turnover is added.`;
      break;
    case 'stealer':
      kicker = 'Turnover';
      title = 'Stolen by?';
      sub = `${pl(prompt.loser)} lost the ball. Tap the ${name(other(prompt.loser.side))} player (lit), or No steal for a travel, bad pass or out of bounds.`;
      skip = 'No steal';
      break;
    case 'subIn':
      kicker = 'Substitution';
      title = `Who comes in for ${pl(prompt.out)}?`;
      sub = 'Tap a bench player (lit). Players with 5 fouls can’t return.';
      skip = 'Cancel';
      break;
    case 'subOut':
      kicker = 'Substitution';
      title = `Who goes out for ${pl(prompt.inn)}?`;
      sub = `Tap the ${name(prompt.inn.side)} player leaving the court (lit).`;
      skip = 'Cancel';
      break;
    case 'forcedSub':
      kicker = 'Fifth foul';
      title = `${pl(prompt.out)} must leave the game`;
      sub = 'Tap the bench player coming in (lit).';
      skip = 'Later';
      break;
  }

  return (
    <Card label="Question" sx={{ p: '12px 14px', display: 'flex', flexDirection: 'column', gap: 1, border: `1.5px solid ${C.amber}` }}>
      <Box aria-live="polite" sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Kicker color={C.amber}>{kicker}</Kicker>
          <Box component="h2" sx={{ m: '2px 0 0', fontFamily: display, fontSize: 26, fontWeight: 600, lineHeight: 1.05 }}>{title}</Box>
          <Box sx={{ fontSize: 12.5, color: C.muted, mt: 0.5 }}>{sub}</Box>
        </Box>
        {skip && (
          <Btn onClick={onSkip} sx={{ minHeight: 40, fontSize: 13, flex: 'none', bgcolor: 'transparent', border: `1px solid ${C.strongBorder}` }}>
            {skip}
          </Btn>
        )}
      </Box>
      {body}
    </Card>
  );
}
