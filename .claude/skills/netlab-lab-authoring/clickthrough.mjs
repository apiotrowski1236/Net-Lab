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
import { moreMoves } from './drivers.mjs';

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
const { portName } = await vite.ssrLoadModule('/src/runtime/toolInput.ts');
const { portLabel } = await vite.ssrLoadModule('/src/sim/switchsec.ts');
const { pairName } = await vite.ssrLoadModule('/src/sim/zonePolicy.ts');
const { MODE_NAME } = await vite.ssrLoadModule('/src/sim/firewall.ts');
const mod = await vite.ssrLoadModule(`/src/labs/${LAB}/solution.ts`);
const sol = Object.entries(mod).find(([n]) => n.endsWith('Solution'))?.[1];
const lab = LABS.find((l) => l.id === LAB);
if (!lab || !sol) throw new Error(`No lab or solution for ${LAB}`);
// A lesson (no `build`) has no network, so no devices and no speed button.
const built = lab.build ? lab.build().devices : {};
const labels = Object.fromEntries(Object.values(built).map((d) => [d.id, d.label]));
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
  // This runs in every frame, and a page preview's sandboxed frame has no storage.
  if (window !== window.top) return;
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
    const busy = await page.evaluate(() => document.querySelectorAll('g.packet').length + document.querySelectorAll('.action-outcome li.wait, .ping-log li.wait, .term-wait, .bench-busy').length);
    if (busy) quietSince = 0;
    else if (!quietSince) quietSince = Date.now();
    else if (Date.now() - quietSince > 1000) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

const tab = (name) => page.getByRole('tab', { name: new RegExp(name) }).click();
const device = (id) => page.locator('g.device').filter({ has: page.locator('text.device-label', { hasText: new RegExp(`^${labels[id]}$`) }) });

/** Click a log line: a row in the bench's analyst queue when the step shows one for it (detect-methods), else the row in the Logs tab. */
async function openLog(i, step, m) {
  const hit = [...model.sim.dev(m.openLog).logs].reverse().find(m.where);
  if (!hit) await fail(i, `the model has no log line on ${m.openLog} for this move`);
  const b = model.sim.dev(m.openLog).bench;
  const run = b?.runs.find((r) => r.result?.alerts.some((a) => a.logNo === hit.no));
  const queued = run && step.tools?.some((t) => t.kind === 'bench' && t.queue && t.device === m.openLog && t.clients.includes(run.client));
  if (queued && run === [...b.runs].reverse().find((r) => r.client === run.client && r.result)) {
    await tab('Toolkit');
    const n = run.result.alerts.findIndex((a) => a.logNo === hit.no);
    await page.locator('.bench-queue .bench-alerts li').nth(n).locator('button').click();
    log(`  open queue row ${n + 1}: ${hit.msg.slice(0, 70)}`);
    return;
  }
  await tab('Logs');
  const search = page.locator('.logs-search');
  await search.fill(hit.msg);
  const rows = page.locator('.logs-table tbody tr').filter({ has: page.locator(`td[title="${hit.msg.replace(/"/g, '\\"')}"]`) });
  if ((await rows.count()) === 0) await fail(i, `no row in the Logs tab for "${hit.msg}"`);
  await rows.last().click();
  await search.fill('');
  log(`  open log line: ${hit.msg.slice(0, 80)}`);
}

/** Log Detective's controls in the inspector: the IDS sensor's switches and tolerance, SIEM triage, the AI threshold. */
async function doDetection(i, a) {
  await device(a.device).locator('rect.device-card').first().click({ force: true });
  await tab('Inspect');
  const flip = async (name, on) => {
    const sw = page.getByRole('switch', { name });
    if ((await sw.count()) === 0) await fail(i, `no ${name} switch in ${labels[a.device]}'s inspector`);
    if ((await sw.first().getAttribute('aria-checked')) !== String(on)) await sw.first().click();
  };
  if (a.type === 'ids-signatures') await flip(/^Signature set/, a.on);
  else if (a.type === 'ids-prevention') await flip(/^Prevention mode/, a.on);
  else if (a.type === 'ids-anomaly') {
    await flip(/^Anomaly detection$/, a.on);
    const name = { loose: 'Loose', medium: 'Medium', strict: 'Strict' }[a.tolerance];
    const btn = page.getByRole('group', { name: 'Anomaly tolerance' }).getByRole('button', { name, exact: true });
    if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  } else if (a.type === 'siem-triage') {
    const row = page.locator('.incident-row').filter({ has: page.locator('strong', { hasText: new RegExp(`^${a.incident}$`) }) });
    if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
    await page.getByRole('group', { name: `Incident ${a.incident} verdict` }).getByRole('button', { name: a.verdict === 'real' ? 'Real attack' : 'False alarm' }).click();
    await page.getByRole('group', { name: `Incident ${a.incident} action` }).getByRole('button', { name: a.action === 'escalate' ? 'Escalate' : 'Close' }).click();
    await page.getByRole('button', { name: 'Save triage' }).click();
  } else if (a.type === 'ai-threshold') {
    await page.locator(`#ai-th-${a.device}`).fill(String(a.value));
  }
  log(`  ${a.type} on ${labels[a.device]}: ${JSON.stringify({ ...a, type: undefined, device: undefined })}`);
}

/** The detection bench's cards in the Toolkit (detect-methods). */
async function doBench(i, a) {
  await tab('Toolkit');
  const b = model.sim.dev(a.device).bench;
  const name = (id) => b.config.clients.find((c) => c.id === id).name;
  const METHOD = { signature: 'Signature', anomaly: 'Anomaly', hybrid: 'Hybrid' };
  const card = page.locator('.bench-card');
  const pickClient = async () => {
    const seg = card.getByRole('group', { name: 'Client' });
    if (await seg.count()) await seg.getByRole('button', { name: name(a.client), exact: true }).click();
    const title = await card.locator('.tool-title').innerText();
    if (!title.includes(name(a.client))) await fail(i, `the bench card shows "${title}", not ${name(a.client)}`);
  };
  if (a.type === 'bench-set') {
    await pickClient();
    if (a.method) {
      const seg = card.getByRole('group', { name: 'Method' });
      if (await seg.count()) await seg.getByRole('button', { name: METHOD[a.method], exact: true }).click();
      else await fail(i, `the bench card offers no method choice (wanted ${a.method})`);
    }
    if (a.tolerance !== undefined) {
      const seg = card.getByRole('group', { name: 'Tolerance' });
      if (!(await seg.count())) await fail(i, 'the bench card offers no tolerance choice');
      await seg.getByRole('button', { name: `±${a.tolerance}%`, exact: true }).click();
    }
  } else if (a.type === 'bench-baseline') {
    await pickClient();
    const day = b.config.clients.find((c) => c.id === a.client).days[a.day].label;
    const btn = card.locator('.bench-row', { hasText: 'Record a baseline from' }).getByRole('button', { name: day, exact: true });
    if (!(await btn.count())) await fail(i, `no "${day}" baseline button on the bench card`);
    await btn.click();
  } else if (a.type === 'bench-db') {
    const label = b.config.versions.find((v) => v.id === a.version).label;
    await card.getByRole('button', { name: `Install the ${label} update` }).click();
  } else if (a.type === 'bench-run') {
    await pickClient();
    const run = card.locator('.btn.primary', { hasText: /^\s*Run / });
    if (await run.isDisabled()) await fail(i, `the bench's Run button is greyed out: ${await card.locator('.bench-settings').innerText()}`);
    await run.click();
  } else if (a.type === 'bench-plan') {
    const seg = page.locator('.bench-plan').getByRole('group', { name: `Method for ${name(a.client)}` });
    await seg.getByRole('button', { name: new RegExp(`^${METHOD[a.method]} `) }).click();
  }
  log(`  ${a.type}: ${JSON.stringify({ ...a, type: undefined, device: undefined })}`);
}

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
  } else if ('stop' in input) {
    await stage.locator('.js-stop').click();
    log('  press Stop on the prompt');
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
  } else if ('peek' in input || 'paint' in input) {
    // compression: a pixel in the Pixels or Paint grid.
    const i = 'peek' in input ? input.peek : input.paint;
    await stage.locator(`[data-px="${i}"]`).click();
    log(`  tap pixel ${i}`);
  } else if ('advance' in input) {
    await stage.locator('.walk-step').click();
    log('  press Step');
  } else if ('finish' in input) {
    await stage.locator('.walk-skip').click();
    log('  press Skip to the end');
  } else if ('changes' in input) {
    await stage.locator('.sq-changes, .squeeze-changes').click();
    log(`  press ${input.changes ? 'Show' : 'Hide'} what changed`);
  } else if ('picture' in input) {
    await stage.locator(`[data-picture="${input.picture}"]`).click();
    log(`  pick picture ${input.picture}`);
  } else if ('method' in input) {
    await stage.locator(`[data-method="${input.method}"]`).click();
    log(`  pick method ${input.method}`);
  } else if ('brush' in input) {
    await stage.locator(`[data-brush="${input.brush}"]`).click();
    log(`  pick color ${input.brush}`);
  } else if ('clear' in input) {
    await stage.getByRole('button', { name: 'Clear', exact: true }).click();
    log('  press Clear');
  } else throw new Error(`clickthrough has no UI driver for demo input ${JSON.stringify(input)}. Add one in doDemo.`);
}

/** Saved capture files in the Capture tab (capture-analysis): pick the file, then filter, a Statistics view, a stream, or a packet. */
const STATS_LABEL = { 'endpoints-eth': 'Endpoints: Ethernet', 'endpoints-ip': 'Endpoints: IPv4', conversations: 'Conversations', io: 'I/O Graph' };
async function doCapfile(i, m) {
  await tab('Capture');
  const def = lab.captureFiles.find((f) => f.id === m.capfile);
  const pick = page.locator('.capfile-files select');
  if (await pick.count()) await pick.selectOption({ label: def.name });
  else if (!(await page.locator('.capfile-files', { hasText: def.name }).count())) await fail(i, `the Capture tab doesn't offer ${def.name}`);
  log(`  open ${def.name}`);
  const filter = async (text) => {
    await page.locator('.capfile .capture-filter input').fill(text);
    await page.keyboard.press('Enter');
    if (await page.locator('.capfile .filter-msg:not(.muted)').count()) await fail(i, `the filter bar turned away "${text}"`);
  };
  const list = async () => {
    const b = page.locator('.capfile-views button', { hasText: 'Packet list' });
    if (await b.count()) await b.click();
  };
  if (m.filter !== undefined) {
    await filter(m.filter);
    log(`  filter "${m.filter}"`);
  }
  if (m.stats) {
    await page.locator('.capfile-views button', { hasText: STATS_LABEL[m.stats] }).click();
    log(`  Statistics: ${STATS_LABEL[m.stats]}`);
  }
  if (m.follow !== undefined) {
    // A student filters to the conversation, opens one of its packets, and presses Follow TCP Stream.
    await filter(`tcp.stream == ${m.follow}`);
    await list();
    await page.locator('.capfile-table tbody tr[data-no]').first().click();
    await page.getByRole('button', { name: 'Follow TCP Stream' }).click();
    if (!(await page.locator('.capfile-follow').count())) await fail(i, `Follow TCP Stream ${m.follow} didn't open`);
    log(`  follow TCP stream ${m.follow}`);
  }
  if (m.packet !== undefined) {
    // The list draws only the rows on screen: scroll the packet into view first (no filter is on).
    await list();
    await page.locator('.capfile-list').evaluate((el, no) => (el.scrollTop = (no - 1) * 30 - 60), m.packet);
    await page.waitForTimeout(100);
    const row = page.locator(`.capfile-table tbody tr[data-no="${m.packet}"]`);
    if (!(await row.count())) await fail(i, `packet ${m.packet} isn't in the list`);
    await row.click();
    log(`  open packet ${m.packet}`);
  }
}

/**
 * Firewall rulebook edits (firewall, firewall-types), in the device's
 * inspector the way a student makes them: the Type buttons, Add a rule and its
 * form, the arrows, Delete, and the Intrusion prevention switch. The model
 * session hasn't played this move yet, so it says where each rule sits now.
 */
async function doFirewall(i, a) {
  await device(a.device).locator('rect.device-card').first().click({ force: true });
  await tab('Inspect');
  const sec = page.locator('.inspector .fw-section').first();
  await sec.waitFor();
  const name = labels[a.device];
  const at = (id) => model.sim.dev(a.device).firewall.rules.findIndex((r) => r.id === id);
  if (a.type === 'fw-mode') {
    await sec.locator('.fw-mode .seg button', { hasText: new RegExp(`^${MODE_NAME[a.mode]}$`) }).click();
    log(`  ${name}: type ${MODE_NAME[a.mode]}`);
  } else if (a.type === 'fw-add-rule') {
    const r = a.rule;
    await sec.locator('.fw-add').click();
    const form = sec.locator('.fw-form');
    await form.locator('select[aria-label="Action"]').selectOption(r.action);
    await form.locator('select[aria-label="Direction"]').selectOption(r.dir);
    await form.locator('select[aria-label="Protocol"]').selectOption(r.proto);
    await form.locator('input[aria-label="Source address"]').fill(String(r.src));
    await form.locator('input[aria-label="Destination address"]').fill(String(r.dst));
    if (r.proto !== 'icmp') {
      await form.locator('input[aria-label="Source port"]').fill(String(r.sport ?? 'any'));
      await form.locator('input[aria-label="Destination port"]').fill(String(r.dport));
    }
    if (r.app && r.app !== 'any') await form.locator('select[aria-label="Program"]').selectOption(r.app);
    await form.getByRole('button', { name: 'Add rule', exact: true }).click();
    await page.waitForTimeout(150);
    if (await sec.locator('.fw-form').count()) await fail(i, `the rule form refused the answer key's rule: ${(await sec.innerText()).split('\n').slice(-3).join(' ')}`);
    // Then the up arrows to reach `at`.
    let n = await sec.locator('button[aria-label^="Move rule"][aria-label$=" up"]').count();
    while (a.at !== undefined && n > a.at + 1) {
      await sec.getByRole('button', { name: `Move rule ${n} up`, exact: true }).click();
      n--;
    }
    log(`  ${name}: add rule ${r.action} ${r.dir} ${r.proto} ${r.src}${r.sport ? `:${r.sport}` : ''} -> ${r.dst}:${r.dport}${r.app ? ` (${r.app})` : ''}${a.at !== undefined ? `, moved to rule ${a.at + 1}` : ''}`);
  } else if (a.type === 'fw-move-rule') {
    let n = at(a.id);
    if (n < 0) await fail(i, `no rule ${a.id} on ${name}`);
    const from = n;
    while (n > a.to) await sec.getByRole('button', { name: `Move rule ${n-- + 1} up`, exact: true }).click();
    while (n < a.to) await sec.getByRole('button', { name: `Move rule ${n++ + 1} down`, exact: true }).click();
    log(`  ${name}: move rule ${from + 1} to ${a.to + 1}`);
  } else if (a.type === 'fw-delete-rule') {
    const n = at(a.id);
    if (n < 0) await fail(i, `no rule ${a.id} on ${name}`);
    await sec.locator('.fw-table tbody tr').nth(n).getByRole('button', { name: 'Delete', exact: true }).click();
    log(`  ${name}: delete rule ${n + 1}`);
  } else if (a.type === 'fw-ips') {
    const sw = sec.locator('.fw-ips [role="switch"]');
    if ((await sw.getAttribute('aria-checked')) !== String(a.on)) await sw.click();
    log(`  ${name}: intrusion prevention ${a.on ? 'on' : 'off'}`);
  } else throw new Error(`clickthrough has no UI driver for tool action "${a.type}". Add one in doFirewall.`);
}

async function doMove(i, step, m) {
  if (await moreMoves({ page, log, fail, tab, device, labels, model, vite }, i, step, m)) {
    // drivers.mjs drove it.
  } else if ('capfile' in m) {
    await doCapfile(i, m);
  } else if ('inspect' in m) {
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
    } else if (a.type.startsWith('ids-') || a.type === 'siem-triage' || a.type === 'ai-threshold') {
      await doDetection(i, a);
    } else if (a.type.startsWith('bench-')) {
      await doBench(i, a);
    } else if (a.type === 'port-security') {
      // The switch's Ports and port security section: Edit on the port, the toggle, the fields, Save.
      await device(a.device).locator('rect.device-card').first().click({ force: true });
      await tab('Inspect');
      const sec = page.locator('section.switch-ports');
      const name = a.port.replace(/^p(\d+)$/, 'port $1');
      const row = sec.locator('tbody tr').filter({ has: page.locator('td', { hasText: new RegExp(`^${name}$`) }) });
      await row.getByRole('button', { name: 'Edit' }).click();
      const ed = sec.locator('.port-edit');
      const tog = ed.getByRole('switch');
      if ((await tog.getAttribute('aria-checked')) !== String(!!a.config)) await tog.click();
      if (a.config) {
        await ed.locator('input').first().fill(String(a.config.maxMacs));
        await ed.locator('select').selectOption(a.config.violation);
        if (a.config.allowed) await ed.locator('input').nth(1).fill(a.config.allowed.join(' '));
      }
      await ed.getByRole('button', { name: /^Save/ }).click();
      log(`  port security on ${labels[a.device]} ${name}: ${a.config ? `${a.config.maxMacs} MAC, ${a.config.violation}` : 'off'}`);
    } else if (a.type === 'mac-flood') {
      await tab('Toolkit');
      const card = page.locator('.tool-card', { hasText: `MAC flooder (${labels[a.device]})` });
      await card.getByRole('group', { name: 'How many bursts' }).getByRole('button', { name: String(a.bursts), exact: true }).click();
      await card.getByRole('button', { name: 'Flood' }).click();
      log(`  MAC flood from ${labels[a.device]}: ${a.bursts} bursts`);
    } else if (a.type === 'set-mac') {
      await tab('Toolkit');
      const card = page.locator('.tool-card', { hasText: `MAC changer (${labels[a.device]})` });
      if (a.mac === null) await card.getByRole('button', { name: /factory MAC/ }).click();
      else {
        await card.getByLabel('New MAC address').fill(a.mac);
        await card.getByRole('button', { name: 'Change MAC' }).click();
      }
      log(`  MAC on ${labels[a.device]}: ${a.mac ?? 'factory'}`);
    } else if (a.type === 'set-zone' || a.type === 'set-zone-level') {
      // The Toolkit's Zone plan card: one select per computer, one per zone.
      await tab('Toolkit');
      const card = page.locator('.tool-card.zone-plan');
      if (a.type === 'set-zone') await card.getByLabel(`Zone for ${labels[a.device]}`, { exact: true }).selectOption(a.zone ?? '');
      else {
        const label = step.tools?.find((t) => t.kind === 'zone-plan')?.zones.find((z) => z.id === a.zone)?.label ?? a.zone;
        await card.getByLabel(`Security level for ${label}`, { exact: true }).selectOption(a.level ?? '');
      }
      log(`  zone plan: ${a.type === 'set-zone' ? `${labels[a.device]} in ${a.zone}` : `${a.zone} is ${a.level}`}`);
    } else if (a.type === 'set-zone-policy') {
      await device(a.device).locator('rect.device-card').first().click({ force: true });
      await tab('Inspect');
      const zp = built[a.device].zonePolicy;
      await page.locator('section.zone-policy').getByLabel(pairName(zp, a.from, a.to), { exact: true }).selectOption(a.value);
      log(`  zone policy on ${labels[a.device]}: ${pairName(zp, a.from, a.to)} ${a.value}`);
    } else if (a.type === 'set-vlan') {
      await device(a.device).locator('rect.device-card').first().click({ force: true });
      await tab('Inspect');
      await page.locator('section.vlans').getByLabel(`VLAN for ${portLabel(a.iface)}`, { exact: true }).selectOption(String(a.vlan));
      log(`  VLAN ${a.vlan} on ${labels[a.device]} ${portLabel(a.iface)}`);
    } else if (a.type === 'set-ip' || a.type === 'gateway') {
      // Device settings in the inspector: the address box and its Save, or the default gateway box.
      await device(a.device).locator('rect.device-card').first().click({ force: true });
      await tab('Inspect');
      const where = a.type === 'gateway' ? `Default gateway for ${labels[a.device]}` : `IP address for ${built[a.device].ifaces.length > 1 ? `${labels[a.device]} ${portName(a.iface)}` : labels[a.device]}`;
      const box = page.getByLabel(where, { exact: true });
      await box.fill(a.type === 'gateway' ? a.ip : (a.cidr ?? ''));
      await box.press('Enter');
      const bad = await box.getAttribute('aria-invalid');
      if (bad === 'true') await fail(i, `${where} turned the value away`);
      log(`  ${where}: ${a.type === 'gateway' ? a.ip : a.cidr}`);
    } else if (a.type.startsWith('fw-') && a.type !== 'fw-place' && a.type !== 'fw-unplace') {
      await doFirewall(i, a);
    } else if (a.type === 'fw-place') {
      await tab('Toolkit');
      const pick = page.locator(`select[aria-label="Cable for ${labels[a.device]}"]`);
      const values = await pick.locator('option').evaluateAll((os) => os.map((o) => o.value));
      const value = values.find((v) => v === `${a.a}~${a.b}` || v === `${a.b}~${a.a}`);
      if (!value) await fail(i, `no cable ${labels[a.a]} to ${labels[a.b]} in the list for ${labels[a.device]}`);
      await pick.selectOption(value);
      await page.locator('.place-row', { has: pick }).getByRole('button', { name: 'Place', exact: true }).click();
      log(`  place ${labels[a.device]} between ${labels[a.a]} and ${labels[a.b]}`);
    } else if (a.type === 'scan') {
      await tab('Toolkit');
      const box = page.locator('input[aria-label="Address or network to scan"]');
      await box.fill(a.target);
      await box.press('Enter');
      log(`  scan ${a.target}`);
    } else if (a.type === 'connect') {
      await tab('Toolkit');
      const btn = page.locator(`button[title="Connect to ${a.to} port ${a.port}"]`).first();
      if (!(await btn.count())) await fail(i, `no Connect button for ${a.to} port ${a.port} in the scan results`);
      await btn.click();
      log(`  connect to ${a.to} port ${a.port}`);
    } else if (a.type === 'linux') {
      // device-analysis: the Sign-in defenses card's switches.
      await tab('Toolkit');
      const name = a.setting === 'fail2ban' ? 'fail2ban' : 'Allow password sign-in';
      const sw = page.locator('.sshg-card').getByRole('switch', { name });
      if ((await sw.getAttribute('aria-checked')) === String(a.on)) await fail(i, `${name} is already ${a.on ? 'on' : 'off'}`);
      await sw.click();
      log(`  turn ${name} ${a.on ? 'on' : 'off'}`);
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
  } else if ('openLog' in m) {
    await openLog(i, step, m);
  } else if ('demo' in m) {
    await doDemo(m.demo, m.input);
  } else throw new Error(`clickthrough has no UI driver for move ${JSON.stringify(m)}. Add one in doMove.`);
  await page.waitForTimeout(200);
  if (!(await settle())) await fail(i, 'the network never went quiet after the last move');
}

async function answer(i, step) {
  const key = sol[step.id] ?? {};
  for (const q of step.questions ?? []) {
    // On an answer sheet a question is a row (.sheet-q) with a one-line box or a text box.
    const card = page.locator(lab.worksheet ? '.sheet-q' : '.qcard').filter({ hasText: q.prompt.replace(/\*\*|`/g, '').split('\n')[0].slice(0, 40) }).first();
    if ((await card.count()) === 0) await fail(i, `question "${q.id}" isn't on screen (still locked?)`);
    if (q.kind === 'choice') {
      // Exact, so an answer of "0" doesn't pick the option "100".
      for (const o of q.options.filter((o) => o.correct)) await card.locator('.option', { hasText: new RegExp(`^\\s*${o.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first().click();
      await card.getByRole('button', { name: 'Check', exact: true }).click();
    } else {
      const text = key.text?.[q.id];
      if (text === undefined) throw new Error(`No answer-key text for ${step.id}/${q.id}`);
      await card.locator('textarea, input.sheet-input').first().fill(text);
      if (q.expect) await card.getByRole('button', { name: 'Check', exact: true }).click();
    }
    await page.waitForTimeout(150);
    if (await card.evaluate((el) => el.classList.contains('wrong'))) await fail(i, `the answer key's answer to "${q.id}" was marked wrong`);
  }
}

/**
 * An answer sheet (LabDef.worksheet) is one page: type every answer, hand it
 * in with the real button, and read the report file that downloads.
 */
async function worksheet() {
  await page.waitForSelector('.worksheet');
  log(`${lab.title}: answer sheet, ${lab.steps.length - 1} sections`);
  await page.waitForTimeout(300);
  for (let i = 0; i < lab.steps.length; i++) {
    const step = lab.steps[i];
    if (step.kind === 'submit') continue;
    log(`section ${step.title}`);
    await answer(i, step).catch((e) => fail(i, String(e.message ?? e).split('\n')[0]));
  }
  const left = (await page.locator('.sheet-blank').count()) ? await page.locator('.sheet-blank').innerText() : '';
  if (left) await fail(lab.steps.length - 1, `Hand it in still lists blank questions: ${left.replace(/\s+/g, ' ')}`);
  const total = await page.locator('.sheet-side-total, .sheet-nav-total').filter({ visible: true }).first().innerText();
  log(`  ${total}`);
  const downloading = page.waitForEvent('download', { timeout: 10000 });
  await page.locator('.sheet-hand-in .submit-box .btn.primary').click();
  const file = await (await downloading).path();
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(file, 'utf8');
  for (const step of lab.steps)
    for (const q of step.questions ?? []) {
      const want = sol[step.id]?.text?.[q.id] ?? '';
      const esc = want.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      if (!html.includes(`<b>${q.label}.</b>`) || !html.includes(esc)) await fail(lab.steps.length - 1, `the downloaded report is missing ${q.label ?? q.id} or its answer`);
    }
  log(`  handed in: the report has every question and answer (${(await downloading).suggestedFilename()})`);
  await page.screenshot({ path: join(OUT, 'handed-in.png') });
  log('done: every answer can be typed and handed in');
}

/** A guided lab or lesson: every step's moves, goals, and questions, then Continue. */
async function guided() {
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
    if (step.kind === 'submit') {
      // A coding lab goes on into its optional extra challenge. A network lab stops here.
      if (lab.build || !lab.steps[i + 1]?.extra) break;
      await page.getByRole('button', { name: 'Optional extra challenge' }).click();
      model.goTo(i + 1);
      continue;
    }
    // The model session plays each move too, so openFrame knows its row.
    for (const m of sol[step.id]?.moves ?? []) {
      await doMove(i, step, m);
      playMove(model, m);
    }
    if (process.env.EACH) {
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `step-${String(i + 1).padStart(2, '0')}-${step.id}-done.png`) });
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
    if (i === lab.steps.length - 1) break;
    const cont = page.getByRole('button', { name: 'Continue' });
    if (!(await cont.count())) {
      const why = await page.locator('.lesson .btn.primary.big').innerText().catch(() => '?');
      await fail(i, `Continue is not available: "${why.trim()}"`);
    }
    await cont.click();
    model.goTo(i + 1);
  }
  log(`done: every step${only ? ' through ' + lab.steps[lastIndex].id : ''} can be completed in the app`);
}

try {
  await page.goto(`${url}#/lab/${lab.id}`);
  if (lab.worksheet) await worksheet();
  else await guided();
  for (const p of problems) console.log(`  note: ${p}`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
  await vite.close();
}
