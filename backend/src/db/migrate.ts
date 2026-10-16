import { getConnection } from './index.js';

const conn = await getConnection();
await conn.migrate();
console.log(`Migrations applied to ${conn.label}`);
await conn.close();
