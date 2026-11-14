import { loadCaptureFile, parsePacketList, type CaptureFile, type CaptureFileDef, type FileFrame } from '../sim/capfile';
import type { TextQuestion } from './types';

/**
 * Questions that ask for packet numbers (capture-analysis; reusable).
 *
 *   citeQuestion({
 *     id: 'cite',
 *     prompt: 'Which packets show the forged ARP replies? Type their numbers, like 412, 415.',
 *     file: FILES.arp,
 *     min: 2,
 *     fits: (c) => c.frame.arp?.op !== 'reply' ? 'is not an ARP reply.' : ... ? true : 'is the router's real reply.',
 *   })
 *
 * The student types numbers from the No. column ("412, 415", "412 and 415",
 * or a range, "1200-1250"). Each number is checked against `fits` on that
 * packet of the capture file: return true when it fits, or the reason it
 * doesn't, written to follow "Packet 415 " ("is a reply from the router's
 * real MAC."). The feedback names the first number that doesn't fit. It is
 * an ordinary auto-checked TextQuestion (an `expect` and a `verify`), so the
 * Guide, the report, and the answer sheet show it like any other.
 */
export interface CiteOpts {
  id: string;
  prompt: string;
  file: CaptureFileDef;
  fits: (c: FileFrame, file: CaptureFile) => true | string;
  /**
   * Packets that count neither for nor against the student: ordinary traffic
   * inside a range they typed (a flood with a few normal packets mixed in).
   * They don't count toward `min`. Return a string to say why, written like
   * `fits` ("is ordinary traffic sent during the flood."): when skipped
   * packets leave too few, the feedback names the first one with it.
   */
  skip?: (c: FileFrame, file: CaptureFile) => boolean | string;
  /** At least this many numbers (default 1). */
  min?: number;
  /** At most this many (default: no limit). Ranges count every number in them. */
  max?: number;
  /** What `min` means in words: "two packets". Default: "N packets". */
  minText?: string;
  explain?: string;
  placeholder?: string;
  points?: number;
  label?: string;
}

/** Check typed packet numbers against a capture file. Returns what to tell the student, or undefined when every number fits. */
export function checkCited(o: Pick<CiteOpts, 'file' | 'fits' | 'skip' | 'min' | 'max' | 'minText'>, value: string): string | undefined {
  const p = parsePacketList(value);
  if (!p.ok) return p.msg;
  const min = o.min ?? 1;
  const atLeast = `Type at least ${o.minText ?? (min === 1 ? 'one packet number' : `${min} packet numbers`)}.`;
  if (p.nums.length < min) return atLeast;
  if (o.max !== undefined && p.nums.length > o.max) return `Type no more than ${o.max} packet numbers: the ones that prove it.`;
  const file = loadCaptureFile(o.file);
  let fit = 0;
  let skipped: string | undefined;
  for (const n of p.nums) {
    const c = file.frames[n - 1];
    if (!c) return `There is no packet ${n} in ${file.name}. It has ${file.frames.length.toLocaleString('en-US')} packets.`;
    const skip = o.skip?.(c, file);
    if (skip) {
      skipped ??= `Packet ${n} ${typeof skip === 'string' ? skip : 'doesn’t count either way.'}`;
      continue;
    }
    const why = o.fits(c, file);
    if (why !== true) return `Packet ${n} ${why}`;
    fit++;
  }
  // Too few left: if skipped packets are why, name the first one, not only the count.
  if (fit < min) return skipped ? `${skipped} ${atLeast}` : atLeast;
  return undefined;
}

export function citeQuestion(o: CiteOpts): TextQuestion {
  return {
    id: o.id,
    kind: 'text',
    prompt: o.prompt,
    label: o.label,
    short: true,
    placeholder: o.placeholder ?? 'Packet numbers, like 412, 415',
    expect: /\d/,
    expectHint: 'Type packet numbers from the No. column, like 412, 415.',
    verify: (v) => checkCited(o, v),
    explain: o.explain,
    points: o.points,
  };
}
