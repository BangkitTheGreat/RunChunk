import { ApiError } from "./api";
import { isCredentialType, type CredentialSecret } from "./vault";

/** Columns a browser may receive. Ciphertext, nonce and tag never leave the server. */
export const CREDENTIAL_METADATA = "id,name,type,header_name,key_version,created_at,updated_at";

const HEADER_TOKEN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
// Hop-by-hop and routing headers are stripped by safeFetch; a credential there would silently vanish.
const RESERVED_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection", "upgrade", "te", "trailer", "keep-alive", "proxy-connection", "expect", "cookie"]);
const PRINTABLE = /^[\x20-\x7e]+$/;

function text(value: unknown, min: number, max: number): string {
  if (typeof value !== "string" || value.length < min || value.length > max || !PRINTABLE.test(value)) throw new ApiError(400, "errors.invalidInput");
  return value;
}

export function credentialName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) throw new ApiError(400, "errors.invalidInput");
  return value.trim();
}

/** Parses the secret part of a create/replace request. Short secrets are refused so redaction stays meaningful. */
export function parseSecret(body: Record<string, unknown>): { secret: CredentialSecret; headerName: string | null } {
  if (!isCredentialType(body.type)) throw new ApiError(400, "errors.invalidInput");
  switch (body.type) {
    case "api_key": {
      const headerName = text(body.headerName, 1, 64).toLowerCase();
      if (!HEADER_TOKEN.test(headerName) || RESERVED_HEADERS.has(headerName)) throw new ApiError(400, "errors.invalidInput");
      return { secret: { type: "api_key", value: text(body.value, 8, 4096) }, headerName };
    }
    case "bearer":
      return { secret: { type: "bearer", value: text(body.value, 8, 4096) }, headerName: null };
    case "basic": {
      const username = text(body.username, 1, 256);
      if (username.includes(":")) throw new ApiError(400, "errors.invalidInput");
      return { secret: { type: "basic", username, password: text(body.password, 4, 1024) }, headerName: null };
    }
  }
}
