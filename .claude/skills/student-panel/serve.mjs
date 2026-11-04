// Serve the built app (dist/) for a student panel, and print the lab's address.
//
//   npm run build
//   node .claude/skills/student-panel/serve.mjs <lab-id>
//
// Picks a free port, so panels in different worktrees don't collide. Reads dist/
// from disk on every request with caching off, so after `npm run build` the next
// page load gets the new build without a restart. Writes the lab's address to
// /tmp/netlab-panel/<lab-id>/url and its process id to .../pid, and keeps running
// until killed: `kill $(cat /tmp/netlab-panel/<lab-id>/pid)`.
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const LAB = process.argv[2];
if (!LAB) throw new Error('Usage: node .claude/skills/student-panel/serve.mjs <lab-id>');
const root = process.cwd();
const dist = resolve(root, 'dist');
try {
  statSync(join(dist, 'index.html'));
} catch {
  throw new Error('No dist/index.html. Run `npm run build` first.');
}

// The lab's real address (#/<course>/lab/<id>), from the app's own routes.
const req = createRequire(join(root, 'package.json'));
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null,
  clear: () => mem.clear(),
  get length() {
    return mem.size;
  },
};
const vite = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
const { findLab } = await vite.ssrLoadModule('/src/labs/index.ts');
const { labHref } = await vite.ssrLoadModule('/src/routes.ts');
if (!findLab(LAB)) {
  await vite.close();
  throw new Error(`No lab with id "${LAB}"`);
}
const hash = labHref(LAB);
await vite.close();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

const server = createHttpServer((rq, rs) => {
  const path = decodeURIComponent(new URL(rq.url ?? '/', 'http://x').pathname);
  const file = normalize(join(dist, path.endsWith('/') ? `${path}index.html` : path));
  if (!file.startsWith(dist)) {
    rs.writeHead(403).end();
    return;
  }
  try {
    if (!statSync(file).isFile()) throw new Error('not a file');
  } catch {
    rs.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  rs.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(rs);
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/${hash}`;
  const dir = join('/tmp/netlab-panel', LAB);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'url'), `${url}\n`);
  writeFileSync(join(dir, 'pid'), `${process.pid}\n`);
  console.log(url);
});
