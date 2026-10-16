import { Box, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';
import type { RecorderPlayer, Side } from '../api/types';
import { C, display, SIDE_COLOR } from './theme';
import { shortName } from './useRecorder';

/** Plain button with the courtside look (MUI's light theme doesn't fit the dark screens). */
export function Btn({
  children,
  onClick,
  disabled,
  pressed,
  label,
  sx,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  label?: string;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      sx={[
        {
          minHeight: 44,
          borderRadius: '10px',
          border: `1px solid ${C.buttonBorder}`,
          bgcolor: C.button,
          color: C.text,
          font: 'inherit',
          fontSize: 14,
          cursor: 'pointer',
          px: 1.5,
          '&:disabled': { cursor: 'not-allowed', opacity: 0.35 },
          '&:focus-visible': { outline: `2px solid ${C.amber}`, outlineOffset: 2 },
          '&:not(:disabled):active': { transform: 'translateY(1px)' },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  );
}

const OPTION = {
  made: { bg: C.text, fg: C.bg, bd: C.text, sub: '#3A414C' },
  miss: { bg: 'transparent', fg: C.text, bd: '#5A6474', sub: C.muted },
  neutral: { bg: C.button, fg: C.text, bd: C.buttonBorder, sub: C.muted },
  foul: { bg: 'transparent', fg: C.amber, bd: C.amber, sub: C.amberSoft },
  warn: { bg: 'transparent', fg: C.warn, bd: C.warn, sub: C.warn },
} as const;

export type OptionKind = keyof typeof OPTION;

/** A big two-line choice: title and a small explanation. */
export function Option({
  label,
  sub,
  onClick,
  kind = 'neutral',
  height = 60,
  size = 21,
  disabled,
}: {
  label: string;
  sub?: string;
  onClick: () => void;
  kind?: OptionKind;
  height?: number;
  size?: number;
  disabled?: boolean;
}) {
  const k = OPTION[kind];
  return (
    <Btn
      onClick={onClick}
      disabled={disabled}
      label={sub ? `${label}, ${sub}` : label}
      sx={{
        minHeight: height,
        borderRadius: '12px',
        bgcolor: k.bg,
        color: k.fg,
        border: `1.5px solid ${k.bd}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '3px',
        p: '6px 10px',
      }}
    >
      <Box component="span" sx={{ fontFamily: display, fontSize: size, fontWeight: 600, lineHeight: 1 }}>{label}</Box>
      {sub && <Box component="span" sx={{ fontSize: 11, color: k.sub, textAlign: 'center' }}>{sub}</Box>}
    </Btn>
  );
}

export function OptionGrid({ children, cols = 3 }: { children: ReactNode; cols?: number }) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 1 }}>{children}</Box>;
}

/** Foul count shown beside a player: amber at 4, "5 PF" once fouled out. */
export function foulNote(fouls: number) {
  return fouls >= 5 ? '5 PF' : fouls === 4 ? 'PF 4' : '';
}

export function PlayerButton({
  player,
  fouls,
  onClick,
  disabled,
}: {
  player: RecorderPlayer;
  fouls: number;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Btn
      onClick={onClick}
      disabled={disabled}
      label={`#${player.jersey} ${player.firstName} ${player.lastName}${fouls ? `, ${fouls} fouls` : ''}`}
      sx={{ minHeight: 56, display: 'flex', alignItems: 'center', gap: 1, p: '4px 12px 4px 6px', textAlign: 'left' }}
    >
      <Box component="span" sx={{ fontFamily: display, fontSize: 30, fontWeight: 700, width: 42, flex: 'none', textAlign: 'center', color: SIDE_COLOR[player.side], lineHeight: 1 }}>
        {player.jersey}
      </Box>
      <Box component="span" sx={{ flex: 1, minWidth: 0, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {shortName(player)}
      </Box>
      <Box component="span" sx={{ fontSize: 11, color: C.amber, flex: 'none' }}>{foulNote(fouls)}</Box>
    </Btn>
  );
}

/** A labelled column of player buttons for one team. Fouled-out players are disabled unless allowed. */
export function PlayerGroup({
  side,
  label,
  players,
  fouls,
  onPick,
  allowFouledOut,
  cols = 1,
}: {
  side: Side;
  label: string;
  players: RecorderPlayer[];
  fouls: Map<number, number>;
  onPick: (p: RecorderPlayer) => void;
  allowFouledOut?: boolean;
  cols?: number;
}) {
  return (
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Box sx={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: SIDE_COLOR[side], fontWeight: 600 }}>{label}</Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 0.75 }}>
        {players.map((p) => {
          const f = fouls.get(p.playerId) ?? 0;
          return <PlayerButton key={p.playerId} player={p} fouls={f} disabled={f >= 5 && !allowFouledOut} onClick={() => onPick(p)} />;
        })}
        {players.length === 0 && <Box sx={{ fontSize: 13, color: C.muted, py: 1 }}>No one to pick.</Box>}
      </Box>
    </Box>
  );
}

export function Card({ children, sx, label }: { children: ReactNode; sx?: SxProps<Theme>; label?: string }) {
  return (
    <Box
      component="section"
      aria-label={label}
      sx={[{ bgcolor: C.panel, border: `1px solid ${C.panelBorder}`, borderRadius: '14px', minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {children}
    </Box>
  );
}

export function Kicker({ children, color = C.muted }: { children: ReactNode; color?: string }) {
  return (
    <Box component="span" sx={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color, fontWeight: 600 }}>
      {children}
    </Box>
  );
}
