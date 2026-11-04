import { useRef, useState } from 'preact/hooks';
import { checkReport, type CheckResult } from '../store/reportCheck';
import { Icon } from './icons';

type Row = CheckResult & { file: string; n: number };

const VERDICT: Record<CheckResult['status'], { icon: string; text: string; cls: string }> = {
  ok: { icon: 'check', text: 'Not edited', cls: 'good' },
  changed: { icon: 'x', text: 'Edited after download', cls: 'bad' },
  'no-code': { icon: 'warn', text: 'No check code', cls: 'warn' },
  'not-report': { icon: 'warn', text: 'Not a NetLab report', cls: 'warn' },
};

/** #/teacher: check downloaded report files against their check codes (store/reportCheck.ts). Nothing leaves the page. */
export function ReportChecker() {
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const count = useRef(0);

  const check = async (files: FileList | null | undefined) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    const checked = await Promise.all(
      list.map(async (f): Promise<Row> => {
        const text = await f.text().catch(() => '');
        return { ...checkReport(text), file: f.name, n: count.current++ };
      }),
    );
    // Newest first, so the files just chosen are at the top.
    setRows((old) => [...checked.reverse(), ...old]);
  };

  const pick = (e: Event) => {
    const el = e.target as HTMLInputElement;
    void check(el.files).then(() => (el.value = '')); // so choosing the same file again still fires
  };

  const edited = rows.filter((r) => r.status === 'changed').length;

  return (
    <div>
      <p>
        Every report a student downloads ends with a <strong>check code</strong>, made from what the report says: the name, dates, scores, goals, and
        answers. Change any of those in the file and the code stops matching.
      </p>
      <div
        class={`check-drop${over ? ' over' : ''}`}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void check(e.dataTransfer?.files);
        }}
      >
        <button class="btn primary" onClick={() => input.current?.click()}>
          <Icon name="upload" size={14} /> Choose report files
        </button>
        <span class="muted small">or drop them here. You can check a whole class at once. The files stay on this computer.</span>
        <input ref={input} type="file" multiple accept=".html,.htm,text/html" class="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={pick} />
      </div>

      {rows.length > 0 && (
        <>
          <div class={`callout small ${edited ? 'warn' : 'good'}`} role="status">
            {edited
              ? `${edited} of ${rows.length} file${rows.length > 1 ? 's were' : ' was'} edited after download.`
              : `Checked ${rows.length} file${rows.length > 1 ? 's' : ''}. None were edited.`}
          </div>
          <div class="check-table-wrap">
            <table class="table check-table">
              <thead>
                <tr>
                  <th>Result</th>
                  <th>File</th>
                  <th>Student</th>
                  <th>Lab</th>
                  <th>Auto-checked</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const v = VERDICT[r.status];
                  return (
                    <tr key={r.n} class={`check-${v.cls}`}>
                      <td class="check-verdict">
                        <Icon name={v.icon} size={14} /> {v.text}
                      </td>
                      <td class="check-file">{r.file}</td>
                      <td>{r.student}</td>
                      <td>{r.lab}</td>
                      <td>{r.score}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button class="btn ghost small" onClick={() => setRows([])}>
            Clear the list
          </button>
        </>
      )}

      <ul class="small muted check-notes">
        <li>
          <strong>Edited after download:</strong> something a grade rests on was changed in the file. Ask the student to download the report again.
        </li>
        <li>
          <strong>No check code:</strong> the report was downloaded before NetLab added check codes, or the code was deleted.
        </li>
        <li>
          Grade from the score in this table. It is read from the report's text, which the check code covers, so styles or scripts added to change how the
          page looks don't change it.
        </li>
        <li>
          With no server, there is no secret behind the code. It catches a report edited by hand, but a student who reads NetLab's source code could make
          a code that matches.
        </li>
      </ul>
    </div>
  );
}
