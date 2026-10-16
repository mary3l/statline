import { periodLabel } from '@engine/fiba';
import type { FoulKind, GameEvent } from '@engine/types';
import { Box } from '@mui/material';
import { fmtClock } from './Scoreboard';
import { C } from './theme';
import { Card } from './ui';
import { shortName, type Recorder } from './useRecorder';

export const FOUL_LABEL: Record<FoulKind, string> = {
  personal: 'personal',
  shoot2: 'shooting, 2 FT',
  shoot3: 'shooting, 3 FT',
  and1: 'and-one, 1 FT',
  offensive: 'offensive',
  unsport: 'unsportsmanlike',
};

export function describe(e: GameEvent, rec: Recorder): string {
  const jersey = (id: number) => `#${rec.byId.get(id)?.jersey ?? '?'}`;
  switch (e.type) {
    case 'shot':
      return `${e.pts}PT ${e.made ? 'made' : 'missed'}`;
    case 'ft':
      return `Free throw ${e.made ? 'made' : 'missed'}`;
    case 'reb':
      if (e.playerId === null) return `Team ${e.off ? 'offensive' : 'defensive'} rebound`;
      return e.off ? 'Offensive rebound' : 'Defensive rebound';
    case 'pf':
      return `Foul · ${FOUL_LABEL[e.kind]}`;
    case 'sub':
      return `Sub · ${jersey(e.inId)} in for ${jersey(e.outId)}`;
    case 'timeout':
      return 'Timeout';
    case 'period_start':
      return `Start of ${periodLabel(e.period)}`;
    case 'period_end':
      return `End of ${periodLabel(e.period)}`;
    case 'ast':
      return 'Assist';
    case 'stl':
      return 'Steal';
    case 'blk':
      return 'Block';
    case 'tov':
      return 'Turnover';
    case 'fd':
      return 'Foul drawn';
  }
}

export function playLine(e: GameEvent, rec: Recorder): string {
  const stamp = `${periodLabel(e.period)} ${fmtClock(e.clock)}`;
  if (e.type === 'period_start' || e.type === 'period_end') return `${stamp} · ${describe(e, rec)}`;
  const team = e.side ? rec.game[e.side].shortName : '';
  const p = e.playerId !== null ? rec.byId.get(e.playerId) : undefined;
  const who = p ? `${team} #${p.jersey} ${shortName(p)}` : team;
  return `${stamp} · ${who} — ${describe(e, rec)}`;
}

export function PlayByPlay({
  rec,
  selectedId,
  onPick,
  hint = 'Tap a line to fix it',
}: {
  rec: Recorder;
  selectedId?: string | null;
  onPick?: (e: GameEvent) => void;
  hint?: string;
}) {
  const list = [...rec.events].reverse();
  return (
    <Card label="Play-by-play" sx={{ flex: 1, minHeight: 160, p: '8px 10px', display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.muted, p: '2px 4px 4px' }}>
        <span>Play-by-play</span>
        <Box component="span" sx={{ letterSpacing: '.04em', textTransform: 'none' }}>{onPick ? hint : `${rec.events.length} entries`}</Box>
      </Box>
      <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {list.length === 0 && <Box component="li" sx={{ fontSize: 13, color: C.muted, p: '6px' }}>No plays yet. Start the clock at tip-off.</Box>}
        {list.map((e) => {
          const marker = e.type === 'period_start' || e.type === 'period_end';
          const text = playLine(e, rec);
          return (
            <li key={e.id}>
              {marker || !onPick ? (
                <Box sx={{ minHeight: 30, display: 'flex', alignItems: 'center', px: '6px', fontSize: 12.5, color: marker ? C.dim : C.soft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {text}
                </Box>
              ) : (
                <Box
                  component="button"
                  type="button"
                  onClick={() => onPick(e)}
                  sx={{ width: '100%', minHeight: 34, px: '6px', border: 'none', borderRadius: '6px', bgcolor: e.id === selectedId ? C.selected : 'transparent', color: C.soft, font: 'inherit', fontSize: 12.5, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer', '&:hover': { bgcolor: C.button }, '&:focus-visible': { outline: `2px solid ${C.amber}` } }}
                >
                  {text}
                </Box>
              )}
            </li>
          );
        })}
      </Box>
    </Card>
  );
}
