// Screenshots of a lab mid-lesson, step by step (the playthrough only shows
// the finished network). Run from the repo root after `npm run build`:
//
//   LAB=home-network node .claude/skills/netlab-lab-authoring/shots.mjs
//   LAB=home-network THEME=dark SIZE=small node .claude/skills/netlab-lab-authoring/shots.mjs
//
// SHOTS (JSON) picks the screenshots: [stepId, playThatStep, click|null, tabName|null].
// click is a device label to click on the map, or "chip:<deviceId>" to click that
// device's chip in the lesson text. ROW=<n> then opens the nth captured packet.
// The default is every step twice: as it opens, and after its answer-key moves.
// THEME defaults to light, the app's default.
// Saves to /tmp/netlab-shots/<lab>/<theme>-<size>/.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const req = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = req('playwright-core');
const { createServer, preview } = await import(pathToFileURL(req.resolve('vite')).href);

const LAB = process.env.LAB;
if (!LAB) throw new Error('Set LAB=<lab id>');
const THEME = process.env.THEME ?? '';
const SMALL = process.env.SIZE === 'small';
const VIEW = { viewport: SMALL ? { width: 1366, height: 768 } : { width: 1440, height: 800 } };
const OUT = join('/tmp/netlab-shots', LAB, `${THEME || 'light'}-${SMALL ? 'small' : 'big'}`);
mkdirSync(OUT, { recursive: true });

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
const { LabSession } = await vite.ssrLoadModule('/src/runtime/session.ts');
const { playStep } = await vite.ssrLoadModule('/src/labs/solution.ts');
const mod = await vite.ssrLoadModule(`/src/labs/${LAB}/solution.ts`);
const sol = Object.entries(mod).find(([n]) => n.endsWith('Solution'))?.[1];
const lab = LABS.find((l) => l.id === LAB);
if (!lab || !sol) throw new Error(`No lab or solution for ${LAB}`);

const shots = process.env.SHOTS
  ? JSON.parse(process.env.SHOTS)
  : lab.steps.flatMap((s) => [
      [s.id, false, null, null],
      [s.id, true, null, null],
    ]);

function progressAt(stepId, playIt) {
  const now = Date.now();
  const p = { labId: lab.id, labVersion: lab.version, studentId: 'shots', startedAt: now, updatedAt: now, activeMs: 0, step: 0, maxStep: 0, stepStart: {}, goals: {}, answers: {}, actions: [], log: [] };
  const s = new LabSession(lab, p);
  const last = lab.steps.findIndex((st) => st.id === stepId);
  if (last < 0) throw new Error(`No step ${stepId}`);
  for (let i = 0; i <= last; i++) {
    if (i < last || playIt) playStep(s, sol[s.step.id]);
    if (i < last) s.goTo(i + 1);
  }
  return { progress: JSON.parse(JSON.stringify(s.progress)), index: last };
}
const plans = shots.map(([stepId, playIt, click, tab]) => ({ ...progressAt(stepId, playIt), stepId, playIt, click, tab }));
await vite.close();

const server = await preview({ preview: { port: 4190, strictPort: false, open: false }, logLevel: 'warn' });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable' });
try {
  for (const { progress, index, stepId, playIt, click, tab } of plans) {
    const ctx = await browser.newContext({ ...VIEW, serviceWorkers: 'block' });
    const profile = { id: 'shots', name: 'Sam Shots', period: 'Period 1', createdAt: 0 };
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
    page.on('pageerror', (e) => console.error(`${stepId}: page error: ${e}`));
    await page.goto(`${url}#/lab/${lab.id}`);
    await page.waitForSelector(`text=Step ${index + 1} of ${lab.steps.length}`);
    await page.waitForTimeout(400);
    if (click?.startsWith('chip:')) {
      // A device chip in the lesson text.
      await page.locator(`.lesson .chip[data-device="${click.slice(5)}"]`).first().click();
      await page.waitForTimeout(650);
    } else if (click) {
      const dev = page.locator('g.device').filter({ has: page.locator('text.device-label', { hasText: new RegExp(`^${click}$`) }) });
      // Spotlighted devices pulse, so Playwright never sees them as stable.
      await dev.locator('rect.device-card').click({ force: true });
      await page.waitForTimeout(200);
    }
    if (tab) {
      await page.locator('[role=tab], .dock-tabs button').filter({ hasText: tab }).first().click();
      await page.waitForTimeout(200);
    }
    if (process.env.ROW) {
      // Open a captured packet: ROW counts from the top of the capture list.
      await page.locator('.capture-table tbody tr').nth(Number(process.env.ROW)).click();
      await page.waitForTimeout(200);
    }
    const name = [String(index + 1).padStart(2, '0'), stepId, playIt ? 'done' : 'start', click, tab].filter(Boolean).join('-').replace(/\s+/g, '_');
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    await ctx.close();
    process.stdout.write('.');
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
console.log(`\nSaved in ${OUT}`);
