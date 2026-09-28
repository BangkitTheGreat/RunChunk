import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { WebhookTriggerData } from "./workflow/types";

// Public webhook endpoints: the token is the whole secret. It is generated here, shown to the owner once,
// and only its SHA-256 is stored, so a database read never yields a usable URL.

const TOKEN_BYTES = 32;
/** base64url of 32 bytes is 43 chars. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const MAX_WEBHOOK_BODY_BYTES = 256_000;
export const WEBHOOK_WINDOW_SECONDS = 60;

/** Request headers worth handing to the workflow. Auth headers and cookies never enter trigger data. */
const FORWARDED_HEADERS = ["content-type", "user-agent", "x-request-id", "x-github-event", "x-event-type"];

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenHint(token: string): string {
  return token.slice(-4);
}

export function webhookUrl(token: string, appUrl: string): string {
  return new URL(`/api/v1/webhooks/${token}`, appUrl).toString();
}

/** Parses a webhook body by content type: JSON, form-urlencoded, or plain text. Empty bodies become null. */
export function parseWebhookBody(contentType: string | null, raw: string): unknown {
  if (!raw) return null;
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type === "application/json" || type.endsWith("+json")) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error("errors.webhookInvalidJson");
    }
  }
  if (type === "application/x-www-form-urlencoded") return Object.fromEntries(new URLSearchParams(raw));
  return raw;
}

export function buildTriggerData(request: { method: string; url: string; headers: Headers }, body: unknown, receivedAt: Date): WebhookTriggerData {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value.slice(0, 512);
  }
  return {
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams),
    headers,
    body,
    receivedAt: receivedAt.toISOString(),
  };
}

// Optional request signing. Senders that support it put `t=<unix seconds>,v1=<hex HMAC-SHA256>` in
// X-RunChunk-Signature, where the MAC covers `${t}.${rawBody}` with the endpoint's shared secret.
// The timestamp bounds replay; the comparison is constant-time.

export const SIGNATURE_HEADER = "x-runchunk-signature";
export const SIGNATURE_TOLERANCE_SECONDS = 300;
const SECRET_BYTES = 32;

export function generateSigningSecret(): string {
  return randomBytes(SECRET_BYTES).toString("base64url");
}

function mac(secret: string, timestamp: number, rawBody: string): Buffer {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest();
}

/** Header value a sender must attach. Exposed for docs, tests, and the curl example in the editor. */
export function signPayload(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${mac(secret, timestamp, rawBody).toString("hex")}`;
}

export type SignatureVerdict = { ok: true } | { ok: false; reason: "errors.webhookSignatureMissing" | "errors.webhookSignatureInvalid" | "errors.webhookSignatureStale" };

export function verifySignature(secret: string, header: string | null, rawBody: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS): SignatureVerdict {
  if (!header) return { ok: false, reason: "errors.webhookSignatureMissing" };
  const parts = new Map<string, string[]>();
  for (const piece of header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq <= 0) continue;
    const key = piece.slice(0, eq).trim();
    parts.set(key, [...(parts.get(key) ?? []), piece.slice(eq + 1).trim()]);
  }
  const timestamp = Number(parts.get("t")?.[0]);
  const candidates = (parts.get("v1") ?? []).filter((value) => /^[0-9a-f]{64}$/i.test(value));
  if (!Number.isInteger(timestamp) || candidates.length === 0) return { ok: false, reason: "errors.webhookSignatureInvalid" };
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { ok: false, reason: "errors.webhookSignatureStale" };
  const expected = mac(secret, timestamp, rawBody);
  // Several v1 values are allowed so a sender can sign with old and new secrets during rotation.
  const matched = candidates.some((candidate) => timingSafeEqual(Buffer.from(candidate, "hex"), expected));
  return matched ? { ok: true } : { ok: false, reason: "errors.webhookSignatureInvalid" };
}
