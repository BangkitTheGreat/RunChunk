-- Optional HMAC signing secret per webhook endpoint (stretch). The server must be able to read the secret
-- to verify signatures, so it is stored encrypted with the Vault key (AES-256-GCM, AAD purpose
-- "webhook-signing"), not hashed. NULL columns mean signing is off for that endpoint.

alter table public.webhook_endpoints
  add column signing_ciphertext text,
  add column signing_nonce text,
  add column signing_tag text,
  add column signing_key_version int check (signing_key_version is null or signing_key_version >= 1),
  add column signing_hint text check (signing_hint is null or char_length(signing_hint) = 4),
  add column signing_created_at timestamptz,
  add constraint webhook_endpoints_signing_all_or_none check (
    (signing_ciphertext is null) = (signing_nonce is null)
    and (signing_ciphertext is null) = (signing_tag is null)
    and (signing_ciphertext is null) = (signing_key_version is null)
    and (signing_ciphertext is null) = (signing_hint is null)
    and (signing_ciphertext is null) = (signing_created_at is null)
  );

-- Browsers see only that signing is on and when it was set; the ciphertext stays server-side.
grant select (signing_hint, signing_created_at) on public.webhook_endpoints to authenticated;
