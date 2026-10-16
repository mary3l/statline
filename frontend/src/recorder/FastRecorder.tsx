import { parseCommand } from '@engine/commands';
import { isBeyondArc, toMetres } from '@engine/court';
import { freeThrowsFor, inPenalty, isOffensiveRebound, teamFoulsIn, timeoutsLeft } from '@engine/live';
import type { FoulKind, GameEvent } from '@engine/types';
import { Box } from '@mui/material';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { RecorderPlayer, Side } from '../api/types';
import { lastMissSide, lookup, said, sideWords } from './commandSupport';
import { Court } from './Court';
import { FOUL_LABEL, PlayByPlay, describe, playLine } from './PlayByPlay';
import { C, display, other } from './theme';
import { Btn, Card, Kicker, Option, OptionGrid, PlayerGroup } from './ui';
import { shortName, type Recorder } from './useRecorder';

type PickAction = 'reb' | 'ast' | 'stl' | 'blk' | 'tov' | 'foul';

/** Where the scorer is in a play. Each step asks one question. */
type Step =
  | { k: 'idle' }
  | { k: 'pick'; action: PickAction }
  | { k: 'stealVictim'; side: Side }
  | { k: 'stealer'; side: Side; loser: RecorderPlayer }
  | { k: 'foulType'; fouler: RecorderPlayer }
  | { k: 'fdPick'; side: Side; n: number; kind: FoulKind; fouler: RecorderPlayer }
  | { k: 'ft'; shooter: RecorderPlayer; n: number; i: number }
  | { k: 'zone'; pts: 2 | 3 }
  | { k: 'shotResult'; pts: 2 | 3; x: number; y: number }
  | { k: 'shotPlayer'; pts: 2 | 3; x: number; y: number; made: boolean }
  | { k: 'assist'; scorer: RecorderPlayer }
  | { k: 'rebound'; shotSide: Side }
  | { k: 'subOut' }
  | { k: 'subIn'; side: Side; out: RecorderPlayer }
  | { k: 'edit'; id: string }
  | { k: 'editPlayer'; id: string };

const PICK_TEXT: Record<PickAction, { kicker: string; title: string; sub?: string }> = {
  reb: { kicker: 'Rebound', title: 'Who got the rebound?', sub: 'Offensive or defensive is set from the team that missed (shot clock 14 or 24).' },
  ast: { kicker: 'Assist', title: 'Who made the assist?' },
  stl: { kicker: 'Steal', title: 'Who made the steal?', sub: 'Next you’ll tap who lost the ball.' },
  blk: { kicker: 'Block', title: 'Who blocked the shot?' },
  tov: { kicker: 'Turnover', title: 'Who turned it over?', sub: 'Next: was it stolen? The clock stops.' },
  foul: { kicker: 'Foul', title: 'Who committed the foul?', sub: 'Next you’ll pick the kind of foul.' },
};

interface Panel {
  kicker: string;
  kColor?: string;
  border?: string;
  title: string;
  sub?: string;
  cancel?: boolean;
  alerts?: ReactNode;
  groups?: ReactNode;
  options?: ReactNode;
}

export function FastRecorder({ rec }: { rec: Recorder }) {
  const [step, setStep] = useState<Step>({ k: 'idle' });
  const [courtMsg, setCourtMsg] = useState('');
  const go = (s: Step) => {
    setStep(s);
    setCourtMsg('');
  };
  const idle = () => go({ k: 'idle' });

  const { live } = rec;
  const fouls = live.fouls;
  const onCourt = (side: Side) => live.onCourt[side].map((id) => rec.byId.get(id)).filter((p): p is RecorderPlayer => !!p);
  const name = (side: Side) => rec.game[side].name;
  const pl = (p: RecorderPlayer) => `#${p.jersey} ${shortName(p)}`;
  const both = (onPick: (p: RecorderPlayer) => void, allowFouledOut = false) => (
    <Box sx={{ display: 'flex', gap: 1.5 }}>
      {(['home', 'away'] as const).map((s) => (
        <PlayerGroup key={s} side={s} label={name(s)} players={onCourt(s)} fouls={fouls} onPick={onPick} allowFouledOut={allowFouledOut} />
      ))}
    </Box>
  );

  // ---- Plays ----
  const recordShot = (p: RecorderPlayer, pts: 2 | 3, made: boolean, x: number, y: number) => {
    rec.record([{ type: 'shot', side: p.side, playerId: p.playerId, pts, made, x, y }], made ? { shot: 24 } : {});
    go(made ? { k: 'assist', scorer: p } : { k: 'rebound', shotSide: p.side });
  };

  const rebound = (side: Side, playerId: number | null, off: boolean) => {
    rec.record([{ type: 'reb', side, playerId, off }], { shot: off ? 14 : 24 });
    idle();
  };

  const pick = (action: PickAction, p: RecorderPlayer) => {
    const who = { side: p.side, playerId: p.playerId };
    switch (action) {
      case 'reb':
        // The team that missed = offensive rebound; the other team = defensive.
        return rebound(p.side, p.playerId, isOffensiveRebound(rec.events, p.side));
      case 'stl':
        rec.record([{ type: 'stl', ...who }], { shot: 24 });
        return go({ k: 'stealVictim', side: other(p.side) });
      case 'foul':
        return go({ k: 'foulType', fouler: p });
      case 'tov':
        rec.record([{ type: 'tov', ...who }], { shot: 24, stop: true });
        // A turnover is often the other team's steal: ask, as a steal asks who lost the ball.
        return go({ k: 'stealer', side: other(p.side), loser: p });
      case 'ast':
      case 'blk':
        rec.record([{ type: action, ...who }]);
        return idle();
    }
  };

  const foul = (kind: FoulKind, p: RecorderPlayer) => {
    // The penalty depends on the team fouls before this one.
    const n = freeThrowsFor(kind, inPenalty(live, p.side, rec.period));
    const list: Parameters<Recorder['record']>[0] = [{ type: 'pf', side: p.side, playerId: p.playerId, kind }];
    if (kind === 'offensive') list.push({ type: 'tov', side: p.side, playerId: p.playerId });
    rec.record(list, { stop: true });
    go({ k: 'fdPick', side: other(p.side), n, kind, fouler: p });
  };

  const freeThrow = (made: boolean) => {
    if (step.k !== 'ft') return;
    const { shooter, n, i } = step;
    const last = i === n;
    rec.record([{ type: 'ft', side: shooter.side, playerId: shooter.playerId, made }], last && made ? { shot: 24 } : {});
    // A missed free throw before the last one is a dead ball; only the last one can be rebounded.
    go(!last ? { k: 'ft', shooter, n, i: i + 1 } : made ? { k: 'idle' } : { k: 'rebound', shotSide: shooter.side });
  };

  const timeout = (side: Side) => {
    if (timeoutsLeft(live, side, rec.period) <= 0) return;
    rec.record([{ type: 'timeout', side, playerId: null }], { stop: true });
    idle();
  };

  const courtTap = (x: number, y: number) => {
    if (step.k !== 'zone' && step.k !== 'shotResult') {
      setCourtMsg(step.k === 'shotPlayer' ? 'Now tap the shooter on the right.' : 'Pick 2PT or 3PT first — then the right part of the court unlocks.');
      return;
    }
    const { mx, my } = toMetres(x, y);
    const three = isBeyondArc(mx, my);
    if ((three ? 3 : 2) !== step.pts) {
      setCourtMsg(
        three
          ? 'Locked: that spot is outside the arc. You picked 2PT — tap the lit area.'
          : 'Locked: that spot is inside the arc. You picked 3PT — tap the lit area.',
      );
      return;
    }
    go({ k: 'shotResult', x, y, pts: step.pts });
  };

  // ---- Typed commands (no voice): jersey first, then the play ----
  const [cmd, setCmd] = useState('');
  const [cmdMsg, setCmdMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const runCommand = (text: string) => {
    const c = parseCommand(text, sideWords(rec));
    const ok = (t: string) => {
      setCmd('');
      setCmdMsg({ text: t, ok: true });
    };
    const fail = (t: string) => setCmdMsg({ text: t, ok: false });
    const player = (jersey: string, side: Side | undefined) => {
      const r = lookup(rec, jersey, side);
      if ('error' in r) {
        fail(r.error);
        return null;
      }
      return r.player;
    };
    switch (c.kind) {
      case 'error':
        return fail(c.message);
      case 'undo': {
        const gone = rec.undo();
        idle();
        return gone?.length ? ok(`Undid: ${gone.map((e) => describe(e, rec)).join(' + ')}`) : fail('Nothing to undo.');
      }
      case 'score':
        return ok(`${rec.game.home.shortName} ${rec.box.score.home} – ${rec.box.score.away} ${rec.game.away.shortName}`);
      case 'clock':
        rec.toggleClock();
        return ok(rec.running ? 'Clock stopped.' : 'Clock started.');
      case 'nextPeriod':
        rec.setPeriod(rec.period + 1);
        idle();
        return ok('Next period: clock reset.');
      case 'timeout':
        if (timeoutsLeft(live, c.side, rec.period) <= 0) return fail(`${name(c.side)} has no timeouts left.`);
        timeout(c.side);
        return ok(`Timeout ${name(c.side)}.`);
      case 'sub': {
        const out = lookup(rec, c.outJersey, c.side, { onCourtOnly: true });
        if ('error' in out) return fail(out.error);
        const inn = lookup(rec, c.inJersey, out.player.side, { benchOnly: true });
        if ('error' in inn) return fail(inn.error);
        if ((fouls.get(inn.player.playerId) ?? 0) >= 5) return fail(`${said(inn.player)} has 5 fouls and can’t return.`);
        rec.record([{ type: 'sub', side: out.player.side, playerId: null, outId: out.player.playerId, inId: inn.player.playerId }], { stop: true });
        idle();
        return ok(`Sub: ${said(inn.player)} in for ${said(out.player)}.`);
      }
      default:
        break;
    }
    const p = player(c.jersey, c.side);
    if (!p) return;
    if ((fouls.get(p.playerId) ?? 0) >= 5) return fail(`${said(p)} has 5 fouls and is out of the game.`);
    switch (c.kind) {
      case 'shot':
        rec.record([{ type: 'shot', side: p.side, playerId: p.playerId, pts: c.pts, made: c.made, x: null, y: null }], c.made ? { shot: 24 } : {});
        go(c.made ? { k: 'assist', scorer: p } : { k: 'rebound', shotSide: p.side });
        return ok(`${said(p)} · ${c.pts}PT ${c.made ? 'made — who assisted?' : 'missed — who rebounded?'}`);
      case 'ft':
        rec.record([{ type: 'ft', side: p.side, playerId: p.playerId, made: c.made }]);
        go(c.made ? { k: 'idle' } : { k: 'rebound', shotSide: p.side });
        return ok(`${said(p)} · free throw ${c.made ? 'made' : 'missed — who rebounded?'}`);
      case 'reb': {
        const off = c.off ?? lastMissSide(rec.events) === p.side;
        rebound(p.side, p.playerId, off);
        return ok(`${said(p)} · ${off ? 'offensive' : 'defensive'} rebound`);
      }
      case 'stat':
        if ((c.stat === 'stl' || c.stat === 'tov') && c.other) {
          // "2 steal 7" / "7 turnover 2": both halves at once.
          const o = lookup(rec, c.other, other(p.side), { onCourtOnly: true });
          if ('error' in o) return fail(o.error);
          rec.record(
            [
              { type: c.stat, side: p.side, playerId: p.playerId },
              { type: c.stat === 'stl' ? 'tov' : 'stl', side: o.player.side, playerId: o.player.playerId },
            ],
            c.stat === 'tov' ? { shot: 24, stop: true } : { shot: 24 },
          );
          idle();
          return ok(`${said(p)} · ${c.stat === 'stl' ? 'steal from' : 'turnover, stolen by'} ${said(o.player)}`);
        }
        pick(c.stat, p);
        return ok(`${said(p)} · ${{ ast: 'assist', stl: 'steal — who lost it?', blk: 'block', tov: 'turnover — stolen by?' }[c.stat]}`);
      case 'foul':
        if (c.foul) {
          foul(c.foul, p);
          return ok(`${said(p)} · foul (${FOUL_LABEL[c.foul]}) — who was fouled?`);
        }
        go({ k: 'foulType', fouler: p });
        return ok(`${said(p)} · foul — pick the kind`);
    }
  };

  const commandBar = (
    <Card label="Typed command" sx={{ p: '8px 10px', display: 'flex', flexDirection: 'column', gap: 0.75, flex: 'none' }}>
      <Box
        component="form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (cmd.trim()) runCommand(cmd);
        }}
        sx={{ display: 'flex', gap: 1 }}
      >
        <Box component="label" htmlFor="rec-cmd" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          Typed command
        </Box>
        <Box
          component="input"
          id="rec-cmd"
          value={cmd}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCmd(e.target.value)}
          placeholder="Type: “7 three made”, “12 rebound”, “5 foul”, “2 steal 7”, “24 in 5 out”"
          sx={{ flex: 1, minWidth: 0, minHeight: 48, px: 1.75, borderRadius: '10px', border: `1px solid ${C.buttonBorder}`, bgcolor: C.bg, color: C.text, font: 'inherit', fontSize: 15, '&::placeholder': { color: C.dim }, '&:focus-visible': { outline: `2px solid ${C.amber}` } }}
        />
        <Btn sx={{ minHeight: 48, px: 2, border: 'none', bgcolor: C.text, color: C.bg, fontWeight: 600 }}>Enter</Btn>
      </Box>
      {cmdMsg && (
        <Box role="status" sx={{ fontSize: 12, px: 0.5, color: cmdMsg.ok ? C.muted : C.warn }}>
          {cmdMsg.text}
        </Box>
      )}
    </Card>
  );

  // ---- Editing ----
  const editing = step.k === 'edit' || step.k === 'editPlayer' ? rec.events.find((e) => e.id === step.id) : undefined;
  const change = (e: GameEvent, patch: Partial<GameEvent>) => {
    rec.update({ ...e, ...patch } as GameEvent);
    idle();
  };

  // ---- Panel for the current step ----
  let P: Panel;
  switch (step.k) {
    case 'idle': {
      const tl = (s: Side) => timeoutsLeft(live, s, rec.period);
      const act = (a: PickAction) => () => go({ k: 'pick', action: a });
      const out = (['home', 'away'] as const).flatMap((s) => onCourt(s).filter((p) => (fouls.get(p.playerId) ?? 0) >= 5));
      P = {
        kicker: 'Ready',
        title: 'Pick 2PT or 3PT to log a shot',
        sub: 'Or pick another play, then tap the player.',
        alerts: out.map((p) => (
          <Box key={p.playerId} role="alert" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: '10px 12px', borderRadius: '10px', border: `1px solid ${C.amber}`, bgcolor: 'rgba(245,184,90,0.10)', fontSize: 13 }}>
            <Box component="span" sx={{ flex: 1 }}>{pl(p)} has 5 fouls and must leave the game.</Box>
            <Btn onClick={() => go({ k: 'subIn', side: p.side, out: p })} sx={{ minHeight: 36, border: 'none', bgcolor: C.amber, color: C.bg, fontWeight: 600, fontSize: 12 }}>
              Substitute
            </Btn>
          </Box>
        )),
        options: (
          <OptionGrid>
            <Option label="Rebound" sub="offense or defense set for you" onClick={act('reb')} height={62} />
            <Option label="Assist" onClick={act('ast')} height={62} />
            <Option label="Steal" sub="adds their turnover" onClick={act('stl')} height={62} />
            <Option label="Block" onClick={act('blk')} height={62} />
            <Option label="Turnover" sub="then who stole it" onClick={act('tov')} height={62} />
            <Option label="Foul" sub="then who was fouled" onClick={act('foul')} kind="foul" height={62} />
            <Option label="Substitution" sub="tap out, then in" onClick={() => go({ k: 'subOut' })} height={62} />
            <Option label="Timeout" sub={`${rec.game.home.shortName} · ${tl('home')} left`} onClick={() => timeout('home')} kind="miss" height={62} disabled={tl('home') <= 0} />
            <Option label="Timeout" sub={`${rec.game.away.shortName} · ${tl('away')} left`} onClick={() => timeout('away')} kind="miss" height={62} disabled={tl('away') <= 0} />
          </OptionGrid>
        ),
      };
      break;
    }
    case 'pick': {
      const t = PICK_TEXT[step.action];
      P = { ...t, cancel: true, kColor: step.action === 'foul' ? C.amber : undefined, groups: both((p) => pick(step.action, p)) };
      break;
    }
    case 'stealVictim':
      P = {
        kicker: 'Steal · follow-up',
        title: 'Who lost the ball?',
        sub: 'Their turnover is added automatically.',
        groups: (
          <PlayerGroup
            side={step.side}
            label={name(step.side)}
            players={onCourt(step.side)}
            fouls={fouls}
            onPick={(p) => {
              rec.record([{ type: 'tov', side: p.side, playerId: p.playerId }]);
              idle();
            }}
          />
        ),
        options: <OptionGrid><Option label="Skip" sub="no turnover" onClick={idle} kind="miss" height={52} /></OptionGrid>,
      };
      break;
    case 'stealer':
      P = {
        kicker: 'Turnover · follow-up',
        title: 'Stolen by?',
        sub: `${pl(step.loser)} lost the ball. Pick who stole it; their steal is added. No steal = travel, bad pass, out of bounds, violation.`,
        groups: (
          <PlayerGroup
            side={step.side}
            label={`Steal · ${name(step.side)}`}
            players={onCourt(step.side)}
            fouls={fouls}
            onPick={(p) => {
              rec.record([{ type: 'stl', side: p.side, playerId: p.playerId }]);
              idle();
            }}
          />
        ),
        options: <OptionGrid><Option label="No steal" sub="travel, bad pass, out of bounds…" onClick={idle} kind="miss" height={52} size={19} /></OptionGrid>,
      };
      break;
    case 'foulType': {
      const p = step.fouler;
      const tf = teamFoulsIn(live, p.side, rec.period);
      const pen = inPenalty(live, p.side, rec.period);
      const f = (k: FoulKind) => () => foul(k, p);
      P = {
        kicker: 'Foul',
        kColor: C.amber,
        title: `${pl(p)} — what kind?`,
        sub: pen
          ? `${name(p.side)} already has ${tf} team fouls this period (penalty): a personal foul gives 2 free throws.`
          : `${name(p.side)} has ${tf} team foul${tf === 1 ? '' : 's'} this period.`,
        cancel: true,
        options: (
          <OptionGrid>
            <Option label="Personal" sub={pen ? 'penalty · 2 FT' : 'no free throws'} onClick={f('personal')} kind="foul" height={72} />
            <Option label="Shooting" sub="2 free throws" onClick={f('shoot2')} kind="foul" height={72} />
            <Option label="Shooting" sub="3 free throws" onClick={f('shoot3')} kind="foul" height={72} />
            <Option label="And-one" sub="1 free throw" onClick={f('and1')} kind="foul" height={72} />
            <Option label="Offensive" sub="also a turnover" onClick={f('offensive')} kind="foul" height={72} />
            <Option label="Unsportsmanlike" sub="2 FT + possession" onClick={f('unsport')} kind="foul" height={72} size={19} />
          </OptionGrid>
        ),
      };
      break;
    }
    case 'fdPick':
      P = {
        kicker: 'Foul drawn',
        kColor: C.amber,
        border: C.strongBorder,
        title: step.kind === 'offensive' ? 'Who drew the offensive foul?' : 'Who was fouled?',
        sub: `Fouled by ${pl(step.fouler)}. ${step.n ? `This player shoots ${step.n === 1 ? '1 free throw' : `${step.n} free throws`} next.` : 'Records a foul drawn (FD), which counts toward PIR.'}`,
        groups: (
          <PlayerGroup
            side={step.side}
            label={`Fouled player · ${name(step.side)}`}
            players={onCourt(step.side)}
            fouls={fouls}
            cols={2}
            onPick={(p) => {
              rec.record([{ type: 'fd', side: p.side, playerId: p.playerId }]);
              go(step.n ? { k: 'ft', shooter: p, n: step.n, i: 1 } : { k: 'idle' });
            }}
          />
        ),
        options: step.n ? undefined : <OptionGrid><Option label="Skip" sub="no foul drawn" onClick={idle} kind="miss" height={52} /></OptionGrid>,
      };
      break;
    case 'ft':
      P = {
        kicker: `Free throw ${step.i} of ${step.n}`,
        title: pl(step.shooter),
        sub: step.i === step.n ? 'Last free throw. A miss goes to the rebound.' : 'Made or missed?',
        options: (
          <OptionGrid cols={2}>
            <Option label="Made" sub="free throw" onClick={() => freeThrow(true)} kind="made" height={150} size={40} />
            <Option label="Missed" sub="free throw" onClick={() => freeThrow(false)} kind="miss" height={150} size={40} />
          </OptionGrid>
        ),
      };
      break;
    case 'zone':
      P = {
        kicker: 'Shot',
        kColor: C.amber,
        border: C.strongBorder,
        title: `${step.pts}PT attempt · tap the spot`,
        sub: `Only the lit part of the court can be tapped. The ${step.pts === 2 ? '3PT area (outside the arc)' : '2PT area (inside the arc)'} is locked.`,
        cancel: true,
      };
      break;
    case 'shotResult': {
      const s = step;
      P = {
        kicker: 'Shot',
        kColor: C.amber,
        border: C.strongBorder,
        title: `${s.pts}PT attempt`,
        sub: 'Made or missed? Then tap the shooter. Tap the lit area again to move the spot.',
        cancel: true,
        options: (
          <OptionGrid cols={2}>
            <Option label="Made" sub={`${s.pts} points`} onClick={() => go({ ...s, k: 'shotPlayer', made: true })} kind="made" height={150} size={44} />
            <Option label="Missed" sub={`${s.pts}PT attempt`} onClick={() => go({ ...s, k: 'shotPlayer', made: false })} kind="miss" height={150} size={44} />
          </OptionGrid>
        ),
      };
      break;
    }
    case 'shotPlayer': {
      const s = step;
      P = {
        kicker: `${s.pts}PT ${s.made ? 'made' : 'missed'}`,
        kColor: C.amber,
        border: C.strongBorder,
        title: 'Who took the shot?',
        sub: s.made ? 'Next: who assisted.' : 'Next: who got the rebound.',
        cancel: true,
        groups: both((p) => recordShot(p, s.pts, s.made, s.x, s.y)),
      };
      break;
    }
    case 'assist': {
      const s = step.scorer;
      P = {
        kicker: 'Made basket · follow-up',
        title: 'Assisted by?',
        sub: `${pl(s)} scored.`,
        groups: (
          <PlayerGroup
            side={s.side}
            label={name(s.side)}
            players={onCourt(s.side).filter((p) => p.playerId !== s.playerId)}
            fouls={fouls}
            onPick={(p) => {
              rec.record([{ type: 'ast', side: p.side, playerId: p.playerId }]);
              idle();
            }}
          />
        ),
        options: <OptionGrid><Option label="No assist" onClick={idle} kind="miss" height={52} /></OptionGrid>,
      };
      break;
    }
    case 'rebound': {
      // Tap whoever got it: the shooting team's player is an offensive rebound, the other team's defensive.
      const shotSide = step.shotSide;
      const kind = (s: Side) => (s === shotSide ? 'offensive' : 'defensive');
      P = {
        kicker: 'Missed shot · follow-up',
        title: 'Who got the rebound?',
        sub: `Tap whoever got it. ${name(shotSide)} = offensive, ${name(other(shotSide))} = defensive.`,
        groups: (
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            {(['home', 'away'] as const).map((s) => (
              <PlayerGroup key={s} side={s} label={`${name(s)} · ${kind(s)}`} players={onCourt(s)} fouls={fouls} onPick={(p) => rebound(p.side, p.playerId, p.side === shotSide)} />
            ))}
          </Box>
        ),
        options: (
          <OptionGrid>
            {(['home', 'away'] as const).map((s) => (
              <Option key={s} label={`Team · ${rec.game[s].shortName}`} sub={`team ${kind(s)} rebound`} onClick={() => rebound(s, null, s === shotSide)} kind="miss" height={52} size={18} />
            ))}
            <Option label="No rebound" sub="out of bounds, violation…" onClick={idle} kind="miss" height={52} size={18} />
          </OptionGrid>
        ),
      };
      break;
    }
    case 'subOut':
      P = { kicker: 'Substitution', title: 'Who is going out?', cancel: true, groups: both((p) => go({ k: 'subIn', side: p.side, out: p }), true) };
      break;
    case 'subIn': {
      const s = step;
      const court = new Set(live.onCourt[s.side]);
      P = {
        kicker: 'Substitution',
        title: `Who comes in for ${pl(s.out)}?`,
        sub: 'Players with 5 fouls can’t return.',
        cancel: true,
        groups: (
          <PlayerGroup
            side={s.side}
            label={`Bench · ${name(s.side)}`}
            players={rec.players[s.side].filter((p) => !court.has(p.playerId))}
            fouls={fouls}
            cols={2}
            onPick={(p) => {
              rec.record([{ type: 'sub', side: s.side, playerId: null, outId: s.out.playerId, inId: p.playerId }], { stop: true });
              idle();
            }}
          />
        ),
      };
      break;
    }
    case 'edit':
    case 'editPlayer': {
      const e = editing;
      if (!e) {
        P = { kicker: 'Edit entry', title: 'That entry is gone', cancel: true };
        break;
      }
      if (step.k === 'edit') {
        const canChangePlayer = e.playerId !== null && e.side !== null;
        P = {
          kicker: 'Edit entry',
          kColor: '#9CC6F7',
          border: C.strongBorder,
          title: 'Fix this play',
          sub: playLine(e, rec),
          cancel: true,
          options: (
            <OptionGrid cols={2}>
              {canChangePlayer && (
                <Option label={e.type === 'pf' ? 'Change player or kind' : 'Change player'} sub="same team" onClick={() => go({ k: 'editPlayer', id: e.id })} height={64} />
              )}
              {(e.type === 'shot' || e.type === 'ft') && <Option label={`Mark as ${e.made ? 'missed' : 'made'}`} onClick={() => change(e, { made: !e.made })} height={64} />}
              {e.type === 'shot' && <Option label={`Change to ${e.pts === 2 ? 3 : 2}PT`} onClick={() => change(e, { pts: e.pts === 2 ? 3 : 2 })} height={64} />}
              {e.type === 'reb' && <Option label={`Make it ${e.off ? 'defensive' : 'offensive'}`} sub={e.off ? 'DREB' : 'OREB'} onClick={() => change(e, { off: !e.off })} height={64} />}
              <Option
                label="Delete entry"
                sub="stats update right away"
                kind="warn"
                height={64}
                onClick={() => {
                  rec.remove(e.id);
                  idle();
                }}
              />
            </OptionGrid>
          ),
        };
      } else if (e.side && e.playerId !== null) {
        const side = e.side;
        P = {
          kicker: 'Edit entry',
          kColor: '#9CC6F7',
          title: e.type === 'pf' ? 'Who fouled, and what kind?' : 'Who really did it?',
          sub: `${describe(e, rec)} · currently ${pl(rec.byId.get(e.playerId)!)}`,
          cancel: true,
          groups: (
            <PlayerGroup side={side} label={name(side)} players={rec.players[side]} fouls={fouls} cols={2} allowFouledOut onPick={(p) => change(e, { playerId: p.playerId })} />
          ),
          options:
            e.type === 'pf' ? (
              <OptionGrid>
                {(Object.keys(FOUL_LABEL) as FoulKind[]).map((k) => (
                  <Option key={k} label={FOUL_LABEL[k]} sub={k === e.kind ? 'current' : ''} kind="foul" height={52} size={17} disabled={k === e.kind} onClick={() => change(e, { kind: k })} />
                ))}
              </OptionGrid>
            ) : undefined,
        };
      } else {
        P = { kicker: 'Edit entry', title: 'This play has no player to change', cancel: true };
      }
      break;
    }
  }

  const zp = step.k === 'zone' || step.k === 'shotResult' || step.k === 'shotPlayer' ? step.pts : 0;
  const pending = step.k === 'shotResult' || step.k === 'shotPlayer' ? { x: step.x, y: step.y, pts: step.pts } : null;
  const hint =
    courtMsg ||
    (zp
      ? step.k === 'zone'
        ? `Tap where the ${zp}PT shot was taken — lit area only`
        : step.k === 'shotResult'
          ? 'Tap the lit area again to move the spot'
          : 'Shot spot marked'
      : 'Pick 2PT or 3PT above to unlock the court');

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 1.5 }}>
      <Box sx={{ width: { md: 'min(440px, 42vw)' }, flex: 'none', display: 'flex', flexDirection: 'column', gap: 1.25, minHeight: 0 }}>
        <Box role="group" aria-label="Shot type" sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, flex: 'none' }}>
          {([2, 3] as const).map((p) => {
            const sel = zp === p;
            return (
              <Btn
                key={p}
                pressed={sel}
                label={`${p}PT, ${p === 2 ? 'inside the arc' : 'outside the arc'}`}
                onClick={() => (step.k === 'zone' && step.pts === p ? idle() : go({ k: 'zone', pts: p }))}
                sx={{ minHeight: 52, borderRadius: '12px', border: `1.5px solid ${sel ? C.amber : C.buttonBorder}`, bgcolor: sel ? C.amber : C.button, color: sel ? C.bg : C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.25 }}
              >
                <Box component="span" sx={{ fontFamily: display, fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{p}PT</Box>
                <Box component="span" sx={{ fontSize: 12, color: sel ? '#4A3510' : C.muted }}>{p === 2 ? 'inside the arc' : 'outside the arc'}</Box>
              </Btn>
            );
          })}
        </Box>
        <Court zone={zp} pending={pending} shots={rec.box.shots} hint={hint} hintColor={courtMsg ? C.warn : zp ? C.amber : C.muted} onTap={courtTap} />
        <PlayByPlay rec={rec} selectedId={editing?.id ?? null} onPick={(e) => go({ k: 'edit', id: e.id })} />
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {commandBar}
        <Card
          label="Next step"
          sx={{ flex: 1, minHeight: { xs: 320, md: 0 }, border: `1px solid ${P.border ?? C.panelBorder}`, p: '14px 16px', display: 'flex', flexDirection: 'column', gap: 1.5, overflow: 'auto' }}
        >
          <Box aria-live="polite" sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
              <Kicker color={P.kColor}>{P.kicker}</Kicker>
              <Box component="h2" sx={{ m: 0, fontFamily: display, fontSize: 30, fontWeight: 600, lineHeight: 1.05 }}>{P.title}</Box>
              {P.sub && <Box component="span" sx={{ fontSize: 13, color: C.muted }}>{P.sub}</Box>}
            </Box>
            {P.cancel && (
              <Btn onClick={idle} sx={{ minHeight: 40, bgcolor: 'transparent', border: `1px solid ${C.strongBorder}`, fontSize: 13, flex: 'none' }}>
                Cancel
              </Btn>
            )}
          </Box>
          {P.alerts}
          {P.groups}
          {P.options}
        </Card>
      </Box>
    </Box>
  );
}
