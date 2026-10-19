/**
 * npm run db:migrate
 * Applies pending migrations to DATABASE_URL.
 */
import pg from 'pg';
import { runMigrations } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env or export it.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const res = await runMigrations(pool, (m) => console.log(m));
  console.log(res.applied.length ? `Applied ${res.applied.length} migration(s).` : 'Database is up to date.');
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
