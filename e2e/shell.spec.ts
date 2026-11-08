import { expect, test, type Locator, type Page } from '@playwright/test';

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
    if (viewport.width <= 375) {
      expect(boardScroll, `${viewport.width}px board scroll`).toBeGreaterThan(20);
      expect(square.width).toBeLessThanOrEqual(36);
    } else {
      expect(boardScroll, `${viewport.width}px board scroll`).toBeLessThanOrEqual(2);
    }
  }
});

test('reduced motion is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);

  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
  const lift = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wa-duration-lift').trim());
  expect(lift).toBe('0ms');
  const duration = await page.locator('.square').first().evaluate((element) => getComputedStyle(element).transitionDuration);
  const milliseconds = duration.endsWith('ms') ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1000;
  expect(milliseconds).toBeLessThan(1);
});

test('motion tokens are used when motion is allowed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openApp(page);

  const duration = await page.locator('.square').first().evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(duration).toBe('0.16s');
});
