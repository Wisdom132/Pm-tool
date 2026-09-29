"use strict";

// ============================================================
//  Tool hint cards
//
//  Selecting a tool shows a card: what the tool is, its key,
//  and a table of gestures. In the manner of VisBug, and for
//  the same reason — a rail of icons tells you what exists,
//  but nothing on screen told you *how to use* the thing you
//  just picked. The old toast held one sentence and vanished;
//  a tool with four gestures got to advertise one of them.
//
//  The card is also where the hidden gestures finally get
//  said out loud. ⌥-click has opened the source editor from
//  any tool since it was built, and nothing anywhere on the
//  screen admitted it.
//
//  Shown on selection, dismissed by the first click on the
//  page — once someone is using the tool, the card is in the
//  way of the page they are using it on.
// ============================================================

const P = "__iet";

/** The ⌥/alt label, in the local dialect. */
const ALT = navigator.platform?.includes("Mac") ? "⌥" : "alt";
const META = navigator.platform?.includes("Mac") ? "⌘" : "ctrl";

/**
 * One entry per tool. `rows` are gesture → how, in the order somebody
 * actually uses them: the primary gesture first, the escape hatch last.
 */
export const CARDS = {
  inspect: {
    title: "Inspect",
    key: "I",
    intro: "See where anything on the page comes from.",
    rows: [
      ["Peek", "hover"],
      ["Pin it", "click"],
      ["Measure to another", "pin, then hover"],
      ["Open the source editor", `${ALT} click`],
      ["Clear", "esc"],
    ],
  },
  edit: {
    title: "Edit text",
    key: "E",
    intro: "Click any highlighted text and rewrite it in place.",
    rows: [
      ["Rewrite", "click the text"],
      ["Finish", "enter, or click away"],
      ["Open the source editor", `${ALT} click`],
      ["Undo", `${META} Z`],
    ],
  },
  properties: {
    title: "Properties",
    key: "P",
    intro: "Links, alt text, classes and images — on any element.",
    rows: [
      ["Open", "click anything"],
      ["Change alt text or a link", "type in the panel"],
      ["Swap an image", "choose a file in the panel"],
      ["Open the source editor", `${ALT} click`],
    ],
  },
  structure: {
    title: "Rearrange",
    key: "R",
    intro: "Move, duplicate or delete any element.",
    rows: [
      ["Pick", "click anything"],
      ["Move, duplicate, delete", "buttons in the bar"],
      ["Open the source editor", `${ALT} click`],
      ["Put it back", `${META} Z`],
    ],
  },
  comment: {
    title: "Comment",
    key: "C",
    intro: "Leave a note for whoever can fix it — pinned to the source line.",
    rows: [
      ["Pin a note", "click anything"],
      ["Send", `${META} enter`],
      ["Cancel", "esc"],
    ],
  },
};

export function createToolCard() {
  const card = document.createElement("div");
  card.className = `${P}-toolcard`;
  card.hidden = true;

  return {
    element: card,

    /** @param {string} toolId a key of CARDS */
    show(toolId) {
      const spec = CARDS[toolId];
      if (!spec) {
        card.hidden = true;
        return;
      }

      card.textContent = "";

      const head = document.createElement("div");
      head.className = `${P}-toolcard-head`;

      const title = document.createElement("strong");
      title.textContent = spec.title;

      const key = document.createElement("kbd");
      key.className = `${P}-toolcard-key`;
      key.textContent = spec.key;

      head.append(title, key);

      const intro = document.createElement("p");
      intro.className = `${P}-toolcard-intro`;
      intro.textContent = spec.intro;

      const table = document.createElement("dl");
      table.className = `${P}-toolcard-rows`;
      for (const [what, how] of spec.rows) {
        const dt = document.createElement("dt");
        dt.textContent = what;
        const dd = document.createElement("dd");
        dd.textContent = how;
        table.append(dt, dd);
      }

      card.append(head, intro, table);
      card.hidden = false;
    },

    hide() {
      card.hidden = true;
    },

    get visible() {
      return !card.hidden;
    },

    /** Mirrors the rail: the card sits beside it, whichever side that is. */
    setSide(side) {
      card.dataset.side = side === "right" ? "right" : "left";
    },
  };
}
