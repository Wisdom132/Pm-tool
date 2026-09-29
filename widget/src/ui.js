"use strict";

// ============================================================
//  The widget's markup and styles
//
//  Kept apart from the behaviour so the panel can be read as a
//  document. Everything is scoped inside the widget's shadow
//  root, so none of these class names can collide with the
//  host page's.
//
//  Cyan, matching the extension, and no gradients.
// ============================================================

/**
 * The panel, as HTML.
 *
 * Built as a string rather than by DOM calls because it is static: there is
 * no interpolation of anything a visitor typed anywhere in here, so there is
 * nothing for markup to escape.
 */
export function panelMarkup({ canScreenshot, maxMessage }) {
  return `
    <header class="head">
      <strong>Leave feedback</strong>
      <button class="close" type="button" aria-label="Close">&times;</button>
    </header>

    <p class="intro">
      Tell the team what is wrong. You can point at the part of the page you
      mean.
    </p>

    <button class="pick" type="button">
      <span class="pick-idle">Point at something on the page</span>
      <span class="pick-active">Click any part of the page — Escape to stop</span>
    </button>
    <p class="target" hidden></p>

    <textarea
      class="message"
      rows="4"
      maxlength="${maxMessage}"
      placeholder="What is wrong, or what should it say instead?"
      aria-label="Your feedback"></textarea>
    <p class="count" aria-live="polite"></p>

    <div class="who">
      <input class="name" type="text" maxlength="100" placeholder="Your name (optional)"
             aria-label="Your name" autocomplete="name" />
      <input class="email" type="email" maxlength="200" placeholder="Email (optional)"
             aria-label="Your email" autocomplete="email" />
    </div>

    ${
      canScreenshot
        ? `<button class="shot" type="button">Attach a screenshot</button>
           <p class="hint">Your browser will ask which window or tab to share.</p>`
        : ""
    }

    <p class="status" hidden></p>

    <button class="send" type="button" disabled>Send</button>
    <p class="hint">
      Your name and email are optional, and are only used to follow this up.
    </p>`;
}

export const widgetCss = `
:host { all: initial; }

.launcher, .panel, .panel * {
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.launcher {
  position: fixed;
  right: 20px;
  bottom: 20px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border: 0;
  border-radius: 999px;
  background: #0891b2;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
}

.launcher:hover { background: #06b6d4; }
.launcher:focus-visible { outline: 2px solid #0e7490; outline-offset: 2px; }

.panel {
  position: fixed;
  right: 20px;
  bottom: 20px;
  width: 340px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  display: grid;
  gap: 10px;
  padding: 16px;
  border: 1px solid #e4e4e7;
  border-radius: 10px;
  background: #fff;
  color: #18181b;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.16);
}

/* While picking, the panel gets out of the way — it is covering the page
   the visitor is being asked to point at. Kept visible rather than hidden
   so it is obvious the widget is still open and waiting. */
.panel.picking { opacity: 0.25; pointer-events: none; }

.head { display: flex; align-items: center; justify-content: space-between; }
.head strong { font-size: 15px; }

.close {
  border: 0;
  background: none;
  font-size: 20px;
  line-height: 1;
  color: #71717a;
  cursor: pointer;
  padding: 0 4px;
}

.intro, .hint { margin: 0; font-size: 12px; line-height: 1.5; color: #71717a; }

.pick {
  padding: 8px 10px;
  border: 1px dashed #a1a1aa;
  border-radius: 6px;
  background: #fafafa;
  font-size: 13px;
  color: #3f3f46;
  cursor: pointer;
  text-align: left;
}

.pick:hover { border-color: #06b6d4; color: #0e7490; }
.pick-active { display: none; }
.picking .pick-idle { display: none; }
.picking .pick-active { display: inline; }

.target {
  margin: 0;
  padding: 6px 8px;
  border-radius: 4px;
  background: #ecfeff;
  font-size: 12px;
  color: #155e75;
  overflow-wrap: anywhere;
}

.message {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #d4d4d8;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  color: #18181b;
  background: #fff;
}

.message:focus, .name:focus, .email:focus {
  outline: 0;
  border-color: #06b6d4;
}

.count { margin: 0; font-size: 11px; color: #a1a1aa; text-align: right; }

.who { display: grid; gap: 8px; grid-template-columns: 1fr 1fr; }

.name, .email {
  padding: 7px 9px;
  border: 1px solid #d4d4d8;
  border-radius: 6px;
  font-size: 12px;
  min-width: 0;
  color: #18181b;
  background: #fff;
}

.shot {
  padding: 8px 10px;
  border: 1px solid #d4d4d8;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  color: #3f3f46;
  cursor: pointer;
}

.shot:hover:not(:disabled) { border-color: #06b6d4; }
.shot.attached { border-color: #0891b2; color: #0e7490; background: #ecfeff; }
.shot:disabled { cursor: default; color: #a1a1aa; }

.send {
  padding: 10px;
  border: 0;
  border-radius: 6px;
  background: #0891b2;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.send:hover:not(:disabled) { background: #06b6d4; }
.send:disabled { background: #d4d4d8; color: #71717a; cursor: default; }

.status { margin: 0; font-size: 12px; }
.status.error { color: #b91c1c; }

.thanks { display: grid; gap: 10px; text-align: center; padding: 8px 0; }
.thanks p { margin: 0; font-size: 13px; color: #52525b; line-height: 1.5; }
.thanks .close { font-size: 13px; color: #0e7490; }

@media (prefers-color-scheme: dark) {
  .panel { background: #18181b; color: #f4f4f5; border-color: #3f3f46; }
  .pick { background: #27272a; border-color: #52525b; color: #e4e4e7; }
  .message, .name, .email, .shot { background: #27272a; border-color: #3f3f46; color: #f4f4f5; }
  .target { background: #164e63; color: #cffafe; }
  .intro, .hint { color: #a1a1aa; }
  .thanks p { color: #a1a1aa; }
}
`;
