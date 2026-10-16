/** Demo data. All names and numbers are made up (same people as the prototype, plus generated teammates). */

type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
type Gender = 'F' | 'M';

export interface LeagueSeed {
  slug: string;
  name: string;
  level: string;
  gender: Gender | null;
  minAge: number | null;
  maxAge: number | null;
}

export const LEAGUES: LeagueSeed[] = [
  { slug: 'city-open', name: 'City Open League', level: 'open', gender: null, minAge: null, maxAge: null },
  { slug: 'inter-barangay', name: 'Inter-Barangay Cup', level: 'barangay', gender: null, minAge: null, maxAge: null },
  { slug: 'collegiate', name: 'Collegiate Varsity League', level: 'collegiate', gender: null, minAge: null, maxAge: 25 },
  { slug: 'womens', name: "Women's Division", level: 'women', gender: 'F', minAge: null, maxAge: null },
  { slug: 'youth-u18', name: 'Youth U18 Circuit', level: 'youth', gender: null, minAge: null, maxAge: 18 },
  { slug: 'masters', name: 'Masters 35+', level: 'masters', gender: null, minAge: 35, maxAge: null },
];

export interface NamedPlayer {
  first: string;
  last: string;
  jersey: string;
  position: Position;
  birthdate?: string;
  heightCm?: number;
  weightKg?: number;
  skill?: number;
  /** Extra leagues played besides the team's own. */
  alsoPlays?: string[];
  status?: 'injured' | 'suspended';
  /** Misses this many of the team's most recent finished games (injury / suspension). */
  missesLast?: number;
}

export interface TeamSeed {
  league: string;
  name: string;
  shortName: string;
  color: string;
  gender: Gender;
  /** Birth-year range for generated teammates. */
  born: [number, number];
  /** Listed in roster order: the first five start. */
  named: NamedPlayer[];
  /** Plays a 2026 schedule. Teams without one only appear in the registry. */
  schedule: boolean;
  /** Also played the 2025 City Open season. */
  in2025?: boolean;
}

export const TEAMS: TeamSeed[] = [
  {
    league: 'city-open',
    name: 'Matina Mavericks',
    shortName: 'MAV',
    color: '#B5480E',
    gender: 'M',
    born: [1994, 2005],
    schedule: true,
    in2025: true,
    named: [
      { first: 'Joaquin', last: 'Dela Rosa', jersey: '7', position: 'PG', birthdate: '2002-03-14', heightCm: 178, weightKg: 72, skill: 1.25, alsoPlays: ['collegiate'] },
      { first: 'Miguel', last: 'Reyes', jersey: '4', position: 'SG', skill: 1.05 },
      { first: 'Carlo', last: 'Bautista', jersey: '10', position: 'SF', skill: 1.1 },
      { first: 'Paolo', last: 'Ignacio', jersey: '15', position: 'PF', birthdate: '1999-04-19', heightCm: 188, weightKg: 85, skill: 1.15, alsoPlays: ['inter-barangay'], status: 'suspended' },
      { first: 'Renz', last: 'Mendoza', jersey: '12', position: 'C', skill: 1.05 },
      { first: 'Kevin', last: 'Aquino', jersey: '30', position: 'SG', skill: 0.95 },
      { first: 'Luis', last: 'Garcia', jersey: '8', position: 'SF', skill: 0.9 },
      { first: 'Dan', last: 'Navarro', jersey: '18', position: 'PF', skill: 0.9 },
      { first: 'Enzo', last: 'Torres', jersey: '25', position: 'C', skill: 0.85 },
    ],
  },
  {
    league: 'city-open',
    name: 'Buhangin Bulls',
    shortName: 'BUL',
    color: '#1D4E89',
    gender: 'M',
    born: [1992, 2005],
    schedule: true,
    in2025: true,
    named: [
      { first: 'Tomas', last: 'Pascual', jersey: '2', position: 'PG', skill: 1.1 },
      { first: 'Adrian', last: 'Ramos', jersey: '14', position: 'SG', skill: 1.0 },
      { first: 'Nathan', last: 'Ong', jersey: '21', position: 'SF', birthdate: '2001-07-27', heightCm: 185, weightKg: 80, skill: 1.22, alsoPlays: ['inter-barangay'] },
      { first: 'Franco', last: 'Castro', jersey: '9', position: 'PF', skill: 1.0 },
      { first: 'Gabriel', last: 'Uy', jersey: '5', position: 'C', skill: 1.1 },
      { first: 'Rafael', last: 'Abad', jersey: '33', position: 'C', birthdate: '1988-11-05', heightCm: 193, weightKg: 98, skill: 1.0, alsoPlays: ['masters'], status: 'injured', missesLast: 3 },
      { first: 'Vince', last: 'Domingo', jersey: '24', position: 'SG', skill: 0.9 },
      { first: 'Sam', last: 'Lim', jersey: '11', position: 'SF', skill: 0.9 },
      { first: 'Ben', last: 'Valdez', jersey: '31', position: 'PF', skill: 0.85 },
    ],
  },
  { league: 'city-open', name: 'Toril Thunder', shortName: 'TOR', color: '#6B4FA0', gender: 'M', born: [1993, 2006], schedule: true, in2025: true,
    named: [{ first: 'Ramon', last: 'Villar', jersey: '3', position: 'SG', skill: 1.2 }] },
  { league: 'city-open', name: 'Lanang Rockets', shortName: 'LAN', color: '#2E7D5B', gender: 'M', born: [1993, 2006], schedule: true, in2025: true,
    named: [{ first: 'Diego', last: 'Salazar', jersey: '13', position: 'PF', skill: 1.2 }] },
  { league: 'city-open', name: 'Ecoland Eagles', shortName: 'ECO', color: '#8A6D1F', gender: 'M', born: [1993, 2006], schedule: true, in2025: true,
    named: [{ first: 'Elijah', last: 'Cruz', jersey: '1', position: 'PG', skill: 1.15 }] },
  { league: 'city-open', name: 'Talomo Tigers', shortName: 'TAL', color: '#A23B3B', gender: 'M', born: [1993, 2006], schedule: true, in2025: true, named: [] },

  { league: 'womens', name: 'Lanang Lady Hawks', shortName: 'LLH', color: '#2E7D5B', gender: 'F', born: [1993, 2007], schedule: true,
    named: [
      { first: 'Andrea', last: 'Villanueva', jersey: '11', position: 'SG', birthdate: '2004-08-22', heightCm: 168, weightKg: 60, skill: 1.2, alsoPlays: ['collegiate'] },
      { first: 'Bea', last: 'Tamayo', jersey: '44', position: 'C', birthdate: '1996-12-01', heightCm: 180, weightKg: 72, skill: 1.25 },
    ] },
  { league: 'womens', name: 'Ecoland Veterans', shortName: 'ECV', color: '#8A6D1F', gender: 'F', born: [1986, 2000], schedule: true,
    named: [
      { first: 'Leah', last: 'Fernandez', jersey: '9', position: 'SF', birthdate: '1985-02-17', heightCm: 170, weightKg: 63, skill: 1.15, alsoPlays: ['masters'] },
      { first: 'Mika', last: 'Santos', jersey: '6', position: 'PF', skill: 1.05 },
    ] },
  { league: 'womens', name: 'Matina Lady Mavs', shortName: 'MLM', color: '#B5480E', gender: 'F', born: [1995, 2007], schedule: true,
    named: [{ first: 'Camille', last: 'Ortiz', jersey: '23', position: 'PG', skill: 1.15 }] },
  { league: 'womens', name: 'Toril Lady Thunder', shortName: 'TLT', color: '#6B4FA0', gender: 'F', born: [1995, 2007], schedule: true,
    named: [{ first: 'Sofia', last: 'Reyes', jersey: '5', position: 'SF', skill: 1.1 }] },

  { league: 'youth-u18', name: 'Toril Juniors', shortName: 'TJR', color: '#6B4FA0', gender: 'M', born: [2008, 2012], schedule: true,
    named: [
      { first: 'Marco', last: 'Santiago', jersey: '23', position: 'SF', birthdate: '2009-01-30', heightCm: 183, weightKg: 70, skill: 1.25 },
      { first: 'Arvin', last: 'Dizon', jersey: '10', position: 'PG', skill: 1.05 },
    ] },
  { league: 'youth-u18', name: 'Talomo Cubs', shortName: 'TCB', color: '#A23B3B', gender: 'M', born: [2008, 2013], schedule: true,
    named: [
      { first: 'Ivan', last: 'Morales', jersey: '8', position: 'SF', skill: 1.15 },
      { first: 'Jerome', last: 'Cabrera', jersey: '5', position: 'SG', birthdate: '2014-09-09', heightCm: 150, weightKg: 40, skill: 0.95 },
    ] },
  { league: 'youth-u18', name: 'Mintal Hawks', shortName: 'MIN', color: '#2E7D5B', gender: 'M', born: [2008, 2012], schedule: true,
    named: [
      { first: 'Luis', last: 'Tan', jersey: '4', position: 'PG', skill: 1.1 },
      { first: 'Noel', last: 'Yap', jersey: '32', position: 'C', skill: 1.05 },
    ] },
  { league: 'youth-u18', name: 'Bunawan Blaze', shortName: 'BUN', color: '#C2410C', gender: 'M', born: [2008, 2012], schedule: true,
    named: [{ first: 'Kyle', last: 'Ramirez', jersey: '15', position: 'PF', skill: 1.15 }] },
  { league: 'youth-u18', name: 'Toril Juniors Girls', shortName: 'TJG', color: '#6B4FA0', gender: 'F', born: [2009, 2013], schedule: false,
    named: [{ first: 'Kristine', last: 'Lumbao', jersey: '3', position: 'PG', birthdate: '2011-06-12', heightCm: 160, weightKg: 50 }] },
];

export const FIRST_NAMES: Record<Gender, string[]> = {
  M: [
    'Aaron', 'Angelo', 'Bryan', 'Carl', 'Christian', 'Daniel', 'Darwin', 'Earl', 'Edgar', 'Ferdinand', 'Gerald', 'Gino',
    'Harold', 'Ian', 'Jansen', 'Jasper', 'Jericho', 'John Paul', 'Jomar', 'Kenneth', 'Kurt', 'Lance', 'Leo', 'Marvin',
    'Mark', 'Nico', 'Oliver', 'Patrick', 'Raymond', 'Rico', 'Roel', 'Ryan', 'Sean', 'Teodoro', 'Vincent', 'Xavier',
  ],
  F: [
    'Alyssa', 'Angela', 'Bianca', 'Carla', 'Clarisse', 'Danica', 'Ella', 'Erika', 'Faith', 'Gela', 'Hannah', 'Isabel',
    'Jasmine', 'Joanna', 'Kaye', 'Kim', 'Lara', 'Maan', 'Nicole', 'Patricia', 'Rachel', 'Rina', 'Shaira', 'Trisha',
  ],
};

export const LAST_NAMES = [
  'Abella', 'Agustin', 'Alcantara', 'Andrada', 'Bacalso', 'Baguio', 'Belmonte', 'Cabahug', 'Caballero', 'Dacanay',
  'Datu', 'Del Mundo', 'Escobar', 'Estrada', 'Fajardo', 'Gonzaga', 'Gumban', 'Hernandez', 'Ilagan', 'Jimenez',
  'Labrador', 'Lacson', 'Macaraeg', 'Magbanua', 'Manalo', 'Montero', 'Nuñez', 'Ocampo', 'Padilla', 'Panganiban',
  'Quiambao', 'Rosales', 'Sabado', 'Saldaña', 'Sison', 'Tabanao', 'Tolentino', 'Umali', 'Valencia', 'Velasco',
  'Yanson', 'Zamora',
];

/** Positions for generated players, filling the roster so the first five cover PG–C. */
export const ROSTER_POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C', 'SG', 'SF', 'PF', 'C'];

export const AWARDS = [
  { player: 'Joaquin Dela Rosa', year: 2026, title: 'Player of the Week · week 4', league: 'city-open' },
  { player: 'Joaquin Dela Rosa', year: 2025, title: 'Best Playmaker', league: 'city-open' },
  { player: 'Joaquin Dela Rosa', year: 2024, title: 'Mythical Five', league: 'collegiate' },
  { player: 'Bea Tamayo', year: 2025, title: 'Most Valuable Player', league: 'womens' },
  { player: 'Marco Santiago', year: 2025, title: 'Rookie of the Year', league: 'youth-u18' },
];

export const AVAILABILITY = [
  { player: 'Joaquin Dela Rosa', kind: 'injury', title: 'Ankle sprain', detail: 'Missed 2 games · cleared to play', startedOn: '2025-08-09', endedOn: '2025-08-23' },
  { player: 'Joaquin Dela Rosa', kind: 'suspension', title: '1 game', detail: 'Disqualifying foul · served', startedOn: '2024-02-10', endedOn: '2024-02-17' },
  { player: 'Rafael Abad', kind: 'injury', title: 'Knee sprain', detail: 'Day to day', startedOn: '2026-09-21', endedOn: null },
  { player: 'Paolo Ignacio', kind: 'suspension', title: '2 games', detail: 'Two unsportsmanlike fouls in one game', startedOn: '2026-10-11', endedOn: null },
] as const;
