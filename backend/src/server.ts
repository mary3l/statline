import { buildApp } from './app.js';
import { config } from './config.js';
import { getConnection } from './db/index.js';

const conn = await getConnection();
// Migrations run on every start, so a deploy can never ship code ahead of its schema.
await conn.migrate();

const app = await buildApp(conn.db);
app.log.info(`Database: ${conn.label}`);

let closing: Promise<void> | undefined;
const shutdown = () => {
  closing ??= (async () => {
    await app.close();
    await conn.close();
    process.exit(0);
  })();
  return closing;
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Under `npm run dev` (src/dev.ts) restarts arrive over IPC: on Windows a signal would end the process at once.
process.on('message', (m) => {
  if (m === 'shutdown') void shutdown();
});
// The dev runner is gone: close the database instead of lingering with it open (Windows ends us with the runner anyway).
process.on('disconnect', shutdown);

await app.listen({ host: config.HOST, port: config.PORT });
