import type { ChoiceOption, ChoiceQuestion } from './types';

/** FNV-1a: a small, stable string hash. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded random number generator. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The order to show a question's options in. Lab authors tend to write the
 * correct option first, so options are shuffled. The shuffle is seeded by the
 * question's place in the lab: every student, every reload, and the printed
 * guide see the same order. Options marked `last` stay at the end.
 */
export function shuffledOptions(labId: string, stepId: string, q: ChoiceQuestion): ChoiceOption[] {
  const free = q.options.filter((o) => !o.last);
  const pinned = q.options.filter((o) => o.last);
  const rand = rng(hash(`${labId}/${stepId}/${q.id}`));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  return [...free, ...pinned];
}
