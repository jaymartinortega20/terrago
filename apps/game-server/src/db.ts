import pg from 'pg';

// Return BIGINT columns (gold, xp, ids) as JS numbers. Values in this game stay
// far below 2^53; the ledgers' CHECK constraints guard the arithmetic.
pg.types.setTypeParser(20, (v) => Number(v));

export type Pool = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string, max: number): pg.Pool {
  return new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  });
}

/**
 * Run `fn` inside a transaction. Any throw rolls everything back, so a
 * half-applied item or gold transfer can never be committed.
 */
export async function withTransaction<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** A user-facing failure (bad input, not enough space...). Safe to show to players. */
export class GameError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'GameError';
  }
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (!constraint || e.constraint === constraint);
}
