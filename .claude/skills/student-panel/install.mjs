// Install the student panel's subagents into ~/.claude/agents/, one per persona.
//
//   node .claude/skills/student-panel/install.mjs          install or update
//   node .claude/skills/student-panel/install.mjs --check  exit 1 if anything is missing or stale
//
// Each persona in personas.md becomes netlab-student-<id>.md, built from the
// student.md template. Each gets its own uniquely named Playwright MCP server,
// because Claude Code shares one connection among agents that use the same
// server name: unique names are what give every student a private browser.
//
// The agents live at user scope on purpose. Claude Code skips the MCP servers in
// a project agent's frontmatter unless that folder is trusted, and a fresh
// worktree never is. Agent definitions load when a session starts, so install
// before starting the session that runs the panel.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENTS = join(homedir(), '.claude', 'agents');
const MCP_VERSION = '0.0.84';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const check = process.argv.includes('--check');

/** personas.md: `## <id>` sections, settings bullets first, then the persona text. */
export function readPersonas() {
  const src = readFileSync(join(HERE, 'personas.md'), 'utf8');
  const out = [];
  for (const part of src.split(/^## /m).slice(1)) {
    const [head, ...rest] = part.split('\n');
    const id = head.trim();
    if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`personas.md: bad persona id "${id}"`);
    const set = {};
    const body = [];
    let inSettings = true;
    for (const line of rest) {
      const m = inSettings && /^- (\w+): (.+)$/.exec(line);
      if (m) set[m[1]] = m[2].trim();
      else {
        if (line.trim()) inSettings = false;
        if (!inSettings) body.push(line);
      }
    }
    for (const k of ['name', 'viewport', 'device', 'summary']) if (!set[k]) throw new Error(`personas.md: ${id} has no ${k}`);
    if (!/^\d+x\d+$/.test(set.viewport)) throw new Error(`personas.md: ${id} viewport must look like 1366x768`);
    out.push({ id, ...set, persona: body.join('\n').trim() });
  }
  if (!out.length) throw new Error('personas.md: no personas');
  return out;
}

const template = readFileSync(join(HERE, 'student.md'), 'utf8');
const render = (p) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = { ...p, mcpVersion: MCP_VERSION, chrome: CHROME }[k];
    if (v === undefined) throw new Error(`student.md: unknown placeholder {{${k}}}`);
    return v;
  });

const personas = readPersonas();
const want = new Map(personas.map((p) => [`netlab-student-${p.id}.md`, render(p)]));
mkdirSync(AGENTS, { recursive: true });
const have = readdirSync(AGENTS).filter((f) => /^netlab-student(-[\w-]+)?\.md$/.test(f));

let stale = 0;
for (const [file, text] of want) {
  const path = join(AGENTS, file);
  const same = existsSync(path) && readFileSync(path, 'utf8') === text;
  if (same) continue;
  stale++;
  if (check) console.log(`stale or missing: ${path}`);
  else {
    writeFileSync(path, text);
    console.log(`wrote ${path}`);
  }
}
for (const file of have) {
  if (want.has(file)) continue;
  stale++;
  if (check) console.log(`extra: ${join(AGENTS, file)}`);
  else {
    rmSync(join(AGENTS, file));
    console.log(`removed ${join(AGENTS, file)}`);
  }
}
if (check) {
  console.log(stale ? `${stale} agent file(s) need install.mjs` : `ok: ${personas.length} student agents installed`);
  process.exit(stale ? 1 : 0);
}
console.log(`${personas.length} student agents: ${personas.map((p) => `netlab-student-${p.id}`).join(', ')}`);
if (stale) console.log('Start a new session to use them: agent definitions load when a session starts.');
