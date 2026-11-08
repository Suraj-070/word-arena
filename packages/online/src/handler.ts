import { cleanDisplayName } from './codes';
import type { MatchDirectory } from './directory';
import type { MatchCommand } from './types';

export type VerifiedUser = { readonly id: string; readonly email?: string };

export type MatchHandlerDeps = {
  readonly verify: (token: string) => Promise<VerifiedUser | null>;
  readonly directory: MatchDirectory;
  readonly displayName?: (userId: string) => string;
};

const ALLOWED_FIELDS = new Set([
  'op',
  'code',
  'roomId',
  'matchId',
  'connected',
  'command',
  'idempotencyKey',
  'expectedVersion',
]);

type Body = {
  readonly op?: string;
  readonly code?: string;
  readonly roomId?: string;
  readonly matchId?: string;
  readonly connected?: boolean;
  readonly command?: MatchCommand;
  readonly idempotencyKey?: string;
  readonly expectedVersion?: number;
};

export async function handleMatchRequest(request: Request, deps: MatchHandlerDeps): Promise<Response> {
  const token = bearer(request.headers.get('authorization'));
  if (!token) return json({ ok: false, code: 'unauthenticated', message: 'Sign in is required.' }, 401);
  const user = await deps.verify(token);
  if (!user) return json({ ok: false, code: 'unauthenticated', message: 'Sign in is required.' }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, code: 'invalid-command', message: 'The request body must be JSON.' }, 400);
  }
  const problem = bodyError(payload);
  if (problem) return json({ ok: false, code: 'invalid-command', message: problem }, 400);
  const body = payload as Body;

  const name = cleanDisplayName(deps.displayName?.(user.id) ?? 'Player');
  const result = await dispatch(deps.directory, user.id, name, body);
  return json(result, result.ok ? 200 : statusFor(result.code));
}

function bodyError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'The request body must be JSON.';
  const body = value as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) return 'That field is not accepted.';
  }
  if (body.expectedVersion !== undefined && !Number.isInteger(body.expectedVersion)) return 'That field is not accepted.';
  if (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== 'string') return 'That field is not accepted.';
  if (body.connected !== undefined && typeof body.connected !== 'boolean') return 'That field is not accepted.';
  if (body.command !== undefined && !cleanCommand(body.command)) return 'The action is not valid.';
  return null;
}

function cleanCommand(value: unknown): value is MatchCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  const keys = Object.keys(command);
  if (command.type === 'pass' || command.type === 'resign') return keys.length === 1 && keys[0] === 'type';
  if (command.type === 'exchange') {
    return keys.every((key) => key === 'type' || key === 'tileIds')
      && Array.isArray(command.tileIds)
      && command.tileIds.every((id) => typeof id === 'string');
  }
  if (command.type !== 'play' || !keys.every((key) => key === 'type' || key === 'placements') || !Array.isArray(command.placements)) {
    return false;
  }
  return command.placements.every((placement) => {
    if (!placement || typeof placement !== 'object' || Array.isArray(placement)) return false;
    const place = placement as Record<string, unknown>;
    const placeKeys = Object.keys(place);
    if (!placeKeys.every((key) => key === 'row' || key === 'col' || key === 'tileId' || key === 'assignedLetter')) return false;
    if (!Number.isInteger(place.row) || !Number.isInteger(place.col) || typeof place.tileId !== 'string') return false;
    return place.assignedLetter === undefined || (typeof place.assignedLetter === 'string' && /^[A-Z]$/.test(place.assignedLetter));
  });
}

async function dispatch(directory: MatchDirectory, userId: string, displayName: string, body: Body) {
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
  if (code === 'unavailable') return 503;
  return 400;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
