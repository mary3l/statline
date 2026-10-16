import { Box } from '@mui/material';
import { useState } from 'react';
import { useMe, useResetGame, useStartGame } from '../api/queries';
import type { RecorderData, RecorderPlayer, Side } from '../api/types';
import { C, display, SIDE_COLOR, SIDE_TINT } from './theme';
import { Btn, Card, Kicker } from './ui';
import { onlyClockMarkers } from './useRecorder';

type Pick = { dressed: boolean; starter: boolean };

const STATUS_NOTE = { available: '', injured: 'Injured', suspended: 'Suspended' } as const;

function TeamLineup({
  side,
  team,
  roster,
  picks,
  onChange,
}: {
  side: Side;
  team: string;
  roster: RecorderPlayer[];
  picks: Map<number, Pick>;
  onChange: (id: number, next: Pick) => void;
}) {
  const dressed = roster.filter((p) => picks.get(p.playerId)?.dressed).length;
  const starters = roster.filter((p) => picks.get(p.playerId)?.starter).length;
  return (
    <Card label={`${team} lineup`} sx={{ p: '14px 16px', display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ fontFamily: display, fontSize: 26, fontWeight: 600 }}>
          <Box component="span" sx={{ color: SIDE_COLOR[side] }}>{side.toUpperCase()}</Box> · {team}
        </Box>
        <Box sx={{ fontSize: 13, color: starters === 5 ? C.ok : C.amber }}>
          {dressed} dressed · {starters} of 5 starters
        </Box>
      </Box>
      {roster.length === 0 && <Box sx={{ fontSize: 14, color: C.warn }}>This team has no players on its roster for the season. Register them first.</Box>}
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 0.75, overflowY: 'auto' }}>
        {roster.map((p) => {
          const pick = picks.get(p.playerId) ?? { dressed: false, starter: false };
          const suspended = p.status === 'suspended';
          return (
            <Box component="li" key={p.playerId} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: '4px 6px 4px 4px', borderRadius: '10px', bgcolor: pick.starter ? SIDE_TINT[side] : C.button, border: `1px solid ${pick.starter ? SIDE_COLOR[side] : C.panelBorder}` }}>
              <Box
                component="label"
                sx={{ flex: 1, minWidth: 0, minHeight: 48, display: 'flex', alignItems: 'center', gap: 1, cursor: suspended ? 'not-allowed' : 'pointer', opacity: suspended ? 0.5 : 1 }}
              >
                <Box
                  component="input"
                  type="checkbox"
                  checked={pick.dressed}
                  disabled={suspended}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(p.playerId, { dressed: e.target.checked, starter: e.target.checked && pick.starter })}
                  sx={{ width: 22, height: 22, accentColor: SIDE_COLOR[side], flex: 'none', ml: 1 }}
                />
                <Box component="span" sx={{ fontFamily: display, fontSize: 26, fontWeight: 700, width: 38, textAlign: 'center', color: SIDE_COLOR[side], flex: 'none' }}>{p.jersey}</Box>
                <Box component="span" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <Box component="span" sx={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.firstName} {p.lastName}</Box>
                  <Box component="span" sx={{ fontSize: 11, color: p.status === 'available' ? C.muted : C.warn }}>
                    {p.position}
                    {STATUS_NOTE[p.status] && ` · ${STATUS_NOTE[p.status]}`}
                  </Box>
                </Box>
              </Box>
              <Btn
                pressed={pick.starter}
                disabled={suspended || (!pick.starter && starters >= 5)}
                onClick={() => onChange(p.playerId, { dressed: true, starter: !pick.starter })}
                label={`${pick.starter ? 'Remove' : 'Make'} ${p.firstName} ${p.lastName} ${pick.starter ? 'from' : 'a'} starter${pick.starter ? 's' : ''}`}
                sx={{ minHeight: 40, fontSize: 12.5, fontWeight: 600, flex: 'none', bgcolor: pick.starter ? SIDE_COLOR[side] : 'transparent', color: pick.starter ? C.bg : C.text, borderColor: pick.starter ? SIDE_COLOR[side] : C.strongBorder }}
              >
                {pick.starter ? 'Starter' : 'Start'}
              </Btn>
            </Box>
          );
        })}
      </Box>
    </Card>
  );
}

/** Before tip-off: who dressed for each team and the starting fives. */
export function LineupSetup({ data, onCancel, onSaved }: { data: RecorderData; onCancel?: () => void; onSaved?: () => void }) {
  const start = useStartGame(data.game.id);
  const reset = useResetGame(data.game.id);
  const { data: user } = useMe();
  const canReset = data.game.status === 'live' && onlyClockMarkers(data.events) && (user?.role === 'admin' || user?.role === 'organizer');
  const [picks, setPicks] = useState(() => {
    const m = new Map<number, Pick>();
    const hasLineup = [...data.roster.home, ...data.roster.away].some((p) => p.dressed);
    for (const p of [...data.roster.home, ...data.roster.away]) {
      // First time: everyone available is dressed and no one starts yet.
      m.set(p.playerId, hasLineup ? { dressed: p.dressed, starter: p.starter } : { dressed: p.status === 'available', starter: false });
    }
    return m;
  });

  const count = (side: Side, k: keyof Pick) => data.roster[side].filter((p) => picks.get(p.playerId)?.[k]).length;
  const problems = (['home', 'away'] as const).flatMap((side) => {
    const team = data.game[side].name;
    const out: string[] = [];
    if (count(side, 'dressed') < 5) out.push(`${team} needs at least 5 players dressed.`);
    if (count(side, 'starter') !== 5) out.push(`Pick 5 starters for ${team} (${count(side, 'starter')} so far).`);
    return out;
  });

  const submit = () => {
    const participants = (['home', 'away'] as const).flatMap((side) =>
      data.roster[side]
        .filter((p) => picks.get(p.playerId)?.dressed)
        .map((p) => ({ playerId: p.playerId, side, starter: !!picks.get(p.playerId)?.starter })),
    );
    start.mutate({ participants }, { onSuccess: () => onSaved?.() });
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Card sx={{ p: '14px 16px', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Kicker color={C.amber}>Before tip-off</Kicker>
          <Box component="h1" sx={{ m: '2px 0 0', fontFamily: display, fontSize: 30, fontWeight: 600, lineHeight: 1.05 }}>Who is playing today?</Box>
          <Box sx={{ fontSize: 13, color: C.muted, mt: 0.5 }}>
            Tick everyone who dressed, then tap <strong>Start</strong> on each team’s five starters. Minutes and +/- are counted from the starters and the substitutions.
          </Box>
          {problems.length > 0 && (
            <Box component="ul" sx={{ m: '8px 0 0', pl: 2.5, fontSize: 13, color: C.amber }}>
              {problems.map((t) => <li key={t}>{t}</li>)}
            </Box>
          )}
          {(start.error ?? reset.error) && <Box role="alert" sx={{ mt: 1, fontSize: 13, color: C.warn }}>{(start.error ?? reset.error)!.message}</Box>}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {canReset && (
            <Btn onClick={() => reset.mutate(undefined)} disabled={reset.isPending} sx={{ minHeight: 52, bgcolor: 'transparent', borderColor: C.warn, color: C.warn }}>
              {reset.isPending ? 'Cancelling…' : 'Cancel game start'}
            </Btn>
          )}
          {onCancel && (
            <Btn onClick={onCancel} sx={{ minHeight: 52, bgcolor: 'transparent', border: `1px solid ${C.strongBorder}` }}>
              Back to recording
            </Btn>
          )}
          <Btn
            onClick={submit}
            disabled={problems.length > 0 || start.isPending}
            sx={{ minHeight: 52, px: 3, border: 'none', bgcolor: C.amber, color: C.bg, fontWeight: 700, fontSize: 16 }}
          >
            {start.isPending ? 'Starting…' : data.game.status === 'live' ? 'Save lineup' : 'Start game'}
          </Btn>
        </Box>
      </Card>
      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
        {(['home', 'away'] as const).map((side) => (
          <TeamLineup
            key={side}
            side={side}
            team={data.game[side].name}
            roster={data.roster[side]}
            picks={picks}
            onChange={(id, next) => setPicks((m) => new Map(m).set(id, next))}
          />
        ))}
      </Box>
    </Box>
  );
}
