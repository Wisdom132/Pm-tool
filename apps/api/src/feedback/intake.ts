import { createHash } from 'node:crypto';

/**
 * The rules that make a public feedback endpoint survivable.
 *
 * Kept apart from the service, and free of Nest and Prisma, because these
 * are the decisions worth testing exhaustively: every one of them is the
 * difference between an endpoint anyone can post to and an endpoint anyone
 * can bring down.
 */

/**
 * The largest screenshot accepted, after client-side downscaling.
 *
 * A 1440×900 PNG of a real page is comfortably under this once it has been
 * scaled to 1200px wide and encoded as JPEG. The cap is not a guess about
 * what images weigh — it is the point past which an image is being used to
 * fill the database rather than to show what was on screen.
 *
 * It is enforced on the decoded byte length, not on the base64 string: the
 * encoding is a third larger, and a limit that lets a 700KB image through
 * because the number it checked was the base64 length is not a limit.
 */
export const MAX_SCREENSHOT_BYTES = 512 * 1024;

/** What a browser can actually render, and what we can be sure is an image. */
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * The magic bytes each type must actually start with.
 *
 * The declared content type is attacker-controlled. Without this check the
 * endpoint stores whatever it was handed and later serves it back with an
 * `image/png` header — which is how an upload endpoint becomes a way to
 * host arbitrary content on somebody else's domain.
 */
const MAGIC: Array<{ type: string; bytes: number[] }> = [
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  // WEBP is RIFF....WEBP — the size field sits between, so it is checked in
  // two pieces.
  { type: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
];

export class ScreenshotRejected extends Error {}

/**
 * Decode and vet an uploaded screenshot.
 *
 * @param dataUrl `data:image/png;base64,...` as a canvas produces it
 * @returns the bytes and the *verified* type, never the declared one
 * @throws {ScreenshotRejected} with a reason safe to show a visitor
 */
export function decodeScreenshot(dataUrl: string): {
  // Backed by a plain ArrayBuffer rather than Node's pooled Buffer memory:
  // `Buffer.from` hands back a view into a shared pool, and Prisma's Bytes
  // column will not take one.
  bytes: Uint8Array<ArrayBuffer>;
  type: string;
} {
  const match = /^data:([a-z/+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new ScreenshotRejected('The screenshot is not a base64 data URL.');

  const [, declared, payload] = match;
  if (!ALLOWED_IMAGE_TYPES.has(declared.toLowerCase())) {
    throw new ScreenshotRejected(`${declared} is not an accepted image type.`);
  }

  // Check the encoded length before decoding. Decoding first would mean
  // allocating whatever was sent in order to find out it was too big, which
  // is the denial of service the cap exists to prevent.
  if (payload.length > Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 4) {
    throw new ScreenshotRejected('The screenshot is too large.');
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, 'base64');
  } catch {
    throw new ScreenshotRejected('The screenshot could not be decoded.');
  }

  if (bytes.length === 0) throw new ScreenshotRejected('The screenshot is empty.');
  if (bytes.length > MAX_SCREENSHOT_BYTES) {
    throw new ScreenshotRejected('The screenshot is too large.');
  }

  const actual = sniff(bytes);
  if (!actual) throw new ScreenshotRejected('The screenshot is not a PNG, JPEG or WebP.');

  // Mismatched is not merely wrong, it is a lie about content — refuse it
  // rather than quietly trusting the bytes over the label.
  if (actual !== declared.toLowerCase()) {
    throw new ScreenshotRejected('The screenshot does not match its declared type.');
  }

  // Copied into its own ArrayBuffer rather than wrapping the pooled one.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return { bytes: copy, type: actual };
}

/** The real type, from the leading bytes. */
function sniff(bytes: Buffer): string | null {
  for (const { type, bytes: magic } of MAGIC) {
    if (bytes.length < magic.length) continue;
    if (!magic.every((b, i) => bytes[i] === b)) continue;

    if (type === 'image/webp') {
      // RIFF alone is a container; the form matters.
      if (bytes.length < 12) continue;
      if (bytes.toString('ascii', 8, 12) !== 'WEBP') continue;
    }

    return type;
  }
  return null;
}

/**
 * A stable, non-reversible handle for one address.
 *
 * Salted with the same secret that signs state, so the hashes in the
 * database cannot be checked against a list of candidate addresses by
 * anybody who obtains a copy of it — an unsalted hash of an IPv4 address is
 * reversible by brute force in seconds, there being only four billion.
 */
export function hashIp(ip: string, secret: string): string {
  return createHash('sha256').update(`${secret}:${ip}`).digest('hex').slice(0, 32);
}

/**
 * The client's address, from the proxy chain.
 *
 * Takes the *first* entry of `x-forwarded-for`, which is the original
 * client, and falls back to the socket. Only trusted when
 * `TRUST_PROXY` is set: read unconditionally, the header is
 * attacker-controlled and every rate limit keyed on it becomes bypassable
 * by sending a different value each time.
 */
export function clientIp(
  headers: Record<string, string | string[] | undefined>,
  socketAddress: string | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const forwarded = headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = raw?.split(',')[0]?.trim();
    if (first) return first;
  }
  return socketAddress ?? 'unknown';
}

/**
 * The browser string, trimmed to something storable.
 *
 * Read from the request header rather than the body on every path. A client
 * that reports its own user agent can report any user agent, and the field
 * exists to answer "what was it broken in" — a value the reporter chose is
 * worth less than no value, because it looks like evidence.
 */
export function readUserAgent(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const raw = headers['user-agent'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 400) : null;
}

/**
 * Is this page URL on the hostname that claims it?
 *
 * The public widget sends the page it is on. Without this check a comment
 * could be filed against a registered site while naming any URL at all,
 * and the inbox would show a link that has nothing to do with the site.
 *
 * Wildcards match one leading label, matching the site registry's own rule.
 */
export function urlMatchesHostname(pageUrl: string, hostname: string): boolean {
  let host: string;
  try {
    const url = new URL(pageUrl);
    // Only ever http(s). A `javascript:` or `data:` URL stored here is
    // rendered as a link in the dashboard later.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    host = url.hostname.toLowerCase();
  } catch {
    return false;
  }

  const pattern = hostname.toLowerCase();
  if (!pattern.startsWith('*.')) return host === pattern;

  const suffix = pattern.slice(2);
  if (!host.endsWith(`.${suffix}`)) return false;

  // One label, as the registry specifies: a.b.example.com must not match
  // *.example.com.
  const label = host.slice(0, host.length - suffix.length - 1);
  return label.length > 0 && !label.includes('.');
}
