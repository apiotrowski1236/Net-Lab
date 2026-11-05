import type { Profile } from './profile';
import { replaceProgress, type LabProgress } from './progress';
import { sha256Hex } from './sha256';
import { flushSaves } from './storage';

// Restore from a report file.
//
// Every downloaded report carries the student's full progress in an inert
// <script type="application/json"> block, so if the browser loses its saved
// data (Safari deletes it after 7 days of Safari use without a visit), the
// student can open the report on the home page and pick up where they left off.
//
// Copying deterrents (this is all client-side, so it slows down and exposes
// copying rather than making it impossible):
//  - The block is signed with a salted SHA-256. Editing the file, for example
//    to change the name in it, breaks the signature and the file is refused.
//  - Only a student signed in with the same name can open it.
//  - Every restore is recorded in the progress and shows on the report and in
//    the teacher's spreadsheet, with the name the file was saved under.
//  - Each lab attempt has a Work ID that survives a restore. Two students
//    handing in the same Work ID means one copied the other's file.

/** Changing this makes every existing backup unreadable. */
export const BACKUP_SALT = 'netlab-backup:v1:';
export const BACKUP_ELEMENT_ID = 'netlab-backup';

export interface BackupData {
  app: 'netlab-backup';
  v: 1;
  owner: { id: string; name: string; period: string };
  savedAt: number;
  progress: LabProgress;
}

/** What goes in the report: the data as an exact string, and its signature. */
export interface BackupBlock {
  data: string;
  sig: string;
}

export interface RestoreRecord {
  /** When it was restored. */
  at: number;
  /** When the file was saved. */
  savedAt: number;
  fromName: string;
  fromPeriod: string;
  fromId: string;
  /** Short fingerprint of the file, to match restores of the same file. */
  file: string;
}

export const sameName = (a: string, b: string) => normName(a) === normName(b) && normName(a) !== '';
const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** A short id for one student's attempt at one lab. Kept when the work is restored. */
export function workIdOf(p: LabProgress): string {
  if (!p.workId) p.workId = sha256Hex(`${p.studentId}/${p.labId}/${p.startedAt}`).slice(0, 10);
  return p.workId;
}

export function makeBackup(p: LabProgress, who: Profile, now = Date.now()): BackupBlock {
  workIdOf(p);
  const body: BackupData = { app: 'netlab-backup', v: 1, owner: { id: who.id, name: who.name, period: who.period }, savedAt: now, progress: p };
  const data = JSON.stringify(body);
  return { data, sig: sha256Hex(BACKUP_SALT + data) };
}

/** The block as a <script> tag for the report. Escaped so student text can't end the tag early. */
export function backupScript(b: BackupBlock): string {
  // JSON inside a non-JS script tag: only "</script" could break it, so escape every "<".
  const json = JSON.stringify(b).replace(/</g, '\\u003c');
  return `<script type="application/json" id="${BACKUP_ELEMENT_ID}">${json}</script>`;
}

export function extractBackup(html: string): BackupBlock | undefined {
  const m = new RegExp(`<script type="application/json" id="${BACKUP_ELEMENT_ID}">([\\s\\S]*?)</script>`).exec(html);
  if (!m) return undefined;
  try {
    const b = JSON.parse(m[1]) as BackupBlock;
    return typeof b?.data === 'string' && typeof b?.sig === 'string' ? b : undefined;
  } catch {
    return undefined;
  }
}

export type ReadResult =
  | { ok: true; data: BackupData; block: BackupBlock }
  | { ok: false; reason: 'none' | 'changed' | 'not-yours' | 'unknown-lab'; message: string };

/** Check a report file before restoring it. `labIds` are the labs this site has. */
export function readBackup(html: string, who: Profile, labIds: string[]): ReadResult {
  const block = extractBackup(html);
  if (!block)
    return {
      ok: false,
      reason: 'none',
      message: 'This file has no saved work in it. Choose a report you downloaded from NetLab (it ends in .html).',
    };
  let data: BackupData | undefined;
  try {
    if (sha256Hex(BACKUP_SALT + block.data) === block.sig) data = JSON.parse(block.data) as BackupData;
  } catch {
    /* treated as changed */
  }
  if (!data || data.app !== 'netlab-backup' || !data.progress?.labId)
    return { ok: false, reason: 'changed', message: 'This file was changed after it was saved, so NetLab can’t open it.' };
  if (!labIds.includes(data.progress.labId))
    return { ok: false, reason: 'unknown-lab', message: 'This file is for a lab this site doesn’t have.' };
  if (data.owner.id !== who.id && !sameName(data.owner.name, who.name))
    return {
      ok: false,
      reason: 'not-yours',
      message:
        'This file belongs to a different student. You can only open your own saved work. If it is yours, check that your name (top right) is spelled the way it was when you saved the file.',
    };
  return { ok: true, data, block };
}

/** Make the file's progress this student's current progress for that lab, and record the restore. */
export function applyBackup(r: Extract<ReadResult, { ok: true }>, who: Profile, now = Date.now()): LabProgress {
  const { data, block } = r;
  const p = data.progress;
  workIdOf(p); // before the student id changes, so the Work ID stays the same
  const record: RestoreRecord = {
    at: now,
    savedAt: data.savedAt,
    fromName: data.owner.name,
    fromPeriod: data.owner.period,
    fromId: data.owner.id,
    file: block.sig.slice(0, 10),
  };
  p.restores = [...(p.restores ?? []), record];
  p.studentId = who.id;
  p.updatedAt = now;
  p.log.push({ at: now, kind: 'restore', id: record.file });
  replaceProgress(p);
  flushSaves();
  return p;
}
