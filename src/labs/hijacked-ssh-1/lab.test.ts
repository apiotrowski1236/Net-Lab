import { describe, expect, it } from 'vitest';
import { hijackedSsh1Lab as lab } from '.';

describe('hijacked-ssh-1 answer sheet', () => {
  it('is named like the handout', () => {
    expect(lab.title).toBe('Lab 3.1 - Hijacked SSH and Mitigation Part 1');
    expect(lab.worksheet?.link?.url).toBe('https://apps.cyber.org');
  });

  it("has the handout's sections, and a question for each numbered item that asks for something", () => {
    const sections = lab.steps.filter((s) => s.kind !== 'submit');
    expect(sections.map((s) => s.title)).toEqual([
      'A. Examine the Recon File',
      'B. Looking for the Key',
      'C. Using John the Ripper (JtR) and the RSA Key',
      'D. Putting It All Together',
    ]);
    expect(sections.map((s) => (s.questions ?? []).map((q) => q.label))).toEqual([
      ['A1', 'A5', 'A7'],
      ['B1', 'B2', 'B5'],
      ['C1', 'C5', 'C6'],
      ['D1', 'D2', 'D3'],
    ]);
  });

  it('gives one-line boxes to answers that are a single thing, and text boxes to the rest', () => {
    const short = lab.steps.flatMap((s) => (s.questions ?? []).filter((q) => q.kind === 'text' && q.short).map((q) => q.label));
    expect(short).toEqual(['A1', 'A5', 'B1', 'C5']);
  });

  it('leaves every answer to the teacher, since answers differ from one range to the next', () => {
    for (const s of lab.steps) for (const q of s.questions ?? []) expect(q.kind === 'text' && !q.expect, q.id).toBe(true);
  });
});
