import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Writes dist/sw.js after the build: a service worker that precaches every
 * built file so the whole site (all labs) works with no network connection.
 * The cache name is a hash of the build, so a new deploy replaces the old cache.
 */
function offlineServiceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'netlab-offline-sw',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) walk(path);
          else files.push(relative(outDir, path).split('\\').join('/'));
        }
      };
      walk(outDir);
      const assets = files.filter((f) => f !== 'sw.js' && f !== 'config.json').sort();
      const hash = createHash('sha256');
      for (const f of assets) {
        hash.update(f);
        hash.update(readFileSync(join(outDir, f)));
      }
      const version = hash.digest('hex').slice(0, 12);
      const template = readFileSync(resolve(import.meta.dirname, "sw/sw-template.js"), 'utf8');
      const sw = template
        .replace('__VERSION__', version)
        .replace('__ASSETS__', JSON.stringify(['./', ...assets.map((a) => './' + a)], null, 2));
      writeFileSync(join(outDir, 'sw.js'), sw);
      console.log(`[netlab] sw.js written: ${assets.length} files precached, version ${version}`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preact(), offlineServiceWorker()],
  build: {
    // Oldest browsers NetLab supports: Safari 14.1 (2021) and Chrome, Edge, and Firefox of the same age.
    target: ['es2020', 'safari14', 'chrome87', 'edge88', 'firefox78'],
    cssTarget: ['safari14', 'chrome87', 'edge88', 'firefox78'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as any);
