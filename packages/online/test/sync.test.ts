import { describe, expect, it } from 'vitest';
import { acceptSnapshot, followMatch, noteNotice } from '../src/sync';
import type { MatchNotice } from '../src/types';

describe('realtime notices', () => {
  it('ignores a duplicate or older notice and asks for a fresh read otherwise', () => {
    expect(noteNotice(3, { matchId: 'm', version: 3 })).toBe('ignore');
    expect(noteNotice(3, { matchId: 'm', version: 2 })).toBe('ignore');
    expect(noteNotice(3, { matchId: 'm', version: 4 })).toBe('resync');
  });

  it('keeps the newer snapshot when an older response arrives late', () => {
    expect(acceptSnapshot({ version: 4 }, { version: 2 }).version).toBe(4);
    expect(acceptSnapshot({ version: 4 }, { version: 5 }).version).toBe(5);
    expect(acceptSnapshot(null, { version: 1 }).version).toBe(1);
  });

  it('loads once for a duplicate notice, reloads for a newer one, and stops listening', async () => {
    const notices: Array<(notice: MatchNotice) => void> = [];
    let pulls = 0;
    let unsubscribed = false;
    const seen: number[] = [];
    const versions = [1, 2];
    const follow = followMatch({
      subscribe(onNotice) {
        notices.push(onNotice);
        return () => {
          unsubscribed = true;
        };
      },
      pull: async () => {
        const version = versions[pulls] ?? pulls + 1;
        pulls += 1;
        return { version };
      },
      onSnapshot(snapshot) {
        seen.push(snapshot.version);
      },
    });

    await wait();
    expect(pulls).toBe(1);
    notices[0]?.({ matchId: 'm', version: 1 });
    await wait();
    expect(pulls).toBe(1);
    notices[0]?.({ matchId: 'm', version: 2 });
    await wait();
    expect(seen).toEqual([1, 2]);
    follow.stop();
    notices[0]?.({ matchId: 'm', version: 9 });
    await wait();
    expect(pulls).toBe(2);
    expect(unsubscribed).toBe(true);
  });
});

function wait(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
