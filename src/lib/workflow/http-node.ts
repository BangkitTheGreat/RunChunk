import { credentialHeader, decryptSecret, type EncryptedSecret } from "../vault";
import { isSensitiveKey, redact, secretMatcher } from "./redact";
import type { HttpAttemptResult, HttpNodeRequest } from "./engine";
import type { SafeHttpRequest, SafeHttpResponse } from "./http";

export interface CredentialRow extends EncryptedSecret {
  id: string;
  type: string;
  header_name: string | null;
}

export interface HttpNodeDeps {
  userId: string;
  /** Loads a credential owned by `userId`, or null. */
  loadCredential(credentialId: string): Promise<CredentialRow | null>;
  fetch(request: SafeHttpRequest): Promise<SafeHttpResponse>;
}

/**
 * A typed auth header value plus the parts that are secret on their own, so an API that echoes only
 * the token (not the whole `Bearer …` line) is still scrubbed.
 */
export function headerSecrets(value: string): string[] {
  const secrets = [value];
  const scheme = value.match(/^\s*([A-Za-z][\w-]*)\s+(\S.*)$/);
  if (scheme) {
    const credentials = scheme[2].trim();
    secrets.push(credentials);
    if (scheme[1].toLowerCase() === "basic") {
      const decoded = Buffer.from(credentials, "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon > 0 && /^[\x20-\x7e]+$/.test(decoded)) secrets.push(decoded, decoded.slice(colon + 1));
    }
  }
  // Cookie-style `a=b; c=d`: each value is a secret by itself.
  for (const pair of value.split(";")) {
    const eq = pair.indexOf("=");
    if (eq > 0) secrets.push(pair.slice(eq + 1).trim());
  }
  return secrets.filter(Boolean);
}

/** Transient failures worth another attempt; everything else is a configuration or policy error. */
const RETRYABLE_ERRORS = new Set(["errors.httpTimeout", "errors.httpRequestFailed", "errors.httpDnsFailed"]);

/**
 * One HTTP attempt: decrypt the credential, send, redact. Decryption and the request share this call
 * so the plaintext secret only ever exists inside one Inngest step and is never part of its result.
 */
export async function runHttpAttempt(request: HttpNodeRequest, deps: HttpNodeDeps): Promise<HttpAttemptResult> {
  // User-typed values of auth-looking headers are secrets too, even when not stored in the Vault.
  const secrets = Object.entries(request.headers).filter(([key]) => isSensitiveKey(key)).flatMap(([, value]) => headerSecrets(value));
  try {
    const headers = { ...request.headers };
    if (request.credentialId) {
      const row = await deps.loadCredential(request.credentialId);
      if (!row) return { ok: false, error: "errors.credentialNotFound", retryable: false };
      const header = credentialHeader(decryptSecret(row, deps.userId, row.id), row.header_name);
      // The credential wins over any same-named header typed into the node.
      for (const key of Object.keys(headers)) if (key.toLowerCase() === header.name) delete headers[key];
      headers[header.name] = header.value;
      secrets.push(...header.secrets);
    }
    const response = await deps.fetch({ url: request.url, method: request.method, headers, body: request.body });
    return { ok: true, response: redact(response, secretMatcher(secrets)) as SafeHttpResponse };
  } catch (error) {
    const key = error instanceof Error && error.message.startsWith("errors.") ? error.message : "errors.httpRequestFailed";
    return { ok: false, error: key, retryable: RETRYABLE_ERRORS.has(key) };
  }
}
