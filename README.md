# RunChunk

> Visual workflow automation platform (n8n lightweight alternative). Designed with transit-map visual logic, robust SSRF defense, and durable background execution.
> *Platform otomatisasi visual (alternatif ringan n8n). Dirancang dengan visual transit map ("Jalur"), perlindungan SSRF ketat, dan eksekusi background yang andal.*

---

## 1. Setup & Environment / *Pengaturan Lingkungan*

Copy `.env.example` to `.env.local` and configure your credentials:
*Salin `.env.example` ke `.env.local` dan isi kredensial Anda:*

```bash
cp .env.example .env.local
```

### Required Variables / *Variabel Wajib*:
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL / *URL proyek Supabase*
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon/publishable key / *Kunci anon/publik Supabase*
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role secret (server-only) / *Kunci rahasia service role (khusus server)*
- `APP_URL`: Application origin (default: `http://localhost:3000`) for same-origin verification / *Origin aplikasi untuk verifikasi same-origin*
- `INNGEST_EVENT_KEY` & `INNGEST_SIGNING_KEY`: Inngest credentials for event dispatch & signing / *Kredensial Inngest untuk pengiriman event*
- `CREDENTIALS_KEY_V1`: 32-byte base64 key for the Credentials Vault (AES-256-GCM), server-only. `CREDENTIALS_KEY_VERSION` picks the key for new secrets (default `1`) / *Kunci 32 byte (base64) untuk Vault credential, khusus server. `CREDENTIALS_KEY_VERSION` memilih kunci untuk rahasia baru (default `1`)*

---

## 2. Database Migrations & RLS Tests / *Migrasi Database & Pengujian RLS*

### Running Migrations / *Menjalankan Migrasi*:
Apply migrations using Supabase CLI or directly in your Supabase SQL editor:
*Terapkan migrasi menggunakan Supabase CLI atau langsung di editor SQL Supabase:*

```bash
# Local Supabase CLI
supabase db reset
# Or apply files in order in SQL Editor / Atau terapkan berurutan lewat SQL Editor:
# supabase/migrations/0001_init.sql
# supabase/migrations/0002_service_role_grants.sql
# supabase/migrations/0003_credentials.sql
# supabase/migrations/0004_webhook_schedule_quota.sql
# supabase/migrations/0005_webhook_signature.sql
# supabase/migrations/0006_workflow_versions.sql
```

### RLS Isolation Check / *Uji Isolasi RLS*:
Run the transactional rollback validation script to verify cross-account isolation, restricted profiles access, and immutable execution logs:
*Jalankan skrip validasi rollback transaksional untuk memverifikasi isolasi lintas akun, pembatasan akses profil, dan riwayat log eksekusi:*

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 \
  -f supabase/tests/rls_cross_account.sql
```

Without Supabase/Docker, the same test runs on plain PostgreSQL using a small stub of the Supabase pieces (`auth.users`, `auth.uid()`, API roles):
*Tanpa Supabase/Docker, uji yang sama bisa dijalankan di PostgreSQL biasa memakai stub kecil untuk bagian khas Supabase:*

```bash
DB="postgresql://postgres@localhost:5432/runchunk_test"
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/vanilla_postgres_stub.sql
for f in supabase/migrations/*.sql; do psql "$DB" -v ON_ERROR_STOP=1 -f "$f"; done
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/rls_cross_account.sql
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/quota_webhook_schedule.sql
```

Or run everything (stub, migrations, both suites, and the parallel checks in `scripts/db-concurrency.sh`) with `DB="$DB" scripts/db-check.sh`. The parallel checks commit one throwaway user and delete it on exit, so use an empty test database.
*Atau jalankan semuanya (stub, migrasi, kedua suite, dan uji paralel `scripts/db-concurrency.sh`) dengan `DB="$DB" scripts/db-check.sh`. Uji paralel meng-commit satu user sementara lalu menghapusnya, jadi pakai database uji kosong.*

### Automated checks / *Pemeriksaan otomatis*

```bash
npm run lint
npm run typecheck   # next typegen + tsc
npm test            # validator, SSRF, expression, engine (branching, delay, retry, replay), Vault, redaction, triggers, schedule, quota path
```

### Webhook, schedule, and quota / *Webhook, jadwal, dan kuota*

- Webhook: `POST {APP_URL}/api/v1/webhooks/{token}` (create the URL from the webhook node; the token is shown once). Responds `202 {"executionId"}`; the result is in the authenticated history. Only workflows switched to **Active** accept requests. Rate limit per URL: Free 10/min, Pro 60/min (`429` + `Retry-After`).
  *Webhook: buat URL dari node webhook (token ditampilkan sekali). Respons `202 {"executionId"}`; hasil dibaca di riwayat. Hanya workflow **Aktif** yang menerima request.*
- Optional webhook signing: enable it on the webhook node to get a shared secret (shown once). Senders add `X-RunChunk-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "t.body")>`; requests with a missing, stale (±5 min) or wrong signature get `401`. The editor shows a signed `curl` example.
  *Tanda tangan webhook opsional: aktifkan di node webhook untuk mendapat rahasia bersama (ditampilkan sekali). Request tanpa tanda tangan yang cocok mendapat `401`.*
- Editor extras: **Rapikan otomatis** re-lays out nodes left to right (dagre); **Versi** lists the last 20 saved versions with a diff against the canvas and restores one as a new version.
  *Ekstra editor: **Rapikan otomatis** menata ulang node (dagre); **Versi** menampilkan 20 versi terakhir dengan perbedaan terhadap kanvas dan mengembalikannya sebagai versi baru.*
- Schedule: 5-field cron + IANA timezone on the schedule node; one Inngest cron dispatcher (`schedule-dispatcher`, every minute) fires active workflows. Missed slots are not caught up; when the monthly quota runs out the schedule is deactivated and a failed execution records why.
  *Jadwal: cron 5 field + zona waktu di node jadwal; satu dispatcher Inngest tiap menit. Slot terlewat tidak dikejar; saat kuota habis jadwal dinonaktifkan dan tercatat di riwayat.*
- Quota (PRD §9): Free 100 runs/month and 3 active workflows; Pro 5,000 runs and 10 active. Reserved atomically in Postgres for manual, webhook and schedule runs. Pro is a simulation set by an admin (`update profiles set plan = 'pro' where id = …`); clients cannot change it.
  *Kuota: Free 100 run/bulan, 3 workflow aktif; Pro 5.000 run, 10 aktif. Pro adalah simulasi yang ditetapkan admin di DB.*

---

## 3. Development Commands / *Perintah Pengembangan*

Pastikan `.env.local` memuat `INNGEST_DEV=1` untuk mode lokal. Kunci Inngest Cloud tidak diperlukan untuk Dev Server. Untuk produksi, gunakan `INNGEST_EVENT_KEY` dan `INNGEST_SIGNING_KEY` yang sah.

Set `INNGEST_DEV=1` in `.env.local` for local mode. Cloud keys are not needed for Dev Server; production requires valid `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.

```bash
npm install
npm run dev -- --port 3008
# Terminal lain / another terminal:
npx inngest-cli dev -u http://localhost:3008/api/inngest
```

`inngest-cli` is a pinned development dependency. npm 12 blocks install scripts by default; `package.json` explicitly approves only `inngest-cli@1.45.1` so its required native binary can install. If installation was previously skipped, run `npm rebuild inngest-cli --foreground-scripts`. Do not use `inngest-cli@latest` via npx: its cached copy may lack the binary.

`inngest-cli` terpasang sebagai dependensi pengembangan. npm 12 memblokir install script secara default; `package.json` hanya mengizinkan `inngest-cli@1.45.1` agar binari natif terpasang. Bila instalasi sebelumnya terlewat, jalankan `npm rebuild inngest-cli --foreground-scripts`. Hindari `inngest-cli@latest` via npx karena cache bisa tidak memiliki binari.

---

## 4. Current Verification Limits / *Batasan Verifikasi Saat Ini*

- **Supabase/Postgres Runtime**: Live browser smoke passed with an isolated account: Manual → HTTP (`https://example.com`) → Output completed successfully; execution history and three node logs persisted. `supabase/migrations/0002_service_role_grants.sql` grants `service_role` write access needed by the engine. Cross-account RLS SQL test (`supabase/tests/rls_cross_account.sql`) still requires a direct Postgres connection.
  *(Smoke test browser dengan akun terisolasi lulus: Manual → HTTP (`https://example.com`) → Keluaran berhasil; riwayat dan tiga log node tersimpan. `supabase/migrations/0002_service_role_grants.sql` memberi hak tulis `service_role` yang dibutuhkan engine. Uji SQL RLS lintas akun (`supabase/tests/rls_cross_account.sql`) masih butuh koneksi Postgres langsung.)*
- **Weeks 3–4 (branching, Vault, redaction, Realtime, retry)**: covered by `npm test` (engine run through a fake Inngest step runner with replay), the RLS suite on PostgreSQL 16, and a Playwright render of the editor against mocked API responses. Not yet run against live Supabase Realtime/Auth and Inngest Dev Server. See `docs/VERIFICATION.md`.
  *(Minggu 3–4 diverifikasi lewat `npm test`, suite RLS di PostgreSQL 16, dan render editor dengan Playwright memakai API tiruan. Belum diuji dengan Supabase Realtime/Auth dan Inngest Dev Server sungguhan. Lihat `docs/VERIFICATION.md`.)*
- **Weeks 5–6 (webhook, schedule, quota, Jalur visuals)**: covered by `npm test`, `scripts/db-check.sh` (quota, rate limit, claim/dedupe, RLS on the new tables) and a Playwright render. Not yet run against live Supabase + Inngest: real webhook calls, the cron dispatcher, Realtime-driven canvas updates. See `docs/VERIFICATION.md`.
  *(Minggu 5–6 diverifikasi lewat `npm test`, `scripts/db-check.sh`, dan render Playwright. Belum dijalankan dengan Supabase + Inngest sungguhan.)*
- **Inngest Cloud Dispatch**: Without live Inngest keys, workflow executions correctly fail-closed by marking `status: 'dispatch_failed'` with a HTTP `502` status code.
  *(Tanpa kunci Inngest aktif, eksekusi alur kerja secara aman masuk ke status `dispatch_failed` dengan kode status HTTP `502`.)*
