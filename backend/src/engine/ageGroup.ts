export const AGE_GROUPS = ['U12', 'U14', 'U16', 'U18', 'Open', 'Masters 35+'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

/** The age a player reaches in the season year decides the category (birth year only, not the birthday). */
export function ageInSeason(birthdate: string, seasonYear: number): number {
  return seasonYear - Number(birthdate.slice(0, 4));
}

export function ageGroup(birthdate: string, seasonYear: number): AgeGroup {
  const a = ageInSeason(birthdate, seasonYear);
  if (a <= 12) return 'U12';
  if (a <= 14) return 'U14';
  if (a <= 16) return 'U16';
  if (a <= 18) return 'U18';
  if (a >= 35) return 'Masters 35+';
  return 'Open';
}

/** Inclusive age-in-season range for each group, used to filter in SQL. */
export function ageRange(group: AgeGroup): { min: number | null; max: number | null } {
  switch (group) {
    case 'U12':
      return { min: null, max: 12 };
    case 'U14':
      return { min: 13, max: 14 };
    case 'U16':
      return { min: 15, max: 16 };
    case 'U18':
      return { min: 17, max: 18 };
    case 'Open':
      return { min: 19, max: 34 };
    case 'Masters 35+':
      return { min: 35, max: null };
  }
}

/** Which categories a player may enter: every youth group at or above their age, Open always, Masters at 35+. */
export function eligibility(birthdate: string, seasonYear: number) {
  const a = ageInSeason(birthdate, seasonYear);
  const rows: { group: AgeGroup; rule: string; eligible: boolean }[] = [
    { group: 'U12', rule: 'Reaches 12 or younger', eligible: a <= 12 },
    { group: 'U14', rule: 'Reaches 14 or younger', eligible: a <= 14 },
    { group: 'U16', rule: 'Reaches 16 or younger', eligible: a <= 16 },
    { group: 'U18', rule: 'Reaches 18 or younger', eligible: a <= 18 },
    { group: 'Open', rule: 'No age limit', eligible: true },
    { group: 'Masters 35+', rule: 'Reaches 35 or older', eligible: a >= 35 },
  ];
  return rows;
}

export interface LeagueRule {
  gender: 'F' | 'M' | null;
  minAge: number | null;
  maxAge: number | null;
}

/** Returns null when the player may play in the league, or the reason they may not. */
export function leagueIneligibility(
  player: { birthdate: string; gender: 'F' | 'M' },
  league: LeagueRule,
  seasonYear: number,
): string | null {
  const a = ageInSeason(player.birthdate, seasonYear);
  if (league.gender && league.gender !== player.gender) {
    return league.gender === 'F' ? 'This league is for women only.' : 'This league is for men only.';
  }
  if (league.maxAge !== null && a > league.maxAge) return `Players must reach ${league.maxAge} or younger in ${seasonYear}.`;
  if (league.minAge !== null && a < league.minAge) return `Players must reach ${league.minAge} or older in ${seasonYear}.`;
  return null;
}

/** Age today, counting the birthday. */
export function currentAge(birthdate: string, today = new Date()): number {
  const [y, m, d] = birthdate.split('-').map(Number) as [number, number, number];
  let age = today.getFullYear() - y;
  const month = today.getMonth() + 1;
  if (month < m || (month === m && today.getDate() < d)) age -= 1;
  return age;
}
