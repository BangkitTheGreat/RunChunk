import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { CredentialType } from "./workflow/types";

// Credentials Vault: AES-256-GCM, 12-byte random nonce per encryption, 16-byte tag,
// AAD bound to owner + credential ID + key version so a ciphertext cannot be moved between rows or users.
// Server-only: never import from client components.

export type CredentialSecret =
  | { type: "api_key"; value: string }
  | { type: "bearer"; value: string }
  | { type: "basic"; username: string; password: string };

export interface EncryptedSecret {
  ciphertext: string;
  nonce: string;
  tag: string;
  key_version: number;
}

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Keys come from env: CREDENTIALS_KEY_V1, CREDENTIALS_KEY_V2, ... (base64, 32 bytes each). */
function keyFor(version: number): Buffer {
  const raw = process.env[`CREDENTIALS_KEY_V${version}`];
  if (!raw) throw new Error("errors.vaultNotConfigured");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("errors.vaultNotConfigured");
  return key;
}

/** Version new secrets are written with. Older versions stay readable while their key remains in env. */
export function currentKeyVersion(): number {
  const version = Number(process.env.CREDENTIALS_KEY_VERSION ?? "1");
  if (!Number.isInteger(version) || version < 1) throw new Error("errors.vaultNotConfigured");
  return version;
}

function aad(userId: string, credentialId: string, version: number): Buffer {
  // UUIDs are compared canonically: an uppercase ID from a URL must seal the same AAD Postgres will return.
  return Buffer.from(`runchunk:credential:v${version}:${userId.toLowerCase()}:${credentialId.toLowerCase()}`);
}

export function encryptSecret(secret: CredentialSecret, userId: string, credentialId: string): EncryptedSecret {
  const version = currentKeyVersion();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(version), nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(userId, credentialId, version));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secret), "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    key_version: version,
  };
}

export function decryptSecret(row: EncryptedSecret, userId: string, credentialId: string): CredentialSecret {
  try {
    const nonce = Buffer.from(row.nonce, "base64");
    const tag = Buffer.from(row.tag, "base64");
    if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", keyFor(row.key_version), nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(userId, credentialId, row.key_version));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, "base64")), decipher.final()]).toString("utf8");
    const secret = JSON.parse(plain) as CredentialSecret;
    if (!secret || typeof secret !== "object" || typeof secret.type !== "string") throw new Error();
    return secret;
  } catch (error) {
    // Never surface cipher internals; a missing key keeps its own message for operators.
    if (error instanceof Error && error.message === "errors.vaultNotConfigured") throw error;
    throw new Error("errors.credentialDecryptFailed");
  }
}

/** Header a credential adds to a request, and every string that must be scrubbed from outputs. */
export function credentialHeader(secret: CredentialSecret, headerName: string | null): { name: string; value: string; secrets: string[] } {
  switch (secret.type) {
    case "api_key":
      if (!headerName) throw new Error("errors.credentialInvalid");
      return { name: headerName.toLowerCase(), value: secret.value, secrets: [secret.value] };
    case "bearer":
      return { name: "authorization", value: `Bearer ${secret.value}`, secrets: [`Bearer ${secret.value}`, secret.value] };
    case "basic": {
      const pair = `${secret.username}:${secret.password}`;
      const encoded = Buffer.from(pair, "utf8").toString("base64");
      return { name: "authorization", value: `Basic ${encoded}`, secrets: [`Basic ${encoded}`, encoded, pair, secret.password] };
    }
  }
}

export function isCredentialType(value: unknown): value is CredentialType {
  return value === "api_key" || value === "bearer" || value === "basic";
}
