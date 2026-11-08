import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const migrationDir = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

export const HOST = '11111111-1111-4111-8111-111111111111';
export const GUEST = '22222222-2222-4222-8222-222222222222';
export const OTHER = '33333333-3333-4333-8333-333333333333';

export async function openDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
  `);
  const files = readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    await db.exec(readFileSync(join(migrationDir, file), 'utf8'));
  }
  return db;
}

export async function insertUsers(db: PGlite, users: readonly { id: string; email: string }[]): Promise<void> {
  for (const user of users) {
    await db.query('insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing', [user.id, user.email]);
  }
}

export async function asUser(db: PGlite, userId: string, sql: string) {
  return db.transaction(async (tx) => {
    await tx.exec(`select set_config('request.jwt.claim.sub', '${userId}', true)`);
    await tx.exec('set local role authenticated');
    return tx.query(sql);
  });
}
