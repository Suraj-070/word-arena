import { expect, test, type Locator, type Page } from '@playwright/test';
import { contrastRatio, luminance } from '../apps/web/src/styles/contrast';

const viewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
  { width: 320, height: 568 },
] as const;

async function openApp(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  if (!value) throw new Error('missing box');
  return value;
}

test('theme switch changes the surfaces', async ({ page }) => {
  await openApp(page);
  const header = page.locator('.header');
  const before = await header.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(before).toBe('rgb(243, 239, 230)');

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const after = await header.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(after).toBe('rgb(18, 22, 20)');
  await expect(page.locator('.table')).toHaveCSS('background-color', 'rgb(14, 20, 18)');
});

test('theme persists after refresh', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('word-arena-theme')))
    .toBe('dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
});

test('keyboard focus reaches a board square', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);

  let reached = false;
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press('Tab');
    const role = await page.evaluate(() => document.activeElement?.getAttribute('role'));
    if (role === 'gridcell') {
      reached = true;
      break;
    }
  }

  expect(reached).toBe(true);
  await expect(page.locator(':focus')).toHaveAttribute('aria-label', 'Empty square, row 1, column 1');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(':focus')).toHaveAttribute('aria-colindex', '2');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(':focus')).toHaveAttribute('aria-rowindex', '2');
});

test('desktop and mobile layouts have no horizontal overflow', async ({ page }) => {
  await openApp(page);

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${viewport.width}px`).toBeLessThanOrEqual(1);

    const header = await box(page.locator('.header'));
    const scroll = await box(page.locator('.board-scroll'));
    const rack = await box(page.locator('.rack'));
    const square = await box(page.getByRole('gridcell').first());
    const rackTile = await box(page.locator('.rack [data-tile]').first());

    expect(header.x).toBeGreaterThanOrEqual(-1);
    expect(header.x + header.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(scroll.x).toBeGreaterThanOrEqual(-1);
    expect(scroll.x + scroll.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(rack.x).toBeGreaterThanOrEqual(-1);
    expect(rack.x + rack.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(rack.y + rack.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(square.x).toBeGreaterThanOrEqual(-1);
    expect(square.x).toBeLessThan(viewport.width);
    expect(Math.abs(square.width - square.height)).toBeLessThan(1.5);
    expect(Math.abs(square.width - rackTile.width)).toBeLessThan(1.5);
    expect(square.width).toBeGreaterThanOrEqual(31);

    const boardScroll = await page.locator('.board-scroll').evaluate((element) => element.scrollWidth - element.clientWidth);
    const hint = page.locator('.board-scroll-hint');
    if (viewport.width <= 375) {
      expect(boardScroll, `${viewport.width}px board scroll`).toBeGreaterThan(20);
      expect(square.width).toBeLessThanOrEqual(36);
      await expect(hint, `${viewport.width}px scroll hint`).toBeVisible();
      await expect(hint).toHaveAttribute('data-at-start', 'true');
      await expect(hint).toHaveAttribute('data-at-end', 'false');
    } else {
      expect(boardScroll, `${viewport.width}px board scroll`).toBeLessThanOrEqual(2);
      await expect(hint, `${viewport.width}px scroll hint`).toBeHidden();
    }
  }
});

test('point text clears 4.5:1 on the tile in both themes', async ({ page }) => {
  await openApp(page);

  const light = await pointContrast(page);
  expect(light.ratio, `light ${light.ratio.toFixed(3)} ${light.color} on ${light.background}`).toBeGreaterThanOrEqual(4.5);
  expect(light.pointLuminance).toBeGreaterThan(light.inkLuminance);
  expect(light.ratio).toBeLessThan(light.letterRatio);

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  const dark = await pointContrast(page);
  expect(dark.ratio, `dark ${dark.ratio.toFixed(3)} ${dark.color} on ${dark.background}`).toBeGreaterThanOrEqual(4.5);
  expect(dark.pointLuminance).toBeGreaterThan(dark.inkLuminance);
  expect(dark.ratio).toBeLessThan(dark.letterRatio);
});

test('the scroll hint tracks horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openApp(page);

  const hint = page.locator('.board-scroll-hint');
  const thumb = page.locator('.board-scroll-thumb');
  const scroller = page.locator('.board-scroll');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveAttribute('data-at-start', 'true');
  await expect(hint).toHaveAttribute('data-at-end', 'false');

  const start = await thumb.boundingBox();
  expect(start).not.toBeNull();
  await scroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth - element.clientWidth;
  });
  await expect(hint).toHaveAttribute('data-at-end', 'true');
  await expect(hint).toHaveAttribute('data-at-start', 'false');
  const end = await thumb.boundingBox();
  expect(end).not.toBeNull();
  if (!start || !end) throw new Error('missing thumb');
  expect(end.x).toBeGreaterThan(start.x + 8);

  await scroller.evaluate((element) => {
    element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
  });
  await expect(hint).toHaveAttribute('data-at-start', 'false');
  await expect(hint).toHaveAttribute('data-at-end', 'false');

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(hint).toBeHidden();
  const wideOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(wideOverflow).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 320, height: 568 });
  await expect(hint).toBeVisible();
  await expect(hint).toHaveAttribute('data-scroll-hint', 'visible');
  const narrowOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(narrowOverflow).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(hint).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(hint).toBeHidden();
});

test('keyboard focus stays visible beside the scroll hint', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openApp(page);

  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press('Tab');
    const role = await page.evaluate(() => document.activeElement?.getAttribute('role'));
    if (role === 'gridcell') break;
  }

  const square = page.locator(':focus');
  await expect(square).toHaveAttribute('aria-label', 'Empty square, row 1, column 1');
  const shadow = await square.evaluate((element) => getComputedStyle(element).boxShadow);
  expect(shadow).toContain('inset');

  const squareBox = await square.boundingBox();
  const hintBox = await page.locator('.board-scroll-hint').boundingBox();
  expect(squareBox).not.toBeNull();
  expect(hintBox).not.toBeNull();
  if (!squareBox || !hintBox) throw new Error('missing boxes');
  const overlaps = squareBox.y < hintBox.y + hintBox.height && squareBox.y + squareBox.height > hintBox.y;
  expect(overlaps).toBe(false);

  await page.keyboard.press('ArrowRight');
  await expect(page.locator(':focus')).toHaveAttribute('aria-colindex', '2');
});

async function pointContrast(page: Page) {
  const colors = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.className = 'text-point bg-tile';
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const color = style.color;
    const background = style.backgroundColor;
    probe.className = 'text-tile-ink bg-tile';
    const ink = getComputedStyle(probe).color;
    probe.remove();
    return { color, background, ink };
  });

  return {
    ...colors,
    ratio: contrastRatio(colors.color, colors.background),
    pointLuminance: luminance(colors.color),
    inkLuminance: luminance(colors.ink),
    letterRatio: contrastRatio(colors.ink, colors.background),
  };
}

test('reduced motion is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);

  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
  const lift = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wa-duration-lift').trim());
  expect(lift).toBe('0ms');
  const duration = await page.locator('.square').first().evaluate((element) => getComputedStyle(element).transitionDuration);
  const milliseconds = duration.endsWith('ms') ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1000;
  expect(milliseconds).toBeLessThan(1);

  const hintMotion = await page.locator('.board-scroll-thumb').evaluate((element) => {
    const style = getComputedStyle(element);
    const raw = style.transitionDuration;
    const value = raw.endsWith('ms') ? Number.parseFloat(raw) : Number.parseFloat(raw) * 1000;
    return { animationName: style.animationName, milliseconds: value };
  });
  expect(hintMotion.animationName).toBe('none');
  expect(hintMotion.milliseconds).toBeLessThan(1);
});

test('online play stays unsigned-in until a project is connected', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await page.getByRole('link', { name: 'Online' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText(/not connected to a Supabase project/)).toBeVisible();
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill('long-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText(/not connected/);
  await expect(page.getByRole('button', { name: 'Create private room' })).toHaveCount(0);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${viewport.width}px`).toBeLessThanOrEqual(1);
  }
});

test('a local match can place a tile and cannot submit without a dictionary', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);

  await expect(page.getByText(/No dictionary is configured/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit' })).toBeDisabled();
  await expect(page.locator('.match-status')).toContainText('Player 1 to move');

  const tile = page.locator('.rack [data-tile][data-occupied="true"]').first();
  await tile.click();
  await expect(tile).toHaveAttribute('data-selected', 'true');
  await page.getByRole('gridcell', { name: 'Empty square, row 8, column 8' }).click();
  await expect(page.getByRole('gridcell', { name: /row 8, column 8, not submitted/ })).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('gridcell', { name: 'Empty square, row 8, column 8' })).toBeVisible();

  await page.getByRole('button', { name: 'Pass' }).click();
  await expect(page.locator('.match-status')).toContainText('Player 2 to move');
});

test('motion tokens are used when motion is allowed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openApp(page);

  const duration = await page.locator('.square').first().evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(duration).toBe('0.16s');
});
