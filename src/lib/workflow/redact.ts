// Output redaction. Runs inside the HTTP step before anything leaves it, so secrets never reach
// Inngest step state, later nodes, execution rows, logs, or the browser.

export const REDACTED = "[REDACTED]";

/** Field names that carry secrets in common APIs (OAuth token endpoints, echo services, auth headers). */
const SENSITIVE_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|id[-_]?token|token|client[-_]?secret|secret|password|passwd)$/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Every encoding of a secret we might find echoed back: raw, URL-encoded, JSON-escaped. */
export function secretVariants(secrets: string[]): string[] {
  const variants = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    variants.add(secret);
    variants.add(encodeURIComponent(secret));
    variants.add(JSON.stringify(secret).slice(1, -1));
  }
  // Longest first so a secret that contains another is replaced whole.
  return [...variants].filter((value) => value.length >= 4).sort((a, b) => b.length - a.length);
}

function scrub(text: string, variants: string[]): string {
  let out = text;
  for (const variant of variants) if (out.includes(variant)) out = out.split(variant).join(REDACTED);
  return out;
}

/**
 * Deep copy of `value` with sensitive fields masked and every known secret string replaced.
 * `variants` should come from `secretVariants`.
 */
export function redact(value: unknown, variants: string[] = [], depth = 0): unknown {
  if (depth > 64) return REDACTED;
  if (typeof value === "string") return scrub(value, variants);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, variants, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const safeKey = scrub(key, variants);
    Object.defineProperty(out, safeKey, {
      value: isSensitiveKey(key) && item !== null && item !== undefined && item !== "" ? REDACTED : redact(item, variants, depth + 1),
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
