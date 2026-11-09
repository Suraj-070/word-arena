import { DEFAULT_DICTIONARY_PRESET_ID, sharedDictionaries } from '@word-arena/engine';
import postgres from 'npm:postgres@3.4.7';
import { createEdgeHandler } from '../../../packages/online/src/edge.ts';
import { fromPostgresJs } from '../../../packages/online/src/sql.ts';

const databaseUrl = Deno.env.get('WORD_ARENA_POSTGRES_URL') ?? '';
if (Deno.env.get('WORD_ARENA_POSTGRES_REQUIRED') === '1' && !databaseUrl) {
  throw new Error('WORD_ARENA_POSTGRES_URL is required for the Deno entry test.');
}

const HOST = '11111111-1111-4111-8111-111111111111';
const GUEST = '22222222-2222-4222-8222-222222222222';
const entryUrl = new URL('./index.ts', import.meta.url);

function pathOf(url: URL): string {
  return decodeURIComponent(url.pathname);
}

Deno.test('the entry uses the postgres handler and does not mention a browser secret', async () => {
  const source = await Deno.readTextFile(entryUrl);
  const edge = await Deno.readTextFile(new URL('../../../packages/online/src/edge.ts', import.meta.url));
  if (!source.includes('createEdgeHandler')) throw new Error('The entry does not call the match handler.');
  if (!source.includes('fromPostgresJs')) throw new Error('The entry does not adapt a Postgres connection.');
  if (source.includes('MemoryDirectory')) throw new Error('The entry references the in-memory directory.');
  if (!edge.includes('new PostgresDirectory')) throw new Error('The handler is not backed by Postgres.');
  if (!source.includes('sharedDictionaries')) throw new Error('The entry does not load the shared lexicon.');
  if (!edge.includes('dictionaries')) throw new Error('The handler cannot receive the shared lexicon.');
  if (source.includes('service_role') || source.includes('sb_secret_') || source.includes('postgres://')) {
    throw new Error('The entry contains a credential.');
  }
});

Deno.test('the running entry rejects a missing database and a bad session', async () => {
  const missing = await listen({ SUPABASE_DB_URL: '' });
  try {
    const response = await post(missing, { op: 'create-room', userId: GUEST, score: 99 }, 'not-a-session');
    const body = await response.json();
    if (response.status !== 503) throw new Error(`Expected 503, received ${response.status}: ${JSON.stringify(body)}`);
    if (body.code !== 'unavailable' || !/database/i.test(String(body.message))) {
      throw new Error(`Unexpected unavailable response: ${JSON.stringify(body)}`);
    }
    if (/memory/i.test(JSON.stringify(body))) throw new Error('The missing-database response mentioned memory.');
    if (JSON.stringify(body).includes('99')) throw new Error('The response echoed a forged score.');
  } finally {
    await missing.stop();
  }

  if (!databaseUrl) return;
  assertDisposable(databaseUrl);
  const authed = await listen({ SUPABASE_DB_URL: databaseUrl, SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' });
  try {
    const anonymous = await post(authed, { op: 'create-room' });
    if (anonymous.status !== 401) throw new Error(`Expected 401 without a bearer token, received ${anonymous.status}.`);
    const forged = await post(authed, { op: 'create-room', userId: GUEST, displayName: 'Impostor', score: 40 }, 'not-a-session');
    const body = await forged.json();
    if (forged.status !== 401) throw new Error(`Expected 401 for a bad session, received ${forged.status}: ${JSON.stringify(body)}`);
    if (JSON.stringify(body).includes('Impostor') || JSON.stringify(body).includes('40')) {
      throw new Error('The auth failure echoed the forged body.');
    }
  } finally {
    await authed.stop();
  }
});

Deno.test({
  name: 'the handler started by the entry declares the shared preset and ignores a forged score',
  ignore: !databaseUrl,
  async fn() {
    assertDisposable(databaseUrl);
    const sql = postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 0, onnotice() {} });
    try {
      await applySchema(sql);
      const handler = createEdgeHandler({}, fromPostgresJs(sql), {
        dictionaries: sharedDictionaries(),
        verify: (token) => {
          if (token === 'ada') return Promise.resolve({ id: HOST, email: 'ada@example.com' });
          if (token === 'bea') return Promise.resolve({ id: GUEST, email: 'bea@example.com' });
          return Promise.resolve(null);
        },
      });
      const created = await handler(jsonRequest({ op: 'create-room' }, 'ada'));
      const room = (await created.json()).room;
      if (created.status !== 200 || !room?.id) throw new Error('The room was not created.');
      if ((await handler(jsonRequest({ op: 'join-room', code: room.code }, 'bea'))).status !== 200) throw new Error('join');
      if ((await handler(jsonRequest({ op: 'set-ready', roomId: room.id }, 'ada'))).status !== 200) throw new Error('ready');
      if ((await handler(jsonRequest({ op: 'set-ready', roomId: room.id }, 'bea'))).status !== 200) throw new Error('ready');
      const started = await handler(jsonRequest({ op: 'start-match', roomId: room.id }, 'ada'));
      const startedBody = await started.json();
      const matchId = startedBody.room?.matchId;
      if (started.status !== 200 || !matchId) throw new Error('The match did not start.');
      const loaded = await handler(jsonRequest({ op: 'read-match', matchId }, 'ada'));
      const match = (await loaded.json()).match;
      if (match.dictionaryAvailable !== true) throw new Error('The shared dictionary was not available.');
      if (match.dictionaryVersionId !== DEFAULT_DICTIONARY_PRESET_ID) {
        throw new Error(`The match did not declare ${DEFAULT_DICTIONARY_PRESET_ID}.`);
      }
      const forged = await handler(jsonRequest({
        op: 'act',
        matchId,
        idempotencyKey: 'forged-score',
        expectedVersion: match.version,
        score: 99,
        valid: true,
        dictionaryVersionId: 'esdb-rel-2026.02.25-A-60-v1',
        command: { type: 'pass' },
      }, 'ada'));
      const forgedBody = await forged.json();
      if (forged.status !== 400) throw new Error(`Expected the forged score to be rejected, received ${forged.status}.`);
      if (JSON.stringify(forgedBody).includes('99')) throw new Error('The response echoed a forged score.');
      const played = await handler(jsonRequest({
        op: 'act',
        matchId,
        idempotencyKey: 'missing-tile',
        expectedVersion: match.version,
        command: { type: 'play', placements: [{ row: 7, col: 7, tileId: 'not-on-the-rack' }] },
      }, 'ada'));
      const playBody = await played.json();
      if (played.status !== 400 || playBody.code !== 'tile-not-on-rack') {
        throw new Error(`Expected the server to reject the tile, received ${played.status}: ${JSON.stringify(playBody)}`);
      }
      const stored = await sql.unsafe('select version from public.matches where id = $1', [matchId]);
      if (Number(stored[0]?.version) !== 1) throw new Error('The rejected play changed the match version.');
      const passed = await handler(jsonRequest({
        op: 'act',
        matchId,
        idempotencyKey: 'pass-with-preference',
        expectedVersion: 1,
        dictionaryVersionId: 'esdb-rel-2026.02.25-A-60-v1',
        command: { type: 'pass' },
      }, 'ada'));
      const passedBody = await passed.json();
      if (passed.status !== 200 || passedBody.match?.dictionaryVersionId !== DEFAULT_DICTIONARY_PRESET_ID) {
        throw new Error('A personal preset on an action changed the match.');
      }
      const guestPreset = await handler(jsonRequest({ op: 'read-match', matchId }, 'bea'));
      const guestPresetBody = await guestPreset.json();
      if (guestPresetBody.match?.dictionaryVersionId !== DEFAULT_DICTIONARY_PRESET_ID) {
        throw new Error('The guest does not share the match preset.');
      }
      const guest = await handler(jsonRequest({ op: 'read-match', matchId }, 'bea'));
      const guestBody = JSON.stringify(await guest.json());
      for (const tile of match.rack as { id: string }[]) {
        if (guestBody.includes(tile.id)) throw new Error(`The guest response included ${tile.id}.`);
      }
    } finally {
      await sql.end({ timeout: 1 });
    }
  },
});

function assertDisposable(url: string): void {
  const parsed = new URL(url);
  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== '::1') {
    throw new Error('The Deno entry test only runs against localhost.');
  }
  const database = decodeURIComponent(parsed.pathname).replace(/^\/+|\/+$/g, '');
  if (database !== 'word_arena_verify') {
    throw new Error('The Deno entry test only uses the word_arena_verify database.');
  }
}

async function applySchema(sql: ReturnType<typeof postgres>): Promise<void> {
  await sql.unsafe(`
    drop schema if exists arena cascade;
    drop schema if exists auth cascade;
    drop schema if exists public cascade;
    create schema public;
    grant all on schema public to public;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
  `);
  await sql.unsafe(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
      end if;
    end $$;
  `);
  const migrationDir = new URL('../../../supabase/migrations/', import.meta.url);
  const files: string[] = [];
  for await (const entry of Deno.readDir(migrationDir)) {
    if (entry.name.endsWith('.sql')) files.push(entry.name);
  }
  files.sort();
  for (const file of files) {
    await sql.unsafe(await Deno.readTextFile(new URL(file, migrationDir)));
  }
  await sql.unsafe(
    `insert into auth.users (id, email) values ($1, 'ada@example.com'), ($2, 'bea@example.com')`,
    [HOST, GUEST],
  );
}

function jsonRequest(body: unknown, token?: string): Request {
  return new Request('http://127.0.0.1/match-action', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function listen(env: Record<string, string>): Promise<{ stop: () => Promise<void> }> {
  const child = new Deno.Command(Deno.execPath(), {
    args: ['run', '--quiet', '--allow-env', '--allow-net', '--allow-read', pathOf(entryUrl)],
    cwd: pathOf(new URL('.', import.meta.url)),
    env: {
      ...Deno.env.toObject(),
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      SUPABASE_ANON_KEY: '',
      ...env,
    },
    stdout: 'piped',
    stderr: 'piped',
  }).spawn();
  let logs = '';
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      logs += decoder.decode(next.value);
    }
  };
  const logged = Promise.all([collect(child.stdout), collect(child.stderr)]);
  try {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        const probe = await fetch('http://127.0.0.1:8000', { method: 'OPTIONS' });
        await probe.body?.cancel();
        return {
          stop: async () => {
            child.kill('SIGTERM');
            await child.status;
            await logged;
          },
        };
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error(`The entry did not listen on port 8000.\n${logs}`);
  } catch (error) {
    child.kill('SIGTERM');
    await child.status;
    await logged;
    throw error;
  }
}

function post(server: { stop: () => Promise<void> }, body: unknown, token?: string): Promise<Response> {
  void server;
  return fetch('http://127.0.0.1:8000', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
