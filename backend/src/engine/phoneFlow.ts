import {
  parseCommand,
  parseFoulKind,
  parseMade,
  parsePlayerAnswer,
  parseSide,
  resolveJersey,
  type Command,
  type CommandOptions,
  type JerseyCandidate,
} from './commands.js';
import { FIBA } from './fiba.js';
import { freeThrowsFor } from './live.js';
import type { FoulKind, GameEvent, Side } from './types.js';

/**
 * The eyes-free phone recorder's conversation: typed commands and swipes in; plays to record,
 * the next question, a sentence to read aloud and a vibration pattern out. No microphone involved.
 * Swipe right = yes / made / confirm / personal foul / home; swipe left = no / missed / skip / cancel / away.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type Play = DistributiveOmit<GameEvent, 'id' | 'seq' | 'period' | 'clock'>;

export interface FlowPlayer extends JerseyCandidate {
  name: string;
  fouls: number;
}

export interface FlowContext {
  players: FlowPlayer[];
  teamName: Record<Side, string>;
  /** The team already had 4 team fouls this period. */
  penalty: Record<Side, boolean>;
  timeoutsLeft: Record<Side, number>;
  /** Who missed the last shot or free throw, while the rebound is still open. */
  lastMissSide: Side | null;
  options?: CommandOptions;
}

export type Question =
  | { k: 'assist'; side: Side; scorerId: number }
  | { k: 'rebound'; shotSide: Side }
  | { k: 'foulKind'; foulerId: number }
  | { k: 'fouled'; side: Side; kind: FoulKind; n: number; foulerId: number }
  | { k: 'ft'; shooterId: number; n: number; i: number }
  | { k: 'stealVictim'; side: Side }
  | { k: 'stealer'; side: Side }
  | { k: 'whichTeam'; text: string }
  | { k: 'forcedSub'; outId: number; side: Side };

export type Buzz = 'saved' | 'question' | 'error' | 'undo';

export interface FlowResult {
  plays: Play[];
  clock?: { shot?: 24 | 14; stop?: boolean };
  /** The question now open (null = none). */
  next: Question | null;
  say: string;
  buzz: Buzz;
  /** Something for the recorder itself to do. */
  control?: 'undo' | 'toggleClock' | 'nextPeriod' | 'readout';
}

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
const FOUL_WORDS: Record<FoulKind, string> = {
  personal: 'personal foul',
  shoot2: 'shooting foul, two shots',
  shoot3: 'shooting foul, three shots',
  and1: 'and-one',
  offensive: 'offensive foul',
  unsport: 'unsportsmanlike foul',
};

function byId(ctx: FlowContext, id: number) {
  return ctx.players.find((p) => p.playerId === id)!;
}
const spoken = (p: FlowPlayer) => `number ${p.jersey === '00' ? 'double zero' : p.jersey}, ${p.name}`;

/** The question as it is read aloud (also shown on screen). */
export function prompt(q: Question | null, ctx: FlowContext): string {
  if (!q) return 'Ready. Type the jersey, then the play.';
  switch (q.k) {
    case 'assist':
      return 'Assisted by? Type the jersey, or swipe left for no assist.';
    case 'rebound':
      return `Who got the rebound? Type the jersey; add o or d if needed. Swipe left to skip.`;
    case 'foulKind':
      return `Foul by ${spoken(byId(ctx, q.foulerId))}. What kind? Swipe right for personal, or type shooting 2, shooting 3, and one, offensive or unsportsmanlike.`;
    case 'fouled':
      return q.n
        ? `Who was fouled? Type the ${ctx.teamName[q.side]} jersey. They shoot ${q.n === 1 ? 'one free throw' : `${q.n} free throws`}.`
        : `Who ${q.kind === 'offensive' ? 'drew the offensive foul' : 'was fouled'}? Type the ${ctx.teamName[q.side]} jersey, or swipe left to skip.`;
    case 'ft':
      return `Free throw ${q.i} of ${q.n}, ${spoken(byId(ctx, q.shooterId))}. Swipe right if made, left if missed.`;
    case 'stealVictim':
      return `Who lost the ball? Type the ${ctx.teamName[q.side]} jersey, or swipe left to skip.`;
    case 'stealer':
      return `Stolen by? Type the ${ctx.teamName[q.side]} jersey, or swipe left for no steal.`;
    case 'whichTeam':
      return 'Both teams have that number. Swipe right for home, left for away.';
    case 'forcedSub':
      return `${spoken(byId(ctx, q.outId))} has five fouls and must leave. Who comes in? Type the jersey, or swipe left for later.`;
  }
}

function result(r: Partial<FlowResult> & { say: string }, ctx: FlowContext): FlowResult {
  const next = r.next ?? null;
  // A question that is opened is read right after what was saved.
  const say = [r.say, next ? prompt(next, ctx) : ''].filter(Boolean).join(' ');
  return { plays: [], buzz: next ? 'question' : 'saved', ...r, next, say };
}

const fail = (say: string, keep: Question | null): FlowResult => ({ plays: [], next: keep, say, buzz: 'error' });

function find(ctx: FlowContext, jersey: string, side: Side | undefined, opts: { onCourtOnly?: boolean; benchOnly?: boolean } = {}) {
  let list = ctx.players;
  if (opts.benchOnly) list = list.filter((p) => !p.onCourt).map((p) => ({ ...p, onCourt: true }));
  return resolveJersey(jersey, side, list, { onCourtOnly: opts.onCourtOnly });
}

/** Records a foul and opens "who was fouled?". The penalty uses the team fouls before this one. */
function doFoul(kind: FoulKind, p: FlowPlayer, ctx: FlowContext): FlowResult {
  const n = freeThrowsFor(kind, ctx.penalty[p.side]);
  const plays: Play[] = [{ type: 'pf', side: p.side, playerId: p.playerId, kind }];
  if (kind === 'offensive') plays.push({ type: 'tov', side: p.side, playerId: p.playerId });
  const fifth = p.fouls + 1 >= FIBA.foulOutAt ? ' That is the fifth foul.' : '';
  return result(
    { plays, clock: { stop: true }, say: `${FOUL_WORDS[kind]} on ${spoken(p)}.${fifth}`, next: { k: 'fouled', side: other(p.side), kind, n, foulerId: p.playerId } },
    ctx,
  );
}

function runCommand(c: Command, text: string, q: Question | null, ctx: FlowContext): FlowResult {
  switch (c.kind) {
    case 'error':
      return fail(c.message, q);
    case 'undo':
      return { plays: [], next: null, say: '', buzz: 'undo', control: 'undo' };
    case 'score':
      return { plays: [], next: q, say: '', buzz: 'saved', control: 'readout' };
    case 'clock':
      return { plays: [], next: q, say: '', buzz: 'saved', control: 'toggleClock' };
    case 'nextPeriod':
      return { plays: [], next: null, say: 'Next period.', buzz: 'saved', control: 'nextPeriod' };
    case 'timeout':
      if (ctx.timeoutsLeft[c.side] <= 0) return fail(`${ctx.teamName[c.side]} has no timeouts left.`, q);
      return result({ plays: [{ type: 'timeout', side: c.side, playerId: null }], clock: { stop: true }, say: `Timeout ${ctx.teamName[c.side]}.` }, ctx);
    case 'sub': {
      const out = find(ctx, c.outJersey, c.side, { onCourtOnly: true });
      if ('ambiguous' in out) return result({ say: '', next: { k: 'whichTeam', text }, buzz: 'question' }, ctx);
      if ('missing' in out) return fail(`No number ${c.outJersey} on court.`, q);
      const inn = find(ctx, c.inJersey, out.player.side, { benchOnly: true });
      if (!('player' in inn)) return fail(`No number ${c.inJersey} on the ${ctx.teamName[out.player.side]} bench.`, q);
      if (inn.player.fouls >= FIBA.foulOutAt) return fail(`Number ${c.inJersey} has five fouls and can't return.`, q);
      return result(
        {
          plays: [{ type: 'sub', side: out.player.side, playerId: null, outId: out.player.playerId, inId: inn.player.playerId }],
          clock: { stop: true },
          say: `Sub: number ${c.inJersey} in for number ${c.outJersey}.`,
        },
        ctx,
      );
    }
    default:
      break;
  }

  const r = find(ctx, c.jersey, c.side);
  if ('ambiguous' in r) return result({ say: '', next: { k: 'whichTeam', text }, buzz: 'question' }, ctx);
  if ('missing' in r) return fail(`No number ${c.jersey}${c.side ? ` on ${ctx.teamName[c.side]}` : ''} in this game.`, q);
  const p = r.player;
  if (p.fouls >= FIBA.foulOutAt) return fail(`${spoken(p)} has five fouls and is out of the game.`, q);
  const who = { side: p.side, playerId: p.playerId };

  switch (c.kind) {
    case 'shot':
      return result(
        {
          plays: [{ type: 'shot', ...who, pts: c.pts, made: c.made, x: null, y: null }],
          clock: c.made ? { shot: 24 } : undefined,
          say: `${spoken(p)}, ${c.pts === 3 ? 'three' : 'two'} ${c.made ? 'made' : 'missed'}.`,
          next: c.made ? { k: 'assist', side: p.side, scorerId: p.playerId } : { k: 'rebound', shotSide: p.side },
        },
        ctx,
      );
    case 'ft':
      return result(
        { plays: [{ type: 'ft', ...who, made: c.made }], say: `${spoken(p)}, free throw ${c.made ? 'made' : 'missed'}.`, next: c.made ? null : { k: 'rebound', shotSide: p.side } },
        ctx,
      );
    case 'reb': {
      const off = c.off ?? ctx.lastMissSide === p.side;
      return result({ plays: [{ type: 'reb', ...who, off }], clock: { shot: off ? 14 : 24 }, say: `${spoken(p)}, ${off ? 'offensive' : 'defensive'} rebound.` }, ctx);
    }
    case 'stat':
      if (c.stat === 'stl' || c.stat === 'tov') {
        // A steal and a turnover go together: "2 steal 7" / "7 turnover 2" records both, otherwise ask for the other half.
        const opp = other(p.side);
        const plays: Play[] = [{ type: c.stat, ...who }];
        const clock = c.stat === 'tov' ? { shot: 24 as const, stop: true } : { shot: 24 as const };
        const said = `${spoken(p)}, ${c.stat === 'stl' ? 'steal' : 'turnover'}.`;
        if (c.other) {
          const o = find(ctx, c.other, opp, { onCourtOnly: true });
          if (!('player' in o)) return fail(`No ${ctx.teamName[opp]} number ${c.other} on court.`, q);
          plays.push({ type: c.stat === 'stl' ? 'tov' : 'stl', side: opp, playerId: o.player.playerId });
          return result({ plays, clock, say: `${said} ${c.stat === 'stl' ? 'Lost by' : 'Stolen by'} ${spoken(o.player)}.` }, ctx);
        }
        return result({ plays, clock, say: said, next: c.stat === 'stl' ? { k: 'stealVictim', side: opp } : { k: 'stealer', side: opp } }, ctx);
      }
      return result(
        {
          plays: [{ type: c.stat, ...who }],
          say: `${spoken(p)}, ${c.stat === 'ast' ? 'assist' : 'block'}.`,
        },
        ctx,
      );
    case 'foul':
      return c.foul ? doFoul(c.foul, p, ctx) : result({ say: '', next: { k: 'foulKind', foulerId: p.playerId }, buzz: 'question' }, ctx);
  }
}

/** A player typed as the answer to an open question. */
function answerPlayer(q: Question, text: string, ctx: FlowContext): FlowResult {
  const a = parsePlayerAnswer(text, ctx.options);
  if (!a) return fail(`Didn't catch that. ${prompt(q, ctx)}`, q);
  if ('none' in a) return onSwipe('left', q, ctx);

  switch (q.k) {
    case 'assist': {
      const r = find(ctx, a.jersey, q.side, { onCourtOnly: true });
      if (!('player' in r) || r.player.playerId === q.scorerId) return fail(`No other ${ctx.teamName[q.side]} number ${a.jersey} on court.`, q);
      return result({ plays: [{ type: 'ast', side: q.side, playerId: r.player.playerId }], say: `Assist, ${spoken(r.player)}.` }, ctx);
    }
    case 'rebound': {
      // The jersey alone decides: the shooting team's player is offensive, the other team's defensive.
      const sideHint = a.side ?? (a.off === true ? q.shotSide : a.off === false ? other(q.shotSide) : undefined);
      const r = find(ctx, a.jersey, sideHint, { onCourtOnly: true });
      if ('ambiguous' in r) return fail(`Both teams have number ${a.jersey} on court. Type ${a.jersey} o or ${a.jersey} d.`, q);
      if ('missing' in r) return fail(`No number ${a.jersey} on court.`, q);
      const off = r.player.side === q.shotSide;
      return result({ plays: [{ type: 'reb', side: r.player.side, playerId: r.player.playerId, off }], clock: { shot: off ? 14 : 24 }, say: `${spoken(r.player)}, ${off ? 'offensive' : 'defensive'} rebound.` }, ctx);
    }
    case 'fouled': {
      const r = find(ctx, a.jersey, q.side, { onCourtOnly: true });
      if (!('player' in r)) return fail(`No ${ctx.teamName[q.side]} number ${a.jersey} on court.`, q);
      const p = r.player;
      return result(
        { plays: [{ type: 'fd', side: p.side, playerId: p.playerId }], say: `Fouled: ${spoken(p)}.`, next: q.n ? { k: 'ft', shooterId: p.playerId, n: q.n, i: 1 } : null },
        ctx,
      );
    }
    case 'stealVictim':
    case 'stealer': {
      const r = find(ctx, a.jersey, q.side, { onCourtOnly: true });
      if (!('player' in r)) return fail(`No ${ctx.teamName[q.side]} number ${a.jersey} on court.`, q);
      const type = q.k === 'stealer' ? 'stl' : 'tov';
      return result({ plays: [{ type, side: q.side, playerId: r.player.playerId }], say: `${type === 'stl' ? 'Steal' : 'Turnover'}, ${spoken(r.player)}.` }, ctx);
    }
    case 'forcedSub': {
      const r = find(ctx, a.jersey, q.side, { benchOnly: true });
      if (!('player' in r)) return fail(`No number ${a.jersey} on the ${ctx.teamName[q.side]} bench.`, q);
      if (r.player.fouls >= FIBA.foulOutAt) return fail(`Number ${a.jersey} has five fouls too.`, q);
      const out = byId(ctx, q.outId);
      return result(
        { plays: [{ type: 'sub', side: q.side, playerId: null, outId: q.outId, inId: r.player.playerId }], clock: { stop: true }, say: `Sub: number ${r.player.jersey} in for number ${out.jersey}.` },
        ctx,
      );
    }
    default:
      return fail(prompt(q, ctx), q);
  }
}

/** Typed text: a new command, or the answer to the open question. */
export function onText(text: string, q: Question | null, ctx: FlowContext): FlowResult {
  const c = parseCommand(text, ctx.options);
  // A complete new play always wins over the open question (the scorer moved on).
  if (c.kind !== 'error') return runCommand(c, text, q, ctx);
  if (!q) return fail(c.message, null);

  switch (q.k) {
    case 'ft': {
      const made = parseMade(text);
      return made === undefined ? fail(`Made or missed? ${prompt(q, ctx)}`, q) : onSwipe(made ? 'right' : 'left', q, ctx);
    }
    case 'foulKind': {
      const kind = parseFoulKind(text);
      return kind ? doFoul(kind, byId(ctx, q.foulerId), ctx) : fail(`Didn't catch the kind. ${prompt(q, ctx)}`, q);
    }
    case 'whichTeam': {
      const side = parseSide(text, ctx.options);
      return side ? onSwipe(side === 'home' ? 'right' : 'left', q, ctx) : fail(prompt(q, ctx), q);
    }
    default:
      return answerPlayer(q, text, ctx);
  }
}

/** Swipe right / left. (Up and down — clock and undo — and double tap are handled by the screen.) */
export function onSwipe(dir: 'right' | 'left', q: Question | null, ctx: FlowContext): FlowResult {
  const yes = dir === 'right';
  if (!q) return fail('Nothing to answer. Type the jersey, then the play.', null);
  switch (q.k) {
    case 'ft': {
      const p = byId(ctx, q.shooterId);
      const last = q.i === q.n;
      return result(
        {
          plays: [{ type: 'ft', side: p.side, playerId: p.playerId, made: yes }],
          clock: last && yes ? { shot: 24 } : undefined,
          say: `Free throw ${yes ? 'made' : 'missed'}.`,
          // Only the last free throw can be rebounded.
          next: !last ? { ...q, i: q.i + 1 } : yes ? null : { k: 'rebound', shotSide: p.side },
        },
        ctx,
      );
    }
    case 'foulKind':
      return yes ? doFoul('personal', byId(ctx, q.foulerId), ctx) : { plays: [], next: null, say: 'Foul cancelled.', buzz: 'undo' };
    case 'whichTeam': {
      const side: Side = yes ? 'home' : 'away';
      const c = parseCommand(q.text, ctx.options);
      if (c.kind === 'error' || c.kind === 'undo' || c.kind === 'score' || c.kind === 'clock' || c.kind === 'nextPeriod' || c.kind === 'timeout') {
        return fail('Start again: type the command with home or away.', null);
      }
      return runCommand({ ...c, side }, q.text, null, ctx);
    }
    case 'fouled':
      if (q.n) return fail(yes ? prompt(q, ctx) : `Free throws are due. ${prompt(q, ctx)}`, q);
      return { plays: [], next: null, say: yes ? prompt(q, ctx) : 'No foul drawn recorded.', buzz: yes ? 'question' : 'saved' };
    case 'assist':
      return yes ? fail(prompt(q, ctx), q) : { plays: [], next: null, say: 'No assist.', buzz: 'saved' };
    case 'stealer':
      return yes ? fail(prompt(q, ctx), q) : { plays: [], next: null, say: 'No steal.', buzz: 'saved' };
    case 'rebound':
    case 'stealVictim':
    case 'forcedSub':
      return yes ? fail(prompt(q, ctx), q) : { plays: [], next: null, say: 'Skipped.', buzz: 'saved' };
  }
}

/** After a play, a player on court with five fouls must be replaced: open that question if nothing else is. */
export function forcedSub(ctx: FlowContext): Question | null {
  const p = ctx.players.find((x) => x.onCourt && x.fouls >= FIBA.foulOutAt);
  return p ? { k: 'forcedSub', outId: p.playerId, side: p.side } : null;
}
