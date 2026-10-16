import { Alert, Box, Button, CircularProgress, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';
import type { PlayerStatus } from '../api/types';
import { display, statusColors, tokens } from '../theme';

/** White rounded panel used by every office page section. */
export function Card({ children, sx, ...rest }: { children: ReactNode; sx?: SxProps<Theme> } & Record<string, unknown>) {
  return (
    <Box
      component="section"
      sx={[
        { bgcolor: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: '16px', p: { xs: '16px', sm: '20px 24px' }, minWidth: 0 },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
    >
      {children}
    </Box>
  );
}

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <Box component="header" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2 }}>
      <Box>
        <Box component="h1" sx={{ m: 0, fontFamily: display, fontSize: { xs: 36, sm: 44 }, fontWeight: 700, lineHeight: 1 }}>
          {title}
        </Box>
        {subtitle && <Box component="p" sx={{ m: '8px 0 0', color: tokens.muted, fontSize: 14 }}>{subtitle}</Box>}
      </Box>
      {action}
    </Box>
  );
}

export function SectionTitle({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 1.5 }}>
      <Box component="h2" id={id} sx={{ m: 0, fontSize: 15, fontWeight: 600 }}>
        {children}
      </Box>
      {aside && <Box component="span" sx={{ fontSize: 12, color: tokens.muted }}>{aside}</Box>}
    </Box>
  );
}

export function StatTile({ label, value, size = 34 }: { label: string; value: ReactNode; size?: number }) {
  return (
    <Box sx={{ bgcolor: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: '14px', p: '14px 16px' }}>
      <Box sx={{ fontSize: 12, color: tokens.muted }}>{label}</Box>
      <Box sx={{ fontFamily: display, fontSize: size, fontWeight: 700, lineHeight: 1.1 }}>{value}</Box>
    </Box>
  );
}

export function TileGrid({ children, min = 160 }: { children: ReactNode; min?: number }) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 1.5 }}>{children}</Box>;
}

export function StatusChip({ status }: { status: PlayerStatus }) {
  const c = statusColors[status];
  return (
    <Box component="span" sx={{ display: 'inline-block', px: 1.25, py: 0.5, borderRadius: 999, fontSize: 12, fontWeight: 600, bgcolor: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>
      {c.label}
    </Box>
  );
}

export function Pill({ children, outlined }: { children: ReactNode; outlined?: boolean }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        px: 1,
        py: '3px',
        fontSize: 12,
        whiteSpace: 'nowrap',
        ...(outlined
          ? { border: `1px solid ${tokens.input}`, borderRadius: '6px', fontWeight: 500 }
          : { bgcolor: tokens.page, borderRadius: 999 }),
      }}
    >
      {children}
    </Box>
  );
}

/** Styles for the plain semantic tables used across the office pages (as in the prototype). */
export const tableSx = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 14,
  fontVariantNumeric: 'tabular-nums',
  '& th, & td': { whiteSpace: 'nowrap', padding: '10px 8px' },
  '& thead tr': { color: tokens.muted, fontSize: 12 },
  '& thead th': { fontWeight: 500 },
  '& tbody tr': { borderTop: `1px solid ${tokens.row}` },
  '& tbody th': { fontWeight: 500, textAlign: 'left' },
  '& tfoot tr': { borderTop: `2px solid ${tokens.ink}`, fontWeight: 600 },
  '& a': { color: tokens.ink, textDecoration: 'none', fontWeight: 600 },
  '& a:hover': { color: tokens.home, textDecoration: 'underline' },
};

export function TableScroll({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label="Scrollable table">
      {children}
    </Box>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: tokens.muted, py: 4 }}>
      <CircularProgress size={20} /> {label}
    </Box>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <Alert
      severity="error"
      action={onRetry && <Button color="inherit" size="small" onClick={onRetry}>Try again</Button>}
    >
      {message}
    </Alert>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <Box component="p" sx={{ m: 0, fontSize: 12, color: tokens.muted, lineHeight: 1.5 }}>{children}</Box>;
}
