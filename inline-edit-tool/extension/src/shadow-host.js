"use strict";

import uiCss from "../ui.css";

// ============================================================
//  Shadow host
//
//  All extension chrome lives inside a closed shadow root, so
//  the host page cannot restyle it and our styles cannot leak
//  into the page. Only decorations applied to page elements
//  (hover ring, dirty highlight) use page-level CSS.
// ============================================================

const HOST_ID = "__iet-root";

let host = null;
let root = null;

/**
 * Create (or return) the shadow root that holds the UI.
 * @returns {ShadowRoot}
 */
export function getShadowRoot() {
  if (root) return root;

  host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    // The host itself must not participate in page layout; the panels inside
    // position themselves. `all: initial` cannot go here — it would reset the
    // fixed positioning we need.
    host.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;margin:0;padding:0;border:0;z-index:2147483647;";
    document.documentElement.appendChild(host);
  }

  // Closed: nothing on the page can reach in via host.shadowRoot.
  root = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = uiCss;
  root.appendChild(style);

  return root;
}

/** True if the node belongs to our UI rather than the page. */
export function isOwnUi(el) {
  return Boolean(el.closest?.(`#${HOST_ID}`)) || el.getRootNode?.() === root;
}

export function destroyShadowHost() {
  host?.remove();
  host = null;
  root = null;
}
