// End-to-end check in a real browser. Builds nothing: run `npm run build` first
// (or use `npm run e2e`, which does both).
//
// Plays the start of the on-path lab through the real UI, reloads to prove the
// work was saved, goes offline to prove the service worker serves the app,
// then checks replay, the lab guide, typed tool inputs, the teacher override,
// the summary page with its download, and restoring work from that download
// (plus refusing another student's file or an edited one), and opens every lab and
// its guide. Saves screenshots to ./screenshots.
//
// Needs a Chromium for Playwright: `npx playwright-core install chromium`,
// or set CHROME_PATH to any Chrome or Chromium binary.
//
// BROWSER=webkit (Safari's engine) or BROWSER=firefox runs the same check in
// that engine: `npx playwright-core install --with-deps webkit` first. WebKit
// needs Ubuntu or macOS; the GitHub workflow in .github/workflows runs it.
//
// THEME=dark runs it in the dark theme (light is the default).
// The window is a 13-inch MacBook Air (1440x800), what most students use.
// SIZE=small uses a 1366x768 laptop instead. SCALE=2 takes retina screenshots.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';
import { preview } from 'vite';

const ENGINE = process.env.BROWSER ?? 'chromium';
const THEME = process.env.THEME ?? '';
const SIZE = process.env.SIZE === 'small' ? 'small' : '';
const VIEW = {
  viewport: SIZE ? { width: 1366, height: 768 } : { width: 1440, height: 800 },
  deviceScaleFactor: Number(process.env.SCALE) || 1,
};
const OUT = join('screenshots', ...[ENGINE === 'chromium' ? '' : ENGINE, THEME, SIZE].filter(Boolean));
mkdirSync(OUT, { recursive: true });

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

async function launch() {
  if (ENGINE === 'webkit') return webkit.launch();
  if (ENGINE === 'firefox') return firefox.launch();
  try {
    return await chromium.launch();
  } catch (e) {
    const executablePath = findChrome();
    if (!executablePath) throw e;
    return chromium.launch({ executablePath });
  }
}

const server = await preview({ preview: { port: 4174, strictPort: false, open: false }, logLevel: 'warn' });
const url = server.resolvedUrls.local[0];
const browser = await launch();
const context = await browser.newContext(VIEW);
const setTheme = (ctx) => THEME && ctx.addInitScript((t) => localStorage.setItem('netlab:v1:theme', t), THEME);
await setTheme(context);
let page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let n = 0;
const shot = async (name) => {
  const file = join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  saved ${file}`);
};
const step = (text) => console.log(`- ${text}`);
const goalsDone = (count) => page.waitForFunction((c) => document.querySelectorAll('.goal.done').length >= c, count, { timeout: 30_000 });
const answer = async (option) => {
  await page.locator('.option', { hasText: option }).first().click();
  await page.getByRole('button', { name: 'Check', exact: true }).first().click();
};
const next = () => page.getByRole('button', { name: 'Continue' }).click();
const expectCount = async (selector, n, what) => {
  const got = await page.locator(selector).count();
  if (got !== n) throw new Error(`${what}: expected ${n}, found ${got}`);
};

// A teacher override password for the tests. Keep the salt in sync with src/store/override.ts.
const TEACHER_PASSWORD = 'e2e teacher password';
const TEACHER_HASH = createHash('sha256').update('netlab-teacher-override:v1:' + TEACHER_PASSWORD).digest('hex');

/**
 * A fresh browser (no service worker) with a student already signed in and
 * partway through the on-path lab, and an override password in config.json.
 */
async function seeded(progress, who = {}) {
  const ctx = await browser.newContext({ ...VIEW, serviceWorkers: 'block', acceptDownloads: true });
  await setTheme(ctx);
  await ctx.route('**/config.json', async (route) => {
    const res = await route.fetch();
    const json = { ...(await res.json()), teacherPasswordHash: TEACHER_HASH };
    await route.fulfill({ response: res, json });
  });
  const now = Date.now();
  const full = {
    labId: 'on-path',
    labVersion: 1,
    studentId: 'e2e',
    startedAt: now,
    updatedAt: now,
    activeMs: 25 * 60_000,
    stepStart: {},
    goals: {},
    answers: {},
    actions: [],
    log: [],
    ...progress,
  };
  const profile = { id: 'e2e', name: 'Riley Seeded', period: 'Period 2', createdAt: 0, ...who };
  await ctx.addInitScript(
    ({ p, profile }) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('netlab:v1:profile', JSON.stringify(profile));
      if (p) localStorage.setItem(`netlab:v1:lab:${profile.id}:on-path`, JSON.stringify(p));
    },
    { p: progress ? full : null, profile },
  );
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errors.push(String(e)));
  pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, pg };
}

try {
  step('first visit asks for a name');
  await page.goto(url);
  await page.waitForSelector('.modal');
  await shot('welcome');
  await page.fill('input[autocomplete=name]', 'Test Student');
  await expectCount('.modal select', 0, 'Class period choice with one section');
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForSelector('.lab-card');
  await shot('home');

  step('home: the Lab guide link opens the guide in a new tab');
  const [guideTab] = await Promise.all([context.waitForEvent('page'), page.click('a.lab-card-guide[href="#/guide/on-path"]')]);
  await guideTab.waitForSelector('.guide-step');
  await guideTab.close();
  if (page.url().includes('#/lab/')) throw new Error('Clicking Lab guide also opened the lab');

  step('lab step 1: inspect devices and answer');
  await page.click('.lab-card h2 >> text=Traffic in the Wrong Hands');
  await page.waitForSelector('.lesson');
  await page.goto(`${url}#/`);
  // Anywhere on the card opens the lab, not just the title.
  const box = await page.locator('.lab-card', { hasText: 'Traffic in the Wrong Hands' }).locator('p').first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector('.lesson');
  await page.getByRole('button', { name: '4×' }).click();
  await page.getByRole('button', { name: /^Alice,/ }).click({ force: true });
  await page.getByRole('button', { name: /^Mallory,/ }).click({ force: true });
  await goalsDone(2);
  await answer('Her IP address');
  await page.waitForSelector('.qcard.correct');
  await shot('lab-step1');

  step('step 1: change an answer after it was marked correct');
  await page.locator('.option', { hasText: 'Her MAC address' }).click();
  await expectCount('.qcard.correct', 0, 'Changing the answer should clear the verdict');
  await answer('Her IP address');
  await page.waitForSelector('.qcard.correct');
  await next();

  step('step 2: a normal sign-in');
  await page.getByRole('button', { name: 'Alice signs in' }).click();
  await page.waitForTimeout(1200);
  await shot('packets-in-flight');
  await goalsDone(2);
  await answer("router's MAC address");

  step('step 2: replay the step on a loop');
  await page.getByRole('button', { name: 'Repeat' }).click();
  await page.getByRole('button', { name: 'Replay step' }).click();
  await page.waitForSelector('.replay-banner');
  await page.waitForTimeout(900);
  await shot('replay');
  await page.getByRole('button', { name: 'Back to live' }).click();
  await expectCount('.replay-banner', 0, 'Replay banner after Back to live');
  await page.getByRole('button', { name: 'Repeat' }).click();
  await next();

  step('step 3: sniff the password');
  await page.locator('.tool-card .toggle').first().click();
  await page.getByRole('button', { name: 'Alice signs in' }).click();
  await goalsDone(2);
  await page.getByRole('tab', { name: /Capture/ }).click();
  await page.locator('.capture-table tr', { hasText: 'POST' }).first().click();
  await goalsDone(3);
  await page.locator('.qcard textarea').fill('pumpkinspice');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.waitForSelector('.qcard.correct');
  await shot('capture');

  step('reload: work is still there');
  await page.waitForTimeout(500); // let the debounced save land
  await page.reload();
  await page.waitForSelector('.lesson');
  const pill = await page.locator('.step-pill').innerText();
  if (!pill.includes('Step 3 of')) throw new Error(`Expected to resume on step 3, got "${pill}"`);
  if ((await page.locator('.goal.done').count()) !== 3) throw new Error('Goals were not restored after reload');
  if ((await page.locator('.qcard.correct').count()) !== 1) throw new Error('Answer was not restored after reload');
  await shot('after-reload');

  step('offline: the app still loads');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // make sure the service worker controls the page
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.lesson', { timeout: 10_000 });
  const offlinePill = await page.locator('.step-pill').innerText();
  if (!offlinePill.includes('Step 3 of')) throw new Error('Offline reload lost the student’s place');
  await shot('offline');
  await context.setOffline(false);

  step('lab guide: every step on one page');
  await page.goto(`${url}#/guide/on-path`);
  await page.waitForSelector('.guide-step');
  await expectCount('.guide-step', 12, 'Guide steps');
  await shot('guide');
  await page.emulateMedia({ media: 'print' });
  await shot('guide-print');
  await page.emulateMedia({ media: 'screen' });

  step('typed tool input: the ARP spoofer checks what the student types');
  {
    const { ctx, pg } = await seeded({ step: 6, maxStep: 6 });
    const p = page;
    page = pg;
    await page.goto(`${url}#/lab/on-path`);
    await page.waitForSelector('.tool-card');
    const ip = page.getByRole('textbox', { name: 'IP address to claim' });
    await ip.fill('10.0.0.1');
    await page.getByRole('button', { name: 'Send fake ARP reply' }).click();
    await page.waitForSelector('.tool-msg.bad');
    await shot('tool-input-error');
    await ip.fill('192.168.1.1');
    await page.getByRole('button', { name: 'Send fake ARP reply' }).click();
    await page.waitForSelector('.tool-msg.good');
    await page.getByRole('combobox', { name: 'Device to fool' }).selectOption({ label: 'Café router' });
    await ip.fill('192.168.1.10');
    await page.getByRole('button', { name: 'Send fake ARP reply' }).click();
    await goalsDone(2);
    await next();

    step('teacher override unlocks a stuck step and is flagged');
    await page.getByRole('button', { name: 'Teacher override' }).click();
    await page.fill('.modal input[type=password]', 'wrong guess');
    await page.getByRole('button', { name: 'Unlock this step' }).click();
    await page.waitForSelector('.modal .error');
    await page.fill('.modal input[type=password]', TEACHER_PASSWORD);
    await page.fill('.modal input:not([type=password])', 'Packets never arrived');
    await shot('override-dialog');
    await page.getByRole('button', { name: 'Unlock this step' }).click();
    await page.waitForSelector('.modal', { state: 'detached' });
    await page.waitForSelector('text=unlocked this step with an override');
    if (!(await page.getByRole('button', { name: 'Continue' }).isEnabled())) throw new Error('Continue should be enabled after the override');
    await page.waitForTimeout(300); // let the button finish its color change
    await shot('override-done');
    await ctx.close();
    page = p;
  }

  step('summary page: submit and download');
  {
    const answers = { 'welcome/which-changes': { value: 'ip', attempts: 1, correct: true, updatedAt: Date.now() } };
    const { ctx, pg } = await seeded({ step: 12, maxStep: 12, answers, overrides: { broken: { at: Date.now(), note: 'Packets never arrived' } }, overrideFailures: 1 });
    const p = page;
    page = pg;
    await page.goto(`${url}#/lab/on-path`);
    await page.waitForSelector('.summary-hero');
    await page.waitForTimeout(1100); // let the entrance animation finish
    await shot('summary');
    // With no server to send to, one button marks the work submitted and downloads the report to hand in.
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my report' }).click()]);
    await page.waitForSelector('text=One more step');
    const name = dl.suggestedFilename();
    // Playwright's WebKit on Linux turns spaces into underscores; browsers on Macs and PCs keep them.
    if (!/^Riley[ _]Seeded[ _]-[ _].+\.html$/.test(name)) throw new Error(`Unexpected download name "${name}"`);
    const html = readFileSync(await dl.path(), 'utf8');
    for (const must of ['Teacher override', 'Packets never arrived', 'Wrong teacher override passwords typed']) {
      if (!html.includes(must)) throw new Error(`Downloaded report is missing "${must}"`);
    }
    await page.setContent(html);
    await shot('downloaded-report');
    await ctx.close();
    page = p;

    step('restore from the report: same student on a wiped browser, then another student, then an edited file');
    const file = (text) => ({ name, mimeType: 'text/html', buffer: Buffer.from(text) });
    const workId = /Work ID (\w+)/.exec(html)?.[1];
    if (!workId) throw new Error('Report has no Work ID');
    {
      const { ctx, pg } = await seeded(null, { id: 'e2e-wiped', name: 'riley seeded' });
      page = pg;
      await page.goto(url);
      await page.waitForSelector('.restore-row');
      await page.setInputFiles('.restore-row input[type=file]', file(html));
      await page.waitForSelector('text=Open saved work?');
      await shot('restore-confirm');
      await page.getByRole('button', { name: 'Open it' }).click();
      await page.waitForSelector('.summary-hero');
      if (!(await page.locator('text=One more step').count())) throw new Error('Restored work lost its submission');
      const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download again with my latest work' }).click()]);
      const html2 = readFileSync(await dl2.path(), 'utf8');
      if (!html2.includes(`Work ID ${workId}`)) throw new Error('Restored work has a different Work ID');
      if (!html2.includes('Restored from a saved report')) throw new Error('Report does not show the restore');
      if (html2.includes('That is not the name on this report')) throw new Error('Same student was flagged as a different name');
      await ctx.close();
    }
    {
      const { ctx, pg } = await seeded(null, { id: 'e2e-sam', name: 'Sam Copier' });
      page = pg;
      await page.goto(url);
      await page.waitForSelector('.restore-row');
      await page.setInputFiles('.restore-row input[type=file]', file(html));
      await page.waitForSelector('text=belongs to a different student');
      await shot('restore-refused');
      await page.getByRole('button', { name: 'OK' }).click();
      await page.setInputFiles('.restore-row input[type=file]', file(html.split('Riley Seeded').join('Sam Copier')));
      await page.waitForSelector('text=was changed after it was saved');
      if (await page.locator('.lab-card .pill', { hasText: 'In progress' }).count()) throw new Error('A refused file still created progress');
      await ctx.close();
    }
    page = p;
  }

  step('build-network lab: drag cables on the map, unplug one, see the ping result under the button');
  {
    await page.goto(`${url}#/lab/build-network`);
    await page.waitForSelector('.lesson');
    // The device on the map, not the lesson's chip with the same name.
    const device = (name) => page.locator('g.device').filter({ has: page.locator('text.device-label', { hasText: new RegExp(`^${name}$`) }) });
    await device('Alice').click({ force: true });
    await device('Office router').click({ force: true });
    await answer('Connects the devices on one local network');
    await answer('Each port connects to a different network');
    await goalsDone(2);
    await next();
    await page.waitForSelector('.map-hint');
    const center = async (name) => {
      const b = await device(name).locator('rect.device-card').boundingBox();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const drag = async (from, to, look) => {
      const a = await center(from);
      const b = await center(to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 8 });
      if (look) await shot(look);
      await page.mouse.up();
      await page.waitForTimeout(150);
    };
    await drag('Alice', 'Office switch', 'drag-cable');
    await expectCount('.link-group', 1, 'Cables after dragging Alice to the switch');
    await drag('Alice', 'Web server');
    await page.waitForSelector('.map-notice >> text=no free port');
    // Click the cable to unplug it, then plug both computers in.
    const a = await center('Alice');
    const sw = await center('Office switch');
    await page.mouse.click((a.x + sw.x) / 2, (a.y + sw.y) / 2);
    await page.getByRole('dialog', { name: 'Cable' }).getByRole('button', { name: 'Unplug' }).click();
    await expectCount('.link-group', 0, 'Cables after unplugging');
    await drag('Alice', 'Office switch');
    await drag('Ben', 'Office switch');
    await expectCount('.link-group', 2, 'Cables after plugging in both computers');
    await page.getByRole('button', { name: 'Alice pings Ben' }).click();
    await page.waitForSelector('.action-outcome li.bad >> text=no IP address');
    await goalsDone(3);
    // The goals unlock a question about this result: the panel moves down, but keeps the result in view.
    await page.waitForTimeout(900);
    const seen = await page.evaluate(() => {
      const box = document.querySelector('.lesson-scroll');
      const r = document.querySelector('.action-outcome').getBoundingClientRect();
      const v = box.getBoundingClientRect();
      return r.top >= v.top - 1 && r.bottom <= v.bottom + 1;
    });
    if (!seen) throw new Error('The ping result scrolled out of view when the question unlocked');
    await shot('build-network-cables');
  }

  step('every lab and its guide open, and every side tab renders');
  {
    await page.goto(`${url}#/`);
    await page.waitForSelector('.lab-card');
    const ids = await page.$$eval('.lab-card.open a.lab-card-link', (as) => as.map((a) => a.getAttribute('href').replace('#/lab/', '')));
    if (ids.length < 3) throw new Error(`Expected at least 3 open labs on the home page, found ${ids.length}`);
    for (const id of ids) {
      await page.goto(`${url}#/guide/${id}`);
      await page.waitForSelector('.guide-head');
      await page.goto(`${url}#/lab/${id}`);
      await page.waitForSelector('.lesson');
      for (const tab of await page.getByRole('tab').all()) {
        await tab.click();
        await page.waitForTimeout(100);
      }
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (wide) throw new Error(`The ${id} lab scrolls sideways`);
      await shot(`lab-${id}`);
    }
  }

  step('route hijack lab opens');
  await page.goto(`${url}#/lab/route-hijack`);
  await page.waitForSelector('.lesson');
  await page.getByRole('button', { name: /^HomeNet ISP,/ }).click({ force: true });
  await page.waitForTimeout(400);
  await shot('route-hijack');

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`);
  console.log('\nEnd-to-end check passed.');
} catch (e) {
  await shot('failure').catch(() => {});
  console.error('\nEnd-to-end check FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
