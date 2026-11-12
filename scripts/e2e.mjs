// End-to-end check in a real browser. Builds nothing: run `npm run build` first
// (or use `npm run e2e`, which does both).
//
// Plays the start of the on-path lab through the real UI, reloads to prove the
// work was saved, goes offline to prove the service worker serves the app,
// then checks replay, the lab guide, typed tool inputs, the step override,
// the summary page with its download, and restoring work from that download
// (plus refusing another student's file or an edited one), and opens every lab and
// its guide. Also checks the courses: picking a class at sign-in, the class menu
// under the student's name, and old #/lab/<id> addresses. Saves screenshots to
// ./screenshots.
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
/** The address after the #, once the app has settled on it. */
const expectHash = async (hash, what) => {
  await page.waitForFunction((h) => location.hash === h, hash, { timeout: 5_000 }).catch(() => {});
  const got = await page.evaluate(() => location.hash);
  if (got !== hash) throw new Error(`${what}: expected ${hash}, got ${got || '(none)'}`);
};
const savedProfile = () => page.evaluate(() => JSON.parse(localStorage.getItem('netlab:v1:profile')));
const COURSES = ['Intro to Computer Science', 'AP Computer Science Principles', 'AP Computer Science A', 'AP Cybersecurity'];

/**
 * A fresh browser (no service worker) with a student already signed in and
 * partway through the on-path lab.
 */
async function seeded(progress, who = {}) {
  const ctx = await browser.newContext({ ...VIEW, serviceWorkers: 'block', acceptDownloads: true });
  await setTheme(ctx);
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
  step('first visit asks for a name and a class');
  await page.goto(url);
  await page.waitForSelector('.modal');
  const offered = await page.locator('.modal .class-option').allInnerTexts();
  if (offered.join('|') !== COURSES.join('|')) throw new Error(`Class choices: ${offered.join(', ')}`);
  await page.fill('input[autocomplete=name]', 'Test Student');
  if (await page.getByRole('button', { name: 'Start' }).isEnabled()) throw new Error('Start should wait for a class');
  await shot('welcome');
  await expectCount('.modal select', 0, 'Class period choice with one section');
  await page.getByRole('radio', { name: 'AP Cybersecurity' }).check();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForSelector('.lab-card');
  await expectHash('#/cyber', 'Home after choosing AP Cybersecurity');
  if ((await page.locator('.topbar .tb-lab').innerText()) !== 'AP Cybersecurity') throw new Error('Home top bar should name the course');
  await shot('home');

  step('home: the Lab guide link opens the guide in a new tab');
  const [guideTab] = await Promise.all([context.waitForEvent('page'), page.click('a.lab-card-guide[href="#/cyber/guide/on-path"]')]);
  await guideTab.waitForSelector('.guide-step');
  await guideTab.close();
  if (page.url().includes('/lab/')) throw new Error('Clicking Lab guide also opened the lab');

  step('lab step 1: inspect devices and answer');
  await page.click('.lab-card h2 >> text=Traffic in the Wrong Hands');
  await page.waitForSelector('.lesson');
  await expectHash('#/cyber/lab/on-path', 'Lab address');
  if ((await page.locator('.topbar a.brand').getAttribute('href')) !== '#/cyber') throw new Error('The lab’s NetLab link should go to its course home');
  await page.goto(`${url}#/`);
  await expectHash('#/cyber', '#/ for an AP Cybersecurity student');
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

  step('lab guide: every step on one page (from its old address)');
  await page.goto(`${url}#/guide/on-path`);
  await page.waitForSelector('.guide-step');
  await expectHash('#/cyber/guide/on-path', 'Old guide address');
  await page.locator('.guide-bar a', { hasText: 'Open the lab' }).click();
  await page.waitForSelector('.lesson');
  await expectHash('#/cyber/lab/on-path', 'Guide’s Open the lab link');
  await page.goto(`${url}#/cyber/guide/on-path`);
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
    // An old address: redirects to the lab's course.
    await page.goto(`${url}#/lab/on-path`);
    await page.waitForSelector('.tool-card');
    await expectHash('#/cyber/lab/on-path', 'Old lab address');
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

    step('spamming Continue on an unfinished step offers the override, and the step is flagged');
    const stuck = await page.locator('.lesson-nav .btn.primary').boundingBox();
    const [x, y] = [stuck.x + stuck.width / 2, stuck.y + stuck.height / 2];
    for (let i = 0; i < 6; i++) await page.mouse.click(x, y);
    if (await page.locator('.modal').count()) throw new Error('The override should wait for the seventh click');
    await page.mouse.click(x, y);
    await page.waitForSelector('.modal');
    // Clicks that land after it opens don't close or confirm it.
    for (let i = 0; i < 5; i++) await page.mouse.click(x, y);
    const skip = page.getByRole('button', { name: 'Override and skip' });
    if (await skip.isEnabled()) throw new Error('The override needs a reason');
    await page.fill('.modal input', 'Packets never arrived');
    await shot('override-dialog');
    await skip.click();
    await page.waitForSelector('.modal', { state: 'detached' });
    await page.getByRole('button', { name: 'Back' }).click();
    await page.waitForSelector('text=skipped this step with an override');
    if (!(await page.getByRole('button', { name: 'Continue' }).isEnabled())) throw new Error('Continue should be enabled after the override');
    await page.waitForTimeout(300); // let the button finish its color change
    await shot('override-done');
    await ctx.close();
    page = p;
  }

  step('summary page: submit and download');
  {
    const answers = { 'welcome/which-changes': { value: 'ip', attempts: 1, correct: true, updatedAt: Date.now() } };
    const { ctx, pg } = await seeded({ step: 12, maxStep: 12, answers, overrides: { broken: { at: Date.now(), note: 'Packets never arrived' } } });
    const p = page;
    page = pg;
    await page.goto(`${url}#/cyber/lab/on-path`);
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
    for (const must of ['Did not complete (override)', 'Reason: Packets never arrived', 'Riley Seeded</span> &middot; Period 2 &middot; AP Cybersecurity', 'Check code <b id="netlab-check">']) {
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

    step('teacher page: check report files for edits');
    {
      await page.goto(`${url}#/teacher`);
      await page.waitForSelector('.check-drop');
      const score = /<div class="stat score"><b>(\d+) \/ (\d+)<\/b>/.exec(html);
      if (!score) throw new Error('Report has no auto-checked score');
      const perfect = html.replace(score[0], `<div class="stat score"><b>${score[2]} / ${score[2]}</b>`);
      const files = [
        { ...file(html), name: 'honest.html' },
        { ...file(perfect), name: 'perfect.html' },
        { name: 'notes.html', mimeType: 'text/html', buffer: Buffer.from('<p>hello</p>') },
      ];
      await page.setInputFiles('.check-drop input[type=file]', files);
      await page.waitForSelector('.check-table tbody tr >> nth=2');
      const rows = await page.$$eval('.check-table tbody tr', (trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())));
      const byFile = Object.fromEntries(rows.map((r) => [r[1], r]));
      const want = {
        'honest.html': ['Not edited', 'Riley Seeded', `${score[1]} / ${score[2]}`],
        'perfect.html': ['Edited after download', 'Riley Seeded', `${score[2]} / ${score[2]}`],
        'notes.html': ['Not a NetLab report', '', ''],
      };
      for (const [name, [verdict, who, pts]] of Object.entries(want)) {
        const r = byFile[name];
        if (!r || r[0] !== verdict || r[2] !== who || r[4] !== pts) throw new Error(`Checker row for ${name}: expected ${verdict}, ${who}, ${pts}; got ${JSON.stringify(r)}`);
      }
      await page.waitForSelector('text=1 of 3 files were edited after download.');
      await shot('report-check');
    }
  }

  step('build-network lab: drag cables on the map, unplug one, see the ping result under the button');
  {
    await page.goto(`${url}#/cyber/lab/build-network`);
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
    const ids = await page.$$eval('.lab-card.open a.lab-card-link', (as) => as.map((a) => a.getAttribute('href').replace('#/cyber/lab/', '')));
    if (ids.length < 3) throw new Error(`Expected at least 3 open labs on the home page, found ${ids.length}`);
    for (const id of ids) {
      await page.goto(`${url}#/cyber/guide/${id}`);
      await page.waitForSelector('.guide-head');
      await page.goto(`${url}#/cyber/lab/${id}`);
      // An answer sheet (LabDef.worksheet) has no lesson panel: the questions fill the page.
      await page.waitForSelector('.lesson, .worksheet');
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
  await page.goto(`${url}#/cyber/lab/route-hijack`);
  await page.waitForSelector('.lesson');
  await page.getByRole('button', { name: /^HomeNet ISP,/ }).click({ force: true });
  await page.waitForTimeout(400);
  await shot('route-hijack');

  step('courses: a new student who follows a link to #/csp has AP CSP picked, and stays there');
  {
    const ctx = await browser.newContext({ ...VIEW, serviceWorkers: 'block' });
    await setTheme(ctx);
    const p = page;
    page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${url}#/csp`);
    await page.waitForSelector('.modal');
    if (!(await page.getByRole('radio', { name: 'AP Computer Science Principles' }).isChecked())) throw new Error('#/csp should pick AP CSP for a new student');
    await page.fill('input[autocomplete=name]', 'Casey New');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForSelector('.home-main h1');
    await expectHash('#/csp', 'Home after signing in on #/csp');
    if ((await page.locator('.topbar .tb-lab').innerText()) !== 'AP Computer Science Principles') throw new Error('CSP home top bar');
    await expectCount('.footnote', 0, 'Cybersecurity footnote on the CSP home');
    if ((await savedProfile()).curriculum !== 'csp') throw new Error('Class was not saved with the profile');
    await shot('csp-home');
    await page.reload();
    await page.waitForSelector('.home-main h1');
    await expectCount('.modal', 0, 'Sign-in dialog after a reload');
    await expectHash('#/csp', 'CSP home after a reload');
    await page.goto(`${url}#/`);
    await expectHash('#/csp', '#/ for a CSP student');

    step('courses: the class menu opens from the keyboard, closes on Escape, and switches classes');
    const chip = page.locator('.student-chip');
    await chip.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.menu[role=menu]');
    const listed = await page.getByRole('menuitemradio').allInnerTexts();
    if (listed.map((t) => t.trim()).join('|') !== COURSES.join('|')) throw new Error(`Class menu lists: ${listed.join(', ')}`);
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
    if (focused !== 'AP Computer Science Principles') throw new Error(`Menu should open on the student's class, focused "${focused}"`);
    await shot('class-menu');
    await page.keyboard.press('Escape');
    await expectCount('.menu', 0, 'Menu after Escape');
    if (!(await page.evaluate(() => document.activeElement?.classList.contains('student-chip')))) throw new Error('Escape should return focus to the name');
    await page.keyboard.press('ArrowDown');
    await page.waitForSelector('.menu[role=menu]');
    await page.keyboard.press('ArrowUp'); // from AP CSP up to Intro CS
    const up = await page.evaluate(() => document.activeElement?.textContent?.trim());
    if (up !== 'Intro to Computer Science') throw new Error(`ArrowUp moved to "${up}"`);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.home-main h1');
    await expectHash('#/intro', 'After switching to Intro CS');
    await expectCount('.menu', 0, 'Menu after choosing a class');
    if ((await savedProfile()).curriculum !== 'intro') throw new Error('Switching class did not save it');
    // A course with nothing in it yet says so.
    if (!(await page.locator('.lab-card').count())) await expectCount('.home-empty', 1, 'Coming-soon note on an empty course');
    await page.reload();
    await page.goto(`${url}#/`);
    await expectHash('#/intro', '#/ after switching to Intro CS and reloading');
    // Click outside closes it.
    await chip.click();
    await page.waitForSelector('.menu');
    await page.mouse.click(40, 400);
    await expectCount('.menu', 0, 'Menu after clicking outside');

    step('courses: Change name keeps the class; a different student starts with that class picked');
    await chip.click();
    await page.getByRole('menuitem', { name: 'Change name' }).click();
    await page.waitForSelector('.modal');
    await expectCount('.modal .class-option', 0, 'Class choices in Change name');
    await page.fill('input[autocomplete=name]', 'Casey Renamed');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    if ((await chip.innerText()).trim() !== 'Casey Renamed') throw new Error('Name chip did not update');
    if ((await savedProfile()).curriculum !== 'intro') throw new Error('Change name lost the class');
    page.once('dialog', (d) => d.accept());
    await chip.click();
    await page.getByRole('menuitem', { name: "I'm a different student" }).click();
    await page.waitForSelector('.modal');
    if (!(await page.getByRole('radio', { name: 'Intro to Computer Science' }).isChecked())) throw new Error('A different student should start with the same class picked');
    await ctx.close();
    page = p;
  }

  step('courses: on a phone, tap the name to switch classes, tap outside to close');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
    await setTheme(ctx);
    await ctx.addInitScript(() => {
      if (!localStorage.getItem('netlab:v1:profile'))
        localStorage.setItem('netlab:v1:profile', JSON.stringify({ id: 'e2e-phone', name: 'Pat Phone', period: '', createdAt: 0, curriculum: 'csp' }));
    });
    const p = page;
    page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url);
    await page.waitForSelector('.home-main h1');
    await expectHash('#/csp', 'Phone home');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (wide) throw new Error('The phone home page scrolls sideways');
    await page.tap('.student-chip');
    await page.waitForSelector('.menu');
    await page.tap('.menu-item >> text=AP Computer Science A');
    await expectHash('#/csa', 'After tapping AP CSA');
    await expectCount('.menu', 0, 'Menu after tapping a class');
    await page.tap('.student-chip');
    await page.waitForSelector('.menu');
    await page.touchscreen.tap(20, 800); // below the open menu
    await expectCount('.menu', 0, 'Menu after tapping outside');
    if ((await savedProfile()).curriculum !== 'csa') throw new Error('Tapped class was not saved');
    await ctx.close();
    page = p;
  }

  step('courses: a student from before courses lands back in their lab, with no questions');
  {
    const { ctx, pg } = await seeded({ step: 2, maxStep: 2 }, { name: 'Jordan Returning', period: '' });
    await ctx.addInitScript(() => {
      if (!sessionStorage.getItem('last-seeded')) localStorage.setItem('netlab:v1:last-route', '#/lab/on-path');
      sessionStorage.setItem('last-seeded', '1');
    });
    const p = page;
    page = pg;
    await page.goto(url);
    await page.waitForSelector('.lesson');
    await expectHash('#/cyber/lab/on-path', 'Restored last lab');
    await expectCount('.modal', 0, 'Sign-in dialog for a returning student');
    if ((await savedProfile()).curriculum !== 'cyber') throw new Error('Returning student should be in AP Cybersecurity');
    await page.goto(`${url}#/`);
    await expectHash('#/cyber', '#/ for a returning student');
    await ctx.close();
    page = p;
  }

  step('page lab: the preview draws the page, takes a click, and keeps links and inline handlers inert');
  {
    const ctx = await browser.newContext({ ...VIEW, serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      if (window !== window.top) return; // the preview frame has no storage
      localStorage.setItem('netlab:v1:profile', JSON.stringify({ id: 'e2e', name: 'Pat Page', period: '1', createdAt: 0, curriculum: 'intro' }));
    });
    const p = page;
    page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${url}#/lab/js-dom`);
    await page.waitForSelector('.lesson');
    const stage = page.locator('[data-demo="hello"]');
    await stage.locator('.java-tab', { hasText: 'script.js' }).click();
    await stage.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(`let title = document.getElementById("title");
let count = 0;
title.addEventListener("click", function () {
  count = count + 1;
  title.textContent = "clicks " + count;
});
document.getElementById("tagline").innerHTML = '<a id="go" href="https://example.com/">go</a> <b id="in" onclick="document.body.dataset.ran = 1">in</b>';
`);
    await page.waitForTimeout(400);
    await stage.getByRole('button', { name: 'Run', exact: true }).click();
    const frame = stage.locator('[data-preview]').frameLocator('iframe');
    await frame.locator('#go').click();
    await frame.locator('#in').click();
    if ((await frame.locator('body').getAttribute('data-ran')) !== null) throw new Error('An inline handler ran in the preview');
    await frame.locator('#title').click();
    await frame.locator('#title', { hasText: 'clicks 1' }).waitFor({ timeout: 5_000 });
    await frame.locator('#title').click();
    await frame.locator('#title', { hasText: 'clicks 2' }).waitFor({ timeout: 5_000 });
    await ctx.close();
    page = p;
  }

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
