// Screenshots of the main screens in both themes, for checking colors by eye.
//
//   node scripts/theme-shots.mjs              # both themes
//   node scripts/theme-shots.mjs light        # one theme
//   SIZE=small node scripts/theme-shots.mjs   # 1366x768 laptop at 1x
//   SCALE=1 node scripts/theme-shots.mjs      # override the pixel density
//
// Starts the Vite dev server (no build needed) and drives the app in headless
// Chromium. The default size is a maximized browser on a 13-inch MacBook Air:
// 1440x800 at 2x (retina), written to screenshots/theme/. SIZE=small is a
// 1366x768 Windows, Linux or Chromebook laptop at 1x, written to
// screenshots/theme/small/.
//
// Also checks that the theme toggle switches themes and that the choice survives
// a reload. Needs a Chromium for Playwright (see scripts/e2e.mjs) or CHROME_PATH.

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const SIZES = {
  default: { width: 1440, height: 800, scale: 2 }, // 13" MacBook Air, maximized
  small: { width: 1366, height: 768, scale: 1 }, // common 1366x768 laptop
};
const SIZE_NAME = process.env.SIZE ?? 'default';
const SIZE = SIZES[SIZE_NAME];
if (!SIZE) throw new Error(`SIZE must be one of: ${Object.keys(SIZES).join(', ')}`);
const OUT = join('screenshots', 'theme', ...(SIZE_NAME === 'default' ? [] : [SIZE_NAME]));
mkdirSync(OUT, { recursive: true });
const THEME_KEY = 'netlab:v1:theme';
const themes = process.argv[2] ? [process.argv[2]] : ['dark', 'light'];

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
      const p = join(root, d, sub);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const server = await createServer({ server: { port: 5181, strictPort: false, open: false }, logLevel: 'warn' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: findChrome() });
const problems = [];

async function run(theme) {
  console.log(`\n== ${theme} theme, ${SIZE.width}x${SIZE.height} ==`);
  const context = await browser.newContext({
    viewport: { width: SIZE.width, height: SIZE.height },
    deviceScaleFactor: Number(process.env.SCALE) || SIZE.scale,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`[${theme}] ${e}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`[${theme}] ${m.text()}`));

  let n = 0;
  const shot = async (name) => {
    const file = join(OUT, `${theme}-${String(++n).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file });
    console.log(`  saved ${file}`);
  };
  // One failed step should not cost the remaining screenshots.
  const attempt = async (label, fn) => {
    try {
      await fn();
    } catch (e) {
      problems.push(`[${theme}] ${label}: ${e.message.split('\n')[0]}`);
      console.log(`  ! ${label} failed`);
      await shot(`${label}-failed`).catch(() => {});
    }
  };
  const goalsDone = (c) => page.waitForFunction((k) => document.querySelectorAll('.goal.done').length >= k, c, { timeout: 30_000 });
  const answer = async (option) => {
    await page.locator('.option', { hasText: option }).first().click();
    await page.getByRole('button', { name: 'Check', exact: true }).first().click();
  };
  const next = () => page.getByRole('button', { name: 'Continue' }).click();
  const tab = (name) => page.getByRole('tab', { name }).click();

  await page.goto(url);
  if (theme !== 'light') {
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [THEME_KEY, theme]);
    await page.reload();
  }
  const actual = await page.evaluate(() => document.documentElement.dataset.theme);
  if (actual !== theme) problems.push(`[${theme}] <html data-theme> is "${actual}" on first load`);

  await attempt('welcome', async () => {
    await page.waitForSelector('.modal');
    await shot('welcome');
    await page.fill('input[autocomplete=name]', 'Test Student');
    const sel = page.locator('.modal select');
    if (await sel.count()) await sel.selectOption({ index: 3 });
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForSelector('.lab-card');
    await page.mouse.move(5, 760);
    await shot('home');
  });

  await attempt('lab-step1', async () => {
    await page.click('a[href="#/lab/on-path"]');
    await page.waitForSelector('.lesson');
    await page.waitForTimeout(400);
    await shot('lab-step1');
    await page.getByRole('button', { name: /^Alice,/ }).click({ force: true });
    await page.getByRole('button', { name: /^Mallory,/ }).click({ force: true });
    await goalsDone(2);
    await answer('Her IP address');
    await page.waitForSelector('.qcard.correct');
    await page.waitForTimeout(400); // let the Continue button finish its color transition
    await shot('step1-answered');
    await next();
  });

  await attempt('packets', async () => {
    await page.getByRole('button', { name: 'Alice signs in' }).click();
    await page.waitForTimeout(700);
    await shot('packets-in-flight');
    await page.waitForTimeout(1300);
    await shot('packets-later');
    await goalsDone(2);
    await page.waitForTimeout(800);
    await shot('browser-popup');
    await page.locator('.net-wrap').screenshot({ path: join(OUT, `${theme}-${String(++n).padStart(2, '0')}-map-detail.png`) });
  });

  await attempt('wrong-answer', async () => {
    const hint = page.locator('.hint summary').first();
    if (await hint.isVisible().catch(() => false)) await hint.click();
    await answer('asking permission');
    await page.waitForSelector('.qcard.wrong');
    await page.waitForTimeout(300);
    await shot('wrong-answer-hint');
  });

  await attempt('capture', async () => {
    await answer("router's MAC address");
    await next();
    await page.locator('.tool-card .toggle').first().click();
    await page.getByRole('button', { name: 'Alice signs in' }).click();
    await goalsDone(2);
    await tab(/Capture/);
    await page.locator('.capture-table tr', { hasText: 'POST' }).first().click();
    await page.waitForTimeout(300);
    await shot('capture');
    await page.locator('.net-wrap').screenshot({ path: join(OUT, `${theme}-${String(++n).padStart(2, '0')}-map-sniffing.png`) });
  });

  await attempt('step-menu', async () => {
    await page.locator('.step-pill').click();
    await page.waitForTimeout(200);
    await shot('step-menu');
    await page.locator('.step-pill').click();
  });

  await attempt('toolkit', async () => {
    await tab(/Toolkit/);
    await page.waitForTimeout(200);
    await shot('toolkit');
  });

  await attempt('inspect', async () => {
    await page.getByRole('button', { name: /^Mallory,/ }).click({ force: true });
    await tab(/Inspect/);
    await page.getByRole('button', { name: 'Packet colors' }).click();
    await page.waitForTimeout(200);
    await shot('inspect-legend');
    await page.getByRole('button', { name: 'Packet colors' }).click();
  });

  await attempt('route-hijack', async () => {
    await page.goto(`${url}#/lab/route-hijack`);
    await page.waitForSelector('.lesson');
    await page.getByRole('button', { name: /^HomeNet ISP,/ }).click({ force: true });
    await page.waitForTimeout(400);
    await shot('route-hijack');
  });

  await attempt('toggle', async () => {
    const other = theme === 'dark' ? 'light' : 'dark';
    await page.locator('.theme-toggle').first().click();
    const now = await page.evaluate(() => document.documentElement.dataset.theme);
    const saved = await page.evaluate((k) => localStorage.getItem(k), THEME_KEY);
    if (now !== other || saved !== other) throw new Error(`toggle gave data-theme="${now}", saved="${saved}"`);
    await page.reload();
    await page.waitForSelector('.lesson');
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    if (after !== other) throw new Error(`after reload data-theme="${after}"`);
    console.log(`  toggle ok: ${theme} -> ${other}, kept after reload`);
  });

  await context.close();
}

try {
  for (const t of themes) await run(t);
} finally {
  await browser.close();
  await server.close();
}

if (problems.length) {
  console.error(`\nProblems:\n${problems.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('\nTheme screenshots done.');
}
