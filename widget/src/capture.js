"use strict";

// ============================================================
//  Screenshots, from a page that cannot screenshot itself
//
//  The extension captures the tab through `chrome.tabs`. A plain
//  web page has no equivalent, and this is worth being honest
//  about rather than working around:
//
//  The popular workaround is a DOM-rasterising library —
//  html2canvas and its relatives. They re-render the page from
//  computed styles rather than capturing it, so what arrives is
//  a *drawing* of the page: cross-origin images missing,
//  transforms approximated, shadow DOM and canvas blank. For a
//  bug report that is worse than nothing, because the difference
//  between the drawing and the real page looks like the bug.
//  They also cost a couple of hundred kilobytes on a widget
//  whose whole point is being small.
//
//  So this uses `getDisplayMedia`, which is a real capture of
//  what is really on screen. The cost is a browser permission
//  prompt asking the visitor to choose what to share, which is
//  intrusive enough that it must never be automatic — it happens
//  only when somebody presses the button.
// ============================================================

/** Mirrors the API's cap, with room left under it. */
const MAX_BYTES = 480 * 1024;
const MAX_WIDTH = 1400;
const QUALITIES = [0.7, 0.55, 0.4, 0.3];

/** Is a real capture available at all? */
export function screenshotSupported() {
  return typeof navigator?.mediaDevices?.getDisplayMedia === "function";
}

/**
 * Capture one frame of what the visitor chooses to share.
 *
 * @returns {Promise<string|null>} a JPEG data URL, or null — including when
 *          the visitor declines, which is an ordinary outcome and not an
 *          error worth showing them
 */
export async function captureScreen() {
  if (!screenshotSupported()) return null;

  let stream = null;

  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
      // A hint, not a guarantee: browsers differ on whether they honour it,
      // and the visitor picks in the end regardless.
      preferCurrentTab: true,
    });

    const frame = await grabFrame(stream);
    return frame ? encode(frame) : null;
  } catch {
    // Declining the prompt throws. So does a browser that offers the API
    // and refuses it in an insecure context.
    return null;
  } finally {
    // Every track must be stopped, or the browser goes on showing the
    // "sharing your screen" indicator after the widget is closed.
    stream?.getTracks().forEach((track) => track.stop());
  }
}

/**
 * One frame, as a bitmap.
 *
 * A video element rather than `ImageCapture`: that API is still not in
 * Safari or Firefox, and this is a widget for other people's visitors.
 */
async function grabFrame(stream) {
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;

  await video.play().catch(() => {});

  // The first frame is not necessarily ready when `play` resolves, and
  // drawing too early produces a black image.
  if (!video.videoWidth) {
    await new Promise((resolve) => {
      video.addEventListener("loadeddata", resolve, { once: true });
      setTimeout(resolve, 1000);
    });
  }

  if (!video.videoWidth || !video.videoHeight) return null;
  return video;
}

/** Scale to the cap, then step quality down until it fits. */
function encode(video) {
  const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  for (const quality of QUALITIES) {
    const encoded = canvas.toDataURL("image/jpeg", quality);
    if (decodedSize(encoded) <= MAX_BYTES) return encoded;
  }
  return null;
}

/** The decoded byte length of a base64 data URL, without decoding it. */
export function decodedSize(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;

  const payload = dataUrl.slice(comma + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;

  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}
