"use strict";

// ============================================================
//  CodeMirror chunk
//
//  Built as its own bundle and injected on demand. It is ~158kB
//  gzipped — an order of magnitude more than the rest of the
//  extension — and someone editing copy will never open it, so
//  it must never load with the content script.
//
//  It publishes a single factory on a global that the content
//  script picks up after injection.
// ============================================================

import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  Decoration,
  ViewPlugin,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  foldGutter,
  indentUnit,
  syntaxTree,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";

const GLOBAL = "__IET_CODE_EDITOR__";

/** Matches the rail's palette so the editor reads as part of the tool. */
const theme = EditorView.theme(
  {
    "&": {
      color: "#e4e4e7",
      backgroundColor: "#141416",
      fontSize: "12.5px",
      height: "100%",
    },
    ".cm-content": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      padding: "10px 0",
      caretColor: "#ec4899",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#ec4899" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: "rgba(168, 85, 247, 0.32)" },
    ".cm-gutters": {
      backgroundColor: "#141416",
      color: "#52525b",
      border: "none",
      borderRight: "1px solid rgba(255,255,255,0.06)",
    },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.035)" },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(255,255,255,0.05)",
      color: "#a1a1aa",
    },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "rgba(236,72,153,0.25)",
      outline: "none",
    },
    ".cm-scroller": { overflow: "auto" },
    // The element the editor was opened from.
    ".__iet-origin-line": { backgroundColor: "rgba(236, 72, 153, 0.13)" },
    ".__iet-origin-gutter": { color: "#ec4899", fontWeight: "700" },
  },
  { dark: true }
);

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#c084fc" },
  { tag: [tags.name, tags.deleted, tags.character, tags.propertyName], color: "#e4e4e7" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#7dd3fc" },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: "#f0abfc" },
  { tag: [tags.definition(tags.name), tags.separator], color: "#e4e4e7" },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed], color: "#fcd34d" },
  { tag: [tags.operator, tags.operatorKeyword], color: "#f472b6" },
  { tag: [tags.string, tags.processingInstruction, tags.inserted], color: "#86efac" },
  { tag: [tags.meta, tags.comment], color: "#71717a", fontStyle: "italic" },
  { tag: tags.tagName, color: "#f472b6" },
  { tag: tags.attributeName, color: "#fcd34d" },
  { tag: tags.link, textDecoration: "underline" },
  { tag: tags.invalid, color: "#f87171" },
]);

/** Pick a grammar from the file extension. */
function languageFor(filePath) {
  const path = String(filePath).toLowerCase();

  if (/\.(jsx|tsx)$/.test(path)) {
    return javascript({ jsx: true, typescript: path.endsWith(".tsx") });
  }
  if (/\.tsx?$/.test(path)) return javascript({ typescript: true });
  if (/\.(js|mjs|cjs)$/.test(path)) return javascript({ jsx: true });
  if (/\.(html?|vue|svelte)$/.test(path)) return html();
  // SCSS/LESS are supersets; the CSS grammar covers the common subset and
  // degrades to plain text on the parts it does not know, which is better
  // than no highlighting at all.
  if (/\.(css|scss|sass|less|pcss|styl)$/.test(path)) return css();

  // Unknown extension: no grammar rather than a wrong one.
  return [];
}

/**
 * Highlight the line range the element came from, so the thing you clicked
 * is findable in a file you did not choose to open.
 */
function originHighlight(fromLine, toLine) {
  if (!fromLine) return [];

  const lineMark = Decoration.line({ class: "__iet-origin-line" });

  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = this.build(view);
      }
      update(update) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.build(update.view);
        }
      }
      build(view) {
        const marks = [];
        const last = Math.min(toLine || fromLine, view.state.doc.lines);
        for (let n = fromLine; n <= last; n++) {
          if (n < 1 || n > view.state.doc.lines) continue;
          marks.push(lineMark.range(view.state.doc.line(n).from));
        }
        return Decoration.set(marks);
      }
    },
    { decorations: (v) => v.decorations }
  );
}

// ============================================================
//  Reading the markup back out
//
//  Typing in the source should show up on the page. The page
//  cannot be re-rendered — there is no build here — but the
//  parser CodeMirror already loaded for highlighting can say
//  what each JSX element on a given line now contains, and an
//  annotated element on the page is exactly a line in a file.
//
//  Only what can be applied faithfully is reported. An element
//  whose children include another element or a {expression} is
//  left with `text: null` rather than a guess: replacing the
//  text of `<p>Read our <a>guide</a></p>` would delete the link.
// ============================================================

/**
 * The two grammars this can read an element out of.
 *
 * JSX and HTML produce the same shape of tree under different node names, so
 * one walker serves both — which is what makes the live preview work for Vue
 * SFCs and Angular templates and not only for React.
 */
const GRAMMARS = {
  jsx: {
    element: "JSXElement",
    open: "JSXOpenTag",
    selfClose: "JSXSelfClosingTag",
    attribute: "JSXAttribute",
    names: ["JSXIdentifier", "JSXBuiltin"],
    value: "JSXAttributeValue",
    text: "JSXText",
    // `{expr}` — a value only the running component knows.
    dynamic: ["JSXEscape"],
  },
  html: {
    element: "Element",
    open: "OpenTag",
    selfClose: "SelfClosingTag",
    attribute: "Attribute",
    names: ["TagName", "AttributeName"],
    value: "AttributeValue",
    text: "Text",
    dynamic: [],
  },
};

/**
 * Template syntax that resolves at render time.
 *
 * HTML has no node for it — `{{ title }}` is just text to the parser — so it
 * has to be recognised here. Writing it to the page verbatim would replace a
 * rendered value with its own source.
 */
const INTERPOLATION = /\{\{[\s\S]*?\}\}|\{[^{}]*\}|<%[\s\S]*?%>/;

/**
 * Attributes whose value is an expression rather than a literal.
 *
 * Vue's `:href`/`v-bind`, Angular's `[href]`/`(click)`/`*ngIf`, and event
 * handlers. Their text is code, and putting it in the DOM would be wrong.
 */
const BOUND_ATTRIBUTE = /^(v-|:|@|\[|\(|\*|on[A-Z])/;

/** Strip the quotes from a string literal, or null if it is not one. */
function literalValue(raw) {
  const first = raw[0];
  if ((first === '"' || first === "'") && raw[raw.length - 1] === first) {
    return raw.slice(1, -1);
  }
  return null;
}

/** Read one element's own text and literal attributes. */
function describeElement(node, doc, g) {
  const open = node.firstChild;
  if (!open) return null;
  if (open.name !== g.open && open.name !== g.selfClose) return null;

  const attributes = {};
  for (let child = open.firstChild; child; child = child.nextSibling) {
    if (child.name !== g.attribute) continue;

    const key = g.names.map((n) => child.getChild(n)).find(Boolean);
    const value = child.getChild(g.value);
    if (!key || !value) continue;

    const name = doc.sliceString(key.from, key.to);
    if (BOUND_ATTRIBUTE.test(name)) continue;

    const literal = literalValue(doc.sliceString(value.from, value.to));
    if (literal !== null && !INTERPOLATION.test(literal)) attributes[name] = literal;
  }

  let text = "";
  let textOnly = open.name !== g.selfClose;

  // Each literal run of text, in order. An element holding copy beside
  // another element cannot be replaced wholesale, but its runs can be —
  // which is exactly what the codemod does to the source, and what the
  // element-level editor does to the page.
  const runs = [];

  for (let child = open.nextSibling; child; child = child.nextSibling) {
    if (child.name === g.text) {
      const raw = doc.sliceString(child.from, child.to);
      text += raw;
      const trimmed = raw.replace(/\s+/g, " ").trim();
      if (trimmed && !INTERPOLATION.test(trimmed)) runs.push(trimmed);
    } else if (child.name === g.element || g.dynamic.includes(child.name)) {
      textOnly = false;
    }
  }

  if (textOnly && INTERPOLATION.test(text)) textOnly = false;

  const line = doc.lineAt(open.from);
  return {
    attributes,
    text: textOnly ? text.replace(/\s+/g, " ").trim() : null,
    runs,
    line: line.number,
    // The annotation carries a column too; it only ever breaks ties between
    // two elements opening on the same line.
    column: open.from - line.from,
  };
}

/**
 * Every element in the document, grouped by the line it opens on.
 * @returns {Map<number, Array<{attributes, text, column}>>}
 */
function readOutline(view) {
  const { state } = view;
  const doc = state.doc;
  const byLine = new Map();
  const tree = syntaxTree(state);

  // Which grammar parsed this document is a property of the tree, not of the
  // file extension: a .vue file is parsed as HTML.
  let grammar = null;
  tree.iterate({
    enter(ref) {
      if (grammar) return false;
      if (ref.name === GRAMMARS.jsx.element) grammar = GRAMMARS.jsx;
      else if (ref.name === GRAMMARS.html.element) grammar = GRAMMARS.html;
      return !grammar;
    },
  });

  if (!grammar) return byLine;

  tree.iterate({
    enter(ref) {
      if (ref.name !== grammar.element) return;

      const described = describeElement(ref.node, doc, grammar);
      if (!described) return;

      const bucket = byLine.get(described.line);
      if (bucket) bucket.push(described);
      else byLine.set(described.line, [described]);
    },
  });

  return byLine;
}

/**
 * Mount an editor.
 *
 * @param {object} options
 * @param {HTMLElement} options.parent      where to mount
 * @param {ShadowRoot}  options.root        the shadow root, so selection and
 *                                          focus resolve against the right tree
 * @param {string}      options.doc         file contents
 * @param {string}      options.filePath    used to choose a grammar
 * @param {number}      [options.originLine]
 * @param {number}      [options.originEndLine]
 * @param {() => void}  [options.onChange]
 * @param {() => void}  [options.onSave]    Cmd/Ctrl-S
 * @param {() => void}  [options.onCancel]  Escape
 */
function mount({
  parent,
  root,
  doc,
  filePath,
  originLine,
  originEndLine,
  onChange,
  onSave,
  onCancel,
}) {
  const language = new Compartment();

  const view = new EditorView({
    parent,
    // Without this, CodeMirror measures selection against document instead of
    // the shadow tree and the caret lands in the wrong place.
    root,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        foldGutter(),
        drawSelection(),
        history(),
        bracketMatching(),
        indentOnInput(),
        indentUnit.of("  "),
        syntaxHighlighting(highlightStyle),
        language.of(languageFor(filePath)),
        originHighlight(originLine, originEndLine || originLine),
        theme,
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSave?.();
              return true;
            },
          },
          {
            key: "Escape",
            run: () => {
              onCancel?.();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange?.();
        }),
      ],
    }),
  });

  // Put the origin line in the middle of the viewport rather than at the top.
  if (originLine && originLine <= view.state.doc.lines) {
    const pos = view.state.doc.line(originLine).from;
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
  }

  return {
    focus: () => view.focus(),
    getValue: () => view.state.doc.toString(),
    isDirty: () => view.state.doc.toString() !== doc,
    lineCount: () => view.state.doc.lines,
    outline: () => readOutline(view),
    destroy: () => view.destroy(),
  };
}

globalThis[GLOBAL] = { mount, version: 1 };
