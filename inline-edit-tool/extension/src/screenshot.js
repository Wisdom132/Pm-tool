"use strict";

// ============================================================
//  Screenshots
//
//  Most of a bug report is context nobody types. A picture of
//  what the person was actually looking at answers questions
//  the comment never will: which breakpoint, what was above it,
//  whether the thing they are describing had even rendered.
//
//  The capture itself belongs to the service worker — a content
//  script has no `chrome.tabs`. What lives here is everything
//  that has to happen before it can be sent: the overlay has to
//  come off the page first, and the image has to be brought
//  under the API's cap, which a retina viewport will not be.
// ============================================================

/**
 * The API refuses anything larger. Mirrored from
 * `MAX_SCREENSHOT_BYTES`, with room left under it rather than
 * aiming exactly at it: being refused after uploading half a
 * megabyte is a bad way to find out.
 */
export const MAX_BYTES = 480 * 1024;

/** Beyond this, a page screenshot is showing detail nobody reads. */
export const MAX_WIDTH = 1400;

/** Tried in order until one fits. Below the last, give up rather than ship mush. */
export const QUALITIES = [0.7, 0.55, 0.4, 0.3];

/**
 * How large the stored image should be.
 *
 * A retina display reports 1440 CSS pixels and captures 2880 device pixels.
 * Storing both is paying twice for the same picture, so anything wider than
 * `MAX_WIDTH` is scaled down with its aspect ratio kept.
 *
 * @returns {{width: number, height: number}} whole pixels — a canvas with a
 *          fractional height silently floors it and shifts the image
 */
export function targetSize(width, height, maxWidth = MAX_WIDTH) {
  if (!width || !height) return { width: 0, height: 0 };
  if (width <= maxWidth) return { width: Math.round(width), height: Math.round(height) };

  const scale = maxWidth / width;
  return {
    width: maxWidth,
    // At least one pixel: a very wide, very short image would otherwise
    // round to zero and produce a canvas that cannot be drawn to.
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The decoded size of a base64 data URL, without decoding it.
 *
 * Every four characters of base64 are three bytes, less the padding. Used to
 * decide whether to try a lower quality, so measuring must not cost as much
 * as the encoding did.
 */
export function decodedSize(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;

  const payload = dataUrl.slice(comma + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;

  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

/**
 * Ask the service worker for a picture of the visible tab.
 *
 * @param {Element|null} hide an overlay to take off the page first
 * @returns {Promise<string|null>} a data URL, or null if anything at all
 *          went wrong — a comment without a screenshot is still a comment,
 *          and failing to attach one must never lose what somebody wrote
 */
export async function captureViewport(hide = null) {
  const previous = hide?.style.visibility ?? null;

  try {
    // The overlay is ours. Leaving it up produces a screenshot of this tool
    // sitting on top of the page, which is the one thing the reader does not
    // need to see.
    if (hide) {
      hide.style.visibility = "hidden";
      // One frame, so the browser has actually painted the hidden state
      // before the capture is taken.
      await nextPaint();
    }

    const response = await chrome.runtime.sendMessage({ type: "CAPTURE_TAB" });
    if (!response?.data) return null;

    return await shrink(response.data);
  } catch {
    return null;
  } finally {
    if (hide) hide.style.visibility = previous ?? "";
  }
}

/**
 * Bring a data URL under the cap.
 *
 * Scales first, then lowers quality in steps. That order matters: halving
 * the dimensions removes three quarters of the pixels, while dropping
 * quality far enough to match would leave text unreadable — and the text is
 * usually the point.
 *
 * @returns {Promise<string|null>} null when even the lowest setting is too
 *          large, which is better than uploading something the API refuses
 */
export async function shrink(dataUrl) {
  const image = await loadImage(dataUrl);
  if (!image) return null;

  const { width, height } = targetSize(image.width, image.height);
  if (!width || !height) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);

  for (const quality of QUALITIES) {
    const encoded = canvas.toDataURL("image/jpeg", quality);
    if (decodedSize(encoded) <= MAX_BYTES) return encoded;
  }

  return null;
}

function loadImage(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
