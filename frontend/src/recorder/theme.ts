import type { Side } from '../api/types';

/** Courtside (dark) palette from the prototype (README §10). */
export const C = {
  bg: '#0E1116',
  panel: '#161B22',
  panelBorder: '#262D37',
  button: '#1B212A',
  buttonBorder: '#2E3642',
  strongBorder: '#4A5361',
  text: '#EEF0F2',
  soft: '#D5D9DF',
  muted: '#A3ACB8',
  dim: '#7D8796',
  amber: '#F5B85A',
  amberSoft: '#E9C88E',
  warn: '#F4A39A',
  ok: '#8FD19E',
  court: '#1C1A15',
  courtPaint: '#25211A',
  courtLine: '#6B604D',
  courtArc: '#9A8A6C',
  selected: '#2A3240',
} as const;

export const SIDE_COLOR: Record<Side, string> = { home: '#E8742A', away: '#9CC6F7' };
export const SIDE_TINT: Record<Side, string> = { home: 'rgba(232,116,42,0.16)', away: 'rgba(156,198,247,0.14)' };

export const display = "'Barlow Condensed', 'Arial Narrow', sans-serif";
export const bodyFont = "'IBM Plex Sans', system-ui, sans-serif";

export const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
