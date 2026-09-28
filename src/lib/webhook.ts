import { createHash, randomBytes } from "node:crypto";
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
