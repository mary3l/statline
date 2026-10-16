/**
 * FIBA half court in metres: 15 m wide, 14 m from the baseline to half court.
 * Event coordinates are stored normalised to 0–1 (x / 15, y / 14).
 */
export const COURT = {
  width: 15,
  length: 14,
  basket: { x: 7.5, y: 1.575 },
  threeRadius: 6.75,
  /** Distance from the basket centre to the corner-three lines (0.9 m in from each sideline). */
  cornerX: 6.6,
  /** Where the arc meets the straight corner lines. */
  cornerY: 2.99,
  paint: { halfWidth: 2.45, length: 5.8 },
} as const;

export type Zone = 'paint' | 'mid' | 'three';

export function toMetres(x: number, y: number) {
  return { mx: x * COURT.width, my: y * COURT.length };
}

export function isBeyondArc(mx: number, my: number): boolean {
  const dx = mx - COURT.basket.x;
  if (my <= COURT.cornerY) return Math.abs(dx) >= COURT.cornerX;
  return Math.hypot(dx, my - COURT.basket.y) >= COURT.threeRadius;
}

export function shotZone(pts: 2 | 3, x: number | null, y: number | null): Zone | null {
  if (pts === 3) return 'three';
  if (x === null || y === null) return null;
  const { mx, my } = toMetres(x, y);
  return Math.abs(mx - COURT.basket.x) <= COURT.paint.halfWidth && my <= COURT.paint.length ? 'paint' : 'mid';
}
