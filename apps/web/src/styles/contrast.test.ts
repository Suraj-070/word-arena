import { describe, expect, it } from 'vitest';
import tokens from './tokens.css?raw';
import { contrastRatio, luminance } from './contrast';

function declaration(selector: string, name: string): string | undefined {
  const block = tokens.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  const value = block?.[1]?.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`));
  return value?.[1]?.toLowerCase();
}

describe('point value contrast', () => {
  const point = declaration(':root', '--wa-point');
  const lightTile = declaration(':root', '--wa-tile');
  const darkTile = declaration('\\[data-theme="dark"\\]', '--wa-tile') ?? lightTile;
  const tileInk = declaration(':root', '--wa-tile-ink');

  it('reads the point and tile colours from the token file', () => {
    expect(point).toBe('#655e55');
    expect(lightTile).toBe('#f7f1e4');
    expect(darkTile).toBe('#efe6d4');
    expect(tileInk).toBe('#1a1f1c');
  });

  it('clears 4.5:1 on the light tile and stays lighter than the letter', () => {
    if (!point || !lightTile || !tileInk) throw new Error('missing tokens');
    const ratio = contrastRatio(point, lightTile);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeCloseTo(5.6785, 3);
    expect(luminance(point)).toBeGreaterThan(luminance(tileInk));
    expect(ratio).toBeLessThan(contrastRatio(tileInk, lightTile));
  });

  it('clears 4.5:1 on the dark-theme tile', () => {
    if (!point || !darkTile || !tileInk) throw new Error('missing tokens');
    const ratio = contrastRatio(point, darkTile);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeCloseTo(5.1557, 3);
    expect(ratio).toBeLessThan(contrastRatio(tileInk, darkTile));
  });
});
