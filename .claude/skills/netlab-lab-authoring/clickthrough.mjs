// Play a lab from a fresh student profile through the real app, clicking what a
// student clicks, at real speed: map devices, lesson buttons, Start and Stop,
// the Ping card, display filters, captured packets, questions, and Continue.
// It waits on the live network (no runUntilIdle), so it finds steps a student
// can't finish even when the walkthrough test passes. Run from the repo root
// after `npm run build`:
//
//   LAB=packet-capture node .claude/skills/netlab-lab-authoring/clickthrough.mjs
//   LAB=packet-capture SPEED=1 node .claude/skills/netlab-lab-authoring/clickthrough.mjs
//
// SPEED is the app's speed button (1, 2, or 4; default 4). STEPS=<id>,<id> plays
// only up to the last listed step. GOAL_MS caps the wait for a step's goals
// (real ms, default 240000). On a stuck step it saves a screenshot to
// /tmp/netlab-shots/<lab>/clickthrough/ and exits 1.
//
// The answer key drives it. A move kind or tool action with no UI driver here
// fails loudly: add a driver in `doMove` rather than skipping it.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const req = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = req('playwright-core');
const { createServer, preview } = await import(pathToFileURL(req.resolve('vite')).href);

const LAB = process.env.LAB;
if (!LAB) throw new Error('Set LAB=<lab id>');
const SPEED = process.env.SPEED ?? '4';
const GOAL_MS = Number(process.env.GOAL_MS ?? 240000);
const OUT = join('/tmp/netlab-shots', LAB, 'clickthrough');
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

// The answer key, the device labels, and what each packet looks like in the capture list.
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'warn' });
const { LABS } = await vite.ssrLoadModule('/src/labs/index.ts');
const { LabSession } = await vite.ssrLoadModule('/src/runtime/session.ts');
const { playMove, playStep } = await vite.ssrLoadModule('/src/labs/solution.ts');
const { infoOf, endpoints, protoOf } = await vite.ssrLoadModule('/src/ui/describe.ts');
const { isEncrypted, isPlainLogin, isTelnetLogin } = await vite.ssrLoadModule('/src/labs/helpers.ts');
const mod = await vite.ssrLoadModule(`/src/labs/${LAB}/solution.ts`);
const sol = Object.entries(mod).find(([n]) => n.endsWith('Solution'))?.[1];
const lab = LABS.find((l) => l.id === LAB);
if (!lab || !sol) throw new Error(`No lab or solution for ${LAB}`);
// A lesson (no `build`) has no network, so no devices and no speed button.
const labels = lab.build ? Object.fromEntries(Object.values(lab.build().devices).map((d) => [d.id, d.label])) : {};
const MATCH = { login: isPlainLogin, encrypted: isEncrypted, telnet: isTelnetLogin };

// Play the key in a model session alongside the browser, to know which captured row each openFrame move means.
const now = Date.now();
const model = new LabSession(lab, { labId: lab.id, labVersion: lab.version, studentId: 'click', startedAt: now, updatedAt: now, activeMs: 0, step: 0, maxStep: 0, stepStart: {}, goals: {}, answers: {}, actions: [], log: [] });
const rowOf = (move) => {
  const pred = typeof move.match === 'function' ? move.match : MATCH[move.match];
  const hit = model.sim.dev(move.openFrame).capture.find((c) => pred(c.frame));
  if (!hit) throw new Error(`The model capture has no packet for this move`);
  const { src, dst } = endpoints(hit.frame);
  return { src, dst, proto: protoOf(hit.frame), info: infoOf(hit.frame) };
};

const only = process.env.STEPS?.split(',');
const lastIndex = only ? Math.max(...only.map((id) => lab.steps.findIndex((s) => s.id === id))) : lab.steps.length - 1;

const server = await preview({ preview: { port: 4192, strictPort: false, open: false }, logLevel: 'warn' });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 800 }, serviceWorkers: 'block' });
const profile = { id: 'click', name: 'Casey Click', period: 'Period 1', createdAt: 0 };
await ctx.addInitScript((profile) => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem('netlab:v1:profile', JSON.stringify(profile));
}, profile);
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`page error: ${e}`));
page.on('console', (m) => {
  if (m.type() === 'error' || (m.type() === 'warning' && !/Service Worker/.test(m.text()))) problems.push(`console ${m.type()}: ${m.text()}`);
});

const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`.padStart(5);
const log = (msg) => console.log(`${secs()}  ${msg}`);

async function fail(stepIndex, why) {
  const file = join(OUT, `stuck-${String(stepIndex + 1).padStart(2, '0')}-${lab.steps[stepIndex].id}.png`);
  await page.screenshot({ path: file });
  const capture = await page.locator('.capture-bar').first().innerText().catch(() => '(no capture bar)');
  const outcome = await page.locator('.action-outcome').first().innerText().catch(() => '');
  console.error(`\nSTUCK on step ${stepIndex + 1} (${lab.steps[stepIndex].id}): ${why}`);
  console.error(`  capture: ${capture.replace(/\s+/g, ' ')}`);
  if (outcome) console.error(`  button result: ${outcome.replace(/\s+/g, ' ')}`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(`  screenshot: ${file}`);
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
  await vite.close();
  process.exit(1);
}

/** Wait until nothing is moving: no packets on the map and no "wait" lines, for a full second. */
async function settle(limit = 120000) {
  const end = Date.now() + limit;
  let quietSince = 0;
  while (Date.now() < end) {
    const busy = await page.evaluate(() => document.querySelectorAll('g.packet').length + document.querySelectorAll('.action-outcome li.wait, .ping-log li.wait, .term-wait').length);
    if (busy) quietSince = 0;
    else if (!quietSince) quietSince = Date.now();
    else if (Date.now() - quietSince > 1000) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

const tab = (name) => page.getByRole('tab', { name: new RegExp(name) }).click();
const device = (id) => page.locator('g.device').filter({ has: page.locator('text.device-label', { hasText: new RegExp(`^${labels[id]}$`) }) });

/** The Java and JavaScript editors and the objects demo. Other demos have no driver yet, so they fail loudly. */
async function doDemo(id, input) {
  const stage = page.locator(`[data-demo="${id}"]`);
  if ('edit' in input) {
    await stage.locator('.java-tab', { hasText: input.edit }).click();
    await stage.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(input.code);
    // Past the editor's save delay, so a run or a goal sees the new text.
    await page.waitForTimeout(400);
    log(`  edit ${input.edit}`);
  } else if ('tab' in input) {
    await stage.locator('.java-tab', { hasText: input.tab }).click();
    log(`  open ${input.tab}`);
  } else if ('run' in input) {
    await stage.locator('.java-run').click();
    log('  press Run');
  } else if ('stepping' in input) {
    await stage.getByRole('button', { name: input.stepping ? 'Step through' : 'Stop', exact: true }).click();
    log(`  press ${input.stepping ? 'Step through' : 'Stop'}`);
  } else if ('seek' in input) {
    await stage.locator('.java-next').click();
    log(`  press Next (${input.seek})`);
  } else if ('answer' in input) {
    const box = stage.locator('.js-prompt');
    const text = box.locator('input');
    if (input.answer !== null && (await text.count())) await text.fill(input.answer);
    await box.getByRole('button', { name: input.answer === null ? 'Cancel' : 'OK', exact: true }).click();
    log(`  answer the prompt: ${input.answer === null ? 'Cancel' : `OK ${JSON.stringify(input.answer)}`}`);
  } else if ('hint' in input) {
    await stage.locator('.js-hint').click();
    log(`  press Hint (${input.hint})`);
  } else if ('make' in input) {
    await stage.locator('.objects-class button').click();
    log('  make an object');
  } else if ('hit' in input) {
    await stage.locator('.objects-card').nth(input.hit).locator('button').click();
    log(`  hit object ${input.hit}`);
  } else if ('click' in input) {
    // The page is in a sandboxed iframe. A click re-runs the program, and the frame reloads with the new page.
    const frame = stage.locator('[data-preview] iframe');
    const before = await frame.evaluate((el) => el.srcdoc);
    await stage.locator('[data-preview]').frameLocator('iframe').locator(input.click).click();
    await page.waitForFunction(({ id, old }) => document.querySelector(`[data-demo="${id}"] [data-preview] iframe`)?.srcdoc !== old, { id, old: before });
    await page.waitForTimeout(150);
    log(`  click ${input.click} in the preview`);
  } else throw new Error(`clickthrough has no UI driver for demo input ${JSON.stringify(input)}. Add one in doDemo.`);
}

async function doMove(i, step, m) {
  if ('inspect' in m) {
    // Spotlighted devices pulse, so Playwright never sees them as stable.
    await device(m.inspect).locator('rect.device-card').first().click({ force: true });
    log(`  click ${labels[m.inspect]}`);
  } else if ('press' in m) {
    const def = step.actions?.find((a) => a.id === m.press);
    if (!def) throw new Error(`No button ${m.press}`);
    // The button sits in the instructions ([[button:id]]) or in the row under them.
    await page.locator('.lesson .btn.action', { hasText: def.label }).first().click();
    log(`  press "${def.label}"`);
  } else if ('tool' in m) {
    const a = m.tool;
    if (a.type === 'capture') {
      await tab('Capture');
      const btn = a.on ? page.locator('.capture-buttons button').first() : page.locator('.capture-buttons button', { hasText: 'Stop' });
      if (!a.on && (await btn.isDisabled())) await fail(i, 'Stop is greyed out: the capture is no longer running');
      await btn.click();
      log(`  capture ${a.on ? 'Start' : 'Stop'}`);
    } else if (a.type === 'ping') {
      await tab('Toolkit');
      const card = page.locator('.tool-card', { hasText: 'Ping' }).first();
      await card.locator('select').selectOption({ label: labels[a.device] });
      await card.locator('input').fill(a.ip);
      await card.getByRole('button', { name: 'Ping' }).click();
      log(`  ping ${a.ip} from ${labels[a.device]}`);
    } else if (a.type === 'term') {
      await tab('Toolkit');
      const card = page.locator('.term-card').first();
      const pick = card.locator('.term-at select');
      if (await pick.count()) await pick.selectOption({ label: labels[a.device] });
      else {
        const at = (await card.locator('.term-at b').innerText()).trim();
        if (at !== labels[a.device]) await fail(i, `the Terminal sits at ${at}, not ${labels[a.device]}`);
      }
      const input = card.locator('.term-input');
      await input.fill(a.line);
      await input.press('Enter');
      await page.waitForTimeout(150);
      // A line the terminal turned away prints only on screen: say what it said.
      const last = card.locator('.term-entry').last();
      if ((await last.getAttribute('data-local')) !== null) await fail(i, `the Terminal turned away "${a.line}": ${(await last.innerText()).replace(/\s+/g, ' ')}`);
      log(`  ${a.device}> ${a.line}`);
    } else throw new Error(`clickthrough has no UI driver for tool action "${a.type}". Add one in doMove.`);
  } else if ('filter' in m) {
    await tab('Capture');
    await page.locator('.capture-filter input').fill(m.text);
    await page.keyboard.press('Enter');
    log(`  filter "${m.text}"`);
  } else if ('openFrame' in m) {
    await tab('Capture');
    const want = rowOf(m);
    const rows = page.locator('.capture-table tbody tr');
    // The browser collapses runs of spaces, so compare with whitespace squeezed.
    const squeeze = (t) => t.replace(/\s+/g, ' ');
    const texts = (await rows.allInnerTexts()).map(squeeze);
    const n = texts.findIndex((t) => t.includes(want.src) && t.includes(want.dst) && t.includes(squeeze(want.info)));
    if (n < 0) await fail(i, `no row in the capture list for ${want.proto} ${want.src} → ${want.dst} "${want.info}"`);
    await rows.nth(n).click();
    log(`  open packet: ${want.proto} ${want.info}`);
  } else if ('demo' in m) {
    await doDemo(m.demo, m.input);
  } else throw new Error(`clickthrough has no UI driver for move ${JSON.stringify(m)}. Add one in doMove.`);
  await page.waitForTimeout(200);
  if (!(await settle())) await fail(i, 'the network never went quiet after the last move');
}

async function answer(i, step) {
  const key = sol[step.id] ?? {};
  for (const q of step.questions ?? []) {
    const card = page.locator('.qcard').filter({ hasText: q.prompt.replace(/\*\*|`/g, '').slice(0, 40) }).first();
    if ((await card.count()) === 0) await fail(i, `question "${q.id}" isn't on screen (still locked?)`);
    if (q.kind === 'choice') {
      // Exact, so an answer of "0" doesn't pick the option "100".
      for (const o of q.options.filter((o) => o.correct)) await card.locator('.option', { hasText: new RegExp(`^\\s*${o.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first().click();
      await card.getByRole('button', { name: 'Check', exact: true }).click();
    } else {
      const text = key.text?.[q.id];
      if (text === undefined) throw new Error(`No answer-key text for ${step.id}/${q.id}`);
      await card.locator('textarea').fill(text);
      if (q.expect) await card.getByRole('button', { name: 'Check', exact: true }).click();
    }
    await page.waitForTimeout(150);
    if (await card.evaluate((el) => el.classList.contains('wrong'))) await fail(i, `the answer key's answer to "${q.id}" was marked wrong`);
  }
}

try {
  await page.goto(`${url}#/lab/${lab.id}`);
  await page.waitForSelector('.lesson');
  if (lab.build) await page.getByRole('button', { name: `${SPEED}×`, exact: true }).click();
  log(`${lab.title}: ${lab.steps.length} steps${lab.build ? ` at ${SPEED}×` : ''}`);
  for (let i = 0; i <= lastIndex; i++) {
    const step = lab.steps[i];
    await page.waitForSelector(`text=Step ${i + 1} of ${lab.steps.length}`);
    log(`step ${i + 1} ${step.id}`);
    // A new step's question cards reset their text after the first paint. A
    // lesson step has no moves to wait on, so give them that moment.
    await page.waitForTimeout(300);
    // EACH=1 saves the live app as each step opens, to check the map between steps.
    if (process.env.EACH) {
      await page.screenshot({ path: join(OUT, `step-${String(i + 1).padStart(2, '0')}-${step.id}.png`) });
    }
    if (step.kind === 'submit') break;
    // The model session plays each move too, so openFrame knows its row.
    for (const m of sol[step.id]?.moves ?? []) {
      await doMove(i, step, m);
      playMove(model, m);
    }
    const goals = step.goals?.length ?? 0;
    if (goals) {
      const done = await page
        .waitForFunction((n) => document.querySelectorAll('.goal.done').length >= n, goals, { timeout: GOAL_MS, polling: 250 })
        .then(() => true)
        .catch(() => false);
      if (!done) {
        const left = await page.locator('.goal:not(.done) .goal-text').allInnerTexts();
        await fail(i, `goals not done after the answer key's moves: ${left.join('; ')}`);
      }
    }
    // A click that times out still gets a screenshot and the step's name.
    await answer(i, step).catch((e) => fail(i, String(e.message ?? e).split('\n')[0]));
    playStep(model, { text: sol[step.id]?.text });
    const cont = page.getByRole('button', { name: 'Continue' });
    if (!(await cont.count())) {
      const why = await page.locator('.lesson .btn.primary.big').innerText().catch(() => '?');
      await fail(i, `Continue is not available: "${why.trim()}"`);
    }
    await cont.click();
    model.goTo(i + 1);
  }
  log(`done: every step${only ? ' through ' + lab.steps[lastIndex].id : ''} can be completed in the app`);
  for (const p of problems) console.log(`  note: ${p}`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
  await vite.close();
}
