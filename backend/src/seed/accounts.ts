import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import type { Role } from '../auth.js';
import { config } from '../config.js';
import { schema, type DB } from '../db/index.js';

interface Account {
  email: string;
  name: string;
  role: Role;
  password: string;
}

/**
 * The admin from SEED_ADMIN_*, plus one test account per other role (sharing SEED_DEMO_PASSWORD)
 * so each role's permissions can be tried. Test accounts are never created in production.
 */
export function seedAccounts(): Account[] {
  const accounts: Account[] = [];
  if (config.SEED_ADMIN_EMAIL && config.SEED_ADMIN_PASSWORD) {
    accounts.push({ email: config.SEED_ADMIN_EMAIL, name: 'League Admin', role: 'admin', password: config.SEED_ADMIN_PASSWORD });
  }
  if (config.SEED_DEMO_PASSWORD && config.NODE_ENV !== 'production') {
    accounts.push(
      { email: 'organizer@statline.test', name: 'Demo Organizer', role: 'organizer', password: config.SEED_DEMO_PASSWORD },
      { email: 'scorer@statline.test', name: 'Demo Scorer', role: 'scorer', password: config.SEED_DEMO_PASSWORD },
    );
  }
  return accounts;
}

/** Creates the accounts, or resets their name, role and password if they already exist. */
export async function upsertAccounts(db: DB) {
  const accounts = seedAccounts();
  for (const a of accounts) {
    const passwordHash = await bcrypt.hash(a.password, 10);
    await db
      .insert(schema.users)
      .values({ email: a.email, name: a.name, role: a.role, passwordHash })
      .onConflictDoUpdate({
        target: schema.users.email,
        set: { name: a.name, role: a.role, passwordHash, createdAt: sql`${schema.users.createdAt}` },
      });
  }
  return accounts.map(({ email, role }) => ({ email, role }));
}
