// Output redaction. Runs inside the HTTP step before anything leaves it, so secrets never reach
// Inngest step state, later nodes, execution rows, logs, or the browser.

export const REDACTED = "[REDACTED]";

/** Field names that carry secrets in common APIs (OAuth token endpoints, echo services, auth headers). */
const SENSITIVE_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|id[-_]?token|token|client[-_]?secret|secret|password|passwd)$/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Hex digits match in either case: `%2f` and `%2F` decode to the same byte. */
const hexPattern = (value: number, width: number) =>
  value.toString(16).padStart(width, "0").replace(/[a-f]/g, (digit) => `[${digit}${digit.toUpperCase()}]`);

/** Every way one character of a secret can appear in a response: raw, percent-encoded, form-encoded, JSON-escaped. */
function charPattern(char: string): string {
  const alternatives = new Set([escapeRegExp(char)]);
  alternatives.add([...Buffer.from(char, "utf8")].map((byte) => `%${hexPattern(byte, 2)}`).join(""));
  if (char === " ") alternatives.add("\\+");
  const code = char.codePointAt(0)!;
  if (code <= 0xffff) alternatives.add(`\\\\u${hexPattern(code, 4)}`);
  if (char === "/" || char === '"' || char === "\\") alternatives.add(`\\\\${escapeRegExp(char)}`);
  return `(?:${[...alternatives].join("|")})`;
}

/**
 * One matcher for all secrets, tolerant of per-character encoding (so `demo+key%2f123` still matches
 * `demo key/123`). Secrets shorter than 4 characters are ignored to avoid shredding unrelated text.
 */
export function secretMatcher(secrets: string[]): RegExp | null {
  const unique = [...new Set(secrets)].filter((secret) => secret.length >= 4).sort((a, b) => b.length - a.length);
  if (!unique.length) return null;
  return new RegExp(unique.map((secret) => Array.from(secret, charPattern).join("")).join("|"), "g");
}

function scrub(text: string, matcher: RegExp | null): string {
  return matcher ? text.replace(matcher, REDACTED) : text;
}

/**
 * Deep copy of `value` with sensitive fields masked and every known secret string replaced.
 * `matcher` should come from `secretMatcher`.
 */
export function redact(value: unknown, matcher: RegExp | null = null, depth = 0): unknown {
  if (depth > 64) return REDACTED;
  if (typeof value === "string") return scrub(value, matcher);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, matcher, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const safeKey = scrub(key, matcher);
    Object.defineProperty(out, safeKey, {
      value: isSensitiveKey(key) && item !== null && item !== undefined && item !== "" ? REDACTED : redact(item, matcher, depth + 1),
      enumerable: true, configurable: true, writable: true,
    });
  }
  return out;
}

/** Bounded preview for execution_logs: the log never stores more than `maxBytes` of a node's output. */
export function preview(value: unknown, maxBytes = 4_000): { preview: string; truncated: boolean } {
  const text = JSON.stringify(value ?? null, null, 2) ?? "null";
  const bytes = Buffer.from(text);
  if (bytes.length <= maxBytes) return { preview: text, truncated: false };
  // Cut on a byte boundary, then drop any partial UTF-8 sequence at the end.
  return { preview: bytes.subarray(0, maxBytes).toString("utf8").replace(/�+$/, ""), truncated: true };
}
