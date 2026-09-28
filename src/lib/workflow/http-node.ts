import { credentialHeader, decryptSecret, type EncryptedSecret } from "../vault";
import { isSensitiveKey, redact, secretVariants } from "./redact";
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

/** Transient failures worth another attempt; everything else is a configuration or policy error. */
const RETRYABLE_ERRORS = new Set(["errors.httpTimeout", "errors.httpRequestFailed", "errors.httpDnsFailed"]);

/**
 * One HTTP attempt: decrypt the credential, send, redact. Decryption and the request share this call
 * so the plaintext secret only ever exists inside one Inngest step and is never part of its result.
 */
export async function runHttpAttempt(request: HttpNodeRequest, deps: HttpNodeDeps): Promise<HttpAttemptResult> {
  // User-typed values of auth-looking headers are secrets too, even when not stored in the Vault.
  const secrets = Object.entries(request.headers).filter(([key]) => isSensitiveKey(key)).map(([, value]) => value);
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
    return { ok: true, response: redact(response, secretVariants(secrets)) as SafeHttpResponse };
  } catch (error) {
    const key = error instanceof Error && error.message.startsWith("errors.") ? error.message : "errors.httpRequestFailed";
    return { ok: false, error: key, retryable: RETRYABLE_ERRORS.has(key) };
  }
}
