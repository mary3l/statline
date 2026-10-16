import { defineConfig } from 'drizzle-kit';

// `db:generate` only diffs the schema file against earlier migrations; it never connects.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
});
