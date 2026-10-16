import { Box } from '@mui/material';
import type { Shot } from '../api/types';
import { tokens } from '../theme';

/**
 * FIBA half court drawn in decimetres (150 × 140), same geometry as the prototype.
 * Shot x/y are 0–1 across the width / from the baseline.
 */
export function ShotChart({ shots, color, label }: { shots: Shot[]; color: string; label: string }) {
  const plotted = shots.filter((s) => s.x !== null && s.y !== null);
  const made = plotted.filter((s) => s.made).length;
  return (
    <Box
      sx={{ position: 'relative', width: '100%', aspectRatio: '15 / 14', bgcolor: tokens.court, borderRadius: '10px', overflow: 'hidden', border: `1px solid ${tokens.border}` }}
    >
      <svg
        role="img"
        aria-label={`${label}: ${plotted.length} shots plotted, ${made} made`}
        viewBox="0 0 150 140"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        <g fill="none" stroke={tokens.courtLine} strokeWidth="0.6">
          <rect x="0.3" y="0.3" width="149.4" height="139.4" />
          <rect x="50.5" y="0" width="49" height="58" fill="#F3E9D6" />
          <circle cx="75" cy="58" r="18" />
          <path d="M66 12 H84" />
          <circle cx="75" cy="15.75" r="2.25" />
          <path d="M62.5 12 V15.75 A12.5 12.5 0 0 0 87.5 15.75 V12" />
          <path d="M9 0 V29.9 A67.5 67.5 0 0 0 141 29.9 V0" />
          <path d="M57 140 A18 18 0 0 1 93 140" />
        </g>
        {plotted.map((s) => (
          <circle
            key={s.eventId}
            cx={s.x! * 150}
            cy={s.y! * 140}
            r={2.6}
            fill={s.made ? color : '#FFFFFF'}
            stroke={s.made ? color : tokens.muted}
            strokeWidth={0.9}
          >
            <title>{`${s.pts}PT ${s.made ? 'made' : 'missed'}`}</title>
          </circle>
        ))}
      </svg>
    </Box>
  );
}
