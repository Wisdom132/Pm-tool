"use strict";

// ============================================================
//  Source picker
//
//  Text the build did not annotate has no file attached, so the
//  repository is searched for it. A search can land in several
//  places — the same string often appears in three page
//  components — and opening the first is a guess. This asks.
// ============================================================

const P = "__iet";

/**
 * @param {object} opts
 * @param {ShadowRoot} opts.root
 * @param {Element}    opts.element     what was clicked, used to position
 * @param {Array<{sourceFile, sourceLine, snippet}>} opts.candidates
 * @param {Function}   opts.onPick
 * @param {Function}   [opts.onCancel]
 * @returns {{close: () => void}}
 */
export function openSourcePicker({ root, element, candidates, onPick, onCancel }) {
  const backdrop = document.createElement("div");
  backdrop.id = `${P}-picker-backdrop`;

  const card = document.createElement("div");
  card.id = `${P}-picker`;

  const title = document.createElement("strong");
  title.className = `${P}-picker-title`;
  title.textContent = `Found in ${candidates.length} places`;

  const note = document.createElement("p");
  note.className = `${P}-picker-note`;
  note.textContent =
    "This text has no build annotation, so it was found by searching. Pick the one that renders this page.";

  const list = document.createElement("div");
  list.className = `${P}-candidates`;

  for (const candidate of candidates) {
    const option = document.createElement("button");
    option.className = `${P}-candidate`;
    option.type = "button";

    const path = document.createElement("span");
    path.className = `${P}-candidate-path`;
    path.textContent = `${candidate.sourceFile}:${candidate.sourceLine}`;
    option.appendChild(path);

    if (candidate.snippet) {
      const snippet = document.createElement("code");
      snippet.className = `${P}-candidate-snippet`;
      snippet.textContent = candidate.snippet;
      option.appendChild(snippet);
    }

    option.addEventListener("click", () => {
      close();
      onPick(candidate);
    });
    list.appendChild(option);
  }

  const cancel = document.createElement("button");
  cancel.className = `${P}-picker-cancel`;
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    close();
    onCancel?.();
  });

  card.append(title, note, list, cancel);
  backdrop.appendChild(card);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      close();
      onCancel?.();
    }
  });

  root.appendChild(backdrop);

  function close() {
    backdrop.remove();
  }

  return { close };
}
