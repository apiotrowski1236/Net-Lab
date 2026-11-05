import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { DemoInput, JavaFile } from '../../demos/types';
import type { CodeEditor, EditorOptions } from './codeEditor';

/** How long to wait after the last key before saving. */
const SAVE_MS = 300;

/** Keys are saved in a pause, so the session isn't asked to save the whole lesson on every letter. */
export function useSavedEdits(fileName: string, send: (input: DemoInput) => void) {
  const pending = useRef<{ file: string; code: string; timer: number } | null>(null);
  const flush = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    send({ edit: p.file, code: p.code });
  };
  const flushNow = useRef(flush);
  flushNow.current = flush;
  const onChange = (code: string) => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = { file: fileName, code, timer: window.setTimeout(() => flushNow.current(), SAVE_MS) };
  };
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current.timer);
    },
    [],
  );
  return { onChange, flush };
}

interface EditorPaneProps extends EditorOptions {
  file: JavaFile;
  readOnly: boolean;
  /** The line about to run, in the step-through. */
  runLine?: number;
  /** The line after it. */
  nextLine?: number;
  errorLines: number[];
  /** Set to scroll to a line and put the cursor there. */
  jump?: { line: number; n: number };
  onChange: (text: string) => void;
}

/** CodeMirror, once it has loaded. A plain text box does the job until then, or if it can't load. */
export function EditorPane({ file, readOnly, runLine, nextLine, errorLines, jump, onChange, language, label }: EditorPaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const ed = useRef<CodeEditor | null>(null);
  const [ready, setReady] = useState(false);
  // The text the session knows about. Anything else coming in is from outside: Start over, say.
  const known = useRef(file.text);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    let gone = false;
    void import('./codeEditor')
      .then((m) => {
        if (gone || !host.current) return;
        ed.current = m.createEditor(
          host.current,
          (text) => {
            known.current = text;
            change.current(text);
          },
          { language, label },
        );
        setReady(true);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      ed.current?.destroy();
      ed.current = null;
    };
  }, []);

  // Layout effects, so the step-through finds this step's marks in place when it starts its animation.
  useLayoutEffect(() => {
    const e = ed.current;
    if (!e) return;
    if (e.file() !== file.name) {
      known.current = file.text;
      e.open(file.name, file.text, readOnly);
    } else if (file.text !== known.current) {
      known.current = file.text;
      e.setText(file.text);
    }
  }, [ready, file.name, file.text]);

  useLayoutEffect(() => {
    if (ed.current?.file() === file.name) ed.current.open(file.name, known.current, readOnly);
  }, [ready, readOnly]);

  useLayoutEffect(() => {
    ed.current?.marks({ run: runLine, next: nextLine, errors: errorLines });
    if (runLine) ed.current?.reveal(runLine);
  }, [ready, file.name, runLine, nextLine, errorLines.join()]);

  useEffect(() => {
    if (jump) ed.current?.reveal(jump.line, true);
  }, [jump]);

  return (
    <div class="java-editor" ref={host}>
      {!ready && (
        <textarea
          class="java-plain"
          value={file.text}
          readOnly={readOnly}
          spellcheck={false}
          aria-label={label}
          onInput={(e) => {
            const text = (e.target as HTMLTextAreaElement).value;
            known.current = text;
            onChange(text);
          }}
        />
      )}
    </div>
  );
}
