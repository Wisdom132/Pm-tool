"use strict";

import { icon } from "./icons.js";

// ============================================================
//  Tool rail
//
//  A floating vertical strip of tools, in the manner of VisBug.
//  Tools are modes — exactly one is active at a time, and the
//  active one decides what clicking the page does. Actions are
//  one-shot buttons that never become active.
// ============================================================

const P = "__iet";

/** Modes. Selecting one deselects the others. */
export const TOOL = {
  INSPECT: "inspect",
  EDIT: "edit",
  PROPERTIES: "properties",
  STRUCTURE: "structure",
};

const TOOLS = [
  { id: TOOL.INSPECT, icon: "inspect", label: "Inspect", hint: "See where text comes from" },
  { id: TOOL.EDIT, icon: "edit", label: "Edit text", hint: "Click any text to rewrite it" },
  {
    id: TOOL.PROPERTIES,
    icon: "properties",
    label: "Properties",
    hint: "Links, alt text and classes",
  },
  {
    id: TOOL.STRUCTURE,
    icon: "copy",
    label: "Rearrange",
    hint: "Move, duplicate or delete",
  },
];

/**
 * View options. Unlike a tool these do not change what a click does, so
 * turning one on must not deselect the active tool.
 */
const TOGGLES = [
  {
    id: "responsive",
    icon: "responsive",
    label: "Responsive",
    hint: "Resize to a breakpoint",
  },
  {
    id: "guides",
    icon: "guides",
    label: "Alignment guides",
    hint: "Dashed lines on hover",
  },
];

const ACTIONS = [
  { id: "undo", icon: "undo", label: "Undo", shortcut: "⌘Z" },
  { id: "redo", icon: "redo", label: "Redo", shortcut: "⇧⌘Z" },
  { id: "changes", icon: "changes", label: "Changes", counted: true },
  { id: "submit", icon: "submit", label: "Open pull request" },
];

/**
 * @param {object} handlers
 * @param {(toolId: string|null) => void} handlers.onTool  null when the active tool is switched off
 * @param {(actionId: string) => void}    handlers.onAction
 * @param {(toggleId: string, on: boolean) => void} handlers.onToggle
 * @returns {object} rail controller
 */
export function createRail({ onTool, onAction, onToggle }) {
  const rail = document.createElement("div");
  rail.id = `${P}-rail`;
  rail.setAttribute("role", "toolbar");
  rail.setAttribute("aria-label", "Inline Edit Tool");
  rail.hidden = true;

  const buttons = new Map();
  let activeTool = null;

  function mkButton({ id, icon: iconName, label, hint, shortcut, counted, isTool, isToggle }) {
    const btn = document.createElement("button");
    btn.className = `${P}-tool`;
    btn.dataset.id = id;
    btn.type = "button";
    btn.setAttribute("aria-label", label);
    if (isTool || isToggle) btn.setAttribute("aria-pressed", "false");
    if (isToggle) btn.dataset.toggle = "true";

    btn.appendChild(icon(iconName));

    // Tooltip is a child of the button so it inherits the rail's stacking
    // context and needs no positioning maths.
    const tip = document.createElement("span");
    tip.className = `${P}-tip`;

    const tipTitle = document.createElement("span");
    tipTitle.className = `${P}-tip-title`;
    tipTitle.textContent = label;
    tip.appendChild(tipTitle);

    if (hint || shortcut) {
      const sub = document.createElement("span");
      sub.className = `${P}-tip-sub`;
      sub.textContent = shortcut || hint;
      tip.appendChild(sub);
    }
    btn.appendChild(tip);

    if (counted) {
      const badge = document.createElement("span");
      badge.className = `${P}-count`;
      badge.hidden = true;
      btn.appendChild(badge);
    }

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isTool) selectTool(activeTool === id ? null : id);
      else if (isToggle) setToggle(id, btn.getAttribute("aria-pressed") !== "true");
      else onAction?.(id);
    });

    buttons.set(id, btn);
    return btn;
  }

  // The rail floats over the page and will sometimes cover the very text
  // someone wants to edit, so the brand doubles as a dock-side switch.
  const brand = document.createElement("button");
  brand.className = `${P}-brand`;
  brand.type = "button";
  brand.setAttribute("aria-label", "Move toolbar to the other side");
  brand.textContent = "IE";

  const brandTip = document.createElement("span");
  brandTip.className = `${P}-tip`;
  const brandTipTitle = document.createElement("span");
  brandTipTitle.className = `${P}-tip-title`;
  brandTipTitle.textContent = "Inline Edit Tool";
  const brandTipSub = document.createElement("span");
  brandTipSub.className = `${P}-tip-sub`;
  brandTipSub.textContent = "Click to switch side";
  brandTip.append(brandTipTitle, brandTipSub);
  brand.appendChild(brandTip);

  brand.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onAction?.("flip");
  });

  rail.appendChild(brand);

  rail.appendChild(separator());

  for (const tool of TOOLS) rail.appendChild(mkButton({ ...tool, isTool: true }));

  for (const toggle of TOGGLES) {
    rail.appendChild(mkButton({ ...toggle, isToggle: true }));
  }

  rail.appendChild(separator());

  for (const action of ACTIONS) rail.appendChild(mkButton(action));

  rail.appendChild(separator());
  rail.appendChild(
    mkButton({ id: "close", icon: "close", label: "Hide toolbar" })
  );

  function separator() {
    const hr = document.createElement("div");
    hr.className = `${P}-rail-sep`;
    return hr;
  }

  /** @param {{silent?: boolean}} opts  silent when restoring a stored value */
  function setToggle(id, on, { silent = false } = {}) {
    buttons.get(id).setAttribute("aria-pressed", String(Boolean(on)));
    if (!silent) onToggle?.(id, Boolean(on));
  }

  function selectTool(id) {
    activeTool = id;
    for (const tool of TOOLS) {
      buttons.get(tool.id).setAttribute("aria-pressed", String(tool.id === id));
    }
    onTool?.(id);
  }

  return {
    element: rail,

    show() {
      rail.hidden = false;
    },

    hide() {
      rail.hidden = true;
      if (activeTool) selectTool(null);
    },

    get visible() {
      return !rail.hidden;
    },

    get activeTool() {
      return activeTool;
    },

    selectTool,
    setToggle,

    isToggleOn(id) {
      return buttons.get(id)?.getAttribute("aria-pressed") === "true";
    },

    setCount(n) {
      const badge = buttons.get("changes").querySelector(`.${P}-count`);
      badge.textContent = String(n);
      badge.hidden = n === 0;
      buttons.get("submit").disabled = n === 0;
      buttons.get("changes").disabled = n === 0;
    },

    setHistory({ canUndo, canRedo }) {
      buttons.get("undo").disabled = !canUndo;
      buttons.get("redo").disabled = !canRedo;
    },

    /** @param {'left'|'right'} side */
    setSide(side) {
      rail.dataset.side = side === "right" ? "right" : "left";
    },

    get side() {
      return rail.dataset.side === "right" ? "right" : "left";
    },
  };
}

/**
 * Transient message anchored beside the rail.
 *
 * Replaces the old always-present status strip: a toast says what just
 * happened and then gets out of the way.
 */
export function createToast() {
  const toast = document.createElement("div");
  toast.id = `${P}-toast`;
  toast.hidden = true;

  let timer = null;

  return {
    element: toast,
    show(message, { tone = "info", duration = 2600 } = {}) {
      clearTimeout(timer);
      toast.textContent = message;
      toast.dataset.tone = tone;
      toast.hidden = false;
      // Restart the entry animation on repeat messages.
      toast.classList.remove(`${P}-toast-in`);
      void toast.offsetWidth;
      toast.classList.add(`${P}-toast-in`);

      if (duration > 0) {
        timer = setTimeout(() => {
          toast.hidden = true;
        }, duration);
      }
    },
    hide() {
      clearTimeout(timer);
      toast.hidden = true;
    },
  };
}
