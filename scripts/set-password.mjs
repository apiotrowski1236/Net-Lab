// Set the teacher override password.
//
//   npm run set-password            asks for the password
//   npm run set-password -- --off   turns the override off
//
// Writes a salted SHA-256 hash (never the password) to public/config.json as
// "teacherPasswordHash". Rebuild and deploy afterward, or paste the same line
// into config.json on the live site.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

// Keep in sync with OVERRIDE_SALT in src/store/override.ts.
const SALT = 'netlab-teacher-override:v1:';
const FILE = 'public/config.json';

const config = JSON.parse(readFileSync(FILE, 'utf8'));

if (process.argv.includes('--off')) {
  config.teacherPasswordHash = '';
  writeFileSync(FILE, JSON.stringify(config, null, 2) + '\n');
  console.log(`Teacher override turned off in ${FILE}.`);
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = (await rl.question('New teacher override password: ')).trim();
rl.close();
if (password.length < 8) {
  console.error('Use at least 8 characters. Students can see the hash, so a short password is easy to guess.');
  process.exit(1);
}

config.teacherPasswordHash = createHash('sha256').update(SALT + password, 'utf8').digest('hex');
writeFileSync(FILE, JSON.stringify(config, null, 2) + '\n');
console.log(`Saved to ${FILE}:\n  "teacherPasswordHash": "${config.teacherPasswordHash}"\nRebuild and deploy (or paste that line into config.json on the live site).`);
