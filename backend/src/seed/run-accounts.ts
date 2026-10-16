/**
 * Creates or resets the login accounts without touching any other data.
 *   npm run db:accounts
 * Stop the API first when using the embedded database (PGlite allows one process at a time).
 */
import { getConnection } from '../db/index.js';
import { upsertAccounts } from './accounts.js';

const conn = await getConnection();
await conn.migrate();
const accounts = await upsertAccounts(conn.db);
for (const a of accounts) console.log(`  ${a.role.padEnd(9)} ${a.email}`);
console.log(accounts.length ? 'Passwords are in backend/.env (SEED_ADMIN_PASSWORD, SEED_DEMO_PASSWORD).' : 'No accounts configured in .env.');
await conn.close();
