import type { LabDef } from '../labs/types';
import type { LabSession } from '../runtime/session';
import { backupScript, makeBackup, type BackupBlock } from '../store/backup';
import { enqueue, hasEndpoint, outbox, synced } from '../store/outbox';
import { config, online, profile } from '../store/profile';
import { buildReport, type Report } from '../store/report';
import { checkCode, checkCodeHtml, htmlText, RESULTS_ID } from '../store/reportCheck';
import { flushSaves } from '../store/storage';
import { Icon } from './icons';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function when(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function gradeText(q: Report['questions'][number]): string {
  if (!q.autoGraded) return q.extra ? 'Optional, no points' : `Teacher-graded, ${q.points} pts`;
  if (!q.correct) return q.answer ? 'Not correct yet' : 'Not answered';
  return q.attempts && q.attempts > 1 ? `Correct after ${q.attempts} tries` : 'Correct on the first try';
}

/**
 * A self-contained HTML copy of the report, grouped by step (for Schoology upload or email).
 * With a backup block, the file can also be opened on NetLab's home page to restore the work.
 */
export function reportHtml(lab: LabDef, r: Report, backup?: BackupBlock): string {
  let qn = 0;
  const steps = lab.steps
    .map((s, i) => {
      const goals = r.goals.filter((g) => g.step === s.id);
      const qs = r.questions.filter((q) => q.step === s.id);
      const o = r.overrides.find((x) => x.step === s.id);
      const code = (r.code ?? [])
        .filter((c) => c.step === s.id)
        .flatMap((c) => c.files)
        .map((f) => `<div class="code-file"><b>${esc(f.name)}</b><pre>${esc(f.text)}</pre></div>`)
        .join('');
      if (!goals.length && !qs.length && !o && !code) return '';
      const goalHtml = goals.length
        ? `<ul>${goals.map((g) => `<li class="${g.done ? 'done' : 'todo'}">${g.done ? '&#10003;' : '&#9744;'} ${esc(g.label)}</li>`).join('')}</ul>`
        : '';
      const qHtml = qs
        .map((q) => {
          qn++;
          const cls = q.autoGraded ? (q.correct ? 'ok' : 'no') : 'tg';
          return `<div class="q"><div class="p"><b>Q${qn}.</b> ${esc(q.prompt)}</div>
<div class="a">${q.answer ? esc(q.answer).replace(/\n/g, '<br>') : '<i>(no answer)</i>'}</div>
<div class="m ${cls}">${esc(gradeText(q))}</div></div>`;
        })
        .join('');
      const flag = o
        ? `<div class="ovr">Did not complete: the student used the override to skip this step on ${esc(when(o.at))}${o.note ? `. Reason: ${esc(o.note)}` : ''}. Unchecked goals earned no points. The teacher decides if this skip was approved.</div>`
        : '';
      const tags = `${s.extra ? ' <span class="tag extra">optional, no points</span>' : ''}${o ? ' <span class="tag">did not complete (override)</span>' : ''}`;
      return `<section class="${o ? 'overridden' : ''}"><h2>Step ${i + 1}. ${esc(s.title)}${tags}</h2>${flag}${goalHtml}${qHtml}${code}</section>`;
    })
    .join('');
  const overrideSummary = r.overrides.length
    ? `<div class="ovr top"><b>Did not complete (override), ${r.overrides.length} step${r.overrides.length > 1 ? 's' : ''}:</b> ${r.overrides
        .map((o) => `step ${o.number} (${esc(o.title)})`)
        .join(', ')}.</div>`
    : '';
  const restores = r.restores
    .map(
      (x) =>
        `<div class="ovr top${x.otherName ? ' alert' : ''}">Restored from a saved report on ${esc(when(x.at))}. The file was saved ${esc(when(x.savedAt))} by <b>${esc(
          x.fromName || '(no name)',
        )}</b>${x.fromPeriod ? ` (${esc(x.fromPeriod)})` : ''}.${x.otherName ? ' <b>That is not the name on this report.</b>' : ''}</div>`,
    )
    .join('');
  const core = r.goals.filter((g) => !g.extra);
  const goalsDone = core.filter((g) => g.done).length;
  const written = r.questions.filter((q) => !q.autoGraded && !q.extra);
  // Everything a grade rests on goes in <main>; its text makes the check code (store/reportCheck.ts).
  const results = `<h1>${esc(r.lab.title)}</h1>
<div class="meta"><span class="who">${esc(r.student.name || '(no name)')}</span>${r.student.period ? ` &middot; ${esc(r.student.period)}` : ''}${r.course ? ` &middot; ${esc(r.course.title)}` : ''}<br>
Started ${esc(when(r.startedAt))} &middot; ${r.submittedAt ? `Submitted ${esc(when(r.submittedAt))}` : `Last saved ${esc(when(r.updatedAt))} (not submitted)`} &middot; Work ID ${esc(r.workId)}</div>
<div class="stats">
<div class="stat score"><b>${r.score.auto} / ${r.score.autoMax}</b>auto-checked points</div>
<div class="stat"><b>${goalsDone} / ${core.length}</b>goals</div>
<div class="stat"><b>${r.stepReached} / ${r.lab.steps}</b>steps reached</div>
<div class="stat"><b>${r.activeMinutes}</b>active minutes</div>
<div class="stat"><b>${written.filter((q) => q.answer.trim()).length} / ${written.length}</b>written answers for your teacher (${r.score.teacherMax} points)</div>
</div>
${overrideSummary}${restores}
${steps}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.student.name)} - ${esc(r.lab.title)}</title>
<style>
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:780px;margin:32px auto;padding:0 16px;color:#0f172a;background:#fff}
h1{font-size:24px;margin:0}h2{font-size:16px;margin:0 0 8px}
.meta{color:#475569;margin-top:4px}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
.stat{border:1px solid #cbd5e1;border-radius:10px;padding:8px 14px;min-width:120px}.stat b{display:block;font-size:20px}
section{border-top:1px solid #e2e8f0;padding:14px 0;break-inside:avoid}
section.overridden{border-left:4px solid #d97706;padding-left:12px}
ul{padding-left:0;list-style:none;margin:6px 0}li{margin:3px 0}li.todo{color:#b91c1c}
.q{margin:10px 0;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;break-inside:avoid}
.a{margin-top:6px;padding:8px;background:#f1f5f9;border-radius:6px;white-space:pre-wrap}
.m{font-size:12px;margin-top:4px;color:#475569}.m.ok{color:#047857}.m.no{color:#b91c1c}
.ovr{background:#fef3c7;border:1px solid #f59e0b;color:#78350f;border-radius:8px;padding:8px 12px;margin:6px 0 10px}
.ovr.alert{background:#fee2e2;border-color:#ef4444;color:#7f1d1d}
.tag{font-size:11px;font-weight:600;background:#fde68a;color:#78350f;border-radius:999px;padding:2px 8px;vertical-align:middle}
.tag.extra{background:#dbeafe;color:#1e3a8a}
.code-file{margin:10px 0}.code-file pre{margin:4px 0 0;padding:10px;background:#f1f5f9;border-radius:6px;font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap}
.foot{font-size:12px;color:#64748b;margin-top:24px}
</style></head><body>
<main id="${RESULTS_ID}">
${results}
</main>
<p class="foot">NetLab report &middot; ${esc(r.key)} &middot; made ${esc(new Date().toLocaleString())} &middot; Check code ${checkCodeHtml(checkCode(htmlText(results)))}${
    backup ? '<br>Lost your work? Open this file on the NetLab home page with <b>Open saved work</b>.' : ''
  }</p>
${backup ? backupScript(backup) : ''}
</body></html>`;
}

/** The downloaded report's file name. */
export function reportFileName(name: string, labTitle: string): string {
  const who = name.replace(/[^\w -]+/g, '').trim() || 'student';
  // Browsers swap characters a file name can't hold (like the ? in "What's in a Packet?") for _. Drop them, so the name shown is the name saved.
  const what = labTitle.replace(/[<>:"/\\|?*]+/g, '').trim();
  return `${who} - ${what}.html`;
}

/** Where the downloaded report goes, for "Then ___." (config.handInTo). */
export function handInWhere(): string {
  const to = config.value.handInTo.trim();
  return to ? `upload it to the assignment in ${to}` : 'hand it in the way your teacher asked';
}

/** Save the report as an .html file. Works in Chrome, Edge, Firefox, and Safari 14+. */
export function downloadReport(lab: LabDef, r: Report, backup?: BackupBlock): void {
  const blob = new Blob([reportHtml(lab, r, backup)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  if ('download' in a) {
    a.href = url;
    a.download = reportFileName(r.student.name, r.lab.title);
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    // Very old browsers ignore the download attribute. Open the report instead;
    // the student can save it from there.
    window.open(url, '_blank');
  }
  // Safari reads the blob after click() returns, so don't revoke it right away.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The report as it stands now, ready to save or send. */
const currentReport = (session: LabSession) => buildReport(session.lab, session.progress, profile.value, session.progress.submittedAt ? 'submitted' : 'in-progress');

/** Save the report file, with the backup block that lets it restore the work. */
export const downloadCurrent = (session: LabSession) => downloadReport(session.lab, currentReport(session), makeBackup(session.progress, profile.value));

/** Mark the work submitted and send it. With no server, downloading the report file is how it reaches the teacher. */
export function handIn(session: LabSession): void {
  session.markSubmitted();
  flushSaves();
  if (hasEndpoint()) enqueue(buildReport(session.lab, session.progress, profile.value, 'submitted'));
  else downloadCurrent(session);
}

/** Submit and Download, plus where the submission stands. */
export function SubmitBox({ session }: { session: LabSession }) {
  void session.rev.value;
  const lab = session.lab;
  const p = session.progress;
  const who = profile.value;
  const key = `${who.id}:${lab.id}`;
  const pending = outbox.value.find((i) => i.key === key);
  const sent = synced.value[key];
  const endpoint = hasEndpoint();
  const download = () => downloadCurrent(session);
  const submit = () => handIn(session);

  return (
    <div class="submit-box">
      {!who.name.trim() && <div class="callout warn">Add your name (top right) before you submit.</div>}
      <div class="row gap wrap">
        {endpoint ? (
          <>
            <button class="btn primary big" disabled={!who.name.trim()} onClick={submit}>
              <Icon name="send" /> {p.submittedAt ? 'Submit again with my latest work' : 'Submit to my teacher'}
            </button>
            <button class="btn big" onClick={download}>
              <Icon name="download" /> Download report
            </button>
          </>
        ) : (
          <button class="btn primary big" disabled={!who.name.trim()} onClick={submit}>
            <Icon name="download" /> {p.submittedAt ? 'Download again with my latest work' : 'Download my report'}
          </button>
        )}
      </div>
      <div class="submit-status">
        {p.submittedAt ? (
          endpoint ? (
            pending ? (
              <div class="callout info">
                <Icon name={online.value ? 'cloud' : 'cloudOff'} /> Submitted {when(new Date(p.submittedAt).toISOString())}.{' '}
                {online.value ? 'Sending…' : 'You’re offline. It will send automatically when you reconnect. Your work is saved on this computer.'}
              </div>
            ) : sent && sent.sentAt >= p.submittedAt ? (
              <div class="callout good">
                <Icon name="check" /> Delivered to {config.value.teacherName || 'your teacher'} at {when(new Date(sent.sentAt).toISOString())}.
              </div>
            ) : (
              <div class="callout info">Submitted. Waiting to send.</div>
            )
          ) : (
            <div class="callout info">
              <Icon name="upload" /> <strong>One more step.</strong> Your report downloaded {when(new Date(p.submittedAt).toISOString())} as{' '}
              <strong>{reportFileName(who.name, lab.title)}</strong>, in your Downloads folder. Now {handInWhere()}. Your teacher doesn't have it until you do.
            </div>
          )
        ) : (
          <p class="muted small">
            {endpoint
              ? 'Submitting sends your goals and answers straight to your teacher. If you change anything later, submit again.'
              : `Your teacher collects this lab as a file. This button downloads your report, ${reportFileName(who.name, lab.title)}. Then ${handInWhere()}.`}{' '}
            The report is also a backup: if your work ever goes missing, open it on the home page.
          </p>
        )}
      </div>
    </div>
  );
}
