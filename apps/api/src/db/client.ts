import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

// Postgres returns bigint (int8) and numeric as strings by default. Our bigint columns are money in
// minor units and fit safely in a JS number (Drizzle maps them with mode: 'number'); numeric
// (exchange rates) stays a string so no precision is lost.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw new RangeError(`int8 value ${value} exceeds safe integer range`);
  return n;
});
// DATE columns stay as 'YYYY-MM-DD' strings; never convert them to JS Dates (time zone shifts).
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Executor = Db | Tx;

export function createDb(connectionString: string, max = 10) {
  const pool = new pg.Pool({ connectionString, max });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  return { db, pool };
}

export { schema };
