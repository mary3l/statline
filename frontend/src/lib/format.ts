import type { AgeGroup, Gender, Position } from '../api/types';

export const GENDER_LABEL: Record<Gender, string> = { F: 'Female', M: 'Male' };

export const POSITION_LABEL: Record<Position, string> = {
  PG: 'Point guard',
  SG: 'Shooting guard',
  SF: 'Small forward',
  PF: 'Power forward',
  C: 'Center',
};

/** Made ÷ attempted × 100 with one decimal, or an em dash when nothing was attempted. */
export function pct(made: number, att: number): string {
  return att ? ((made / att) * 100).toFixed(1) : '—';
}

export function perGame(total: number, games: number): string {
  return games ? (total / games).toFixed(1) : '—';
}

export function minutes(seconds: number): string {
  return String(Math.round(seconds / 60));
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function initials(first: string, last: string): string {
  return `${first[0] ?? ''}${last.split(' ').slice(-1)[0]?.[0] ?? ''}`.toUpperCase();
}

const MANILA = 'Asia/Manila';

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) {
  return new Intl.DateTimeFormat('en-PH', { timeZone: MANILA, ...opts }).format(new Date(iso));
}

export function formatTime(iso: string) {
  return new Intl.DateTimeFormat('en-PH', { timeZone: MANILA, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** January … December. */
export const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: 'long' }).format(new Date(Date.UTC(2000, i, 1))),
);

/** Calendar date (YYYY-MM-DD) shown without a timezone shift. */
export function formatDay(date: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', ...opts }).format(new Date(`${date}T00:00:00Z`));
}

/** Same rule as the backend (engine/ageGroup.ts): the age reached in the season year. */
export function ageGroupFor(birthdate: string, seasonYear: number): { age: number; group: AgeGroup } | null {
  const year = Number(birthdate.slice(0, 4));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || !year) return null;
  const age = seasonYear - year;
  const group: AgeGroup =
    age <= 12 ? 'U12' : age <= 14 ? 'U14' : age <= 16 ? 'U16' : age <= 18 ? 'U18' : age >= 35 ? 'Masters 35+' : 'Open';
  return { age, group };
}

export function periodLabel(i: number): string {
  return i < 4 ? `Q${i + 1}` : `OT${i - 3}`;
}

/** Date (YYYY-MM-DD) and time (HH:MM) of an instant in Davao (UTC+8, no daylight saving), for date/time inputs. */
export function manilaParts(iso: string): { date: string; time: string } {
  const s = new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

/** The instant for a Davao date and time, as an ISO string the API accepts. */
export function fromManila(date: string, time: string): string {
  return `${date}T${time}:00+08:00`;
}
