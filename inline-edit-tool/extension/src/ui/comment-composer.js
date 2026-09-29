"use strict";

// ============================================================
//  Comment composer
//
//  For the person who has noticed something but should not, or
//  cannot, change it themselves — a copywriter on a page whose
//  wording is a legal question, a support agent who knows the
//  help text is wrong.
//
//  What makes it worth more than any general feedback tool is
//  the line it shows underneath: where the page is annotated,
//  the comment is pinned to the source file that produced the
//  element. "This heading is wrong" and "Hero.vue:14" arrive
//  together.
// ============================================================

const P = "__iet";

/**
 * @param {object} opts
 * @param {ShadowRoot} opts.root
 * @param {Element}    opts.element      what was clicked
 * @param {string}     opts.description  a readable label for it
 * @param {{sourceFile: string|null, sourceLine: number|null}} opts.source
 * @param {(message: string) => Promise<{error?: string}>} opts.onSubmit
 * @param {Function}   [opts.onClose]
 * @returns {{close: () => void}}
 */
export function openCommentComposer({
  root,
  element,
  description,
  source,
  onSubmit,
  onClose,
}) {
  const backdrop = document.createElement("div");
  backdrop.id = `${P}-comment-backdrop`;

  const card = document.createElement("div");
  card.id = `${P}-comment`;

  const title = document.createElement("strong");
  title.className = `${P}-comment-title`;
  title.textContent = "Leave a comment";

  const about = document.createElement("p");
  about.className = `${P}-comment-about`;
  about.textContent = description;

  const field = document.createElement("textarea");
  field.className = `${P}-comment-field`;
  field.rows = 4;
  field.placeholder = "What is wrong, or what should it say instead?";
  field.setAttribute("aria-label", "Your comment");

  // Where it will land. Stated before sending, not after: somebody deciding
  // whether to comment or to edit should know which of the two this is.
  const where = document.createElement("p");
  where.className = `${P}-comment-where`;
  if (source.sourceFile) {
    const code = document.createElement("code");
    code.textContent = source.sourceLine
      ? `${source.sourceFile}:${source.sourceLine}`
      : source.sourceFile;
    // `exact` matters: an image inherits its component's annotation, and
    // saying "pinned to" would imply the line is the image's own.
    where.append(
      document.createTextNode(source.exact ? "Pinned to " : "Inside "),
      code
    );
  } else {
    where.textContent =
      "This element has no build annotation, so the comment is pinned to the element and the page, not a source file.";
    where.classList.add(`${P}-comment-where-weak`);
  }

  const status = document.createElement("p");
  status.className = `${P}-comment-status`;
  status.hidden = true;

  const actions = document.createElement("div");
  actions.className = `${P}-comment-actions`;

  const cancel = document.createElement("button");
  cancel.className = `${P}-comment-cancel`;
  cancel.type = "button";
  cancel.textContent = "Cancel";

  const send = document.createElement("button");
  send.className = `${P}-comment-send`;
  send.type = "button";
  send.textContent = "Send";
  send.disabled = true;

  // Nothing to send until something is typed, and trailing whitespace is not
  // something.
  field.addEventListener("input", () => {
    send.disabled = field.value.trim().length === 0;
  });

  async function submit() {
    const message = field.value.trim();
    if (!message) return;

    send.disabled = true;
    send.textContent = "Sending…";
    status.hidden = true;

    const result = await onSubmit(message);

    if (result?.error) {
      send.disabled = false;
      send.textContent = "Send";
      status.hidden = false;
      status.textContent = result.error;
      status.className = `${P}-comment-status ${P}-comment-status-error`;
      return;
    }

    close();
  }

  send.addEventListener("click", submit);
  cancel.addEventListener("click", () => {
    close();
    onClose?.();
  });

  // Cmd/Ctrl+Enter sends, because a comment is a paragraph and Enter has to
  // stay as a newline.
  field.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      onClose?.();
    }
    // Keystrokes must not reach the page's own shortcut handlers.
    e.stopPropagation();
  });

  actions.append(cancel, send);
  card.append(title, about, field, where, status, actions);
  backdrop.appendChild(card);

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      close();
      onClose?.();
    }
  });

  root.appendChild(backdrop);
  field.focus();

  function close() {
    backdrop.remove();
  }

  return { close };
}
