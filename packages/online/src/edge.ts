import type { DictionaryProvider } from '@word-arena/engine';
import { cleanDisplayName } from './codes';
import { handleMatchRequest, type VerifiedUser } from './handler';
import { PostgresDirectory } from './postgres-directory';
import type { SqlDatabase } from './sql';

export type EdgeEnv = {
  readonly supabaseUrl?: string;
  readonly publishableKey?: string;
};

export type EdgeHandlerOptions = {
  readonly verify?: (token: string) => Promise<VerifiedUser | null>;
  readonly fetch?: typeof fetch;
  readonly dictionaries?: ReadonlyMap<string, DictionaryProvider>;
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
};

/**
 * HTTP entry for the match function.
 * The directory is always Postgres-backed. A missing database returns unavailable
 * rather than serving an in-memory match. Without a dictionary catalog the
 * directory stays null and scored plays are refused.
 */
export function createEdgeHandler(env: EdgeEnv, database: SqlDatabase | null, options: EdgeHandlerOptions = {}) {
  const verify = options.verify ?? ((token: string) => verifySupabaseUser(env, token, options.fetch));
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return json({ ok: false, code: 'invalid-command', message: 'Use POST for a match action.' }, 405);
    if (!database) {
      return json({ ok: false, code: 'unavailable', message: 'Online play is not connected to a database.' }, 503);
    }
    const directory = new PostgresDirectory(database, options.dictionaries
      ? { dictionaries: options.dictionaries }
      : { dictionary: null });
    try {
      let emailName = 'Player';
      const response = await handleMatchRequest(request, {
        directory,
        verify: async (token) => {
          const user = await verify(token);
          const local = user?.email?.split('@')[0] ?? '';
          emailName = cleanDisplayName(local);
          return user;
        },
        displayName: () => emailName,
      });
      return withCors(response);
    } catch {
      return json({ ok: false, code: 'unavailable', message: 'The match could not be saved.' }, 500);
    }
  };
}

export async function verifySupabaseUser(env: EdgeEnv, token: string, fetchImpl: typeof fetch = fetch): Promise<VerifiedUser | null> {
  const url = env.supabaseUrl?.replace(/\/$/, '') ?? '';
  const key = env.publishableKey ?? '';
  if (!url || !key) return null;
  if (key.includes('service_role') || key.includes('sb_secret_')) return null;
  let response: Response;
  try {
    response = await fetchImpl(`${url}/auth/v1/user`, {
      headers: { apikey: key, authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body = (await response.json()) as { id?: unknown; email?: unknown };
  if (typeof body.id !== 'string' || body.id.length === 0) return null;
  return { id: body.id, email: typeof body.email === 'string' ? body.email : undefined };
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });
}
