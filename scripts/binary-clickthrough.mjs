// Play the Binary Numbers lesson as a student, in the real built app, at real
// speed: sign in, open the lesson card, click every demo control the answer
// key uses (one switch by keyboard), make the common mistakes on purpose and
// check the feedback, answer every question, reload twice mid-lesson, and
// download the report. Then a short touch pass on an iPad-sized screen.
// Saves light, dark, and iPad screenshots of every step.
//
//   npm run build && node scripts/binary-clickthrough.mjs
//
// OUT (default /tmp/netlab-shots/binary-numbers) is where screenshots and the
// downloaded report go. Exits 1 on the first thing a student couldn't do.
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const req = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = req('playwright-core');
const { createServer, preview } = await import(pathToFileURL(req.resolve('vite')).href);

const LAB = 'binary-numbers';
const OUT = process.env.OUT ?? join('/tmp/netlab-shots', LAB);
mkdirSync(OUT, { recursive: true });

// The lesson and its answer key, loaded from source so the driver follows them.
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0, clear() {} };
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'warn' });
const { LABS } = await vite.ssrLoadModule('/src/labs/index.ts');
const { binaryNumbersSolution: sol } = await vite.ssrLoadModule(`/src/labs/${LAB}/solution.ts`);
const lab = LABS.find((l) => l.id === LAB);

const server = await preview({ preview: { port: 4193, strictPort: false, open: false }, logLevel: 'warn' });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable' });

const WIDE = { width: 1366, height: 768 };
const problems = [];
const t0 = Date.now();
const log = (msg) => console.log(`${`${((Date.now() - t0) / 1000).toFixed(0)}s`.padStart(5)}  ${msg}`);
const shots = [];

let page;
async function fail(why) {
  const file = join(OUT, 'FAILED.png');
  await page?.screenshot({ path: file }).catch(() => {});
  console.error(`\nFAILED: ${why}\n  screenshot: ${file}`);
  for (const p of problems) console.error(`  ${p}`);
  await shutdown();
  process.exit(1);
}
async function shutdown() {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
  await vite.close();
}
const check = async (ok, why) => {
  if (!ok) await fail(why);
};

function watch(p) {
  p.on('pageerror', (e) => problems.push(`page error: ${e}`));
  p.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && !/Service Worker/.test(m.text()))) problems.push(`console ${m.type()}: ${m.text()}`);
  });
}

const card = (demo) => page.locator(`.demo-card[data-demo="${demo}"]`);
const pause = (ms = 180) => page.waitForTimeout(ms);
const plain = (md) => md.replace(/\*\*/g, '');
const qcard = (q) => page.locator('.qcard').filter({ hasText: plain(q.prompt).slice(0, 40) }).first();

/** Click the control a student uses for one demo input. */
async function doInput(step, m, via = 'click') {
  const spec = step.demos?.find((d) => d.id === m.demo);
  if (!spec) await fail(`step ${step.id} has no demo ${m.demo}`);
  const c = card(m.demo);
  const inp = m.input;
  const act = async (loc) => {
    await check((await loc.count()) > 0, `no control for ${JSON.stringify(m)} on ${step.id}`);
    if (via === 'tap') await loc.first().tap();
    else await loc.first().click();
  };
  if ('use' in inp) await act(c.locator('.seg button', { hasText: new RegExp(`^${inp.use}$`) }));
  else if ('flip' in inp) {
    const sel = { switches: '.sw', bits: { cards: '.bcard', board: 'button.pv-bit', wires: '.wire', hex: 'button.pv-bit' }[spec.style] }[spec.kind];
    await act(c.locator(sel).nth(inp.flip));
  } else if ('view' in inp) await act(c.locator('.seg button', { hasText: { voltage: 'Voltage', light: 'Lights', bits: 'Bits' }[inp.view] }));
  else if ('tap' in inp) await act(c.locator(spec.kind === 'compare' ? '.cmp-col' : 'button.pv-bit').nth(inp.tap));
  else if ('next' in inp) await act(c.getByRole('button', { name: /^Next (example|pair)/ }));
  else if ('say' in inp) await act(c.getByRole('button', { name: inp.say ? 'Fits: write 1' : 'Too big: write 0' }));
  else if ('pad' in inp) await act(c.getByRole('button', { name: 'Line them up' }));
  else if ('pick' in inp) await act(c.locator('.cmp-pick button').nth(inp.pick));
  else if ('add' in inp) await act(c.getByRole('button', { name: '+1' }));
  else if ('digits' in inp) await act(c.locator('.seg button', { hasText: new RegExp(`^${inp.digits}$`) }));
  else if ('text' in inp) await c.locator('input').fill(inp.text);
  else await fail(`no driver for ${JSON.stringify(m)}`);
  await pause();
}

/** Answer one question the way a student would; `first` is a wrong try whose feedback must match `expectFb`. */
async function answer(step, q, { first, expectFb } = {}) {
  const el = qcard(q);
  await check((await el.count()) > 0, `question ${step.id}/${q.id} is not on screen`);
  await el.scrollIntoViewIfNeeded();
  const checkBtn = el.getByRole('button', { name: 'Check', exact: true });
  if (first !== undefined) {
    if (q.kind === 'choice') await el.locator('.option', { hasText: first }).first().click();
    else await el.locator('textarea').fill(first);
    await checkBtn.click();
    await pause();
    const fb = await el.locator('.qfeedback.bad').innerText().catch(() => '');
    await check(expectFb.test(fb), `${step.id}/${q.id}: wrong answer "${first}" gave feedback "${fb}", wanted ${expectFb}`);
    log(`    mistake "${first}" -> "${fb.slice(0, 70)}${fb.length > 70 ? '...' : ''}"`);
  }
  if (q.kind === 'choice') {
    for (const o of q.options.filter((o) => o.correct)) await el.locator('.option', { hasText: o.text }).first().click();
    await checkBtn.click();
  } else {
    const text = sol[step.id]?.text?.[q.id];
    await el.locator('textarea').fill(text);
    if (q.expect) await checkBtn.click();
  }
  await pause();
  if (q.kind === 'choice' || q.expect) await check(await el.evaluate((n) => n.classList.contains('correct')), `${step.id}/${q.id}: the right answer was not marked correct`);
}

/** Planned mistakes, by step and question: the wrong try and the feedback it must get. */
const MISTAKES = {
  bits: { byte: { first: '255', expectFb: /counting starts at 0/ } },
  cards: { biggest: { first: '32: all five face up', expectFb: /16 \+ 8 \+ 4 \+ 2 \+ 1 = 31/ } },
  'to-decimal': { backward: { first: 'Forgot to count the 0s', expectFb: /add nothing/ } },
  'practice-decimal': { w1: { first: '80', expectFb: /wrong end/ }, w2: { first: '4', expectFb: /how many 1s/ }, w4: { first: '256', expectFb: /256 is how many patterns/ } },
  'to-binary': { max: { first: '256', expectFb: /one of them is 00000000/ } },
  'practice-binary': { w6: { first: '1101', expectFb: /write all 8/ }, w7: { first: '01001100', expectFb: /reverse order/ }, w8: { first: '77', expectFb: /only the digits 0 and 1/ } },
  compare: { shortcut: { first: 'Count the 1s', expectFb: /00111111 has six 1s/ } },
  overflow: { w14: { first: '10000', expectFb: /needs 5 bits/ }, meaning: { first: 'The computer crashes', expectFb: /nothing crashes/i } },
  limits: { 'w12-range': { first: '0 to 64', expectFb: /65 numbers/ }, w13: { first: '6', expectFb: /too few/ } },
};

async function shoot(i, step, tag) {
  const base = join(OUT, `${String(i + 1).padStart(2, '0')}-${step.id}-${tag}`);
  const scroller = page.locator('.demo-stage');
  const tall = (await scroller.count()) && (await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 4));
  await page.screenshot({ path: `${base}.png` });
  shots.push(`${base}.png`);
  if (tall) {
    await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await pause(120);
    await page.screenshot({ path: `${base}-lower.png` });
    shots.push(`${base}-lower.png`);
    await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
  }
}

async function shootAll(i, step) {
  await shoot(i, step, 'light');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await pause(120);
  await shoot(i, step, 'dark');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.setViewportSize({ width: 1024, height: 768 });
  await pause(150);
  await shoot(i, step, 'ipad-landscape');
  await page.setViewportSize({ width: 768, height: 1024 });
  await pause(150);
  const file = join(OUT, `${String(i + 1).padStart(2, '0')}-${step.id}-ipad-portrait.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push(file);
  await page.setViewportSize(WIDE);
  await pause(150);
}

async function goalsDone(step) {
  const n = step.goals?.length ?? 0;
  if (!n) return;
  const ok = await page
    .waitForFunction((n) => document.querySelectorAll('.goal.done').length >= n, n, { timeout: 8000, polling: 100 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    const left = await page.locator('.goal:not(.done) .goal-text').allInnerTexts();
    await fail(`step ${step.id}: goals not done after the demos: ${left.join('; ')}`);
  }
}

async function reloadAndCheck(i, step, what) {
  const before = await page.locator('.goal.done').count();
  await page.reload();
  await page.waitForSelector('.lesson');
  await page.waitForSelector(`text=Step ${i + 1} of ${lab.steps.length}`);
  await check((await page.locator('.goal.done').count()) === before, `after reload on ${step.id}, ${before} goals were done and now ${await page.locator('.goal.done').count()} are`);
  await check(await what(), `after reload on ${step.id}, the demo did not come back the way it was`);
  log(`  reloaded mid-step: still step ${i + 1}, ${before} goals done, demo state restored`);
}

try {
  // ---------------------------------------------------------------- main run
  const ctx = await browser.newContext({ viewport: WIDE, serviceWorkers: 'block', acceptDownloads: true });
  page = await ctx.newPage();
  watch(page);
  await page.goto(url);
  // A fresh computer: the sign-in dialog first.
  await page.getByLabel('First and last name').fill('Riley Student');
  await page.getByRole('button', { name: 'Start' }).click();
  await page.locator('.lab-card', { hasText: lab.title }).locator('a.lab-card-link').click();
  await page.waitForSelector('.lesson');
  log(`${lab.title}: ${lab.steps.length} steps`);

  for (let i = 0; i < lab.steps.length; i++) {
    const step = lab.steps[i];
    await page.waitForSelector(`text=Step ${i + 1} of ${lab.steps.length}`);
    log(`step ${i + 1} ${step.id}`);
    // The lesson panel smooth-scrolls back to the top on a new step.
    await pause(1200);
    await shoot(i, step, 'start');
    if (step.kind === 'submit') {
      await shootAll(i, step);
      break;
    }
    if (i === 0) {
      // Continue is not offered until the step is done.
      await check((await page.getByRole('button', { name: 'Continue' }).count()) === 0, 'Continue was offered before step 1 was done');
    }
    const moves = sol[step.id]?.moves ?? [];
    for (let k = 0; k < moves.length; k++) {
      const m = moves[k];
      // A few student mistakes inside the demos, before the right move.
      if (step.id === 'to-decimal' && k === 0) {
        await doInput(step, { demo: 'read', input: { tap: 0 } });
        await check(/holds a 0, so it adds nothing/.test(await card('read').innerText()), 'tapping a 0 did not explain itself');
        log('    tapped a 0: "adds nothing" note shown');
      }
      if (step.id === 'to-binary' && k === 0) {
        await doInput(step, { demo: 'fit', input: { say: 1 } });
        await check(/128 is bigger than 75/.test(await card('fit').locator('.walk-note.bad').innerText()), 'a wrong "fits" call was not explained');
        log('    said 128 fits in 75: explained');
      }
      if (step.id === 'compare' && k === 0) {
        await doInput(step, { demo: 'compare', input: { tap: 0 } });
        await check(/Keep looking to the right/.test(await card('compare').innerText()), 'tapping a matching place did not explain itself');
        log('    tapped a place where both match: "keep looking"');
      }
      if (step.id === 'compare' && 'pick' in m.input && k === 1) {
        await doInput(step, { demo: 'compare', input: { pick: 1 } });
        await check(/worth more than all the places to its right/.test(await card('compare').innerText()), 'a wrong pick was not explained');
        log('    picked the smaller number: explained');
      }
      if (step.id === 'compare' && 'pad' in m.input) {
        await doInput(step, { demo: 'compare', input: { tap: 0 } });
        await check(/Line them up first/.test(await card('compare').innerText()), 'tapping before lining up did not explain itself');
        log('    tapped before lining up: told to line them up');
      }
      if (i === 0 && k === 0) {
        // The first switch by keyboard.
        await card('switches').locator('.sw').first().focus();
        await page.keyboard.press('Space');
        await pause();
        await check((await card('switches').locator('.sw').first().getAttribute('aria-checked')) === 'true', 'Space did not flip the focused switch');
        log('  flipped switch 1 with the keyboard');
      } else await doInput(step, m);

      // Reload in the middle of steps 1 and 6, then carry on.
      if (step.id === 'switches' && k === 3) {
        await reloadAndCheck(i, step, async () => /Patterns found with 2 switches: 3/.test(await card('switches').innerText()));
      }
      if (step.id === 'to-binary' && k === 7) {
        await reloadAndCheck(i, step, async () => (await card('fit').locator('.fit-trail li').count()) === 8 && /75 is .*01001011/.test(await card('fit').innerText()));
      }
    }
    if (step.id === 'overflow') {
      await check(/Overflow!/.test(await card('counter').innerText()), 'the 4-bit counter did not show overflow');
      await check((await card('counter').locator('.ctr-digit').allInnerTexts()).join('') === '0000', 'the 4-bit counter did not show 0000');
    }
    await goalsDone(step);
    for (const q of step.questions ?? []) await answer(step, q, MISTAKES[step.id]?.[q.id]);
    await shootAll(i, step);
    const cont = page.getByRole('button', { name: 'Continue' });
    if (!(await cont.count())) await fail(`Continue not available on ${step.id}: "${(await page.locator('.lesson .btn.primary.big').innerText()).trim()}"`);
    await cont.click();
  }

  // ---------------------------------------------------------------- hand in
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download my report|Submit to my teacher/ }).first().click();
  const file = join(OUT, 'report.html');
  await (await dl).saveAs(file);
  const html = readFileSync(file, 'utf8');
  for (const want of ['Binary Numbers', 'Riley Student', 'Correct on the first try', 'Correct after 2 tries', 'stored value is wrong']) await check(html.includes(want), `the report is missing "${want}"`);
  log(`report downloaded: ${file}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, '13-submit-after-download.png') });
  shots.push(join(OUT, '13-submit-after-download.png'));
  const rp = await ctx.newPage();
  await rp.goto(pathToFileURL(file).href);
  await rp.screenshot({ path: join(OUT, 'report.png'), fullPage: true });
  shots.push(join(OUT, 'report.png'));
  await rp.close();

  // The lesson guide.
  await page.goto(`${url}#/guide/${LAB}`);
  await page.waitForSelector('text=Lesson guide');
  await page.screenshot({ path: join(OUT, 'guide.png') });
  shots.push(join(OUT, 'guide.png'));
  await ctx.close();

  // ---------------------------------------------------------------- touch, iPad
  const tctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  page = await tctx.newPage();
  watch(page);
  await page.goto(url);
  await page.getByLabel('First and last name').fill('Tess Tablet');
  await page.getByRole('button', { name: 'Start' }).click();
  await page.locator('.lab-card', { hasText: lab.title }).locator('a.lab-card-link').tap();
  await page.waitForSelector('.lesson');
  const s1 = lab.steps[0];
  for (const m of sol[s1.id].moves) await doInput(s1, m, 'tap');
  await goalsDone(s1);
  log('touch: step 1 switches done by tapping');
  await page.screenshot({ path: join(OUT, 'touch-ipad-switches.png'), fullPage: true });
  shots.push(join(OUT, 'touch-ipad-switches.png'));
  await tctx.close();

  log('done: every step completed in the app');
  if (problems.length) {
    for (const p of problems) console.log(`  ${p}`);
    await fail('console errors or warnings during the run');
  }
  console.log(`\n${shots.length} screenshots in ${OUT}`);
} finally {
  await shutdown().catch(() => {});
}
