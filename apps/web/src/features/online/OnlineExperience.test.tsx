import { MemoryDirectory } from '@word-arena/online';
import { arenaStandardRules, validateRules, type Rules } from '@word-arena/engine';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { readOnlineConfig } from './config';
import { OnlineExperience, OnlineTable } from './OnlineExperience';
import type { AuthPort, RoomPort, SessionUser } from './ports';

function smallRules(): Rules {
  const result = validateRules({
    ...arenaStandardRules(),
    boardSize: 9,
    rackSize: 2,
    passRoundLimit: 1,
    tileSet: [
      { kind: 'letter', letter: 'A', count: 2, points: 1 },
      { kind: 'letter', letter: 'T', count: 2, points: 1 },
      { kind: 'letter', letter: 'E', count: 2, points: 1 },
      { kind: 'blank', count: 1, points: 0 },
    ],
  });
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('\n'));
  return result.rules;
}

function auth(start: SessionUser | null = null): AuthPort & { user: SessionUser | null } {
  const port = {
    configured: true,
    user: start,
    async getSession() {
      return port.user;
    },
    async signUp(email: string, password: string) {
      if (password.length < 8) return { user: null, error: 'Password is too short.' };
      port.user = { id: 'user-1', email };
      return { user: port.user, error: null };
    },
    async signIn(email: string) {
      port.user = { id: 'user-1', email };
      return { user: port.user, error: null };
    },
    async signOut() {
      port.user = null;
    },
    onChange() {
      return () => undefined;
    },
  };
  return port;
}

function rooms(table: MemoryDirectory) {
  return (user: SessionUser): RoomPort => ({
    createRoom: () => table.createRoom(user.id, 'Ada'),
    joinRoom: (code) => table.joinRoom(user.id, code, 'Ada'),
    setReady: (roomId) => table.setReady(user.id, roomId),
    startMatch: (roomId) => table.startMatch(user.id, roomId),
    cancelRoom: (roomId) => table.cancelRoom(user.id, roomId),
    setPresence: (roomId, connected) => table.setPresence(user.id, roomId, connected),
    readRoom: (roomId) => table.readRoom(user.id, roomId),
    readMatch: (matchId) => table.readMatch(user.id, matchId),
    act: (matchId, command, key, version) => table.act(user.id, matchId, command, key, version),
    subscribe: () => () => undefined,
  });
}

describe('online config', () => {
  it('rejects a missing project and a secret key', () => {
    expect(readOnlineConfig({})).toBeNull();
    expect(readOnlineConfig({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_this_is_not_a_browser_key',
    })).toBeNull();
    expect(readOnlineConfig({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example_key_value',
    })?.url).toBe('https://example.supabase.co');
  });
});

describe('online screens', () => {
  it('keeps a signed-out visitor on the form and restores a session', async () => {
    const signedOut = auth();
    const { unmount } = render(<OnlineExperience auth={signedOut} roomsFor={rooms(new MemoryDirectory())} />);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create private room' })).not.toBeInTheDocument();
    unmount();

    render(<OnlineExperience auth={auth({ id: 'user-1', email: 'ada@example.com' })} roomsFor={rooms(new MemoryDirectory())} />);
    expect(await screen.findByText(/Signed in as ada@example.com/)).toBeInTheDocument();
  });

  it('validates the form, signs in, creates a room, and signs out', async () => {
    const user = userEvent.setup();
    const session = auth();
    render(<OnlineExperience auth={session} roomsFor={rooms(new MemoryDirectory({ rules: smallRules(), random: () => 0 }))} />);
    await screen.findByRole('heading', { name: 'Sign in' });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/email/i);
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'long-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Create private room' }));
    expect(await screen.findByText(/You are the host/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start match' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows an invalid code', async () => {
    const user = userEvent.setup();
    const table = new MemoryDirectory({ rules: smallRules(), random: () => 0 });
    render(<OnlineExperience auth={auth({ id: 'host', email: 'ada@example.com' })} roomsFor={rooms(table)} />);
    await user.type(await screen.findByLabelText('Room code'), 'NOPE');
    await user.click(screen.getByRole('button', { name: 'Join room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid/i);
  });

  it('keeps submit disabled and sends a pass to the server', async () => {
    const user = userEvent.setup();
    const table = new MemoryDirectory({
      rules: smallRules(),
      random: () => 0,
      now: () => '2026-11-09T00:00:00.000Z',
      ids: (() => {
        let n = 0;
        return () => `id-${n += 1}`;
      })(),
    });
    const created = await table.createRoom('host', 'Ada');
    if (!created.ok) throw new Error(created.message);
    await table.joinRoom('guest', created.room.code, 'Bea');
    await table.setReady('host', created.room.id);
    await table.setReady('guest', created.room.id);
    const started = await table.startMatch('host', created.room.id);
    if (!started.ok || !started.room.matchId) throw new Error('start');
    const port = rooms(table)({ id: 'host', email: 'ada@example.com' });
    const loaded = await port.readMatch(started.room.matchId);
    const room = await port.readRoom(created.room.id);
    if (!loaded.ok || !room.ok) throw new Error('view');
    render(
      <OnlineTable
        room={room.room}
        match={loaded.match}
        port={port}
        link="online"
        onMatch={() => undefined}
        onRoom={() => undefined}
        onLeave={() => undefined}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(screen.getByText(/No dictionary is configured/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pass' }));
    expect((await screen.findAllByText(/Bea to move/)).length).toBeGreaterThan(0);
    const guest = await table.readMatch('guest', started.room.matchId);
    if (!guest.ok) throw new Error(guest.message);
    expect(guest.match.turn).toBe(1);
  });
});
