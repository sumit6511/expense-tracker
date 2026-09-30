import pg from 'pg';
import { createDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';

/**
 * Creates a throwaway database for the test run, migrates it, and drops it afterwards.
 * Point TEST_DATABASE_ADMIN_URL at any database on a server where the user may CREATE DATABASE.
 */
export default async function setup({
  provide,
}: {
  provide: (key: 'databaseUrl', value: string) => void;
}) {
  const adminUrl =
    process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://et:et@localhost:5432/postgres';
  const name = `et_test_${Date.now()}_${process.pid}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const { db, pool } = createDb(url.toString(), 1);
  await runMigrations(db);
  await pool.end();
  provide('databaseUrl', url.toString());

  return async () => {
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    await client.query(`drop database if exists ${name} with (force)`);
    await client.end();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
