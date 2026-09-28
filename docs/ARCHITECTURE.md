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

## 8. Keputusan implementasi minggu 3–4

Bagian ini mencatat apa yang **sudah diimplementasikan** (bagian 1–7 di atas tetap rancangan awal).

**Percabangan.** `control.condition` punya port `true` dan `false`; edge dari condition wajib memakai salah satunya, edge dari node lain tidak boleh memakai port. Node boleh punya lebih dari satu edge masuk (cabang bertemu lagi). Aturan engine: node **jalan** bila tepat satu edge masuk aktif, **dilewati** bila tidak ada, dan **gagal** dengan `errors.multipleActiveInputs` bila lebih dari satu aktif. Ini guard selama node Merge belum ada; engine tidak pernah menjalankan node dua kali karena tiap node diproses sekali dalam urutan topologis. `$json` berasal dari satu-satunya predecessor aktif.

**Operator condition** (`equals`, `not_equals`, `contains`, `gt`, `lt`, `exists`, `is_empty`) adalah enum yang dievaluasi kode server tepercaya (`src/lib/workflow/condition.ts`). Operand tetap lewat resolver path-only; ini **bukan** logic di dalam `{{ }}` dan tidak membuka pintu eval untuk fitur lain. Koersi: teks angka menjadi angka (`404` = `"404"`), `"true"`/`"false"` menjadi boolean, objek dibandingkan sebagai JSON. `gt`/`lt` pada nilai non-angka menggagalkan node (`errors.conditionNotNumber`) alih-alih diam-diam bernilai salah.

**Delay dan umur run.** `control.delay` memakai `step.sleep`, maksimal 1 jam per node. Validator menghitung waktu terburuk satu run (semua delay + tiap percobaan HTTP 10 detik + jeda retry) dan menolak definisi di atas **24 jam**. Saat jalan, deadline `executions.created_at` + 24 jam diperiksa di tiga titik, semuanya di dalam step sehingga vonisnya dimemo dan sama saat replay: saat node mulai, di dalam step setiap percobaan HTTP (percobaan tidak dikirim bila sudah lewat), dan di dalam step pencatat sukses (delay atau percobaan yang selesai setelah deadline tidak dicatat sukses). Pelanggaran menggagalkan node dengan `errors.runTooLong`.

**Vault.** Tabel `credentials` (migrasi `0003`): `ciphertext`, `nonce`, `tag`, `key_version`, `header_name`. AES-256-GCM, nonce acak 12 byte per enkripsi, AAD `runchunk:credential:v{key_version}:{user_id}:{id}`. UUID di AAD dinormalisasi ke huruf kecil, dan route memakai ID kanonis, sehingga ID huruf besar di URL tidak menghasilkan AAD yang berbeda. Kunci dari env `CREDENTIALS_KEY_V{n}`; `CREDENTIALS_KEY_VERSION` memilih versi untuk rahasia baru, versi lama tetap bisa dibaca selama kuncinya ada. Browser hanya diberi hak SELECT pada kolom metadata (bukan ciphertext) dan DELETE; insert/update lewat API server yang mengenkripsi. Dekripsi dan request HTTP terjadi di **satu** `step.run`, sehingga plaintext tidak pernah menjadi state step Inngest. Tool re-encrypt ditunda.

**Redaksi (dua lapis).** (1) Di dalam step HTTP, sebelum hasil keluar: setiap kemunculan nilai rahasia diganti `[REDACTED]`. Pencocokan dilakukan per karakter, sehingga tiap karakter boleh muncul literal, percent-encoded (hex huruf besar atau kecil), `+` untuk spasi (form encoding), atau escape JSON (`\uXXXX`, `\/`). Bentuk turunan juga dicocokkan: `Bearer …`, base64 Basic, `user:pass`. Untuk header auth yang diketik manual, yang disensor bukan hanya string header lengkap tetapi juga komponennya: token setelah skema, isi Basic yang di-decode, dan nilai tiap pasangan cookie. Di luar cakupan: encoding ganda (`%252F`), entitas HTML, dan transformasi lain oleh API tujuan. Karena ini terjadi di sumber, node berikutnya, state Inngest, database, dan browser hanya melihat versi yang sudah disensor. (2) Di batas penyimpanan: field bernama sensitif (`authorization`, `cookie`, `set-cookie`, `x-api-key`, `access_token`, `refresh_token`, `client_secret`, `password`, …) disensor di log dan output, termasuk token dari endpoint OAuth. Header respons tetap di-whitelist (`content-type`, `content-length`, `date`). Log per node menyimpan pratinjau output maksimal 4 KB.

**Realtime.** Browser berlangganan Postgres Changes (`executions` per `workflow_id`/`id`, `execution_logs` per `execution_id`), dibatasi RLS. Event hanya sinyal: UI selalu refetch lewat API. Refetch juga terjadi saat mount, setiap (re)subscribe, fokus jendela, dan event `online`. Polling dihapus.

**Retry per node** (HTTP, 0–3 kali). Tiap percobaan adalah step terpisah (`node-{id}-attempt-{n}`) dengan `step.sleep` 2/4/8 detik di antaranya. Yang diulang hanya error jaringan, timeout, DNS, status 429, dan 5xx; 4xx lain dan penolakan kebijakan (SSRF, URL tidak valid) tidak diulang. Bila percobaan habis dan respons terakhir masih 5xx, respons itu tetap menjadi output (bisa dicabangkan dengan condition). UI memberi peringatan bila retry aktif pada POST/PUT/PATCH/DELETE. Retry level fungsi Inngest tetap 0.

## 9. Keputusan implementasi minggu 5–6

**Pemicu.** Definisi punya tepat satu node pemicu dari tiga jenis (`trigger.manual`, `trigger.webhook`, `trigger.schedule`). Tombol Jalankan bekerja untuk semua jenis (data pemicu kosong), jadi workflow webhook/jadwal bisa diuji tanpa menunggu. Node pemicu mengeluarkan `triggerData` apa adanya: untuk webhook `{ method, query, headers, body, receivedAt }` (header hanya whitelist `content-type`, `user-agent`, `x-request-id`, `x-github-event`, `x-event-type`; header auth dan cookie tidak pernah masuk), untuk jadwal `{ scheduledAt, timezone, cron }`. `executions.trigger_source` mencatat asal run.

**Aktivasi.** `workflows.is_active` adalah satu-satunya saklar untuk webhook dan jadwal. Diubah hanya lewat RPC `set_workflow_active` (service role) di bawah `pg_advisory_xact_lock` per user, sehingga dua aktivasi paralel tidak bisa sama-sama lolos batas plan. Client tidak punya hak UPDATE kolom itu. Aktivasi menolak definisi tidak valid, pemicu manual (`errors.activationNotNeeded`), dan jadwal tanpa cron valid.

**Webhook.** Satu endpoint per workflow. Token 32 byte acak (base64url, 43 karakter), hanya SHA-256-nya yang disimpan bersama `token_hint` (4 karakter terakhir); token mentah ada di respons create/rotate saja. Kolom `enabled` di rancangan §4 tidak dipakai: menonaktifkan = workflow nonaktif, rotasi, atau hapus URL. Route publik `POST /api/v1/webhooks/{token}` tanpa autentikasi dan tanpa cek same-origin; semua kegagalan yang bisa membocorkan keberadaan token (format salah, tidak ada, workflow nonaktif) menjawab 404 yang sama. Urutan: cek token → cek workflow aktif → rate limit → baca body (maks 256 KB; JSON, form-urlencoded, atau teks) → validasi definisi → reservasi quota → buat execution → 202 `{ executionId }`. Hasil dibaca dari riwayat terautentikasi, bukan dari respons webhook.

**Rate limit** per endpoint disimpan di `webhook_rate_limits` (fixed window 60 detik) lewat RPC `webhook_hit`; `ON CONFLICT … WHERE hits < limit` membuat request paralel terserialisasi oleh row lock. Batas dari `plan_limits`: Free 10/menit, Pro 60/menit. Jawaban 429 membawa `Retry-After`. Window lama dibersihkan oleh dispatcher tiap menit.

**Quota.** `reserve_run` menaikkan `usage_counters` untuk bulan berjalan (UTC) dengan `INSERT … ON CONFLICT DO UPDATE … WHERE runs < quota`; request yang tidak mendapat baris berarti ditolak. Ini jalur tunggal untuk manual, webhook, dan jadwal (`src/lib/executions/start.ts`). Bila dispatch ke Inngest gagal, execution ditandai `dispatch_failed` dan reservasi dikembalikan (`release_run`). Batas dari PRD §9: Free 100 run/bulan, 3 workflow aktif; Pro 5.000 run, 10 aktif (batas demo). Plan Pro tetap simulasi: `profiles.plan` hanya bisa diubah admin di DB; UI melabelinya "(simulasi)".

**Jadwal.** Cron 5 field (menit jam tanggal bulan hari) diparse `croner` dengan zona waktu IANA; DST ditangani library (slot yang tidak ada saat spring-forward dijalankan pada instan valid berikutnya). `workflow_schedules` adalah cermin node pemicu yang disinkronkan server saat simpan (jika aktif) dan saat aktivasi. Dispatcher: satu fungsi cron Inngest tiap menit → `due_schedules` (hanya workflow aktif) → untuk tiap baris hitung slot berikutnya **dari sekarang** → `claim_schedule` compare-and-swap pada `next_run_at` → hanya pemenang CAS yang membuat execution, dengan `id` event `schedule:{id}:{slot}` sebagai dedupe lapis kedua. Tiap slot adalah step Inngest yang dimemo. Konsekuensi yang disengaja: at-most-once per slot (crash antara claim dan dispatch menghilangkan satu slot, tidak pernah menggandakan), dan slot yang terlewat saat sistem mati tidak dikejar. Bila quota habis atau definisi menjadi tidak valid, dispatcher menonaktifkan workflow dan mencatat satu execution `failed` beralasan (`errors.quotaExceeded` / `errors.invalidWorkflow`) supaya tidak gagal diam-diam tiap menit.

**Visual Jalur.** Tiap workflow punya `route_color` 1–6 (dipilih modulo 6 saat dibuat, bisa diganti di toolbar). Semua edge memakai warna jalur itu (bukan warna status), port benar/salah dibedakan label. Border node = status (running/success/failed) dengan transisi 180 ms; node running mendapat sweep bar. Kereta = titik yang bergerak di sepanjang edge (`animateMotion`) selama node tujuan running; `prefers-reduced-motion` mengganti kereta dan sweep dengan penanda statis. Kanvas mengikuti execution terbaru secara otomatis (run dari webhook/jadwal muncul tanpa klik) sampai pengguna memilih run lama dari riwayat.

**Dashboard.** Daftar workflow memakai view `workflow_last_executions` (`security_invoker`, `DISTINCT ON`) untuk status run terakhir per workflow; ringkasan plan/quota dari RPC `my_usage` (security invoker, hanya baca). Dua starter template memakai endpoint publik `httpbin.org` dan tidak berisi rahasia.
