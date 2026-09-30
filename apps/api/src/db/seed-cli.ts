import { createAuth } from '../auth';
import { loadEnv } from '../env';
import { createDb } from './client';
import { runMigrations } from './migrate';
import { DEMO_PASSWORD, seedDemo } from './seed';

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL, 2);
await runMigrations(db);
const result = await seedDemo(db, createAuth(db, env));
await pool.end();
console.log(
  result.created
    ? `Demo data created. Sign in as ${result.email} / ${DEMO_PASSWORD}`
    : `Demo user ${result.email} already exists; nothing changed.`,
);
