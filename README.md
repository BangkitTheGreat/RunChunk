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
```

### RLS Isolation Check / *Uji Isolasi RLS*:
Run the transactional rollback validation script to verify cross-account isolation, restricted profiles access, and immutable execution logs:
*Jalankan skrip validasi rollback transaksional untuk memverifikasi isolasi lintas akun, pembatasan akses profil, dan riwayat log eksekusi:*

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 \
  -f supabase/tests/rls_cross_account.sql
```

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

### Secret scan / *Pemindaian rahasia*

```bash
npm run check:secrets
```

Scans every git-tracked file for committed secrets (Supabase JWT/secret keys, Inngest signing keys, private keys, GitHub/Google tokens, Postgres URLs with passwords, non-placeholder `*_KEY`/`*_SECRET`/`*_TOKEN` values). It prints only `file:line` and the rule, never the value. CI runs it on every PR. It does **not** scan git history: before making the repo public, also run `gitleaks git .` and rotate any key that was ever committed.

*Memindai semua file yang di-track git untuk rahasia yang ikut ter-commit. Output hanya `file:baris` dan nama aturan, nilai rahasia tidak pernah dicetak. CI menjalankannya di setiap PR. Skrip ini **tidak** memindai riwayat git: sebelum repo dipublikasikan, jalankan juga `gitleaks git .` dan rotasi kunci yang pernah ter-commit.*

---

## 4. Current Verification Limits / *Batasan Verifikasi Saat Ini*

- **Supabase/Postgres Runtime**: Live browser smoke passed with an isolated account: Manual → HTTP (`https://example.com`) → Output completed successfully; execution history and three node logs persisted. `supabase/migrations/0002_service_role_grants.sql` grants `service_role` write access needed by the engine. Cross-account RLS SQL test (`supabase/tests/rls_cross_account.sql`) still requires a direct Postgres connection.
  *(Smoke test browser dengan akun terisolasi lulus: Manual → HTTP (`https://example.com`) → Keluaran berhasil; riwayat dan tiga log node tersimpan. `supabase/migrations/0002_service_role_grants.sql` memberi hak tulis `service_role` yang dibutuhkan engine. Uji SQL RLS lintas akun (`supabase/tests/rls_cross_account.sql`) masih butuh koneksi Postgres langsung.)*
- **Inngest Cloud Dispatch**: Without live Inngest keys, workflow executions correctly fail-closed by marking `status: 'dispatch_failed'` with a HTTP `502` status code.
  *(Tanpa kunci Inngest aktif, eksekusi alur kerja secara aman masuk ke status `dispatch_failed` dengan kode status HTTP `502`.)*
