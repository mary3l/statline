import type { FoulKind, Side } from './types.js';

/**
 * Typed scorer commands, as in the prototype: the jersey first, then the play.
 *   "7 three made", "21 two missed", "12 defensive rebound", "5 foul", "5 shooting foul 3",
 *   "2 steal", "2 steal 7" (from #7), "9 block", "30 turnover", "30 turnover 5" (stolen by #5), "4 assist", "7 free throw made",
 *   "24 in 5 out", "timeout home", "undo", "score", "clock", "next quarter".
 * A side ("home 7", "away 7", or a team's short name) settles a jersey both teams wear.
 * Parsing never looks at the roster; resolveJersey() does that.
 */
export type Command =
  | { kind: 'shot'; jersey: string; side?: Side; pts: 2 | 3; made: boolean }
  | { kind: 'ft'; jersey: string; side?: Side; made: boolean }
  /** off null = decide from who missed last. */
  | { kind: 'reb'; jersey: string; side?: Side; off: boolean | null }
  | { kind: 'stat'; stat: 'ast' | 'blk'; jersey: string; side?: Side }
  /** A steal and a turnover go together: `other` is the opponent's jersey (who lost it / who stole it), if typed. */
  | { kind: 'stat'; stat: 'stl' | 'tov'; jersey: string; side?: Side; other?: string }
  | { kind: 'foul'; jersey: string; side?: Side; foul?: FoulKind }
  | { kind: 'sub'; side?: Side; inJersey: string; outJersey: string }
  | { kind: 'timeout'; side: Side }
  | { kind: 'undo' }
  | { kind: 'score' }
  | { kind: 'clock' }
  | { kind: 'nextPeriod' }
  | { kind: 'error'; message: string };

export interface CommandOptions {
  /** Extra words for each side, e.g. { home: ['mav', 'mavericks'], away: ['bul', 'bulls'] }. */
  sideWords?: Partial<Record<Side, string[]>>;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };

type Tok = { n: string } | { w: string };

/** Jerseys keep "0" and "00" but drop other leading zeros ("07" → "7"). */
export function normalizeJersey(j: string): string {
  return /^0+$/.test(j) ? (j.length > 1 ? '00' : '0') : j.replace(/^0+/, '');
}

export function tokenize(text: string): Tok[] {
  const raw = text
    .toLowerCase()
    .replace(/and[\s-]?1\b|and[\s-]one\b/g, ' and1 ')
    .replace(/(\d+)\s*(pt|pts|pointer|point)s?\b/g, ' $1pt ')
    .replace(/[^a-z0-9#\s]/g, ' ')
    .replace(/#/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out: Tok[] = [];
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i]!;
    if (/^\d+$/.test(w)) out.push({ n: normalizeJersey(w) });
    else if (TENS[w] !== undefined) {
      let v = TENS[w]!;
      const next = ONES.indexOf(raw[i + 1] ?? '');
      if (next > 0 && next < 10) {
        v += next;
        i++;
      }
      out.push({ n: String(v) });
    } else if (ONES.includes(w)) out.push({ n: String(ONES.indexOf(w)) });
    else out.push({ w });
  }
  return out;
}

const has = (words: string[], list: string[]) => list.some((w) => words.includes(w));
const W = {
  undo: ['undo', 'oops', 'scratch'],
  clock: ['clock', 'start', 'stop', 'resume', 'pause'],
  next: ['next'],
  period: ['quarter', 'period', 'overtime', 'ot', 'q'],
  timeout: ['timeout', 'timeouts'],
  missed: ['miss', 'missed', 'misses', 'no', 'brick', 'short', 'long', 'blocked'],
  made: ['made', 'make', 'makes', 'good', 'scored', 'bucket', 'hit', 'hits', 'yes', 'in'],
  ft: ['free', 'ft', 'fts', 'freethrow', 'freethrows', 'line'],
  foul: ['foul', 'fouls', 'fouled', 'pf'],
  reb: ['rebound', 'rebounds', 'reb', 'board', 'boards', 'oreb', 'dreb'],
  off: ['offensive', 'offense', 'off', 'oreb', 'o'],
  def: ['defensive', 'defense', 'def', 'dreb', 'd'],
  ast: ['assist', 'assists', 'ast', 'dime', 'dimes'],
  stl: ['steal', 'steals', 'stole', 'stl'],
  blk: ['block', 'blocks', 'blk', 'rejection', 'swat'],
  tov: ['turnover', 'turnovers', 'tov', 'to', 'travel', 'traveling', 'travelling', 'lost'],
  two: ['2pt', 'layup', 'dunk', 'jumper', 'floater', 'putback', 'hook'],
  three: ['3pt', 'triple', 'trey'],
  sub: ['sub', 'subs', 'substitution', 'for', 'replaces'],
};

function sideFrom(words: string[], opts: CommandOptions): Side | undefined {
  const home = ['home', ...(opts.sideWords?.home ?? []).map((s) => s.toLowerCase())];
  const away = ['away', 'visitor', 'visitors', ...(opts.sideWords?.away ?? []).map((s) => s.toLowerCase())];
  const h = has(words, home);
  const a = has(words, away);
  return h && !a ? 'home' : a && !h ? 'away' : undefined;
}

/** The kind of foul in a typed answer ("shooting 3", "and one", "offensive"…), if any. */
export function parseFoulKind(text: string): FoulKind | undefined {
  const toks = tokenize(text);
  const words = toks.filter((t): t is { w: string } => 'w' in t).map((t) => t.w);
  const nums = toks.filter((t): t is { n: string } => 'n' in t).map((t) => t.n);
  return foulKind(words, nums);
}

/** Made / missed in a typed answer ("made", "good", "yes" / "missed", "no"), if any. */
export function parseMade(text: string): boolean | undefined {
  const words = tokenize(text)
    .filter((t): t is { w: string } => 'w' in t)
    .map((t) => t.w);
  if (has(words, W.missed)) return false;
  if (has(words, W.made)) return true;
  return undefined;
}

/** "home" / "away" (or a team's words) in a typed answer, if exactly one side is named. */
export function parseSide(text: string, opts: CommandOptions = {}): Side | undefined {
  return sideFrom(
    tokenize(text)
      .filter((t): t is { w: string } => 'w' in t)
      .map((t) => t.w),
    opts,
  );
}

function foulKind(words: string[], rest: string[]): FoulKind | undefined {
  if (has(words, ['offensive', 'charge', 'charging'])) return 'offensive';
  if (has(words, ['unsportsmanlike', 'unsport', 'flagrant', 'u'])) return 'unsport';
  if (has(words, ['and1'])) return 'and1';
  if (has(words, ['shooting', 'shot'])) return rest.includes('3') || has(words, ['3pt']) ? 'shoot3' : 'shoot2';
  if (has(words, ['personal', 'p'])) return 'personal';
  return undefined;
}

export function parseCommand(text: string, opts: CommandOptions = {}): Command {
  const toks = tokenize(text);
  if (!toks.length) return { kind: 'error', message: 'Type the jersey, then the play: “7 three made”.' };
  const words = toks.filter((t): t is { w: string } => 'w' in t).map((t) => t.w);
  const nums = toks.filter((t): t is { n: string } => 'n' in t).map((t) => t.n);
  const side = sideFrom(words, opts);

  if (has(words, W.undo)) return { kind: 'undo' };
  if (has(words, W.next) && has(words, W.period)) return { kind: 'nextPeriod' };
  if (has(words, W.timeout) || (words.includes('time') && words.includes('out') && !nums.length)) {
    return side ? { kind: 'timeout', side } : { kind: 'error', message: 'Say which team: “timeout home” or “timeout away”.' };
  }
  if (!nums.length) {
    if (has(words, ['score'])) return { kind: 'score' };
    if (has(words, W.clock)) return { kind: 'clock' };
    return { kind: 'error', message: 'Start with the jersey number, e.g. “7 three made”.' };
  }

  // Substitution: "24 in 5 out", "in 24 out 5", "24 for 5", "sub 24 for 5".
  const inAt = toks.findIndex((t) => 'w' in t && t.w === 'in');
  const outAt = toks.findIndex((t) => 'w' in t && t.w === 'out');
  if ((inAt >= 0 && outAt >= 0) || has(words, W.sub)) {
    const numAt = (i: number) => {
      const t = toks[i];
      return t && 'n' in t ? t.n : undefined;
    };
    let inJ: string | undefined;
    let outJ: string | undefined;
    if (inAt >= 0 && outAt >= 0) {
      // Numbers before the words ("24 in 5 out") or after them ("in 24 out 5").
      const before = numAt(inAt - 1) !== undefined;
      inJ = before ? numAt(inAt - 1) : numAt(inAt + 1);
      outJ = before ? numAt(outAt - 1) : numAt(outAt + 1);
    } else if (nums.length >= 2) {
      [inJ, outJ] = nums as [string, string];
    }
    if (inJ && outJ && inJ !== outJ) return { kind: 'sub', side, inJersey: inJ, outJersey: outJ };
    return { kind: 'error', message: 'For a substitution say who comes in and who goes out: “24 in 5 out”.' };
  }

  const jersey = nums[0]!;
  const rest = nums.slice(1);
  const missed = has(words, W.missed);
  const made = !missed && has(words, W.made);

  if (has(words, W.ft)) {
    if (!made && !missed) return { kind: 'error', message: 'Say if the free throw was made or missed: “7 free throw made”.' };
    return { kind: 'ft', jersey, side, made };
  }
  if (has(words, W.foul)) return { kind: 'foul', jersey, side, foul: foulKind(words, rest) };
  if (has(words, W.reb)) {
    const off = has(words, W.off) ? true : has(words, W.def) ? false : null;
    return { kind: 'reb', jersey, side, off };
  }
  if (has(words, W.ast)) return { kind: 'stat', stat: 'ast', jersey, side };
  // "2 steal 7": #2 stole it from #7. "7 turnover 2": #7 lost it to #2.
  if (has(words, W.stl)) return { kind: 'stat', stat: 'stl', jersey, side, ...(rest[0] ? { other: rest[0] } : {}) };
  if (has(words, W.blk)) return { kind: 'stat', stat: 'blk', jersey, side };
  if (has(words, W.tov)) return { kind: 'stat', stat: 'tov', jersey, side, ...(rest[0] ? { other: rest[0] } : {}) };

  const pts = rest.includes('3') || has(words, W.three) ? 3 : rest.includes('2') || has(words, W.two) ? 2 : null;
  if (pts && (made || missed)) return { kind: 'shot', jersey, side, pts, made };
  if (pts) return { kind: 'error', message: 'Say if the shot was made or missed: “7 three made”.' };
  if (made || missed) return { kind: 'error', message: 'Say 2 or 3 points: “7 two made” or “7 three missed”.' };
  return { kind: 'error', message: 'Couldn’t tell what happened. Try “7 three made”, “12 rebound” or “5 foul”.' };
}

/** A typed answer to "who?": a jersey, maybe with a side and o/d for rebounds; or none. */
export function parsePlayerAnswer(text: string, opts: CommandOptions = {}): { jersey: string; side?: Side; off: boolean | null } | { none: true } | null {
  const toks = tokenize(text);
  const words = toks.filter((t): t is { w: string } => 'w' in t).map((t) => t.w);
  const nums = toks.filter((t): t is { n: string } => 'n' in t).map((t) => t.n);
  if (!nums.length) return has(words, ['none', 'no', 'nobody', 'skip', 'team', 'pass']) ? { none: true } : null;
  return { jersey: nums[0]!, side: sideFrom(words, opts), off: has(words, W.off) ? true : has(words, W.def) ? false : null };
}

export interface JerseyCandidate {
  playerId: number;
  side: Side;
  jersey: string;
  onCourt: boolean;
}

/**
 * Finds the player a jersey means: players on court come first; a side narrows it.
 * Both teams' players wearing it on court → ambiguous (ask "which team?").
 */
export function resolveJersey<T extends JerseyCandidate>(
  jersey: string,
  side: Side | undefined,
  players: T[],
  opts: { onCourtOnly?: boolean } = {},
): { player: T } | { ambiguous: T[] } | { missing: true } {
  const j = normalizeJersey(jersey);
  let list = players.filter((p) => normalizeJersey(p.jersey) === j && (!side || p.side === side));
  const court = list.filter((p) => p.onCourt);
  if (court.length || opts.onCourtOnly) list = court;
  if (list.length === 1) return { player: list[0]! };
  if (list.length > 1) return { ambiguous: list };
  return { missing: true };
}
