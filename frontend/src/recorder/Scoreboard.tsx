import { FIBA, periodLabel } from '@engine/fiba';
import { inPenalty, teamFoulsIn, timeoutsLeft } from '@engine/live';
import { Box } from '@mui/material';
import { useState } from 'react';
import type { Side } from '../api/types';
import { C, display, SIDE_COLOR } from './theme';
import { Btn, Card } from './ui';
import type { Recorder } from './useRecorder';

export function fmtClock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function TeamPanel({ rec, side }: { rec: Recorder; side: Side }) {
  const fouls = teamFoulsIn(rec.live, side, rec.period);
  const penalty = inPenalty(rec.live, side, rec.period);
  const left = timeoutsLeft(rec.live, side, rec.period);
  const away = side === 'away';
  const dots = (
    <Box component="span" aria-hidden="true" sx={{ display: 'flex', gap: '4px' }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Box key={i} component="span" sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: i < fouls ? C.amber : 'transparent', border: `1px solid ${i < fouls ? C.amber : C.strongBorder}` }} />
      ))}
    </Box>
  );
  const penaltyTag = penalty && (
    <Box component="span" sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: C.bg, bgcolor: C.amber, borderRadius: '4px', px: '6px', py: '2px' }}>
      Penalty
    </Box>
  );
  const info = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 12, color: C.muted, flexDirection: away ? 'row-reverse' : 'row', flexWrap: 'wrap' }}>
      <span>Fouls {fouls}</span>
      {dots}
      {penaltyTag}
      <span>TO left {left}</span>
    </Box>
  );
  const score = (
    <Box aria-label={`${side === 'home' ? 'Home' : 'Away'} score`} sx={{ fontFamily: display, fontSize: { xs: 48, md: 66 }, fontWeight: 700, lineHeight: 0.9, color: SIDE_COLOR[side], fontVariantNumeric: 'tabular-nums' }}>
      {rec.box.score[side]}
    </Box>
  );
  return (
    <Card label={side === 'home' ? 'Home team' : 'Away team'} sx={{ p: '10px 16px', display: 'flex', alignItems: 'center', gap: 1.75, flexDirection: away ? 'row-reverse' : 'row' }}>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.75, alignItems: away ? 'flex-end' : 'flex-start', textAlign: away ? 'right' : 'left' }}>
        <Box sx={{ fontFamily: display, fontSize: { xs: 20, md: 24 }, fontWeight: 600, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
          <Box component="span" sx={{ color: SIDE_COLOR[side] }}>{side.toUpperCase()}</Box> · {rec.game[side].name}
        </Box>
        {info}
      </Box>
      {score}
    </Card>
  );
}

function ClockEditor({ seconds, onSet, onDone }: { seconds: number; onSet: (s: number) => void; onDone: () => void }) {
  const [text, setText] = useState(fmtClock(seconds));
  const [bad, setBad] = useState(false);
  const save = () => {
    const m = /^(\d{1,2}):?(\d{2})$/.exec(text.trim());
    if (!m || Number(m[2]) > 59) {
      setBad(true);
      return;
    }
    onSet(Number(m[1]) * 60 + Number(m[2]));
    onDone();
  };
  return (
    <Box component="form" onSubmit={(e) => { e.preventDefault(); save(); }} sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
      <Box
        component="input"
        autoFocus
        aria-label="Game clock, minutes and seconds"
        aria-invalid={bad}
        inputMode="numeric"
        value={text}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setText(e.target.value); setBad(false); }}
        onKeyDown={(e: React.KeyboardEvent) => e.key === 'Escape' && onDone()}
        sx={{ width: 96, minHeight: 44, fontFamily: display, fontSize: 30, fontWeight: 700, textAlign: 'center', bgcolor: C.bg, color: C.text, border: `1px solid ${bad ? C.warn : C.strongBorder}`, borderRadius: '8px' }}
      />
      <Btn sx={{ minHeight: 40, fontSize: 13 }}>Set</Btn>
    </Box>
  );
}

export function Scoreboard({ rec }: { rec: Recorder }) {
  const [editing, setEditing] = useState(false);
  const reached = Math.max(rec.live.lastPeriod, rec.period);
  const lastTab = Math.max(FIBA.regulationPeriods + 1, reached >= FIBA.regulationPeriods ? reached + 1 : 0);
  const tabs = Array.from({ length: lastTab }, (_, i) => i + 1);

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 340px minmax(0, 1fr)' }, gap: 1.25 }}>
      <TeamPanel rec={rec} side="home" />
      <Card label="Game clock" sx={{ p: '8px 10px', display: 'flex', alignItems: 'center', gap: 1.25, order: { xs: -1, md: 0 } }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, flex: 1, minWidth: 0 }}>
          <Box role="group" aria-label="Period" sx={{ display: 'flex', gap: '3px' }}>
            {tabs.map((p) => {
              const on = p === rec.period;
              return (
                <Btn
                  key={p}
                  pressed={on}
                  disabled={p > reached + 1}
                  onClick={() => rec.setPeriod(p)}
                  label={p > reached ? `Start ${periodLabel(p)}` : periodLabel(p)}
                  sx={{ flex: 1, minHeight: 30, px: 0, borderRadius: '6px', fontSize: 11, fontWeight: 600, bgcolor: on ? C.text : 'transparent', color: on ? C.bg : C.muted }}
                >
                  {periodLabel(p)}
                </Btn>
              );
            })}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            {editing ? (
              <ClockEditor seconds={rec.clock} onSet={rec.setClock} onDone={() => setEditing(false)} />
            ) : (
              <Box
                component="button"
                type="button"
                disabled={rec.running}
                onClick={() => setEditing(true)}
                aria-label={`Game clock ${fmtClock(rec.clock)}. ${rec.running ? 'Stop the clock to change it.' : 'Tap to set.'}`}
                sx={{ p: 0, border: 'none', bgcolor: 'transparent', color: rec.clock === 0 ? C.warn : C.text, fontFamily: display, fontSize: 44, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums', cursor: rec.running ? 'default' : 'pointer', '&:focus-visible': { outline: `2px solid ${C.amber}` } }}
              >
                {fmtClock(rec.clock)}
              </Box>
            )}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Box sx={{ fontFamily: display, fontSize: 24, fontWeight: 700, lineHeight: 1, color: rec.shot === 0 ? C.warn : C.amber, fontVariantNumeric: 'tabular-nums' }}>
                {rec.shot ?? '—'}
              </Box>
              <Box sx={{ fontSize: 9, color: C.muted, letterSpacing: '.08em' }}>SHOT</Box>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '3px', ml: 'auto' }}>
              <Btn onClick={() => rec.resetShot(24)} label="Reset shot clock to 24" sx={{ minHeight: 26, px: 1, fontSize: 11, borderRadius: '6px' }}>24</Btn>
              <Btn onClick={() => rec.resetShot(14)} label="Reset shot clock to 14" sx={{ minHeight: 26, px: 1, fontSize: 11, borderRadius: '6px' }}>14</Btn>
            </Box>
          </Box>
        </Box>
        <Btn
          onClick={rec.toggleClock}
          disabled={!rec.running && rec.clock === 0}
          sx={{ width: 82, alignSelf: 'stretch', border: 'none', bgcolor: rec.running ? C.amber : C.text, color: C.bg, fontWeight: 600, fontSize: 13 }}
        >
          {rec.running ? 'Stop' : 'Start'}
        </Btn>
      </Card>
      <TeamPanel rec={rec} side="away" />
    </Box>
  );
}
