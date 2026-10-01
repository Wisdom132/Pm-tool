"use strict";

// ============================================================
//  Accessibility tool
//
//  In the manner of VisBug's, and for the same audience: the
//  people reviewing a staging build are exactly the people who
//  decide whether "the grey on grey is fine". This shows them
//  the number instead of the argument — contrast ratio with the
//  AA/AAA verdicts, and whether the element has a name a screen
//  reader can speak.
//
//  It pairs with Comment rather than with Edit: a failing
//  contrast is rarely a one-element fix, so the tool describes,
//  and the comment — pinned to the source line — carries the
//  finding to whoever owns the stylesheet.
// ============================================================

import {
  apcaContrast,
  apcaVerdict,
  contrastRatio,
  effectiveColors,
  wcagVerdict,
} from "./contrast.js";
import { annotationFor } from "../element-selector.js";

const P = "__iet";

/** True when the element has a non-empty direct text node. */
function hasDirectText(el) {
  for (const node of el.childNodes) {
    if (node.nodeType === 3 && node.textContent.trim()) return true;
  }
  return false;
}

/**
 * What a screen reader would call this element.
 *
 * A deliberately partial model of the accname algorithm — the
 * common sources, in their real priority order. Being wrong
 * about an exotic case is acceptable; being silent about a
 * nameless button is what the tool exists to prevent.
 */
export function accessibleName(el) {
  const attr = (name) => el.getAttribute?.(name)?.trim() || "";

  const labelledby = attr("aria-labelledby");
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() || "")
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }

  if (attr("aria-label")) return attr("aria-label");
  if (el.tagName === "IMG") return attr("alt");
  if (el.tagName === "INPUT" && attr("value") && ["button", "submit"].includes(el.type)) {
    return attr("value");
  }

  const text = el.textContent?.trim().replace(/\s+/g, " ") || "";
  if (text) return text;

  const imgAlt = el.querySelector?.("img[alt]")?.getAttribute("alt")?.trim() || "";
  return imgAlt || attr("title");
}

/**
 * Audit one element.
 *
 * @returns {Array<{kind:'pass'|'warn'|'fail'|'info', label:string, detail:string}>}
 *          worst first, so the thing to act on is the first line read
 */
export function auditElement(el, win = window) {
  const rows = [];
  const tag = el.tagName;

  // ── Contrast, where there is text to read ──
  if (hasDirectText(el)) {
    const colors = effectiveColors(el, win);
    if (colors) {
      const verdict = wcagVerdict(contrastRatio(colors.fg, colors.bg), colors);
      const level = verdict.aaa ? "AAA" : verdict.aa ? "AA" : "below AA";
      rows.push({
        kind: verdict.aa ? "pass" : "fail",
        label: "Contrast",
        detail: `${verdict.ratio}:1 — ${level}${verdict.large ? " (large text)" : ""}`,
      });

      // APCA alongside, not instead. WCAG 2 is what compliance is still
      // measured against, and APCA is what the eye actually does — they
      // disagree most in the middle of the range, which is where most real
      // text lives. Showing both says more than either.
      const lc = apcaContrast(colors.fg, colors.bg);
      const apca = apcaVerdict(lc, colors);
      rows.push({
        kind: apca.ok ? "pass" : "warn",
        label: "APCA",
        detail: `Lc ${lc} — ${apca.level}`,
      });
    }
  }

  // ── A name to speak ──
  if (tag === "IMG") {
    const alt = el.getAttribute("alt");
    if (alt === null) {
      rows.push({
        kind: "fail",
        label: "Alt text",
        detail: "Missing — a screen reader will read the file name, or nothing.",
      });
    } else if (alt.trim() === "") {
      rows.push({ kind: "info", label: "Alt text", detail: "Empty — marked decorative." });
    } else {
      rows.push({ kind: "pass", label: "Alt text", detail: `“${alt.trim()}”` });
    }
  }

  const interactive =
    tag === "A" || tag === "BUTTON" || el.getAttribute("role") === "button" ||
    (tag === "INPUT" && ["button", "submit"].includes(el.type));
  if (interactive) {
    const name = accessibleName(el);
    rows.push(
      name
        ? { kind: "pass", label: "Name", detail: `“${name.length > 48 ? `${name.slice(0, 48)}…` : name}”` }
        : {
            kind: "fail",
            label: "Name",
            detail: "Nothing for a screen reader to announce.",
          }
    );

    if (tag === "A") {
      const href = el.getAttribute("href");
      if (!href || href === "#") {
        rows.push({
          kind: "warn",
          label: "Link",
          detail: "No destination — not reachable as a link by keyboard.",
        });
      }
    }
  }

  // ── The traps ──
  if (el.getAttribute("aria-hidden") === "true") {
    rows.push({
      kind: "warn",
      label: "aria-hidden",
      detail: "Invisible to assistive tech, including everything inside it.",
    });
  }

  const tabindex = Number(el.getAttribute("tabindex"));
  if (tabindex > 0) {
    rows.push({
      kind: "warn",
      label: "tabindex",
      detail: `${tabindex} — positive values hijack the page's tab order.`,
    });
  }

  if (rows.length === 0) {
    rows.push({ kind: "info", label: "Nothing to check", detail: "No text, name or traps here." });
  }

  const order = { fail: 0, warn: 1, pass: 2, info: 3 };
  return rows.sort((a, b) => order[a.kind] - order[b.kind]);
}

/** The card the tool shows on click. */
export function createA11yCard() {
  const card = document.createElement("div");
  card.id = `${P}-a11y`;
  card.hidden = true;

  return {
    element: card,

    show(el, win = window) {
      card.textContent = "";

      const title = document.createElement("div");
      title.className = `${P}-a11y-title`;
      title.textContent = `<${el.tagName.toLowerCase()}>`;
      card.appendChild(title);

      for (const row of auditElement(el, win)) {
        const line = document.createElement("div");
        line.className = `${P}-a11y-row`;
        line.dataset.kind = row.kind;

        const badge = document.createElement("span");
        badge.className = `${P}-a11y-badge`;
        badge.textContent = row.kind === "pass" ? "✓" : row.kind === "fail" ? "✕" : "!";

        const label = document.createElement("strong");
        label.textContent = row.label;

        const detail = document.createElement("span");
        detail.className = `${P}-a11y-detail`;
        detail.textContent = row.detail;

        line.append(badge, label, detail);
        card.appendChild(line);
      }

      // The differentiator, as everywhere: the finding names its file, so a
      // comment about it lands where the fix goes.
      const source = annotationFor(el);
      if (source.sourceFile) {
        const where = document.createElement("div");
        where.className = `${P}-a11y-source`;
        where.textContent = source.sourceLine
          ? `${source.sourceFile}:${source.sourceLine}`
          : source.sourceFile;
        card.appendChild(where);
      }

      card.hidden = false;
      position(el);
    },

    hide() {
      card.hidden = true;
    },

    get visible() {
      return !card.hidden;
    },

    reposition(el) {
      if (!card.hidden && el) position(el);
    },
  };

  function position(el) {
    const rect = el.getBoundingClientRect();
    const height = card.offsetHeight || 120;
    const width = card.offsetWidth || 280;

    const below = rect.bottom + 8;
    card.style.top = `${
      below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - height - 8)
    }px`;
    card.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  }
}
