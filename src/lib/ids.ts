const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Canonical (lowercase) UUID, or null. IDs feed the Vault AAD byte-for-byte, so an uppercase ID from a URL
 * must not produce a different AAD than the lowercase one Postgres returns.
 */
export function canonicalUuid(id: string): string | null {
  return UUID.test(id) ? id.toLowerCase() : null;
}
