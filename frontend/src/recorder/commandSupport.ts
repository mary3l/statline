import { resolveJersey, type CommandOptions } from '@engine/commands';
import type { RecorderPlayer, Side } from '../api/types';
import type { Recorder } from './useRecorder';
import { shortName } from './useRecorder';

/** Words that name each side in typed commands: home/away, the short name and each word of the team name. */
export function sideWords(rec: Recorder): CommandOptions {
  const words = (s: Side) => [rec.game[s].shortName, ...rec.game[s].name.split(/\s+/)].map((w) => w.toLowerCase()).filter((w) => w.length > 1);
  return { sideWords: { home: words('home'), away: words('away') } };
}

/** Every dressed player, flagged on court or not, for jersey lookups. */
export function candidates(rec: Recorder) {
  const on = new Set([...rec.live.onCourt.home, ...rec.live.onCourt.away]);
  return [...rec.players.home, ...rec.players.away].map((p) => ({ ...p, onCourt: on.has(p.playerId) }));
}

export type Lookup = { player: RecorderPlayer } | { error: string };

/** Turns a typed jersey (and maybe a side) into one player, or a message saying what to type instead. */
export function lookup(rec: Recorder, jersey: string, side: Side | undefined, opts: { onCourtOnly?: boolean; benchOnly?: boolean } = {}): Lookup {
  let list = candidates(rec);
  if (opts.benchOnly) list = list.filter((p) => !p.onCourt).map((p) => ({ ...p, onCourt: true }));
  const r = resolveJersey(jersey, side, list, { onCourtOnly: opts.onCourtOnly });
  if ('player' in r) return { player: r.player };
  if ('ambiguous' in r) {
    return { error: `Both teams have #${jersey}${opts.benchOnly ? ' on the bench' : ' on court'}. Add the team: “home ${jersey} …” or “away ${jersey} …”.` };
  }
  const where = side ? `${rec.game[side].name} ` : '';
  return { error: `No ${where}#${jersey} ${opts.benchOnly ? 'on the bench' : opts.onCourtOnly ? 'on court' : 'dressed for this game'}.` };
}

/** Which team missed the last shot or free throw, if a rebound is still open (for "12 rebound" without o/d). */
export { openMissSide as lastMissSide } from '@engine/live';

export const said = (p: RecorderPlayer) => `#${p.jersey} ${shortName(p)}`;
