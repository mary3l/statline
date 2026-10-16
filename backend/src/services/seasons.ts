import { desc, eq } from 'drizzle-orm';
import { HttpError } from '../app.js';
import type { DB } from '../db/index.js';
import { schema } from '../db/index.js';

/** The season marked current, else the latest one. */
export async function resolveSeason(db: DB, seasonId?: number) {
  if (seasonId !== undefined) {
    const [s] = await db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId));
    if (!s) throw new HttpError(404, 'Season not found.');
    return s;
  }
  const [s] = await db
    .select()
    .from(schema.seasons)
    .orderBy(desc(schema.seasons.isCurrent), desc(schema.seasons.year))
    .limit(1);
  if (!s) throw new HttpError(404, 'No seasons set up yet. Run the seed.');
  return s;
}

/** Today's date in Davao (UTC+8) as YYYY-MM-DD. */
export function todayManila(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}
