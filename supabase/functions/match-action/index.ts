import { sharedDictionaries } from '@word-arena/engine';
import { createEdgeHandler, type EdgeEnv } from '../../../packages/online/src/edge.ts';
import { fromPostgresJs } from '../../../packages/online/src/sql.ts';

const databaseUrl = Deno.env.get('SUPABASE_DB_URL') ?? '';
const database = databaseUrl
  ? fromPostgresJs((await import('npm:postgres@3.4.7')).default(databaseUrl, { prepare: false, max: 1 }))
  : null;

const env: EdgeEnv = {
  supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
  publishableKey: Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '',
};

Deno.serve(createEdgeHandler(env, database, { dictionaries: sharedDictionaries() }));
