import { describe, expect, it } from 'vitest';
import { LABS } from '../labs';
import { reportFileName } from './fileName';

// Characters Windows refuses in a file name; macOS and Chrome (ChromeOS too) also rewrite the colon.
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f]/;

describe('reportFileName', () => {
  it('drops the colon from a title and keeps commas and periods', () => {
    expect(reportFileName('Riley Seeded', 'Home Network: Switching, DHCP, and NAT')).toBe('Riley Seeded - Home Network Switching, DHCP, and NAT.html');
    expect(reportFileName('Riley Seeded', 'p5.js: Animation')).toBe('Riley Seeded - p5.js Animation.html');
    expect(reportFileName('Riley Seeded', 'Lab 3.1 - Hijacked SSH and Mitigation Part 1')).toBe('Riley Seeded - Lab 3.1 - Hijacked SSH and Mitigation Part 1.html');
  });

  it('cleans the student name and falls back when nothing is left', () => {
    expect(reportFileName('  Jo/Ann  O\'Neil? ', 'JavaScript Loops')).toBe('JoAnn ONeil - JavaScript Loops.html');
    expect(reportFileName('???', '???')).toBe('student - lab.html');
  });

  it('gives every lab a file name that saves the same on Windows, macOS, and ChromeOS', () => {
    for (const lab of LABS) {
      const file = reportFileName('Riley Seeded', lab.title);
      expect(file, lab.id).not.toMatch(UNSAFE);
      expect(file, lab.id).not.toMatch(/ {2}|\.\.html$| \.html$/);
      expect(file.length, lab.id).toBeLessThan(120);
    }
  });
});
