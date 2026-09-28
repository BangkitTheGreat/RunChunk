-- Credentials Vault. Secrets are AES-256-GCM encrypted by the server before insert;
-- the database never sees plaintext and browsers never see ciphertext.

create table public.credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  type text not null check (type in ('api_key', 'bearer', 'basic')),
  -- Non-secret metadata: the header an api_key credential is sent in.
  header_name text check (header_name ~ '^[A-Za-z0-9!#$%&''*+.^_`|~-]{1,64}$'),
  ciphertext text not null,
  nonce text not null,
  tag text not null,
  key_version int not null check (key_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((type = 'api_key') = (header_name is not null))
);

create index credentials_user_created_idx on public.credentials (user_id, created_at desc);

create trigger credentials_set_updated_at
  before update on public.credentials
  for each row execute function public.set_updated_at();

-- Browsers may read metadata columns of their own rows and delete them. Ciphertext columns are
-- not granted, and inserts/updates go through the server (service_role) which encrypts first.
revoke all on public.credentials from anon, authenticated;
grant select (id, user_id, name, type, header_name, key_version, created_at, updated_at) on public.credentials to authenticated;
grant delete on public.credentials to authenticated;
grant select, insert, update, delete on public.credentials to service_role;

alter table public.credentials enable row level security;

create policy credentials_select_own on public.credentials
  for select to authenticated using (user_id = (select auth.uid()));
create policy credentials_delete_own on public.credentials
  for delete to authenticated using (user_id = (select auth.uid()));
