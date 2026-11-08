import { describe, expect, it } from 'vitest';
import manifest from '../package.json' with { type: 'json' };

describe('package manifest', () => {
  it('has no runtime dependency on the app, React, Vite, or Supabase', () => {
    expect(manifest.name).toBe('@word-arena/engine');
    const dependencies = 'dependencies' in manifest ? manifest.dependencies : undefined;
    expect(dependencies ?? {}).toEqual({});
    const declared = JSON.stringify(manifest);
    for (const name of ['react', 'react-dom', 'vite', 'supabase', 'zustand', 'motion']) {
      expect(declared.includes(`"${name}"`), name).toBe(false);
    }
  });
});
