// More click-through drivers, kept out of clickthrough.mjs so labs built in
// parallel can each add theirs without colliding. clickthrough.mjs asks
// `moreMoves` first; it returns true when it handled the move.
//
// Covers: the Wi-Fi scanner (and its watch mode marks), Wi-Fi settings in the
// inspector, the Wi-Fi cracker, triangulation, packet capture on/off (sniffer),
// IP forwarding, the ARP spoofer, ARP locks (on-path), Cables > Unplug,
// shutting a switch port, the wireless alarms card, and the
// Logs tab (open a line, cite a line), and the smurf Echo tool and
// Directed broadcasts switch, and net-audit's vulnerability scanner, risk
// register, and Security settings.

const SECURITY = { open: 'Open', wep: 'WEP', wpa: 'WPA', wpa2: 'WPA2', wpa3: 'WPA3' };
const POWER = { 1: 'Lowest', 2: 'Low', 3: 'High', 4: 'Highest' };

/**
 * @param c { page, log, fail, tab, device, labels, model, vite }
 * @returns true if this module drove the move
 */
export async function moreMoves(c, i, step, m) {
  // A click that times out still gets the failure screenshot and the step's name.
  try {
    return await drive(c, i, step, m);
  } catch (e) {
    if (e?.name !== 'TimeoutError') throw e;
    await c.fail(i, String(e.message ?? e).split('\n')[0]);
  }
}

async function drive(c, i, step, m) {
  const { page, log, fail, tab, device, labels, model } = c;

  /** Click a device on the map and show its inspector. */
  const inspector = async (id) => {
    await device(id).locator('rect.device-card').first().click({ force: true });
    await tab('Inspect');
    await page.waitForSelector('.inspector, .dock-body section', { timeout: 5000 }).catch(() => {});
  };
  /** Turn a Toggle (role=switch) to `on` if it isn't already. */
  const toggle = async (sw, on) => {
    if ((await sw.getAttribute('aria-checked')) !== String(on)) await sw.click();
  };
  const card = (text) => page.locator('.tool-card', { hasText: text }).first();

  /** The newest log line the move means, found in the model (same network as the browser). */
  const logLine = async (devId, where) => {
    const hit = [...model.sim.dev(devId).logs].reverse().find(where);
    if (!hit) await fail(i, `no log line on ${labels[devId]} matches the move`);
    await tab('Logs');
    const rows = page.locator('.logs-table tbody tr').filter({ hasText: hit.msg });
    if (!(await rows.count())) await fail(i, `the Logs tab has no row "${hit.msg}"`);
    await rows.last().click();
    return hit;
  };

  if ('openLog' in m) {
    const hit = await logLine(m.openLog, m.where);
    log(`  open log line: ${hit.msg}`);
    return true;
  }
  if ('citeLog' in m) {
    const hit = await logLine(m.citeLog, m.where);
    const btn = page.locator('.log-cite-btn');
    if (!(await btn.count())) await fail(i, 'no Cite button under the opened line');
    if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
    log(`  cite log line: ${hit.msg}`);
    return true;
  }
  if ('openFinding' in m) {
    // net-audit: open a finding in the scanner's newest report.
    await tab('Toolkit');
    const { findingName } = await c.vite.ssrLoadModule('/src/sim/audit.ts');
    const btn = card('Vulnerability scanner').locator('.audit-finding-row', { hasText: findingName(m.id) });
    if (!(await btn.count())) await fail(i, `the scanner's report has no ${findingName(m.id)} finding`);
    if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
    log(`  open finding: ${findingName(m.id)}`);
    return true;
  }
  if (!('tool' in m)) return false;

  const a = m.tool;
  if (await auditMove(c, i, step, a)) return true;
  switch (a.type) {
    case 'wifi-scan': {
      await tab('Toolkit');
      const k = card('Wi-Fi scanner');
      const pick = k.locator('.seg').first().getByRole('button', { name: labels[a.device], exact: true });
      // Picking a spot scans from it. With one spot there is only the Scan button.
      if (await pick.count()) await pick.click();
      else await k.getByRole('button', { name: `Scan from ${labels[a.device]}`, exact: true }).click();
      log(`  scan the air from ${labels[a.device]}`);
      return true;
    }
    case 'wids-mark': {
      await tab('Toolkit');
      const row = card('Wi-Fi scanner').locator('tr', { hasText: a.bssid });
      if (!(await row.count())) await fail(i, `the scanner shows no row for ${a.bssid}: scan first`);
      const want = a.mark === 'approved' ? 'On the list' : 'Not on it';
      const btn = row.getByRole('button', { name: want, exact: true });
      if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
      log(`  mark ${a.bssid}: ${want}`);
      return true;
    }
    case 'wifi-measure': {
      await tab('Toolkit');
      const k = card('Signal triangulation');
      await k.locator('select').selectOption(a.bssid);
      const spots = (step.tools ?? []).find((t) => t.kind === 'triangulate')?.spots ?? [];
      const spot = spots.find((s) => s.x === a.x && s.y === a.y);
      if (!spot) await fail(i, `no triangulation spot at ${a.x},${a.y}`);
      await k.locator('button', { hasText: `Measure from ${spot.label}` }).click();
      log(`  measure ${a.bssid} from ${spot.label}`);
      return true;
    }
    case 'wifi-crack': {
      await tab('Toolkit');
      const bssid = model.sim.dev(a.ap).wifi.bssid;
      await card('Wi-Fi cracker').locator('.crack-row', { hasText: bssid }).locator('button').click();
      log(`  try to crack ${labels[a.ap]}`);
      return true;
    }
    case 'sniff': {
      await tab('Toolkit');
      await toggle(card(`Packet capture (${labels[a.device]})`).getByRole('switch'), a.on);
      log(`  packet capture on ${labels[a.device]}: ${a.on ? 'on' : 'off'}`);
      return true;
    }
    case 'forward': {
      await tab('Toolkit');
      await toggle(card(`IP forwarding (${labels[a.device]})`).getByRole('switch'), a.on);
      log(`  IP forwarding on ${labels[a.device]}: ${a.on ? 'on' : 'off'}`);
      return true;
    }
    case 'arp-spoof': {
      await tab('Toolkit');
      const c = card('ARP spoofer');
      await c.getByLabel('Device to fool', { exact: true }).selectOption({ label: labels[a.victim] });
      await c.getByLabel('IP address to claim', { exact: true }).fill(a.claimIp);
      await c.getByRole('button', { name: 'Send fake ARP reply' }).click();
      if ((await c.getByLabel('IP address to claim', { exact: true }).getAttribute('aria-invalid')) === 'true') await fail(i, `the ARP spoofer turned away ${a.claimIp}`);
      log(`  fake ARP reply to ${labels[a.victim]}: ${a.claimIp} is at ${labels[a.device]}`);
      return true;
    }
    case 'static-arp': {
      await tab('Toolkit');
      const c = card(`Lock ARP entries (${labels[a.device]})`);
      await c.getByLabel('IP address to lock', { exact: true }).fill(a.ip);
      await c.getByLabel('MAC address', { exact: true }).fill(a.mac);
      await c.getByRole('button', { name: 'Lock it' }).click();
      if ((await c.locator('.tool-msg.bad, .msg.bad').count()) > 0) await fail(i, `Lock it turned away ${a.ip} at ${a.mac}`);
      log(`  lock ${a.ip} to ${a.mac} on ${labels[a.device]}`);
      return true;
    }
    case 'unplug': {
      await tab('Toolkit');
      const item = card('Cables').locator('.tool-list li', { hasText: labels[a.device] }).first();
      if (!(await item.count())) await fail(i, `no cable to ${labels[a.device]} in the Cables list`);
      await item.getByRole('button', { name: 'Unplug' }).click();
      log(`  unplug ${labels[a.device]}`);
      return true;
    }
    case 'port-shutdown': {
      await inspector(a.device);
      const where = a.port.replace(/^p(\d+)$/, 'port $1');
      // Ports and port security's own row: a VLANs table on the same switch lists the same ports.
      const row = page.locator('section.switch-ports tr', { has: page.locator('td', { hasText: new RegExp(`^${where}$`) }) }).first();
      await row.getByRole('button', { name: 'Edit' }).click();
      await page.locator('.port-edit').getByRole('button', { name: a.shut ? 'Shut port down' : 'Turn port on' }).click();
      log(`  ${a.shut ? 'shut' : 'turn on'} ${where} on ${labels[a.device]}`);
      return true;
    }
    case 'wifi-passphrase': {
      await inspector(a.device);
      const pass = page.locator('section.wifi-settings .wifi-field', { has: page.locator('label', { hasText: /^Passphrase$/ }) });
      await pass.locator('input').fill(a.passphrase);
      await pass.getByRole('button', { name: 'Save', exact: true }).click();
      log(`  save passphrase on ${labels[a.device]}`);
      return true;
    }
    case 'wifi-power':
    case 'wifi-security':
    case 'wifi-auth':
    case 'wifi-wps':
    case 'wifi-beacon':
    case 'wifi-macfilter': {
      await inspector(a.device);
      const sec = page.locator('section.wifi-settings');
      // A field is found by its own label, since help text under one field can name another.
      const field = (name) => sec.locator('.wifi-field', { has: page.locator('label', { hasText: new RegExp(`^${name}$`) }) });
      const sw = (name) => sec.getByRole('switch', { name });
      if (a.type === 'wifi-power') await field('Signal strength').getByRole('button', { name: POWER[a.power], exact: true }).click();
      else if (a.type === 'wifi-auth') await field('Who may join').getByRole('button', { name: a.auth === 'eap' ? 'Per-user login (EAP)' : 'Shared passphrase', exact: true }).click();
      else if (a.type === 'wifi-wps') await toggle(sw(/^WPS/), a.on);
      else if (a.type === 'wifi-beacon') await toggle(sw(/Broadcast the name|Broadcasting the name|Name hidden/), a.on);
      else if (a.type === 'wifi-macfilter') await toggle(sw(/^MAC filter/), a.on);
      else {
        await field('Security').getByRole('button', { name: SECURITY[a.security], exact: true }).click();
        if (a.passphrase !== undefined) {
          const pass = field('Passphrase');
          await pass.locator('input').fill(a.passphrase);
          await pass.getByRole('button', { name: 'Save', exact: true }).click();
        }
      }
      log(`  ${a.type} on ${labels[a.device]}: ${JSON.stringify(a.power ?? a.security ?? a.auth ?? a.on)}`);
      return true;
    }
    case 'wids-rule': {
      await tab('Toolkit');
      const { RULE_TEXT } = await c.vite.ssrLoadModule('/src/sim/wids.ts');
      await toggle(page.locator('.wids-card').getByRole('switch', { name: RULE_TEXT[a.rule] }), a.on);
      log(`  alarm rule ${a.rule}: ${a.on ? 'on' : 'off'}`);
      return true;
    }
    case 'wids-threshold': {
      await tab('Toolkit');
      await page.locator('.wids-card .wids-threshold').getByRole('button', { name: String(a.level), exact: true }).click();
      log(`  noise alarm level ${a.level}`);
      return true;
    }
    case 'wids-replay': {
      await tab('Toolkit');
      await page.locator('.wids-card').getByRole('button', { name: /Replay the last/ }).click();
      log('  replay the record');
      return true;
    }
    case 'echo': {
      // smurf: the Echo tool card, with an optional forged source.
      await tab('Toolkit');
      const k = card('Echo tool');
      await k.getByLabel('Target IP address', { exact: true }).fill(a.target);
      await k.getByLabel('Source IP address to forge', { exact: true }).fill(a.source ?? '');
      await k.getByRole('button', { name: 'Send', exact: true }).click();
      if (await k.locator('.tool-msg.bad').count()) await fail(i, `the Echo tool refused ${a.target}: ${await k.locator('.tool-msg.bad').innerText()}`);
      log(`  echo ${a.target}${a.source ? ` from forged ${a.source}` : ''}`);
      return true;
    }
    case 'directed-broadcast': {
      // smurf: the Directed broadcasts switch in the router's inspector.
      await inspector(a.device);
      await toggle(page.getByRole('switch', { name: /directed broadcasts/ }), a.on);
      log(`  directed broadcasts on ${labels[a.device]} ${a.on ? 'on' : 'off'}`);
      return true;
    }
    default:
      return false;
  }
}

const HARDEN_ROW = { telnet: /^Telnet/, ssh: /^SSH/ };
const VPN_AUTH = { password: 'Password only', key: 'Key file', mfa: 'Password + MFA' };

/**
 * net-audit. The scanner and the risk register are Toolkit cards. Security
 * settings (Hardening.tsx) is an inspector section where one switch sends
 * several actions: MAC filtering sets port security on every desk port, and
 * Shut ports nobody uses shuts every empty port. The answer key lists each
 * action, so the first move flips the switch and the rest find it already set.
 */
async function auditMove(c, i, step, a) {
  const { page, log, fail, tab, device, labels } = c;
  const card = (text) => page.locator('.tool-card', { hasText: text }).first();
  if (a.type === 'audit-scan') {
    await tab('Toolkit');
    const btn = card('Vulnerability scanner').locator('.btn.primary');
    await btn.click();
    // The next move may rate the findings, so wait for the report.
    await page.waitForFunction((el) => !el.disabled, await btn.elementHandle(), { timeout: 90000 });
    log(`  run the vulnerability scan from ${labels[a.device]}`);
    return true;
  }
  if (a.type === 'rate-risk') {
    await tab('Toolkit');
    const { findingName } = await c.vite.ssrLoadModule('/src/sim/audit.ts');
    const name = findingName(a.finding);
    const k = card('Risk register');
    if (a.likelihood) await k.getByLabel(`Likelihood: ${name}`, { exact: true }).selectOption(a.likelihood);
    if (a.impact) await k.getByLabel(`Impact: ${name}`, { exact: true }).selectOption(a.impact);
    log(`  rate ${name}: likelihood ${a.likelihood}, impact ${a.impact}`);
    return true;
  }
  const hardening = step.tools?.some((t) => t.kind === 'hardening' && t.device === a.device);
  if (!hardening || !['harden', 'fw-add-rule', 'port-security', 'port-shutdown', 'vpn-config'].includes(a.type)) return false;
  if (a.type === 'fw-add-rule' && a.rule?.note !== 'Policy: drop pings from the internet') return false;
  await device(a.device).locator('rect.device-card').first().click({ force: true });
  await tab('Inspect');
  const sec = page.locator('section.hardening');
  await sec.waitFor({ timeout: 5000 });
  const row = (label) => sec.locator('.harden-row').filter({ has: page.locator('.harden-label strong', { hasText: label }) }).getByRole('switch');
  const flip = async (label, on) => {
    const sw = row(label);
    if (!(await sw.count())) await fail(i, `Security settings on ${labels[a.device]} has no switch for ${label}`);
    if ((await sw.getAttribute('aria-checked')) !== String(on)) await sw.click();
  };
  if (a.type === 'harden') {
    if (a.setting === 'auth-server') {
      await sec.getByRole('group', { name: 'Where logins are checked' }).getByRole('button', { name: a.on ? 'Authentication server' : 'Local account', exact: true }).click();
    } else await flip(HARDEN_ROW[a.setting], a.on);
    log(`  ${labels[a.device]}: ${a.setting} ${a.on ? 'on' : 'off'}`);
  } else if (a.type === 'fw-add-rule') {
    await flip(/^Drop pings from the internet$/, true);
    log(`  ${labels[a.device]}: drop pings from the internet`);
  } else if (a.type === 'port-security') {
    if (a.config?.allowed?.length) await flip(/^MAC filtering$/, true);
    else await flip(/^Port security$/, !!a.config);
    log(`  ${labels[a.device]} ${a.port}: ${a.config ? (a.config.allowed?.length ? 'MAC filtering' : 'port security') : 'port security off'}`);
  } else if (a.type === 'port-shutdown') {
    await flip(/^Shut ports nobody uses$/, a.shut);
    log(`  ${labels[a.device]} ${a.port}: ${a.shut ? 'shut' : 'on'}`);
  } else {
    if (a.splitTunneling !== undefined) await flip(/^Split tunneling$/, a.splitTunneling);
    if (a.auth) await sec.getByRole('group', { name: 'VPN sign-in' }).getByRole('button', { name: VPN_AUTH[a.auth], exact: true }).click();
    log(`  ${labels[a.device]} VPN: ${a.splitTunneling === false ? 'split tunneling off' : ''}${a.auth ? ` sign-in ${VPN_AUTH[a.auth]}` : ''}`);
  }
  return true;
}
