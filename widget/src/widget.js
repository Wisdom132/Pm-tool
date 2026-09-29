"use strict";

// ============================================================
//  The public feedback widget
//
//  The extension serves people who work here. This serves
//  everybody else: a client reviewing a staging site, a
//  customer who found a typo, a tester who will never install
//  anything. No account, no sign-in, no install.
//
//  It is the same promise as the extension's comment tool — the
//  comment arrives pinned to the element, and where the page
//  carries a build annotation, to the source file and line. That
//  is the part no general feedback tool can do, and it does not
//  require the reporter to know any of it.
//
//  Embedding:
//
//    <script src="https://.../widget.js"
//            data-api="https://api.example.com"
//            defer></script>
//
//  Nothing else. The site is identified by its own hostname,
//  server-side, and must have verified its domain and switched
//  the widget on — so pasting this tag onto a domain you do not
//  own collects nothing.
// ============================================================

import { selectorFor } from "../../inline-edit-tool/extension/src/element-selector.js";
import { captureScreen, screenshotSupported } from "./capture.js";
import { createPicker } from "./picker.js";
import { panelMarkup, widgetCss } from "./ui.js";

/** Namespaced to nothing of the host page's. */
const HOST_ID = "inline-edit-feedback";

/** Longest message the API accepts. Mirrored so the counter is honest. */
const MAX_MESSAGE = 5000;

function boot() {
  // Twice on one page would mean two launchers. Scripts get included twice
  // more often than anyone expects — a tag manager plus a template.
  if (document.getElementById(HOST_ID)) return;

  const script = document.currentScript ?? findOwnScript();

  // No script tag at all means this was not embedded — it was imported, by a
  // test or a bundler. Nothing to do, and nothing to complain about.
  if (!script) return;

  const apiUrl = (script.dataset.api ?? "").replace(/\/$/, "");

  if (!apiUrl) {
    // A tag with no `data-api` is a real misconfiguration, so it is worth
    // saying. Deliberately a console error and nothing on the page: a
    // visitor should never see our setup problem.
    console.error("[inline-edit] The feedback widget needs a data-api attribute.");
    return;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  // The host must not participate in the page's layout; the panel inside
  // positions itself.
  host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000;";
  document.body.appendChild(host);

  // Open, not closed. The extension's root is closed because the page must
  // not reach into a tool that can edit source. This one belongs to the
  // page's owner, and a closed root would stop them styling or testing it.
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = widgetCss;
  root.appendChild(style);

  new Widget({ root, host, apiUrl }).mount();
}

class Widget {
  constructor({ root, host, apiUrl }) {
    this.root = root;
    this.host = host;
    this.apiUrl = apiUrl;

    /** The element the comment is about, once one has been chosen. */
    this.target = null;
    /** A data URL, once one has been captured. */
    this.screenshot = null;
    this.picker = null;
  }

  mount() {
    const launcher = document.createElement("button");
    launcher.className = "launcher";
    launcher.type = "button";
    launcher.setAttribute("aria-label", "Leave feedback");
    launcher.innerHTML = `${ICON}<span>Feedback</span>`;
    launcher.addEventListener("click", () => this.open());

    this.launcher = launcher;
    this.root.appendChild(launcher);
  }

  open() {
    if (this.panel) return;

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-label", "Leave feedback");
    panel.innerHTML = panelMarkup({
      canScreenshot: screenshotSupported(),
      maxMessage: MAX_MESSAGE,
    });

    this.panel = panel;
    this.launcher.hidden = true;
    this.root.appendChild(panel);

    this.wire();
    this.field().focus();
  }

  close() {
    this.picker?.stop();
    this.picker = null;
    this.panel?.remove();
    this.panel = null;
    this.target = null;
    this.screenshot = null;
    this.launcher.hidden = false;
  }

  /** @returns {HTMLTextAreaElement} */
  field() {
    return this.panel.querySelector(".message");
  }

  q(selector) {
    return this.panel.querySelector(selector);
  }

  wire() {
    this.q(".close").addEventListener("click", () => this.close());
    this.q(".send").addEventListener("click", () => void this.submit());
    this.q(".pick").addEventListener("click", () => this.startPicking());

    const shot = this.q(".shot");
    shot?.addEventListener("click", () => void this.attachScreenshot());

    const field = this.field();
    field.addEventListener("input", () => this.onInput());

    // Escape closes, and keystrokes must not reach the page's own shortcut
    // handlers — a site that binds "/" to search would otherwise swallow
    // every slash somebody types.
    this.panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void this.submit();
      }
      event.stopPropagation();
    });
  }

  onInput() {
    const length = this.field().value.trim().length;
    this.q(".send").disabled = length === 0;
    this.q(".count").textContent = length > MAX_MESSAGE - 200 ? `${length}/${MAX_MESSAGE}` : "";
  }

  /**
   * Let the reporter point at what they mean.
   *
   * Optional. Somebody who just wants to say "the pricing page is wrong"
   * should not have to click a thing first — the comment still arrives with
   * the page URL.
   */
  startPicking() {
    this.panel.classList.add("picking");

    this.picker = createPicker({
      // Our own UI must not be selectable, or the first thing anyone picks
      // is the feedback panel.
      ignore: (element) => element === this.host || this.host.contains(element),
      onPick: (element) => {
        this.target = element;
        this.panel.classList.remove("picking");
        this.showTarget(element);
        this.field().focus();
      },
      onCancel: () => {
        this.panel.classList.remove("picking");
        this.field().focus();
      },
    });

    this.picker.start();
  }

  showTarget(element) {
    const annotation = annotationOf(element);
    const label = this.q(".target");

    label.hidden = false;
    label.textContent = annotation.sourceFile
      ? `${describe(element)} — ${annotation.sourceFile}${
          annotation.sourceLine ? `:${annotation.sourceLine}` : ""
        }`
      : describe(element);
  }

  async attachScreenshot() {
    const button = this.q(".shot");
    button.disabled = true;
    button.textContent = "Capturing…";

    const captured = await captureScreen();

    if (!captured) {
      // Refusing the browser's permission prompt is the ordinary case, not
      // an error worth a red message.
      button.disabled = false;
      button.textContent = "Attach a screenshot";
      return;
    }

    this.screenshot = captured;
    button.textContent = "Screenshot attached";
    button.classList.add("attached");
  }

  async submit() {
    const message = this.field().value.trim();
    if (!message) return;

    const send = this.q(".send");
    const status = this.q(".status");

    send.disabled = true;
    send.textContent = "Sending…";
    status.hidden = true;

    const annotation = this.target ? annotationOf(this.target) : {};

    try {
      const response = await fetch(`${this.apiUrl}/public/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No credentials: this endpoint takes no session, and sending
        // cookies to it cross-origin would only invite trouble.
        credentials: "omit",
        body: JSON.stringify({
          message,
          pageUrl: window.location.href,
          authorName: this.q(".name").value.trim() || undefined,
          authorEmail: this.q(".email").value.trim() || undefined,
          element: this.target ? selectorFor(this.target) : undefined,
          sourceFile: annotation.sourceFile || undefined,
          sourceLine: annotation.sourceLine ?? undefined,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          screenshot: this.screenshot || undefined,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(reasonFor(response.status, body));
      }

      this.showThanks();
    } catch (error) {
      send.disabled = false;
      send.textContent = "Send";
      status.hidden = false;
      status.textContent = error.message;
      status.className = "status error";
    }
  }

  showThanks() {
    // Replacing the form rather than closing it: a form that vanishes looks
    // like it failed.
    this.panel.innerHTML = `
      <div class="thanks">
        <strong>Thank you.</strong>
        <p>Your comment has reached the team who look after this site.</p>
        <button class="close" type="button">Close</button>
      </div>`;
    this.panel.querySelector(".close").addEventListener("click", () => this.close());
  }
}

/**
 * The build annotation on an element, or the nearest ancestor carrying one.
 *
 * The same rule the extension uses: an image or an icon is rarely annotated
 * itself, but the component around it is, and that is still the right file.
 */
function annotationOf(element) {
  const annotated = element.closest?.("[data-edit-file]");
  if (!annotated) return { sourceFile: null, sourceLine: null };

  const line = Number(annotated.getAttribute("data-edit-line"));
  return {
    sourceFile: annotated.getAttribute("data-edit-file"),
    sourceLine: Number.isFinite(line) && line > 0 ? line : null,
  };
}

/** A short, human label for what was clicked. */
function describe(element) {
  const text = element.textContent?.trim().replace(/\s+/g, " ") ?? "";
  if (text) return text.length > 40 ? `“${text.slice(0, 40)}…”` : `“${text}”`;

  if (element.tagName === "IMG") {
    const alt = element.getAttribute("alt");
    return alt ? `image: ${alt}` : "an image";
  }
  return `<${element.tagName.toLowerCase()}>`;
}

/**
 * Something a visitor can act on.
 *
 * The API answers a not-registered, unverified and switched-off site
 * identically on purpose, so this cannot be more specific than the server
 * was — and it should not pretend to be.
 */
function reasonFor(status, body) {
  if (status === 404) return "This site is not currently accepting feedback.";
  if (status === 429) return "Too many messages from here just now. Please try again later.";
  if (status === 400) {
    const detail = Array.isArray(body?.message) ? body.message[0] : body?.message;
    return detail || "That could not be sent. Please check what you have written.";
  }
  return "Something went wrong sending that. Please try again.";
}

/**
 * The script tag that loaded us.
 *
 * `document.currentScript` is null when the script is loaded as a module or
 * re-executed, so fall back to finding it by its own filename.
 */
function findOwnScript() {
  return document.querySelector('script[data-api][src*="widget"]');
}

const ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

// `document.body` is required, and a `defer`red script runs after parsing —
// but an embedder may still drop the tag in `<head>` without it.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

export { annotationOf, describe, reasonFor };
