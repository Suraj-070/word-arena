import { cleanDisplayName } from './codes';
import type { MemoryDirectory } from './directory';
import type { MatchCommand } from './types';

export type VerifiedUser = { readonly id: string };

export type MatchHandlerDeps = {
  readonly verify: (token: string) => Promise<VerifiedUser | null>;
  readonly directory: MemoryDirectory;
  readonly displayName?: (userId: string) => string;
};

type Body = {
  readonly op?: string;
  readonly code?: string;
  readonly roomId?: string;
  readonly matchId?: string;
  readonly connected?: boolean;
  readonly command?: MatchCommand;
  readonly idempotencyKey?: string;
  readonly expectedVersion?: number;
  readonly userId?: string;
  readonly displayName?: string;
  readonly score?: number;
  readonly bag?: unknown;
  readonly rack?: unknown;
};

export async function handleMatchRequest(request: Request, deps: MatchHandlerDeps): Promise<Response> {
  const token = bearer(request.headers.get('authorization'));
  if (!token) return json({ ok: false, code: 'unauthenticated', message: 'Sign in is required.' }, 401);
  const user = await deps.verify(token);
  if (!user) return json({ ok: false, code: 'unauthenticated', message: 'Sign in is required.' }, 401);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ ok: false, code: 'invalid-command', message: 'The request body must be JSON.' }, 400);
  }

  const name = cleanDisplayName(deps.displayName?.(user.id) ?? 'Player');
  const result = await dispatch(deps.directory, user.id, name, body);
  return json(result, result.ok ? 200 : statusFor(result.code));
}

async function dispatch(directory: MemoryDirectory, userId: string, displayName: string, body: Body) {
  switch (body.op) {
    case 'create-room':
      return directory.createRoom(userId, displayName);
    case 'join-room':
      return directory.joinRoom(userId, body.code ?? '', displayName);
    case 'set-ready':
      return directory.setReady(userId, body.roomId ?? '');
    case 'start-match':
      return directory.startMatch(userId, body.roomId ?? '');
    case 'cancel-room':
      return directory.cancelRoom(userId, body.roomId ?? '');
    case 'presence':
      return directory.setPresence(userId, body.roomId ?? '', body.connected !== false);
    case 'read-room':
      return directory.readRoom(userId, body.roomId ?? '');
    case 'read-match':
      return directory.readMatch(userId, body.matchId ?? '');
    case 'act':
      if (!body.command) return { ok: false as const, code: 'invalid-command', message: 'The action is missing.' };
      return directory.act(userId, body.matchId ?? '', body.command, body.idempotencyKey ?? '', body.expectedVersion);
    default:
      return { ok: false as const, code: 'invalid-command', message: 'That action is not supported.' };
  }
}

function bearer(header: string | null): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

function statusFor(code: string): number {
  if (code === 'unauthenticated') return 401;
  if (code === 'not-member' || code === 'not-host' || code === 'wrong-seat') return 403;
  if (code === 'invalid-code' || code === 'expired' || code === 'cancelled') return 404;
  if (code === 'full' || code === 'closed' || code === 'not-ready' || code === 'duplicate-command' || code === 'stale') return 409;
  if (code === 'dictionary-unavailable') return 422;
  return 400;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
