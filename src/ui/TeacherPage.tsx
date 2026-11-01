import { useState } from 'preact/hooks';
import { hashOverridePassword, overrideEnabled, overridePasswordMatches } from '../store/override';
import { Icon } from './icons';

/**
 * #/teacher: make the line for config.json that turns on the teacher override,
 * and check that the live site has the right password. Nothing here is saved.
 */
export function TeacherPage() {
  const [pw, setPw] = useState('');
  const [test, setTest] = useState('');
  const [copied, setCopied] = useState(false);
  const ok = pw.trim().length >= 8;
  const line = ok ? `"teacherPasswordHash": "${hashOverridePassword(pw)}"` : '';
  const enabled = overrideEnabled();

  return (
    <div class="teacher-page">
      <a class="btn ghost small" href="#/">
        <Icon name="home" size={14} /> Home
      </a>
      <h1>Teacher override password</h1>
      <p>
        The override lets you unlock <strong>Continue</strong> on a step that is broken for a student. The step is flagged on the student's report and in the
        Google Sheet. Wrong passwords are counted there too.
      </p>
      <div class={`callout ${enabled ? 'good' : 'info'} small`}>
        {enabled ? 'An override password is set on this site.' : 'No override password is set on this site yet, so students do not see the override link.'}
      </div>

      <h2>1. Make the config line</h2>
      <p class="muted small">Typed here, the password never leaves this page. Only a scrambled version (a hash) goes in config.json.</p>
      <label class="field">
        <span>New password (at least 8 characters)</span>
        <input type="text" autoComplete="off" spellcheck={false} value={pw} onInput={(e) => (setPw((e.target as HTMLInputElement).value), setCopied(false))} />
      </label>
      {ok && (
        <div class="teacher-line">
          <code>{line}</code>
          <button
            class="btn small"
            onClick={() => {
              void navigator.clipboard?.writeText(line).then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      <p class="small">
        Put that line in <code>config.json</code> in place of the empty <code>"teacherPasswordHash": ""</code>. In the source code the file is{' '}
        <code>public/config.json</code>. On a deployed site, edit <code>config.json</code> next to <code>index.html</code>. Students' browsers pick up the
        change the next time they open NetLab.
      </p>
      <p class="small muted">
        Students can read config.json, so pick a password that is long and not used anywhere else. To turn the override off, set the value back to "".
      </p>

      <h2>2. Test the password on this site</h2>
      <label class="field">
        <span>Password</span>
        <input type="password" autoComplete="off" value={test} onInput={(e) => setTest((e.target as HTMLInputElement).value)} />
      </label>
      {test.trim() && (
        <div class={`callout small ${overridePasswordMatches(test) ? 'good' : 'warn'}`}>
          {!enabled ? 'No password is set on this site yet.' : overridePasswordMatches(test) ? 'That password works here.' : 'That is not the password set on this site.'}
        </div>
      )}
    </div>
  );
}
