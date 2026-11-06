import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { cursorLineEnd, defaultKeymap, history, historyKeymap, indentWithTab, selectLineEnd } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { Annotation, Compartment, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type Command, type DecorationSet } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/** Lines to color: the one about to run, the one after it, and any with an error. */
export interface LineMarks {
  run?: number;
  next?: number;
  errors?: number[];
}

/** The editor, loaded on its own so pages with no code don't pay for it. */
export interface CodeEditor {
  /** The file shown. */
  file(): string;
  open(file: string, text: string, readOnly: boolean): void;
  /** Replace the text from outside, as "Start over" does. */
  setText(text: string): void;
  marks(m: LineMarks): void;
  /** Scroll to a line. `focus`: and put the cursor there. */
  reveal(line: number, focus?: boolean): void;
  destroy(): void;
}

const setMarks = StateEffect.define<LineMarks>();

/** Marks a change that came from the session, not the keyboard, so it isn't sent back. */
const fromOutside = Annotation.define<boolean>();

const RUN = Decoration.line({ class: 'cm-java-run' });
const NEXT = Decoration.line({ class: 'cm-java-next' });
const ERR = Decoration.line({ class: 'cm-java-err' });

function decorate(doc: Text, m: LineMarks): DecorationSet {
  const lines = new Map<number, Decoration>();
  for (const l of m.errors ?? []) lines.set(l, ERR);
  if (m.next) lines.set(m.next, NEXT);
  if (m.run) lines.set(m.run, RUN);
  const b = new RangeSetBuilder<Decoration>();
  for (const l of [...lines.keys()].sort((x, y) => x - y)) if (l >= 1 && l <= doc.lines) b.add(doc.line(l).from, doc.line(l).from, lines.get(l)!);
  return b.finish();
}

const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    let out = set.map(tr.changes);
    for (const e of tr.effects) if (e.is(setMarks)) out = decorate(tr.state.doc, e.value);
    return out;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Colors come from CSS variables, so the editor follows the light and dark themes. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.definitionKeyword, t.controlKeyword, t.operatorKeyword], color: 'var(--code-keyword)' },
  { tag: [t.typeName, t.className, t.standard(t.typeName)], color: 'var(--code-type)' },
  { tag: [t.string, t.character], color: 'var(--code-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--code-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--code-comment)', fontStyle: 'italic' },
]);

/** Home goes to where the code starts on its line, then to the very start of the line. */
const home =
  (extend: boolean): Command =>
  (view) => {
    const { anchor, head } = view.state.selection.main;
    const line = view.state.doc.lineAt(head);
    const code = line.from + line.text.search(/\S|$/);
    const to = head === code ? line.from : code;
    view.dispatch({ selection: { anchor: extend ? anchor : to, head: to }, scrollIntoView: true });
    return true;
  };

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px', backgroundColor: 'var(--input-bg)', color: 'var(--ink)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.5', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--ink)', padding: '8px 0' },
  // A long line wraps past the code's own indent, so it can't be mistaken for the next line.
  '.cm-line': { paddingLeft: 'calc(8ch + 6px)', textIndent: '-8ch' },
  '.cm-cursor': { borderLeftColor: 'var(--ink)' },
  '.cm-gutters': { backgroundColor: 'var(--input-bg)', color: 'var(--faint)', border: 'none', borderRight: '1px solid var(--line)' },
  '.cm-activeLine': { backgroundColor: 'var(--code-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--code-active)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--code-select)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--code-select)', outline: 'none' },
  '.cm-java-run': { backgroundColor: 'var(--warn-soft)', boxShadow: 'inset 3px 0 0 var(--warn)' },
  '.cm-java-next': { backgroundColor: 'var(--brand-soft)', boxShadow: 'inset 3px 0 0 var(--brand-line)' },
  '.cm-java-err': { backgroundColor: 'var(--bad-soft)', boxShadow: 'inset 3px 0 0 var(--bad)' },
});

/** No { in any of these: retyping a line that ends in { would add a } nobody sees. */
const BRACKETS = ['(', '[', "'", '"'];

/** The languages the editor can highlight. A new one is one line here, in this lazy-loaded file. */
const LANGUAGES = {
  java: { support: () => java(), brackets: BRACKETS },
  javascript: { support: () => javascript(), brackets: [...BRACKETS, '`'] },
  html: { support: () => html({ autoCloseTags: false }), brackets: BRACKETS },
  css: { support: () => css(), brackets: BRACKETS },
} satisfies Record<string, { support: () => Extension; brackets: string[] }>;

export type CodeLanguage = keyof typeof LANGUAGES;

export interface EditorOptions {
  /** One language, or a choice for each file, so a project can mix them. */
  language: CodeLanguage | ((file: string) => CodeLanguage);
  /** What a screen reader calls the editor. */
  label: string;
}

export function createEditor(parent: HTMLElement, onChange: (text: string) => void, { language, label }: EditorOptions): CodeEditor {
  const locked = new Compartment();
  let name = '';
  const states = new Map<string, EditorState>();

  // A tabindex keeps a read-only file focusable, so Ctrl+A selects its code and not the whole site.
  const lockFor = (readOnly: boolean): Extension => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly), readOnly ? EditorView.contentAttributes.of({ tabindex: '0' }) : []];

  const extensions = (readOnly: boolean, file: string): Extension[] => {
    const { support, brackets } = LANGUAGES[typeof language === 'string' ? language : language(file)];
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      indentUnit.of('  '),
      EditorState.tabSize.of(2),
      indentOnInput(),
      bracketMatching(),
      EditorState.languageData.of(() => [{ closeBrackets: { brackets } }]),
      closeBrackets(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      syntaxHighlighting(highlight),
      support(),
      // Home and End go to the ends of the code's line, not of the row a long line wrapped to.
      keymap.of([{ key: 'Home', run: home(false), shift: home(true) }, { key: 'End', run: cursorLineEnd, shift: selectLineEnd }, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.contentAttributes.of({ 'aria-label': `${label}. Press Escape, then Tab, to leave the editor.`, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && u.transactions.some((tr) => !tr.annotation(fromOutside))) onChange(u.state.doc.toString());
      }),
      markField,
      locked.of(lockFor(readOnly)),
      theme,
    ];
  };

  const view = new EditorView({ parent, state: EditorState.create({ extensions: extensions(false, '') }) });

  const setText = (text: string) => {
    if (view.state.doc.toString() === text) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: fromOutside.of(true) });
  };

  return {
    file: () => name,
    open(file, text, readOnly) {
      if (name) states.set(name, view.state);
      if (name !== file) {
        name = file;
        const saved = states.get(file);
        view.setState(saved ?? EditorState.create({ doc: text, extensions: extensions(readOnly, file) }));
      }
      setText(text);
      view.dispatch({ effects: locked.reconfigure(lockFor(readOnly)) });
    },
    setText,
    marks: (m) => view.dispatch({ effects: setMarks.of(m) }),
    reveal(line, focus) {
      const doc = view.state.doc;
      const at = doc.line(Math.min(Math.max(line, 1), doc.lines)).from;
      if (focus) {
        view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) });
        view.focus();
        return;
      }
      // Only the editor scrolls. scrollIntoView would also move the page, and with it the Next button.
      view.requestMeasure({
        read: (v) => v.lineBlockAt(at),
        write: (b, v) => {
          v.scrollDOM.scrollTop = b.top - (v.scrollDOM.clientHeight - b.height) / 2;
        },
      });
    },
    destroy: () => view.destroy(),
  };
}
