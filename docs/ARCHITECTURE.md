# RunChunk — Architecture (rancangan, belum diimplementasikan)

## 1. Batas sistem

- Next.js App Router di Vercel: halaman, autentikasi, API, endpoint `/api/inngest`.
- Supabase: Postgres, Auth, RLS, Realtime. Auth ID adalah sumber identitas, bukan email atau `localStorage`.
- Inngest Cloud: menerima event, menjadwalkan langkah/retry, lalu memanggil **fungsi RunChunk di Vercel**. Inngest Cloud bukan host terpisah untuk kode executor. Setiap invokasi fungsi tetap terkena batas durasi/memori Vercel. `step.sleep` merespons dan melanjutkan pada invokasi berikutnya.
- Gemini: API server-side untuk asisten opsional; SSE ke browser hanya jika batas streaming platform memungkinkan. Non-streaming fallback wajib.
- UI: Next.js + `@xyflow/react`, Tailwind/shadcn, Zustand hanya jika state editor membutuhkannya, `next-intl` untuk ID/EN. Motion via CSS dulu; tambah library hanya jika dibutuhkan.

Alur: browser/webhook → route tervalidasi → transaksi DB membuat execution → kirim event Inngest → fungsi di Vercel membaca *snapshot* workflow → eksekusi node per langkah → status/log di Postgres → Supabase Realtime ke pemilik. Bila dispatch gagal, tandai execution `dispatch_failed` dan sediakan retry; jangan biarkan status `pending` abadi. Desain outbox transaksional baru jika perlu jaminan dispatch lebih kuat.

## 2. Keputusan engine

- Workflow berupa DAG; satu trigger, ID node unik, edge valid, tidak boleh cycle, batas jumlah node/payload. Simpan `definition_version` bersama JSON dan *snapshot* definisi di awal run agar edit saat eksekusi tidak mengubah run berjalan.
- Parser `{{$json.path}}`, `{{$node.id.path}}`, `{{$vars.key}}`, `{{$trigger.path}}` hanya path lookup pada data JSON milik user. Tidak memakai `eval`, `new Function`, getter/prototype access. Saat seluruh field expression tunggal, nilai mempertahankan tipe; interpolasi campuran menjadi string yang di-escape sesuai konteks.
- Executor memilih node yang *reachable* dari trigger dan hanya melanjutkan edge kondisi yang terpilih; topological sort saja tidak cukup untuk branching. Semantik merge/foreach ditunda karena tidak ada di 9 node inti.
- Setiap langkah punya status `pending/running/success/failed/skipped`, durasi, error ringkas. Output besar dipangkas dengan batas byte. `partial_failed` hanya dipakai bila ada semantik `continueOnFail` yang jelas.
- Inngest step ID harus stabil per run. `step.run` dan retry berpotensi mengeksekusi ulang HTTP eksternal; tidak ada jaminan exactly-once terhadap API pihak ketiga. Tawarkan idempotency key ke target yang mendukung, dokumentasikan risiko untuk POST.
- Delay via `step.sleep`, bukan HTTP request panjang. Limit keseluruhan run, jumlah node, durasi node, dan ukuran data ditentukan saat implementasi terhadap batas platform terkini.
- Code node: QuickJS WASM sebagai kandidat, bukan "V8 isolate" atau jaminan sandbox mutlak. Jangan aktifkan untuk user publik sebelum verifikasi interrupt handler, memory limit, serialisasi input/output, library pinning, pengujian escape/DoS dan pembatasan proses/hosting. Untuk demo tepercaya bisa diberi feature flag; tidak ada `node:vm`/`vm2` sebagai batas keamanan.

## 3. Webhook dan jadwal

- URL publik pakai ID/token acak berentropi tinggi, bukan `{user_id}/{workflow_id}` yang mudah ditebak; simpan hash token bila memungkinkan, dukung rotasi dan nonaktifkan. Pengguna bisa memilih signature/HMAC untuk pengirim yang mendukung. Validasi method, content type, ukuran body, rate limit per endpoint, dan status workflow.
- MVP webhook **asinkron**: valid request → `202 Accepted` + `executionId`; `output.response` menentukan output yang tersimpan dan terlihat di history, bukan HTTP response dari webhook tadi. Respons sinkron kustom butuh desain wait/callback terpisah dan batas timeout; bukan janji MVP.
- Untuk jadwal per workflow yang bisa diubah user: satu Inngest cron dispatcher periodik + tabel jadwal (`cron`, timezone, `next_run_at`) atau mekanisme scheduling provider yang terbukti mendukung konfigurasi dinamis. Dispatcher mengunci due rows dan mengirim event; uji timezone/DST dan dedupe.
- Route webhook dan dispatcher melewati jalur reservasi quota yang sama seperti tombol Manual; tidak cukup mengandalkan hitungan di client.

## 4. Skema data minimum (konseptual)

| Tabel | Kolom penting | Aturan |
|---|---|---|
| `profiles` | `id = auth.users.id`, `plan`, `locale` | `plan` bukan kolom yang boleh di-update client |
| `workflows` | `id`, `user_id`, `definition jsonb`, `version`, `is_active`, `route_color` | JSON divalidasi di server; update hanya pemilik |
| `webhook_endpoints` | `workflow_id`, `token_hash`, `enabled` | token mentah ditampilkan sekali; rotasi |
| `workflow_schedules` | `workflow_id`, `cron`, `timezone`, `next_run_at` | lock/dedupe dispatcher |
| `credentials` | `id`, `user_id`, `ciphertext`, `iv`, `tag`, `key_version` | hanya server endpoint yang membaca ciphertext; UI tak pernah baca/decrypt |
| `executions` | `id`, `workflow_id`, `user_id`, `definition_snapshot`, `status`, `started_at`, `finished_at` | pembatas quota atomik saat create |
| `execution_logs` | `execution_id`, `node_id`, `status`, `summary`, `duration_ms`, `created_at` | data dibatasi; payload mentah opt-in + redaksi |
| `usage_counters` | `user_id`, `period_start`, `runs` | transaksi/RPC dengan locking untuk reservasi |

Semua FK dan indeks `(user_id, created_at)` atau `(execution_id, created_at)` sesuai kueri. `execution_logs` punya `execution_id`, bukan `user_id`; policy SELECT via `EXISTS` ke `executions` milik `auth.uid()`. Aktifkan RLS pada semua tabel akses browser (profiles, workflows, executions, logs, dll), policy per operasi; pembaruan plan/usage/credentials via endpoint terotorisasi atau role DB terbatas. Service role hanya di server dan tidak mengandalkan RLS—setiap akses wajib scope user yang terverifikasi. Trigger pembuatan profil dari `auth.users`; email verification dan OAuth redirect diuji di lokal + produksi.

## 5. Keamanan dan penyalahgunaan

- HTTP node menerima URL user: **SSRF risk**. Tolak localhost, loopback, private/link-local/metadata IP, dan skema non-HTTP(S). Resolusi DNS dan redirect divalidasi pada setiap hop; DNS rebinding dan proxy deployment perlu diuji. Jika lingkungan serverless tidak bisa menjamin kontrol egress, batasi HTTP node ke allowlist domain untuk demo publik. Timeout, batas redirect, ukuran response/body, dan batas concurrency wajib.
- Vault: AES-256-GCM dengan nonce acak unik 12 byte setiap enkripsi, tag 16 byte, key 32 byte dari secret manager/env server, AAD terikat owner+credential ID, version key untuk rotasi. Jangan log request headers/body yang memuat secret. Redaksi regex saja tidak cukup karena nilai bisa pindah ke output API; pakai whitelist fields dan truncation untuk log. Tidak mendekripsi di browser.
- Code node tetap risiko DoS meskipun QuickJS tidak menyediakan network/FS secara bawaan. Matikan saat deployment publik sampai isolation dan resource limit teruji.
- Promo code demo tidak boleh berupa string hardcoded yang membuat siapa pun Pro. Gunakan akun demo Pro yang ditetapkan admin di DB, atau kode sekali pakai dengan expiry dan redemption atomik. Labeli jelas **simulasi**, bukan subscription berbayar. Tidak ada payment gateway maupun janji penagihan.
- Quota: transaksi/RPC atomik ketika membuat execution agar dua request paralel tak lolos limit. Rate limit per endpoint harus tersimpan lintas instance (DB atau provider), tidak dalam memori Vercel.
- Logs bisa memuat data pribadi: minimisasi, retensi dengan job terjadwal, hapus otomatis, dan akses owner-only. Backup/export data sesuai kebutuhan tugas.

## 6. Realtime dan UI

Supabase Postgres Changes untuk tabel/log milik pemilik: verifikasi RLS subscription, unsubscribe saat unmount, batasi event dan payload. Bila koneksi putus, refetch status lewat API; Realtime bukan sumber kebenaran. Status node untuk visual Jalur berasal dari log persisten. `prefers-reduced-motion` mematikan kereta; status tetap terbaca lewat teks/ikon. i18n ID dan EN disiapkan bersamaan sejak awal; UI tidak mencampur bahasa.

## 7. Deployment dan verifikasi

Lokal: Next.js + Supabase local/cloud dev + Inngest Dev Server. Produksi demo: Vercel + Supabase Cloud + Inngest Cloud. Endpoint Inngest di Vercel diverifikasi signature-nya, secret disimpan di environment masing-masing. Uji integrasi nyata: manual → HTTP publik aman → history; webhook → `202` → status sukses; schedule → satu run tanpa duplikasi; Auth A tak bisa baca workflow/log B; 100 request paralel tak menembus quota; URL private/redirect private ditolak; API key tidak muncul di network response/log.

Batas free tier dan syarat penggunaan perlu dicek lagi saat deploy: [Vercel pricing](https://vercel.com/pricing), [Supabase pricing](https://supabase.com/pricing), [Inngest pricing](https://www.inngest.com/pricing), [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits). Jangan klaim proyek non-demo berbayar layak di Vercel Hobby tanpa memeriksa syarat komersial.
