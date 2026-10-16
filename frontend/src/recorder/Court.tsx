import type { ShotRecord } from '@engine/boxscore';
import { Box } from '@mui/material';
import type { MouseEvent } from 'react';
import { C, display, SIDE_COLOR } from './theme';

const ARC = 'M9 0 V29.9 A67.5 67.5 0 0 0 141 29.9 V0';
const LIT = 'rgba(245,184,90,0.22)';
const DIM = 'rgba(6,8,12,0.68)';

/**
 * FIBA half court (same geometry as the box score's shot chart: 150 × 140 decimetres, baseline at the top).
 * With a shot type picked, only that zone is lit; the caller decides what a tap in the other zone does.
 */
export function Court({
  zone,
  pending,
  shots,
  hint,
  hintColor,
  onTap,
}: {
  zone: 0 | 2 | 3;
  pending: { x: number; y: number; pts: 2 | 3 } | null;
  shots: ShotRecord[];
  hint: string;
  hintColor: string;
  onTap: (x: number, y: number) => void;
}) {
  const click = (ev: MouseEvent<HTMLButtonElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    // Keyboard activation has no pointer position: use the middle of the lit zone.
    const keyboard = ev.detail === 0;
    const fx = keyboard ? 0.5 : (ev.clientX - r.left) / r.width;
    const fy = keyboard ? (zone === 3 ? 0.75 : 0.3) : (ev.clientY - r.top) / r.height;
    const clamp = (v: number) => Math.max(0.01, Math.min(0.99, v));
    onTap(clamp(fx), clamp(fy));
  };

  const active = zone !== 0;
  return (
    <Box
      component="button"
      type="button"
      onClick={click}
      aria-label={active ? `Half court. ${zone}PT area unlocked. Tap where the shot was taken.` : 'Half court. Pick 2PT or 3PT first.'}
      sx={{
        position: 'relative',
        display: 'block',
        width: '100%',
        aspectRatio: '15 / 14',
        flex: 'none',
        p: 0,
        border: `1px solid ${C.buttonBorder}`,
        borderRadius: '14px',
        overflow: 'hidden',
        bgcolor: C.court,
        cursor: active ? 'crosshair' : 'not-allowed',
        '&:focus-visible': { outline: `2px solid ${C.amber}`, outlineOffset: 2 },
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 150 140" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} fill="none" stroke={C.courtLine} strokeWidth="0.7">
        <rect x="50.5" y="0" width="49" height="58" fill={C.courtPaint} />
        <circle cx="75" cy="58" r="18" />
        <path d="M66 12 H84" />
        <circle cx="75" cy="15.75" r="2.25" />
        <path d="M62.5 12 V15.75 A12.5 12.5 0 0 0 87.5 15.75 V12" />
        <path d={ARC} stroke={C.courtArc} strokeWidth="1" />
        <path d="M57 140 A18 18 0 0 1 93 140" />
        {active && (
          <>
            <path d={`${ARC} Z`} fill={zone === 2 ? LIT : DIM} stroke="none" />
            <path d={`M0 0 H150 V140 H0 Z ${ARC} Z`} fillRule="evenodd" fill={zone === 3 ? LIT : DIM} stroke="none" />
            <path d={ARC} stroke={C.amber} strokeWidth="1.6" />
          </>
        )}
        {shots
          .filter((s) => s.x !== null && s.y !== null)
          .map((s) => (
            <circle key={s.eventId} cx={s.x! * 150} cy={s.y! * 140} r={2.3} fill={s.made ? SIDE_COLOR[s.side] : C.court} stroke={SIDE_COLOR[s.side]} strokeWidth={0.9} />
          ))}
        {pending && <circle cx={pending.x * 150} cy={pending.y * 140} r={5} fill="rgba(245,184,90,0.25)" stroke={C.amber} strokeWidth={1.4} />}
      </svg>
      {pending && (
        <Box component="span" sx={{ position: 'absolute', left: `${pending.x * 100}%`, top: `${pending.y * 100}%`, transform: 'translate(-50%, 18px)', fontFamily: display, fontSize: 18, fontWeight: 700, color: C.amber, pointerEvents: 'none' }}>
          {pending.pts}PT
        </Box>
      )}
      <Box component="span" sx={{ position: 'absolute', left: 12, right: 12, bottom: 10, fontSize: 12.5, fontWeight: 500, textAlign: 'left', color: hintColor, pointerEvents: 'none' }}>
        {hint}
      </Box>
    </Box>
  );
}
