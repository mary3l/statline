/** FIBA rule constants used by the engine. */
export const FIBA = {
  periodSeconds: 10 * 60,
  overtimeSeconds: 5 * 60,
  regulationPeriods: 4,
  foulOutAt: 5,
  /** Team fouls per period before the penalty; from the next foul, a personal foul gives 2 free throws. Overtime counts with Q4. */
  teamFoulPenaltyAt: 4,
  standingPoints: { win: 2, loss: 1, forfeitLoss: 0 },
  /** A forfeited game is recorded 20–0 for the team that was ready to play. */
  forfeitScore: 20,
} as const;

export function periodLength(period: number): number {
  return period <= FIBA.regulationPeriods ? FIBA.periodSeconds : FIBA.overtimeSeconds;
}

/** Game seconds elapsed before the given period starts. */
export function elapsedBefore(period: number): number {
  let total = 0;
  for (let p = 1; p < period; p++) total += periodLength(p);
  return total;
}

/** Absolute game time (seconds since tip-off) of a moment in a period. */
export function gameTime(period: number, clock: number): number {
  return elapsedBefore(period) + (periodLength(period) - clock);
}

export function periodLabel(period: number): string {
  return period <= FIBA.regulationPeriods ? `Q${period}` : `OT${period - FIBA.regulationPeriods}`;
}
