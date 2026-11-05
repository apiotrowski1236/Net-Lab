// Plays every lab's answer key, then checks each step in a real browser.
//
// The walkthrough test proves each answer key completes every step in Node.
// This proves the app shows it: it plays each lab's solution.ts in Node (via
// Vite, so TypeScript and import.meta.glob work), loads the saved progress
// into the built app, and pages through every step with the Continue button.
// On every step it checks that each goal shows as done, that Continue is
// ready, that nothing scrolls sideways, and that the page logs no errors.
// So it also proves the recorded actions replay to the same network in the
// browser. Saves one screenshot per step to ./screenshots/playthrough.
//
// Run `npm run build` first, or use `npm run playthrough`, which does both.
// LAB=firewall checks one lab. THEME=light and SIZE=small work as in e2e.mjs.
// Needs a Chromium for Playwright, found the same way as e2e.mjs.

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer, preview } from 'vite';

const THEME = process.env.THEME ?? '';
const SIZE = process.env.SIZE === 'small';
const ONLY = process.env.LAB ?? '';
const VIEW = { viewport: SIZE ? { width: 1366, height: 768 } : { width: 1440, height: 800 } };
const OUT = join('screenshots', 'playthrough', ...[THEME, SIZE ? 'small' : ''].filter(Boolean));
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

// --- 1. Play every answer key in Node -------------------------------------

class MemoryStorage {
  m = new Map();
  get length() {
    return this.m.size;
  }
  key(i) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k) {
    return this.m.get(k) ?? null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
globalThis.localStorage = new MemoryStorage();

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'warn' });
const { LABS } = await vite.ssrLoadModule('/src/labs/index.ts');
const { labHref } = await vite.ssrLoadModule('/src/routes.ts');
const { LabSession } = await vite.ssrLoadModule('/src/runtime/session.ts');
const { playStep } = await vite.ssrLoadModule('/src/labs/solution.ts');
const solutionFiles = readdirSync('src/labs').filter((d) => existsSync(join('src/labs', d, 'solution.ts')));

const STUDENT = 'playthrough';
const finished = [];
for (const lab of LABS) {
  if (ONLY && lab.id !== ONLY) continue;
  if (!solutionFiles.includes(lab.id)) throw new Error(`${lab.id} has no solution.ts`);
  const mod = await vite.ssrLoadModule(`/src/labs/${lab.id}/solution.ts`);
  const sol = Object.entries(mod).find(([name]) => name.endsWith('Solution'))?.[1];
  if (!sol) throw new Error(`src/labs/${lab.id}/solution.ts exports no ...Solution`);
  const now = Date.now();
  const progress = {
    labId: lab.id,
    labVersion: lab.version,
    studentId: STUDENT,
    startedAt: now,
    updatedAt: now,
    activeMs: 0,
    step: 0,
    maxStep: 0,
    stepStart: {},
    goals: {},
    answers: {},
    actions: [],
    log: [],
  };
  const s = new LabSession(lab, progress);
  for (let i = 0; i < lab.steps.length; i++) {
    playStep(s, sol[s.step.id]);
    const left = s.missing();
    if (left.length) throw new Error(`${lab.id} step ${i + 1} "${s.step.id}" left unfinished in Node: ${left.join(', ')}`);
    if (i < lab.steps.length - 1) s.goTo(i + 1);
  }
  // Start the browser at step 1 with every step unlocked.
  const saved = JSON.parse(JSON.stringify(s.progress));
  saved.step = 0;
  finished.push({ href: labHref(lab.id), lab: { id: lab.id, title: lab.title, steps: lab.steps.map((st) => ({ id: st.id, title: st.title, kind: st.kind })) }, progress: saved });
}
await vite.close();
if (!finished.length) throw new Error(ONLY ? `No lab "${ONLY}"` : 'No labs found');

// --- 2. Page through each lab in the built app -----------------------------

const server = await preview({ preview: { port: 4180, strictPort: false, open: false }, logLevel: 'warn' });
const url = server.resolvedUrls.local[0];
let browser;
try {
  browser = await chromium.launch();
} catch (e) {
  const executablePath = findChrome();
  if (!executablePath) throw e;
  browser = await chromium.launch({ executablePath });
}

const failures = [];
try {
  for (const { href, lab, progress } of finished) {
    const ctx = await browser.newContext({ ...VIEW, serviceWorkers: 'block' });
    const profile = { id: STUDENT, name: 'Pat Playthrough', period: 'Period 1', createdAt: 0 };
    await ctx.addInitScript(
      ({ p, profile, theme }) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('netlab:v1:profile', JSON.stringify(profile));
        localStorage.setItem(`netlab:v1:lab:${profile.id}:${p.labId}`, JSON.stringify(p));
        if (theme) localStorage.setItem('netlab:v1:theme', theme);
      },
      { p: progress, profile, theme: THEME },
    );
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const fail = (i, msg) => failures.push(`${lab.id} step ${i + 1} "${lab.steps[i].id}": ${msg}`);

    process.stdout.write(`${lab.id}: `);
    await page.goto(`${url}${href}`);
    await page.waitForSelector('.lesson');
    const warning = await page.locator('text=the network was reset').count();
    if (warning) fail(0, 'the app says the network was reset (replay failed in the browser)');

    for (let i = 0; i < lab.steps.length; i++) {
      await page.waitForSelector(`text=Step ${i + 1} of ${lab.steps.length}`);
      await page.waitForTimeout(150);
      const open = await page.locator('.goal:not(.done) .goal-text').allInnerTexts();
      if (open.length) fail(i, `goals not shown as done: ${open.join(' | ')}`);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (wide) fail(i, 'the page scrolls sideways');
      await page.screenshot({ path: join(OUT, `${lab.id}-${String(i + 1).padStart(2, '0')}-${lab.steps[i].id}.png`) });
      if (i === lab.steps.length - 1) break;
      // The submit step leads on with a plain "Optional extra challenge" button; every other step uses Continue.
      const next = lab.steps[i].kind === 'submit' ? page.locator('.lesson-nav').getByRole('button', { name: 'Optional extra challenge' }) : page.locator('.lesson-nav .btn.primary.ready');
      if (!(await next.count())) {
        fail(i, `Continue isn't ready: ${await page.locator('.lesson-nav .btn.primary').innerText().catch(() => 'no button')}`);
        break;
      }
      await next.click();
      process.stdout.write('.');
    }
    if (errors.length) failures.push(`${lab.id}: browser errors:\n  ${errors.join('\n  ')}`);
    console.log(` ${lab.steps.length} steps`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

if (failures.length) {
  console.error(`\nPlaythrough FAILED:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`\nPlaythrough passed: ${finished.length} labs. Screenshots in ${OUT}.`);
}
